// Freies Zeichen-Werkzeug: Trendlinien per Zwei-Klick-Platzierung (Start
// anklicken, Endpunkt anklicken). Rein visuell, nur clientseitig gehalten
// (kein Backend/Speicherung) - "Zeichnungen loeschen" entfernt alles wieder.
// ESC bricht einen begonnenen, noch nicht abgeschlossenen Strich ab.
//
// WICHTIG: nutzt eigene DOM-mousedown-Ereignisse statt chart.subscribeClick().
// Verifiziert per Test: Lightweight Charts fasst zwei subscribeClick()-Klicks,
// die (wie beim zuegigen Setzen zweier Linienpunkte typisch) innerhalb der
// bibliothekseigenen Doppelklick-Erkennung liegen, zu einem einzigen
// dblClick zusammen und unterdrueckt dabei BEIDE Einzel-Klick-Events -
// die zweite Anklick-Aktion waere sonst stillschweigend verloren gegangen.
// Rohe mousedown-Ereignisse umgehen diese Zusammenfuehrung, exakt wie schon
// beim Positions-Werkzeug (positiontool.js) aus demselben Grund.
var SM = window.SM = window.SM || {};

SM.drawingArmed = false;
SM.drawings = []; // [{ primitive, t1, p1, t2, p2 }]
SM._pendingDrawPoint = null;

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
};

SM._drawXY = function (evt) {
  const r = SM.$('chartContainer').getBoundingClientRect();
  return { x: evt.clientX - r.left, y: evt.clientY - r.top };
};

SM.initDrawingTool = function () {
  const container = SM.$('chartContainer');
  container.addEventListener('mousedown', (e) => {
    if (!SM.drawingArmed) return;
    // Nicht gleichzeitig mit dem Positions-Werkzeug agieren (beide haengen
    // am selben Container).
    if (SM.positionArmed || SM.position) return;
    const { x, y } = SM._drawXY(e);
    const cs = SM.chartState;
    const timeUnix = cs.chart.timeScale().coordinateToTime(x);
    const price = cs.candleSeries.coordinateToPrice(y);
    if (timeUnix == null || price == null) return;
    e.preventDefault();
    if (!SM._pendingDrawPoint) {
      SM._pendingDrawPoint = { time: timeUnix, price };
      SM.setMsg('Linie: Endpunkt anklicken (ESC = abbrechen).');
      return;
    }
    const p1 = SM._pendingDrawPoint;
    const primitive = new SM.LineSegmentPrimitive({ color: '#5b9bff', width: 2 });
    cs.candleSeries.attachPrimitive(primitive);
    primitive.setPoints(p1.time, p1.price, timeUnix, price);
    SM.drawings.push({ primitive, t1: p1.time, p1: p1.price, t2: timeUnix, p2: price });
    SM._pendingDrawPoint = null;
    SM.setMsg('Linie gezeichnet. Naechster Startpunkt oder Werkzeug abwaehlen.');
  });
};
