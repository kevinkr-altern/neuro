# Setup-Miner starten und prüfen

## Was jetzt anders ist

Der Docker-Frontend-Container verwendet kein `npm install` mehr. Er startet als statische Nginx-UI und ist damit nicht mehr vom npm-Registry-Zugriff abhängig.

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

- Dunkles, TradingView-orientiertes Layout mit oberer Ticker-Leiste, linker Werkzeugleiste, großem Chart und rechter Seitenleiste.
- Button `Längsten Chart laden`.
- Timeframes `M5`, `M15`, `M30`, `H1`, `D1`, `W1`.
- Hinweis `m5-Start: Oktober 2020`.
- Replay-Leiste im Chart mit Startpunkt und Geschwindigkeit.
- Indikator-Legende im Chart: EMA10, EMA20, SMA50, SMA200.
- Linke Werkzeuge für Cursor, Entry, Exit und Linie.
- Rechts Kennzahlen, Marker, Label, CSV-Mapping-Import, Export und Backup.

## Replay benutzen

1. Ticker eingeben.
2. `Längsten Chart laden` klicken.
3. Mit dem Start-Slider im Chart den Replay-Startpunkt wählen.
4. Geschwindigkeit wählen.
5. `Replay` klicken.

## Entry/Exit markieren

1. Links `E` für Entry oder `X` für Exit wählen.
2. In den Chart klicken.
3. Der Marker erscheint im Chart und in der Marker-Liste.
4. Mit `／` kannst du eine horizontale Level-/Pivot-Linie setzen.

## m5 prüfen

1. Datum nach `2020-10-01` wählen.
2. `m5 prüfen` klicken.
3. Erwartung bei freigeschalteter Intraday-API: `OK ... Bars=...` und `m15/m30/H1 ableitbar: ja`.

Wenn der Tarif keine Intraday-API enthält, erscheint im roten Fehlerfeld eine EODHD-Fehlermeldung. Intraday gehört laut Plan zu All World Extended bzw. All-In-One; der echte Beweis erfolgt über den Button oder die CLI-Prüfung.
