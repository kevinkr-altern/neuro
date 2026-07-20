"""CLI: check real EODHD m5 availability for CSV rows without exposing the API key.
Usage: cd backend && python -m app.scripts_check_m5 ../data/imports/trades.csv
Loads ../.env if present.
"""
import asyncio, csv, json, os, sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import HTTPError, URLError

def load_env():
    for p in [Path('.env'), Path('../.env')]:
        if p.exists():
            for line in p.read_text().splitlines():
                if '=' in line and not line.strip().startswith('#'):
                    k,v=line.split('=',1); os.environ.setdefault(k.strip(), v.strip())

def fetch_check(symbol: str, date: str):
    key=os.getenv('EODHD_API_KEY','')
    if not key or key == 'put_your_key_here':
        return False, 0, 'EODHD_API_KEY fehlt; .env wurde in dieser Umgebung nicht gefunden'
    import datetime as dt
    start=int(dt.datetime.fromisoformat(date+'T13:30:00+00:00').timestamp())
    end=int(dt.datetime.fromisoformat(date+'T20:00:00+00:00').timestamp())
    url='https://eodhd.com/api/intraday/'+symbol+'?'+urlencode({'api_token':key,'fmt':'json','interval':'5m','from':start,'to':end})
    try:
        with urlopen(url, timeout=45) as r:
            data=json.loads(r.read().decode())
    except HTTPError as e:
        return False, 0, f'EODHD HTTP {e.code}; prüfe Tarif/API-Key'
    except URLError as e:
        return False, 0, f'Netzwerkfehler: {e.reason}'
    if isinstance(data, dict) and data.get('errors'):
        return False, 0, str(data['errors'])
    rows=data if isinstance(data, list) else []
    return bool(rows), len(rows), 'OK' if rows else 'Keine echten m5-Kerzen gefunden'

async def main(path: str):
    load_env()
    if not Path(path).exists():
        print(f'CSV nicht gefunden: {path}', file=sys.stderr); sys.exit(1)
    rows=list(csv.DictReader(open(path, newline='', encoding='utf-8-sig')))
    print('| Ticker | Entry-Datum | m5 vorhanden | m15/m30 ableitbar | Status |')
    print('|---|---:|---:|---:|---|')
    for r in rows:
        ticker=(r.get('ticker') or '').strip()
        date=(r.get('entry_date') or '').strip()
        if not ticker or not date:
            print(f"| {ticker or '?'} | {date or '?'} | nein | nein | Pflichtfeld fehlt |"); continue
        if date < '2020-10-01':
            print(f"| {ticker} | {date} | nein | nein | vor Beginn der m5-Historie; keine Intraday-Features |"); continue
        ok,bars,msg=fetch_check(ticker if '.' in ticker else f'{ticker}.US', date)
        yes='ja' if ok else 'nein'
        print(f"| {ticker} | {date} | {yes} | {yes} | {msg} ({bars} Bars) |")

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print('Usage: cd backend && python -m app.scripts_check_m5 ../data/imports/trades.csv', file=sys.stderr); sys.exit(2)
    asyncio.run(main(sys.argv[1]))
