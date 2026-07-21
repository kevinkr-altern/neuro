from datetime import datetime, timedelta

def aggregate_weekly(rows, enrich=None):
    buckets={}
    for r in rows:
        d=datetime.fromisoformat(r['date']).date()
        week_start=(d - timedelta(days=d.weekday())).isoformat()
        buckets.setdefault(week_start, []).append(r)
    out=[]
    for week, chunk in sorted(buckets.items()):
        out.append({'date': week, 'open': chunk[0]['open'], 'high': max(x['high'] for x in chunk), 'low': min(x['low'] for x in chunk), 'close': chunk[-1]['close'], 'adjusted_close': chunk[-1].get('adjusted_close'), 'volume': sum(x.get('volume') or 0 for x in chunk)})
    return enrich(out) if enrich else out
