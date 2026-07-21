"""Bisektions-Algorithmus fuer die echte M5-Startsuche - reine Funktion,
injizierter Fake-Probe, kein Netzwerk, kein API-Key noetig."""
import asyncio
from datetime import date
from app.services.market_data import find_earliest_available


def _run(coro):
    return asyncio.run(coro)


def test_finds_exact_transition_date():
    cutoff = date(2021, 3, 15)
    calls = []

    async def fake_probe(d):
        calls.append(d)
        return d >= cutoff

    result = _run(find_earliest_available(fake_probe, date(2018, 1, 1), date(2024, 1, 1)))
    assert (result - cutoff).days <= 7  # 7-Tage-Sondierungsfenster: Ergebnis darf bis zu 7 Tage abweichen
    assert result >= cutoff  # aber niemals VOR der echten Verfuegbarkeit liegen (kein false positive)


def test_call_count_is_logarithmic_not_linear():
    cutoff = date(2020, 6, 1)

    async def fake_probe(d):
        return d >= cutoff

    calls = {'n': 0}

    async def counting_probe(d):
        calls['n'] += 1
        return await fake_probe(d)

    _run(find_earliest_available(counting_probe, date(2015, 1, 1), date(2024, 1, 1)))
    # ~3287 Tage / 7 -> log2(470) ~ 9, plus die 2 Rand-Pruefungen. Klar sub-linear.
    assert calls['n'] < 20


def test_low_already_available_returns_low_immediately():
    async def always_true(d):
        return True

    low = date(2015, 1, 1)
    result = _run(find_earliest_available(always_true, low, date(2024, 1, 1)))
    assert result == low


def test_no_data_even_at_high_returns_none():
    async def always_false(d):
        return False

    result = _run(find_earliest_available(always_false, date(2015, 1, 1), date(2024, 1, 1)))
    assert result is None
