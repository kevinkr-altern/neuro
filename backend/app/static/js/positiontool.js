// Echtes, mit der Maus ziehbares Positions-Werkzeug (Zielbox/Stopbox/PnL-
// Tooltip wie im TradingView-Long-Position-Werkzeug). Lightweight Charts v5
// hat KEIN natives Drag-System (bestaetigt gegen die vendorte typings.d.ts:
// nur subscribeClick/subscribeDblClick/subscribeCrosshairMove) - deshalb
// eigene DOM-mousedown/mousemove/mouseup-Ereignisse mit eigener
// Trefferpruefung ueber die Koordinaten-Umrechnung der Bibliothek
// (priceToCoordinate/timeToCoordinate und deren Umkehrfunktionen).
// Erstversion: nur Long (Ziel oben, Stop unten, wie im Screenshot).
var SM = window.SM = window.SM || {};

SM.position = null; // {entryTimeUnix, entryPrice, stopPrice, targetPrice, exitTimeUnix, qty, stopStrategy, rectTarget, rectStop, dragging}
SM.positionArmed = false;
SM.DEFAULT_RR = 2;
SM.DEFAULT_QTY = 100;
const POS_HANDLE_TOLERANCE_PX = 8;

// ---------- Stop-Strategien: "harter Stopp" = einmalig bei Entry berechneter
// fester Preis (EMA10/20 des VORTAGS), "Close < EMA" = taeglich neu bewertete
// Regel (kein fester Preis - der Trade schliesst am ersten Tag, dessen
// eigener Schlusskurs unter seine EIGENE, an dem Tag geltende EMA faellt).
// Beide EMA-Varianten nutzen die taegliche EMA-Serie aus dem D1-Datencache
// (dataCache[ticker]['1d'].indicators), unabhaengig von der aktuell
// angezeigten Zeitebene - dieselbe Wiederverwendung wie bei den MFE/MAE-
// Kennzahlen (_maybeComputeExitMetrics).
SM.STOP_STRATEGIES = {
  none: 'manuell', fixed_ema10_prevday: 'EMA10 Vortag (fest)', close_below_ema10: 'Close < EMA10',
  fixed_ema20_prevday: 'EMA20 Vortag (fest)', close_below_ema20: 'Close < EMA20',
};

SM._dailyEmaSeries = function (emaKey) {
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  const daily = SM.dataCache[ticker] && SM.dataCache[ticker]['1d'];
  return (daily && daily.indicators && daily.indicators[emaKey]) || null;
};

SM._dailyEmaValueBefore = function (emaKey, dateIsoExclusive) {
  const series = SM._dailyEmaSeries(emaKey);
  if (!series) return null;
  let prev = null;
  for (const pt of series) {
    if (pt.time >= dateIsoExclusive) break;
    prev = pt;
  }
  return prev ? prev.value : null;
};

SM._dailyEmaValueAt = function (emaKey, dateIsoInclusive) {
  const series = SM._dailyEmaSeries(emaKey);
  if (!series) return null;
  let latest = null;
  for (const pt of series) {
    if (pt.time > dateIsoInclusive) break;
    latest = pt;
  }
  return latest ? latest.value : null;
};

SM.armPositionTool = function () {
  SM.positionArmed = !SM.positionArmed;
  const btn = SM.$('btnPositionTool');
  if (btn) btn.classList.toggle('active', SM.positionArmed);
};

SM._posXY = function (evt) {
  const r = SM.$('chartContainer').getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top };
};

// Der Standard-Kasten soll direkt gross/deutlich sichtbar sein (wie bei
// TradingViews Long-Position-Werkzeug). WICHTIG (per Test gefunden): ein
// fester Kerzen-Index-Vorsprung ist blind gegenueber dem aktuellen Zoom - auf
// einem weit herausgezoomten Chart (z.B. nach fitContent() ueber tausende
// Kerzen) wurde der Kasten dadurch nur wenige Pixel breit/hoch und war de
// facto unsichtbar. Deshalb: Breite und Hoehe als Anteil des AKTUELL
// SICHTBAREN Bereichs (Kerzen-Index-Fenster bzw. Preisspanne der sichtbaren
// Kerzen) berechnen, damit der Kasten immer ein sichtbarer, sinnvoller
// Ausschnitt ist, unabhaengig vom Zoom-Level.
SM.POSITION_DEFAULT_WIDTH_FRACTION = 0.18; // Anteil der sichtbaren Kerzen
SM.POSITION_DEFAULT_MIN_BARS_AHEAD = 8;

