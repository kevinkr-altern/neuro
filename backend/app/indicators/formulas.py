import math

def lod_distance_pct(price: float, low_of_day: float, atr14: float) -> int | None:
    """LoD-Distance in Prozent, immer aufgerundet (nicht kaufmaennisch)."""
    if atr14 is None or atr14 <= 0 or price is None or low_of_day is None:
        return None
    return int(math.ceil(((price - low_of_day) / atr14) * 100))

def atr_extension(close: float, ma: float, atr14: float) -> float | None:
    """Prozent-normierte ATR-Extension: [(Close-MA)/MA] / [ATR/Close]."""
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

def wilder_atr_last(rows, period: int = 14) -> float | None:
    """Letzter gueltiger Wilder-ATR-Wert oder None, wenn zu wenige Kerzen."""
    vals = wilder_atr(rows, period)
    vals = list(vals) if not isinstance(vals, list) else vals
    for v in reversed(vals):
        if v is not None:
            return v
    return None

def adr_pct(rows, period: int = 20):
    """Trailing-Durchschnitt der prozentualen Tagesspanne (Durchschnitt der Prozentwerte)."""
    vals=[((r['high']-r['low'])/r['close'])*100 for r in rows]
    out=[]
    for i in range(len(vals)):
        out.append(None if i+1 < period else sum(vals[i+1-period:i+1])/period)
    return out

def adr_pct_last(rows, period: int = 20) -> float | None:
    """Letzter ADR%-Wert; None wenn weniger als `period` Kerzen vorliegen."""
    if len(rows) < period:
        return None
    return adr_pct(rows, period)[-1]

def sma(values, period: int):
    """Simple Moving Average. Gibt Liste zurueck, None bis genug Werte vorliegen."""
    out=[]
    for i in range(len(values)):
        out.append(None if i+1 < period else sum(values[i+1-period:i+1])/period)
    return out

def sma_last(values, period: int) -> float | None:
    """Letzter SMA-Wert. None wenn weniger als `period` Werte vorliegen (kein stiller Kurz-Durchschnitt)."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period

def ema(values, period: int):
    """EMA mit SMA-Seed ueber die ersten `period` Werte. None bis Seed vorhanden."""
    out=[None]*len(values)
    if len(values) < period:
        return out
    seed = sum(values[:period]) / period
    out[period-1] = seed
    k = 2 / (period + 1)
    prev = seed
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out

def ema_last(values, period: int) -> float | None:
    """Letzter EMA-Wert. None wenn weniger als `period` Werte vorliegen."""
    if len(values) < period:
        return None
    e = ema(values, period)
    return e[-1]

def volatility_compression_proxy(rows, period: int = 15) -> float | None:
    """Eigenes Feld (NICHT Deepvue-RMV): Populations-Standardabweichung von
    (High - Low) / Close * 100 ueber die letzten `period` Daily-Kerzen.
    None, wenn weniger als `period` Kerzen vorliegen."""
    if len(rows) < period:
        return None
    win = rows[-period:]
    vals = [((r['high']-r['low'])/r['close'])*100 for r in win]
    mean = sum(vals) / len(vals)
    var = sum((v-mean)**2 for v in vals) / len(vals)  # population variance
    return math.sqrt(var)
