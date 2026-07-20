from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from app.core.db import conn, symbol_id
from app.providers.eodhd import fetch_intraday
from app.indicators.formulas import wilder_atr, adr_pct, lod_distance_pct, atr_extension

ET = ZoneInfo('America/New_York')

def _ts(row):
    v = row.get('timestamp') or row.get('datetime') or row.get('date')
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    return datetime.fromisoformat(str(v).replace('Z','+00:00')).astimezone(timezone.utc)

async def ensure_m5(ticker: str, date: str):
    sid = symbol_id(ticker)
    start = int(datetime.fromisoformat(date+'T00:00:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date+'T23:59:59+00:00').timestamp())
    with conn() as c:
        existing = c.execute("select count(*) from price_bars_intraday where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=?", (sid,date)).fetchone()[0]
    if existing == 0:
        rows = await fetch_intraday(ticker if '.' in ticker else f'{ticker}.US', '5m', start, end)
        with conn() as c:
            for r in rows:
                dt = _ts(r); et = dt.astimezone(ET)
                regular = int(et.time().isoformat() >= '09:30:00' and et.time().isoformat() <= '16:00:00')
                c.execute("insert or ignore into price_bars_intraday values(?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp)", (sid, dt.isoformat(), et.isoformat(), '5m', r['open'], r['high'], r['low'], r['close'], r.get('volume',0), regular, None, 'EODHD'))
            if rows:
                c.execute("insert or replace into data_availability(symbol_id,interval,first_available_at,last_available_at,status,message) values(?,?,?,?,?,?)", (sid,'5m',min(_ts(r).isoformat() for r in rows),max(_ts(r).isoformat() for r in rows),'available','Echte m5-Daten gefunden'))
    return sid

def intraday_bars(ticker: str, date: str, timeframe='5m'):
    sid = symbol_id(ticker)
    with conn() as c:
        rows = [dict(r) for r in c.execute("select timestamp_et as time, open, high, low, close, volume from price_bars_intraday where symbol_id=? and interval='5m' and substr(timestamp_utc,1,10)=? order by timestamp_utc", (sid,date))]
    if timeframe == '5m' or not rows: return rows
    n = 3 if timeframe == '15m' else 6
    out=[]
    for i in range(0,len(rows),n):
        chunk=rows[i:i+n]
        if len(chunk)==n:
            out.append({'time':chunk[0]['time'],'open':chunk[0]['open'],'high':max(x['high'] for x in chunk),'low':min(x['low'] for x in chunk),'close':chunk[-1]['close'],'volume':sum(x['volume'] or 0 for x in chunk)})
    return out

def metrics_for_bar(bars, index: int):
    if not bars or index < 0 or index >= len(bars): return {}
    b = bars[index]
    low = min(x['low'] for x in bars[:index+1])
    # ATR fallback for Phase 1 preview until daily API is added: user-visible validity flag marks unavailable.
    return {'selected_price': b['close'], 'low_of_day_so_far': low, 'lod_distance_pct': None, 'lod_distance_valid': False, 'lod_distance_message': 'ATR(14) aus Daily-Daten noch nicht geladen; keine Schätzung.'}