SM._visibleBarsWindow = function () {
  const bars = SM.chartState.bars;
  if (!bars.length) return [];
  const range = SM.chartState.chart.timeScale().getVisibleLogicalRange();
  if (!range) return bars;
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.min(bars.length - 1, Math.ceil(range.to));
  return from <= to ? bars.slice(from, to + 1) : bars;
};

SM._defaultExitTimeUnix = function (entryTimeUnix) {
  const bars = SM.chartState.bars;
  const fallback = entryTimeUnix + 60 * (SM.TF_SECONDS[SM.chartState.timeframe] || 300);
  if (!bars.length) return fallback;
  const entryIdx = bars.findIndex((b) => SM.toUnixTime(b.time) === entryTimeUnix);
  const baseIdx = entryIdx >= 0 ? entryIdx : bars.length - 1;
  const range = SM.chartState.chart.timeScale().getVisibleLogicalRange();
  const visibleBarCount = range ? Math.max(1, range.to - range.from) : SM.POSITION_DEFAULT_MIN_BARS_AHEAD;
  const barsAhead = Math.max(SM.POSITION_DEFAULT_MIN_BARS_AHEAD, Math.round(visibleBarCount * SM.POSITION_DEFAULT_WIDTH_FRACTION));
  const exitIdx = Math.min(baseIdx + barsAhead, bars.length - 1);
  return exitIdx > baseIdx ? SM.toUnixTime(bars[exitIdx].time) : fallback;
};

// Standard-Risiko (Entry-Stop-Abstand) als Anteil der Preisspanne der
// AKTUELL SICHTBAREN Kerzen - aus demselben Grund wie oben (ein fester %-Satz
// vom Einstiegspreis war auf einem weit herausgezoomten Chart mit riesiger
// Preisskala nur ein paar Pixel hoch).
SM._defaultSeedRisk = function (price) {
  const win = SM._visibleBarsWindow();
  if (win.length) {
    const lo = Math.min(...win.map((b) => b.low));
    const hi = Math.max(...win.map((b) => b.high));
    const span = hi - lo;
    if (span > 0) return Math.max(span * 0.08, price * 0.001);
  }
  return Math.max(price * 0.01, 0.01);
};

SM._snapToBar = function (timeUnix) {
  const bars = SM.chartState.bars;
  if (!bars.length) return timeUnix;
  let best = bars[0], bestDiff = Infinity;
  for (const b of bars) {
    const d = Math.abs(SM.toUnixTime(b.time) - timeUnix);
    if (d < bestDiff) { bestDiff = d; best = b; }
  }
  return SM.toUnixTime(best.time);
};

SM._createPositionRects = function () {
  const cs = SM.chartState;
  const rectTarget = new SM.RectPrimitive({ fillColor: 'rgba(38,166,91,0.38)', borderColor: '#26a65b', borderWidth: 1 });
  const rectStop = new SM.RectPrimitive({ fillColor: 'rgba(184,38,38,0.38)', borderColor: '#c23a3a', borderWidth: 1 });
  cs.candleSeries.attachPrimitive(rectTarget);
  cs.candleSeries.attachPrimitive(rectStop);
  return { rectTarget, rectStop };
};

SM._updatePositionRects = function () {
  const p = SM.position;
  if (!p) return;
  p.rectTarget.setBounds(p.entryTimeUnix, p.exitTimeUnix, p.entryPrice, p.targetPrice);
  p.rectStop.setBounds(p.entryTimeUnix, p.exitTimeUnix, p.stopPrice, p.entryPrice);
  SM._updatePositionOverlay();
  SM._commitPositionToForm();
  SM._updateOrbBreakoutResults();
};

