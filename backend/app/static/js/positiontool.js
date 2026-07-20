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
  const rectTarget = new SM.RectPrimitive({ fillColor: 'rgba(85,217,141,0.18)', borderColor: '#55d98d', borderWidth: 1 });
  const rectStop = new SM.RectPrimitive({ fillColor: 'rgba(255,107,107,0.18)', borderColor: '#ff6b6b', borderWidth: 1 });
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
};

SM.clearPosition = function () {
  if (SM.position) {
    SM.chartState.candleSeries.detachPrimitive(SM.position.rectTarget);
    SM.chartState.candleSeries.detachPrimitive(SM.position.rectStop);
  }
  SM.position = null;
  SM._hidePositionOverlay();
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
    ttEl.textContent = `Open PnL: ${openPnl.toFixed(2)}, Qty: ${p.qty}, R:R ${rr.toFixed(2)}`;
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
  const exitPrice = windowBars[windowBars.length - 1].close;
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
    const { x, y } = SM._posXY(e);
    if (SM.position) {
      const hit = SM._posHandleHit(x, y);
      if (hit) {
        SM.position.dragging = hit;
        SM.chartState.chart.applyOptions({ handleScroll: false, handleScale: false });
        e.preventDefault();
        return;
      }
    }
    if (SM.positionArmed && !SM.position) {
      const ts = SM.chartState.chart.timeScale();
      const timeUnix = ts.coordinateToTime(x);
      const price = SM.chartState.candleSeries.coordinateToPrice(y);
      if (timeUnix == null || price == null) return;
      const entryTimeUnix = SM._snapToBar(timeUnix);
      const seedRisk = Math.max(price * 0.01, 0.01);
      SM.position = {
        entryTimeUnix, entryPrice: price,
        stopPrice: price - seedRisk, targetPrice: price + seedRisk * SM.DEFAULT_RR,
        exitTimeUnix: entryTimeUnix + 5 * 60, qty: SM.DEFAULT_QTY,
        dragging: 'stop',
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
