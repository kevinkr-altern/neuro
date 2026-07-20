import sqlite3
from pathlib import Path
from .config import settings

def conn():
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.database_path)
    c.row_factory = sqlite3.Row
    return c

def _ensure_column(c, table: str, column: str, ddl: str):
    cols = [r[1] for r in c.execute(f"pragma table_info({table})")]
    if column not in cols:
        c.execute(f"alter table {table} add column {column} {ddl}")

def init_db():
    with conn() as c:
        c.executescript('''
        create table if not exists symbols(id integer primary key, ticker text not null, exchange text default 'US', eodhd_symbol text unique not null, name text, sector text, industry text, is_delisted integer default 0, listed_from text, listed_to text, updated_at text default current_timestamp);
        create table if not exists symbol_fundamentals_snapshots(id integer primary key, symbol_id integer, as_of_date text, market_cap real, float_shares real, shares_outstanding real, sector text, industry text, source text, fetched_at text default current_timestamp, unique(symbol_id, as_of_date));
        create table if not exists price_bars_daily(symbol_id integer, date text, open real, high real, low real, close real, adjusted_close real, volume real, source text, fetched_at text default current_timestamp, primary key(symbol_id,date));
        create table if not exists price_bars_intraday(symbol_id integer, timestamp_utc text, timestamp_et text, interval text, open real, high real, low real, close real, volume real, is_regular_session integer, is_half_day integer default 0, derived_from_interval text, source text, fetched_at text default current_timestamp, primary key(symbol_id,timestamp_utc,interval));
        create table if not exists data_availability(symbol_id integer, interval text, first_available_at text, last_available_at text, checked_at text default current_timestamp, status text, message text, primary key(symbol_id,interval));
        create table if not exists playback_sessions(id integer primary key, setup_id integer, symbol_id integer, cutoff_timestamp text, was_enforced integer not null default 1, created_at text default current_timestamp, completed_at text);
        create table if not exists setups(id integer primary key, symbol_id integer, setup_name text, label_class text, structure text, trigger text, tactic text, level_name text, orderly_rating integer, result_r real, result_is_hypothetical integer default 0, mfe_r real, mae_r real, notes text, source text default 'ui', was_playback_enforced integer default 1, cutoff_timestamp text, data_status text, created_at text default current_timestamp, updated_at text default current_timestamp);
        create table if not exists setup_markers(id integer primary key, setup_id integer, marker_type text, timestamp text, price real, timeframe text, note text);
        create table if not exists import_batches(id integer primary key, filename text, uploaded_at text default current_timestamp, row_count integer, jan_sep_2020_count integer default 0, estimated_api_calls integer default 0, status text, mapping_json text, errors_json text);
        create table if not exists import_rows(batch_id integer, row_number integer, raw_json text, mapped_json text, status text, error_message text);
        create table if not exists api_call_log(id integer primary key, provider text, endpoint text, symbol text, interval text, cache_hit integer default 0, created_at text default current_timestamp);
        ''')
        for col, ddl in [('was_playback_enforced','integer default 1'),('cutoff_timestamp','text'),('data_status','text')]:
            _ensure_column(c, 'setups', col, ddl)
        for col, ddl in [('jan_sep_2020_count','integer default 0'),('estimated_api_calls','integer default 0')]:
            _ensure_column(c, 'import_batches', col, ddl)
        _ensure_column(c, 'import_rows', 'mapped_json', 'text')
        _ensure_column(c, 'price_bars_intraday', 'is_half_day', 'integer default 0')

def symbol_id(ticker: str, exchange: str='US') -> int:
    eod = ticker if '.' in ticker else f"{ticker}.{exchange}"
    with conn() as c:
        c.execute("insert or ignore into symbols(ticker, exchange, eodhd_symbol) values(?,?,?)", (ticker.split('.')[0].upper(), exchange, eod.upper()))
        return c.execute("select id from symbols where eodhd_symbol=?", (eod.upper(),)).fetchone()[0]
