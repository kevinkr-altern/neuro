// Analyse-Seite: wertet ALLE gespeicherten Labels aus - aggregierte
// Risk/Return-Kennzahlen, Aufschluesselung nach Stop-Strategie/Label-Klasse/
// Struktur/Trigger/Taktik/Markt-Zustand (inkl. MFE/MAE je Gruppe), UND eine
// retrospektive Szenario-Simulation (alternative Stop-Strategien, ORB-
// Durchbruch-Entry, Kombinationen - siehe simulate.js). Die Trade-Uebersicht
// (Einzeltrade-Tabelle) lebt separat auf der Trades-Seite (SM.loadTradesPage).
// Rein clientseitig aus dem bestehenden GET /api/labels berechnet - keine
// neue Backend-Aggregation noetig, das Datenvolumen eines persoenlichen
// Trade-Journals ist dafuer klein genug.
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
    const withMfe = arr.filter((r) => r.mfe_r != null);
    const withMae = arr.filter((r) => r.mae_r != null);
    const avgMfe = withMfe.length ? withMfe.reduce((s, r) => s + r.mfe_r, 0) / withMfe.length : null;
    const avgMae = withMae.length ? withMae.reduce((s, r) => s + r.mae_r, 0) / withMae.length : null;
    return { key, n: arr.length, winRate: (wins / arr.length) * 100, avgR, avgMfe, avgMae };
  }).sort((a, b) => b.n - a.n);
};

SM._analysisBreakdownTable = function (groups) {
  if (!groups.length) return '<p class="metrics-empty">Keine Daten.</p>';
  return groups.map((g) => SM._mrow(
    `${g.key} (n=${g.n})`,
    `${SM._pct(g.winRate)} Trefferquote, ⌀ ${SM._rFmt(g.avgR)}, MFE ⌀ ${SM._rFmt(g.avgMfe)}, MAE ⌀ ${SM._rFmt(g.avgMae)}`,
    g.avgR >= 0 ? 'good' : 'bad',
  )).join('');
};

// Profit-Faktor, Drawdown (in R), Gewinn-/Verlust-Serien und Streuung
// (Standardabweichung R, R-adjustierte Kennzahl analog einer Sharpe-Ratio
// auf R-Multiple-Basis) - Standard-Risk/Return-Kennzahlen, in chronologischer
// Reihenfolge (nach Entry-Datum) berechnet.
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
  const avgR = withResult.reduce((s, l) => s + l.result_r, 0) / withResult.length;
  const variance = withResult.reduce((s, l) => s + (l.result_r - avgR) ** 2, 0) / withResult.length;
  const stdDevR = Math.sqrt(variance);
  const riskAdjusted = stdDevR > 0 ? avgR / stdDevR : null;
  return { profitFactor, maxDD, maxWinStreak, maxLossStreak, stdDevR, riskAdjusted };
};

SM._simResultRow = function (label, stats) {
  if (!stats) return SM._mrow(label, 'keine Daten', 'dim');
  return SM._mrow(`${label} (n=${stats.n})`, `${SM._pct(stats.winRate)} Trefferquote, ⌀ ${SM._rFmt(stats.avgR)}`, stats.avgR >= 0 ? 'good' : 'bad');
};

