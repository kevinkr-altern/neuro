// Replay-Engine: rein clientseitiges Aufdecken einer bereits vollstaendig
// geladenen Zeitreihe (series.update() pro Tick). Mathematisch unbedenklich,
// weil SMA/EMA an Index i nur von Werten <= i abhaengen - Slicing eines
// vorab berechneten Arrays liefert exakt dieselben Werte wie eine
// Neuberechnung auf dem Praefix. WICHTIG: Replay liest niemals die
// Look-ahead-geschuetzten Kennzahlen - "Setup hier markieren" (labels.js)
// ruft dafuer separat den bestehenden, unveraenderten /api/charts-Cutoff-Pfad auf.
var SM = window.SM = window.SM || {};

SM.replay = {
  active: false, playing: false, revealIndex: -1, positionTime: null,
  speedMs: 1000, timer: null,
};

SM.replayArm = function () {
  SM.replay.active = true;
  document.getElementById('replayBar').classList.remove('hidden');
  SM.setMsg('Replay aktiv: Klicke eine Kerze im Chart, um den Startpunkt zu waehlen.');
};

SM.replayDisarm = function () {
  SM.replayPause();
  SM.replay.active = false;
  SM.replay.revealIndex = -1;
  SM.replay.positionTime = null;
  document.getElementById('replayBar').classList.add('hidden');
  SM.renderFull(SM.chartState.bars, SM.chartState.indicators);
};

SM.replaySetStart = function (clickedIndex) {
  const bars = SM.chartState.bars;
  if (clickedIndex < 0 || clickedIndex >= bars.length) return;
  SM.replay.revealIndex = clickedIndex;
  SM.replay.positionTime = bars[clickedIndex].time;
  SM._replayRedraw();
  SM.updateReplayPosLabel();
};

SM._replayRedraw = function () {
  const cs = SM.chartState;
  const visible = cs.bars.slice(0, SM.replay.revealIndex + 1);
  cs.candleSeries.setData(SM.barsToSeriesData(visible));
  cs.volumeSeries.setData(SM.volumeToSeriesData(visible));
  SM.renderExtendedHoursShading(visible);
  const cutoffUnix = visible.length ? SM.toUnixTime(visible[visible.length - 1].time) : -Infinity;
  for (const key of Object.keys(cs.lineSeries)) {
    const pts = (cs.indicators[key] || []).filter((p) => SM.toUnixTime(p.time) <= cutoffUnix);
    cs.lineSeries[key].setData(SM.indicatorToSeriesData(pts));
  }
  // Sichtbaren Zeitbereich auf den neu gesetzten Datensatz zuruecksetzen -
  // ohne das bleibt die Zoom/Pan-Position von VOR dem Zeitebenen-Wechsel
  // (z.B. ein 40-Jahres-Ueberblick) stehen, wodurch nach einem Wechsel auf
  // eine kleine Datenmenge (z.B. ein einzelner Intraday-Tag) fast die ganze
  // Chart-Flaeche auf keine echte Kerze mehr zeigt - Koordinaten-Umrechnung
  // (fuer Klicks/Positions-Werkzeug) liefert dann grossflaechig null.
  cs.chart.timeScale().fitContent();
};

SM.replayPlay = function () {
  if (SM.replay.playing || SM.replay.revealIndex < 0) return;
  SM.replay.playing = true;
  document.getElementById('replayPlay').textContent = '⏸';
  SM.replay.timer = setInterval(SM.replayTick, SM.replay.speedMs);
};

SM.replayPause = function () {
  SM.replay.playing = false;
  const btn = document.getElementById('replayPlay');
  if (btn) btn.textContent = '▶';
  if (SM.replay.timer) clearInterval(SM.replay.timer);
  SM.replay.timer = null;
};

