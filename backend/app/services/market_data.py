from datetime import datetime, timezone, timedelta, date as date_cls
from functools import partial
from zoneinfo import ZoneInfo
from app.core.db import conn, symbol_id
from app.providers.eodhd import fetch_intraday, fetch_eod, fetch_splits
from app.core.market_calendar import is_half_trading_day, PLATFORM_5M_SEARCH_FLOOR
from app.indicators.formulas import (
    wilder_atr_last, adr_pct_last, lod_distance_pct, atr_extension,
    sma_last, ema_last, volatility_compression_proxy, sma, ema,
)
from app.services.split_adjust import parse_split_ratio, adjust_bars

ET = ZoneInfo('America/New_York')
SESSION_START_MIN = 9 * 60 + 30  # 09:30 ET
DAILY_HISTORY_FLOOR = '1985-01-01'  # EODHD liefert vor der echten Notierung einfach nichts

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

def _prev_day(d: str) -> str:
    return (date_cls.fromisoformat(d) - timedelta(days=1)).isoformat()

def _next_day(d: str) -> str:
    return (date_cls.fromisoformat(d) + timedelta(days=1)).isoformat()

def coverage_gaps(cached_from: str | None, cached_to: str | None, want_from: str, want_to: str) -> list[tuple[str, str]]:
    """Reine Funktion: welche (from,to)-Teilbereiche von [want_from,want_to] sind
    noch NICHT durch [cached_from,cached_to] (bereits gepruefter Bereich, auch
    wenn EODHD dort leer war) abgedeckt? Liefert 0-2 nicht ueberlappende Teile."""
    if want_from > want_to:
        return []
    if not cached_from or not cached_to:
        return [(want_from, want_to)]
    gaps = []
    if want_from < cached_from:
        end = min(_prev_day(cached_from), want_to)
        if want_from <= end:
            gaps.append((want_from, end))
    if want_to > cached_to:
        start = max(_next_day(cached_to), want_from)
        if start <= want_to:
            gaps.append((start, want_to))
    return gaps

def _get_watermark(sid: int, interval: str) -> tuple[str | None, str | None]:
    with conn() as c:
        row = c.execute("select cached_from, cached_to from data_availability where symbol_id=? and interval=?", (sid, interval)).fetchone()
        return (row['cached_from'], row['cached_to']) if row else (None, None)

def _extend_watermark(sid: int, interval: str, checked_from: str, checked_to: str, status: str = 'cached', message: str | None = None):
    with conn() as c:
        c.execute(
            "insert into data_availability(symbol_id,interval,cached_from,cached_to,status,message,checked_at) values(?,?,?,?,?,?,current_timestamp) "
            "on conflict(symbol_id,interval) do update set "
            "cached_from=min(coalesce(cached_from, excluded.cached_from), excluded.cached_from), "
            "cached_to=max(coalesce(cached_to, excluded.cached_to), excluded.cached_to), "
            "status=excluded.status, message=excluded.message, checked_at=current_timestamp",
            (sid, interval, checked_from, checked_to, status, message))

