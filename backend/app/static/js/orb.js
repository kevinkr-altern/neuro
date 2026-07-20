// ORB-Dreifachbaender (M5+M15+M30 Opening Range gleichzeitig, verschachtelt)
// waehrend des Tag-Drilldowns im Replay. Rein clientseitig aus bereits
// geladenen M5-Kerzen berechnet - kein Backend-Aufruf.
var SM = window.SM = window.SM || {};

SM.orbState = { bands: [] };

SM.minsSinceOpen = function (isoTime) {
  const h = parseInt(isoTime.slice(11, 13), 10);
  const m = parseInt(isoTime.slice(14, 16), 10);
  return (h * 60 + m) - (9 * 60 + 30);
};

SM.computeOrbWindows = function (m5Bars) {
  function windowFor(sizeMin) {
    const win = m5Bars.filter((b) => { const mm = SM.minsSinceOpen(b.time); return mm >= 0 && mm < sizeMin; });
    if (!win.length) return null;
    const fromUnix = SM.toUnixTime(win[0].time);
    return {
      high: Math.max(...win.map((b) => b.high)),
      low: Math.min(...win.map((b) => b.low)),
      fromUnix, toUnix: fromUnix + sizeMin * 60,
    };
  }
  return { m5: windowFor(5), m15: windowFor(15), m30: windowFor(30) };
};

SM.renderOrbBands = function () {
  SM.clearOrbBands();
  const cs = SM.chartState;
  const windows = SM.computeOrbWindows(cs.bars);
  const specs = [
    { key: 'm30', color: 'rgba(77,171,247,0.06)', lineColor: '#4dabf7', label: 'ORB M30' },
    { key: 'm15', color: 'rgba(6,214,160,0.08)', lineColor: '#06d6a0', label: 'ORB M15' },
    { key: 'm5', color: 'rgba(255,209,102,0.12)', lineColor: '#ffd166', label: 'ORB M5' },
  ];
  const lines = [];
  specs.forEach((spec) => {
    const w = windows[spec.key];
    if (!w) return;
    const band = new SM.VerticalBandPrimitive({ fillColor: spec.color });
    cs.candleSeries.attachPrimitive(band);
    band.setRange(w.fromUnix, w.toUnix);
    SM.orbState.bands.push(band);
    lines.push({ price: w.high, color: spec.lineColor, title: spec.label + ' H' });
    lines.push({ price: w.low, color: spec.lineColor, title: spec.label + ' L' });
  });
  SM.setReferenceLineGroup('orb', lines);
};

SM.clearOrbBands = function () {
  const cs = SM.chartState;
  SM.orbState.bands.forEach((b) => cs.candleSeries.detachPrimitive(b));
  SM.orbState.bands = [];
  SM.setReferenceLineGroup('orb', []);
};
