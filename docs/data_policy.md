# Datenpolitik und Bias-Schutz

- Keine künstlichen Intraday-Daten.
- m5 ist die einzige externe Intraday-Rohdatenbasis.
- m15 und m30 werden deterministisch aus echten m5-Kerzen aggregiert.
- Playback-Modus begrenzt Chartdaten auf das gewählte Datum und optional die gewählte Uhrzeit.
- Intraday-Metriken nutzen nur bis zum selektierten Balken bekannte Daten.
- LoD-Distance wird nur berechnet, wenn ATR(14) aus abgeschlossenen Daily-Kerzen vorhanden ist.
- Ergebnis, MFE und MAE werden gespeichert, aber später nicht als Modell-Input verwendet.

## Timeframes

- M5: echte EODHD-5-Minuten-Kerzen.
- M15: Aggregation aus 3 echten M5-Kerzen.
- M30: Aggregation aus 6 echten M5-Kerzen.
- H1: Aggregation aus 12 echten M5-Kerzen.
- D1: EODHD-Daily-Daten mit längerer Historie.
- W1: Aggregation aus D1-Kerzen.
- M5-Historie für US-Aktien beginnt laut EODHD ab Oktober 2020; im Tool werden Daten vor 2020-10-01 für Intraday als nicht verfügbar markiert.