async def ensure_daily_history(ticker: str, date_to: str, date_from: str = DAILY_HISTORY_FLOOR):
    """Laedt Daily-OHLC (unadjustiert) fuer den angefragten Bereich, aber nur die
    tatsaechliche Luecke gegenueber dem bereits geprueften Bereich (Wasserstandsmarke
    in data_availability, interval='1d') - kein wiederholtes Neuladen bei jedem Aufruf."""
    sid = symbol_id(ticker)
    cached_from, cached_to = _get_watermark(sid, '1d')
    for gfrom, gto in coverage_gaps(cached_from, cached_to, date_from, date_to):
        rows = await fetch_eod(ticker if '.' in ticker else f'{ticker}.US', gfrom, gto, period='d')
        with conn() as c:
            for r in rows:
                c.execute("insert or ignore into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, r['date'], r['open'], r['high'], r['low'], r['close'], r.get('adjusted_close'), r.get('volume'), 'EODHD'))
        _extend_watermark(sid, '1d', gfrom, gto, 'cached', f'{len(rows)} Daily-Kerzen geprueft/geladen')
    return sid

async def ensure_weekly_history(ticker: str, date_to: str, date_from: str = DAILY_HISTORY_FLOOR):
    """Native Wochenkerzen von EODHD (period='w'; serverseitig aggregiert,
    behandelt Teilwochen/Feiertage korrekt - keine eigene Aggregation)."""
    sid = symbol_id(ticker)
    cached_from, cached_to = _get_watermark(sid, '1w')
    for gfrom, gto in coverage_gaps(cached_from, cached_to, date_from, date_to):
        rows = await fetch_eod(ticker if '.' in ticker else f'{ticker}.US', gfrom, gto, period='w')
        with conn() as c:
            for r in rows:
                c.execute("insert or ignore into price_bars_weekly values(?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, r['date'], r['open'], r['high'], r['low'], r['close'], r.get('adjusted_close'), r.get('volume'), 'EODHD'))
        _extend_watermark(sid, '1w', gfrom, gto, 'cached', f'{len(rows)} Wochenkerzen geprueft/geladen')
    return sid

async def ensure_splits_history(ticker: str, date_to: str, date_from: str = DAILY_HISTORY_FLOOR):
    """Laedt die Split-Historie (fuer die Rueckrechnung auf split-bereinigte
    Kurse - siehe split_adjust.py). WICHTIG: date_to muss das heutige
    Wall-Clock-Datum sein, nicht das angefragte Chart-/Entry-Datum, sonst
    werden Splits NACH dem Entry-Tag nie erfasst und die Rueckrechnung ist
    unvollstaendig."""
    sid = symbol_id(ticker)
    cached_from, cached_to = _get_watermark(sid, 'splits')
    for gfrom, gto in coverage_gaps(cached_from, cached_to, date_from, date_to):
        rows = await fetch_splits(ticker if '.' in ticker else f'{ticker}.US', gfrom, gto)
        with conn() as c:
            for r in rows:
                try:
                    ratio = parse_split_ratio(r['split'])
                except (ValueError, KeyError):
                    continue  # eine kaputte Split-Zeile darf den ganzen Chart-Load nicht crashen
                c.execute("insert or replace into splits_history values(?,?,?,?,?,current_timestamp)", (sid, r['date'], ratio, r.get('split'), 'EODHD'))
        _extend_watermark(sid, 'splits', gfrom, gto, 'cached', f'{len(rows)} Splits geprueft/geladen')
    return sid

def _load_splits(sid: int) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute("select split_date, ratio from splits_history where symbol_id=? order by split_date", (sid,))]

EODHD_5M_MAX_WINDOW_DAYS = 550  # Puffer unter EODHDs dokumentiertem 600-Tage-Limit fuer interval=5m

async def ensure_m5_history(ticker: str, date_from: str, date_to: str):
    """Deep-Backfill von m5 ueber mehrere Tage/Jahre, in <=550-Tage-Fenstern,
    gegen die Wasserstandsmarke interval='5m_range' (getrennt von der
    Einzeltag-Pruefung interval='5m', die von ensure_m5()/checkM5 verwendet wird)."""
    sid = symbol_id(ticker)
    cached_from, cached_to = _get_watermark(sid, '5m_range')
    for gfrom, gto in coverage_gaps(cached_from, cached_to, date_from, date_to):
        cur = date_cls.fromisoformat(gfrom)
        end = date_cls.fromisoformat(gto)
        while cur <= end:
            chunk_end = min(cur + timedelta(days=EODHD_5M_MAX_WINDOW_DAYS - 1), end)
            start_ts = int(datetime.combine(cur, datetime.min.time(), tzinfo=timezone.utc).timestamp())
            end_ts = int(datetime.combine(chunk_end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()) - 1
            rows = await fetch_intraday(ticker if '.' in ticker else f'{ticker}.US', '5m', start_ts, end_ts)
            with conn() as c:
                for r in rows:
                    dt = _ts(r); et = dt.astimezone(ET)
                    t = et.time().isoformat()
                    regular = int('09:30:00' <= t <= '16:00:00')
                    vol = r.get('volume')
                    vol = None if vol in (None, '', 'null') else vol
                    c.execute("insert or ignore into price_bars_intraday values(?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, dt.isoformat(), et.isoformat(), '5m', r['open'], r['high'], r['low'], r['close'], vol, regular, None, 'EODHD'))
            _extend_watermark(sid, '5m_range', cur.isoformat(), chunk_end.isoformat(), 'cached', f'{len(rows)} m5-Kerzen geprueft/geladen')
            cur = chunk_end + timedelta(days=1)
    return sid

async def find_earliest_available(probe_fn, low: date_cls, high: date_cls) -> date_cls | None:
    """Reine Bisektion (probe_fn ist async: Callable[[date], Awaitable[bool]]):
    findet das fruehste Datum mit verfuegbaren Daten in [low, high]. Nimmt an,
    dass Verfuegbarkeit monoton ist (beginnt einmal, dann durchgehend bis heute).
    7-Tage-Sondierungsfenster in probe_fn vermeiden falsch-negative Ergebnisse an
    Wochenenden/Feiertagen am Bisektions-Mittelpunkt. None, wenn selbst `high`
    keine Daten hat. ~log2(Tage/7) Aufrufe von probe_fn."""
    if not await probe_fn(high):
        return None
    if await probe_fn(low):
        return low
    lo, hi = low, high
    while (hi - lo).days > 7:
        mid = lo + (hi - lo) // 2
        if await probe_fn(mid):
            hi = mid
        else:
            lo = mid
    return hi

async def probe_m5_week(ticker: str, week_start: date_cls) -> bool:
    """Gibt es echte m5-Kerzen in den 7 Tagen ab week_start? (1 EODHD-Aufruf)"""
    start_ts = int(datetime.combine(week_start, datetime.min.time(), tzinfo=timezone.utc).timestamp())
    end_ts = int(datetime.combine(week_start + timedelta(days=7), datetime.min.time(), tzinfo=timezone.utc).timestamp())
    rows = await fetch_intraday(ticker if '.' in ticker else f'{ticker}.US', '5m', start_ts, end_ts)
    return len(rows) > 0

async def find_earliest_m5(ticker: str) -> date_cls | None:
    """Echte, pro-Ticker verifizierte M5-Startsuche (ersetzt die alte globale
    Schaetzung). Nutzt PLATFORM_5M_SEARCH_FLOOR als sichere untere Suchgrenze.
    `high` muss ein Datum sein, dessen 7-Tage-Sondierungsfenster vollstaendig
    in der Vergangenheit liegt - sonst prueft probe_fn(high) grossenteils noch
    nicht existierende zukuenftige Kerzen und liefert faelschlich False."""
    low = date_cls.fromisoformat(PLATFORM_5M_SEARCH_FLOOR)
    high = date_cls.today() - timedelta(days=8)
    return await find_earliest_available(partial(probe_m5_week, ticker), low, high)

async def ensure_m5_earliest(ticker: str) -> dict:
    """Liefert den verifizierten M5-Start, gecacht in data_availability
    (interval='m5_earliest', status='verified'). Sucht nur einmal pro Ticker."""
    sid = symbol_id(ticker)
    with conn() as c:
        row = c.execute("select first_available_at, status from data_availability where symbol_id=? and interval='m5_earliest'", (sid,)).fetchone()
    if row and row['status'] == 'verified' and row['first_available_at']:
        return {'m5_history_start': row['first_available_at'], 'verified': True, 'from_cache': True}
    earliest = await find_earliest_m5(ticker)
    result_date = earliest.isoformat() if earliest else None
    with conn() as c:
        c.execute(
            "insert into data_availability(symbol_id,interval,first_available_at,status,message,checked_at) values(?,?,?,?,?,current_timestamp) "
            "on conflict(symbol_id,interval) do update set first_available_at=excluded.first_available_at, status=excluded.status, message=excluded.message, checked_at=current_timestamp",
            (sid, 'm5_earliest', result_date, 'verified', 'Echte m5-Startsuche (Bisektion, live gegen EODHD)' if earliest else 'Keine m5-Daten fuer diesen Ticker gefunden'))
    return {'m5_history_start': result_date, 'verified': True, 'from_cache': False}

def _drop_broken_ohlc(rows: list[dict]) -> list[dict]:
    """EODHD liefert im breiten mehrjaehrigen Abruf vereinzelt kaputte/Platzhalter-
    Zeilen mit OHLC=None. Solche Zeilen NIE fuer Berechnungen verwenden und NIE
    stillschweigend durch einen Wert ersetzen (Datenpolitik) - einfach entfernen.
    Das reduziert die Kerzenzahl im betroffenen Aggregations-Fenster, wodurch die
    bestehende incomplete-Markierung automatisch greift, statt den Server abstuerzen
    zu lassen oder Daten zu erfinden."""
    return [r for r in rows if r['open'] is not None and r['high'] is not None and r['low'] is not None and r['close'] is not None]

def _regular_intraday(sid: int, date: str, cutoff_et: str | None):
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select timestamp_et as time, open, high, low, close, volume from price_bars_intraday "
            "where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=? and is_regular_session=1 "
            "order by timestamp_utc", (sid, date))]
    rows = _drop_broken_ohlc(rows)
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
    # Split-Rueckrechnung als reine Werteumrechnung NACH der Zeilenauswahl -
    # die Menge/Reihenfolge der zurueckgegebenen Zeilen (und damit der
    # Look-ahead-Schutz) bleibt unveraendert, nur die Zahlenwerte skalieren.
    return adjust_bars(out, _load_splits(sid))

_TIMEFRAME_MINUTES = {'15m': 15, '30m': 30, '1h': 60}

def aggregate_bars(rows: list[dict], size_min: int) -> list[dict]:
    """Buendelt 5m-Zeilen (Feldform wie _regular_intraday()/_regular_intraday_range())
    in size_min-Fenster, verankert an 09:30 ET, pro Kalendertag gruppiert (Schluessel
    (Datum, Fenster-Index)), damit mehrtaegige Bereiche nicht ueber Tagesgrenzen
    hinweg vermischt werden. Unvollstaendige Fenster (Datenluecke) werden markiert,
    nicht stillschweigend als vollstaendig behandelt - gleiche Regel wie bisher.
    Filtert defensiv kaputte OHLC=None-Zeilen (siehe _drop_broken_ohlc), damit
    diese Funktion auch bei direktem Aufruf mit ungefiltertem Input nie abstuerzt."""
    rows = _drop_broken_ohlc(rows)
    expected = size_min // 5
    buckets: dict[tuple, list] = {}
    for r in rows:
        d = r['time'][:10]
        m = _mins_since_open(r['time'])
        if m < 0:
            continue
        if m >= _session_length_min(d):  # 16:00-Schlussprint u.ae. nicht in ein neues Fenster
            continue
        buckets.setdefault((d, m // size_min), []).append(r)
    out = []
    for key in sorted(buckets):
        chunk = sorted(buckets[key], key=lambda x: x['time'])
        complete = len(chunk) == expected
        out.append({
            'time': chunk[0]['time'], 'open': chunk[0]['open'],
            'high': max(x['high'] for x in chunk), 'low': min(x['low'] for x in chunk),
            'close': chunk[-1]['close'], 'volume': sum((x['volume'] or 0) for x in chunk),
            'incomplete': not complete,
            'bars_in_window': len(chunk), 'bars_expected': expected,
        })
    return out

def intraday_bars(ticker: str, date: str, timeframe='5m', cutoff_et: str | None = None):
    sid = symbol_id(ticker)
    rows = _regular_intraday(sid, date, cutoff_et)
    if timeframe == '5m' or not rows:
        return rows
    return aggregate_bars(rows, _TIMEFRAME_MINUTES[timeframe])

def _regular_intraday_range(sid: int, date_from: str, date_to: str):
    """Wie _regular_intraday(), aber ueber einen Datumsbereich und OHNE Cutoff -
    rein visuelle Breitband-Daten fuer Chart-Browsing/Replay. NIEMALS fuer
    Look-ahead-sensible Berechnungen verwenden (dafuer bleibt _regular_intraday()
    + compute_metrics() die einzige Quelle)."""
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select timestamp_et as time, open, high, low, close, volume from price_bars_intraday "
            "where symbol_id=? and interval='5m' and is_regular_session=1 "
            "and substr(timestamp_utc,1,10) between ? and ? "
            "order by timestamp_utc", (sid, date_from, date_to))]
    rows = _drop_broken_ohlc(rows)
    rows = [r for r in rows if _mins_since_open(r['time']) >= 0]
    return adjust_bars(rows, _load_splits(sid))

def intraday_bars_range(ticker: str, date_from: str, date_to: str, timeframe: str = '5m'):
    sid = symbol_id(ticker)
    rows = _regular_intraday_range(sid, date_from, date_to)
    if timeframe == '5m' or not rows:
        return rows
    return aggregate_bars(rows, _TIMEFRAME_MINUTES[timeframe])

def _intraday_range_all_sessions(sid: int, date_from: str, date_to: str):
    """Wie _regular_intraday_range(), aber OHNE die is_regular_session=1-Einschraenkung -
    liefert auch Vor-/Nachbörse-Kerzen (mit is_regular_session-Flag im Ergebnis),
    damit das Frontend sie farblich hinterlegen kann. Nur fuer die native 5m-
    Breitband-Ansicht gedacht - 15m/30m/1h aggregieren weiterhin nur die reguläre
    Session (siehe intraday_bars_range/aggregate_bars, strikt an 09:30 ET
    verankert). Rein visuell, fliesst NIE in compute_metrics()/Look-ahead-
    Berechnungen ein (die bleiben ausschliesslich bei _regular_intraday())."""
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select timestamp_et as time, open, high, low, close, volume, is_regular_session from price_bars_intraday "
            "where symbol_id=? and interval='5m' "
            "and substr(timestamp_utc,1,10) between ? and ? "
            "order by timestamp_utc", (sid, date_from, date_to))]
    rows = _drop_broken_ohlc(rows)
    return adjust_bars(rows, _load_splits(sid))

