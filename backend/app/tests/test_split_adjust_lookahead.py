"""Split-Rueckrechnung darf den Look-ahead-Schutz nicht veraendern: ein Split
NACH dem Entry-Tag darf nur die Zahlenwerte skalieren, niemals die Menge/
Reihenfolge der von _daily_before()/_regular_intraday() zurueckgegebenen
Zeilen. Selbes Seed-Muster wie test_metrics_lookahead.py, eigener Ticker."""
import os, tempfile
os.environ.setdefault('DATABASE_PATH', os.path.join(tempfile.mkdtemp(), 'split_lookahead_test.db'))

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.core.db import init_db, conn, symbol_id
from app.services import market_data as md

ET = ZoneInfo('America/New_York')


def _seed(with_later_split: bool):
    init_db()
    sid = symbol_id('SPLITTEST')
    with conn() as c:
        c.execute("delete from price_bars_intraday where symbol_id=?", (sid,))
        c.execute("delete from price_bars_daily where symbol_id=?", (sid,))
        c.execute("delete from splits_history where symbol_id=?", (sid,))
        base = datetime(2021, 10, 4)
        for i in range(20):
            d = (base + timedelta(days=i)).strftime('%Y-%m-%d')
            c.execute("insert into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)",
                      (sid, d, 100, 105, 99, 100 + i, 100 + i, 1_000_000, 'T'))
        c.execute("insert into price_bars_daily values(?,?,?,?,?,?,?,?,?,current_timestamp)",
                  (sid, '2021-11-01', 200, 999, 1, 500, 500, 9_000_000, 'T'))
        for k in range(13):
            et = datetime(2021, 11, 1, 9, 30, tzinfo=ET) + timedelta(minutes=5 * k)
            utc = et.astimezone(ZoneInfo('UTC'))
            c.execute("insert into price_bars_intraday values(?,?,?,?,?,?,?,?,?,?,?,?,current_timestamp)",
                      (sid, utc.isoformat(), et.isoformat(), '5m', 100, 101, 90 - k, 100 + k, 10000, 1, None, 'T'))
        if with_later_split:
            # Split weit NACH dem Entry-Tag - darf nur Werte skalieren, nie die Zeilenauswahl.
            c.execute("insert into splits_history values(?,?,?,?,?,current_timestamp)", (sid, '2024-01-01', 2.0, '2/1', 'T'))
    return sid


def test_daily_before_row_selection_unchanged_by_later_split():
    _seed(with_later_split=False)
    without = md._daily_before(symbol_id('SPLITTEST'), '2021-11-01')
    _seed(with_later_split=True)
    with_split = md._daily_before(symbol_id('SPLITTEST'), '2021-11-01')
    assert [r['date'] for r in without] == [r['date'] for r in with_split]
    assert len(without) == 20
    # Werte SIND skaliert (durch 2 wegen des spaeteren Splits).
    assert with_split[0]['close'] == without[0]['close'] / 2


def test_regular_intraday_row_selection_unchanged_by_later_split():
    _seed(with_later_split=False)
    without = md._regular_intraday(symbol_id('SPLITTEST'), '2021-11-01', '10:00:00')
    _seed(with_later_split=True)
    with_split = md._regular_intraday(symbol_id('SPLITTEST'), '2021-11-01', '10:00:00')
    assert [r['time'] for r in without] == [r['time'] for r in with_split]
    assert with_split[0]['close'] == without[0]['close'] / 2


def test_compute_metrics_pdh_pdl_scale_but_lod_distance_pct_invariant():
    """Absolute $-Werte (PDH/PDL) skalieren mit dem Split; prozentbasierte
    Kennzahlen (LoD-Distance%) sind unter gleichmaessiger Skalierung invariant."""
    _seed(with_later_split=False)
    without = md.compute_metrics('SPLITTEST', '2021-11-01', '10:30:00')
    _seed(with_later_split=True)
    with_split = md.compute_metrics('SPLITTEST', '2021-11-01', '10:30:00')
    assert with_split['pdh'] == without['pdh'] / 2
    assert with_split['pdl'] == without['pdl'] / 2
    assert with_split['lod_distance_pct'] == without['lod_distance_pct']
