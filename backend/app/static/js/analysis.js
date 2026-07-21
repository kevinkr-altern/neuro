// Analyse-Tab: wertet ALLE gespeicherten Labels aus - aggregiert (Gesamt-
// Statistik, Aufschluesselung nach Stop-Strategie/Label-Klasse/Struktur/
// Taktik, Profit-Faktor, Drawdown, Gewinn-/Verlust-Serien) UND jeden Trade
// einzeln (Tabelle, Klick oeffnet die Trade-Box im Chart). Rein clientseitig
// aus dem bestehenden GET /api/labels berechnet - keine neue Backend-
// Aggregation noetig, das Datenvolumen eines persoenlichen Trade-Journals
// ist dafuer klein genug.
var SM = window.SM = window.SM || {};

SM._pct = function (v) { return v == null ? '—' : v.toFixed(1) + '%'; };
SM._rFmt = function (v) { return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'; };

SM.STOP_STRATEGY_LABELS = {
  none: 'manuell', fixed_ema10_prevday: 'EMA10 Vortag (fest)', close_below_ema10: 'Close < EMA10',
  fixed_ema20_prevday: 'EMA20 Vortag (fest)', close_below_ema20: 'Close < EMA20',
};

SM._analysisGroupBy = function (rows, keyFn) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r) || '(keine Angabe)';
    (groups[k] = groups[k] || []).push(r);
  }
  return Object.entries(groups).map(([key, arr]) => {
    const wins = arr.filter((r) => r.result_r > 0).length;
    const avgR = arr.reduce((s, r) => s + r.result_r, 0) / arr.length;
    return { key, n: arr.length, winRate: (wins / arr.length) * 100, avgR };
  }).sort((a, b) => b.n - a.n);
};

SM._analysisBreakdownTable = function (groups) {
  if (!groups.length) return '<p class="metrics-empty">Keine Daten.</p>';
  return groups.map((g) => SM._mrow(`${g.key} (n=${g.n})`, `${SM._pct(g.winRate)} Trefferquote, ⌀ ${SM._rFmt(g.avgR)}`, g.avgR >= 0 ? 'good' : 'bad')).join('');
};

// Profit-Faktor, Drawdown (in R) und Gewinn-/Verlust-Serien - Standard-
// Kennzahlen eines Trading-Auswertungs-Tools, in chronologischer Reihenfolge
// (nach Entry-Datum) berechnet.
SM._analysisSequenceStats = function (withResult) {
  const sorted = withResult.slice().sort((a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''));
  const sumWins = withResult.filter((l) => l.result_r > 0).reduce((s, l) => s + l.result_r, 0);
  const sumLossesAbs = Math.abs(withResult.filter((l) => l.result_r < 0).reduce((s, l) => s + l.result_r, 0));
  const profitFactor = sumLossesAbs > 0 ? sumWins / sumLossesAbs : (sumWins > 0 ? null : 0);
  let cum = 0, peak = 0, maxDD = 0;
  let curStreak = 0, curStreakIsWin = null, maxWinStreak = 0, maxLossStreak = 0;
  for (const l of sorted) {
    cum += l.result_r;
    if (cum > peak) peak = cum;
    maxDD = Math.max(maxDD, peak - cum);
    const isWin = l.result_r > 0;
    curStreak = (curStreakIsWin === isWin) ? curStreak + 1 : 1;
    curStreakIsWin = isWin;
    if (isWin) maxWinStreak = Math.max(maxWinStreak, curStreak); else maxLossStreak = Math.max(maxLossStreak, curStreak);
  }
  return { profitFactor, maxDD, maxWinStreak, maxLossStreak };
};

