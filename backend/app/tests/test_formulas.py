from app.indicators.formulas import lod_distance_pct, atr_extension, wilder_atr

def test_lod_distance_reference_example():
    assert lod_distance_pct(24.49, 22.16, 2.25) == 104

def test_atr_extension_reference_shape():
    assert round(atr_extension(110, 100, 5), 2) == 2.2

def test_wilder_atr_returns_values():
    rows = [{'high':h, 'low':9, 'close':c} for h,c in zip(range(10,25), [9.5,10,11,12,13,14,15,16,17,18,19,20,21,22,23])]
    assert sum(x is not None for x in wilder_atr(rows)) >= 1
