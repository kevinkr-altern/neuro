// Bootstrap/Verdrahtung: Ticker laden, Zeitebenen-Wechsel, Replay-Bedienung,
// Klick-/Tastatur-Marker, Tabs, Import/Export/Backup.
var SM = window.SM = window.SM || {};

SM.showErr = function (t) { SM.$('err').innerHTML = t ? `<pre class="error">${t}</pre>` : ''; };
SM.setMsg = function (t, cls) { SM.$('msg').innerHTML = t ? `<pre class="${cls || 'msg'}">${t}</pre>` : ''; };

SM.dataCache = {}; // { [ticker]: { [timeframe]: chartDataResponse } }

SM.updateM5Badge = function (date, verified) {
  SM.$('m5Badge').textContent = date ? `M5 ab: ${date}${verified ? ' ✓' : ''}` : 'M5 ab: unbekannt';
};

SM.checkM5Earliest = async function (ticker) {
  if (!ticker) return;
  SM.$('m5Badge').textContent = 'M5-Start wird gesucht …';
  try {
    const r = await SM.getM5Earliest(ticker);
    SM.updateM5Badge(r.m5_history_start, r.verified);
  } catch (e) {
    SM.$('m5Badge').textContent = 'M5-Start: Fehler';
    SM.showErr(e.message);
  }
};

SM.loadTicker = async function (timeframe) {
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  if (!ticker) { SM.showErr('Bitte Ticker eingeben.'); return; }
  timeframe = timeframe || SM.chartState.timeframe || '1d';
  // Zeitraum-Auswahl gilt nur fuer D1/W1 - Intraday-Zeitebenen bleiben beim
  // bestehenden, m5-verfuegbarkeitsbasierten Standardbereich.
  const dateFrom = (timeframe === '1d' || timeframe === '1w') ? SM.computeRangeDateFrom(SM.chartState.rangeKey) : undefined;
  SM.showErr(''); SM.setMsg(`Lade ${ticker} (${timeframe}) … das kann bei sehr langer Historie einen Moment dauern.`);
  try {
    const r = await SM.getChartData(ticker, timeframe, dateFrom);
    SM.chartState.timeframe = timeframe;
    SM.dataCache[ticker] = SM.dataCache[ticker] || {};
    SM.dataCache[ticker][timeframe] = r;
    if (r.m5_history_start != null) SM.updateM5Badge(r.m5_history_start, r.m5_history_verified);
    if (SM.replay.active && SM.replay.positionTime) {
      SM.replayOnTimeframeSwitch(r.bars, r.indicators, timeframe);
    } else {
      SM.renderFull(r.bars, r.indicators);
    }
    let msg = `${r.bars.length} Kerzen geladen (${timeframe}), Bereich ${r.actual_from} bis ${r.actual_to}.`;
    if (r.warnings && r.warnings.length) msg += '\nHinweise:\n- ' + r.warnings.join('\n- ');
    SM.setMsg(msg, r.warnings && r.warnings.length ? 'warn' : 'msg');
    SM.refreshMarketStateStrip();
    SM.refreshMetricsForLastClose();
  } catch (e) { SM.showErr(e.message); SM.setMsg(''); }
};

