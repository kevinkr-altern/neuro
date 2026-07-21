"""Live-Test gegen die echte EODHD-API - nur ausgefuehrt, wenn ein echter
Key gesetzt ist (uebersprungen in normalen CI-losen Laeufen ohne Key)."""
import os
import pytest
import asyncio

pytestmark = pytest.mark.skipif(
    not os.getenv('EODHD_API_KEY') or os.getenv('EODHD_API_KEY') == 'put_your_key_here',
    reason='benoetigt einen echten EODHD_API_KEY',
)


def test_nvda_real_10_for_1_split_produces_price_continuity():
    from app.providers.eodhd import fetch_splits, fetch_eod
    from app.services.split_adjust import parse_split_ratio, adjust_bars

    async def _run():
        splits_raw = await fetch_splits('NVDA.US', '2024-01-01', '2024-12-31')
        nvda_split = next((s for s in splits_raw if s['date'] == '2024-06-10'), None)
        assert nvda_split is not None, f'Erwarteter NVDA-Split am 2024-06-10 nicht gefunden: {splits_raw}'
        ratio = parse_split_ratio(nvda_split['split'])
        assert ratio == 10.0

        daily = await fetch_eod('NVDA.US', '2024-06-01', '2024-06-20', period='d')
        splits = [{'split_date': s['date'], 'ratio': parse_split_ratio(s['split'])} for s in splits_raw]
        rows = [{'date': r['date'], 'open': r['open'], 'high': r['high'], 'low': r['low'], 'close': r['close'], 'volume': r['volume']} for r in daily]
        adjusted = adjust_bars(rows, splits)

        before = next(r for r in adjusted if r['date'] == '2024-06-07')
        after = next(r for r in adjusted if r['date'] == '2024-06-10')
        # Adjustierter Schlusskurs vor dem Split muss nahe am adjustierten
        # Eroeffnungskurs danach liegen (normale Tagesbewegung, keine 10x-Kluft).
        rel_gap = abs(after['open'] - before['close']) / before['close']
        assert rel_gap < 0.10, f'Unerwartet grosse Luecke ueber den Split hinweg: {before} -> {after}'

    asyncio.run(_run())
