"""Split-Rueckrechnung - reine Funktionen, kein Netzwerk."""
import pytest
from app.services.split_adjust import parse_split_ratio, cumulative_factor_after, adjust_bar, adjust_bars


def test_parse_split_ratio_forward_and_reverse():
    assert parse_split_ratio('4.000000/1.000000') == 4.0
    assert parse_split_ratio('1.000000/10.000000') == 0.1
    assert parse_split_ratio('2/1') == 2.0


def test_parse_split_ratio_malformed_raises():
    with pytest.raises(ValueError):
        parse_split_ratio('nicht-ein-split')
    with pytest.raises(ValueError):
        parse_split_ratio('4/0')


def test_cumulative_factor_after_multiple_splits():
    splits = [{'split_date': '2020-01-01', 'ratio': 2.0}, {'split_date': '2022-01-01', 'ratio': 4.0}]
    assert cumulative_factor_after('2019-06-01', splits) == 8.0
    assert cumulative_factor_after('2021-01-01', splits) == 4.0
    assert cumulative_factor_after('2023-01-01', splits) == 1.0
    # Split-Datum selbst zaehlt NICHT als "danach" (strikt >).
    assert cumulative_factor_after('2020-01-01', splits) == 4.0


def test_adjust_bar_scales_ohlc_and_volume():
    bar = {'date': '2019-01-01', 'open': 100, 'high': 110, 'low': 90, 'close': 105, 'volume': 1000}
    out = adjust_bar(bar, 2.0)
    assert out == {'date': '2019-01-01', 'open': 50, 'high': 55, 'low': 45, 'close': 52.5, 'volume': 2000}
    # Original unveraendert (nicht-mutierend).
    assert bar['open'] == 100


def test_adjust_bar_factor_one_is_fast_path_unchanged_identity():
    bar = {'open': 100, 'high': 110, 'low': 90, 'close': 105, 'volume': 1000}
    assert adjust_bar(bar, 1.0) is bar


def test_adjust_bars_no_splits_is_noop():
    bars = [{'date': '2020-01-01', 'open': 1, 'high': 2, 'low': 0.5, 'close': 1.5, 'volume': 10}]
    assert adjust_bars(bars, []) is bars


def test_continuity_regression_removes_the_reported_cliff():
    """Der konkrete Nutzer-Fund: zwei aufeinanderfolgende Tage ueber einen
    synthetischen 2:1-Split hinweg muessen nach der Rueckrechnung stetig sein,
    nicht mit einer kuenstlichen Kurs-Klippe."""
    splits = [{'split_date': '2024-06-10', 'ratio': 2.0}]
    day_before = {'date': '2024-06-07', 'open': 198, 'high': 202, 'low': 197, 'close': 200, 'volume': 1000}
    day_of = {'date': '2024-06-10', 'open': 100, 'high': 101, 'low': 99, 'close': 100.5, 'volume': 2000}
    adjusted = adjust_bars([day_before, day_of], splits)
    # Tag vor dem Split wird durch 2 geteilt (100), Tag danach unveraendert -> stetig statt einer Kluft.
    assert adjusted[0]['close'] == 100.0
    assert adjusted[1]['close'] == 100.5
    assert abs(adjusted[0]['close'] - adjusted[1]['open']) < 1  # keine kuenstliche Kluft mehr


def test_intraday_row_shape_uses_time_prefix_as_date():
    """Intraday-Zeilen haben 'time' als ISO-Zeitstempel statt 'date' - die
    ersten 10 Zeichen muessen als Datum fuer den Split-Vergleich reichen."""
    splits = [{'split_date': '2024-06-10', 'ratio': 2.0}]
    bar = {'time': '2024-06-07T09:30:00-04:00', 'open': 200, 'high': 200, 'low': 200, 'close': 200, 'volume': 100}
    out = adjust_bars([bar], splits)
    assert out[0]['close'] == 100.0
