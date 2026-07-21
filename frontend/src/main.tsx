import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createChart, CandlestickData, ColorType, IChartApi, ISeriesApi, LineData, SeriesMarker, Time} from 'lightweight-charts';
import {api, BASE} from './api/client';
import './style.css';

type Timeframe='5m'|'15m'|'30m'|'1h'|'daily'|'weekly';
type Bar={time?:string;date?:string;open:number;high:number;low:number;close:number;volume:number;ema10?:number;ema20?:number;sma50?:number;sma100?:number;sma200?:number};
type TradeStatus='draft'|'open'|'closed';
type StopStrategy='manual'|'first_candle_low'|'entry_candle_low'|'fixed_percent'|'atr_multiple';
type Trade={id:string;status:TradeStatus;entryTime?:string;entryPrice?:number;exitTime?:string;exitPrice?:number;stopPrice?:number;targetPrice?:number;riskPerShare?:number;resultR?:number;stopStrategy:StopStrategy;fixedPercent:number;atrMultiple:number};
type MarkerDraft={marker_type:string; timestamp:string; price:number; timeframe:string; note?:string};

type ChartRefs={chart:IChartApi;candles:ISeriesApi<'Candlestick'>;ema10:ISeriesApi<'Line'>;ema20:ISeriesApi<'Line'>;sma50:ISeriesApi<'Line'>;sma200:ISeriesApi<'Line'>;volume:ISeriesApi<'Histogram'>};

const timeframes:{value:Timeframe;label:string}[]=[{value:'5m',label:'M5'},{value:'15m',label:'M15'},{value:'30m',label:'M30'},{value:'1h',label:'H1'},{value:'daily',label:'D1'},{value:'weekly',label:'W1'}];
const structures=['HTF','Pullback','Base','EP'];
const triggers=['Base-BO','U&R','EMA-Reclaim','Reclaim-FT','EP-Trigger'];
const tactics=['ORB m5','ORB m15','ORB m30','PDH Buy-Stop','Sniper','EOTD'];
const levels=['PDH','PDL-Reclaim','ORH m5','ORH m15','ORH m30','Pivot','EMA10','EMA20','Reclaim-Kerzenhoch','Swing-Low'];
const metricNames=['selected_price','atr14_dollars','lod_distance_pct','lod_rule_valid','atr_ext_sma50','atr_ext_ema10','atr_ext_ema21','adr14_pct','adr20_pct','rvol_projected','dist_ema10_pct','dist_ema20_pct','dist_sma50_pct','dist_sma100_pct','dist_sma200_pct','gap_pct','pdh','pdl','volume'];

function tOf(b:Bar){return b.time || b.date || ''}
function toTime(b:Bar): Time { return Math.floor(new Date(b.time || `${b.date}T00:00:00Z`).getTime()/1000) as Time }
function num(v:any){const n=Number(v); return Number.isFinite(n)?n:undefined}
function fmt(v:any){return typeof v==='number'?Math.round(v*100)/100:v??'—'}
function id(){return Math.random().toString(36).slice(2)}