SM.clearPosition = function () {
  if (SM.position) {
    SM.chartState.candleSeries.detachPrimitive(SM.position.rectTarget);
    SM.chartState.candleSeries.detachPrimitive(SM.position.rectStop);
  }
  SM.position = null;
  SM._hidePositionOverlay();
  const chartEl = SM.$('chartContainer');
  if (chartEl) chartEl.style.cursor = '';
  const el = SM.$('posOrbResults');
  if (el) el.style.display = 'none';
};

// ---------- Automatisches Schliessen (Stop/Ziel erreicht) + manuelles
// Schliessen + Speicher-Uebergabe an das bestehende Label-Formular ----------
// Sobald geschlossen, ist der Kasten eingefroren (keine Griffe mehr aktiv)
// und ein Klick mit weiterhin aktivem Positions-Werkzeug startet eine neue
// Position, statt nichts zu tun.

SM._nearestBar = function (timeUnix) {
  const bars = SM.chartState.bars;
  if (!bars.length) return null;
  let best = bars[0], bestDiff = Infinity;
  for (const b of bars) {
    const d = Math.abs(SM.toUnixTime(b.time) - timeUnix);
    if (d < bestDiff) { bestDiff = d; best = b; }
  }
  return best;
};

// Wird bei jedem Fortschritt der (grossen) Replay-Position aufgerufen (siehe
// replay.js/updateReplayPosLabel). Prueft ALLE bereits aufgedeckten Kerzen ab
// dem Entry: sobald eine Kerze den Stop oder das Ziel beruehrt, wird GENAU
// DORT geschlossen ("der Trade soll da enden, wo der Stop ausgeloest wurde") -
// unabhaengig davon, wohin der Exit-Griff manuell gezogen wurde.
SM._maybeAutoCloseOnStop = function () {
  const p = SM.position;
  if (!p || p.closedReason) return;
  if (p.stopStrategy === 'close_below_ema10' || p.stopStrategy === 'close_below_ema20') {
    SM._checkDynamicStopStrategy(p);
    return;
  }
  const bars = SM.chartState.bars;
  const revealIndex = SM.replay.revealIndex;
  if (revealIndex == null || revealIndex < 0) return;
  for (let i = 0; i < bars.length && i <= revealIndex; i++) {
    const b = bars[i];
    const t = SM.toUnixTime(b.time);
    if (t < p.entryTimeUnix) continue;
    if (b.low <= p.stopPrice) { p.exitTimeUnix = t; p.exitPrice = p.stopPrice; p.closedReason = 'stop'; break; }
    if (b.high >= p.targetPrice) { p.exitTimeUnix = t; p.exitPrice = p.targetPrice; p.closedReason = 'target'; break; }
  }
  if (p.closedReason) {
    SM._updatePositionRects();
    SM._finalizeClosedPosition(p.closedReason === 'stop' ? 'Stop ausgeloest' : 'Ziel erreicht');
  }
};