def intraday_bars_range_all_sessions(ticker: str, date_from: str, date_to: str):
    sid = symbol_id(ticker)
    return _intraday_range_all_sessions(sid, date_from, date_to)

def daily_bars_range(ticker: str, date_from: str, date_to: str):
    sid = symbol_id(ticker)
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select date as time, open, high, low, close, volume from price_bars_daily "
            "where symbol_id=? and date between ? and ? order by date", (sid, date_from, date_to))]
    rows = _drop_broken_ohlc(rows)
    # adjust_volume=False: EODHDs /eod-Volumen ist bereits auf die aktuelle
    # Aktienzahl umgerechnet (live geprueft, siehe split_adjust.adjust_bar) -
    # nochmal mit dem Split-Faktor multiplizieren wuerde das Volumen fuer
    # Tage vor einem Split massiv verfaelschen (Doppel-Anpassung).
    return adjust_bars(rows, _load_splits(sid), adjust_volume=False)

def weekly_bars_range(ticker: str, date_from: str, date_to: str):
    sid = symbol_id(ticker)
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select date as time, open, high, low, close, volume from price_bars_weekly "
            "where symbol_id=? and date between ? and ? order by date", (sid, date_from, date_to))]
    rows = _drop_broken_ohlc(rows)
    return adjust_bars(rows, _load_splits(sid), adjust_volume=False)  # siehe daily_bars_range

