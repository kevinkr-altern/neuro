# Setup-Miner

Lokales browserbasiertes Charting- und Labeling-Tool für Momentum-Setups.

## Start für Nicht-Entwickler

1. Öffne einen Texteditor und kopiere `.env.example` nach `.env`.
2. Trage deinen EODHD API-Key hinter `EODHD_API_KEY=` ein.
3. Öffne ein Terminal im Projektordner.
4. Starte alles mit:

```bash
docker-compose up
```

5. Öffne im Browser: http://localhost:5173

Phase 1 enthält Labeling, CSV-Import, EODHD-m5-Verfügbarkeitsprüfung, lokalen SQLite-Speicher, Kursdaten-Cache, Export und Backup.

## Dokumente

- CSV-Import: `docs/csv_import_format.md`
- Datenpolitik: `docs/data_policy.md`

- Start & Prüfung: `docs/runbook_de.md`
- m5-Verfügbarkeitscheck: `docs/availability_check.md`
- Preisbasis je Feature: `docs/feature_price_basis.md`
