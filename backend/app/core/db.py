import sqlite3
from pathlib import Path
from .config import settings

def conn():
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.database_path)
    c.row_factory = sqlite3.Row
    c.execute("pragma foreign_keys=on")
    return c

# Zusaetzliche Spalten fuer setups, die bei Bestands-DBs nachgezogen werden.
_SETUP_COLUMNS = {
    'entry_date': 'text',
    'entry_time': 'text',
    'entry_timezone': "text default 'ET'",
    'entry_price': 'real',
    'exit_date': 'text',
    'exit_time': 'text',
    'exit_price': 'real',
    'stop_price': 'real',
    'target_price': 'real',
    'pivot_level_price': 'real',
    'cutoff_timestamp': 'text',
    'was_playback_enforced': 'integer default 0',
    'data_status': 'text',
}

# Wasserstandsmarken fuer inkrementelles Nachladen (m5/daily/weekly), damit
# nicht bei jedem Chart-Laden der komplette Bereich neu abgefragt wird.
_AVAILABILITY_COLUMNS = {
    'cached_from': 'text',
    'cached_to': 'text',
}

def init_db():
    with conn() as c:
        c.executescript('''
        create table if not exists symbols(id integer primary key, ticker text not null, exchange text default 'US', eodhd_symbol text unique not null, name text, sector text, industry text, is_delisted integer default 0, listed_from text, listed_to text, updated_at text default current_timestamp);
        create table if not exists price_bars_daily(symbol_id integer, date text, open real, high real, low real, close real, adjusted_close real, volume real, source text, fetched_at text default current_timestamp, primary key(symbol_id,date));
        create table if not exists price_bars_intraday(symbol_id integer, timestamp_utc text, timestamp_et text, interval text, open real, high real, low real, close real, volume real, is_regular_session integer, derived_from_interval text, source text, fetched_at text default current_timestamp, primary key(symbol_id,timestamp_utc,interval));
        create table if not exists data_availability(symbol_id integer, interval text, first_available_at text, last_available_at text, checked_at text default current_timestamp, status text, message text, primary key(symbol_id,interval));
        create table if not exists price_bars_weekly(symbol_id integer, date text, open real, high real, low real, close real, adjusted_close real, volume real, source text, fetched_at text default current_timestamp, primary key(symbol_id,date));
        create table if not exists splits_history(symbol_id integer, split_date text, ratio real, raw_ratio_str text, source text, fetched_at text default current_timestamp, primary key(symbol_id,split_date));
        create table if not exists setups(id integer primary key, symbol_id integer, setup_name text, label_class text, structure text, trigger text, tactic text, level_name text, orderly_rating integer, result_r real, result_is_hypothetical integer default 0, mfe_r real, mae_r real, notes text, source text default 'ui', created_at text default current_timestamp, updated_at text default current_timestamp);
        create table if not exists setup_markers(id integer primary key, setup_id integer, marker_type text, timestamp text, price real, timeframe text, note text);
        create table if not exists import_batches(id integer primary key, filename text, uploaded_at text default current_timestamp, row_count integer, status text, mapping_json text, errors_json text);
        create table if not exists import_rows(batch_id integer, row_number integer, raw_json text, status text, error_message text);
        create table if not exists playback_sessions(id integer primary key, setup_id integer, symbol_id integer, entry_date text, cutoff_timestamp text, was_playback_enforced integer default 1, created_at text default current_timestamp);
        create table if not exists fundamental_snapshots(id integer primary key, symbol_id integer, as_of_date text, market_cap real, float_shares real, shares_outstanding real, source text, created_at text default current_timestamp);
        create table if not exists watchlist_items(id integer primary key, ticker text not null, category text not null default 'Watchlist', created_at text default current_timestamp);
        create unique index if not exists ux_watchlist_ticker_category on watchlist_items(ticker, category);
        ''')
        # Neue setups-Spalten fuer Bestands-DBs nachziehen.
        have = {r[1] for r in c.execute("pragma table_info(setups)")}
        for col, decl in _SETUP_COLUMNS.items():
            if col not in have:
                c.execute(f"alter table setups add column {col} {decl}")
        # Duplikat-Schutz: gleicher Ticker + gleiches Entry-Datum nur einmal.
        c.execute("create unique index if not exists ux_setups_symbol_date on setups(symbol_id, entry_date) where entry_date is not null")
        # Neue data_availability-Spalten fuer Bestands-DBs nachziehen.
        have_avail = {r[1] for r in c.execute("pragma table_info(data_availability)")}
        for col, decl in _AVAILABILITY_COLUMNS.items():
            if col not in have_avail:
                c.execute(f"alter table data_availability add column {col} {decl}")

def symbol_id(ticker: str, exchange: str='US') -> int:
    eod = ticker if '.' in ticker else f"{ticker}.{exchange}"
    with conn() as c:
        c.execute("insert or ignore into symbols(ticker, exchange, eodhd_symbol) values(?,?,?)", (ticker.split('.')[0].upper(), exchange, eod.upper()))
        return c.execute("select id from symbols where eodhd_symbol=?", (eod.upper(),)).fetchone()[0]
