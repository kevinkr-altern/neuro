// Mark-Minervini-Trend-Template (8 Kriterien), rein clientseitig aus bereits
// geladenen Tageskerzen berechnet. Look-ahead-sicher: nutzt ausschliesslich
// Tage STRIKT VOR dem uebergebenen Cutoff-Datum (dieselbe Grenze wie
// _daily_before() im Backend). Kriterium 8 (Relative Staerke) ist eine
// Naeherung ueber die Performance gegen QQQ - ein echtes IBD-RS-Rating
// braucht eine Marktbreite-Datenbank ueber alle Aktien, die hier nicht
// verfuegbar ist. Das wird in der UI und hier explizit als Naeherung
// gekennzeichnet, nicht stillschweigend als echtes Rating ausgegeben.
var SM = window.SM = window.SM || {};
SM.minerviniResult = null;

SM._smaEndingAt = function (closes, period, indexFromEnd) {
  const end = closes.length - indexFromEnd;
  if (end < period) return null;
  let sum = 0;
  for (let i = end - period; i < end; i++) sum += closes[i];
  return sum / period;
};

SM._perfOver = function (closes, window) {
  if (closes.length < window + 1) return null;
  const start = closes[closes.length - 1 - window];
  const end = closes[closes.length - 1];
  if (!start) return null;
  return (end - start) / start;
};

SM.computeMinervini = function (tickerBars, qqqBars) {
  if (!tickerBars || tickerBars.length < 30) return null;
  const closes = tickerBars.map((b) => b.close);
  const price = closes[closes.length - 1];
  const sma50 = SM._smaEndingAt(closes, 50, 0);
  const sma150 = SM._smaEndingAt(closes, 150, 0);
  const sma200 = SM._smaEndingAt(closes, 200, 0);
  const sma200Prev = SM._smaEndingAt(closes, 200, 20); // vor ~1 Monat (20 Handelstage)
  const win252 = tickerBars.slice(-252);
  const low52 = win252.length >= 252 ? Math.min(...win252.map((b) => b.low)) : null;
  const high52 = win252.length >= 252 ? Math.max(...win252.map((b) => b.high)) : null;
  const tickerPerf = SM._perfOver(closes, 252);
  const qqqPerf = (qqqBars && qqqBars.length) ? SM._perfOver(qqqBars.map((b) => b.close), 252) : null;

  const checks = [
    { label: 'Kurs > SMA150 und > SMA200', ok: sma150 != null && sma200 != null && price > sma150 && price > sma200 },
    { label: 'SMA150 > SMA200', ok: sma150 != null && sma200 != null && sma150 > sma200 },
    { label: 'SMA200 steigend (vs. vor ~1 Monat)', ok: sma200 != null && sma200Prev != null && sma200 > sma200Prev },
    { label: 'SMA50 > SMA150 und > SMA200', ok: sma50 != null && sma150 != null && sma200 != null && sma50 > sma150 && sma50 > sma200 },
    { label: 'Kurs > SMA50', ok: sma50 != null && price > sma50 },
    { label: 'Kurs ≥ 30% über 52W-Tief', ok: low52 != null && price >= low52 * 1.30 },
    { label: 'Kurs ≤ 25% unter 52W-Hoch', ok: high52 != null && price >= high52 * 0.75 },
    { label: 'Relative Staerke vs. QQQ (Naeherung)', ok: tickerPerf != null && qqqPerf != null && tickerPerf > qqqPerf },
  ];
  const score = checks.filter((c) => c.ok).length;
  return { checks, score, total: 8 };
};

// Haelt QQQ-Tageskerzen im bestehenden SM.dataCache vorraetig (gleiches
// Cache-Objekt/Muster wie fuer den Haupt-Ticker), damit Kriterium 8 nicht bei
// jeder Aktualisierung neu ueber das Netz laedt.
SM.ensureQqqDailyCache = async function () {
  SM.dataCache.QQQ = SM.dataCache.QQQ || {};
  if (SM.dataCache.QQQ['1d']) return SM.dataCache.QQQ['1d'];
  try {
    const r = await SM.getChartData('QQQ', '1d');
    SM.dataCache.QQQ['1d'] = r;
    return r;
  } catch (e) { return null; }
};

// cutoffDateExclusive: nur Tage mit time < cutoffDateExclusive fliessen ein
// (identische Look-ahead-Grenze wie die restlichen Kennzahlen fuer denselben
// Zeitpunkt).
SM.updateMinervini = async function (ticker, cutoffDateExclusive) {
  const tickerCache = SM.dataCache[ticker] && SM.dataCache[ticker]['1d'];
  if (!tickerCache) { SM.minerviniResult = null; return; }
  const qqqCache = await SM.ensureQqqDailyCache();
  const tickerBars = tickerCache.bars.filter((b) => b.time < cutoffDateExclusive);
  const qqqBars = qqqCache ? qqqCache.bars.filter((b) => b.time < cutoffDateExclusive) : null;
  SM.minerviniResult = SM.computeMinervini(tickerBars, qqqBars);
};
