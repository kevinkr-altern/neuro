from datetime import datetime, timezone, date as date_cls
from zoneinfo import ZoneInfo
from app.core.db import conn, symbol_id
from app.providers.eodhd import fetch_intraday, fetch_eod
from app.core.market_calendar import is_half_trading_day
from app.indicators.formulas import (
    wilder_atr_last, adr_pct_last, lod_distance_pct, atr_extension,
    sma_last, ema_last, volatility_compression_proxy,
)

ET = ZoneInfo('America/New_York')
SESSION_START_MIN = 9 * 60 + 30  # 09:30 ET

def _ts(row):
    v = row.get('timestamp') or row.get('datetime') or row.get('date')
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    return datetime.fromisoformat(str(v).replace('Z', '+00:00')).astimezone(timezone.utc)

def _mins_since_open(timestamp_et: str) -> int:
    dt = datetime.fromisoformat(timestamp_et)
    return dt.hour * 60 + dt.minute - SESSION_START_MIN

def _session_length_min(date: str) -> int:
    return 210 if is_half_trading_day(date) else 390  # 09:30-13:00 vs 09:30-16:00

async def ensure_m5(ticker: str, date: str):
    sid = symbol_id(ticker)
    start = int(datetime.fromisoformat(date + 'T00:00:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date + 'T23:59:59+00:00').timestamp())
    with conn() as c:
        existing = c.execute("select count(*) from price_bars_intraday where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=?", (sid, date)).fetchone()[0]
    if existing == 0:
        rows = await fetch_intraday(ticker if '.' in ticker else f'{ticker}.US', '5m', start, end)
        with conn() as c:
            for r in rows:
                dt = _ts(r); et = dt.astimezone(ET)
                t = et.time().isoformat()
                regular = int('09:30:00' <= t <= '16:00:00')
                vol = r.get('volume')
                vol = None if vol in (None, '', 'null') else vol
                c.execute("insert or ignore into price_bars_intraday values(?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, dt.isoformat(), et.isoformat(), '5m', r['open'], r['high'], r['low'], r['close'], vol, regular, None, 'EODHD'))
            if rows:
                c.execute("insert or replace into data_availability(symbol_id,interval,first_available_at,last_available_at,status,message) values(?,?,?,?,?,?)", (sid, '5m', min(_ts(r).isoformat() for r in rows), max(_ts(r).isoformat() for r in rows), 'available', 'Echte m5-Daten gefunden'))
    return sid

async def ensure_daily(ticker: str, date: str):
    """Laedt Daily-OHLC (unadjustiert) fuer ~2 Jahre bis einschliesslich `date`."""
    sid = symbol_id(ticker)
    y = int(date[:4]); date_from = f'{y-2}-01-01'
    with conn() as c:
        existing = c.execute("select count(*) from price_bars_daily where symbol_id=? and date<=? and date>=?", (sid, date, date_from)).fetchone()[0]
    if existing < 200:
        rows = await fetch_eod(ticker if '.' in ticker else f'{ticker}.US', date_from, date)
        with conn() as c:
            for r in rows:
                c.execute("insert or ignore into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, r['date'], r['open'], r['high'], r['low'], r['close'], r.get('adjusted_close'), r.get('volume'), 'EODHD'))
    return sid

def _regular_intraday(sid: int, date: str, cutoff_et: str | None):
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select timestamp_et as time, open, high, low, close, volume from price_bars_intraday "
            "where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=? and is_regular_session=1 "
            "order by timestamp_utc", (sid, date))]
    # Nur Kerzen ab 09:30 ET (Pre-Market ausschliessen) und bis zum Cutoff.
    out = []
    for r in rows:
        m = _mins_since_open(r['time'])
        if m < 0:
            continue
        # Cutoff exklusiv: nur bis zum Cutoff ABGESCHLOSSENE 5m-Kerzen. Eine Kerze
        # mit Startzeit == Cutoff schliesst erst nach dem Cutoff und wird verworfen.
        if cutoff_et and r['time'][11:19] >= cutoff_et:
            continue
        out.append(r)
    return out

def intraday_bars(ticker: str, date: str, timeframe='5m', cutoff_et: str | None = None):
    sid = symbol_id(ticker)
    rows = _regular_intraday(sid, date, cutoff_et)
    if timeframe == '5m' or not rows:
        return rows
    size = 15 if timeframe == '15m' else 30
    expected = size // 5
    session_len = _session_length_min(date)
    buckets: dict[int, list] = {}
    for r in rows:
        m = _mins_since_open(r['time'])
        if m >= session_len:  # 16:00-Schlussprint u.ae. nicht in ein neues Fenster
            continue
        buckets.setdefault(m // size, []).append(r)
    out = []
    for idx in sorted(buckets):
        chunk = sorted(buckets[idx], key=lambda x: x['time'])
        complete = len(chunk) == expected
        out.append({
            'time': chunk[0]['time'], 'open': chunk[0]['open'],
            'high': max(x['high'] for x in chunk), 'low': min(x['low'] for x in chunk),
            'close': chunk[-1]['close'], 'volume': sum((x['volume'] or 0) for x in chunk),
            'incomplete': not complete,
            'bars_in_window': len(chunk), 'bars_expected': expected,
        })
    return out

def _daily_before(sid: int, date: str):
    """Abgeschlossene Daily-Kerzen STRIKT vor dem Entry-Tag (kein Look-ahead)."""
    with conn() as c:
        return [dict(r) for r in c.execute(
            "select date, open, high, low, close, volume from price_bars_daily where symbol_id=? and date<? order by date",
            (sid, date))]

def compute_metrics(ticker: str, date: str, cutoff_et: str | None = None):
    """Kennzahlen-Panel, look-ahead-sicher: Intraday bis Cutoff, Daily bis Vortag."""
    sid = symbol_id(ticker)
    bars = _regular_intraday(sid, date, cutoff_et)
    daily = _daily_before(sid, date)
    flags: list[str] = []
    m: dict = {'cutoff_et': cutoff_et, 'rvol_method': 'linear_intraday_projection'}

    if not bars:
        return {**m, 'data_status': 'Keine Intraday-Kerzen bis zum Cutoff vorhanden.', 'flags': ['intraday_fehlt']}

    price = bars[-1]['close']
    session_open = bars[0]['open']
    first_mins = _mins_since_open(bars[0]['time'])
    lod = min(x['low'] for x in bars)
    last_mins = _mins_since_open(bars[-1]['time'])
    elapsed = last_mins + 5  # Ende der letzten geschlossenen 5m-Kerze
    session_len = _session_length_min(date)

    m['selected_price'] = price
    m['low_of_day_so_far'] = lod
    m['session_open'] = session_open

    # Daily-basierte Kennzahlen (bis Vortag)
    closes = [d['close'] for d in daily]
    atr14 = wilder_atr_last(daily, 14)
    m['atr14_dollars'] = round(atr14, 4) if atr14 is not None else None
    if atr14 is None:
        flags.append('ATR(14): <14 Tageskerzen vorhanden')

    lod_pct = lod_distance_pct(price, lod, atr14)
    m['lod_distance_pct'] = lod_pct
    m['lod_distance_valid'] = lod_pct is not None
    m['lod_rule_70_ok'] = (lod_pct is not None and lod_pct <= 70)

    sma50 = sma_last(closes, 50); sma100 = sma_last(closes, 100); sma200 = sma_last(closes, 200)
    ema10 = ema_last(closes, 10); ema20 = ema_last(closes, 20); ema21 = ema_last(closes, 21)
    if sma200 is None:
        flags.append('SMA200: <200 Tageskerzen vorhanden')

    def dist(x):
        return round((price - x) / x * 100, 2) if x else None
    m['dist_ema10_pct'] = dist(ema10); m['dist_ema20_pct'] = dist(ema20)
    m['dist_sma50_pct'] = dist(sma50); m['dist_sma100_pct'] = dist(sma100); m['dist_sma200_pct'] = dist(sma200)

    def ext(x):
        v = atr_extension(price, x, atr14)
        return round(v, 3) if v is not None else None
    m['atr_ext_sma50'] = ext(sma50); m['atr_ext_ema10'] = ext(ema10); m['atr_ext_ema21'] = ext(ema21)

    m['adr14_pct'] = round(adr_pct_last(daily, 14), 3) if adr_pct_last(daily, 14) is not None else None
    m['adr20_pct'] = round(adr_pct_last(daily, 20), 3) if adr_pct_last(daily, 20) is not None else None
    rmv = volatility_compression_proxy(daily, 15)
    m['volatility_compression_proxy_15'] = round(rmv, 3) if rmv is not None else None

    prior = daily[-1] if daily else None
    m['pdh'] = prior['high'] if prior else None
    m['pdl'] = prior['low'] if prior else None
    m['gap_pct'] = round((session_open - prior['close']) / prior['close'] * 100, 3) if prior and prior['close'] else None
    if prior is None:
        flags.append('Kein Vortag: PDH/PDL/Gap nicht berechenbar')

    # RVOL linear projiziert (Hinweis: linear)
    cum_vol = sum((x['volume'] or 0) for x in bars)
    avg_vol = (sum(d['volume'] or 0 for d in daily[-20:]) / min(20, len(daily))) if daily else 0
    if avg_vol and elapsed > 0:
        projected = cum_vol * (session_len / elapsed)
        m['rvol_projected'] = round(projected / avg_vol, 3)
        m['rvol_note'] = f'linear projiziert ({elapsed}/{session_len} min)'
    else:
        m['rvol_projected'] = None
        m['rvol_note'] = 'linear projiziert; zu wenig Daily-Volumen'

    # Opening Range mit Zeit-Gueltigkeit (Look-ahead-Schutz)
    for tf, size in (('m5', 5), ('m15', 15), ('m30', 30)):
        win = [x for x in bars if 0 <= _mins_since_open(x['time']) < size]
        valid = elapsed >= size and len(win) == size // 5
        m[f'orb_{tf}_high'] = max((x['high'] for x in win), default=None) if valid else None
        m[f'orb_{tf}_low'] = min((x['low'] for x in win), default=None) if valid else None
        m[f'orb_{tf}_valid'] = valid
    if first_mins > 0:
        flags.append(f'Erste Kerze erst {first_mins} min nach 09:30 – ORB/Gap ggf. eingeschraenkt')

    m['flags'] = flags
    m['data_status'] = 'vollstaendig' if not flags else '; '.join(flags)
    return m

def metrics_for_bar(bars, index: int):
    # Rueckwaertskompatibel; die eigentlichen Kennzahlen liefert compute_metrics().
    if not bars or index < 0 or index >= len(bars):
        return {}
    b = bars[index]
    low = min(x['low'] for x in bars[:index + 1])
    return {'selected_price': b['close'], 'low_of_day_so_far': low}