// Dynamische Stop-Strategien (Close < EMA10/20): kein fester Preis, sondern
// eine taeglich neu bewertete Regel. Die Stop-Linie wird optisch auf den
// jeweils aktuellen EMA-Stand nachgefuehrt ("der Stop bewegt sich mit der
// EMA"), UND es wird geprueft, ob ein bereits aufgedeckter Tag mit seinem
// Schlusskurs unter seine EIGENE (an dem Tag geltende) EMA gefallen ist - nur
// bis zur aktuellen Replay-Position (SM.replay.positionTime), damit keine
// zukuenftigen Tage einfliessen (Look-ahead-Schutz).
SM._checkDynamicStopStrategy = function (p) {
  if (!SM.replay.positionTime) return;
  const emaKey = p.stopStrategy === 'close_below_ema10' ? 'ema10' : 'ema20';
  const series = SM._dailyEmaSeries(emaKey);
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  const daily = SM.dataCache[ticker] && SM.dataCache[ticker]['1d'];
  if (!series || !daily) return;
  const emaByTime = {};
  series.forEach((pt) => { emaByTime[pt.time] = pt.value; });
  const entryDateIso = new Date(p.entryTimeUnix * 1000).toISOString().slice(0, 10);
  const asOfDateIso = SM.replay.positionTime.slice(0, 10);
  const bars = daily.bars.filter((b) => b.time >= entryDateIso && b.time <= asOfDateIso);
  let breach = null;
  let latestEma = null;
  for (const b of bars) {
    const ema = emaByTime[b.time];
    if (ema == null) continue;
    latestEma = ema;
    if (!breach && b.close < ema) breach = { timeUnix: SM.toUnixTime(b.time), exitPrice: b.close };
  }
  if (breach) {
    p.exitTimeUnix = breach.timeUnix; p.exitPrice = breach.exitPrice; p.closedReason = 'stop_strategy';
    SM._updatePositionRects();
    SM._finalizeClosedPosition(`Stop-Strategie ausgeloest (${SM.STOP_STRATEGIES[p.stopStrategy]})`);
    return;
  }
  if (latestEma != null && latestEma !== p.stopPrice) {
    p.stopPrice = latestEma;
    SM._updatePositionRects();
  }
};

SM.closePositionManually = function () {
  const p = SM.position;
  if (!p || p.closedReason) return;
  const exitBar = SM._nearestBar(p.exitTimeUnix);
  p.exitPrice = exitBar ? exitBar.close : p.entryPrice;
  p.closedReason = 'manual';
  SM._updatePositionRects();
  SM._finalizeClosedPosition('manuell geschlossen');
};

// Nach dem Schliessen: Kennzahlen fuer den Entry-Tag laden (wie "Setup hier
// markieren", derselbe look-ahead-sichere Pfad) und in den Label-Tab
// wechseln, damit "Label speichern" (bestehender Button) sofort funktioniert -
// die Trades werden also im bestehenden Label-/Setup-Speicher abgelegt statt
// in einem neuen, separaten "Trades"-Konzept.
SM._finalizeClosedPosition = async function (reasonText) {
  const p = SM.position;
  if (!p) return;
  SM._maybeComputeExitMetrics();
  const exitDateIso = new Date(p.exitTimeUnix * 1000).toISOString().slice(0, 10);
  const entryDateIso = new Date(p.entryTimeUnix * 1000).toISOString().slice(0, 10);
  const isIntraday = SM.chartState.timeframe !== '1d' && SM.chartState.timeframe !== '1w';
  const cutoff = isIntraday ? new Date(p.entryTimeUnix * 1000).toISOString().slice(11, 19) : '16:00:00';
  const isStopClose = p.closedReason === 'stop' || p.closedReason === 'stop_strategy';
  SM.setMsg(`Position geschlossen (${reasonText}) am ${exitDateIso}. Kennzahlen fuer den Entry-Tag werden geladen - danach im Label-Tab pruefen und "Label speichern" klicken.`, isStopClose ? 'warn' : 'msg');
  try {
    const ticker = SM.$('ticker').value.trim().toUpperCase();
    const r = await SM.getChartCutoff(ticker, entryDateIso, '5m', cutoff);
    SM.metrics = r.metrics || {};
    SM.fillMetricsTable();
    SM.lastEntryDate = entryDateIso;
    SM.lastCutoff = cutoff;
  } catch (e) { /* Kennzahlen bleiben leer - Formularfelder aus der Position sind trotzdem gesetzt */ }
  document.querySelector('[data-tab="label"]').click();
};

// ---------- ORB-Durchbruch-Ergebnisse (R-Multiple, sobald der Kurs waehrend
// des Entry-Tages ueber eine der M5/M15/M30-Opening-Range-Hochs ausbricht) ----------
// Durchbruch bezieht sich per Konvention immer auf dieselbe Session wie die
// Opening Range selbst - deshalb Suche nur in orbState.dayBars (M5-Kerzen des
// Drilldown-Tages), nicht ueber Tagesgrenzen hinweg.

