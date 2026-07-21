# Datenpolitik und Bias-Schutz

- Keine künstlichen Intraday-Rohdaten.
- m5 ist die einzige externe **Intraday**-Rohdatenbasis. m15, m30 und h1
  werden deterministisch und ausschließlich aus echten, gespeicherten
  m5-Kerzen aggregiert (nie nativ von EODHD als eigene Intraday-Auflösung
  geladen), verankert an 09:30 ET. Unvollständige Fenster (Datenlücke) werden
  als solche markiert, nie stillschweigend als vollständig behandelt.
- Diese Politik ist bewusst auf Intraday-Rohdaten beschränkt. Daily (D1) und
  Weekly (W1) sind offizielle, von der Börse/EODHD bereits publizierte
  Kerzen (keine Erfindung) und werden nativ geladen (`period=d` bzw. nativ
  `period=w` für W1 – EODHD aggregiert Wochenkerzen serverseitig korrekt inkl.
  Teilwochen/Feiertagen, keine eigene manuelle Aggregation nötig).
- Der echte, pro-Ticker verifizierte Beginn der m5-Historie wird per
  Bisektionssuche ermittelt und in `data_availability` zwischengespeichert
  (nicht mehr aus einer globalen, plattformweiten Schätzung übernommen).
- Playback-Modus begrenzt Chartdaten auf das gewählte Datum und optional die
  gewählte Uhrzeit (Cutoff exklusiv: eine zum Cutoff-Zeitpunkt startende Kerze
  ist noch nicht abgeschlossen und wird nicht angezeigt).
- Intraday-Metriken nutzen nur bis zum selektierten Balken bekannte Daten.
- LoD-Distance wird nur berechnet, wenn ATR(14) aus abgeschlossenen Daily-Kerzen vorhanden ist.
- Ergebnis, MFE und MAE werden gespeichert, aber später nicht als Modell-Input verwendet.
- Der breite Chart-Daten-Endpunkt (`/api/chart-data`, für freies Browsing und
  den visuellen Replay-Modus) ist strikt von den Look-ahead-geschützten
  Label-Kennzahlen getrennt: er liefert nie Kennzahlen und wird nie als Input
  für `compute_metrics()` verwendet. Die einzige Quelle für Label-Kennzahlen
  bleibt der Cutoff-geschützte `/api/charts`-Pfad. Replay ist rein visuell –
  das Pausieren und Markieren eines Setups ruft explizit diesen geschützten
  Pfad auf, niemals die Breitband-Daten.
