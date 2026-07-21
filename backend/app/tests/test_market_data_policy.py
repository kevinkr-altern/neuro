from app.core.market_calendar import is_before_m5_history, is_half_trading_day

def test_m5_history_boundary():
    assert is_before_m5_history('2020-09-30') is True
    assert is_before_m5_history('2020-10-01') is False

def test_known_half_day_flag():
    assert is_half_trading_day('2024-07-03') is True
    assert is_half_trading_day('2024-07-05') is False
