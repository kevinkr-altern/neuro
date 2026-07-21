// Retrospektive Trade-Simulation: fuer gespeicherte Labels wird berechnet,
// welches Ergebnis (R-Multiple) ALTERNATIVE Stop-Strategien und ein
// ORB-Durchbruch-Entry (M5/M15/M30) tatsaechlich gebracht haetten - sowohl
// pro Einzeltrade (Trade-Uebersicht) als auch aggregiert ueber alle Trades
// (Analyse-Seite). Rein clientseitig aus dem bestehenden, unveraenderten
// /api/chart-data-Pfad (keine neue Backend-Logik). Look-ahead ist hier
// unbedenklich: die Simulation laeuft ausschliesslich ueber bereits
// abgeschlossene Historie, exakt wie die bestehenden MFE/MAE-Kennzahlen -
// nichts davon fliesst in Kennzahlen-/Modell-Input ein.
var SM = window.SM = window.SM || {};

SM.SIM_STOP_VARIANTS = ['fixed_ema10_prevday', 'fixed_ema20_prevday', 'close_below_ema10', 'close_below_ema20'];
SM.SIM_STOP_LABELS = {
  fixed_ema10_prevday: 'EMA10 Vortag (fest)', fixed_ema20_prevday: 'EMA20 Vortag (fest)',
  close_below_ema10: 'Close < EMA10', close_below_ema20: 'Close < EMA20',
};
SM.SIM_ORB_KEYS = ['m5', 'm15', 'm30'];
SM.SIM_ORB_LABELS = { m5: 'ORB M5 Durchbruch', m15: 'ORB M15 Durchbruch', m30: 'ORB M30 Durchbruch' };
SM.SIM_HORIZON_DAYS = 270;

SM._simDailyCache = {};
SM.simFetchDaily = function (ticker, fromDate) {
  const key = ticker + '|' + fromDate;
  if (!SM._simDailyCache[key]) {
    const to = new Date(fromDate + 'T00:00:00Z');
    to.setUTCDate(to.getUTCDate() + SM.SIM_HORIZON_DAYS);
    SM._simDailyCache[key] = SM.getChartData(ticker, '1d', fromDate, to.toISOString().slice(0, 10)).catch(() => null);
  }
  return SM._simDailyCache[key];
};

SM._sim5mCache = {};
SM.simFetch5m = function (ticker, date) {
  const key = ticker + '|' + date;
  if (!SM._sim5mCache[key]) SM._sim5mCache[key] = SM.getChartData(ticker, '5m', date, date).catch(() => null);
  return SM._sim5mCache[key];
};

// Chronologische Simulations-Zeitachse: Entry-Tag in 5-Minuten-Aufloesung AB
// dem tatsaechlichen Start-Zeitpunkt (verhindert, dass ein Tagestief/-hoch
// VOR dem Entry faelschlich als Treffer gilt), danach Tages-Kerzen ab dem
// naechsten Kalendertag.
SM._simTimeline = async function (ticker, entryDate, startUnix, dailyBars) {
  const timeline = [];
  const r5m = await SM.simFetch5m(ticker, entryDate);
  if (r5m && r5m.bars) {
    for (const b of r5m.bars) {
      if (SM.toUnixTime(b.time) < startUnix) continue;
      timeline.push({ low: b.low, high: b.high, close: b.close, dayIso: b.time.slice(0, 10) });
    }
  }
  for (const b of dailyBars) {
    if (b.time <= entryDate) continue;
    timeline.push({ low: b.low, high: b.high, close: b.close, dayIso: b.time });
  }
  return timeline;
};

// Kern-Walker: 'fixed_*' prueft Stop/Ziel klassisch (Low<=Stop bzw.
// High>=Ziel). 'close_below_*' ist ein reiner Trailing-Stop OHNE
// Ziel-Pruefung - exakt wie SM._checkDynamicStopStrategy im echten
// Positions-Werkzeug ("den Gewinn laufen lassen").
SM._simWalk = function (timeline, entryPrice, stopPrice, targetPrice, isDynamic, emaByDay) {
  const riskUnit = entryPrice - stopPrice;
  if (!(riskUnit > 0) || !timeline.length) return null;
  if (isDynamic) {
    for (const pt of timeline) {
      const ema = emaByDay[pt.dayIso];
      if (ema == null) continue;
      if (pt.close < ema) return (pt.close - entryPrice) / riskUnit;
    }
    return (timeline[timeline.length - 1].close - entryPrice) / riskUnit;
  }
  for (const pt of timeline) {
    if (pt.low <= stopPrice) return (stopPrice - entryPrice) / riskUnit;
    if (targetPrice != null && pt.high >= targetPrice) return (targetPrice - entryPrice) / riskUnit;
  }
  return (timeline[timeline.length - 1].close - entryPrice) / riskUnit;
};

