from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
import csv, io, json, shutil, time
from pathlib import Path
from app.core.config import settings
from app.core.db import conn, symbol_id
from app.providers.eodhd import check_m5, EodhdError
from app.services.market_data import ensure_m5, intraday_bars, metrics_for_bar

router = APIRouter()

class AvailabilityRequest(BaseModel):
    ticker: str
    entry_date: str

@router.get('/health')
def health(): return {'status':'ok'}

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

@router.get('/charts/{ticker}/{date}')
async def chart(ticker: str, date: str, timeframe: str='5m'):
    try: await ensure_m5(ticker, date)
    except EodhdError as e: raise HTTPException(400, str(e))
    bars = intraday_bars(ticker, date, timeframe)
    return {'bars': bars, 'metrics': metrics_for_bar(bars, len(bars)-1)}

class SetupIn(BaseModel):
    ticker: str; setup_name: str=''; label_class: str; structure: str; trigger: str; tactic: str; level_name: str|None=None; orderly_rating:int|None=None; result_r:float|None=None; result_is_hypothetical:bool=False; mfe_r:float|None=None; mae_r:float|None=None; notes:str|None=None

@router.post('/labels')
def create_label(s: SetupIn):
    sid=symbol_id(s.ticker)
    name=s.setup_name or f'{s.structure} / {s.trigger} / {s.tactic} @ {s.level_name or "Level offen"}'
    with conn() as c:
        cur=c.execute("insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)", (sid,name,s.label_class,s.structure,s.trigger,s.tactic,s.level_name,s.orderly_rating,s.result_r,int(s.result_is_hypothetical),s.mfe_r,s.mae_r,s.notes))
        return {'id':cur.lastrowid,'setup_name':name}

@router.get('/labels')
def labels():
    with conn() as c:
        return [dict(r) for r in c.execute("select setups.*, symbols.ticker from setups join symbols on symbols.id=setups.symbol_id order by setups.created_at desc")]

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
                    if not row.get(col): raise ValueError(f'Pflichtfeld fehlt: {col}')
                sid=symbol_id(row['ticker'], row.get('exchange') or 'US')
                name=f"{row['structure']} / {row['trigger']} / {row['tactic']} @ {row.get('level_name') or 'Level offen'}"
                c.execute("insert into setups(symbol_id,setup_name,label_class,structure,trigger,tactic,level_name,orderly_rating,result_r,result_is_hypothetical,mfe_r,mae_r,notes,source) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (sid,name,row['label_class'],row['structure'],row['trigger'],row['tactic'],row.get('level_name'),row.get('orderly_rating') or None,row.get('result_r') or None,1 if str(row.get('result_is_hypothetical')).lower()=='true' else 0,row.get('mfe_r') or None,row.get('mae_r') or None,row.get('notes'),'csv'))
                imported+=1; status='imported'; msg=None
            except Exception as e:
                errors.append({'row':i,'message':str(e)}); status='error'; msg=str(e)
            c.execute("insert into import_rows values(?,?,?,?,?)", (batch,i,json.dumps(row),status,msg))
        c.execute("update import_batches set status=?, errors_json=? where id=?", ('imported_with_errors' if errors else 'imported', json.dumps(errors), batch))
    return {'batch_id':batch,'imported':imported,'errors':errors}

@router.get('/exports/labels.csv')
def export_labels():
    with conn() as c:
        rows=[dict(r) for r in c.execute("select symbols.ticker,setups.* from setups join symbols on symbols.id=setups.symbol_id")]
    if not rows: return ''
    out=io.StringIO(); w=csv.DictWriter(out, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
    return out.getvalue()

@router.post('/backups')
def backup():
    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    target=Path(settings.backup_dir)/f'setup_miner_{int(time.time())}.db'
    shutil.copy2(settings.database_path, target)
    return {'backup': str(target)}