SM.loadAnalysis = async function () {
  const target = SM.$('analysisContent');
  let labels;
  try {
    labels = await SM.api('/labels');
  } catch (e) {
    target.innerHTML = '<p class="metrics-empty">Konnte Labels nicht laden.</p>';
    return;
  }
  const withResult = labels.filter((l) => l.result_r != null);
  if (!withResult.length) {
    target.innerHTML = `<p class="metrics-empty">Noch keine Labels mit eingetragenem Ergebnis R (${labels.length} Label(s) insgesamt gespeichert, aber ohne Ergebnis).</p>`;
    return;
  }
  const wins = withResult.filter((l) => l.result_r > 0).length;
  const winRate = (wins / withResult.length) * 100;
  const avgR = withResult.reduce((s, l) => s + l.result_r, 0) / withResult.length;
  const withMfe = withResult.filter((l) => l.mfe_r != null);
  const withMae = withResult.filter((l) => l.mae_r != null);
  const avgMfe = withMfe.length ? withMfe.reduce((s, l) => s + l.mfe_r, 0) / withMfe.length : null;
  const avgMae = withMae.length ? withMae.reduce((s, l) => s + l.mae_r, 0) / withMae.length : null;
  const bestR = Math.max(...withResult.map((l) => l.result_r));
  const worstR = Math.min(...withResult.map((l) => l.result_r));
  const seq = SM._analysisSequenceStats(withResult);

  const byStopStrategy = SM._analysisGroupBy(withResult, (l) => SM.STOP_STRATEGY_LABELS[l.stop_strategy] || l.stop_strategy || '(keine Angabe)');
  const byClass = SM._analysisGroupBy(withResult, (l) => l.label_class);
  const byStructure = SM._analysisGroupBy(withResult, (l) => l.structure);
  const byTactic = SM._analysisGroupBy(withResult, (l) => l.tactic);

  const tradeRows = labels.slice().sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || '')).map((l) => `
    <tr>
      <td>${l.ticker}</td><td>${l.entry_date || ''}</td><td>${l.setup_name}</td>
      <td>${l.stop_strategy ? (SM.STOP_STRATEGY_LABELS[l.stop_strategy] || l.stop_strategy) : '—'}</td>
      <td class="${l.result_r > 0 ? 'ok' : (l.result_r < 0 ? 'bad' : '')}">${l.result_r != null ? SM._rFmt(l.result_r) : '—'}</td>
      <td><button class="btn-secondary" title="Trade-Box im Chart anzeigen" onclick="SM.viewLabelOnChart(${l.id})">📈</button></td>
    </tr>`).join('');

  const cards = [
    SM._card('analysis_summary', 'Gesamt', `
      ${SM._mrow('Trades mit Ergebnis', withResult.length + ' von ' + labels.length + ' gespeichert')}
      ${SM._mrow('Trefferquote', SM._pct(winRate), winRate >= 50 ? 'good' : 'bad')}
      ${SM._mrow('Durchschnitt R (Erwartungswert)', SM._rFmt(avgR), avgR >= 0 ? 'good' : 'bad')}
      ${SM._mrow('Profit-Faktor', seq.profitFactor == null ? '∞ (keine Verluste)' : seq.profitFactor.toFixed(2), seq.profitFactor == null || seq.profitFactor >= 1 ? 'good' : 'bad')}
      ${SM._mrow('Max. Drawdown (R-Summe)', seq.maxDD.toFixed(2) + 'R', seq.maxDD > 0 ? 'bad' : '')}
      ${SM._mrow('Laengste Gewinn-Serie', seq.maxWinStreak + ' Trades', 'good')}
      ${SM._mrow('Laengste Verlust-Serie', seq.maxLossStreak + ' Trades', 'bad')}
      ${SM._mrow('Durchschnitt MFE', avgMfe != null ? SM._rFmt(avgMfe) : '—')}
      ${SM._mrow('Durchschnitt MAE', avgMae != null ? SM._rFmt(avgMae) : '—')}
      ${SM._mrow('Bester Trade', SM._rFmt(bestR), 'good')}
      ${SM._mrow('Schlechtester Trade', SM._rFmt(worstR), 'bad')}
    `),
    SM._card('analysis_stop', 'Nach Stop-Strategie', SM._analysisBreakdownTable(byStopStrategy)),
    SM._card('analysis_class', 'Nach Label-Klasse', SM._analysisBreakdownTable(byClass)),
    SM._card('analysis_structure', 'Nach Trade-Struktur', SM._analysisBreakdownTable(byStructure)),
    SM._card('analysis_tactic', 'Nach Taktik', SM._analysisBreakdownTable(byTactic)),
    SM._card('analysis_trades', `Alle Trades (${labels.length})`, `
      <div class="analysis-trade-table"><table class="kv mono"><tbody>${tradeRows}</tbody></table></div>
    `),
  ];
  target.innerHTML = cards.join('');
};
