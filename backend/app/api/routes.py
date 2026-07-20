from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
import csv, io, json, shutil, time, sqlite3, re
from pathlib import Path
from datetime import datetime, timezone
from app.core.config import settings
from app.core.db import conn, symbol_id
from app.providers.eodhd import check_m5, EodhdError
from app.services.market_data import (
    ensure_m5, ensure_daily_history, ensure_weekly_history, ensure_m5_history, ensure_m5_earliest,
    ensure_splits_history,
    intraday_bars, intraday_bars_range, intraday_bars_range_all_sessions, daily_bars_range, weekly_bars_range,
    indicator_series, compute_metrics, DAILY_HISTORY_FLOOR,
)

router = APIRouter()

# ---------- Hilfsfunktionen fuer robusten Import ----------

def parse_num(v):
    """Zahl aus String; akzeptiert Komma-Dezimaltrenner. Leerwert -> None."""
    if v is None:
        return None
    s = str(v).strip()
    if s == '':
        return None
    s = s.replace(' ', '')
    if ',' in s and '.' not in s:
        s = s.replace(',', '.')
    return float(s)

def parse_date(v):
    """ISO (JJJJ-MM-TT) oder deutsches Format (TT.MM.JJJJ). Fehlformat -> ValueError."""
    s = str(v).strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        datetime.strptime(s, '%Y-%m-%d')
        return s
    if re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{4}', s):
        return datetime.strptime(s, '%d.%m.%Y').strftime('%Y-%m-%d')
    raise ValueError(f'Ungueltiges Datumsformat: {v!r} (erwartet JJJJ-MM-TT oder TT.MM.JJJJ)')

def make_name(structure, trigger, tactic, level_name):
    return f'{structure} / {trigger} / {tactic} @ {level_name or "Level offen"}'

# ---------- Health / Availability ----------

@router.get('/health')
def health(): return {'status': 'ok'}

class AvailabilityRequest(BaseModel):
    ticker: str
    entry_date: str

@router.post('/availability/m5')
async def availability(req: AvailabilityRequest):
    sid = symbol_id(req.ticker)
    try:
        res = await check_m5(req.ticker if '.' in req.ticker else f'{req.ticker}.US', req.entry_date)
        with conn() as c:
            c.execute("insert or replace into data_availability(symbol_id,interval,status,message) values(?,?,?,?)", (sid, '5m', 'available' if res['available'] else 'missing', res['message']))
        return res
    except EodhdError as e:
        return {'symbol': req.ticker, 'date': req.entry_date, 'interval': '5m', 'available': False, 'bars': 0, 'message': str(e)}

# ---------- Chart + Metriken (mit serverseitigem Playback-Cutoff) ----------

class ChartRequest(BaseModel):
    ticker: str
    date: str
    timeframe: str = '5m'
    cutoff_time: str | None = None  # 'HH:MM:SS' ET; None = ganze regulaere Session

async def _load_chart(ticker, date, timeframe, cutoff):
    warnings = []
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        await ensure_m5(ticker, date)
    except EodhdError as e:
        raise HTTPException(400, str(e))
    try:
        await ensure_daily_history(ticker, date)
        # date_to=heute (nicht das Entry-Datum!), sonst werden Splits NACH dem
        # Entry-Tag nie erfasst und die Rueckrechnung auf split-bereinigte
        # Kurse bleibt unvollstaendig.
        await ensure_splits_history(ticker, today)
    except EodhdError as e:
        warnings.append(f'Daily-Daten nicht geladen: {e}')
    bars = intraday_bars(ticker, date, timeframe, cutoff)
    metrics = compute_metrics(ticker, date, cutoff)
    if any(b.get('incomplete') for b in bars):
        warnings.append('Mindestens eine aggregierte Kerze ist unvollstaendig (Datenluecke) und als solche markiert.')
    return {'bars': bars, 'metrics': metrics, 'warnings': warnings, 'cutoff_enforced_server_side': True}

@router.post('/charts')
async def chart_post(req: ChartRequest):
    return await _load_chart(req.ticker, req.date, req.timeframe, req.cutoff_time)

@router.get('/charts/{ticker}/{date}')
async def chart(ticker: str, date: str, timeframe: str = '5m', cutoff_time: str | None = None):
    return await _load_chart(ticker, date, timeframe, cutoff_time)

