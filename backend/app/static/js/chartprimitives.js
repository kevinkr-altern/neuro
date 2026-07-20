// Wiederverwendbare Lightweight-Charts-v5-Primitive (ISeriesPrimitive) fuer
// Rechtecke und volle-Pane-Hoehe-Baender. API exakt gegen das vendorte
// v5.2.0-typings.d.ts geprueft (series.attachPrimitive/detachPrimitive,
// paneViews()->{zOrder,renderer:{draw(target)}}, attached({chart,series,
// requestUpdate}), Koordinaten ueber series.priceToCoordinate() /
// chart.timeScale().timeToCoordinate(), Canvas-Zeichnen ueber
// target.useBitmapCoordinateSpace()) - keine geratenen Methodennamen.
var SM = window.SM = window.SM || {};

// Preis- UND zeitbegrenztes Rechteck (fuer die Positions-Box: Zielzone/Stopzone).
SM.RectPrimitive = function (opts) {
  this._opts = Object.assign({ fillColor: 'rgba(0,0,0,0.2)', borderColor: null, borderWidth: 1 }, opts);
  this._chart = null; this._series = null; this._requestUpdate = null;
};
SM.RectPrimitive.prototype.attached = function (param) {
  this._chart = param.chart; this._series = param.series; this._requestUpdate = param.requestUpdate;
};
SM.RectPrimitive.prototype.detached = function () { this._chart = null; this._series = null; };
SM.RectPrimitive.prototype.updateAllViews = function () {};
SM.RectPrimitive.prototype.setBounds = function (timeFrom, timeTo, priceFrom, priceTo) {
  this._opts.timeFrom = timeFrom; this._opts.timeTo = timeTo;
  this._opts.priceFrom = priceFrom; this._opts.priceTo = priceTo;
  if (this._requestUpdate) this._requestUpdate();
};
SM.RectPrimitive.prototype.paneViews = function () {
  var self = this;
  return [{
    zOrder: function () { return 'bottom'; },
    renderer: function () {
      return {
        draw: function (target) {
          var o = self._opts;
          if (!self._chart || !self._series || o.priceFrom == null || o.priceTo == null || o.timeFrom == null || o.timeTo == null) return;
          var ts = self._chart.timeScale();
          var x1 = ts.timeToCoordinate(o.timeFrom);
          var x2 = ts.timeToCoordinate(o.timeTo);
          var y1 = self._series.priceToCoordinate(o.priceFrom);
          var y2 = self._series.priceToCoordinate(o.priceTo);
          if (x1 == null || x2 == null || y1 == null || y2 == null) return;
          target.useBitmapCoordinateSpace(function (scope) {
            var ctx = scope.context;
            var rx1 = Math.round(x1 * scope.horizontalPixelRatio), rx2 = Math.round(x2 * scope.horizontalPixelRatio);
            var ry1 = Math.round(y1 * scope.verticalPixelRatio), ry2 = Math.round(y2 * scope.verticalPixelRatio);
            var left = Math.min(rx1, rx2), width = Math.max(1, Math.abs(rx2 - rx1));
            var top = Math.min(ry1, ry2), height = Math.max(1, Math.abs(ry2 - ry1));
            ctx.fillStyle = o.fillColor;
            ctx.fillRect(left, top, width, height);
            if (o.borderColor) {
              ctx.strokeStyle = o.borderColor;
              ctx.lineWidth = (o.borderWidth || 1) * scope.horizontalPixelRatio;
              ctx.strokeRect(left, top, width, height);
            }
          });
        },
      };
    },
  }];
};

// Nur zeitbegrenztes Band ueber die volle Pane-Hoehe (fuer ORB-Fenster).
SM.VerticalBandPrimitive = function (opts) {
  this._opts = Object.assign({ fillColor: 'rgba(255,255,255,0.05)' }, opts);
  this._chart = null; this._requestUpdate = null;
};
SM.VerticalBandPrimitive.prototype.attached = function (param) {
  this._chart = param.chart; this._requestUpdate = param.requestUpdate;
};
SM.VerticalBandPrimitive.prototype.detached = function () { this._chart = null; };
SM.VerticalBandPrimitive.prototype.updateAllViews = function () {};
SM.VerticalBandPrimitive.prototype.setRange = function (timeFrom, timeTo) {
  this._opts.timeFrom = timeFrom; this._opts.timeTo = timeTo;
  if (this._requestUpdate) this._requestUpdate();
};
SM.VerticalBandPrimitive.prototype.paneViews = function () {
  var self = this;
  return [{
    zOrder: function () { return 'bottom'; },
    renderer: function () {
      return {
        draw: function (target) {
          var o = self._opts;
          if (!self._chart || o.timeFrom == null || o.timeTo == null) return;
          var ts = self._chart.timeScale();
          var x1 = ts.timeToCoordinate(o.timeFrom);
          var x2 = ts.timeToCoordinate(o.timeTo);
          if (x1 == null || x2 == null) return;
          target.useBitmapCoordinateSpace(function (scope) {
            var ctx = scope.context;
            var rx1 = Math.round(x1 * scope.horizontalPixelRatio), rx2 = Math.round(x2 * scope.horizontalPixelRatio);
            var left = Math.min(rx1, rx2), width = Math.max(1, Math.abs(rx2 - rx1));
            ctx.fillStyle = o.fillColor;
            ctx.fillRect(left, 0, width, scope.bitmapSize.height);
          });
        },
      };
    },
  }];
};
