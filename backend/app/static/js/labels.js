// Label-Formular (bestehende Felder unveraendert) + Namensvorschau +
// Kennzahlen-Panel. "Setup hier markieren" leitet {date, cutoff_et} aus der
// Replay-Position ab und ruft den bestehenden, unveraenderten Look-ahead-
// geschuetzten /api/charts-Cutoff-Pfad auf - Replay selbst ist NIE die Quelle
// fuer Kennzahlen.
var SM = window.SM = window.SM || {};
SM.$ = (id) => document.getElementById(id);
SM.currentSetupId = null;
SM.lastEntryDate = null;
SM.lastCutoff = null;
SM.metrics = {};

SM.labelOptions = {
  label_class: ['A+', 'Gut', 'Neutral', 'Fehlsignal', 'Bewusst geskippt'],
  structure: ['HTF', 'Pullback', 'Base', 'EP'],
  trigger: ['Base-BO', 'U&R', 'EMA-Reclaim', 'Reclaim-FT', 'EP-Trigger'],
  tactic: ['ORB m5', 'ORB m15', 'ORB m30', 'PDH Buy-Stop', 'Sniper', 'EOTD'],
  level_name: ['PDH', 'PDL-Reclaim', 'ORH m5', 'ORH m15', 'ORH m30', 'Pivot', 'EMA10', 'EMA20', 'Reclaim-Kerzenhoch'],
};

SM.buildLabelForm = function () {
  let h = '';
  for (const f of ['label_class', 'structure', 'trigger', 'tactic']) {
    h += `<label>${f}<select id="${f}" onchange="SM.nameIt()">${SM.labelOptions[f].map((o) => `<option>${o}</option>`).join('')}</select></label>`;
  }
  SM.$('form').innerHTML = h;
  SM.$('level_name').innerHTML = SM.labelOptions.level_name.map((o) => `<option>${o}</option>`).join('');
  SM.nameIt();
};

SM.nameIt = function () {
  SM.$('setupName').textContent = `${SM.$('structure').value} / ${SM.$('trigger').value} / ${SM.$('tactic').value} @ ${SM.$('level_name').value}`;
};

SM.deriveCutoffFromReplay = function () {
  const pos = SM.replay.positionTime;
  if (!pos) return { date: null, cutoff: null };
  const date = pos.slice(0, 10);
  const timeMatch = pos.slice(10).match(/(\d{2}:\d{2}:\d{2})/);
  // D1/W1-Position hat keine Uhrzeit -> Sessionende annehmen (siehe Plan).
  const cutoff = timeMatch ? timeMatch[1] : '16:00:00';
  return { date, cutoff };
};

SM.markSetupHere = async function () {
  const { date, cutoff } = SM.deriveCutoffFromReplay();
  if (!date) { SM.showErr('Erst im Replay einen Zeitpunkt waehlen (Kerze anklicken).'); return; }
  try {
    const r = await SM.getChartCutoff(SM.$('ticker').value, date, '5m', cutoff);
    SM.metrics = r.metrics || {};
    SM.fillMetricsTable();
    SM.lastEntryDate = date; SM.lastCutoff = cutoff;
    SM.setMsg(`Kennzahlen fuer ${date} (Cutoff ${cutoff}) geladen. Jetzt Label ausfuellen und speichern.`);
    document.querySelector('[data-tab="label"]').click();
  } catch (e) { SM.showErr(e.message); }
};

