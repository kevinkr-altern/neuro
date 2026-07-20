import math
from statistics import mean, pstdev

def lod_distance_pct(price: float, low_of_day: float, atr14: float) -> int | None:
    if atr14 is None or atr14 <= 0:
        return None
    return int(math.ceil(((price - low_of_day) / atr14) * 100))

def atr_extension(close: float, ma: float, atr14: float) -> float | None:
    if not ma or not atr14 or not close:
        return None
    return ((close - ma) / ma) / (atr14 / close)

def sma(values, period: int):
    out=[]
    for i in range(len(values)):
        out.append(None if i + 1 < period else mean(values[i+1-period:i+1]))
    return out

def ema(values, period: int):
    out=[]; k=2/(period+1); current=None
    for v in values:
        if v is None:
            out.append(None); continue
        current = v if current is None else (v*k + current*(1-k))
        out.append(current)
    return out

def wilder_atr(rows, period: int = 14):
    highs = [r['high'] for r in rows]
    lows = [r['low'] for r in rows]
    closes = [r['close'] for r in rows]
    trs=[]
    for i,(h,l) in enumerate(zip(highs,lows)):
        if i == 0:
            trs.append(abs(h-l))
        else:
            pc=closes[i-1]
            trs.append(max(abs(h-l), abs(h-pc), abs(l-pc)))
    atr=[None]*len(trs)
    if len(trs) >= period:
        atr[period-1] = sum(trs[:period]) / period
        for i in range(period, len(trs)):
            atr[i] = ((atr[i-1] * (period - 1)) + trs[i]) / period
    return atr

def adr_pct(rows, period: int = 20):
    vals=[((r['high']-r['low'])/r['close'])*100 if r.get('close') else None for r in rows]
    out=[]
    for i in range(len(vals)):
        win=[v for v in vals[i+1-period:i+1] if v is not None]
        out.append(None if i + 1 < period or len(win) < period else mean(win))
    return out

def rvol(current_volume: float, avg_volume: float) -> float | None:
    if not avg_volume or avg_volume <= 0:
        return None
    return current_volume / avg_volume

def rmv15(rows):
    ranges=[((r['high']-r['low'])/r['close'])*100 for r in rows if r.get('close')]
    if len(ranges) < 15:
        return None
    base=ranges[-15:]
    return pstdev(base)

def distance_pct(price: float, anchor: float | None) -> float | None:
    if not anchor:
        return None
    return ((price - anchor) / anchor) * 100

def enrich_daily(rows):
    closes=[r['close'] for r in rows]
    for key, vals in [('ema10', ema(closes,10)),('ema20', ema(closes,20)),('ema21', ema(closes,21)),('sma50', sma(closes,50)),('sma100', sma(closes,100)),('sma200', sma(closes,200)),('atr14', wilder_atr(rows,14)),('adr20', adr_pct(rows,20)),('adr14', adr_pct(rows,14))]:
        for r,v in zip(rows, vals): r[key]=v
    for r in rows:
        c=r['close']; atr=r.get('atr14')
        r['atr_pct']=distance_pct(atr+c, c) if atr else None
        for ma in ['ema10','ema20','ema21','sma50','sma100','sma200']:
            r[f'dist_{ma}_pct']=distance_pct(c, r.get(ma))
        r['atr_ext_sma50']=atr_extension(c, r.get('sma50'), atr)
        r['atr_ext_ema10']=atr_extension(c, r.get('ema10'), atr)
        r['atr_ext_ema21']=atr_extension(c, r.get('ema21'), atr)
    return rows