# ---------- Breitband-Chart-Daten (Browsing/Replay, NICHT look-ahead-geschuetzt) ----------
# Rein visuell. Wird niemals fuer Look-ahead-sensible Berechnungen verwendet -
# dafuer bleiben /api/charts + compute_metrics() (oben) die einzige Quelle.

_CHART_DATA_TIMEFRAMES = {'5m', '15m', '30m', '1h', '1d', '1w'}

@router.get('/chart-data/{ticker}')
async def chart_data(ticker: str, timeframe: str = '1d', date_from: str | None = None, date_to: str | None = None):
    if timeframe not in _CHART_DATA_TIMEFRAMES:
        raise HTTPException(400, f'Unbekannte Zeitebene: {timeframe}. Erlaubt: {sorted(_CHART_DATA_TIMEFRAMES)}')
    warnings = []
    today = datetime.now(timezone.utc).date().isoformat()
    date_to = date_to or today
    m5_info = None
    try:
        await ensure_splits_history(ticker, today)
        if timeframe in ('1d', '1w'):
            date_from = date_from or DAILY_HISTORY_FLOOR
            await ensure_daily_history(ticker, date_to, date_from)
            if timeframe == '1w':
                await ensure_weekly_history(ticker, date_to, date_from)
                bars = weekly_bars_range(ticker, date_from, date_to)
            else:
                bars = daily_bars_range(ticker, date_from, date_to)
        else:
            m5_info = await ensure_m5_earliest(ticker)
            date_from = date_from or (m5_info['m5_history_start'] or today)
            await ensure_m5_history(ticker, date_from, date_to)
            # Native 5m-Ansicht bekommt auch Vor-/Nachbörse-Kerzen (fuers Frontend-
            # Hinterlegen ausserboerslicher Zeiten) - aggregierte Zeitebenen (15m/30m/1h)
            # bleiben bei der reinen Regular-Session-Aggregation.
            if timeframe == '5m':
                bars = intraday_bars_range_all_sessions(ticker, date_from, date_to)
            else:
                bars = intraday_bars_range(ticker, date_from, date_to, timeframe)
    except EodhdError as e:
        raise HTTPException(400, str(e))
    indicators = indicator_series(bars)
    if any(b.get('incomplete') for b in bars):
        warnings.append('Mindestens eine aggregierte Kerze ist unvollstaendig (Datenluecke) und als solche markiert.')
    return {
        'symbol': ticker.upper(), 'timeframe': timeframe, 'bars': bars, 'indicators': indicators,
        'm5_history_start': m5_info['m5_history_start'] if m5_info else None,
        'm5_history_verified': m5_info['verified'] if m5_info else False,
        'actual_from': date_from, 'actual_to': date_to, 'warnings': warnings,
    }

class M5EarliestRequest(BaseModel):
    ticker: str

@router.post('/availability/m5-earliest')
async def availability_m5_earliest(req: M5EarliestRequest):
    try:
        return await ensure_m5_earliest(req.ticker)
    except EodhdError as e:
        raise HTTPException(400, str(e))

# ---------- Labels ----------

class SetupIn(BaseModel):
    ticker: str; exchange: str = 'US'; setup_name: str = ''
    entry_date: str; entry_time: str | None = None; entry_price: float | None = None
    exit_date: str | None = None; exit_time: str | None = None; exit_price: float | None = None
    stop_price: float | None = None; target_price: float | None = None; pivot_level_price: float | None = None
    label_class: str; structure: str; trigger: str; tactic: str
    level_name: str | None = None; orderly_rating: int | None = None
    result_r: float | None = None; result_is_hypothetical: bool = False
    mfe_r: float | None = None; mae_r: float | None = None; notes: str | None = None
    cutoff_timestamp: str | None = None; was_playback_enforced: bool = False