SM._simComboTable = function (combos) {
  const stopVariants = SM.SIM_STOP_VARIANTS;
  const head = `<tr><th></th>${stopVariants.map((v) => `<th>${SM.SIM_STOP_LABELS[v]}</th>`).join('')}</tr>`;
  const rows = SM.SIM_ORB_KEYS.map((k) => {
    const cells = stopVariants.map((v) => {
      const s = combos[k][v];
      if (!s) return '<td class="dim">—</td>';
      return `<td class="${s.avgR >= 0 ? 'ok' : 'bad'}">${SM._rFmt(s.avgR)}<br><span class="dim">n=${s.n}, ${SM._pct(s.winRate)}</span></td>`;
    }).join('');
    return `<tr><th>${SM.SIM_ORB_LABELS[k]}</th>${cells}</tr>`;
  }).join('');
  return `<div class="analysis-trade-table"><table class="kv mono sim-combo-table"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
};

SM.loadAnalysis = async function () {
  const target = SM.$('analysisContent');
  if (!target) return;
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
  const byTrigger = SM._analysisGroupBy(withResult, (l) => l.trigger);
  const byTactic = SM._analysisGroupBy(withResult, (l) => l.tactic);

  const cards = [
    SM._card('analysis_summary', 'Gesamt / Risk-Return', `
      ${SM._mrow('Trades mit Ergebnis', withResult.length + ' von ' + labels.length + ' gespeichert')}
      ${SM._mrow('Trefferquote', SM._pct(winRate), winRate >= 50 ? 'good' : 'bad')}
      ${SM._mrow('Durchschnitt R (Erwartungswert)', SM._rFmt(avgR), avgR >= 0 ? 'good' : 'bad')}
      ${SM._mrow('Streuung R (Standardabweichung)', seq.stdDevR.toFixed(2) + 'R')}
      ${SM._mrow('R-adjustiert (⌀R / Streuung)', seq.riskAdjusted == null ? '—' : seq.riskAdjusted.toFixed(2), seq.riskAdjusted != null && seq.riskAdjusted >= 0 ? 'good' : 'bad')}
      ${SM._mrow('Profit-Faktor', seq.profitFactor == null ? '∞ (keine Verluste)' : seq.profitFactor.toFixed(2), seq.profitFactor == null || seq.profitFactor >= 1 ? 'good' : 'bad')}
      ${SM._mrow('Max. Drawdown (R-Summe)', seq.maxDD.toFixed(2) + 'R', seq.maxDD > 0 ? 'bad' : '')}
      ${SM._mrow('Laengste Gewinn-Serie', seq.maxWinStreak + ' Trades', 'good')}
      ${SM._mrow('Laengste Verlust-Serie', seq.maxLossStreak + ' Trades', 'bad')}
      ${SM._mrow('Durchschnitt MFE', avgMfe != null ? SM._rFmt(avgMfe) : '—')}
      ${SM._mrow('Durchschnitt MAE', avgMae != null ? SM._rFmt(avgMae) : '—')}
      ${SM._mrow('Bester Trade', SM._rFmt(bestR), 'good')}
      ${SM._mrow('Schlechtester Trade', SM._rFmt(worstR), 'bad')}
    `, null, 'loadAnalysis'),
    SM._card('analysis_stop', 'Nach Stop-Strategie', SM._analysisBreakdownTable(byStopStrategy), null, 'loadAnalysis'),
    SM._card('analysis_class', 'Nach Label-Klasse', SM._analysisBreakdownTable(byClass), null, 'loadAnalysis'),
    SM._card('analysis_structure', 'Nach Trade-Struktur', SM._analysisBreakdownTable(byStructure), null, 'loadAnalysis'),
    SM._card('analysis_trigger', 'Nach Trigger', SM._analysisBreakdownTable(byTrigger), null, 'loadAnalysis'),
    SM._card('analysis_tactic', 'Nach Taktik', SM._analysisBreakdownTable(byTactic), null, 'loadAnalysis'),
    SM._card('analysis_market_state', 'Nach Markt-Zustand (QQQ)', '<p class="metrics-empty">Wird geladen…</p>', null, 'loadAnalysis'),
    SM._card('analysis_sim', 'Szenario-Simulation: alternative Entrys/Stops', '<p class="metrics-empty">Wird berechnet…</p>', null, 'loadAnalysis'),
    SM._card('analysis_sim_combo', 'Kombinationen: ORB-Entry × Stop-Strategie (⌀R)', '<p class="metrics-empty">Wird berechnet…</p>', null, 'loadAnalysis'),
  ];
  target.innerHTML = cards.join('');

  // Markt-Zustand-Aufschluesselung ist async (Zusatz-QQQ-Abruf) - nach dem
  // ersten Rendern nachladen, damit die uebrigen Karten sofort erscheinen.
  SM._loadMarketStateBreakdown(withResult);
  // Szenario-Simulation ebenfalls async (mehrere Chart-Data-Abrufe je Trade,
  // gecacht ueber simulate.js) - separat nachladen.
  SM._loadPortfolioSimulation(labels);
};

SM._loadMarketStateBreakdown = async function (withResult) {
  const el = document.querySelector('[data-card="analysis_market_state"] .metric-card-body');
  if (!el) return;
  try {
    const withState = [];
    for (const l of withResult) {
      if (!l.entry_date) continue;
      const state = await SM.simMarketStateFor(l.entry_date);
      if (state) withState.push({ ...l, _marketState: state });
    }
    if (!withState.length) { el.innerHTML = '<p class="metrics-empty">Nicht genug Daten.</p>'; return; }
    const groups = SM._analysisGroupBy(withState, (l) => l._marketState);
    el.innerHTML = SM._analysisBreakdownTable(groups);
  } catch (e) {
    el.innerHTML = '<p class="metrics-empty">Konnte Markt-Zustand nicht berechnen.</p>';
  }
};

SM._loadPortfolioSimulation = async function (labels) {
  const simEl = document.querySelector('[data-card="analysis_sim"] .metric-card-body');
  const comboEl = document.querySelector('[data-card="analysis_sim_combo"] .metric-card-body');
  if (!simEl || !comboEl) return;
  try {
    const r = await SM.runPortfolioSimulation(labels);
    simEl.innerHTML = [
      SM._simResultRow('Original (wie gehandelt)', r.orig),
      ...SM.SIM_STOP_VARIANTS.map((v) => SM._simResultRow('Stop: ' + SM.SIM_STOP_LABELS[v], r.stops[v])),
      ...SM.SIM_ORB_KEYS.map((k) => SM._simResultRow('Entry: ' + SM.SIM_ORB_LABELS[k] + ' (Original-Stop-Logik am ORB-Tief)', r.orbs[k])),
    ].join('');
    comboEl.innerHTML = SM._simComboTable(r.combos);
  } catch (e) {
    simEl.innerHTML = '<p class="metrics-empty">Simulation fehlgeschlagen.</p>';
    comboEl.innerHTML = '';
  }
};

// ---------- Trade-Uebersicht (eigene Seite) ----------

SM.loadTradesPage = async function () {
  const target = SM.$('tradesContent');
  if (!target) return;
  let labels;
  try {
    labels = await SM.api('/labels');
  } catch (e) {
    target.innerHTML = '<p class="metrics-empty">Konnte Labels nicht laden.</p>';
    return;
  }
  if (!labels.length) {
    target.innerHTML = '<p class="metrics-empty">Noch keine Labels gespeichert.</p>';
    return;
  }
  const sorted = labels.slice().sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));
  const rows = sorted.map((l) => `
    <tr>
      <td>${l.ticker}</td><td>${l.entry_date || ''}</td><td>${l.setup_name}</td>
      <td>${l.structure || '—'}</td><td>${l.trigger || '—'}</td><td>${l.tactic || '—'}</td>
      <td>${l.stop_strategy ? (SM.STOP_STRATEGY_LABELS[l.stop_strategy] || l.stop_strategy) : '—'}</td>
      <td class="${l.result_r > 0 ? 'ok' : (l.result_r < 0 ? 'bad' : '')}">${l.result_r != null ? SM._rFmt(l.result_r) : '—'}</td>
      <td>${l.mfe_r != null ? SM._rFmt(l.mfe_r) : '—'}</td>
      <td>${l.mae_r != null ? SM._rFmt(l.mae_r) : '—'}</td>
      <td><button class="btn-secondary" title="Trade-Box im Chart anzeigen" onclick="SM.viewLabelOnChart(${l.id})">📈</button></td>
      <td><button class="btn-secondary" title="Szenario-Simulation fuer diesen Trade" onclick="SM.toggleTradeSim(${l.id})">🔬</button></td>
    </tr>
    <tr id="tradeSimRow${l.id}" class="hidden trade-sim-row"><td colspan="11"><div id="tradeSim${l.id}"></div></td></tr>`).join('');

  target.innerHTML = `
    <div class="analysis-trade-table"><table class="kv mono trades-table">
      <thead><tr><th>Ticker</th><th>Entry</th><th>Setup</th><th>Struktur</th><th>Trigger</th><th>Taktik</th><th>Stop-Strategie</th><th>Ergebnis R</th><th>MFE</th><th>MAE</th><th></th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  SM._tradesById = Object.fromEntries(labels.map((l) => [l.id, l]));
};

