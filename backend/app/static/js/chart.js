// Lightweight-Charts-Lebenszyklus: Candles, Volumen-Overlay, Indikator-Linien,
// Referenz-Preislinien (PDH/PDL/ORB), Marker. Nutzt v5-API (chart.addSeries(Typ, opts)).
var SM = window.SM = window.SM || {};

SM.TF_SECONDS = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400, '1w': 604800 };

SM.chartState = {
  chart: null, candleSeries: null, volumeSeries: null,
  lineSeries: {}, markersApi: null,
  bars: [], indicators: {}, timeframe: '1d',
};

SM.toUnixTime = function (iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
};

SM.barsToSeriesData = function (bars) {
  return bars.map((b) => ({ time: SM.toUnixTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
};

SM.volumeToSeriesData = function (bars) {
  const colors = SM.chartState.volumeSeriesColors || { up: 'rgba(85,217,141,0.5)', down: 'rgba(255,107,107,0.5)' };
  return bars.map((b) => ({
    time: SM.toUnixTime(b.time), value: b.volume || 0,
    color: b.close >= b.open ? colors.up : colors.down,
  }));
};

SM.indicatorToSeriesData = function (points) {
  return (points || []).map((p) => ({ time: SM.toUnixTime(p.time), value: p.value }));
};

SM.initChart = function (container) {
  const chart = LightweightCharts.createChart(container, {
    layout: { background: { type: 'solid', color: '#0b111a' }, textColor: '#d6e2ff' },
    grid: { vertLines: { color: '#1d2a3a' }, horzLines: { color: '#1d2a3a' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#24364d' },
    rightPriceScale: { borderColor: '#24364d' },
    autoSize: true,
  });

  const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#55d98d', downColor: '#ff6b6b', borderVisible: false,
    wickUpColor: '#55d98d', wickDownColor: '#ff6b6b',
  }, 0);

  // Volumen in einer eigenen Pane statt einer Overlay-Preisskala im Haupt-Chart:
  // eigene Panes haben eine eigene, per Ziehen unabhaengig skalierbare
  // Preisskala (behebt "Volumenskala muss auch skalierbar sein").
  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
  }, 1);
  const panes = chart.panes();
  if (panes[0] && panes[0].setStretchFactor) panes[0].setStretchFactor(4);
  if (panes[1] && panes[1].setStretchFactor) panes[1].setStretchFactor(1);

  const lineColors = { ema10: '#ffd166', ema20: '#06d6a0', sma50: '#4dabf7', sma200: '#ff922b' };
  const lineSeries = {};
  for (const [key, color] of Object.entries(lineColors)) {
    lineSeries[key] = chart.addSeries(LightweightCharts.LineSeries, {
      color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    }, 0);
  }

  const markersApi = LightweightCharts.createSeriesMarkers(candleSeries, []);

  SM.chartState.chart = chart;
  SM.chartState.candleSeries = candleSeries;
  SM.chartState.volumeSeries = volumeSeries;
  SM.chartState.lineSeries = lineSeries;
  SM.chartState.markersApi = markersApi;
  return chart;
};

SM.renderFull = function (bars, indicators) {
  SM.chartState.bars = bars;
  SM.chartState.indicators = indicators || {};
  const cs = SM.chartState;
  cs.candleSeries.setData(SM.barsToSeriesData(bars));
  cs.volumeSeries.setData(SM.volumeToSeriesData(bars));
  for (const key of Object.keys(cs.lineSeries)) {
    cs.lineSeries[key].setData(SM.indicatorToSeriesData((indicators || {})[key]));
  }
  SM.renderExtendedHoursShading(bars);
  cs.chart.timeScale().fitContent();
};

// Ausserboersliche Zeiten (Vor-/Nachboerse) farblich hinterlegen - nur auf der
// nativen 5m-Zeitebene vorhanden (is_regular_session-Flag kommt aus der
// all-sessions-Breitband-Abfrage, siehe market_data.py). Zusammenhaengende
// Laeufe werden zu je einem Band zusammengefasst statt pro Kerze ein eigenes
// Primitive anzulegen (Performance bei mehrtägigen Bereichen).
SM.extendedHoursBands = [];

SM.renderExtendedHoursShading = function (bars) {
  const cs = SM.chartState;
  SM.extendedHoursBands.forEach((b) => cs.candleSeries.detachPrimitive(b));
  SM.extendedHoursBands = [];
  if (!bars.length || bars[0].is_regular_session === undefined) return;
  let runStart = null, runEnd = null;
  const flush = () => {
    if (runStart == null) return;
    const band = new SM.VerticalBandPrimitive({ fillColor: 'rgba(120,150,220,0.07)' });
    cs.candleSeries.attachPrimitive(band);
    band.setRange(runStart, runEnd);
    SM.extendedHoursBands.push(band);
    runStart = null;
  };
  for (const b of bars) {
    const t = SM.toUnixTime(b.time);
    if (b.is_regular_session === 0) {
      if (runStart == null) runStart = t;
      runEnd = t + 300; // Ende dieser 5m-Kerze
    } else {
      flush();
    }
  }
  flush();
};

// Additive Preislinien-Verwaltung nach Gruppe (z.B. 'pdhpdl' vs 'orb'), damit
// verschiedene Aufrufer sich nicht gegenseitig die Linien loeschen. Jede
// Gruppe wird bei erneutem Aufruf komplett neu gezeichnet, andere Gruppen
// bleiben unberuehrt.
SM.referenceLineGroups = {};

SM.setReferenceLineGroup = function (groupName, lines) {
  const cs = SM.chartState;
  (SM.referenceLineGroups[groupName] || []).forEach((pl) => cs.candleSeries.removePriceLine(pl));
  SM.referenceLineGroups[groupName] = [];
  for (const l of lines || []) {
    if (l.price == null) continue;
    SM.referenceLineGroups[groupName].push(cs.candleSeries.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: l.title,
    }));
  }
};

// Rueckwaerts-kompatibler Alias fuer bestehende Aufrufer (labels.js: PDH/PDL/ORB-m30).
SM.setReferenceLines = function (lines) { SM.setReferenceLineGroup('pdhpdl', lines); };

SM.setMarkers = function (markers) {
  SM.chartState.markersApi.setMarkers(markers);
};
