// Freies Zeichen-Werkzeug: Trendlinien per Zwei-Klick-Platzierung (Start
// anklicken, Endpunkt anklicken). Danach frei nachbearbeitbar: beide
// Endpunkte einzeln ziehbar, die Linie als Ganzes verschiebbar (auf den
// Linienkoerper ziehen), einzeln loeschbar (Entf/Backspace auf der zuletzt
// beruehrten Linie) oder alle zusammen ueber "Zeichnungen loeschen". ESC
// bricht einen begonnenen, noch nicht abgeschlossenen Strich ab.
//
// WICHTIG: nutzt eigene DOM-mousedown/-move/-up-Ereignisse statt
// chart.subscribeClick(). Verifiziert per Test: Lightweight Charts fasst
// zwei subscribeClick()-Klicks, die (wie beim zuegigen Setzen zweier
// Linienpunkte typisch) innerhalb der bibliothekseigenen Doppelklick-
// Erkennung liegen, zu einem einzigen dblClick zusammen und unterdrueckt
// dabei BEIDE Einzel-Klick-Events. Rohe Maus-Ereignisse umgehen das, exakt
// wie schon beim Positions-Werkzeug (positiontool.js) aus demselben Grund.
var SM = window.SM = window.SM || {};

SM.drawingArmed = false;
SM.drawings = []; // [{ primitive, t1, p1, t2, p2 }]
SM._pendingDrawPoint = null;
SM._activeDrawing = null; // zuletzt beruehrte Linie (fuer Entf/Backspace)
SM._draggingDrawing = null;

const DRAW_HANDLE_TOLERANCE_PX = 8;
const DRAW_LINE_HIT_TOLERANCE_PX = 6;

SM.armDrawingTool = function () {
  SM.drawingArmed = !SM.drawingArmed;
  SM._pendingDrawPoint = null;
  const btn = SM.$('btnDrawLine');
  if (btn) btn.classList.toggle('active', SM.drawingArmed);
  if (SM.drawingArmed) SM.setMsg('Linie: Startpunkt im Chart anklicken.');
};

SM.cancelPendingDrawing = function () {
  if (SM._pendingDrawPoint) {
    SM._pendingDrawPoint = null;
    SM.setMsg('Linie abgebrochen.');
  }
};

SM.clearDrawings = function () {
  const cs = SM.chartState;
  SM.drawings.forEach((d) => cs.candleSeries.detachPrimitive(d.primitive));
  SM.drawings = [];
  SM._pendingDrawPoint = null;
  SM._activeDrawing = null;
};

SM.deleteActiveDrawing = function () {
  if (!SM._activeDrawing) return;
  const idx = SM.drawings.indexOf(SM._activeDrawing);
  if (idx >= 0) {
    SM.chartState.candleSeries.detachPrimitive(SM._activeDrawing.primitive);
    SM.drawings.splice(idx, 1);
  }
  SM._activeDrawing = null;
  SM.setMsg('Linie geloescht.');
};

SM._drawXY = function (evt) {
  const r = SM.$('chartContainer').getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top };
};

