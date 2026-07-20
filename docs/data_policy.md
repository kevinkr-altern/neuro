# Datenpolitik und Bias-Schutz

- Keine künstlichen Intraday-Daten.
- m5 ist die einzige externe Intraday-Rohdatenbasis.
- m15 und m30 werden deterministisch aus echten m5-Kerzen aggregiert.
- Playback-Modus begrenzt Chartdaten auf das gewählte Datum und optional die gewählte Uhrzeit.
- Intraday-Metriken nutzen nur bis zum selektierten Balken bekannte Daten.
- LoD-Distance wird nur berechnet, wenn ATR(14) aus abgeschlossenen Daily-Kerzen vorhanden ist.
- Ergebnis, MFE und MAE werden gespeichert, aber später nicht als Modell-Input verwendet.
