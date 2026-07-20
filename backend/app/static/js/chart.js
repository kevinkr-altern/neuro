// Lightweight-Charts-Lebenszyklus: Candles, Volumen-Overlay, Indikator-Linien,
// Referenz-Preislinien (PDH/PDL/ORB), Marker. Nutzt v5-API (chart.addSeries(Typ, opts)).
var SM = window.SM = window.SM || {};

SM.TF_SECONDS = { '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400, '1w': 604800 };

SM.chartState = {
  chart: null, candleSeries: null, volumeSeries: null,
  lineSeries: {}, priceLines: [], markersApi: null,
  bars: [], indicators: {}, timeframe: '1d',
};

SM.toUnixTime = function (iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
};

SM.barsToSeriesData = function (bars) {
  return bars.map((b) => ({ time: SM.toUnixTime(b.time), open: b.open, high: b.high, low: b.low, close: b.close }));
};

SM.volumeToSeriesData = function (bars) {
  return bars.map((b) => ({
    time: SM.toUnixTime(b.time), value: b.volume || 0,
    color: b.close >= b.open ? 'rgba(85,217,141,0.5)' : 'rgba(255,107,107,0.5)',
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
  });
  candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });

  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false,
  });
  volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  const lineColors = { ema10: '#ffd166', ema20: '#06d6a0', sma50: '#4dabf7', sma200: '#ff922b' };
  const lineSeries = {};
  for (const [key, color] of Object.entries(lineColors)) {
    lineSeries[key] = chart.addSeries(LightweightCharts.LineSeries, {
      color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
    });
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
  cs.chart.timeScale().fitContent();
};

SM.setReferenceLines = function (lines) {
  const cs = SM.chartState;
  for (const pl of cs.priceLines) cs.candleSeries.removePriceLine(pl);
  cs.priceLines = [];
  for (const l of lines || []) {
    if (l.price == null) continue;
    cs.priceLines.push(cs.candleSeries.createPriceLine({
      price: l.price, color: l.color, lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: l.title,
    }));
  }
};

SM.setMarkers = function (markers) {
  SM.chartState.markersApi.setMarkers(markers);
};
