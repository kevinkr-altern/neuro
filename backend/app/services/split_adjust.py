"""Split-Rueckrechnung (Back-Adjustment) - reine Funktionen, kein Netzwerk/DB.

Konvention: ein Bar mit Datum T wird durch das Produkt der Verhaeltnisse ALLER
Splits NACH T geteilt (Volumen mit demselben Faktor multipliziert). Das ist die
Standard-Rueckrechnung (so zeigt jeder Broker/TradingView "adjusted" an) und
macht die Historie am Split-Tag stetig, statt einer kuenstlichen "Klippe".

Wichtig: das ist eine deterministische, oeffentlich bekannte Neuskalierung
ohne jede Vorhersage-Information - kein Look-ahead-Verstoss, auch wenn ein
Split NACH dem betrachteten Entry-Tag angewendet wird (die Datenpolitik
verbietet die Nutzung von Kursdaten NACH dem Cutoff, nicht die Anwendung
oeffentlicher, unveraenderlicher Unternehmensfakten wie eines Split-Verhaeltnisses)."""
from datetime import date as date_cls


def parse_split_ratio(split_str: str) -> float:
    """'4.000000/1.000000' -> 4.0 (Vorwaerts-Split). '1.000000/10.000000' -> 0.1 (Reverse-Split)."""
    parts = split_str.split('/')
    if len(parts) != 2:
        raise ValueError(f'Unerwartetes Split-Format: {split_str!r} (erwartet "X/Y")')
    new, old = float(parts[0]), float(parts[1])
    if old == 0:
        raise ValueError(f'Split-Verhaeltnis mit Nenner 0: {split_str!r}')
    return new / old


def _bar_date(bar: dict) -> str:
    """Daily/Weekly-Zeilen haben 'date' oder 'time' als reines Datum;
    Intraday-Zeilen haben 'time' als ISO-Zeitstempel - erste 10 Zeichen reichen."""
    v = bar.get('date') or bar.get('time')
    return str(v)[:10]


def cumulative_factor_after(bar_date: str, splits: list[dict]) -> float:
    """Produkt der Verhaeltnisse aller Splits mit split_date > bar_date. Keine spaeteren Splits -> 1.0."""
    factor = 1.0
    for s in splits:
        if s['split_date'] > bar_date:
            factor *= s['ratio']
    return factor


def adjust_bar(bar: dict, factor: float, adjust_volume: bool = True) -> dict:
    """Nicht-mutierend. OHLC / factor. Volumen * factor NUR wenn adjust_volume=True.
    factor==1.0 -> unveraendert (schneller Pfad).

    adjust_volume muss je nach Datenquelle unterschiedlich sein - live gegen
    EODHD geprueft (nicht geraten): der /intraday-Endpunkt liefert RAWES
    Volumen (zusammen mit unadjustierten OHLC), waehrend der /eod-Endpunkt
    (daily UND weekly) ein Volumen liefert, das EODHD selbst bereits auf die
    aktuelle (nach allen Splits) Aktienzahl umgerechnet hat - erkennbar daran,
    dass adjusted_close * rohes Volumen ein plausibles Dollar-Volumen ergibt,
    raw close * rohes Volumen dagegen um denselben Faktor zu hoch waere.
    Multipliziert man dieses bereits umgerechnete Tages-/Wochenvolumen hier
    NOCHMAL mit dem Split-Faktor, entsteht eine Doppel-Anpassung (beobachtet:
    NVDA-Tage vor 2021 zeigten "13B+ Aktien" Volumen statt der realen ~20-40M).
    Deshalb: adjust_volume=False fuer daily/weekly, True fuer intraday."""
    if factor == 1.0:
        return bar
    out = dict(bar)
    for k in ('open', 'high', 'low', 'close'):
        if out.get(k) is not None:
            out[k] = out[k] / factor
    if adjust_volume and out.get('volume') is not None:
        out['volume'] = out['volume'] * factor
    return out


def adjust_bars(bars: list[dict], splits: list[dict], adjust_volume: bool = True) -> list[dict]:
    """Wendet cumulative_factor_after() gleichmaessig auf jede Zeile an. Reine
    Wertumrechnung - die Menge/Reihenfolge der Zeilen bleibt unveraendert, damit
    der Look-ahead-Schutz (welche Zeilen ueberhaupt zurueckgegeben werden)
    unberuehrt bleibt."""
    if not splits:
        return bars
    return [adjust_bar(b, cumulative_factor_after(_bar_date(b), splits), adjust_volume) for b in bars]
