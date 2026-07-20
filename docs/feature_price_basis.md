# Preisbasis je Feature

**Split-bereinigt überall** (bewusste Entscheidung, Stand dieser Runde —
kehrt eine frühere "unadjustiert überall"-Vorgabe um). Chart, Kennzahlen-Panel
(ATR, PDH/PDL, ADR, Gap, LoD-Distance, ATR-Extension, RVOL), Opening-Range und
gespeicherte Entry-/Stop-/Target-/Pivot-Preise verwenden alle dieselbe,
split-bereinigte Preisbasis.

## Wie die Rückrechnung funktioniert

- Rohdaten bleiben unverändert in der Datenbank gespeichert (keine künstlichen
  Daten, keine Mutation der Historie).
- Die Umrechnung passiert ausschließlich beim **Lesen**: ein Kurs mit Datum T
  wird durch das Produkt aller Split-Verhältnisse **nach** T geteilt
  (`backend/app/services/split_adjust.py`). Das ist die Standard-Rückrechnung,
  wie sie jeder Broker/TradingView bei "adjusted" anzeigt.
- **Volumen wird NICHT einheitlich behandelt** — live gegen EODHD geprüft:
  der `/eod`-Endpunkt (daily UND weekly) liefert ein Volumen, das EODHD selbst
  bereits auf die aktuelle Aktienzahl umgerechnet hat (erkennbar daran, dass
  `adjusted_close × rohes Volumen` ein plausibles Dollar-Volumen ergibt, `close
  × rohes Volumen` dagegen nicht), während der `/intraday`-Endpunkt rohes,
  unadjustiertes Volumen liefert. Deshalb: `adjust_bars(..., adjust_volume=False)`
  für daily/weekly (`daily_bars_range`, `weekly_bars_range`, `_daily_before`),
  `adjust_volume=True` (Standard) für intraday (`_regular_intraday`,
  `_regular_intraday_range`, all-sessions). Eine frühere Version multiplizierte
  das Tages-/Wochenvolumen fälschlich nochmal, was für alte Tage vor einem
  Split absurd hohe Werte erzeugte (z.B. "13B+ Aktien" statt realer ~20-40M).
- Split-Historie kommt von EODHDs Splits-API und wird wie Kursdaten
  zwischengespeichert (`splits_history`-Tabelle, Wasserstandsmarken-Muster).
- Ein einziger Umrechnungspunkt pro Datenquelle (`_daily_before`,
  `daily_bars_range`, `weekly_bars_range`, `_regular_intraday`,
  `_regular_intraday_range` in `market_data.py`) — alles darüber (Aggregation,
  Indikatoren, Kennzahlen, ORB) bekommt automatisch bereits bereinigte Werte,
  keine verstreute Sonderbehandlung.

## Wichtige Nebenwirkung (bewusst akzeptiert)

Absolute $-Werte (ATR in $, PDH/PDL, gespeicherte Entry-/Stop-/Target-Preise)
**verschieben sich rückwirkend**, sobald ein neuer Split passiert — exakt wie
bei jedem Broker-Chart, der "adjusted" anzeigt. Prozentbasierte Kennzahlen
(LoD-Distance%, ATR-Extension, ADR%, Gap%, RVOL) sind von einer gleichmäßigen
Skalierung mathematisch unberührt.

**Bereits gespeicherte Labels werden nicht rückwirkend korrigiert.** Ihre
`entry_price`/`stop_price`/`pivot_level_price`-Werte wurden unter der alten,
unadjustierten Konvention erfasst und bleiben so gespeichert — das ist ein
Verhaltenswechsel ab jetzt, keine Datenmigration.

## Ausnahme: Wochenkerzen

EODHDs native Wochenkerzen sind bereits serverseitig über die Woche
aggregiert. Fällt ein Split mitten in eine Woche, wird die Rückrechnung mit
dem Faktor des Wochenstart-Datums angenähert (betrifft höchstens eine Kerze
pro Split-Ereignis) statt Wochenkerzen selbst aus Tageskerzen neu zu
berechnen (das würde der Datenpolitik widersprechen, die eigene Aggregation
zugunsten von EODHDs nativer Wochenberechnung vermeidet).

## `adjusted_close`

Die separat gespeicherte `adjusted_close`-Spalte (Split **und** Dividende)
wird für diese Rückrechnung nicht verwendet — die eigene, split-only
Rückrechnung ist präziser für den gemeldeten Anwendungsfall (Chart-
Kontinuität über Splits hinweg) und konsistent zwischen Tages-, Wochen- und
Intraday-Daten anwendbar (EODHDs Intraday-Endpunkt liefert gar kein
adjusted-Gegenstück).

## Nicht definierte Kennzahlen

Die ursprünglich implementierte `rmv15`-Funktion war eine eigene Erfindung. Sie wurde entfernt und durch `volatility_compression_proxy` ersetzt.

Formel des Proxy:

```text
population_standard_deviation( (High - Low) / Close * 100 ) über die letzten 15 Daily-Kerzen
```

Das ist ausdrücklich nicht die Deepvue-RMV-Definition.