SM.toggleTradeSim = async function (id) {
  const row = SM.$('tradeSimRow' + id);
  const body = SM.$('tradeSim' + id);
  if (!row || !body) return;
  if (!row.classList.contains('hidden')) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  const label = SM._tradesById && SM._tradesById[id];
  if (!label) { body.innerHTML = '<p class="metrics-empty">Trade nicht gefunden.</p>'; return; }
  if (label.entry_price == null || label.stop_price == null) {
    body.innerHTML = '<p class="metrics-empty">Fuer diesen Trade fehlen Entry-/Stop-Preis - keine Simulation moeglich.</p>';
    return;
  }
  body.innerHTML = '<p class="metrics-empty">Wird berechnet…</p>';
  try {
    const sim = await SM.simulateTrade(label);
    const rowsHtml = [
      SM._mrow('Original', sim.origR != null ? SM._rFmt(sim.origR) : '—'),
      ...SM.SIM_STOP_VARIANTS.map((v) => SM._mrow('Stop: ' + SM.SIM_STOP_LABELS[v], sim.stops[v] != null ? SM._rFmt(sim.stops[v]) : 'kein Treffer/keine Daten')),
      ...SM.SIM_ORB_KEYS.map((k) => SM._mrow('Entry: ' + SM.SIM_ORB_LABELS[k], sim.orbs[k] != null ? SM._rFmt(sim.orbs[k]) : 'kein Durchbruch/keine Daten')),
    ].join('');
    body.innerHTML = `<div class="trade-sim-box">${rowsHtml}</div>`;
  } catch (e) {
    body.innerHTML = '<p class="metrics-empty">Simulation fehlgeschlagen.</p>';
  }
};
