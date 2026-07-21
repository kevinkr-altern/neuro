from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from app.core.db import conn, symbol_id
from app.providers.eodhd import fetch_intraday, fetch_daily
from app.indicators.formulas import enrich_daily, lod_distance_pct, rvol
from app.core.market_calendar import is_before_m5_history, is_half_trading_day
from app.core.timeframes import aggregate_weekly

ET = ZoneInfo('America/New_York')

def _parse_ts(row):
    v = row.get('timestamp') or row.get('datetime') or row.get('date')
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    return datetime.fromisoformat(str(v).replace('Z','+00:00')).astimezone(timezone.utc)

def _eod_symbol(ticker: str):
    return ticker.upper() if '.' in ticker else f'{ticker.upper()}.US'

async def ensure_daily(ticker: str, through_date: str, lookback_days: int = 3650):
    sid = symbol_id(ticker)
    end = datetime.fromisoformat(through_date).date()
    start = end - timedelta(days=lookback_days)
    with conn() as c:
        existing = c.execute("select count(*) from price_bars_daily where symbol_id=? and date between ? and ?", (sid, start.isoformat(), end.isoformat())).fetchone()[0]
    if existing < 200:
        rows = await fetch_daily(_eod_symbol(ticker), start.isoformat(), end.isoformat())
        with conn() as c:
            for r in rows:
                c.execute("insert or replace into price_bars_daily(symbol_id,date,open,high,low,close,adjusted_close,volume,source) values(?,?,?,?,?,?,?,?,?)", (sid, r['date'], r['open'], r['high'], r['low'], r['close'], r.get('adjusted_close'), r.get('volume',0), 'EODHD'))
    return sid

