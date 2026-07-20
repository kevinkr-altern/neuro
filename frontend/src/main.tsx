import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createChart, CandlestickData, IChartApi} from 'lightweight-charts';
import {api, BASE} from './api/client';
import './style.css';

type Bar={time:string;open:number;high:number;low:number;close:number;volume:number};
const classes=['A+','Gut','Neutral','Fehlsignal','Bewusst geskippt'];
const structures=['HTF','Pullback','Base','EP'];
const triggers=['Base-BO','U&R','EMA-Reclaim','Reclaim-FT','EP-Trigger'];
const tactics=['ORB m5','ORB m15','ORB m30','PDH Buy-Stop','Sniper','EOTD'];

function ChartBox({bars}:{bars:Bar[]}){
  const ref=useRef<HTMLDivElement>(null); const chartRef=useRef<IChartApi|null>(null);
  useEffect(()=>{ if(!ref.current) return; ref.current.innerHTML=''; const chart=createChart(ref.current,{height:430,layout:{background:{color:'#101722'},textColor:'#d6e2ff'},grid:{vertLines:{color:'#1d2a3a'},horzLines:{color:'#1d2a3a'}}}); chartRef.current=chart; const series=chart.addCandlestickSeries(); series.setData(bars.map((b,i)=>({time:Math.floor(new Date(b.time).getTime()/1000) as CandlestickData['time'], open:b.open, high:b.high, low:b.low, close:b.close}))); chart.timeScale().fitContent(); return()=>chart.remove();},[bars]);
  return <div className="chart" ref={ref}/>;
}
function App(){
 const [ticker,setTicker]=useState('NVDA'); const [date,setDate]=useState('2021-11-01'); const [tf,setTf]=useState('5m'); const [bars,setBars]=useState<Bar[]>([]); const [err,setErr]=useState(''); const [msg,setMsg]=useState(''); const [labels,setLabels]=useState<any[]>([]);
 const [form,setForm]=useState<any>({label_class:'Gut',structure:'Pullback',trigger:'EMA-Reclaim',tactic:'ORB m30',level_name:'ORH m30',orderly_rating:4,result_is_hypothetical:false});
 async function load(){setErr('');setMsg('Lade echte m5-Daten über EODHD/cache ...'); try{const r=await api(`/charts/${ticker}/${date}?timeframe=${tf}`); setBars(r.bars); setMsg(`${r.bars.length} Kerzen geladen. Playback: Chart ist auf ${date} begrenzt.`)}catch(e:any){setErr(e.message); setMsg('')}}
 async function check(){setErr(''); try{const r=await api('/availability/m5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,entry_date:date})}); setMsg(`${r.available?'OK':'Fehlt'}: ${r.message} (${r.bars} Bars)`)}catch(e:any){setErr(e.message)}}
 async function save(){try{const r=await api('/labels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,...form})}); setMsg(`Label gespeichert: ${r.setup_name}`); refresh()}catch(e:any){setErr(e.message)}}
 async function refresh(){try{setLabels(await api('/labels'))}catch{}}
 async function upload(file:File){const fd=new FormData(); fd.append('file',file); try{const r=await fetch(`${BASE}/api/imports/csv`,{method:'POST',body:fd}); const j=await r.json(); setMsg(`Importiert: ${j.imported}; Fehler: ${j.errors.length}`); setErr(j.errors.map((x:any)=>`Zeile ${x.row}: ${x.message}`).join('\n')); refresh()}catch(e:any){setErr(e.message)}}
 useEffect(()=>{refresh()},[]);
 return <main><h1>Setup-Miner · Phase 1 Labeling</h1><p className="warn">Keine künstlichen Intraday-Daten: m15/m30 werden nur aus echten m5-Kerzen aggregiert. Fehlende Daten erscheinen hier sichtbar.</p>{err&&<pre className="error">{err}</pre>}{msg&&<p className="msg">{msg}</p>}
 <section className="panel"><h2>Daten & Playback</h2><input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())}/><input type="date" value={date} onChange={e=>setDate(e.target.value)}/><select value={tf} onChange={e=>setTf(e.target.value)}><option value="5m">m5</option><option value="15m">m15</option><option value="30m">m30</option></select><button onClick={check}>m5-Verfügbarkeit prüfen</button><button onClick={load}>Chart laden</button></section>
 <ChartBox bars={bars}/>
 <section className="grid"><div className="panel"><h2>Kennzahlen-Panel</h2><p>Selektierte Kerze: letzte geladene Kerze. Pfeiltasten/Marker werden in der nächsten Iteration erweitert.</p><ul><li>LoD-Distance: nur mit ATR(14) aus Daily-Daten gültig; keine Schätzung.</li><li>ORB m15/m30: aus echten m5-Kerzen aggregiert.</li><li>Playback: keine Daten nach gewähltem Datum.</li></ul></div>
 <div className="panel"><h2>Label</h2>{[['label_class',classes],['structure',structures],['trigger',triggers],['tactic',tactics]].map(([k,opts]:any)=><label key={k}>{k}<select value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}>{opts.map((o:string)=><option key={o}>{o}</option>)}</select></label>)}<label>Level<input value={form.level_name||''} onChange={e=>setForm({...form,level_name:e.target.value})}/></label><label>Orderly 1-5<input type="number" min="1" max="5" value={form.orderly_rating||''} onChange={e=>setForm({...form,orderly_rating:Number(e.target.value)})}/></label><label>Ergebnis R<input type="number" step="0.1" onChange={e=>setForm({...form,result_r:Number(e.target.value)})}/></label><textarea placeholder="Notiz" onChange={e=>setForm({...form,notes:e.target.value})}/><button onClick={save}>Label speichern</button></div></section>
 <section className="panel"><h2>CSV-Import / Backup / Export</h2><input type="file" accept=".csv" onChange={e=>e.target.files&&upload(e.target.files[0])}/><a href={`${BASE}/api/exports/labels.csv`} target="_blank">Labels als CSV exportieren</a><button onClick={async()=>setMsg(`Backup: ${(await api('/backups',{method:'POST'})).backup}`)}>Backup erstellen</button></section>
 <section className="panel"><h2>Letzte Labels</h2><table><tbody>{labels.map(l=><tr key={l.id}><td>{l.ticker}</td><td>{l.setup_name}</td><td>{l.label_class}</td></tr>)}</tbody></table></section></main>
}
createRoot(document.getElementById('root')!).render(<App/>);
