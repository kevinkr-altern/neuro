from fastapi import APIRouter, UploadFile, File, HTTPException, Response
from pydantic import BaseModel
import csv, io, json, shutil, time
from pathlib import Path
from app.core.config import settings
from app.core.db import conn, symbol_id
from app.providers.eodhd import check_m5, EodhdError
from app.services.market_data import ensure_m5, ensure_daily, intraday_bars, daily_bars, metrics_for_bar

router = APIRouter()

class AvailabilityRequest(BaseModel):
    ticker: str
    entry_date: str

class ChartRequest(BaseModel):
    ticker: str
    date: str
    timeframe: str = 'daily'
    cutoff_time: str | None = None
    selected_index: int | None = None

@router.get('/health')
def health():
    return {'status':'ok', 'app':'Setup-Miner', 'phase':'1-labeling'}

@router.get('/settings/status')
def settings_status():
    return {
        'api_key_configured': bool(settings.eodhd_api_key and settings.eodhd_api_key != 'put_your_key_here'),
        'database_path': settings.database_path,
        'cache_dir': settings.cache_dir,
        'backup_dir': settings.backup_dir,
        'intraday_policy': 'Nur echte EODHD-m5-Daten; m15/m30 werden aus m5 aggregiert; keine Imputation.'
    }

@router.post('/availability/m5')
async def availability(req: AvailabilityRequest):
    sid = symbol_id(req.ticker)
    try:
        res = await check_m5(req.ticker if '.' in req.ticker else f'{req.ticker}.US', req.entry_date)
        with conn() as c:
            c.execute("insert or replace into data_availability(symbol_id,interval,status,message) values(?,?,?,?)", (sid,'5m','available' if res['available'] else 'missing',res['message']))
        return res
    except EodhdError as e:
        return {'symbol':req.ticker,'date':req.entry_date,'interval':'5m','available':False,'bars':0,'message':str(e)}

@router.post('/charts')
async def chart(req: ChartRequest):
    try:
        await ensure_daily(req.ticker, req.date)
        daily = daily_bars(req.ticker, req.date, playback=True)
        if req.timeframe == 'daily':
            bars = daily
            metrics = {}
        else:
            await ensure_m5(req.ticker, req.date)
            bars = intraday_bars(req.ticker, req.date, req.timeframe, req.cutoff_time)
            index = req.selected_index if req.selected_index is not None else len(bars)-1
            metrics = metrics_for_bar(bars, daily, index)
        return {'bars': bars, 'metrics': metrics, 'playback_cutoff': {'date': req.date, 'time': req.cutoff_time}}
    except EodhdError as e:
        raise HTTPException(400, str(e))

@router.get('/charts/{ticker}/{date}')
async def chart_compat(ticker: str, date: str, timeframe: str='5m'):
    return await chart(ChartRequest(ticker=ticker, date=date, timeframe=timeframe))

class SetupIn(BaseModel):
    ticker: str
    setup_name: str=''
    label_class: str
    structure: str
    trigger: str
    tactic: str
    level_name: str|None=None
    orderly_rating:int|None=None
    result_r:float|None=None
    result_is_hypothetical:bool=False
    mfe_r:float|None=None
    mae_r:float|None=None
    notes:str|None=None

class MarkerIn(BaseModel):
    setup_id: int
    marker_type: str
    timestamp: str
    price: float
    timeframe: str
    note: str | None = None

@router.post('/labels')
def create_label(s: SetupIn):
    sid=symbol_id(s.ticker)
    name=s.setup_name or f'{s.structure} / {s.trigger} / {s.tactic} @ {s.level_name or "Level offen"}'
    with conn() as c:
        cur=c.execute("insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)", (sid,name,s.label_class,s.structure,s.trigger,s.tactic,s.level_name,s.orderly_rating,s.result_r,int(s.result_is_hypothetical),s.mfe_r,s.mae_r,s.notes))
        return {'id':cur.lastrowid,'setup_name':name}

@router.post('/markers')
def create_marker(m: MarkerIn):
    with conn() as c:
        cur=c.execute("insert into setup_markers(setup_id,marker_type,timestamp,price,timeframe,note) values(?,?,?,?,?,?)", (m.setup_id,m.marker_type,m.timestamp,m.price,m.timeframe,m.note))
        return {'id': cur.lastrowid}

@router.get('/labels')
def labels():
    with conn() as c:
        return [dict(r) for r in c.execute("select setups.*, symbols.ticker from setups join symbols on symbols.id=setups.symbol_id order by setups.created_at desc")]

@router.get('/labels/{setup_id}/markers')
def markers(setup_id: int):
    with conn() as c:
        return [dict(r) for r in c.execute("select * from setup_markers where setup_id=? order by timestamp", (setup_id,))]

@router.post('/imports/csv')
async def import_csv(file: UploadFile = File(...)):
    text=(await file.read()).decode('utf-8-sig')
    rows=list(csv.DictReader(io.StringIO(text)))
    errors=[]; imported=0
    with conn() as c:
        batch=c.execute("insert into import_batches(filename,row_count,status) values(?,?,?)", (file.filename,len(rows),'pending')).lastrowid
        for i,row in enumerate(rows, start=2):
            try:
                for col in ['ticker','entry_date','label_class','structure','trigger','tactic']:
                    if not row.get(col):
                        raise ValueError(f'Pflichtfeld fehlt: {col}')
                sid=symbol_id(row['ticker'], row.get('exchange') or 'US')
                name=row.get('setup_name') or f"{row['structure']} / {row['trigger']} / {row['tactic']} @ {row.get('level_name') or 'Level offen'}"
                c.execute("insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes,source) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (sid,name,row['label_class'],row['structure'],row['trigger'],row['tactic'],row.get('level_name'),row.get('orderly_rating') or None,row.get('result_r') or None,1 if str(row.get('result_is_hypothetical')).lower()=='true' else 0,row.get('mfe_r') or None,row.get('mae_r') or None,row.get('notes'),'csv'))
                imported+=1; status='imported'; msg=None
            except Exception as e:
                errors.append({'row':i,'message':str(e)}); status='error'; msg=str(e)
            c.execute("insert into import_rows values(?,?,?,?,?)", (batch,i,json.dumps(row),status,msg))
        c.execute("update import_batches set status=?, errors_json=? where id=?", ('imported_with_errors' if errors else 'imported', json.dumps(errors), batch))
    return {'batch_id':batch,'imported':imported,'errors':errors}

@router.get('/exports/labels.csv')
def export_labels_csv():
    with conn() as c:
        rows=[dict(r) for r in c.execute("select symbols.ticker,setups.* from setups join symbols on symbols.id=setups.symbol_id")]
    out=io.StringIO()
    if rows:
        w=csv.DictWriter(out, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    return Response(out.getvalue(), media_type='text/csv', headers={'Content-Disposition':'attachment; filename="setup_miner_labels.csv"'})

@router.get('/exports/labels.json')
def export_labels_json():
    with conn() as c:
        rows=[dict(r) for r in c.execute("select symbols.ticker,setups.* from setups join symbols on symbols.id=setups.symbol_id")]
    return rows

@router.post('/backups')
def backup():
    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    if not Path(settings.database_path).exists():
        raise HTTPException(400, 'Datenbank existiert noch nicht; erst App starten oder Label speichern.')
    target=Path(settings.backup_dir)/f'setup_miner_{int(time.time())}.db'
    shutil.copy2(settings.database_path, target)
    return {'backup': str(target)}
