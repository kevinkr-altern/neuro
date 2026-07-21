"""Coverage-Luecken-Berechnung fuer inkrementelles Daily-/Weekly-/M5-Range-
Nachladen - reine Funktion, kein Netzwerk, keine DB."""
from app.services.market_data import coverage_gaps


def test_no_cache_yet_wants_full_range():
    assert coverage_gaps(None, None, '2020-01-01', '2020-12-31') == [('2020-01-01', '2020-12-31')]


def test_fully_covered_returns_no_gaps():
    assert coverage_gaps('2015-01-01', '2024-01-01', '2020-01-01', '2020-12-31') == []


def test_gap_before_cached_range():
    gaps = coverage_gaps('2020-01-01', '2024-01-01', '2015-01-01', '2024-01-01')
    assert gaps == [('2015-01-01', '2019-12-31')]


def test_gap_after_cached_range():
    gaps = coverage_gaps('2015-01-01', '2020-01-01', '2015-01-01', '2024-01-01')
    assert gaps == [('2020-01-02', '2024-01-01')]


def test_gaps_on_both_sides():
    gaps = coverage_gaps('2018-01-01', '2019-01-01', '2015-01-01', '2024-01-01')
    assert gaps == [('2015-01-01', '2017-12-31'), ('2019-01-02', '2024-01-01')]


def test_reversed_range_is_empty():
    assert coverage_gaps(None, None, '2024-01-01', '2015-01-01') == []
