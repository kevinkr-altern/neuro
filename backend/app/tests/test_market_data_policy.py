from app.core.market_calendar import is_before_platform_5m_floor, is_half_trading_day

def test_m5_search_floor_is_a_lower_bound_not_an_answer():
    # Dies ist nur eine sichere Suchuntergrenze fuer die pro-Ticker-Startsuche
    # (market_data.find_earliest_available), keine Behauptung ueber einen
    # konkreten Ticker.
    assert is_before_platform_5m_floor('2020-08-31') is True
    assert is_before_platform_5m_floor('2020-09-01') is False

def test_known_half_day_flag():
    assert is_half_trading_day('2024-07-03') is True
    assert is_half_trading_day('2024-07-05') is False