SM._simEmaByDay = function (dailyIndicators, emaKey) {
  const m = {};
  (dailyIndicators[emaKey] || []).forEach((p) => { m[p.time] = p.value; });
  return m;
};

SM._simEmaBefore = function (dailyIndicators, emaKey, dateIsoExclusive) {
  const series = dailyIndicators[emaKey] || [];
  let prev = null;
  for (const p of series) { if (p.time >= dateIsoExclusive) break; prev = p; }
  return prev ? prev.value : null;
};

// Original-Entry, ALTERNATIVE Stop-Strategie. Ziel bleibt am Original-
// R-Multiple ausgerichtet, damit unterschiedliche Stop-Distanzen fair
// (gleiches beabsichtigtes R) verglichen werden.
SM.simulateStopVariant = async function (label, variant) {
  if (label.entry_price == null || label.stop_price == null || !label.entry_date || !label.ticker) return null;
  const rDaily = await SM.simFetchDaily(label.ticker, label.entry_date);
  if (!rDaily || !rDaily.bars) return null;
  const origRisk = label.entry_price - label.stop_price;
  if (!(origRisk > 0)) return null;
  const rr = label.target_price != null ? (label.target_price - label.entry_price) / origRisk : SM.DEFAULT_RR;
  const isDynamic = variant === 'close_below_ema10' || variant === 'close_below_ema20';
  const emaKey = (variant === 'fixed_ema10_prevday' || variant === 'close_below_ema10') ? 'ema10' : 'ema20';
  const entryStartUnix = SM.toUnixTime(`${label.entry_date}T${label.entry_time || '09:30:00'}`);
  const timeline = await SM._simTimeline(label.ticker, label.entry_date, entryStartUnix, rDaily.bars);

  let stopPrice = label.stop_price;
  let target = label.target_price;
  if (!isDynamic) {
    const emaBefore = SM._simEmaBefore(rDaily.indicators, emaKey, label.entry_date);
    if (emaBefore != null && emaBefore < label.entry_price) stopPrice = emaBefore;
    const riskUnit = label.entry_price - stopPrice;
    if (!(riskUnit > 0)) return null;
    target = label.entry_price + riskUnit * rr;
  }
  const emaByDay = isDynamic ? SM._simEmaByDay(rDaily.indicators, emaKey) : null;
  return SM._simWalk(timeline, label.entry_price, stopPrice, target, isDynamic, emaByDay);
};

// Alternativer Entry ueber ORB-Durchbruch (M5/M15/M30) am selben Handelstag,
// Stop unter dem Opening-Range-Tief (Standard-ORB-Risikomanagement), Ziel am
// Original-R-Multiple. optStopVariant (optional) kombiniert zusaetzlich mit
// einer alternativen Stop-Strategie statt des ORB-Tiefs.
SM.simulateOrbEntryVariant = async function (label, orbKey, optStopVariant) {
  if (label.entry_price == null || label.stop_price == null || !label.entry_date || !label.ticker) return null;
  const r5mEntryDay = await SM.simFetch5m(label.ticker, label.entry_date);
  if (!r5mEntryDay || !r5mEntryDay.bars || !r5mEntryDay.bars.length) return null;
  const windows = SM.computeOrbWindows(r5mEntryDay.bars);
  const w = windows[orbKey];
  if (!w) return null;
  const breakoutBar = r5mEntryDay.bars.find((b) => SM.toUnixTime(b.time) >= w.toUnix && b.high >= w.high);
  if (!breakoutBar) return null;
  const entryPrice = w.high;
  const origRisk = label.entry_price - label.stop_price;
  const rr = (origRisk > 0 && label.target_price != null) ? (label.target_price - label.entry_price) / origRisk : SM.DEFAULT_RR;

  const rDaily = await SM.simFetchDaily(label.ticker, label.entry_date);
  if (!rDaily || !rDaily.bars) return null;
  const breakoutUnix = SM.toUnixTime(breakoutBar.time);
  const timeline = await SM._simTimeline(label.ticker, label.entry_date, breakoutUnix, rDaily.bars);

  if (!optStopVariant) {
    const riskUnit = entryPrice - w.low;
    if (!(riskUnit > 0)) return null;
    const target = entryPrice + riskUnit * rr;
    return SM._simWalk(timeline, entryPrice, w.low, target, false, null);
  }
  const isDynamic = optStopVariant === 'close_below_ema10' || optStopVariant === 'close_below_ema20';
  const emaKey = (optStopVariant === 'fixed_ema10_prevday' || optStopVariant === 'close_below_ema10') ? 'ema10' : 'ema20';
  let stopPrice = w.low;
  let target = null;
  if (!isDynamic) {
    const emaBefore = SM._simEmaBefore(rDaily.indicators, emaKey, label.entry_date);
    if (emaBefore != null && emaBefore < entryPrice) stopPrice = emaBefore;
    const riskUnit = entryPrice - stopPrice;
    if (!(riskUnit > 0)) return null;
    target = entryPrice + riskUnit * rr;
  }
  const emaByDay = isDynamic ? SM._simEmaByDay(rDaily.indicators, emaKey) : null;
  return SM._simWalk(timeline, entryPrice, stopPrice, target, isDynamic, emaByDay);
};

