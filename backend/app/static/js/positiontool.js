// Echtes, mit der Maus ziehbares Positions-Werkzeug (Zielbox/Stopbox/PnL-
// Tooltip wie im TradingView-Long-Position-Werkzeug). Lightweight Charts v5
// hat KEIN natives Drag-System (bestaetigt gegen die vendorte typings.d.ts:
// nur subscribeClick/subscribeDblClick/subscribeCrosshairMove) - deshalb
// eigene DOM-mousedown/mousemove/mouseup-Ereignisse mit eigener
// Trefferpruefung ueber die Koordinaten-Umrechnung der Bibliothek
// (priceToCoordinate/timeToCoordinate und deren Umkehrfunktionen).
// Erstversion: nur Long (Ziel oben, Stop unten, wie im Screenshot).
var SM = window.SM = window.SM || {};

SM.position = null; // {entryTimeUnix, entryPrice, stopPrice, targetPrice, exitTimeUnix, qty, rectTarget, rectStop, dragging}
SM.positionArmed = false;
SM.DEFAULT_RR = 2;
SM.DEFAULT_QTY = 100;
const POS_HANDLE_TOLERANCE_PX = 8;

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
  // Deutlich markierte Entry-Linie - vorher war nur die Grenze zwischen den
  // beiden Zonen implizit "der Entry", ohne eigene Beschriftung.
  SM.setReferenceLineGroup('position', [
    { price: p.entryPrice, color: '#4dabf7', title: p.closedReason ? 'Entry (zu)' : 'Entry' },
  ]);
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
  SM.setReferenceLineGroup('position', []);
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
  SM.setMsg(`Position geschlossen (${reasonText}) am ${exitDateIso}. Kennzahlen fuer den Entry-Tag werden geladen - danach im Label-Tab pruefen und "Label speichern" klicken.`, p.closedReason === 'stop' ? 'warn' : 'msg');
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
    const statusText = p.closedReason ? ` — GESCHLOSSEN (${p.closedReason === 'stop' ? 'Stop' : p.closedReason === 'target' ? 'Ziel' : 'manuell'})` : '';
    ttEl.textContent = `Open PnL: ${openPnl.toFixed(2)}, Qty: ${p.qty}, R:R ${rr.toFixed(2)}${statusText}`;
  } else ttEl.style.display = 'none';
};

SM._hidePositionOverlay = function () {
  ['posTargetLabel', 'posStopLabel', 'posTooltip'].forEach((id) => { const el = SM.$(id); if (el) el.style.display = 'none'; });
};

SM._commitPositionToForm = function () {
  const p = SM.position; if (!p) return;
  if (SM.$('entry_price')) SM.$('entry_price').value = p.entryPrice.toFixed(2);
  if (SM.$('stop_price')) SM.$('stop_price').value = p.stopPrice.toFixed(2);
  if (SM.$('target_price')) SM.$('target_price').value = p.targetPrice.toFixed(2);
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

SM._posHandleHit = function (x, y) {
  if (!SM.position) return null;
  const cs = SM.chartState;
  const ts = cs.chart.timeScale();
  const exitX = ts.timeToCoordinate(SM.position.exitTimeUnix);
  if (exitX == null) return null;
  const stopY = cs.candleSeries.priceToCoordinate(SM.position.stopPrice);
  const targetY = cs.candleSeries.priceToCoordinate(SM.position.targetPrice);
  if (stopY != null && Math.abs(x - exitX) <= POS_HANDLE_TOLERANCE_PX && Math.abs(y - stopY) <= POS_HANDLE_TOLERANCE_PX) return 'stop';
  if (targetY != null && Math.abs(x - exitX) <= POS_HANDLE_TOLERANCE_PX && Math.abs(y - targetY) <= POS_HANDLE_TOLERANCE_PX) return 'target';
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
      SM.position = {
        entryTimeUnix, entryPrice: price,
        stopPrice: price - seedRisk, targetPrice: price + seedRisk * SM.DEFAULT_RR,
        exitTimeUnix: SM._defaultExitTimeUnix(entryTimeUnix), exitPrice: null, closedReason: null,
        qty: SM.DEFAULT_QTY, dragging: 'stop',
      };
      const rects = SM._createPositionRects();
      SM.position.rectTarget = rects.rectTarget; SM.position.rectStop = rects.rectStop;
      SM.chartState.chart.applyOptions({ handleScroll: false, handleScale: false });
      SM._updatePositionRects();
      e.preventDefault();
    }
  });

  container.addEventListener('mousemove', (e) => {
    if (!SM.position || !SM.position.dragging) return;
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
