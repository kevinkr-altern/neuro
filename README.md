# Setup-Miner

Lokales browserbasiertes Charting- und Labeling-Tool für Momentum-Setups.

## Start für Nicht-Entwickler

1. Öffne einen Texteditor und kopiere `.env.example` nach `.env`.
2. Trage deinen EODHD API-Key hinter `EODHD_API_KEY=` ein.
3. Öffne ein Terminal im Projektordner.
4. Starte alles mit:

```bash
docker-compose up --build
```

5. Öffne im Browser: http://localhost:8000

Es gibt nur noch **einen** Dienst. Die Oberfläche wird direkt vom Backend
ausgeliefert – kein npm, kein separater Bau-Schritt, nichts, was beim Starten
scheitern kann. Eine Adresse zum Öffnen: `http://localhost:8000`.

Phase 1 enthält: Labeling mit Entry-/Exit-/Stop-/Pivot-Feldern, serverseitig
erzwungenen Playback-Cutoff, Kennzahlen-Panel (ATR, ADR, ATR-Extension,
LoD-Distance, RVOL linear, MA-Abstände, Gap, PDH/PDL, ORB mit Zeit-Gültigkeit),
Marker per Tastatur, CSV-Import, CSV-/JSON-Export, Backup **und** Restore,
lokalen SQLite-Speicher.

## Sicherheitshinweis

`.env.example` enthält bewusst nur einen Platzhalter. Trage deinen echten
EODHD-Key ausschließlich in die lokale `.env` ein – diese ist per `.gitignore`
vom Repository ausgeschlossen und darf nie committet werden.