async def ensure_m5(ticker: str, date: str):
    sid = symbol_id(ticker)
    start = int(datetime.fromisoformat(date+'T00:00:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date+'T23:59:59+00:00').timestamp())
    with conn() as c:
        existing = c.execute("select count(*) from price_bars_intraday where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=?", (sid,date)).fetchone()[0]
    if existing == 0:
        rows = await fetch_intraday(_eod_symbol(ticker), '5m', start, end)
        with conn() as c:
            for r in rows:
                dt = _parse_ts(r); et = dt.astimezone(ET)
                t = et.time().isoformat()
                regular = int(t >= '09:30:00' and t <= '16:00:00')
                c.execute("insert or ignore into price_bars_intraday(symbol_id,timestamp_utc,timestamp_et,interval,open,high,low,close,volume,is_regular_session,is_half_day,derived_from_interval,source) values(?,?,?,?,?,?,?,?,?,?,?,?,?)", (sid, dt.isoformat(), et.isoformat(), '5m', r['open'], r['high'], r['low'], r['close'], r.get('volume',0), regular, int(is_half_trading_day(date)), None, 'EODHD'))
            status='available' if rows else 'missing'
            msg='Echte m5-Daten gefunden' if rows else 'Keine echten m5-Kerzen gefunden; keine künstlichen Daten erzeugt'
            c.execute("insert or replace into data_availability(symbol_id,interval,first_available_at,last_available_at,status,message) values(?,?,?,?,?,?)", (sid,'5m',min([_parse_ts(r).isoformat() for r in rows], default=None),max([_parse_ts(r).isoformat() for r in rows], default=None),status,msg))
    return sid

def daily_bars(ticker: str, through_date: str, playback: bool = True, timeframe: str = 'daily'):
    sid = symbol_id(ticker)
    with conn() as c:
        rows=[dict(r) for r in c.execute("select date, open, high, low, close, adjusted_close, volume from price_bars_daily where symbol_id=? and date <= ? order by date", (sid, through_date))]
    enriched=enrich_daily(rows)
    return aggregate_weekly(rows, enrich_daily) if timeframe == 'weekly' else enriched

def intraday_bars(ticker: str, date: str, timeframe='5m', cutoff_time: str | None = None):
    sid = symbol_id(ticker)
    with conn() as c:
        rows = [dict(r) for r in c.execute("select timestamp_et as time, open, high, low, close, volume from price_bars_intraday where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=? order by timestamp_utc", (sid,date))]
    if cutoff_time:
        rows=[r for r in rows if r['time'][11:19] <= cutoff_time]
    if timeframe == '5m' or not rows:
        return rows
    n = {'15m': 3, '30m': 6, '1h': 12}.get(timeframe, 6)
    out=[]
    for i in range(0,len(rows),n):
        chunk=rows[i:i+n]
        if len(chunk)==n:
            out.append({'time':chunk[0]['time'],'open':chunk[0]['open'],'high':max(x['high'] for x in chunk),'low':min(x['low'] for x in chunk),'close':chunk[-1]['close'],'volume':sum(x['volume'] or 0 for x in chunk)})
    return out

def metrics_for_bar(intraday, daily, index: int):
    if not intraday or index < 0 or index >= len(intraday):
        return {'valid': False, 'message': 'Keine Kerze selektiert'}
    b=intraday[index]
    d=daily[-1] if daily else {}
    prev=daily[-2] if len(daily) >= 2 else {}
    low_so_far=min(x['low'] for x in intraday[:index+1])
    volume_so_far=sum((x.get('volume') or 0) for x in intraday[:index+1])
    avg_vol50=None
    if len(daily) > 51:
        vols=[x.get('volume') or 0 for x in daily[-51:-1]]
        avg_vol50=sum(vols)/len(vols)
    return {
        'selected_price': b['close'],
        'low_of_day_so_far': low_so_far,
        'atr14_dollars': prev.get('atr14'),
        'atr_pct': prev.get('atr_pct'),
        'lod_distance_pct': lod_distance_pct(b['close'], low_so_far, prev.get('atr14')) if prev.get('atr14') else None,
        'lod_distance_valid': bool(prev.get('atr14')),
        'lod_rule_valid': None if not prev.get('atr14') else lod_distance_pct(b['close'], low_so_far, prev.get('atr14')) <= 70,
        'adr20_pct': prev.get('adr20'),
        'adr14_pct': prev.get('adr14'),
        'rvol_projected': rvol(volume_so_far, avg_vol50),
        'atr_ext_sma50': prev.get('atr_ext_sma50'),
        'atr_ext_ema10': prev.get('atr_ext_ema10'),
        'atr_ext_ema21': prev.get('atr_ext_ema21'),
        'dist_ema10_pct': prev.get('dist_ema10_pct'),
        'dist_ema20_pct': prev.get('dist_ema20_pct'),
        'dist_sma50_pct': prev.get('dist_sma50_pct'),
        'dist_sma100_pct': prev.get('dist_sma100_pct'),
        'dist_sma200_pct': prev.get('dist_sma200_pct'),
        'gap_pct': ((intraday[0]['open'] - prev['close']) / prev['close'] * 100) if prev.get('close') and intraday else None,
        'pdh': prev.get('high'),
        'pdl': prev.get('low'),
        'validity': {'intraday': True, 'daily_atr': bool(prev.get('atr14')), 'no_imputation': True}
    }


def metrics_for_daily_bar(rows, index: int):
    if not rows or index < 0 or index >= len(rows):
        return {'valid': False, 'message': 'Keine Kerze selektiert'}
    b=rows[index]
    prev=rows[index-1] if index > 0 else {}
    return {
        'selected_price': b.get('close'),
        'atr14_dollars': b.get('atr14'),
        'atr_pct': b.get('atr_pct'),
        'adr20_pct': b.get('adr20'),
        'adr14_pct': b.get('adr14'),
        'atr_ext_sma50': b.get('atr_ext_sma50'),
        'atr_ext_ema10': b.get('atr_ext_ema10'),
        'atr_ext_ema21': b.get('atr_ext_ema21'),
        'dist_ema10_pct': b.get('dist_ema10_pct'),
        'dist_ema20_pct': b.get('dist_ema20_pct'),
        'dist_sma50_pct': b.get('dist_sma50_pct'),
        'dist_sma100_pct': b.get('dist_sma100_pct'),
        'dist_sma200_pct': b.get('dist_sma200_pct'),
        'pdh': prev.get('high'),
        'pdl': prev.get('low'),
        'volume': b.get('volume'),
        'validity': {'daily': True, 'no_imputation': True}
    }
