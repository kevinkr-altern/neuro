// Tag-Drilldown: Doppelklick auf eine Tageskerze waehrend aktivem Replay
// wechselt den (einzigen) Chart auf den M5-Intraday-Verlauf genau dieses
// Tages und zeigt die ORB-Baender (M5/M15/M30). Kein zweiter, synchronisierter
// Chart - Wiederverwendung derselben Chart-Instanz wie beim normalen
// Zeitebenen-Wechsel. Der Tag gilt als vollstaendig aufgedeckt (der Nutzer hat
// bewusst auf eine bereits sichtbare, vergangene Tageskerze geklickt, um sie
// im Detail zu betrachten - kein neuer Look-ahead-Fall, rein visuell).
var SM = window.SM = window.SM || {};

SM.drilldownDay = async function (ticker, dateIso) {
  const date = dateIso.slice(0, 10);
  try {
    SM.setMsg(`Lade Intraday-Chart fuer ${date} …`);
    const r = await SM.getChartData(ticker, '5m', date, date);
    SM.chartState.timeframe = '5m';
    SM.dataCache[ticker] = SM.dataCache[ticker] || {};
    SM.dataCache[ticker]['5m'] = r;
    SM.chartState.bars = r.bars;
    SM.chartState.indicators = r.indicators;
    SM.replay.revealIndex = r.bars.length - 1;
    SM.replay.positionTime = r.bars.length ? r.bars[r.bars.length - 1].time : null;
    SM._replayRedraw();
    SM.updateReplayPosLabel();
    SM.renderOrbBands();
    SM.$('btnBackToDaily').classList.remove('hidden');
    document.querySelectorAll('#tfGroup [data-tf]').forEach((b) => b.classList.toggle('active', b.dataset.tf === '5m'));
    SM.setMsg(`Intraday-Drilldown ${date}: ${r.bars.length} M5-Kerzen, ORB-Baender M5/M15/M30 sichtbar.`);
  } catch (e) { SM.showErr(e.message); }
};

SM.returnToDaily = async function () {
  const ticker = SM.$('ticker').value.trim().toUpperCase();
  const drilledDate = (SM.replay.positionTime || '').slice(0, 10);
  SM.clearOrbBands();
  SM.$('btnBackToDaily').classList.add('hidden');
  document.querySelectorAll('#tfGroup [data-tf]').forEach((b) => b.classList.toggle('active', b.dataset.tf === '1d'));
  try {
    let r = SM.dataCache[ticker] && SM.dataCache[ticker]['1d'];
    if (!r) { r = await SM.getChartData(ticker, '1d'); SM.dataCache[ticker] = SM.dataCache[ticker] || {}; SM.dataCache[ticker]['1d'] = r; }
    SM.chartState.timeframe = '1d';
    SM.chartState.bars = r.bars;
    SM.chartState.indicators = r.indicators;
    let idx = r.bars.findIndex((b) => b.time === drilledDate);
    if (idx < 0) idx = r.bars.length - 1;
    SM.replay.revealIndex = idx;
    SM.replay.positionTime = r.bars[idx] ? r.bars[idx].time : null;
    SM._replayRedraw();
    SM.updateReplayPosLabel();
    SM.setMsg(`Zurueck zum Tages-Chart (${r.bars.length} Kerzen).`);
  } catch (e) { SM.showErr(e.message); }
};
