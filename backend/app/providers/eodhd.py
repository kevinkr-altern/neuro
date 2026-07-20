from datetime import datetime
import httpx
import asyncio, time
from app.core.config import settings

BASE = "https://eodhd.com/api"

class EodhdError(Exception):
    pass

_LAST_CALL = 0.0
MIN_SECONDS_BETWEEN_CALLS = 0.25

async def _rate_limit():
    global _LAST_CALL
    now=time.monotonic()
    wait=max(0.0, MIN_SECONDS_BETWEEN_CALLS - (now - _LAST_CALL))
    if wait:
        await asyncio.sleep(wait)
    _LAST_CALL=time.monotonic()

def _require_key():
    if not settings.eodhd_api_key or settings.eodhd_api_key == 'put_your_key_here':
        raise EodhdError('EODHD_API_KEY fehlt. Bitte in .env eintragen.')

async def _get(path: str, params: dict):
    _require_key()
    params = {**params, 'api_token': settings.eodhd_api_key, 'fmt': 'json'}
    await _rate_limit()
    async with httpx.AsyncClient(timeout=45) as client:
        r = await client.get(f"{BASE}{path}", params=params)
    if r.status_code != 200:
        raise EodhdError(f'EODHD Fehler {r.status_code}: {r.text[:300]}')
    data = r.json()
    if isinstance(data, dict) and data.get('errors'):
        raise EodhdError(str(data['errors']))
    return data

async def fetch_intraday(symbol: str, interval: str, from_ts: int, to_ts: int):
    data = await _get(f"/intraday/{symbol}", {'interval': interval, 'from': from_ts, 'to': to_ts})
    return data if isinstance(data, list) else []

async def fetch_daily(symbol: str, from_date: str, to_date: str):
    data = await _get(f"/eod/{symbol}", {'from': from_date, 'to': to_date, 'period': 'd'})
    return data if isinstance(data, list) else []

async def check_m5(symbol: str, date: str):
    start = int(datetime.fromisoformat(date + 'T13:30:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date + 'T20:00:00+00:00').timestamp())
    rows = await fetch_intraday(symbol, '5m', start, end)
    return {'symbol': symbol, 'date': date, 'interval': '5m', 'available': len(rows) > 0, 'bars': len(rows), 'message': 'OK' if rows else 'Keine echten m5-Kerzen gefunden'}
