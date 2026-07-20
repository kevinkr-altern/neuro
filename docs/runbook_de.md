# Setup-Miner starten und prüfen

## Was jetzt anders ist

Der Docker-Frontend-Container verwendet kein `npm install` mehr. Er startet als statische Nginx-UI und ist damit nicht mehr vom npm-Registry-Zugriff abhängig. Die React/TypeScript-Quelle bleibt im Repo, aber der Docker-Pfad ist bewusst robust für Nicht-Entwickler.

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
http://localhost:5173
```

## Was du sehen musst

- Überschrift: `Setup-Miner · Phase 1 Labeling`
- Gelber Hinweis: keine künstlichen Intraday-Daten, m15/m30 nur aus m5.
- Bereich `Daten & Playback` mit Ticker, Playback-Datum, Cutoff-Zeit und Timeframe.
- Button `m5-Verfügbarkeit prüfen`.
- Button `Chart laden`.
- Chartfläche.
- Kennzahlen-Panel.
- Label-Formular.
- CSV-Mapping-Import.
- Export & Backup.

## Wenn m5 funktioniert

1. Ticker z. B. `NVDA` eintragen.
2. Datum nach `2020-10-01` wählen.
3. `m5-Verfügbarkeit prüfen` klicken.
4. Erwartung: `OK ... Bars=...`.
5. Timeframe `5m`, `15m` oder `30m` wählen.
6. `Chart laden` klicken.

Wenn der Tarif keine Intraday-API enthält, erscheint im roten Fehlerfeld eine EODHD-Fehlermeldung. Intraday gehört laut Plan zu All World Extended bzw. All-In-One; der echte Beweis erfolgt über den Button oder die CLI-Prüfung.
