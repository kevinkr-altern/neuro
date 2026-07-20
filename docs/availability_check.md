# Echte m5-Verfügbarkeitsprüfung

## UI-Weg

- CSV im Bereich `CSV-Mapping-Import` auswählen.
- Die ersten 20 Zeilen erscheinen als Vorschau.
- Zielfelder zu eigenen Spalten mappen.
- Vor dem Import zeigt die UI:
  - Gesamtzahl Zeilen
  - Anzahl Trades zwischen 2020-01-01 und 2020-09-30
  - geschätzte API-Calls
- Nach Import sind Jan-Sep-2020-Trades mit `vor Beginn der m5-Historie` markiert.

## CLI-Weg

Wenn du die Tabelle direkt im Terminal willst:

```bash
cd backend
python -m app.scripts_check_m5 ../data/imports/trades.csv
```

Ausgabeformat:

```text
| Ticker | Entry-Datum | m5 vorhanden | m15/m30 ableitbar | Status |
```

Hinweis: In dieser Ausführungsumgebung liegt aktuell keine `.env` und keine CSV vor. Darum konnte ich den echten Key hier nicht ausführen, ohne dass du die Datei in diese Umgebung legst.