SM._ensureOrbResultsEl = function () {
  let el = SM.$('posOrbResults');
  if (!el) {
    el = document.createElement('div');
    el.id = 'posOrbResults';
    el.className = 'pos-overlay-label pos-orb-results';
    SM.$('chartContainer').appendChild(el);
  }
  return el;
};

SM._updateOrbBreakoutResults = function () {
  const el = SM._ensureOrbResultsEl();
  const p = SM.position;
  const windows = SM.orbState && SM.orbState.windows;
  const dayBars = (SM.orbState && SM.orbState.dayBars) || [];
  if (!p || !windows || !dayBars.length) { el.style.display = 'none'; return; }
  const riskUnit = p.entryPrice - p.stopPrice;
  if (riskUnit <= 0) { el.style.display = 'none'; return; }
  const labels = { m5: 'M5', m15: 'M15', m30: 'M30' };
  const rows = [];
  for (const key of ['m5', 'm15', 'm30']) {
    const w = windows[key];
    if (!w) continue;
    const hit = dayBars.find((b) => {
      const t = SM.toUnixTime(b.time);
      return t >= p.entryTimeUnix && t <= p.exitTimeUnix && b.high >= w.high;
    });
    if (hit) {
      const r = (w.high - p.entryPrice) / riskUnit;
      rows.push(`${labels[key]}-ORB-Break @ ${hit.time.slice(11, 16)}: ${r >= 0 ? '+' : ''}${r.toFixed(2)}R`);
    } else {
      rows.push(`${labels[key]}-ORB-Break: noch nicht erreicht`);
    }
  }
  const ts = SM.chartState.chart.timeScale();
  const x = ts.timeToCoordinate(p.entryTimeUnix);
  const y = SM.chartState.candleSeries.priceToCoordinate(p.targetPrice);
  if (x == null || y == null) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = x + 'px';
  el.style.top = Math.max(0, y - 68) + 'px';
  el.innerHTML = rows.join('<br>');
};

// ---------- DOM-Overlay (Zielbox/Stopbox/Tooltip als einfache <div>s, kein Canvas-Text) ----------

SM._ensurePositionOverlayEls = function () {
  if (SM.$('posTargetLabel')) return;
  const container = SM.$('chartContainer');
  const mk = (id, cls) => { const d = document.createElement('div'); d.id = id; d.className = 'pos-overlay-label ' + cls; container.appendChild(d); return d; };
  mk('posTargetLabel', 'pos-target');
  mk('posStopLabel', 'pos-stop');
  mk('posTooltip', 'pos-tooltip');
  mk('posEntryLabel', 'pos-entry');
};

