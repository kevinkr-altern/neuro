import math

def lod_distance_pct(price: float, low_of_day: float, atr14: float) -> int | None:
    if atr14 is None or atr14 <= 0:
        return None
    return int(math.ceil(((price - low_of_day) / atr14) * 100))

def atr_extension(close: float, ma: float, atr14: float) -> float | None:
    if not ma or not atr14 or not close:
        return None
    return ((close - ma) / ma) / (atr14 / close)

def wilder_atr(rows, period: int = 14):
    """Wilder ATR. Accepts a pandas DataFrame or a list of OHLC dicts."""
    is_pandas = hasattr(rows, 'iloc') and hasattr(rows, '__getitem__')
    highs = list(rows['high']) if is_pandas else [r['high'] for r in rows]
    lows = list(rows['low']) if is_pandas else [r['low'] for r in rows]
    closes = list(rows['close']) if is_pandas else [r['close'] for r in rows]
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
    if is_pandas:
        import pandas as pd
        return pd.Series(atr, index=rows.index)
    return atr

def adr_pct(rows, period: int = 20):
    vals=[((r['high']-r['low'])/r['close'])*100 for r in rows]
    out=[]
    for i in range(len(vals)):
        out.append(None if i+1 < period else sum(vals[i+1-period:i+1])/period)
    return out