function App(){
  const [ticker,setTicker]=useState('NVDA');
  const [date,setDate]=useState('2024-12-31');
  const [cutoff,setCutoff]=useState('');
  const [tf,setTf]=useState<Timeframe>('daily');
  const [bars,setBars]=useState<Bar[]>([]);
  const [metrics,setMetrics]=useState<any>({});
  const [selected,setSelected]=useState(-1);
  const [settings,setSettings]=useState<any>({});
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [tool,setTool]=useState<'cursor'|'entry'|'exit'|'stop'|'target'|'line'>('cursor');
  const [trade,setTrade]=useState<Trade>({id:id(),status:'draft',stopStrategy:'first_candle_low',fixedPercent:3,atrMultiple:1});
  const [lines,setLines]=useState<MarkerDraft[]>([]);
  const [form,setForm]=useState<any>({structure:'Pullback',trigger:'EMA-Reclaim',tactic:'ORB m30',level_name:'ORH m30',orderly_rating:4,label_class:'Gut',result_is_hypothetical:false});
  const chartEl=useRef<HTMLDivElement>(null);
  const refs=useRef<ChartRefs|null>(null);

  const selectedBar=selected>=0?bars[selected]:undefined;
  const firstCandle = ['5m','15m','30m'].includes(tf) && bars.length ? bars[0] : undefined;
  const setupName=`${form.structure} / ${form.trigger} / ${form.tactic} @ ${form.level_name || 'Level offen'}`;

  useEffect(()=>{refreshSettings()},[]);
  useEffect(()=>{renderChart()},[bars,selected,tf,trade,lines]);
  useEffect(()=>{function key(e:KeyboardEvent){if(e.key==='ArrowLeft')setSelected(s=>Math.max(0,s-1)); if(e.key==='ArrowRight')setSelected(s=>Math.min(bars.length-1,s+1));} window.addEventListener('keydown',key); return()=>window.removeEventListener('keydown',key)},[bars.length]);

  async function refreshSettings(){try{setSettings(await api('/settings/status'))}catch{}}
  async function loadChart(selectedIndex?:number){
    setError(''); setMessage('Lade Chart ...');
    try{
      const r=await api('/charts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,date,timeframe:tf,cutoff_time:cutoff||undefined,selected_index:selectedIndex})});
      setBars(r.bars||[]); setMetrics(r.metrics||{}); setSelected((r.bars||[]).length-1);
      setMessage(`${(r.bars||[]).length} Kerzen geladen. ${r.warnings?.before_m5_history?'Vor m5-Historie. ':''}${r.warnings?.intraday_not_final_notice||''}`);
      refreshSettings();
    }catch(e:any){setError(e.message); setMessage('')}
  }
  async function selectBar(index:number){setSelected(index); if(tf==='daily'||tf==='weekly'){try{const r=await api('/charts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,date,timeframe:tf,selected_index:index})}); setMetrics(r.metrics||{})}catch{}}}
  async function checkM5(){try{const r=await api('/availability/m5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker,entry_date:date})});setMessage(`${r.available?'OK':'FEHLT'} ${r.symbol} ${r.date}: ${r.message}; M15/M30/H1 ableitbar: ${r.available?'ja':'nein'}`)}catch(e:any){setError(e.message)}}

  function renderChart(){
    if(!chartEl.current)return;
    if(refs.current){refs.current.chart.remove(); refs.current=null;}
    const chart=createChart(chartEl.current,{height:620,layout:{background:{type:ColorType.Solid,color:'#0b0f14'},textColor:'#d1d4dc'},grid:{vertLines:{color:'#1e222d'},horzLines:{color:'#1e222d'}},rightPriceScale:{borderColor:'#2a2e39'},timeScale:{borderColor:'#2a2e39',timeVisible:tf!=='daily'&&tf!=='weekly',secondsVisible:false}});
    const candles=chart.addCandlestickSeries({upColor:'#26a69a',downColor:'#ef5350',borderUpColor:'#26a69a',borderDownColor:'#ef5350',wickUpColor:'#26a69a',wickDownColor:'#ef5350',priceLineVisible:true});
    const ema10=chart.addLineSeries({color:'#ffd166',lineWidth:1,priceLineVisible:false,lastValueVisible:false});
    const ema20=chart.addLineSeries({color:'#06d6a0',lineWidth:1,priceLineVisible:false,lastValueVisible:false});
    const sma50=chart.addLineSeries({color:'#4dabf7',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
    const sma200=chart.addLineSeries({color:'#ff9800',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
    const volume=chart.addHistogramSeries({color:'#3a506b',priceFormat:{type:'volume'},priceScaleId:'vol'});
    chart.priceScale('vol').applyOptions({scaleMargins:{top:0.82,bottom:0}});
    candles.setData(bars.map(b=>({time:toTime(b),open:b.open,high:b.high,low:b.low,close:b.close} as CandlestickData)));
    const lineData=(key:keyof Bar)=>bars.filter(b=>typeof b[key]==='number').map(b=>({time:toTime(b),value:b[key] as number} as LineData));
    ema10.setData(lineData('ema10')); ema20.setData(lineData('ema20')); sma50.setData(lineData('sma50')); sma200.setData(lineData('sma200'));
    volume.setData(bars.map(b=>({time:toTime(b),value:b.volume||0,color:b.close>=b.open?'rgba(38,166,154,.35)':'rgba(239,83,80,.35)'})));
    const chartMarkers:SeriesMarker<Time>[]=[];
    if(selectedBar) chartMarkers.push({time:toTime(selectedBar),position:'aboveBar',color:'#f6c343',shape:'arrowDown',text:'Selektiert'});
    if(trade.entryTime) chartMarkers.push({time:Math.floor(new Date(trade.entryTime).getTime()/1000) as Time,position:'belowBar',color:'#26a69a',shape:'arrowUp',text:'ENTRY'});
    if(trade.exitTime) chartMarkers.push({time:Math.floor(new Date(trade.exitTime).getTime()/1000) as Time,position:'aboveBar',color:'#ef5350',shape:'arrowDown',text:'EXIT'});
    candles.setMarkers(chartMarkers);
    if(firstCandle){
      candles.createPriceLine({price:firstCandle.high,color:'#26a69a',lineWidth:2,lineStyle:2,axisLabelVisible:true,title:`${tf.toUpperCase()} 1. Kerze High`});
      candles.createPriceLine({price:firstCandle.low,color:'#ef5350',lineWidth:2,lineStyle:2,axisLabelVisible:true,title:`${tf.toUpperCase()} 1. Kerze Low`});
    }
    if(trade.entryPrice) candles.createPriceLine({price:trade.entryPrice,color:'#26a69a',lineWidth:2,lineStyle:0,axisLabelVisible:true,title:'Entry'});
    if(trade.stopPrice) candles.createPriceLine({price:trade.stopPrice,color:'#ef5350',lineWidth:2,lineStyle:0,axisLabelVisible:true,title:'Stop'});
    if(trade.targetPrice) candles.createPriceLine({price:trade.targetPrice,color:'#ab47bc',lineWidth:2,lineStyle:1,axisLabelVisible:true,title:'Target'});
    if(trade.exitPrice) candles.createPriceLine({price:trade.exitPrice,color:'#f6c343',lineWidth:2,lineStyle:0,axisLabelVisible:true,title:'Exit'});
    lines.forEach(l=>candles.createPriceLine({price:l.price,color:'#f6c343',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:l.note||'Level'}));
    chart.subscribeClick(param=>{if(!param.time)return; const idx=bars.findIndex(b=>toTime(b)===param.time); if(idx>=0) {selectBar(idx); handleChartAction(bars[idx]);}});
    chart.timeScale().fitContent(); refs.current={chart,candles,ema10,ema20,sma50,sma200,volume};
  }

  function stopFor(strategy:StopStrategy, b:Bar, entry:number){
    if(strategy==='first_candle_low') return firstCandle?.low;
    if(strategy==='entry_candle_low') return b.low;
    if(strategy==='fixed_percent') return entry*(1-(trade.fixedPercent||3)/100);
    if(strategy==='atr_multiple') return metrics.atr14_dollars ? entry-(metrics.atr14_dollars*(trade.atrMultiple||1)) : undefined;
    return trade.stopPrice;
  }
  function updateResult(next:Trade){
    const risk=next.entryPrice&&next.stopPrice?Math.abs(next.entryPrice-next.stopPrice):undefined;
    const result=next.entryPrice&&next.exitPrice&&risk?((next.exitPrice-next.entryPrice)/risk):undefined;
    return {...next,riskPerShare:risk,resultR:result,status:next.exitPrice?'closed':next.entryPrice?'open':'draft'} as Trade;
  }
  function handleChartAction(b:Bar){
    if(tool==='entry'){
      const entry=b.close; const stop=stopFor(trade.stopStrategy,b,entry);
      setTrade(updateResult({...trade,entryTime:tOf(b),entryPrice:entry,stopPrice:stop,status:'open'}));
    } else if(tool==='exit') {
      setTrade(updateResult({...trade,exitTime:tOf(b),exitPrice:b.close,status:'closed'}));
    } else if(tool==='stop') {
      setTrade(updateResult({...trade,stopPrice:b.close}));
    } else if(tool==='target') {
      setTrade(updateResult({...trade,targetPrice:b.close}));
    } else if(tool==='line') {
      setLines([...lines,{marker_type:'line',timestamp:tOf(b),price:b.close,timeframe:tf,note:'Level'}]);
    }
  }

  function applyStopStrategy(strategy:StopStrategy, fixedPercent=trade.fixedPercent, atrMultiple=trade.atrMultiple){
    const entryBar = trade.entryTime ? bars.find(b=>tOf(b)===trade.entryTime) : undefined;
    const entry = trade.entryPrice;
    const previous = trade;
    const temp = {...previous, stopStrategy: strategy, fixedPercent, atrMultiple};
    if(entry && entryBar){
      const currentTrade = trade;
      const nextStop = strategy==='first_candle_low' ? firstCandle?.low : strategy==='entry_candle_low' ? entryBar.low : strategy==='fixed_percent' ? entry*(1-fixedPercent/100) : strategy==='atr_multiple' && metrics.atr14_dollars ? entry-(metrics.atr14_dollars*atrMultiple) : currentTrade.stopPrice;
      setTrade(updateResult({...temp, stopPrice: nextStop}));
    } else {
      setTrade(temp);
    }
  }

  function resetTrade(){setTrade({id:id(),status:'draft',stopStrategy:'first_candle_low',fixedPercent:3,atrMultiple:1}); setLines([])}
  async function saveTrade(){
    if(!trade.entryPrice){setError('Bitte zuerst Entry im Chart markieren.');return}
    const payload={ticker,setup_name:setupName,label_class:form.label_class,structure:form.structure,trigger:form.trigger,tactic:form.tactic,level_name:form.level_name,orderly_rating:num(form.orderly_rating),result_r:trade.resultR,result_is_hypothetical:!!form.result_is_hypothetical,mfe_r:num(form.mfe_r),mae_r:num(form.mae_r),notes:form.notes,cutoff_timestamp:`${date} ${cutoff||'23:59:59'} ET`,was_playback_enforced:true};
    try{
      const r=await api('/labels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const markerPayloads:MarkerDraft[]=[];
      if(trade.entryTime&&trade.entryPrice) markerPayloads.push({marker_type:'entry',timestamp:trade.entryTime,price:trade.entryPrice,timeframe:tf});
      if(trade.exitTime&&trade.exitPrice) markerPayloads.push({marker_type:'exit',timestamp:trade.exitTime,price:trade.exitPrice,timeframe:tf});
      if(trade.stopPrice) markerPayloads.push({marker_type:'stop',timestamp:trade.entryTime||date,price:trade.stopPrice,timeframe:tf,note:trade.stopStrategy});
      if(trade.targetPrice) markerPayloads.push({marker_type:'target',timestamp:trade.entryTime||date,price:trade.targetPrice,timeframe:tf});
      markerPayloads.push(...lines);
      for(const m of markerPayloads){await api('/markers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setup_id:r.id,...m})})}
      setMessage(`Trade gespeichert: ${setupName}`); resetTrade();
    }catch(e:any){setError(e.message)}
  }

  return <div className="appShell">
    <header className="topbar"><div className="brand">Setup‑Miner</div><input className="tickerInput" value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())}/><button className="primary" onClick={()=>loadChart()}>Längsten Chart laden</button><span className="pill">m5 ab Oktober 2020</span><span className="pill">Rate heute: {settings.eodhd_rate_limit?.calls_today??0}/{settings.eodhd_rate_limit?.daily_call_limit??'—'}</span></header>
    <aside className="tools">{(['cursor','entry','exit','stop','target','line'] as const).map(t=><button key={t} className={tool===t?'active':''} onClick={()=>setTool(t)}>{t==='cursor'?'⌖':t==='entry'?'E':t==='exit'?'X':t==='stop'?'S':t==='target'?'T':'／'}</button>)}</aside>
    <main className="chartWrap"><div ref={chartEl} className="chart"/><div className="legend">EMA10 · EMA20 · SMA50 · SMA200 · Volumen</div></main>
    <aside className="panelRight"><section><h2>Chart</h2><label>Datum bis<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Cutoff ET<input value={cutoff} placeholder="10:00:00" onChange={e=>setCutoff(e.target.value)}/></label><div className="tfTabs">{timeframes.map(x=><button key={x.value} className={tf===x.value?'active':''} onClick={()=>setTf(x.value)}>{x.label}</button>)}</div><button onClick={checkM5}>m5 prüfen</button><button onClick={()=>loadChart()}>Chart laden</button></section>
    {error&&<pre className="error">{error}</pre>}{message&&<p className="message">{message}</p>}
    <section><h2>Trade erfassen</h2><div className="tradeStatus">Status: <b>{trade.status}</b></div><label>Stop-Strategie<select value={trade.stopStrategy} onChange={e=>applyStopStrategy(e.target.value as StopStrategy)}><option value="first_candle_low">Low 1. Kerze</option><option value="entry_candle_low">Low Entry-Kerze</option><option value="fixed_percent">Fixer Prozent-Stop</option><option value="atr_multiple">ATR-Multiple</option><option value="manual">Manuell im Chart</option></select></label><label>Fix %<input type="number" value={trade.fixedPercent} onChange={e=>applyStopStrategy(trade.stopStrategy,Number(e.target.value),trade.atrMultiple)}/></label><label>ATR-Multiple<input type="number" step="0.1" value={trade.atrMultiple} onChange={e=>applyStopStrategy(trade.stopStrategy,trade.fixedPercent,Number(e.target.value))}/></label><div className="tradeBox"><div>Entry: <b>{fmt(trade.entryPrice)}</b></div><div>Stop: <b>{fmt(trade.stopPrice)}</b></div><div>Exit: <b>{fmt(trade.exitPrice)}</b></div><div>Risk/share: <b>{fmt(trade.riskPerShare)}</b></div><div>Ergebnis R: <b>{fmt(trade.resultR)}</b></div></div><button className="danger" onClick={resetTrade}>Trade zurücksetzen</button></section>
    <section><h2>Setup-Daten</h2><p className="setupName">{setupName}</p>{[['label_class',['A+','Gut','Neutral','Fehlsignal','Bewusst geskippt']],['structure',structures],['trigger',triggers],['tactic',tactics],['level_name',levels]].map(([k,opts]:any)=><label key={k}>{k}<select value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}>{opts.map((o:string)=><option key={o}>{o}</option>)}</select></label>)}<label>Orderly<input type="number" min="1" max="5" value={form.orderly_rating} onChange={e=>setForm({...form,orderly_rating:e.target.value})}/></label><label><input type="checkbox" checked={form.result_is_hypothetical} onChange={e=>setForm({...form,result_is_hypothetical:e.target.checked})}/> hypothetisch</label><label>MFE R<input type="number" step="0.1" onChange={e=>setForm({...form,mfe_r:e.target.value})}/></label><label>MAE R<input type="number" step="0.1" onChange={e=>setForm({...form,mae_r:e.target.value})}/></label><textarea placeholder="Notiz" onChange={e=>setForm({...form,notes:e.target.value})}/><button className="primary" onClick={saveTrade}>Trade speichern</button></section>
    <section><h2>Kennzahlen</h2><table><tbody>{metricNames.map(n=><tr key={n} className={n==='lod_rule_valid'&&metrics[n]===false?'bad':''}><td>{n}</td><td>{fmt(metrics[n])}</td></tr>)}</tbody></table></section>
    <section><h2>Export</h2><a href={`${BASE}/api/exports/labels.csv`} target="_blank">CSV</a><a href={`${BASE}/api/exports/labels.json`} target="_blank">JSON</a></section></aside>
  </div>
}

createRoot(document.getElementById('root')!).render(<App/>);