SM._updatePositionOverlay = function () {
  SM._ensurePositionOverlayEls();
  const p = SM.position; if (!p) return;
  const cs = SM.chartState;
  const ts = cs.chart.timeScale();
  const exitX = ts.timeToCoordinate(p.exitTimeUnix);
  const entryX = ts.timeToCoordinate(p.entryTimeUnix);
  const targetY = cs.candleSeries.priceToCoordinate(p.targetPrice);
  const stopY = cs.candleSeries.priceToCoordinate(p.stopPrice);
  const entryY = cs.candleSeries.priceToCoordinate(p.entryPrice);
  const riskUnit = p.entryPrice - p.stopPrice;
  const rr = riskUnit !== 0 ? (p.targetPrice - p.entryPrice) / riskUnit : 0;
  const targetPct = ((p.targetPrice - p.entryPrice) / p.entryPrice) * 100;
  const stopPct = ((p.stopPrice - p.entryPrice) / p.entryPrice) * 100;
  const targetAmt = (p.targetPrice - p.entryPrice) * p.qty;
  const stopAmt = (p.stopPrice - p.entryPrice) * p.qty;
  const lastPrice = cs.bars.length ? cs.bars[cs.bars.length - 1].close : p.entryPrice;
  const openPnl = (lastPrice - p.entryPrice) * p.qty;

  const tgtEl = SM.$('posTargetLabel');
  if (exitX != null && targetY != null) {
    tgtEl.style.display = 'block'; tgtEl.style.left = exitX + 'px'; tgtEl.style.top = targetY + 'px';
    tgtEl.textContent = `Target: ${p.targetPrice.toFixed(2)} (${targetPct.toFixed(2)}%) ${p.qty}, ${targetAmt.toFixed(2)}`;
  } else tgtEl.style.display = 'none';

  const stopEl = SM.$('posStopLabel');
  if (exitX != null && stopY != null) {
    stopEl.style.display = 'block'; stopEl.style.left = exitX + 'px'; stopEl.style.top = stopY + 'px';
    stopEl.textContent = `Stop: ${p.stopPrice.toFixed(2)} (${stopPct.toFixed(2)}%) ${p.qty}, ${stopAmt.toFixed(2)}`;
  } else stopEl.style.display = 'none';

  const ttEl = SM.$('posTooltip');
  if (entryX != null && entryY != null) {
    ttEl.style.display = 'block'; ttEl.style.left = entryX + 'px'; ttEl.style.top = entryY + 'px';
    const reasonLabels = { stop: 'Stop', target: 'Ziel', stop_strategy: 'Stop-Strategie', manual: 'manuell', saved: 'gespeichert' };
    const statusText = p.closedReason ? ` — GESCHLOSSEN (${reasonLabels[p.closedReason] || p.closedReason})` : '';
    ttEl.textContent = `Open PnL: ${openPnl.toFixed(2)}, Qty: ${p.qty}, R:R ${rr.toFixed(2)}${statusText}`;
  } else ttEl.style.display = 'none';

  // Entry-Preis direkt am Einstiegspunkt selbst - nicht mehr als
  // Preisachsen-Linie (die war frei schwebend rechts am Rand und optisch
  // vom tatsaechlichen Einstiegspunkt in der Mitte des Charts abgekoppelt).
  const entryEl = SM.$('posEntryLabel');
  if (entryX != null && entryY != null) {
    entryEl.style.display = 'block'; entryEl.style.left = entryX + 'px'; entryEl.style.top = entryY + 'px';
    entryEl.textContent = `Entry: ${p.entryPrice.toFixed(2)}${p.closedReason ? ' (zu)' : ''}`;
  } else entryEl.style.display = 'none';
};

SM._hidePositionOverlay = function () {
  ['posTargetLabel', 'posStopLabel', 'posTooltip', 'posEntryLabel'].forEach((id) => { const el = SM.$(id); if (el) el.style.display = 'none'; });
};

SM._commitPositionToForm = function () {
  const p = SM.position; if (!p) return;
  if (SM.$('entry_price')) SM.$('entry_price').value = p.entryPrice.toFixed(2);
  if (SM.$('stop_price')) SM.$('stop_price').value = p.stopPrice.toFixed(2);
  if (SM.$('target_price')) SM.$('target_price').value = p.targetPrice.toFixed(2);
  if (SM.$('stop_strategy') && p.stopStrategy) SM.$('stop_strategy').value = p.stopStrategy;
};

// ---------- Realized R / MFE / MAE (rein clientseitig, aus bereits geladenen Daily-Kerzen) ----------
// Post-Trade-Kennzahl, kein Look-ahead-Verstoss: wird erst berechnet, NACHDEM
// ein Exit-Zeitpunkt per Ziehen festgelegt wurde.

SM._maybeComputeExitMetrics = function () {
  const p = SM.position; if (!p) return;
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  const dailyCache = SM.dataCache[ticker] && SM.dataCache[ticker]['1d'];
  if (!dailyCache) return;
  const entryDate = new Date(p.entryTimeUnix * 1000).toISOString().slice(0, 10);
  const exitDate = new Date(p.exitTimeUnix * 1000).toISOString().slice(0, 10);
  const from = entryDate < exitDate ? entryDate : exitDate;
  const to = entryDate < exitDate ? exitDate : entryDate;
  const windowBars = dailyCache.bars.filter((b) => b.time >= from && b.time <= to);
  const riskUnit = p.entryPrice - p.stopPrice;
  if (!windowBars.length || riskUnit === 0) return;
  const exitPrice = p.exitPrice != null ? p.exitPrice : windowBars[windowBars.length - 1].close;
  const resultR = (exitPrice - p.entryPrice) / riskUnit;
  const mfeR = (Math.max(...windowBars.map((b) => b.high)) - p.entryPrice) / riskUnit;
  const maeR = (p.entryPrice - Math.min(...windowBars.map((b) => b.low))) / riskUnit;
  if (SM.$('result_r')) SM.$('result_r').value = resultR.toFixed(2);
  if (SM.$('mfe_r')) SM.$('mfe_r').value = mfeR.toFixed(2);
  if (SM.$('mae_r')) SM.$('mae_r').value = maeR.toFixed(2);
};

