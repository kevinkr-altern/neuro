// Stil-Einstellungen: Farben fuer Candles/Indikatoren/Volumen, Sichtbarkeit
// je Indikator. Rein clientseitige Anzeige-Praeferenz (localStorage) - keine
// Backend-Aenderung, keine Auswirkung auf Daten/Kennzahlen.
var SM = window.SM = window.SM || {};

SM.STYLE_STORAGE_KEY = 'setupminer_chart_style_v1';

SM.defaultStyle = function () {
  return {
    candleUp: '#55d98d', candleDown: '#ff6b6b',
    volumeUp: 'rgba(85,217,141,0.5)', volumeDown: 'rgba(255,107,107,0.5)',
    indicators: {
      ema10: { color: '#ffd166', visible: true },
      ema20: { color: '#06d6a0', visible: true },
      sma50: { color: '#4dabf7', visible: true },
      sma200: { color: '#ff922b', visible: true },
    },
  };
};

SM.loadStyle = function () {
  const def = SM.defaultStyle();
  try {
    const raw = localStorage.getItem(SM.STYLE_STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    return Object.assign({}, def, parsed, { indicators: Object.assign({}, def.indicators, parsed.indicators || {}) });
  } catch (e) { return def; }
};

SM.saveStyle = function (style) {
  try { localStorage.setItem(SM.STYLE_STORAGE_KEY, JSON.stringify(style)); } catch (e) { /* localStorage evtl. deaktiviert - Stil gilt nur fuer diese Sitzung */ }
};

SM.applyStyle = function (style) {
  const cs = SM.chartState;
  cs.candleSeries.applyOptions({
    upColor: style.candleUp, downColor: style.candleDown,
    wickUpColor: style.candleUp, wickDownColor: style.candleDown,
  });
  cs.volumeSeriesColors = { up: style.volumeUp, down: style.volumeDown };
  for (const key of Object.keys(cs.lineSeries)) {
    const ind = style.indicators[key];
    if (!ind) continue;
    cs.lineSeries[key].applyOptions({ color: ind.color, visible: ind.visible });
  }
  if (cs.bars && cs.bars.length) cs.volumeSeries.setData(SM.volumeToSeriesData(cs.bars));
};

SM.buildSettingsPanel = function () {
  const style = SM.loadStyle();
  const panel = SM.$('settingsPanel');
  const indicatorLabels = { ema10: 'EMA10', ema20: 'EMA20', sma50: 'SMA50', sma200: 'SMA200' };
  const rows = [];
  rows.push(`<div class="settings-row"><label>Candle up<input type="color" id="styleCandleUp" value="${style.candleUp}"></label><label>Candle down<input type="color" id="styleCandleDown" value="${style.candleDown}"></label></div>`);
  for (const key of Object.keys(indicatorLabels)) {
    const ind = style.indicators[key];
    rows.push(`<div class="settings-row"><label><input type="checkbox" id="styleVis_${key}" ${ind.visible ? 'checked' : ''}> ${indicatorLabels[key]}</label><input type="color" id="styleColor_${key}" value="${ind.color}"></div>`);
  }
  panel.innerHTML = rows.join('') + '<button id="btnStyleReset">Zuruecksetzen</button>';

  function collectAndApply() {
    const s = SM.loadStyle();
    s.candleUp = SM.$('styleCandleUp').value;
    s.candleDown = SM.$('styleCandleDown').value;
    for (const key of Object.keys(indicatorLabels)) {
      s.indicators[key] = { color: SM.$('styleColor_' + key).value, visible: SM.$('styleVis_' + key).checked };
    }
    SM.saveStyle(s);
    SM.applyStyle(s);
  }
  panel.querySelectorAll('input').forEach((el) => el.addEventListener('input', collectAndApply));
  SM.$('btnStyleReset').addEventListener('click', () => {
    const def = SM.defaultStyle();
    SM.saveStyle(def);
    SM.applyStyle(def);
    SM.buildSettingsPanel();
  });
};

SM.toggleSettingsPanel = function () {
  SM.$('settingsPanel').classList.toggle('hidden');
};
