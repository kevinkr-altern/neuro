// Zweiter, einklappbarer Chart fuer die Minuten-Ebene (feinste verfuegbare
// Aufloesung ist 5m - EODHD liefert kein echtes 1-Minuten-Intervall). Wird
// aus dem pausierten grossen D1-Replay heraus fuer den aktuell angezeigten
// Tag geoeffnet und laeuft dort unabhaengig, waehrend der D1-Chart auf
// diesem Tag stehen bleibt. Ist der Tag im Minuten-Chart komplett
// aufgedeckt, wird automatisch EIN Tag im grossen D1-Chart aufgedeckt
// (SM.replayStep() - derselbe bestehende Mechanismus, der auch die
// Kennzahlen-Aktualisierung ausloest) und der Minuten-Chart startet fuer den
// neuen Tag neu; war er im Play, laeuft er dort automatisch weiter.
var SM = window.SM = window.SM || {};

SM.miniChart = { chart: null, candleSeries: null, volumeSeries: null };
SM.miniReplay = { bars: [], revealIndex: -1, playing: false, timer: null, speedMs: 600, dayDate: null };

SM._ensureMiniChart = function () {
  if (SM.miniChart.chart) return;
  const container = SM.$('miniChartContainer');
  const chart = LightweightCharts.createChart(container, {
    layout: { background: { type: 'solid', color: '#080a0e' }, textColor: '#d6e2ff' },
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
  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
  }, 1);
  const panes = chart.panes();
  if (panes[0] && panes[0].setStretchFactor) panes[0].setStretchFactor(4);
  if (panes[1] && panes[1].setStretchFactor) panes[1].setStretchFactor(1);
  SM.miniChart.chart = chart;
  SM.miniChart.candleSeries = candleSeries;
  SM.miniChart.volumeSeries = volumeSeries;
};

SM.openMiniChartForPausedDay = async function () {
  if (SM.chartState.timeframe !== '1d') { SM.showErr('Minuten-Chart nur aus dem Tages-Chart (D1) heraus oeffnen.'); return; }
  if (!SM.replay.active || SM.replay.playing || SM.replay.revealIndex < 0) {
    SM.showErr('Erst das Tages-Replay starten und auf einem Tag pausiert stehen haben (Kerze anklicken, ggf. pausieren).');
    return;
  }
  const date = SM.chartState.bars[SM.replay.revealIndex].time.slice(0, 10);
  SM.$('miniChartPanel').classList.remove('hidden', 'collapsed');
  SM._ensureMiniChart();
  await SM._loadMiniDay(date);
};

SM._loadMiniDay = async function (date) {
  SM.miniReplayPause();
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  try {
    const r = await SM.getChartData(ticker, '5m', date, date);
    SM.miniReplay.bars = r.bars;
    SM.miniReplay.dayDate = date;
    SM.miniReplay.revealIndex = r.bars.length ? 0 : -1;
    SM.$('miniChartDate').textContent = r.bars.length ? date : `${date} (keine 5m-Kerzen)`;
    SM._miniRedraw();
  } catch (e) { SM.showErr(e.message); }
};

SM._miniRedraw = function () {
  const mc = SM.miniChart;
  const visible = SM.miniReplay.bars.slice(0, SM.miniReplay.revealIndex + 1);
  mc.candleSeries.setData(SM.barsToSeriesData(visible));
  mc.volumeSeries.setData(SM.volumeToSeriesData(visible));
  mc.chart.timeScale().fitContent();
  SM._miniSyncScrub();
};

SM._miniSyncScrub = function () {
  const scrub = SM.$('miniScrub');
  const count = SM.$('miniCount');
  const n = SM.miniReplay.bars.length;
  if (scrub) { scrub.max = String(Math.max(0, n - 1)); scrub.value = String(Math.max(0, SM.miniReplay.revealIndex)); }
  if (count) count.textContent = (n && SM.miniReplay.revealIndex >= 0) ? `Kerze ${SM.miniReplay.revealIndex + 1} / ${n}` : '';
};

