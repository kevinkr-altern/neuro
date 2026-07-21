// Watchlist: Ticker sammeln und unter frei benannten Kategorien
// ("Prime", "Tier2", ...) gruppieren. Rein serverseitig in watchlist_items
// gespeichert (kein Bezug zu Labels/Setups). Klick auf einen Ticker laedt
// ihn direkt in den Haupt-Chart.
var SM = window.SM = window.SM || {};

SM.loadWatchlist = async function () {
  let items;
  try {
    items = await SM.api('/watchlist');
  } catch (e) { return; }
  const groups = {};
  for (const it of items) {
    (groups[it.category] = groups[it.category] || []).push(it);
  }
  const categories = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  SM.$('wlCategoryList').innerHTML = categories.map((c) => `<option value="${c}">`).join('');

  if (!categories.length) {
    SM.$('watchlistGroups').innerHTML = '<p class="metrics-empty">Watchlist ist leer - Ticker + Kategorie eintragen und hinzufuegen.</p>';
    return;
  }
  SM.$('watchlistGroups').innerHTML = categories.map((cat) => `
    <div class="metric-card" data-wl-cat="${cat}">
      <h4 onclick="SM.toggleWatchlistCategory('${cat}')"><span>${cat} (${groups[cat].length})</span><span class="card-caret">${SM.wlCollapsed && SM.wlCollapsed[cat] ? '▸' : '▾'}</span></h4>
      <div class="metric-card-body wl-ticker-list">
        ${groups[cat].map((it) => `
          <div class="wl-item">
            <span class="wl-ticker" onclick="SM.loadTickerFromWatchlist('${it.ticker}')">${it.ticker}</span>
            <button class="btn-danger" title="Aus Watchlist entfernen" onclick="SM.deleteWatchlistItem(${it.id})">✕</button>
          </div>`).join('')}
      </div>
    </div>
  `).join('');
  categories.forEach((cat) => {
    const card = document.querySelector(`.metric-card[data-wl-cat="${cat}"]`);
    if (card && SM.wlCollapsed && SM.wlCollapsed[cat]) card.classList.add('collapsed');
  });
};

SM.wlCollapsed = {};
SM.toggleWatchlistCategory = function (cat) {
  SM.wlCollapsed[cat] = !SM.wlCollapsed[cat];
  SM.loadWatchlist();
};

SM.addWatchlistItem = async function () {
  const ticker = SM.$('wlTicker').value.trim().toUpperCase();
  const category = SM.$('wlCategory').value.trim() || 'Watchlist';
  if (!ticker) { SM.showErr('Bitte Ticker fuer die Watchlist eingeben.'); return; }
  try {
    await SM.api('/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker, category }) });
    SM.$('wlTicker').value = '';
    await SM.loadWatchlist();
  } catch (e) { SM.showErr(e.message); }
};

SM.deleteWatchlistItem = async function (id) {
  try {
    await SM.api(`/watchlist/${id}`, { method: 'DELETE' });
    await SM.loadWatchlist();
  } catch (e) { SM.showErr(e.message); }
};

SM.loadTickerFromWatchlist = function (ticker) {
  SM.$('ticker').value = ticker;
  SM.loadTicker('1d');
  SM.checkM5Earliest(ticker);
  document.querySelector('[data-tab="metrics"]').click();
};
