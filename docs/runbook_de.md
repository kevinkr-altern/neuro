# Setup-Miner starten und prüfen

## Was jetzt anders ist

Es gibt nur noch **einen** Docker-Dienst. Die Oberfläche wird direkt vom
Backend (FastAPI) als eine einzige statische HTML-Seite ausgeliefert – kein
npm, kein separater Frontend-Container, kein Bau-Schritt. Damit kann beim
Starten nichts mehr am Übersetzen der Oberfläche scheitern.

## Schritt für Schritt

1. Öffne den Projektordner.
2. Kopiere `.env.example` nach `.env`.
3. Trage deinen EODHD-Key in `.env` ein.
4. Starte im Projektordner:

```bash
docker-compose up --build
```

5. Öffne im Browser:

```text
http://localhost:8000
```

## Was du sehen musst

- Überschrift: `Setup-Miner · Phase 1 Labeling`
- Gelber Hinweis: keine künstlichen Intraday-Daten, m15/m30 nur aus m5, Cutoff serverseitig.
- Bereich `Daten & Playback` mit Ticker, Entry-Datum, Cutoff-Zeit und Timeframe.
- Buttons `m5-Verfügbarkeit prüfen` und `Chart laden`.
- Chartfläche mit Volumen, PDH/PDL-Linien und Markern.
- Kennzahlen-Panel (ATR, LoD-Distance, ADR, ATR-Extension, RVOL linear, MA-Abstände, Gap, PDH/PDL, ORB).
- Label-Formular mit Entry-/Exit-/Stop-/Pivot-Feldern und Namensvorschau.
- CSV-Import, CSV-/JSON-Export, Backup und Restore.

## Wenn m5 funktioniert

1. Ticker z. B. `NVDA` eintragen.
2. Datum nach `2020-10-01` wählen.
3. `m5-Verfügbarkeit prüfen` klicken. Erwartung: `OK ... Bars=...`.
4. Optional eine Cutoff-Zeit (z. B. `10:00:00`) eintragen – der Chart zeigt dann
   keine Kerze nach dieser Uhrzeit (Playback wird serverseitig erzwungen).
5. Timeframe `m5`, `m15` oder `m30` wählen und `Chart laden` klicken.
6. Mit den Pfeiltasten eine Kerze wählen; mit `E/X/S/P` Marker setzen
   (Entry/Exit/Stop/Pivot) – nur bis zur Cutoff-Zeit erlaubt.

Wenn der Tarif keine Intraday-API enthält, erscheint im roten Fehlerfeld eine
verständliche EODHD-Fehlermeldung (z. B. Key ungültig, Kontingent erschöpft
oder Ticker nicht gefunden).
