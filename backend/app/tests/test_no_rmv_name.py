import app.indicators.formulas as formulas

def test_no_unsupported_rmv_function_name():
    assert not hasattr(formulas, 'rmv15')
    assert hasattr(formulas, 'volatility_compression_proxy')