// ---------- Maus-Ereignisse ----------

// Stop-/Ziel-Linien sind ueber ihre GESAMTE Breite greifbar (nicht nur an
// der Kante bei exitX) - wie das Ziehen einer Kastenkante bei TradingView.
// Nur die Exit-Zeit (rechte Kante) bleibt ein schmaler, senkrechter Griff,
// und nur ausserhalb der Stop-/Ziel-Toleranz, damit er ihnen keine Klicks
// wegschnappt.
SM._posHandleHit = function (x, y) {
  if (!SM.position) return null;
  const cs = SM.chartState;
  const ts = cs.chart.timeScale();
  const entryX = ts.timeToCoordinate(SM.position.entryTimeUnix);
  const exitX = ts.timeToCoordinate(SM.position.exitTimeUnix);
  if (exitX == null) return null;
  const stopY = cs.candleSeries.priceToCoordinate(SM.position.stopPrice);
  const targetY = cs.candleSeries.priceToCoordinate(SM.position.targetPrice);
  const xLo = Math.min(entryX != null ? entryX : exitX, exitX) - POS_HANDLE_TOLERANCE_PX;
  const xHi = Math.max(entryX != null ? entryX : exitX, exitX) + POS_HANDLE_TOLERANCE_PX;
  const withinBoxX = x >= xLo && x <= xHi;
  if (stopY != null && withinBoxX && Math.abs(y - stopY) <= POS_HANDLE_TOLERANCE_PX) return 'stop';
  if (targetY != null && withinBoxX && Math.abs(y - targetY) <= POS_HANDLE_TOLERANCE_PX) return 'target';
  if (Math.abs(x - exitX) <= POS_HANDLE_TOLERANCE_PX) return 'exit';
  return null;
};

