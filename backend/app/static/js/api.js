// Zentraler Fetch-Wrapper + Endpunkt-Helfer. Gleiche Herkunft: Backend liefert diese Seite selbst aus.
var SM = window.SM = window.SM || {};
SM.BASE = '';

SM.api = async function (path, options) {
  const res = await fetch(SM.BASE + '/api' + path, options || {});
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).detail || await res.text(); } catch { msg = await res.text(); }
    throw new Error(msg);
  }
  return res.json();
};

SM.getChartData = function (ticker, timeframe, dateFrom, dateTo) {
  const params = new URLSearchParams({ timeframe });
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  return SM.api(`/chart-data/${encodeURIComponent(ticker)}?${params.toString()}`);
};

SM.getM5Earliest = function (ticker) {
  return SM.api('/availability/m5-earliest', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker }),
  });
};

SM.checkM5 = function (ticker, entryDate) {
  return SM.api('/availability/m5', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker, entry_date: entryDate }),
  });
};

// Look-ahead-geschuetzter Einzeltag-Pfad (unveraendert) - einzige Quelle fuer Label-Kennzahlen.
SM.getChartCutoff = function (ticker, date, timeframe, cutoffTime) {
  return SM.api('/charts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker, date, timeframe: timeframe || '5m', cutoff_time: cutoffTime || null }),
  });
};
