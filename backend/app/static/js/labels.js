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

SM.fillMetricsTable = function () {
  const m = SM.metrics || {};
  const rows = [
    ['Preis (Cutoff)', m.selected_price], ['Low of Day bisher', m.low_of_day_so_far], ['Session-Open', m.session_open],
    ['ATR(14) $', m.atr14_dollars], ['LoD-Distance %', m.lod_distance_pct],
    ['LoD ≤70%-Regel', m.lod_rule_70_ok == null ? null : (m.lod_rule_70_ok ? 'erfuellt' : 'verletzt')],
    ['ATR-Ext SMA50', m.atr_ext_sma50], ['ATR-Ext EMA10', m.atr_ext_ema10], ['ATR-Ext EMA21', m.atr_ext_ema21],
    ['ADR% 14T', m.adr14_pct], ['ADR% 20T', m.adr20_pct], ['Vol-Compression-Proxy 15T', m.volatility_compression_proxy_15],
    ['RVOL', m.rvol_projected != null ? m.rvol_projected + ' (' + (m.rvol_note || '') + ')' : null],
    ['Abstand EMA10 %', m.dist_ema10_pct], ['Abstand EMA20 %', m.dist_ema20_pct], ['Abstand SMA50 %', m.dist_sma50_pct],
    ['Abstand SMA100 %', m.dist_sma100_pct], ['Abstand SMA200 %', m.dist_sma200_pct],
    ['Gap %', m.gap_pct], ['PDH', m.pdh], ['PDL', m.pdl],
    ['ORB m5 H/L', m.orb_m5_valid ? m.orb_m5_high + ' / ' + m.orb_m5_low : 'noch nicht gueltig'],
    ['ORB m15 H/L', m.orb_m15_valid ? m.orb_m15_high + ' / ' + m.orb_m15_low : 'noch nicht gueltig'],
    ['ORB m30 H/L', m.orb_m30_valid ? m.orb_m30_high + ' / ' + m.orb_m30_low : 'noch nicht gueltig'],
    ['Datenstatus', m.data_status],
  ];
  SM.$('metrics').innerHTML = rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1] == null ? '—' : r[1]}</td></tr>`).join('');
  SM.setReferenceLines([
    { price: m.pdh, color: '#8a8a2e', title: 'PDH' },
    { price: m.pdl, color: '#8a8a2e', title: 'PDL' },
    { price: m.orb_m30_valid ? m.orb_m30_high : null, color: '#4dabf7', title: 'ORH m30' },
    { price: m.orb_m30_valid ? m.orb_m30_low : null, color: '#4dabf7', title: 'ORL m30' },
  ]);
};

SM.loadLabels = async function () {
  try {
    const l = await SM.api('/labels');
    SM.$('labels').innerHTML = l.map((x) => `<tr><td>${x.ticker}</td><td>${x.entry_date || ''}</td><td>${x.setup_name}</td><td>${x.label_class}</td><td>${x.result_r ?? ''}</td></tr>`).join('');
  } catch { /* Liste bleibt leer, kein harter Fehler */ }
};