@router.post('/labels')
def create_label(s: SetupIn):
    try:
        entry_date = parse_date(s.entry_date)
    except ValueError as e:
        raise HTTPException(400, str(e))
    sid = symbol_id(s.ticker, s.exchange)
    name = s.setup_name or make_name(s.structure, s.trigger, s.tactic, s.level_name)
    try:
        with conn() as c:
            cur = c.execute(
                "insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes,entry_date,entry_time,entry_price,exit_date,exit_time,exit_price,stop_price,target_price,pivot_level_price,cutoff_timestamp,was_playback_enforced,data_status) "
                "values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, name, s.label_class, s.structure, s.trigger, s.tactic, s.level_name, s.orderly_rating, s.result_r, int(s.result_is_hypothetical), s.mfe_r, s.mae_r, s.notes,
                 entry_date, s.entry_time, s.entry_price, s.exit_date, s.exit_time, s.exit_price, s.stop_price, s.target_price, s.pivot_level_price, s.cutoff_timestamp, int(s.was_playback_enforced), 'gespeichert'))
            setup_id = cur.lastrowid
            if s.was_playback_enforced:
                c.execute("insert into playback_sessions(setup_id,symbol_id,entry_date,cutoff_timestamp,was_playback_enforced) values(?,?,?,?,1)", (setup_id, sid, entry_date, s.cutoff_timestamp))
        return {'id': setup_id, 'setup_name': name}
    except sqlite3.IntegrityError:
        raise HTTPException(409, f'Es existiert bereits ein Label fuer {s.ticker} am {entry_date} (Duplikat verhindert).')

@router.get('/labels')
def labels():
    with conn() as c:
        return [dict(r) for r in c.execute("select setups.*, symbols.ticker from setups join symbols on symbols.id=setups.symbol_id order by setups.created_at desc")]

@router.delete('/labels/{setup_id}')
def delete_label(setup_id: int):
    with conn() as c:
        row = c.execute("select id from setups where id=?", (setup_id,)).fetchone()
        if not row:
            raise HTTPException(404, f'Label {setup_id} nicht gefunden.')
        c.execute("delete from setup_markers where setup_id=?", (setup_id,))
        c.execute("delete from playback_sessions where setup_id=?", (setup_id,))
        c.execute("delete from setups where id=?", (setup_id,))
    return {'deleted': setup_id}

# ---------- Marker (mit Zeit-Validierung gegen Look-ahead) ----------

class MarkerIn(BaseModel):
    setup_id: int; marker_type: str; timestamp: str; price: float
    timeframe: str = '5m'; note: str | None = None

def _date_time_key(s: str):
    """Normalisiert ISO ('...THH:MM..') und ' '/'ET'-Formate auf (Datum, HH:MM:SS)."""
    if not s or not s.strip():
        return None
    s = s.strip()
    # Datum = erste 10 Zeichen JJJJ-MM-TT
    d = s[:10]
    rest = s[10:].lstrip('T ').strip()
    # Zeitzonen-/ET-Suffix abschneiden, nur HH:MM:SS behalten
    m = re.match(r'(\d{2}:\d{2}:\d{2})', rest)
    t = m.group(1) if m else '23:59:59'
    return (d, t)

