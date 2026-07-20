EARLY_CLOSE_DATES = {'2020-11-27','2020-12-24','2021-11-26','2022-11-25','2023-07-03','2023-11-24','2024-07-03','2024-11-29','2025-07-03','2025-11-28','2026-07-02','2026-11-27'}

def is_half_trading_day(date: str) -> bool:
    return date in EARLY_CLOSE_DATES

# EODHD dokumentiert die Intraday-Historie (5m/1h) als "ab Oktober 2020" auf
# Plattform-Ebene. Das ist keine Garantie pro Ticker (junge Ticker haben oft
# viel weniger Historie) - deshalb ist das hier nur eine sichere untere
# Suchgrenze fuer die echte, pro-Ticker-verifizierte Startsuche
# (market_data.find_earliest_available), nicht die Antwort selbst.
PLATFORM_5M_SEARCH_FLOOR = '2020-09-01'

def is_before_platform_5m_floor(date: str) -> bool:
    return date < PLATFORM_5M_SEARCH_FLOOR