SM._simSummarize = function (arr) {
  if (!arr.length) return null;
  const avgR = arr.reduce((s, v) => s + v, 0) / arr.length;
  const wins = arr.filter((v) => v > 0).length;
  return { n: arr.length, avgR, winRate: (wins / arr.length) * 100 };
};

// Alle Varianten fuer EINEN Trade (Detail-Ansicht in der Trade-Uebersicht).
SM.simulateTrade = async function (label) {
  const stops = {};
  for (const v of SM.SIM_STOP_VARIANTS) stops[v] = await SM.simulateStopVariant(label, v);
  const orbs = {};
  for (const k of SM.SIM_ORB_KEYS) orbs[k] = await SM.simulateOrbEntryVariant(label, k);
  return { origR: label.result_r, stops, orbs };
};

// Portfolio-weite Aggregation ueber ALLE Labels mit ausreichenden Feldern (Analyse-Seite).
SM.runPortfolioSimulation = async function (labels) {
  const usable = labels.filter((l) => l.entry_price != null && l.stop_price != null && l.entry_date && l.ticker);
  const origResults = usable.filter((l) => l.result_r != null).map((l) => l.result_r);
  const stopResults = {}; SM.SIM_STOP_VARIANTS.forEach((v) => { stopResults[v] = []; });
  const orbResults = {}; SM.SIM_ORB_KEYS.forEach((k) => { orbResults[k] = []; });
  const comboResults = {};
  SM.SIM_ORB_KEYS.forEach((k) => { comboResults[k] = {}; SM.SIM_STOP_VARIANTS.forEach((v) => { comboResults[k][v] = []; }); });

  for (const l of usable) {
    for (const v of SM.SIM_STOP_VARIANTS) {
      const r = await SM.simulateStopVariant(l, v);
      if (r != null) stopResults[v].push(r);
    }
    for (const k of SM.SIM_ORB_KEYS) {
      const r = await SM.simulateOrbEntryVariant(l, k);
      if (r != null) orbResults[k].push(r);
      for (const v of SM.SIM_STOP_VARIANTS) {
        const rc = await SM.simulateOrbEntryVariant(l, k, v);
        if (rc != null) comboResults[k][v].push(rc);
      }
    }
  }

  return {
    orig: SM._simSummarize(origResults),
    stops: Object.fromEntries(SM.SIM_STOP_VARIANTS.map((v) => [v, SM._simSummarize(stopResults[v])])),
    orbs: Object.fromEntries(SM.SIM_ORB_KEYS.map((k) => [k, SM._simSummarize(orbResults[k])])),
    combos: Object.fromEntries(SM.SIM_ORB_KEYS.map((k) => [k, Object.fromEntries(SM.SIM_STOP_VARIANTS.map((v) => [v, SM._simSummarize(comboResults[k][v])]))])),
  };
};

// Markt-Zustand (QQQ-Trend, Standard-Regel wie der Chart-Streifen) fuer ein
// Entry-Datum - fuer die Analyse-Aufschluesselung "nach Markt-Zustand".
SM._simMarketStateCache = {};
SM.simMarketStateFor = async function (dateIso) {
  if (SM._simMarketStateCache[dateIso] !== undefined) return SM._simMarketStateCache[dateIso];
  const from = new Date(dateIso + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - 60);
  let r;
  try { r = await SM.getChartData(SM.MARKET_STATE_TICKER, '1d', from.toISOString().slice(0, 10), dateIso); }
  catch (e) { SM._simMarketStateCache[dateIso] = null; return null; }
  const bars = (r.bars || []).filter((b) => b.time <= dateIso);
  const bar = bars[bars.length - 1];
  const series10 = r.indicators.ema10 || [];
  const series20 = r.indicators.ema20 || [];
  const ema10 = series10.length ? series10[series10.length - 1].value : null;
  const ema20 = series20.length ? series20[series20.length - 1].value : null;
  let state = null;
  if (bar && ema10 != null && ema20 != null) {
    const color = SM._marketStateColor(bar.close, ema10, ema20);
    state = color === '#3ddc84' ? 'Bullisch' : (color === '#ff5c5c' ? 'Bearisch' : 'Neutral');
  }
  SM._simMarketStateCache[dateIso] = state;
  return state;
};