SM._pointToSegmentDist = function (px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

// Liefert {drawing, mode:'p1'|'p2'|'move'} fuer die erste Linie, deren
// Endpunkt oder Koerper sich unter (x,y) befindet - sonst null.
SM._drawingHitTest = function (x, y) {
  const cs = SM.chartState;
  const ts = cs.chart.timeScale();
  for (const d of SM.drawings) {
    const x1 = ts.timeToCoordinate(d.t1), y1 = cs.candleSeries.priceToCoordinate(d.p1);
    const x2 = ts.timeToCoordinate(d.t2), y2 = cs.candleSeries.priceToCoordinate(d.p2);
    if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
    if (Math.hypot(x - x1, y - y1) <= DRAW_HANDLE_TOLERANCE_PX) return { drawing: d, mode: 'p1' };
    if (Math.hypot(x - x2, y - y2) <= DRAW_HANDLE_TOLERANCE_PX) return { drawing: d, mode: 'p2' };
    if (SM._pointToSegmentDist(x, y, x1, y1, x2, y2) <= DRAW_LINE_HIT_TOLERANCE_PX) return { drawing: d, mode: 'move' };
  }
  return null;
};

SM.initDrawingTool = function () {
  const container = SM.$('chartContainer');

  container.addEventListener('mousedown', (e) => {
    const { x, y } = SM._drawXY(e);
    const cs = SM.chartState;
    const ts = cs.chart.timeScale();

    // Bestehende Linien duerfen jederzeit nachbearbeitet werden, auch wenn
    // das Werkzeug gerade nicht zum NEU-Zeichnen armiert ist. Hat Vorrang vor
    // dem Positions-Werkzeug am selben Container (stopImmediatePropagation).
    const hit = SM._drawingHitTest(x, y);
    if (hit) {
      SM._activeDrawing = hit.drawing;
      SM._draggingDrawing = {
        drawing: hit.drawing, mode: hit.mode, startX: x, startY: y,
        origT1: hit.drawing.t1, origP1: hit.drawing.p1, origT2: hit.drawing.t2, origP2: hit.drawing.p2,
      };
      cs.chart.applyOptions({ handleScroll: false, handleScale: false });
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (!SM.drawingArmed) return;
    if (SM.positionArmed || SM.position) return; // Positions-Werkzeug hat sonst Vorrang am selben Container
    const timeUnix = ts.coordinateToTime(x);
    const price = cs.candleSeries.coordinateToPrice(y);
    if (timeUnix == null || price == null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!SM._pendingDrawPoint) {
      SM._pendingDrawPoint = { time: timeUnix, price };
      SM.setMsg('Linie: Endpunkt anklicken (ESC = abbrechen).');
      return;
    }
    const p1 = SM._pendingDrawPoint;
    const primitive = new SM.LineSegmentPrimitive({ color: '#5b9bff', width: 2 });
    cs.candleSeries.attachPrimitive(primitive);
    primitive.setPoints(p1.time, p1.price, timeUnix, price);
    const drawing = { primitive, t1: p1.time, p1: p1.price, t2: timeUnix, p2: price };
    SM.drawings.push(drawing);
    SM._activeDrawing = drawing;
    SM._pendingDrawPoint = null;
    SM.setMsg('Linie gezeichnet - Endpunkte oder die ganze Linie koennen jederzeit gezogen werden (Entf loescht die zuletzt beruehrte Linie).');
  });

  container.addEventListener('mousemove', (e) => {
    if (!SM._draggingDrawing) return;
    const { x, y } = SM._drawXY(e);
    const cs = SM.chartState;
    const ts = cs.chart.timeScale();
    const dr = SM._draggingDrawing;
    const d = dr.drawing;
    if (dr.mode === 'p1' || dr.mode === 'p2') {
      const t = ts.coordinateToTime(x);
      const p = cs.candleSeries.coordinateToPrice(y);
      if (t != null && p != null) {
        if (dr.mode === 'p1') { d.t1 = t; d.p1 = p; } else { d.t2 = t; d.p2 = p; }
      }
    } else if (dr.mode === 'move') {
      const x1 = ts.timeToCoordinate(dr.origT1), y1 = cs.candleSeries.priceToCoordinate(dr.origP1);
      const x2 = ts.timeToCoordinate(dr.origT2), y2 = cs.candleSeries.priceToCoordinate(dr.origP2);
      if (x1 != null && y1 != null && x2 != null && y2 != null) {
        const dx = x - dr.startX, dy = y - dr.startY;
        const nt1 = ts.coordinateToTime(x1 + dx), np1 = cs.candleSeries.coordinateToPrice(y1 + dy);
        const nt2 = ts.coordinateToTime(x2 + dx), np2 = cs.candleSeries.coordinateToPrice(y2 + dy);
        if (nt1 != null && np1 != null && nt2 != null && np2 != null) {
          d.t1 = nt1; d.p1 = np1; d.t2 = nt2; d.p2 = np2;
        }
      }
    }
    d.primitive.setPoints(d.t1, d.p1, d.t2, d.p2);
  });

  window.addEventListener('mouseup', () => {
    if (!SM._draggingDrawing) return;
    SM._draggingDrawing = null;
    SM.chartState.chart.applyOptions({ handleScroll: true, handleScale: true });
  });
};