SM.initPositionTool = function () {
  const container = SM.$('chartContainer');

  container.addEventListener('mousedown', (e) => {
    if (SM.drawingArmed) return; // Zeichen-Werkzeug hat Vorrang am selben Container
    const { x, y } = SM._posXY(e);
    if (SM.position && !SM.position.closedReason) {
      const hit = SM._posHandleHit(x, y);
      if (hit) {
        SM.position.dragging = hit;
        SM.chartState.chart.applyOptions({ handleScroll: false, handleScale: false });
        e.preventDefault();
        return;
      }
    }
    // Positions-Werkzeug weiterhin armiert und keine (oder eine bereits
    // geschlossene) Position -> neue Position starten. Eine geschlossene
    // Position blockiert eine neue nicht mehr ("wenn ich den geschlossen habe
    // ... moechte ich einen neuen anlegen koennen").
    if (SM.positionArmed && (!SM.position || SM.position.closedReason)) {
      if (SM.position) SM.clearPosition();
      const ts = SM.chartState.chart.timeScale();
      const timeUnix = ts.coordinateToTime(x);
      const price = SM.chartState.candleSeries.coordinateToPrice(y);
      if (timeUnix == null || price == null) return;
      const entryTimeUnix = SM._snapToBar(timeUnix);
      const seedRisk = SM._defaultSeedRisk(price);
      const stopStrategy = (SM.$('stopStrategySelect') && SM.$('stopStrategySelect').value) || 'none';
      const entryDateIso = new Date(entryTimeUnix * 1000).toISOString().slice(0, 10);
      let stopPrice = price - seedRisk;
      if (stopStrategy === 'fixed_ema10_prevday' || stopStrategy === 'fixed_ema20_prevday') {
        const emaKey = stopStrategy === 'fixed_ema10_prevday' ? 'ema10' : 'ema20';
        const emaVal = SM._dailyEmaValueBefore(emaKey, entryDateIso);
        if (emaVal != null && emaVal < price) stopPrice = emaVal;
      } else if (stopStrategy === 'close_below_ema10' || stopStrategy === 'close_below_ema20') {
        const emaKey = stopStrategy === 'close_below_ema10' ? 'ema10' : 'ema20';
        const emaVal = SM._dailyEmaValueAt(emaKey, entryDateIso);
        if (emaVal != null && emaVal < price) stopPrice = emaVal;
      }
      const riskUnit = price - stopPrice;
      SM.position = {
        entryTimeUnix, entryPrice: price,
        stopPrice, targetPrice: price + riskUnit * SM.DEFAULT_RR,
        exitTimeUnix: SM._defaultExitTimeUnix(entryTimeUnix), exitPrice: null, closedReason: null,
        stopStrategy, qty: SM.DEFAULT_QTY, dragging: 'stop',
      };
      const rects = SM._createPositionRects();
      SM.position.rectTarget = rects.rectTarget; SM.position.rectStop = rects.rectStop;
      SM.chartState.chart.applyOptions({ handleScroll: false, handleScale: false });
      SM._updatePositionRects();
      // Beim Platzieren mitten in bereits aufgedecktem Replay-Verlauf (z.B.
      // Entry weit links, Replay-Position bereits weit rechts) muessen die
      // dazwischen liegenden, laengst sichtbaren Kerzen SOFORT auf einen
      // Stop-/Ziel-Treffer geprueft werden - sonst wuerde das erst beim
      // naechsten Replay-Fortschritt erkannt, obwohl der Trade retrospektiv
      // betrachtet schon laengst ausgestoppt gewesen waere.
      SM._maybeAutoCloseOnStop();
      e.preventDefault();
    }
  });

  container.addEventListener('mousemove', (e) => {
    if (!SM.position || !SM.position.dragging) {
      // Mauszeiger-Feedback, damit die greifbaren Stop-/Ziel-/Exit-Linien
      // ueberhaupt als solche erkennbar sind (vorher: keinerlei Hinweis,
      // wo genau man klicken/ziehen muss).
      if (SM.position && !SM.position.closedReason) {
        const { x, y } = SM._posXY(e);
        const hit = SM._posHandleHit(x, y);
        container.style.cursor = (hit === 'stop' || hit === 'target') ? 'ns-resize' : (hit === 'exit' ? 'ew-resize' : '');
      } else if (container.style.cursor) {
        container.style.cursor = '';
      }
      return;
    }
    const { x, y } = SM._posXY(e);
    const ts = SM.chartState.chart.timeScale();
    if (SM.position.dragging === 'stop') {
      const price = SM.chartState.candleSeries.coordinateToPrice(y);
      if (price != null && price < SM.position.entryPrice) {
        const riskUnit = SM.position.entryPrice - price;
        SM.position.stopPrice = price;
        SM.position.targetPrice = SM.position.entryPrice + riskUnit * SM.DEFAULT_RR;
      }
    } else if (SM.position.dragging === 'target') {
      const price = SM.chartState.candleSeries.coordinateToPrice(y);
      if (price != null && price > SM.position.entryPrice) SM.position.targetPrice = price;
    } else if (SM.position.dragging === 'exit') {
      const timeUnix = ts.coordinateToTime(x);
      if (timeUnix != null && timeUnix > SM.position.entryTimeUnix) SM.position.exitTimeUnix = SM._snapToBar(timeUnix);
    }
    SM._updatePositionRects();
  });

  window.addEventListener('mouseup', () => {
    if (!SM.position || !SM.position.dragging) return;
    SM.position.dragging = null;
    SM.chartState.chart.applyOptions({ handleScroll: true, handleScale: true });
    SM._commitPositionToForm();
    SM._maybeComputeExitMetrics();
  });
};