SM.miniReplayPlay = function () {
  if (SM.miniReplay.playing || !SM.miniReplay.bars.length) return;
  SM.miniReplay.playing = true;
  SM.$('miniPlay').textContent = '⏸';
  SM.miniReplay.timer = setInterval(SM.miniReplayTick, SM.miniReplay.speedMs);
};

SM.miniReplayPause = function () {
  SM.miniReplay.playing = false;
  const btn = SM.$('miniPlay');
  if (btn) btn.textContent = '▶';
  if (SM.miniReplay.timer) clearInterval(SM.miniReplay.timer);
  SM.miniReplay.timer = null;
};

SM.miniReplayTick = async function () {
  if (SM.miniReplay.revealIndex >= SM.miniReplay.bars.length - 1) {
    SM.miniReplayPause();
    await SM._miniAdvanceDay(true);
    return;
  }
  SM.miniReplay.revealIndex++;
  SM._miniRedraw();
};

SM.miniReplayStep = async function () {
  if (SM.miniReplay.playing) return;
  if (SM.miniReplay.revealIndex >= SM.miniReplay.bars.length - 1) {
    await SM._miniAdvanceDay(false);
    return;
  }
  SM.miniReplay.revealIndex++;
  SM._miniRedraw();
};

SM.miniReplayStepBack = function () {
  if (SM.miniReplay.playing) SM.miniReplayPause();
  if (SM.miniReplay.revealIndex <= 0) return;
  SM.miniReplay.revealIndex--;
  SM._miniRedraw();
};

SM.miniReplayJumpTo = function (index) {
  if (!SM.miniReplay.bars.length) return;
  if (SM.miniReplay.playing) SM.miniReplayPause();
  SM.miniReplay.revealIndex = Math.max(0, Math.min(index, SM.miniReplay.bars.length - 1));
  SM._miniRedraw();
};

// Ein Tag im Minuten-Chart ist durchgelaufen -> genau EIN Tag im grossen
// D1-Chart aufdecken (bestehender, look-ahead-sicherer Mechanismus, der auch
// die Kennzahlen-/Minervini-Aktualisierung fuer diesen neuen Tag ausloest)
// und den Minuten-Chart fuer den neuen Tag neu laden.
SM._miniAdvanceDay = async function (wasPlaying) {
  const before = SM.replay.revealIndex;
  SM.replayStep();
  if (SM.replay.revealIndex === before) {
    SM.setMsg('Ende der geladenen Tage erreicht - kein naechster Tag verfuegbar.');
    return;
  }
  const newDate = SM.chartState.bars[SM.replay.revealIndex].time.slice(0, 10);
  await SM._loadMiniDay(newDate);
  if (wasPlaying) SM.miniReplayPlay();
};

SM.toggleMiniCollapse = function () {
  SM.$('miniChartPanel').classList.toggle('collapsed');
};

SM.closeMiniChart = function () {
  SM.miniReplayPause();
  SM.$('miniChartPanel').classList.add('hidden');
};

SM.initMiniChart = function () {
  SM.$('btnOpenMiniChart').addEventListener('click', SM.openMiniChartForPausedDay);
  SM.$('miniPlay').addEventListener('click', () => { SM.miniReplay.playing ? SM.miniReplayPause() : SM.miniReplayPlay(); });
  SM.$('miniStepBack').addEventListener('click', SM.miniReplayStepBack);
  SM.$('miniStep').addEventListener('click', SM.miniReplayStep);
  SM.$('miniScrub').addEventListener('input', (e) => SM.miniReplayJumpTo(+e.target.value));
  SM.$('btnMiniCollapse').addEventListener('click', SM.toggleMiniCollapse);
  SM.$('btnMiniClose').addEventListener('click', SM.closeMiniChart);
};
