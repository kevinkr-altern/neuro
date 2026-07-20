// Entry/Exit/Stop/Pivot-Marker: Rendering (Lightweight-Charts-native Marker)
// + Platzierung per Klick oder Taste. Der Server (/api/markers) bleibt die
// einzige durchsetzende Instanz fuer die Look-ahead-Pruefung - dieser Client-
// Check ist nur sofortiges UX-Feedback, kein Vertrauen.
var SM = window.SM = window.SM || {};
SM.armedMarkerType = null;

SM.markerStyle = {
  entry: { shape: 'arrowUp', position: 'belowBar', color: '#55d98d', text: 'E' },
  exit: { shape: 'arrowDown', position: 'aboveBar', color: '#ff6b6b', text: 'X' },
  stop: { shape: 'square', position: 'aboveBar', color: '#ffa94d', text: 'S' },
  pivot: { shape: 'circle', position: 'inBar', color: '#4dabf7', text: 'P' },
};

SM.armMarker = function (type) {
  SM.armedMarkerType = SM.armedMarkerType === type ? null : type;
  document.querySelectorAll('[data-marker]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.marker === SM.armedMarkerType);
  });
};

SM.loadMarkersForSetup = async function (setupId) {
  if (!setupId) { SM.setMarkers([]); return; }
  try {
    const rows = await SM.api(`/markers/${setupId}`);
    const markers = rows
      .map((r) => ({ time: SM.toUnixTime(r.timestamp), ...SM.markerStyle[r.marker_type] }))
      .sort((a, b) => a.time - b.time);
    SM.setMarkers(markers);
  } catch (e) { /* Chart soll trotzdem sichtbar bleiben, auch wenn Marker-Laden fehlschlaegt */ }
};

SM.placeMarkerAtBar = async function (bar, typeOverride) {
  const type = typeOverride || SM.armedMarkerType;
  if (!type) { SM.showErr('Erst einen Marker-Typ waehlen (E/X/S/P oder Button).'); return; }
  if (!SM.currentSetupId) { SM.showErr('Erst Setup/Label speichern, dann Marker setzen.'); return; }
  // D1/W1-Kerzen haben nur ein Datum, keine Uhrzeit. Ohne Uhrzeit-Suffix wuerde
  // der Server 23:59:59 annehmen und den Marker faelschlich als "nach Cutoff"
  // ablehnen, wenn der Cutoff (z.B. 16:00:00 Sessionende) frueher am selben Tag
  // liegt. Deshalb dieselbe Sessionende-Konvention wie in deriveCutoffFromReplay().
  const timestamp = bar.time.length === 10 ? `${bar.time} 16:00:00` : bar.time;
  try {
    await SM.api('/markers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup_id: SM.currentSetupId, marker_type: type, timestamp,
        price: bar.close, timeframe: SM.chartState.timeframe,
      }),
    });
    SM.setMsg(`${type}-Marker gesetzt: ${bar.time} @ ${bar.close}`);
    await SM.loadMarkersForSetup(SM.currentSetupId);
  } catch (e) { SM.showErr(e.message); }
};
