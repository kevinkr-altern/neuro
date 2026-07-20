from app.indicators.formulas import (
    lod_distance_pct, atr_extension, wilder_atr, sma_last, ema_last,
    adr_pct_last, volatility_compression_proxy,
)

def test_lod_distance_reference_example():
    assert lod_distance_pct(24.49, 22.16, 2.25) == 104

def test_lod_distance_rounds_up_not_commercial():
    # 100,1% muss zu 101% werden, exakt 100% bleibt 100%.
    assert lod_distance_pct(1.001, 0, 1.0) == 101
    assert lod_distance_pct(1.0, 0, 1.0) == 100

def test_lod_distance_needs_atr():
    assert lod_distance_pct(10, 9, 0) is None
    assert lod_distance_pct(10, 9, None) is None

def test_atr_extension_percent_normalized():
    # Prozent-normiert = 2.2 (die vereinfachte Form (close-ma)/atr waere 2.0).
    assert round(atr_extension(110, 100, 5), 2) == 2.2

def test_wilder_atr_seeding_and_gap():
    rows = [{'high': 10, 'low': 8, 'close': 9} for _ in range(15)]
    atr = wilder_atr(rows, 14)
    assert atr[12] is None and round(atr[13], 4) == 2.0

def test_sma_ema_guards():
    vals = list(range(1, 60))
    assert sma_last(vals, 50) is not None
    assert sma_last(vals, 200) is None  # kein stiller Kurz-Durchschnitt
    assert ema_last(vals, 10) is not None
    assert ema_last(vals, 100) is None

def test_adr_pct_last_guard():
    rows = [{'high': 11, 'low': 10, 'close': 10} for _ in range(10)]
    assert adr_pct_last(rows, 20) is None
    assert round(adr_pct_last(rows, 5), 4) == 10.0  # (11-10)/10*100

def test_volatility_compression_proxy_is_population_std():
    rows = [{'high': 11, 'low': 10, 'close': 10} for _ in range(15)]
    assert volatility_compression_proxy(rows, 15) == 0.0
