from datetime import datetime, timezone
import httpx
from app.core.config import settings

BASE = "https://eodhd.com/api"

class EodhdError(Exception): pass

def _require_key():
    if not settings.eodhd_api_key or settings.eodhd_api_key in ('put_your_key_here', ''):
        raise EodhdError('EODHD_API_KEY fehlt. Bitte in .env eintragen.')

async def _get(url: str, params: dict):
    _require_key()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
    except httpx.TimeoutException:
        raise EodhdError('Zeitueberschreitung bei EODHD. Bitte spaeter erneut versuchen.')
    except httpx.HTTPError as e:
        raise EodhdError(f'Netzwerkfehler zu EODHD: {e}. Besteht eine Internetverbindung?')
    if r.status_code == 401 or r.status_code == 403:
        raise EodhdError('EODHD lehnt den API-Key ab (ungueltig, abgelaufen oder Tarif deckt diese Daten nicht).')
    if r.status_code == 429:
        raise EodhdError('EODHD-Kontingent erschoepft (HTTP 429). Bitte spaeter erneut versuchen.')
    if r.status_code != 200:
        raise EodhdError(f'EODHD Fehler {r.status_code}: {r.text[:300]}')
    data = r.json()
    if isinstance(data, dict) and data.get('errors'):
        raise EodhdError(str(data['errors']))
    return data

async def fetch_intraday(symbol: str, interval: str, from_ts: int, to_ts: int):
    data = await _get(f"{BASE}/intraday/{symbol}", {'api_token': settings.eodhd_api_key, 'fmt': 'json', 'interval': interval, 'from': from_ts, 'to': to_ts})
    return data if isinstance(data, list) else []

async def fetch_eod(symbol: str, date_from: str, date_to: str, period: str = 'd'):
    """Unadjustierte OHLC plus separater adjusted_close. period='d' (Daily) oder 'w' (nativ Weekly, von EODHD serverseitig aggregiert)."""
    data = await _get(f"{BASE}/eod/{symbol}", {'api_token': settings.eodhd_api_key, 'fmt': 'json', 'from': date_from, 'to': date_to, 'period': period})
    return data if isinstance(data, list) else []

async def fetch_splits(symbol: str, date_from: str, date_to: str):
    """Split-Historie. Antwortform verifiziert gegen die echte API (nicht geraten):
    [{'date': 'YYYY-MM-DD', 'split': 'X.xxxxxx/Y.yyyyyy'}, ...]."""
    data = await _get(f"{BASE}/splits/{symbol}", {'api_token': settings.eodhd_api_key, 'fmt': 'json', 'from': date_from, 'to': date_to})
    return data if isinstance(data, list) else []

async def check_m5(symbol: str, date: str):
    start = int(datetime.fromisoformat(date + 'T13:30:00+00:00').timestamp())
    end = int(datetime.fromisoformat(date + 'T20:00:00+00:00').timestamp())
    rows = await fetch_intraday(symbol, '5m', start, end)
    return {'symbol': symbol, 'date': date, 'interval': '5m', 'available': len(rows) > 0, 'bars': len(rows), 'message': 'OK' if rows else 'Keine echten m5-Kerzen gefunden'}
