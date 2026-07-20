EARLY_CLOSE_DATES = {'2020-11-27','2020-12-24','2021-11-26','2022-11-25','2023-07-03','2023-11-24','2024-07-03','2024-11-29','2025-07-03','2025-11-28','2026-07-02','2026-11-27'}

def is_half_trading_day(date: str) -> bool:
    return date in EARLY_CLOSE_DATES

def is_before_m5_history(date: str) -> bool:
    return date < '2020-10-01'
