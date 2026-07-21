from datetime import datetime, date
import httpx
import asyncio, time, os
from app.core.config import settings

BASE = "https://eodhd.com/api"

class EodhdError(Exception):
    pass

_LOCK = asyncio.Lock()
_LAST_CALL = 0.0
_CALLS_TODAY = 0
_CALL_DAY = date.today()
MIN_SECONDS_BETWEEN_CALLS = float(os.getenv('EODHD_MIN_SECONDS_BETWEEN_CALLS', '0.35'))
DAILY_CALL_LIMIT = int(os.getenv('EODHD_DAILY_CALL_LIMIT', '900'))
MAX_RETRIES = int(os.getenv('EODHD_MAX_RETRIES', '3'))

async def _rate_limit():
    global _LAST_CALL, _CALLS_TODAY, _CALL_DAY
    async with _LOCK:
        today = date.today()
        if today != _CALL_DAY:
            _CALL_DAY = today
            _CALLS_TODAY = 0
        if _CALLS_TODAY >= DAILY_CALL_LIMIT:
            raise EodhdError(f'EODHD Tageslimit im Tool erreicht ({DAILY_CALL_LIMIT} Calls). Bitte morgen fortsetzen oder Limit in .env erhöhen.')
        now=time.monotonic()
        wait=max(0.0, MIN_SECONDS_BETWEEN_CALLS - (now - _LAST_CALL))
        if wait:
            await asyncio.sleep(wait)
        _LAST_CALL=time.monotonic()
        _CALLS_TODAY += 1

def rate_limit_status():
    return {
        'calls_today': _CALLS_TODAY,
        'daily_call_limit': DAILY_CALL_LIMIT,
        'remaining_today': max(0, DAILY_CALL_LIMIT - _CALLS_TODAY),
        'min_seconds_between_calls': MIN_SECONDS_BETWEEN_CALLS,
        'max_retries': MAX_RETRIES,
    }

def _require_key():
    if not settings.eodhd_api_key or settings.eodhd_api_key == 'put_your_key_here':
        raise EodhdError('EODHD_API_KEY fehlt. Bitte in .env eintragen.')

async def _get(path: str, params: dict):
    _require_key()
    params = {**params, 'api_token': settings.eodhd_api_key, 'fmt': 'json'}
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        await _rate_limit()
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                r = await client.get(f"{BASE}{path}", params=params)
            if r.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                last_error = EodhdError(f'EODHD temporärer Fehler {r.status_code}; Retry {attempt}/{MAX_RETRIES}')
                await asyncio.sleep(min(8, 2 ** attempt))
                continue
            if r.status_code != 200:
                raise EodhdError(f'EODHD Fehler {r.status_code}: {r.text[:300]}')
            data = r.json()
            if isinstance(data, dict) and data.get('errors'):
                raise EodhdError(str(data['errors']))
            return data
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_error = EodhdError(f'EODHD Netzwerkfehler: {exc}')
            if attempt < MAX_RETRIES:
                await asyncio.sleep(min(8, 2 ** attempt))
                continue
            raise last_error
    raise last_error or EodhdError('Unbekannter EODHD Fehler')

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
