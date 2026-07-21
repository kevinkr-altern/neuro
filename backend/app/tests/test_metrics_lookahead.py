"""Look-ahead- und Cutoff-Verhalten deterministisch, ohne Netzwerk."""
import os, tempfile
os.environ.setdefault('DATABASE_PATH', os.path.join(tempfile.mkdtemp(), 'metrics_test.db'))

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.core.db import init_db, conn, symbol_id
from app.services import market_data as md

ET = ZoneInfo('America/New_York')

def _seed():
    init_db()
    sid = symbol_id('TEST')
    with conn() as c:
        c.execute("delete from price_bars_intraday where symbol_id=?", (sid,))
        c.execute("delete from price_bars_daily where symbol_id=?", (sid,))
        # 20 Daily-Kerzen bis Vortag (2021-10-04 .. 2021-10-29), plus Entry-Tag 2021-11-01
        base = datetime(2021, 10, 4)
        for i in range(20):
            d = (base + timedelta(days=i)).strftime('%Y-%m-%d')
            c.execute("insert into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)",
                      (sid, d, 100, 105, 99, 100 + i, 100 + i, 1_000_000, 'T'))
        # Entry-Tag-Daily (darf NICHT in Vortags-Kennzahlen einfliessen)
        c.execute("insert into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)",
                  (sid, '2021-11-01', 200, 999, 1, 500, 500, 9_000_000, 'T'))
        # Intraday 09:30..10:30 ET in 5-min-Schritten am Entry-Tag
        for k in range(13):
            et = datetime(2021, 11, 1, 9, 30, tzinfo=ET) + timedelta(minutes=5 * k)
            utc = et.astimezone(ZoneInfo('UTC'))
            low = 90 - k  # Tief faellt im Tagesverlauf weiter
            c.execute("insert into price_bars_intraday values(?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp)",
                      (sid, utc.isoformat(), et.isoformat(), '5m', 100, 101, low, 100 + k, 10000, 1, None, 'T'))
    return sid

def test_cutoff_limits_bars_and_lod():
    _seed()
    early = md.compute_metrics('TEST', '2021-11-01', '09:45:00')
    late = md.compute_metrics('TEST', '2021-11-01', '10:30:00')
    # Bis 09:45 gibt es 4 Kerzen (09:30,35,40,45); LoD ist deren Minimum, nicht das Ganztages-Tief.
    assert early['low_of_day_so_far'] > late['low_of_day_so_far']

def test_daily_indicators_exclude_entry_day():
    _seed()
    m = md.compute_metrics('TEST', '2021-11-01', '10:30:00')
    # Der manipulierte Entry-Tag (High 999/Low 1) darf PDH/PDL nicht beeinflussen.
    assert m['pdh'] == 105 and m['pdl'] == 99

def test_orb_validity_by_time():
    _seed()
    early = md.compute_metrics('TEST', '2021-11-01', '09:45:00')
    late = md.compute_metrics('TEST', '2021-11-01', '10:30:00')
    assert early['orb_m30_valid'] is False  # 09:45 -> ORB m30 noch nicht bekannt
    assert late['orb_m30_valid'] is True