SM.replayTick = function () {
  const bars = SM.chartState.bars;
  if (SM.replay.revealIndex >= bars.length - 1) { SM.replayPause(); return; }
  SM.replay.revealIndex++;
  const cs = SM.chartState;
  const bar = bars[SM.replay.revealIndex];
  const colors = cs.volumeSeriesColors || { up: 'rgba(85,217,141,0.5)', down: 'rgba(255,107,107,0.5)' };
  cs.candleSeries.update({ time: SM.toUnixTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close });
  cs.volumeSeries.update({
    time: SM.toUnixTime(bar.time), value: bar.volume || 0,
    color: bar.close >= bar.open ? colors.up : colors.down,
  });
  for (const key of Object.keys(cs.lineSeries)) {
    const pt = (cs.indicators[key] || []).find((p) => p.time === bar.time);
    if (pt) cs.lineSeries[key].update({ time: SM.toUnixTime(pt.time), value: pt.value });
  }
  SM.replay.positionTime = bar.time;
  SM.updateReplayPosLabel();
};

SM.replayStep = function () { if (!SM.replay.playing) SM.replayTick(); };

SM.replayStepBack = function () {
  if (SM.replay.playing) SM.replayPause();
  if (SM.replay.revealIndex <= 0) return;
  SM.replay.revealIndex--;
  SM.replay.positionTime = SM.chartState.bars[SM.replay.revealIndex].time;
  SM._replayRedraw();
  SM.updateReplayPosLabel();
};

// Kennzahlen-Panel lebt mit der Replay-Position mit: bei jedem Fortschritt
// (Start/Tick/Schritt) wird automatisch, entprellt, derselbe bestehende,
// unveraenderte Look-ahead-geschuetzte /api/charts-Cutoff-Pfad aufgerufen -
// "Setup hier markieren" ist damit nur noch eine Speicher-Bestaetigung der
// bereits sichtbaren Zahlen, nicht mehr deren Ausloeser.
SM._metricsRefreshTimer = null;
SM.scheduleMetricsRefresh = function () {
  if (SM._metricsRefreshTimer) clearTimeout(SM._metricsRefreshTimer);
  SM._metricsRefreshTimer = setTimeout(SM._refreshMetricsFromReplayPosition, 400);
};
SM._refreshMetricsFromReplayPosition = async function () {
  if (!SM.replay.positionTime) return;
  const { date, cutoff } = SM.deriveCutoffFromReplay();
  if (!date) return;
  try {
    const r = await SM.getChartCutoff(SM.$('ticker').value, date, '5m', cutoff);
    SM.metrics = r.metrics || {};
    SM.fillMetricsTable();
  } catch (e) { /* stiller Fehlschlag - Kennzahlen bleiben auf dem letzten gueltigen Stand */ }
};

SM.updateReplayPosLabel = function () {
  SM.scheduleMetricsRefresh();
  const el = document.getElementById('replayPos');
  if (el) el.textContent = SM.replay.positionTime ? `Position: ${SM.replay.positionTime}` : '';
};

// Beim Zeitebenen-Wechsel waehrend eines aktiven Replays: Aufdeckgrenze anhand
// des realen Zeitpunkts neu verankern - nur Kerzen, die zu diesem Zeitpunkt
// bereits VOLLSTAENDIG abgeschlossen waren (Fensterbeginn + Dauer <= Position).
SM.replayOnTimeframeSwitch = function (newBars, newIndicators, newTimeframe) {
  SM.chartState.bars = newBars;
  SM.chartState.indicators = newIndicators || {};
  if (!SM.replay.active || !SM.replay.positionTime) return;
  const posUnix = SM.toUnixTime(SM.replay.positionTime);
  const dur = SM.TF_SECONDS[newTimeframe] || 0;
  let idx = -1;
  for (let i = 0; i < newBars.length; i++) {
    if (SM.toUnixTime(newBars[i].time) + dur <= posUnix) idx = i; else break;
  }
  SM.replay.revealIndex = idx;
  SM._replayRedraw();
};