@router.post('/markers')
def add_marker(mk: MarkerIn):
    with conn() as c:
        row = c.execute("select entry_date, entry_time, cutoff_timestamp from setups where id=?", (mk.setup_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Setup nicht gefunden.')
        # Marker darf nicht nach Entry/Cutoff liegen (auf (Datum, Uhrzeit) normalisiert).
        limit_raw = row['cutoff_timestamp'] or ((row['entry_date'] or '') + ' ' + (row['entry_time'] or '23:59:59'))
        limit = _date_time_key(limit_raw); mk_key = _date_time_key(mk.timestamp)
        if limit and mk_key and mk_key > limit:
            raise HTTPException(400, f'Marker-Zeitpunkt {mk.timestamp} liegt nach Entry/Cutoff ({limit_raw}). Look-ahead verhindert.')
        cur = c.execute("insert into setup_markers(setup_id,marker_type,timestamp,price,timeframe,note) values(?,?,?,?,?,?)", (mk.setup_id, mk.marker_type, mk.timestamp, mk.price, mk.timeframe, mk.note))
        return {'id': cur.lastrowid}

@router.get('/markers/{setup_id}')
def get_markers(setup_id: int):
    with conn() as c:
        return [dict(r) for r in c.execute("select * from setup_markers where setup_id=? order by timestamp", (setup_id,))]

# ---------- CSV-Import ----------

REQUIRED = ['ticker', 'entry_date', 'label_class', 'structure', 'trigger', 'tactic']

@router.post('/imports/csv')
async def import_csv(file: UploadFile = File(...)):
    text = (await file.read()).decode('utf-8-sig')  # utf-8-sig entfernt BOM
    rows = list(csv.DictReader(io.StringIO(text)))
    errors = []; imported = 0
    with conn() as c:
        batch = c.execute("insert into import_batches(filename,row_count,status) values(?,?,?)", (file.filename, len(rows), 'pending')).lastrowid
        for i, row in enumerate(rows, start=2):
            if not any((v or '').strip() for v in row.values()):
                continue  # Leerzeile ueberspringen
            try:
                for col in REQUIRED:
                    if not row.get(col):
                        raise ValueError(f'Pflichtfeld fehlt: {col}')
                entry_date = parse_date(row['entry_date'])
                sid = symbol_id(row['ticker'], row.get('exchange') or 'US')
                name = make_name(row['structure'], row['trigger'], row['tactic'], row.get('level_name'))
                c.execute(
                    "insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes,source,entry_date,entry_time,entry_price,exit_date,exit_time,exit_price,stop_price,pivot_level_price) "
                    "values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (sid, name, row['label_class'], row['structure'], row['trigger'], row['tactic'], row.get('level_name'),
                     int(parse_num(row.get('orderly_rating'))) if row.get('orderly_rating') else None,
                     parse_num(row.get('result_r')), 1 if str(row.get('result_is_hypothetical')).lower() == 'true' else 0,
                     parse_num(row.get('mfe_r')), parse_num(row.get('mae_r')), row.get('notes'), 'csv',
                     entry_date, row.get('entry_time'), parse_num(row.get('entry_price')),
                     parse_date(row['exit_date']) if row.get('exit_date') else None, row.get('exit_time'), parse_num(row.get('exit_price')),
                     parse_num(row.get('stop_price')), parse_num(row.get('pivot_level_price'))))
                imported += 1; status = 'imported'; msg = None
            except sqlite3.IntegrityError:
                status = 'error'; msg = f'Duplikat: {row.get("ticker")} {row.get("entry_date")} bereits vorhanden'
                errors.append({'row': i, 'message': msg})
            except Exception as e:
                status = 'error'; msg = str(e); errors.append({'row': i, 'message': msg})
            c.execute("insert into import_rows values(?,?,?,?,?)", (batch, i, json.dumps(row), status, msg))
        c.execute("update import_batches set status=?, errors_json=? where id=?", ('imported_with_errors' if errors else 'imported', json.dumps(errors), batch))
    return {'batch_id': batch, 'imported': imported, 'errors': errors}

# ---------- Export ----------

@router.get('/exports/labels.csv', response_class=PlainTextResponse)
def export_labels_csv():
    with conn() as c:
        rows = [dict(r) for r in c.execute("select symbols.ticker, setups.* from setups join symbols on symbols.id=setups.symbol_id")]
    if not rows:
        return ''
    out = io.StringIO(); w = csv.DictWriter(out, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    return out.getvalue()

@router.get('/exports/labels.json')
def export_labels_json():
    with conn() as c:
        return [dict(r) for r in c.execute("select symbols.ticker, setups.* from setups join symbols on symbols.id=setups.symbol_id")]

# ---------- Backup / Restore ----------

@router.post('/backups')
def backup():
    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    target = Path(settings.backup_dir) / f'setup_miner_{int(time.time())}.db'
    src = sqlite3.connect(settings.database_path)
    dst = sqlite3.connect(str(target))
    with dst:
        src.backup(dst)  # konsistentes Online-Backup ueber die SQLite-Backup-API
    src.close(); dst.close()
    return {'backup': str(target)}

@router.get('/backups')
def list_backups():
    p = Path(settings.backup_dir)
    if not p.exists():
        return {'backups': []}
    return {'backups': sorted([str(f.name) for f in p.glob('setup_miner_*.db')], reverse=True)}

class RestoreRequest(BaseModel):
    backup: str

@router.post('/backups/restore')
def restore(req: RestoreRequest):
    src = Path(settings.backup_dir) / Path(req.backup).name  # kein Pfad-Ausbruch
    if not src.exists():
        raise HTTPException(404, f'Backup nicht gefunden: {req.backup}')
    # Vor dem Zurueckspielen ein Sicherheits-Backup des aktuellen Standes.
    safety = Path(settings.backup_dir) / f'pre_restore_{int(time.time())}.db'
    if Path(settings.database_path).exists():
        shutil.copy2(settings.database_path, safety)
    db = sqlite3.connect(settings.database_path)
    bk = sqlite3.connect(str(src))
    with db:
        bk.backup(db)
    db.close(); bk.close()
    return {'restored_from': str(src), 'safety_backup': str(safety)}
