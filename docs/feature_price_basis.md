# Preisbasis je Feature

- Chart: unadjusted OHLC.
- Levels, Stops, PDH, PDL: unadjusted OHLC.
- ATR(14): unadjusted OHLC aus abgeschlossenen Daily-Kerzen.
- LoD-Distance: Intraday-Preis und Low-of-Day aus unadjusted Intraday-OHLC, ATR aus unadjusted Daily-OHLC.
- ATR-Extension: unadjusted Close und unadjusted MA/ATR.
- ADR: unadjusted Daily-OHLC.
- Gap: unadjusted Intraday-Open gegen unadjusted Vortages-Close.
- Adjusted Close: nur später für langfristige Performance und RS-Berechnung.

## Nicht definierte Kennzahlen

Die ursprünglich implementierte `rmv15`-Funktion war eine eigene Erfindung. Sie wurde entfernt und durch `volatility_compression_proxy` ersetzt.

Formel des Proxy:

```text
population_standard_deviation( (High - Low) / Close * 100 ) über die letzten 15 Daily-Kerzen
```

Das ist ausdrücklich nicht die Deepvue-RMV-Definition.
