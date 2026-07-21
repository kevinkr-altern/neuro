# CSV-Importformat Setup-Miner

## Pflichtspalten

```csv
ticker,entry_date,label_class,structure,trigger,tactic
```

## Empfohlenes vollständiges Format

```csv
ticker,exchange,entry_date,entry_time,entry_timezone,entry_price,exit_date,exit_time,exit_price,stop_price,pivot_level_price,level_name,result_r,result_is_hypothetical,mfe_r,mae_r,label_class,structure,trigger,tactic,orderly_rating,notes,source
```

## Erlaubte Werte

- `label_class`: `A+`, `Gut`, `Neutral`, `Fehlsignal`, `Bewusst geskippt`
- `structure`: `HTF`, `Pullback`, `Base`, `EP`
- `trigger`: `Base-BO`, `U&R`, `EMA-Reclaim`, `Reclaim-FT`, `EP-Trigger`
- `tactic`: `ORB m5`, `ORB m15`, `ORB m30`, `PDH Buy-Stop`, `Sniper`, `EOTD`

## Datenpolitik

Fehlende Intraday-Daten werden nicht imputiert. m15 und m30 entstehen nur aus echten m5-Kerzen.
