from app.indicators.formulas import lod_distance_pct, atr_extension, wilder_atr, sma, ema, enrich_daily

def test_lod_distance_reference_example():
    assert lod_distance_pct(24.49, 22.16, 2.25) == 104

def test_atr_extension_reference_shape():
    assert round(atr_extension(110, 100, 5), 2) == 2.2

def test_wilder_atr_returns_values():
    rows = [{'high':h, 'low':9, 'close':c} for h,c in zip(range(10,25), [9.5,10,11,12,13,14,15,16,17,18,19,20,21,22,23])]
    assert sum(x is not None for x in wilder_atr(rows)) >= 1

def test_sma_and_ema_lengths():
    values=list(range(1,21))
    assert len(sma(values, 10)) == 20
    assert len(ema(values, 10)) == 20
    assert sma(values, 10)[8] is None
    assert sma(values, 10)[9] == 5.5

def test_enrich_daily_adds_required_fields():
    rows=[{'date':f'2024-01-{i:02d}', 'open':i, 'high':i+1, 'low':i-1, 'close':i, 'volume':1000} for i in range(1,221)]
    out=enrich_daily(rows)
    assert out[-1]['sma50'] is not None
    assert out[-1]['sma200'] is not None
    assert out[-1]['atr_ext_sma50'] is not None
