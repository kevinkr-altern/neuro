// QQQ-Marktzustand als duenner Farbstreifen am oberen Rand der Chart-Pane.
// Regel (Nutzervorgabe): Kurs > EMA10 UND Kurs > EMA20 UND EMA10 > EMA20 ->
// gruen; Kurs < EMA10 UND Kurs < EMA20 -> rot; alles dazwischen (z.B. ueber
// dem 10er, aber unter dem 20er) -> gelb. Nutzt denselben nicht-look-ahead-
// geschuetzten /api/chart-data-Pfad wie die Hauptkerzen (rein visuell, fliesst
// NIE in Kennzahlen/Look-ahead-Berechnungen ein). Stiller Fehlschlag bei
// Netzwerkproblemen - der Streifen ist ein Zusatz, kein Blocker fuer den
// Haupt-Chart.
var SM = window.SM = window.SM || {};

SM.MARKET_STATE_TICKER = 'QQQ';
SM.marketStateStrip = null;

SM._marketStateColor = function (close, ema10, ema20) {
  if (close > ema10 && close > ema20 && ema10 > ema20) return '#3ddc84';
  if (close < ema10 && close < ema20) return '#ff5c5c';
  return '#ffd166';
};

SM.refreshMarketStateStrip = async function () {
  const cs = SM.chartState;
  if (!cs.bars.length) return;
  const timeframe = cs.timeframe;
  const from = cs.bars[0].time.slice(0, 10);
  const to = cs.bars[cs.bars.length - 1].time.slice(0, 10);
  let r;
  try {
    r = await SM.getChartData(SM.MARKET_STATE_TICKER, timeframe, from, to);
  } catch (e) {
    return;
  }
  const ema10ByTime = {}; (r.indicators.ema10 || []).forEach((p) => { ema10ByTime[p.time] = p.value; });
  const ema20ByTime = {}; (r.indicators.ema20 || []).forEach((p) => { ema20ByTime[p.time] = p.value; });
  const bars = r.bars;
  const segments = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const e10 = ema10ByTime[b.time], e20 = ema20ByTime[b.time];
    if (e10 == null || e20 == null) continue;
    const color = SM._marketStateColor(b.close, e10, e20);
    const t0 = SM.toUnixTime(b.time);
    const t1 = i + 1 < bars.length ? SM.toUnixTime(bars[i + 1].time) : t0 + (SM.TF_SECONDS[timeframe] || 86400);
    segments.push({ timeFrom: t0, timeTo: t1, color });
  }
  if (!SM.chartState.candleSeries) return;
  if (!SM.marketStateStrip) {
    SM.marketStateStrip = new SM.TopStripPrimitive({ heightPx: 8 });
    SM.chartState.candleSeries.attachPrimitive(SM.marketStateStrip);
  }
  SM.marketStateStrip.setSegments(segments);
};
