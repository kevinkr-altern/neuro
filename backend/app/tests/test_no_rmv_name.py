import app.indicators.formulas as formulas

def test_no_unsupported_rmv_function_name():
    # rmv15 war eine Eigenerfindung und wurde entfernt.
    assert not hasattr(formulas, 'rmv15')
    # Ersatzfeld ist klar als eigenes Proxy benannt (nicht Deepvue-RMV).
    assert hasattr(formulas, 'volatility_compression_proxy')

def test_volatility_compression_proxy_population_std():
    # Populations-Standardabweichung von (H-L)/C*100 ueber die letzten 15 Kerzen.
    rows = [{'high': 11, 'low': 10, 'close': 10} for _ in range(15)]
    # konstante Spanne 10% -> Standardabweichung 0
    assert formulas.volatility_compression_proxy(rows, 15) == 0.0
    # zu wenige Kerzen -> None (kein stiller Kurz-Wert)
    assert formulas.volatility_compression_proxy(rows[:14], 15) is None
