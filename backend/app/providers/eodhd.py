from datetime import datetime, timezone
import httpx
from app.core.config import settings

BASE = "https://eodhd.com/api"

class EodhdError(Exception): pass

async def fetch_intraday(symbol: str, interval: str, from_ts: int, to_ts: int):
    if not settings.eodhd_api_key or settings.eodhd_api_key == 'put_your_key_here':
        raise EodhdError('EODHD_API_KEY fehlt. Bitte in .env eintragen.')
    params = {'api_token': settings.eodhd_api_key, 'fmt': 'json', 'interval': interval, 'from': from_ts, 'to': to_ts}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{BASE}/intraday/{symbol}", params=params)
    if r.status_code != 200:
        raise EodhdError(f'EODHD Fehler {r.status_code}: {r.text[:300]}')
    data = r.json()
    if isinstance(data, dict) and data.get('errors'):
        raise EodhdError(str(data['errors']))
    return data if isinstance(data, list) else []

async def check_m5(symbol: str, date: str):
    start = int(datetime.fromisoformat(date + 'T13:30:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date + 'T20:00:00+00:00').timestamp())
    rows = await fetch_intraday(symbol, '5m', start, end)
    return {'symbol': symbol, 'date': date, 'interval': '5m', 'available': len(rows) > 0, 'bars': len(rows), 'message': 'OK' if rows else 'Keine echten m5-Kerzen gefunden'}
