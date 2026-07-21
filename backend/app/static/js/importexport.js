// CSV-Import/Export/Backup/Restore - Funktionalitaet unveraendert aus der
// bisherigen Oberflaeche uebernommen.
var SM = window.SM = window.SM || {};

SM.importCsv = async function (file) {
  if (!file) { SM.showErr('Keine Datei gewaehlt.'); return; }
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch(SM.BASE + '/api/imports/csv', { method: 'POST', body: fd });
    const j = await r.json();
    SM.setMsg(`Importiert: ${j.imported}; Fehler: ${j.errors.length}`);
    if (j.errors.length) SM.showErr(j.errors.map((e) => `Zeile ${e.row}: ${e.message}`).join('\n'));
    else SM.showErr('');
    SM.loadLabels();
  } catch (e) { SM.showErr(e.message); }
};

SM.backup = async function () {
  try {
    const r = await SM.api('/backups', { method: 'POST' });
    SM.setMsg('Backup erstellt: ' + r.backup);
  } catch (e) { SM.showErr(e.message); }
};

SM.listBackups = async function () {
  try {
    const r = await SM.api('/backups');
    SM.$('backups').innerHTML = r.backups.length
      ? r.backups.map((b) => `<button onclick="SM.restore('${b}')">↺ ${b}</button>`).join('')
      : '<span class="hint">keine Backups</span>';
  } catch (e) { SM.showErr(e.message); }
};

SM.restore = async function (name) {
  if (!confirm('Backup zurueckspielen? Der aktuelle Stand wird vorher gesichert.')) return;
  try {
    const r = await SM.api('/backups/restore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backup: name }),
    });
    SM.setMsg('Zurueckgespielt aus ' + r.restored_from + '; Sicherung: ' + r.safety_backup);
    SM.loadLabels();
  } catch (e) { SM.showErr(e.message); }
};