SM.saveLabel = async function () {
  if (!SM.lastEntryDate) { SM.showErr('Erst "Setup hier markieren" (im Replay) verwenden, damit ein Entry-Datum vorliegt.'); return; }
  try {
    const body = {
      ticker: SM.$('ticker').value, entry_date: SM.lastEntryDate, entry_time: SM.lastCutoff,
      label_class: SM.$('label_class').value, structure: SM.$('structure').value, trigger: SM.$('trigger').value, tactic: SM.$('tactic').value,
      level_name: SM.$('level_name').value, orderly_rating: +SM.$('orderly_rating').value,
      result_r: SM.$('result_r').value ? +SM.$('result_r').value : null,
      result_is_hypothetical: SM.$('result_is_hypothetical').checked,
      mfe_r: SM.$('mfe_r').value ? +SM.$('mfe_r').value : null,
      mae_r: SM.$('mae_r').value ? +SM.$('mae_r').value : null,
      entry_price: SM.$('entry_price').value ? +SM.$('entry_price').value : null,
      stop_price: SM.$('stop_price').value ? +SM.$('stop_price').value : null,
      target_price: SM.$('target_price').value ? +SM.$('target_price').value : null,
      pivot_level_price: SM.$('pivot_level_price').value ? +SM.$('pivot_level_price').value : null,
      notes: SM.$('notes').value,
      cutoff_timestamp: `${SM.lastEntryDate} ${SM.lastCutoff} ET`,
      was_playback_enforced: !!SM.replay.active,
    };
    const r = await SM.api('/labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    SM.currentSetupId = r.id;
    SM.setMsg('Gespeichert: ' + r.setup_name + ' (id ' + r.id + ')');
    await SM.loadMarkersForSetup(r.id);
    SM.loadLabels();
  } catch (e) { SM.showErr(e.message); }
};

// ---------- Kennzahlen als gruppierte, farblich codierte Karten (statt einer
// langen flachen Tabelle) - plus dieselben Werte kompakt direkt am Chart
// (SM.updateQuickStats), damit man nicht in den Tab wechseln muss. ----------

SM._mrow = function (label, valueText, cls) {
  return `<div class="metric-row"><span class="k">${label}</span><span class="v${cls ? ' ' + cls : ''}">${valueText}</span></div>`;
};
SM._signCls = function (v) { return v == null ? 'dim' : (v >= 0 ? 'good' : 'bad'); };
SM._fmt = function (v, suffix) { return v == null ? '—' : (v + (suffix || '')); };
SM._fmtPrice = function (v) { return v == null ? '—' : v.toFixed(2); };

SM.fillMetricsTable = function () {
  const m = SM.metrics || {};
  const target = SM.$('metrics');
  if (!m || Object.keys(m).length === 0) {
    target.innerHTML = '<p class="metrics-empty">Noch keine Kennzahlen geladen — im Replay eine Kerze anklicken oder "Setup hier markieren" verwenden.</p>';
    SM.updateQuickStats();
    return;
  }
  const orbRow = (tf) => m[`orb_${tf}_valid`] ? `${SM._fmtPrice(m[`orb_${tf}_high`])} / ${SM._fmtPrice(m[`orb_${tf}_low`])}` : 'noch nicht gueltig';
  const cards = [
    `<div class="metric-card"><h4>Preis</h4>
      ${SM._mrow('Preis (Cutoff)', SM._fmtPrice(m.selected_price))}
      ${SM._mrow('Session-Open', SM._fmtPrice(m.session_open))}
      ${SM._mrow('Gap %', SM._fmt(m.gap_pct, '%'), SM._signCls(m.gap_pct))}
      ${SM._mrow('PDH', SM._fmtPrice(m.pdh))}
      ${SM._mrow('PDL', SM._fmtPrice(m.pdl))}
      ${SM._mrow('Low of Day bisher', SM._fmtPrice(m.low_of_day_so_far))}
    </div>`,
    `<div class="metric-card"><h4>Volatilitaet</h4>
      ${SM._mrow('ATR(14) $', SM._fmtPrice(m.atr14_dollars))}
      ${SM._mrow('LoD-Distance %', SM._fmt(m.lod_distance_pct, '%'), m.lod_rule_70_ok == null ? 'dim' : (m.lod_rule_70_ok ? 'good' : 'bad'))}
      ${SM._mrow('LoD ≤70%-Regel', m.lod_rule_70_ok == null ? '—' : (m.lod_rule_70_ok ? 'erfuellt' : 'verletzt'), m.lod_rule_70_ok == null ? 'dim' : (m.lod_rule_70_ok ? 'good' : 'bad'))}
      ${SM._mrow('ATR-Ext SMA50', SM._fmt(m.atr_ext_sma50))}
      ${SM._mrow('ATR-Ext EMA10', SM._fmt(m.atr_ext_ema10))}
      ${SM._mrow('ATR-Ext EMA21', SM._fmt(m.atr_ext_ema21))}
      ${SM._mrow('ADR% 14T', SM._fmt(m.adr14_pct, '%'))}
      ${SM._mrow('ADR% 20T', SM._fmt(m.adr20_pct, '%'))}
      ${SM._mrow('Vol-Compression-Proxy 15T', SM._fmt(m.volatility_compression_proxy_15))}
    </div>`,
    `<div class="metric-card"><h4>Volumen</h4>
      ${SM._mrow('RVOL', m.rvol_projected != null ? m.rvol_projected : '—')}
      ${SM._mrow('Methode', m.rvol_note || '—', 'dim')}
    </div>`,
    `<div class="metric-card"><h4>Abstand zu Moving Averages</h4>
      ${SM._mrow('EMA10 %', SM._fmt(m.dist_ema10_pct, '%'), SM._signCls(m.dist_ema10_pct))}
      ${SM._mrow('EMA20 %', SM._fmt(m.dist_ema20_pct, '%'), SM._signCls(m.dist_ema20_pct))}
      ${SM._mrow('SMA50 %', SM._fmt(m.dist_sma50_pct, '%'), SM._signCls(m.dist_sma50_pct))}
      ${SM._mrow('SMA100 %', SM._fmt(m.dist_sma100_pct, '%'), SM._signCls(m.dist_sma100_pct))}
      ${SM._mrow('SMA200 %', SM._fmt(m.dist_sma200_pct, '%'), SM._signCls(m.dist_sma200_pct))}
    </div>`,
    `<div class="metric-card"><h4>Opening Range</h4>
      ${SM._mrow('ORB M5 H/L', orbRow('m5'), m.orb_m5_valid ? '' : 'dim')}
      ${SM._mrow('ORB M15 H/L', orbRow('m15'), m.orb_m15_valid ? '' : 'dim')}
      ${SM._mrow('ORB M30 H/L', orbRow('m30'), m.orb_m30_valid ? '' : 'dim')}
    </div>`,
    `<div class="metric-card"><h4>Status</h4>
      ${SM._mrow('Datenstatus', m.data_status || '—', (m.flags && m.flags.length) ? 'bad' : 'good')}
    </div>`,
  ];
  target.innerHTML = cards.join('');
  SM.setReferenceLines([
    { price: m.pdh, color: '#8a8a2e', title: 'PDH' },
    { price: m.pdl, color: '#8a8a2e', title: 'PDL' },
    { price: m.orb_m30_valid ? m.orb_m30_high : null, color: '#4dabf7', title: 'ORH m30' },
    { price: m.orb_m30_valid ? m.orb_m30_low : null, color: '#4dabf7', title: 'ORL m30' },
  ]);
  SM.updateQuickStats();
};

// Kompakter Auszug der wichtigsten Kennzahlen direkt am Chart, damit man
// nicht in den Kennzahlen-Tab wechseln muss - dieselbe SM.metrics-Quelle,
// nur eine zweite, knappere Darstellung.
SM.updateQuickStats = function () {
  const el = SM.$('quickStats');
  if (!el) return;
  const m = SM.metrics || {};
  if (m.selected_price == null) { el.innerHTML = ''; return; }
  const chip = (label, value, cls) => `<span class="qs-chip${cls ? ' ' + cls : ''}">${label}<b>${value}</b></span>`;
  const chips = [chip('Preis', SM._fmtPrice(m.selected_price))];
  if (m.gap_pct != null) chips.push(chip('Gap', m.gap_pct + '%', m.gap_pct >= 0 ? 'good' : 'bad'));
  if (m.lod_distance_pct != null) chips.push(chip('LoD-Dist', m.lod_distance_pct + '%', m.lod_rule_70_ok ? 'good' : 'bad'));
  if (m.atr_ext_ema10 != null) chips.push(chip('ATR-Ext EMA10', m.atr_ext_ema10));
  if (m.rvol_projected != null) chips.push(chip('RVOL', m.rvol_projected, m.rvol_projected >= 1 ? 'good' : 'warn2'));
  if (m.orb_m5_valid) chips.push(chip('ORB M5', SM._fmtPrice(m.orb_m5_high) + '/' + SM._fmtPrice(m.orb_m5_low)));
  el.innerHTML = chips.join('');
};

SM.loadLabels = async function () {
  try {
    const l = await SM.api('/labels');
    SM.$('labels').innerHTML = l.map((x) => `<tr><td>${x.ticker}</td><td>${x.entry_date || ''}</td><td>${x.setup_name}</td><td>${x.label_class}</td><td>${x.result_r ?? ''}</td><td><button class="btn-danger" title="Label loeschen" onclick="SM.deleteLabel(${x.id})">✕</button></td></tr>`).join('');
  } catch { /* Liste bleibt leer, kein harter Fehler */ }
};

SM.deleteLabel = async function (id) {
  if (!confirm('Dieses Label wirklich unwiderruflich loeschen?')) return;
  try {
    await SM.api(`/labels/${id}`, { method: 'DELETE' });
    if (SM.currentSetupId === id) SM.currentSetupId = null;
    SM.setMsg('Label geloescht.');
    SM.loadLabels();
  } catch (e) { SM.showErr(e.message); }
};

// Verwirft den aktuell im Formular stehenden, noch NICHT gespeicherten
// Label-Entwurf (Datum/Cutoff/Kennzahlen aus "Setup hier markieren") - loescht
// KEIN bereits gespeichertes Label, das macht SM.deleteLabel().
SM.cancelLabel = function () {
  SM.currentSetupId = null;
  SM.lastEntryDate = null;
  SM.lastCutoff = null;
  SM.metrics = {};
  document.querySelectorAll('#form select').forEach((s) => { s.selectedIndex = 0; });
  ['result_r', 'mfe_r', 'mae_r', 'entry_price', 'stop_price', 'target_price', 'pivot_level_price'].forEach((id) => {
    if (SM.$(id)) SM.$(id).value = '';
  });
  if (SM.$('result_is_hypothetical')) SM.$('result_is_hypothetical').checked = false;
  if (SM.$('notes')) SM.$('notes').value = '';
  SM.nameIt();
  SM.clearPosition();
  SM.setMsg('Label-Entwurf verworfen.');
};
