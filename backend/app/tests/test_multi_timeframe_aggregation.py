"""Mehrtages-/Luecken-Aggregation (M15/M30/H1) - kein Netzwerk. Reine
aggregate_bars()-Tests brauchen keine DB; der Regressionstest am Ende nutzt
eine temporaere SQLite-Datei wie test_metrics_lookahead.py."""
import os, tempfile
os.environ.setdefault('DATABASE_PATH', os.path.join(tempfile.mkdtemp(), 'tf_agg_test.db'))

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from app.services.market_data import aggregate_bars, intraday_bars, _drop_broken_ohlc

ET = ZoneInfo('America/New_York')


def _session_5m(date: str, start='09:30', minutes=390, skip_at=None):
    """Erzeugt eine vollstaendige (oder mit einer Luecke versehene) 5m-Session."""
    rows = []
    t0 = datetime.strptime(f'{date} {start}', '%Y-%m-%d %H:%M')
    for m in range(0, minutes, 5):
        if skip_at is not None and m == skip_at:
            continue
        t = t0 + timedelta(minutes=m)
        rows.append({'time': t.isoformat(), 'open': 10, 'high': 11, 'low': 9, 'close': 10.5, 'volume': 1000})
    return rows


def test_h1_bucketing_anchored_to_open():
    rows = _session_5m('2024-05-01')
    out = aggregate_bars(rows, 60)
    assert len(out) == 7  # 390 min / 60 = 6.5 -> 7 Fenster (letztes unvollstaendig)
    assert out[0]['time'][11:16] == '09:30'
    assert out[0]['incomplete'] is False
    assert out[0]['bars_in_window'] == 12
    assert out[-1]['incomplete'] is True  # letztes Fenster hat nur 6 von 12 Kerzen


def test_gap_marks_incomplete_not_silently_complete():
    rows = _session_5m('2024-05-01', minutes=60, skip_at=15)
    out = aggregate_bars(rows, 30)
    assert len(out) == 2
    assert out[0]['incomplete'] is True  # Fenster 09:30-10:00 fehlt die 09:45-Kerze
    assert out[0]['bars_in_window'] == 5
    assert out[0]['bars_expected'] == 6


def test_multi_day_range_does_not_collide_across_day_boundaries():
    rows = _session_5m('2024-05-01', minutes=60) + _session_5m('2024-05-02', minutes=60)
    out = aggregate_bars(rows, 60)
    assert len(out) == 2  # ein Fenster pro Tag, nicht vermischt
    assert out[0]['time'][:10] == '2024-05-01'
    assert out[1]['time'][:10] == '2024-05-02'


def test_broken_ohlc_row_is_dropped_not_crashing():
    """Live gegen EODHD gefundener Bug: ein breiter mehrjaehriger m5-Abruf kann
    vereinzelt kaputte Platzhalter-Zeilen mit high=None enthalten. Diese duerfen
    weder den Server abstuerzen lassen (aggregate_bars ruft max()/min() auf den
    Feldern auf) noch stillschweigend durch einen erfundenen Wert ersetzt werden -
    sie werden entfernt, wodurch das betroffene Fenster automatisch incomplete wird."""
    rows = _session_5m('2024-05-01', minutes=30)
    rows[2]['high'] = None  # dritte 5m-Kerze ist kaputt/Platzhalter
    cleaned = _drop_broken_ohlc(rows)
    assert len(cleaned) == len(rows) - 1
    out = aggregate_bars(rows, 30)  # darf NICHT werfen
    assert len(out) == 1
    assert out[0]['incomplete'] is True
    assert out[0]['bars_in_window'] == 5  # 6 erwartet, 1 kaputte Zeile entfernt


def test_half_day_session_length_respected_per_row_date():
    # 2024-07-03 ist ein Halbtag (13:00 ET Schluss) -> 210 min Session.
    full_day = _session_5m('2024-05-01', minutes=390)
    half_day = _session_5m('2024-07-03', minutes=390)  # mehr Kerzen als am Halbtag erlaubt
    out = aggregate_bars(full_day + half_day, 30)
    half_day_windows = [b for b in out if b['time'][:10] == '2024-07-03']
    # 210 min Session / 30 = 7 Fenster; Kerzen nach 13:00 muessen ignoriert sein.
    assert len(half_day_windows) == 7


def test_intraday_bars_refactor_matches_pre_refactor_output(monkeypatch):
    """Regressionstest: intraday_bars() (Einzeltag, cutoff-geschuetzter Pfad)
    liefert nach dem internen Refactor auf aggregate_bars() exakt dieselbe
    Ausgabe wie die alte, manuell inline geschriebene Bucket-Logik."""
    from app.core.db import init_db
    from app.services import market_data as md
    init_db()

    fake_rows = _session_5m('2024-05-01', minutes=90)
    monkeypatch.setattr(md, '_regular_intraday', lambda sid, date, cutoff: fake_rows)

    def old_logic(rows, date, size):
        expected = size // 5
        session_len = md._session_length_min(date)
        buckets = {}
        for r in rows:
            m = md._mins_since_open(r['time'])
            if m >= session_len:
                continue
            buckets.setdefault(m // size, []).append(r)
        out = []
        for idx in sorted(buckets):
            chunk = sorted(buckets[idx], key=lambda x: x['time'])
            complete = len(chunk) == expected
            out.append({
                'time': chunk[0]['time'], 'open': chunk[0]['open'],
                'high': max(x['high'] for x in chunk), 'low': min(x['low'] for x in chunk),
                'close': chunk[-1]['close'], 'volume': sum((x['volume'] or 0) for x in chunk),
                'incomplete': not complete,
                'bars_in_window': len(chunk), 'bars_expected': expected,
            })
        return out

    for tf, size in (('15m', 15), ('30m', 30)):
        expected_old = old_logic(fake_rows, '2024-05-01', size)
        actual_new = intraday_bars('NVDA', '2024-05-01', tf, None)
        assert actual_new == expected_old