// Seiten-Umschaltung: Chart (bestehendes Layout inkl. Sidebar) vs. die
// beiden neuen vollflaechigen Seiten Trades/Analyse - "Tradeuebersicht und
// Analyse sollen eigene ganze Seiten sein statt in die schmale Sidebar
// gequetscht" (Nutzer-Feedback). Lazy-Load der Seiteninhalte erst beim
// ersten Aufruf, danach bei jedem erneuten Aufruf frisch neu geladen (damit
// neu gespeicherte Labels sofort sichtbar sind).
SM.PAGE_IDS = { chart: 'pageChart', trades: 'pageTrades', analyse: 'pageAnalyse' };
SM.showPage = function (name) {
  Object.values(SM.PAGE_IDS).forEach((id) => { const el = SM.$(id); if (el) el.classList.add('hidden'); });
  const el = SM.$(SM.PAGE_IDS[name] || SM.PAGE_IDS.chart);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('#pageNav .page-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  if (name === 'trades') SM.loadTradesPage();
  if (name === 'analyse') SM.loadAnalysis();
};

document.addEventListener('DOMContentLoaded', () => {
  const chart = SM.initChart(SM.$('chartContainer'));
  SM.applyStyle(SM.loadStyle());
  SM.buildSettingsPanel();
  SM.$('btnSettings').addEventListener('click', SM.toggleSettingsPanel);

  SM.$('btnLoad').addEventListener('click', () => {
    const ticker = SM.$('ticker').value.trim().toUpperCase();
    SM.loadTicker('1d');
    SM.checkM5Earliest(ticker);
  });
  SM.$('ticker').addEventListener('keydown', (e) => { if (e.key === 'Enter') SM.$('btnLoad').click(); });

  document.querySelectorAll('#tfGroup [data-tf]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tfGroup [data-tf]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      SM.loadTicker(btn.dataset.tf);
    });
  });

  document.querySelectorAll('#rangeGroup [data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rangeGroup [data-range]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      SM.chartState.rangeKey = btn.dataset.range;
      SM.loadTicker(SM.chartState.timeframe);
    });
  });

  SM.$('btnReplayToggle').addEventListener('click', () => {
    if (SM.replay.active) {
      SM.replayDisarm();
      SM.$('btnReplayToggle').textContent = 'Replay aktivieren';
    } else {
      SM.replayArm();
      SM.$('btnReplayToggle').textContent = 'Replay beenden';
    }
  });

  SM.$('replayPlay').addEventListener('click', () => { SM.replay.playing ? SM.replayPause() : SM.replayPlay(); });
  SM.$('replayStepBack').addEventListener('click', SM.replayStepBack);
  SM.$('replayStep').addEventListener('click', SM.replayStep);
  SM.$('replayScrub').addEventListener('input', (e) => SM.replayJumpTo(+e.target.value));
  SM.$('replaySpeed').addEventListener('change', (e) => {
    SM.replay.speedMs = +e.target.value;
    if (SM.replay.playing) { SM.replayPause(); SM.replayPlay(); }
  });
  SM.$('btnMarkSetup').addEventListener('click', SM.markSetupHere);
  SM.$('btnSaveLabel').addEventListener('click', SM.saveLabel);
  SM.$('btnCancelLabel').addEventListener('click', SM.cancelLabel);

  document.querySelectorAll('[data-marker]').forEach((btn) => {
    btn.addEventListener('click', () => SM.armMarker(btn.dataset.marker));
  });

  // Zeichen-Werkzeug MUSS vor dem Positions-Werkzeug registriert werden:
  // beide haengen mousedown an denselben Container, und nur wenn der
  // Drawing-Handler zuerst laeuft, kann sein stopImmediatePropagation() beim
  // Ziehen einer bestehenden Linie das Positions-Werkzeug zuverlaessig
  // uebergehen (Registrierungsreihenfolge = Ausfuehrungsreihenfolge).
  SM.initDrawingTool();
  SM.$('btnDrawLine').addEventListener('click', SM.armDrawingTool);
  SM.$('btnClearDrawings').addEventListener('click', SM.clearDrawings);

  SM.initPositionTool();
  SM.$('btnPositionTool').addEventListener('click', SM.armPositionTool);
  SM.$('btnClosePosition').addEventListener('click', SM.closePositionManually);
  SM.$('btnClearPosition').addEventListener('click', SM.clearPosition);
  SM.initMiniChart();

  chart.subscribeClick((param) => {
    if (SM.drawingArmed) return; // wird ueber rohes mousedown behandelt (siehe drawings.js)
    if (SM.positionArmed || SM.position) return; // Positions-Werkzeug hat Vorrang am selben Klick (sonst wuerde derselbe Klick zusaetzlich einen Replay-Startpunkt setzen und den gerade platzierten Kasten verwaisen lassen)
    if (!param.time) return;
    const bars = SM.chartState.bars;
    const idx = bars.findIndex((b) => SM.toUnixTime(b.time) === param.time);
    if (idx < 0) return;
    if (SM.replay.active && SM.replay.revealIndex < 0) {
      SM.replaySetStart(idx);
    } else if (SM.armedMarkerType) {
      if (SM.replay.active && idx > SM.replay.revealIndex) {
        SM.showErr('Marker darf nicht nach der Replay-Position liegen (Look-ahead verhindert).');
        return;
      }
      SM.placeMarkerAtBar(bars[idx]);
    }
  });

  chart.subscribeDblClick((param) => {
    if (!param.time || !SM.replay.active || SM.chartState.timeframe !== '1d') return;
    const bars = SM.chartState.bars;
    const idx = bars.findIndex((b) => SM.toUnixTime(b.time) === param.time);
    if (idx < 0 || idx > SM.replay.revealIndex) return;
    SM.drilldownDay(SM.$('ticker').value.trim().toUpperCase(), bars[idx].time);
  });
  SM.$('btnBackToDaily').addEventListener('click', SM.returnToDaily);

  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === 'Escape') { SM.cancelPendingDrawing(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && SM._activeDrawing) { e.preventDefault(); SM.deleteActiveDrawing(); return; }
    // Schnelle Replay-Navigation per Pfeiltasten/Leertaste (nur bei aktivem Replay).
    if (SM.replay.active && SM.replay.revealIndex >= 0) {
      if (e.key === 'ArrowRight') { e.preventDefault(); SM.replayStep(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); SM.replayStepBack(); return; }
      if (e.key === ' ') { e.preventDefault(); SM.replay.playing ? SM.replayPause() : SM.replayPlay(); return; }
    }
    const map = { e: 'entry', x: 'exit', s: 'stop', p: 'pivot' };
    const type = map[e.key.toLowerCase()];
    if (!type) return;
    const idx = SM.replay.revealIndex;
    if (idx == null || idx < 0) { SM.showErr('Erst im Replay einen Startpunkt waehlen (Kerze anklicken).'); return; }
    SM.placeMarkerAtBar(SM.chartState.bars[idx], type);
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      btn.classList.add('active');
      const panelId = 'tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
      SM.$(panelId).classList.remove('hidden');
    });
  });

  document.querySelectorAll('#pageNav .page-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => SM.showPage(btn.dataset.page));
  });

  SM.$('btnImportCsv').addEventListener('click', () => SM.importCsv(SM.$('csv').files[0]));
  SM.$('btnBackup').addEventListener('click', SM.backup);
  SM.$('btnListBackups').addEventListener('click', SM.listBackups);

  SM.$('btnWlAdd').addEventListener('click', SM.addWatchlistItem);
  SM.$('wlTicker').addEventListener('keydown', (e) => { if (e.key === 'Enter') SM.$('btnWlAdd').click(); });
  SM.$('wlCategory').addEventListener('keydown', (e) => { if (e.key === 'Enter') SM.$('btnWlAdd').click(); });

  SM.buildLabelForm();
  SM.fillMetricsTable();
  SM.loadLabels();
  SM.loadWatchlist();
  SM.loadTicker('1d');
  SM.checkM5Earliest(SM.$('ticker').value.trim().toUpperCase());
});