def indicator_series(bars: list[dict]) -> dict:
    """EMA10/EMA20/SMA50/SMA200 fuer die uebergebenen Kerzen (zeitebenen-nativ:
    auf den Closes DIESER Zeitebene, nicht immer auf Daily-Closes - entspricht
    dem, was TradingView auf einem m5/h1/w1-Chart tatsaechlich zeigt). Nutzt die
    bereits implementierten, getesteten Array-Varianten sma()/ema() aus
    formulas.py. None-Praefix-Eintraege werden entfernt (kein irrefuehrend
    verkuerzter Linienanfang), analog zum sma_last()/ema_last()-None-Schutz."""
    closes = [b['close'] for b in bars]
    times = [b['time'] for b in bars]
    def series(values, times):
        return [{'time': t, 'value': v} for t, v in zip(times, values) if v is not None]
    return {
        'ema10': series(ema(closes, 10), times),
        'ema20': series(ema(closes, 20), times),
        'sma50': series(sma(closes, 50), times),
        'sma200': series(sma(closes, 200), times),
    }

def _daily_before(sid: int, date: str):
    """Abgeschlossene Daily-Kerzen STRIKT vor dem Entry-Tag (kein Look-ahead).
    Split-Rueckrechnung als reine Werteumrechnung NACH der 'date<?'-Auswahl -
    die Zeilenauswahl (und damit der Look-ahead-Schutz) bleibt unveraendert."""
    with conn() as c:
        rows = [dict(r) for r in c.execute(
            "select date, open, high, low, close, volume from price_bars_daily where symbol_id=? and date<? order by date",
            (sid, date))]
    rows = _drop_broken_ohlc(rows)
    return adjust_bars(rows, _load_splits(sid), adjust_volume=False)  # siehe daily_bars_range

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
