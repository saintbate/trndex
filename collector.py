"""
Trndex Data Collector
Fetches trending topics from X API and stores snapshots in Neon Postgres.
Computes momentum (delta) by comparing consecutive snapshots.

Usage:
    # Single fetch (test it works)
    python collector.py --once

    # Run on loop every 2 hours
    python collector.py --loop

    # View latest trends with momentum
    python collector.py --view

Setup:
    1. Get your Bearer Token from https://developer.x.com
    2. Set env vars (or use .env.local):
       export X_BEARER_TOKEN="your_token_here"
       export DATABASE_URL="postgresql://...@....neon.tech/neondb?sslmode=require"
    3. pip install -r requirements.txt
"""

import os
import sys
import json
import time
import re
import statistics
import argparse
from datetime import datetime, timezone, timedelta

# Load .env.local so DATABASE_URL and X_BEARER_TOKEN are available
try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    print("Install psycopg2-binary: pip install psycopg2-binary")
    sys.exit(1)


# ── Config ────────────────────────────────────────────────────────────────────

BEARER_TOKEN = os.environ.get("X_BEARER_TOKEN", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
XAI_API_KEY = os.environ.get("XAI_API_KEY", "")

# WOEIDs to track
LOCATIONS = {
    1:        "Worldwide",
    23424977: "United States",
    2459115:  "New York",
    2442047:  "Los Angeles",
    2514815:  "Chicago",
    2357024:  "Atlanta",
}

API_URL = "https://api.x.com/2/trends/by/woeid/{woeid}"
POLL_INTERVAL_SECONDS = 2 * 60 * 60  # 2 hours
METHODOLOGY_VERSION = "rank-v1"
FEATURE_REBUILD_LOOKBACK = 12
try:
    DEFAULT_GROK_AGENTIC_VOLUME_LIMIT = max(1, int(os.environ.get("GROK_AGENTIC_VOLUME_LIMIT", "12")))
except ValueError:
    DEFAULT_GROK_AGENTIC_VOLUME_LIMIT = 12


CATEGORY_RULES = [
    {
        "category": "Politics",
        "hashtags": ["#election2026"],
        "phrases": [
            "supreme court", "white house", "executive order", "bipartisan",
            "congress", "senate", "scotus", "president", "democrat",
            "republican", "gop", "election", "impeach", "filibuster",
        ],
    },
    {
        "category": "Tech",
        "hashtags": ["#ai"],
        "phrases": [
            "chatgpt", "openai", "google", "apple", "nvidia", "tesla",
            "microsoft", "github", "android", "iphone", "ios", "samsung",
            "amd", "intel", "copilot", "gemini", "claude", "gpt",
            "anthropic", "meta",
        ],
    },
    {
        "category": "Crypto",
        "hashtags": ["#crypto"],
        "phrases": [
            "bitcoin", "btc", "ethereum", "eth", "solana", "sol",
            "dogecoin", "doge", "xrp", "blockchain", "defi", "nft",
            "binance", "coinbase", "cardano", "polygon",
        ],
        "custom": lambda text, hashtags: (
            has_word(text, "whale")
            and (has_word(text, "buy") or has_word(text, "sell") or has_word(text, "alert"))
        ),
    },
    {
        "category": "Sports",
        "phrases": [
            "premier league", "champions league", "march madness",
            "world cup", "super bowl", "grand prix", "olympics",
            "lakers", "warriors", "celtics", "yankees", "dodgers",
            "cowboys", "chiefs", "eagles", "lebron james",
            "stephen curry", "lionel messi", "cristiano ronaldo",
            "shohei ohtani", "caitlin clark",
        ],
        "any_words": ["nba", "nfl", "nhl", "mlb", "ufc", "fifa", "mls", "f1"],
    },
    {
        "category": "Finance",
        "phrases": [
            "fed rate", "s&p 500", "dow jones", "nasdaq", "wall street",
            "interest rate", "ipo", "earnings", "gdp", "core pce",
            "cpi", "treasury", "recession", "inflation",
        ],
    },
    {
        "category": "News",
        "hashtags": ["#breaking"],
        "phrases": ["breaking", "rip", "shooting", "evacuation", "wildfire", "hurricane"],
        "custom": lambda text, hashtags: (
            has_word(text, "earthquake")
            and not has_any_word(text, ["seismic", "geology", "tectonic"])
        ),
    },
    {
        "category": "Entertainment",
        "phrases": [
            "netflix", "disney+", "hulu", "hbo", "spotify", "grammy",
            "oscar", "emmy", "tony", "billboard", "box office",
            "streaming", "album", "trailer",
        ],
    },
    {
        "category": "Culture",
        "hashtags": [
            "#fridayvibes", "#fursuitfriday", "#motivationmonday",
            "#mondaymotivation", "#throwbackthursday", "#tuesdaythoughts",
            "#wednesdaywisdom", "#thursdaythoughts", "#fridayfeeling",
            "#sundayfunday", "#selfcaresunday",
        ],
        "phrases": ["beyonce", "taylor swift", "drake", "kendrick", "rihanna"],
    },
    {
        "category": "Science",
        "phrases": ["nasa", "spacex", "climate", "cern", "telescope", "mars", "asteroid"],
        "custom": lambda text, hashtags: (
            has_word(text, "earthquake")
            and has_any_word(text, ["seismic", "geology", "tectonic"])
        ),
    },
    {
        "category": "Games",
        "phrases": [
            "wordle", "fortnite", "minecraft", "gta", "playstation",
            "xbox", "nintendo", "steam", "elden ring", "zelda",
        ],
    },
    {
        "category": "Health",
        "hashtags": ["#mentalhealth"],
        "phrases": ["who", "cdc", "vaccine", "pandemic", "flu"],
        "custom": lambda text, hashtags: (
            has_word(text, "virus")
            and has_any_word(text, ["flu", "outbreak", "pandemic", "vaccine"])
        ),
    },
]


def has_phrase(text: str, phrase: str) -> bool:
    return re.search(rf"(^|[^a-z0-9]){re.escape(phrase)}([^a-z0-9]|$)", text, re.IGNORECASE) is not None


def has_word(text: str, word: str) -> bool:
    return has_phrase(text, word)


def has_any_word(text: str, words: list[str]) -> bool:
    return any(has_word(text, word) for word in words)


def extract_hashtags(text: str) -> set[str]:
    return {tag.lower() for tag in re.findall(r"#[a-z0-9_]+", text, re.IGNORECASE)}


def classify_keyword(name: str) -> str | None:
    """Classify only high-confidence matches. Returns None when ambiguous."""
    lower = name.lower()
    hashtags = extract_hashtags(name)

    for rule in CATEGORY_RULES:
        if any(tag in hashtags for tag in rule.get("hashtags", [])):
            return rule["category"]
        if any(has_phrase(lower, phrase) for phrase in rule.get("phrases", [])):
            return rule["category"]
        if any(has_word(lower, word) for word in rule.get("any_words", [])):
            return rule["category"]
        custom = rule.get("custom")
        if custom and custom(lower, hashtags):
            return rule["category"]

    return None


def classify_with_grok(trend_names: list) -> dict:
    """Batch-classify trend names using xAI Grok. Returns {name: category}."""
    if not XAI_API_KEY or not trend_names:
        return {}

    categories_list = "Tech, Politics, Sports, Crypto, Culture, Finance, News, Entertainment, Science, Games, Health"
    names_text = "\n".join(f"- {n}" for n in trend_names)

    try:
        resp = requests.post(
            "https://api.x.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-3-mini-fast",
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            f"Classify each trend into exactly one category: {categories_list}, or Trending if none fit. "
                            "Return ONLY valid JSON: {\"trend_name\": \"Category\", ...}. No markdown, no explanation."
                        ),
                    },
                    {"role": "user", "content": f"Classify these X/Twitter trending topics:\n{names_text}"},
                ],
                "temperature": 0,
            },
            timeout=90,
        )
        if resp.status_code != 200:
            print(f"  [!] Grok API error: HTTP {resp.status_code}")
            return {}

        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(content)
    except Exception as e:
        print(f"  [!] Grok classification failed: {e}")
        return {}


def classify_trends(trend_names: list) -> dict:
    """Classify a batch of trend names using high-confidence keyword rules only."""
    results = {}
    for name in trend_names:
        results[name] = classify_keyword(name)
    return results


def get_conn():
    """Get a Postgres connection."""
    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL environment variable.")
        print("  Or add it to .env.local")
        sys.exit(1)
    return psycopg2.connect(DATABASE_URL)


# ── Database ──────────────────────────────────────────────────────────────────

def init_db():
    """Create tables and indexes if they don't exist."""
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                id SERIAL PRIMARY KEY,
                fetched_at TIMESTAMPTZ NOT NULL,
                woeid INTEGER NOT NULL,
                location_name TEXT NOT NULL,
                trend_name TEXT NOT NULL,
                tweet_count INTEGER DEFAULT 0,
                rank INTEGER DEFAULT 0
            )
        """)
        cur.execute("ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS category TEXT")
        cur.execute("ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS run_id TEXT")
        cur.execute("ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS meta_description TEXT")
        cur.execute("ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS volume_source TEXT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_runs (
                run_id TEXT PRIMARY KEY,
                fetched_at TIMESTAMPTZ NOT NULL,
                woeid INTEGER NOT NULL,
                location_name TEXT NOT NULL,
                source_status TEXT NOT NULL,
                source_payload JSONB,
                methodology_version TEXT NOT NULL,
                item_count INTEGER NOT NULL DEFAULT 0,
                feature_status TEXT NOT NULL DEFAULT 'pending',
                feature_generated_at TIMESTAMPTZ,
                feature_error TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trend_entities (
                entity_id SERIAL PRIMARY KEY,
                canonical_name TEXT NOT NULL UNIQUE,
                canonical_name_normalized TEXT NOT NULL UNIQUE,
                first_seen_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trend_aliases (
                alias_name TEXT PRIMARY KEY,
                alias_normalized TEXT NOT NULL UNIQUE,
                entity_id INTEGER NOT NULL REFERENCES trend_entities(entity_id),
                first_seen_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL,
                alias_kind TEXT NOT NULL DEFAULT 'observed'
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_items (
                id SERIAL PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES snapshot_runs(run_id) ON DELETE CASCADE,
                entity_id INTEGER NOT NULL REFERENCES trend_entities(entity_id),
                fetched_at TIMESTAMPTZ NOT NULL,
                woeid INTEGER NOT NULL,
                location_name TEXT NOT NULL,
                trend_name_raw TEXT NOT NULL,
                trend_name_normalized TEXT NOT NULL,
                rank INTEGER NOT NULL,
                tweet_count INTEGER DEFAULT 0,
                meta_description TEXT,
                volume_source TEXT,
                category TEXT,
                context_cache_key TEXT,
                methodology_version TEXT NOT NULL,
                UNIQUE (run_id, rank),
                UNIQUE (run_id, trend_name_raw)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trend_features (
                id SERIAL PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES snapshot_runs(run_id) ON DELETE CASCADE,
                entity_id INTEGER NOT NULL REFERENCES trend_entities(entity_id),
                fetched_at TIMESTAMPTZ NOT NULL,
                woeid INTEGER NOT NULL,
                trend_name_raw TEXT NOT NULL,
                canonical_name TEXT NOT NULL,
                category TEXT,
                rank INTEGER NOT NULL,
                prev_rank INTEGER,
                rank_delta INTEGER NOT NULL DEFAULT 0,
                rank_velocity REAL NOT NULL DEFAULT 0,
                rank_acceleration REAL NOT NULL DEFAULT 0,
                board_age_snapshots INTEGER NOT NULL DEFAULT 1,
                persistence_score REAL NOT NULL DEFAULT 0,
                breakout_score REAL NOT NULL DEFAULT 0,
                volatility_score REAL NOT NULL DEFAULT 0,
                entry_flag BOOLEAN NOT NULL DEFAULT FALSE,
                exit_flag BOOLEAN NOT NULL DEFAULT FALSE,
                reentry_count INTEGER NOT NULL DEFAULT 0,
                tweet_count INTEGER DEFAULT 0,
                prev_tweet_count INTEGER,
                volume_delta_pct REAL,
                volume_source TEXT,
                methodology_version TEXT NOT NULL,
                UNIQUE (run_id, entity_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_features (
                run_id TEXT PRIMARY KEY REFERENCES snapshot_runs(run_id) ON DELETE CASCADE,
                fetched_at TIMESTAMPTZ NOT NULL,
                woeid INTEGER NOT NULL,
                location_name TEXT NOT NULL,
                board_size INTEGER NOT NULL,
                new_entry_count INTEGER NOT NULL DEFAULT 0,
                exit_count INTEGER NOT NULL DEFAULT 0,
                turnover_ratio REAL NOT NULL DEFAULT 0,
                avg_rank_displacement REAL NOT NULL DEFAULT 0,
                category_breadth INTEGER NOT NULL DEFAULT 0,
                top_category_share REAL NOT NULL DEFAULT 0,
                market_regime_label TEXT NOT NULL,
                current_volume BIGINT NOT NULL DEFAULT 0,
                avg_volume BIGINT NOT NULL DEFAULT 0,
                volume_deviation_pct REAL NOT NULL DEFAULT 0,
                methodology_version TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS market_price_bars (
                symbol TEXT NOT NULL,
                bucket_start TIMESTAMPTZ NOT NULL,
                open NUMERIC(18,6),
                high NUMERIC(18,6),
                low NUMERIC(18,6),
                close NUMERIC(18,6),
                volume NUMERIC(20,4),
                source TEXT NOT NULL,
                PRIMARY KEY (symbol, bucket_start, source)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS prediction_market_bars (
                contract_id TEXT NOT NULL,
                bucket_start TIMESTAMPTZ NOT NULL,
                venue TEXT NOT NULL,
                question TEXT,
                price_yes NUMERIC(10,6),
                price_no NUMERIC(10,6),
                volume NUMERIC(18,4),
                open_interest NUMERIC(18,4),
                PRIMARY KEY (contract_id, bucket_start, venue)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_market_price_bars_time
            ON market_price_bars(bucket_start DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_market_price_bars_symbol
            ON market_price_bars(symbol, bucket_start DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_prediction_market_bars_time
            ON prediction_market_bars(bucket_start DESC)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS google_trends_bars (
                keyword TEXT NOT NULL,
                bucket_date DATE NOT NULL,
                geo TEXT NOT NULL DEFAULT '',
                interest_value INTEGER NOT NULL,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (keyword, bucket_date, geo)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_google_trends_bars_keyword_date
            ON google_trends_bars(keyword, bucket_date DESC)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trend_lifecycle_summary (
                entity_id INTEGER NOT NULL REFERENCES trend_entities(entity_id),
                woeid INTEGER NOT NULL,
                canonical_name TEXT NOT NULL,
                first_seen_at TIMESTAMPTZ NOT NULL,
                last_seen_at TIMESTAMPTZ NOT NULL,
                latest_run_id TEXT REFERENCES snapshot_runs(run_id),
                appearances INTEGER NOT NULL DEFAULT 0,
                reentry_count INTEGER NOT NULL DEFAULT 0,
                current_streak INTEGER NOT NULL DEFAULT 0,
                longest_streak INTEGER NOT NULL DEFAULT 0,
                best_rank INTEGER,
                latest_rank INTEGER,
                avg_rank REAL,
                median_rank REAL,
                max_breakout_score REAL NOT NULL DEFAULT 0,
                persistence_score REAL NOT NULL DEFAULT 0,
                methodology_version TEXT NOT NULL,
                PRIMARY KEY (entity_id, woeid)
            )
        """)
        cur.execute("ALTER TABLE trend_features ADD COLUMN IF NOT EXISTS spread_score REAL NOT NULL DEFAULT 0")
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshots_trend
            ON snapshots(trend_name, woeid, fetched_at)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshots_time
            ON snapshots(fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshots_woeid_time
            ON snapshots(woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_runs_woeid_time
            ON snapshot_runs(woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_items_woeid_time
            ON snapshot_items(woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshot_items_entity_time
            ON snapshot_items(entity_id, woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_trend_features_woeid_time
            ON trend_features(woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_trend_features_entity_time
            ON trend_features(entity_id, woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_market_features_woeid_time
            ON market_features(woeid, fetched_at DESC)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_trend_rollup (
                bucket_date DATE NOT NULL,
                woeid INTEGER NOT NULL,
                entity_id INTEGER NOT NULL REFERENCES trend_entities(entity_id),
                trend_name_raw TEXT NOT NULL,
                canonical_name TEXT NOT NULL,
                category TEXT,
                appearances INTEGER NOT NULL DEFAULT 0,
                avg_rank REAL NOT NULL DEFAULT 0,
                best_rank INTEGER NOT NULL,
                PRIMARY KEY (bucket_date, woeid, entity_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_category_rollup (
                bucket_date DATE NOT NULL,
                woeid INTEGER NOT NULL,
                category TEXT NOT NULL,
                trend_count INTEGER NOT NULL DEFAULT 0,
                share_pct REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (bucket_date, woeid, category)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_board_summary (
                bucket_date DATE NOT NULL,
                woeid INTEGER NOT NULL,
                location_name TEXT NOT NULL,
                snapshot_count INTEGER NOT NULL DEFAULT 0,
                distinct_trends INTEGER NOT NULL DEFAULT 0,
                new_entries INTEGER NOT NULL DEFAULT 0,
                exits INTEGER NOT NULL DEFAULT 0,
                avg_turnover REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (bucket_date, woeid)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_daily_trend_rollup_date
            ON daily_trend_rollup(bucket_date DESC, woeid)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_daily_category_rollup_date
            ON daily_category_rollup(bucket_date DESC, woeid)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_daily_board_summary_date
            ON daily_board_summary(bucket_date DESC, woeid)
        """)
        conn.commit()
    finally:
        cur.close()
        conn.close()


def normalize_trend_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lstrip("#")).lower()


def build_run_id(woeid: int, fetched_at: datetime) -> str:
    return f"{woeid}-{fetched_at.strftime('%Y%m%d%H%M%S%f')}"


def ensure_trend_entity(cur, trend_name: str, observed_at: datetime) -> tuple[int, str, str]:
    canonical_name = re.sub(r"\s+", " ", (trend_name or "").strip().lstrip("#")) or "Unknown"
    canonical_normalized = normalize_trend_name(canonical_name)

    cur.execute(
        """
        INSERT INTO trend_entities (canonical_name, canonical_name_normalized, first_seen_at, last_seen_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (canonical_name_normalized)
        DO UPDATE SET
            last_seen_at = GREATEST(trend_entities.last_seen_at, EXCLUDED.last_seen_at)
        RETURNING entity_id, canonical_name
        """,
        (canonical_name, canonical_normalized, observed_at, observed_at),
    )
    row = cur.fetchone()
    entity_id = row["entity_id"]
    stored_canonical = row["canonical_name"]

    cur.execute(
        """
        INSERT INTO trend_aliases (alias_name, alias_normalized, entity_id, first_seen_at, last_seen_at, alias_kind)
        VALUES (%s, %s, %s, %s, %s, 'observed')
        ON CONFLICT (alias_normalized)
        DO UPDATE SET
            alias_name = EXCLUDED.alias_name,
            entity_id = EXCLUDED.entity_id,
            last_seen_at = GREATEST(trend_aliases.last_seen_at, EXCLUDED.last_seen_at)
        """,
        (trend_name, normalize_trend_name(trend_name), entity_id, observed_at, observed_at),
    )

    return entity_id, stored_canonical, canonical_normalized


def _get_regime_label(turnover_ratio: float, avg_rank_displacement: float) -> str:
    churn_score = turnover_ratio * 60 + (min(avg_rank_displacement, 10) / 10) * 40
    if churn_score >= 80:
        return "CHAOTIC"
    if churn_score >= 60:
        return "VOLATILE"
    if churn_score >= 40:
        return "ACTIVE"
    if churn_score >= 20:
        return "CALM"
    return "STABLE"


def _calculate_rank_volatility(ranks: list[int]) -> float:
    if len(ranks) < 2:
        return 0.0
    mean = sum(ranks) / len(ranks)
    variance = sum((rank - mean) ** 2 for rank in ranks) / len(ranks)
    return round(variance ** 0.5, 2)


def rebuild_location_intelligence(conn, woeid: int):
    """Recompute derived feature tables for one location from raw snapshot_items."""
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT run_id, fetched_at, woeid, location_name
            FROM snapshot_runs
            WHERE woeid = %s
              AND source_status IN ('success', 'backfilled')
              AND item_count > 0
            ORDER BY fetched_at ASC
            """,
            (woeid,),
        )
        runs = cur.fetchall()
        if not runs:
            return

        cur.execute("DELETE FROM trend_features WHERE woeid = %s", (woeid,))
        cur.execute("DELETE FROM market_features WHERE woeid = %s", (woeid,))
        cur.execute("DELETE FROM trend_lifecycle_summary WHERE woeid = %s", (woeid,))

        cur.execute(
            """
            SELECT si.run_id, si.fetched_at, si.woeid, si.location_name, si.entity_id,
                   si.trend_name_raw, si.rank, si.tweet_count, si.volume_source, si.category,
                   te.canonical_name
            FROM snapshot_items si
            JOIN trend_entities te ON te.entity_id = si.entity_id
            WHERE si.woeid = %s
            ORDER BY si.fetched_at ASC, si.rank ASC
            """,
            (woeid,),
        )
        item_rows = cur.fetchall()

        items_by_run = {}
        for row in item_rows:
            items_by_run.setdefault(row["run_id"], []).append(row)

        total_locations = len(LOCATIONS)
        appearance_count = {}
        current_streak = {}
        longest_streak = {}
        reentry_count = {}
        last_delta = {}
        rank_history = {}
        breakout_peak = {}
        seen_before = set()

        for index, run in enumerate(runs):
            current_items = items_by_run.get(run["run_id"], [])
            current_map = {item["entity_id"]: item for item in current_items}
            previous_items = items_by_run.get(runs[index - 1]["run_id"], []) if index > 0 else []
            prev_map = {item["entity_id"]: item for item in previous_items}
            next_items = items_by_run.get(runs[index + 1]["run_id"], []) if index + 1 < len(runs) else []
            next_ids = {item["entity_id"] for item in next_items}
            exited_ids = set(prev_map) - set(current_map)
            persisting_deltas = []
            category_counts = {}
            current_volume = 0

            spread_map = {}
            if total_locations > 1:
                cur.execute(
                    """
                    SELECT entity_id, COUNT(DISTINCT woeid) AS loc_count
                    FROM snapshot_items
                    WHERE fetched_at BETWEEN %s - INTERVAL '30 minutes' AND %s + INTERVAL '30 minutes'
                    GROUP BY entity_id
                    """,
                    (run["fetched_at"], run["fetched_at"]),
                )
                for row in cur.fetchall():
                    spread_map[row["entity_id"]] = row["loc_count"]

            for item in current_items:
                entity_id = item["entity_id"]
                prev_item = prev_map.get(entity_id)
                prev_rank = prev_item["rank"] if prev_item else None
                prev_tweet_count = prev_item["tweet_count"] if prev_item else None
                rank_delta = (prev_rank - item["rank"]) if prev_rank is not None else 0
                rank_velocity = float(rank_delta)
                rank_acceleration = rank_velocity - last_delta.get(entity_id, 0.0)
                entry_flag = prev_item is None
                if entry_flag and entity_id in seen_before:
                    reentry_count[entity_id] = reentry_count.get(entity_id, 0) + 1
                appearance_count[entity_id] = appearance_count.get(entity_id, 0) + 1
                current_streak[entity_id] = (current_streak.get(entity_id, 0) + 1) if not entry_flag else 1
                longest_streak[entity_id] = max(longest_streak.get(entity_id, 0), current_streak[entity_id])
                persistence_score = round(min(100.0, current_streak[entity_id] * 12 + appearance_count[entity_id] * 2), 2)
                breakout_score = round(min(100.0, max(rank_delta, 0) * 8 + (21 - item["rank"]) * 2 + (15 if entry_flag else 0)), 2)
                rank_history.setdefault(entity_id, []).append(item["rank"])
                trailing_ranks = rank_history[entity_id][-FEATURE_REBUILD_LOOKBACK:]
                volatility_score = _calculate_rank_volatility(trailing_ranks)
                exit_flag = entity_id not in next_ids
                volume_delta_pct = None
                if prev_tweet_count and item["tweet_count"]:
                    volume_delta_pct = round(((item["tweet_count"] - prev_tweet_count) / prev_tweet_count) * 100, 2)
                spread_score = round(spread_map.get(entity_id, 1) / max(total_locations, 1), 4)

                breakout_peak[entity_id] = max(breakout_peak.get(entity_id, 0.0), breakout_score)
                seen_before.add(entity_id)
                last_delta[entity_id] = rank_velocity
                current_volume += item["tweet_count"] or 0
                if prev_rank is not None:
                    persisting_deltas.append(abs(rank_delta))
                if item["category"]:
                    category_counts[item["category"]] = category_counts.get(item["category"], 0) + 1

                cur.execute(
                    """
                    INSERT INTO trend_features (
                        run_id, entity_id, fetched_at, woeid, trend_name_raw, canonical_name, category,
                        rank, prev_rank, rank_delta, rank_velocity, rank_acceleration,
                        board_age_snapshots, persistence_score, breakout_score, volatility_score,
                        spread_score, entry_flag, exit_flag, reentry_count, tweet_count, prev_tweet_count,
                        volume_delta_pct, volume_source, methodology_version
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run["run_id"],
                        entity_id,
                        run["fetched_at"],
                        woeid,
                        item["trend_name_raw"],
                        item["canonical_name"],
                        item["category"],
                        item["rank"],
                        prev_rank,
                        rank_delta,
                        rank_velocity,
                        rank_acceleration,
                        current_streak[entity_id],
                        persistence_score,
                        breakout_score,
                        volatility_score,
                        spread_score,
                        entry_flag,
                        exit_flag,
                        reentry_count.get(entity_id, 0),
                        item["tweet_count"] or 0,
                        prev_tweet_count,
                        volume_delta_pct,
                        item["volume_source"],
                        METHODOLOGY_VERSION,
                    ),
                )

            trailing_runs = runs[max(0, index - FEATURE_REBUILD_LOOKBACK):index]
            previous_volumes = []
            for trailing_run in trailing_runs:
                trailing_items = items_by_run.get(trailing_run["run_id"], [])
                previous_volumes.append(sum((item["tweet_count"] or 0) for item in trailing_items))
            avg_volume = round(sum(previous_volumes) / len(previous_volumes)) if previous_volumes else current_volume
            volume_deviation_pct = round((((current_volume - avg_volume) / avg_volume) * 100), 2) if avg_volume else 0.0
            avg_rank_displacement = round(sum(persisting_deltas) / len(persisting_deltas), 2) if persisting_deltas else 0.0
            top_category_share = round((max(category_counts.values()) / len(current_items)), 4) if category_counts and current_items else 0.0
            turnover_ratio = round((len(exited_ids) + sum(1 for item in current_items if item["entity_id"] not in prev_map)) / max(len(current_items), 1), 4)

            cur.execute(
                """
                INSERT INTO market_features (
                    run_id, fetched_at, woeid, location_name, board_size, new_entry_count, exit_count,
                    turnover_ratio, avg_rank_displacement, category_breadth, top_category_share,
                    market_regime_label, current_volume, avg_volume, volume_deviation_pct,
                    methodology_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run["run_id"],
                    run["fetched_at"],
                    woeid,
                    run["location_name"],
                    len(current_items),
                    sum(1 for item in current_items if item["entity_id"] not in prev_map),
                    len(exited_ids),
                    turnover_ratio,
                    avg_rank_displacement,
                    len(category_counts),
                    top_category_share,
                    _get_regime_label(turnover_ratio, avg_rank_displacement),
                    current_volume,
                    avg_volume,
                    volume_deviation_pct,
                    METHODOLOGY_VERSION,
                ),
            )

        for entity_id, ranks in rank_history.items():
            feature_rows = []
            cur.execute(
                """
                SELECT tf.run_id, tf.fetched_at, tf.canonical_name, tf.rank, tf.breakout_score, tf.persistence_score
                FROM trend_features tf
                WHERE tf.woeid = %s AND tf.entity_id = %s
                ORDER BY tf.fetched_at ASC
                """,
                (woeid, entity_id),
            )
            feature_rows = cur.fetchall()
            if not feature_rows:
                continue
            cur.execute(
                """
                INSERT INTO trend_lifecycle_summary (
                    entity_id, woeid, canonical_name, first_seen_at, last_seen_at, latest_run_id,
                    appearances, reentry_count, current_streak, longest_streak, best_rank, latest_rank,
                    avg_rank, median_rank, max_breakout_score, persistence_score, methodology_version
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    entity_id,
                    woeid,
                    feature_rows[-1]["canonical_name"],
                    feature_rows[0]["fetched_at"],
                    feature_rows[-1]["fetched_at"],
                    feature_rows[-1]["run_id"],
                    len(feature_rows),
                    reentry_count.get(entity_id, 0),
                    current_streak.get(entity_id, 0),
                    longest_streak.get(entity_id, current_streak.get(entity_id, 0)),
                    min(ranks),
                    feature_rows[-1]["rank"],
                    round(sum(ranks) / len(ranks), 2),
                    float(statistics.median(ranks)),
                    breakout_peak.get(entity_id, 0.0),
                    feature_rows[-1]["persistence_score"],
                    METHODOLOGY_VERSION,
                ),
            )

        cur.execute(
            """
            UPDATE snapshot_runs
            SET feature_status = 'ready',
                feature_generated_at = NOW(),
                feature_error = NULL
            WHERE woeid = %s
              AND source_status IN ('success', 'backfilled')
            """,
            (woeid,),
        )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        cur.execute(
            """
            UPDATE snapshot_runs
            SET feature_status = 'error',
                feature_generated_at = NOW(),
                feature_error = %s
            WHERE woeid = %s
            """,
            (str(exc)[:500], woeid),
        )
        conn.commit()
        raise
    finally:
        cur.close()


def backfill_intelligence():
    """Migrate legacy snapshots into raw intelligence tables and recompute features."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    migrated_locations = set()
    migrated_groups = 0
    try:
        cur.execute(
            """
            SELECT fetched_at, woeid, location_name
            FROM snapshots
            GROUP BY fetched_at, woeid, location_name
            ORDER BY fetched_at ASC, woeid ASC
            """
        )
        groups = cur.fetchall()
        for group in groups:
            run_id = build_run_id(group["woeid"], _to_datetime(group["fetched_at"]))
            cur.execute("SELECT 1 FROM snapshot_runs WHERE run_id = %s", (run_id,))
            if cur.fetchone():
                migrated_locations.add(group["woeid"])
                continue

            cur.execute(
                """
                INSERT INTO snapshot_runs (
                    run_id, fetched_at, woeid, location_name, source_status, source_payload,
                    methodology_version, item_count, feature_status
                )
                VALUES (%s, %s, %s, %s, 'backfilled', NULL, %s, 0, 'pending')
                """,
                (run_id, group["fetched_at"], group["woeid"], group["location_name"], METHODOLOGY_VERSION),
            )

            cur.execute(
                """
                SELECT trend_name, rank, tweet_count, category, meta_description, volume_source
                FROM snapshots
                WHERE fetched_at = %s AND woeid = %s
                ORDER BY rank ASC
                """,
                (group["fetched_at"], group["woeid"]),
            )
            items = cur.fetchall()
            for item in items:
                entity_id, _, _ = ensure_trend_entity(cur, item["trend_name"], _to_datetime(group["fetched_at"]))
                cur.execute(
                    """
                    INSERT INTO snapshot_items (
                        run_id, entity_id, fetched_at, woeid, location_name, trend_name_raw,
                        trend_name_normalized, rank, tweet_count, meta_description, volume_source,
                        category, context_cache_key, methodology_version
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        run_id,
                        entity_id,
                        group["fetched_at"],
                        group["woeid"],
                        group["location_name"],
                        item["trend_name"],
                        normalize_trend_name(item["trend_name"]),
                        item["rank"],
                        item["tweet_count"] or 0,
                        item.get("meta_description"),
                        item.get("volume_source") or "legacy",
                        item.get("category") or classify_keyword(item["trend_name"]),
                        normalize_trend_name(item["trend_name"]),
                        METHODOLOGY_VERSION,
                    ),
                )

            cur.execute(
                "UPDATE snapshot_runs SET item_count = %s WHERE run_id = %s",
                (len(items), run_id),
            )
            migrated_locations.add(group["woeid"])
            migrated_groups += 1

        conn.commit()
        for woeid in migrated_locations:
            rebuild_location_intelligence(conn, woeid)
    finally:
        cur.close()
        conn.close()

    return migrated_groups


def store_snapshot(
    woeid: int,
    location_name: str,
    trends: list,
    source_status: str = "success",
    source_payload: dict | None = None,
    fetched_at: datetime | None = None,
):
    """Store raw snapshot data plus derived intelligence for one location."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    now = fetched_at or datetime.now(timezone.utc)
    run_id = build_run_id(woeid, now)
    trend_names = [t.get("trend_name", "Unknown") for t in trends]
    categories = classify_trends(trend_names)

    try:
        cur.execute(
            """
            INSERT INTO snapshot_runs (
                run_id, fetched_at, woeid, location_name, source_status, source_payload,
                methodology_version, item_count, feature_status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending')
            ON CONFLICT (run_id) DO UPDATE SET
                source_status = EXCLUDED.source_status,
                source_payload = EXCLUDED.source_payload,
                item_count = EXCLUDED.item_count
            """,
            (
                run_id,
                now,
                woeid,
                location_name,
                source_status,
                Json(source_payload) if source_payload is not None else None,
                METHODOLOGY_VERSION,
                len(trends),
            ),
        )

        if source_status in ("success", "backfilled") and trends:
            for i, trend in enumerate(trends):
                name = trend.get("trend_name", "Unknown")
                entity_id, _, _ = ensure_trend_entity(cur, name, now)
                category = categories.get(name)
                meta_description = trend.get("meta_description")
                volume_source = trend.get("volume_source") or ("api" if trend.get("tweet_count") else "unknown")
                cur.execute(
                    """
                    INSERT INTO snapshot_items (
                        run_id, entity_id, fetched_at, woeid, location_name, trend_name_raw,
                        trend_name_normalized, rank, tweet_count, meta_description, volume_source,
                        category, context_cache_key, methodology_version
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (run_id, rank) DO UPDATE SET
                        entity_id = EXCLUDED.entity_id,
                        trend_name_raw = EXCLUDED.trend_name_raw,
                        trend_name_normalized = EXCLUDED.trend_name_normalized,
                        tweet_count = EXCLUDED.tweet_count,
                        meta_description = EXCLUDED.meta_description,
                        volume_source = EXCLUDED.volume_source,
                        category = EXCLUDED.category
                    """,
                    (
                        run_id,
                        entity_id,
                        now,
                        woeid,
                        location_name,
                        name,
                        normalize_trend_name(name),
                        i + 1,
                        trend.get("tweet_count", 0) or 0,
                        meta_description,
                        volume_source,
                        category,
                        normalize_trend_name(name),
                        METHODOLOGY_VERSION,
                    ),
                )
                cur.execute(
                    """
                    INSERT INTO snapshots (
                        fetched_at, woeid, location_name, trend_name, tweet_count, rank,
                        category, run_id, meta_description, volume_source
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        now,
                        woeid,
                        location_name,
                        name,
                        trend.get("tweet_count", 0) or 0,
                        i + 1,
                        category,
                        run_id,
                        meta_description,
                        volume_source,
                    ),
                )

        conn.commit()
        if source_status in ("success", "backfilled") and trends:
            rebuild_location_intelligence(conn, woeid)
        return len(trends)
    finally:
        cur.close()
        conn.close()


# ── API ───────────────────────────────────────────────────────────────────────


def _extract_response_text(data: dict) -> str:
    """Extract the model's final text payload from a Responses API result."""
    text = ""

    if isinstance(data.get("text"), str):
        text = data["text"]
    elif isinstance(data.get("output_text"), str):
        text = data["output_text"]
    elif isinstance(data.get("output"), list):
        for item in reversed(data["output"]):
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "output_text":
                        t = c.get("text") or c.get("output_text", "")
                        if t:
                            text = t
                            break
                    elif isinstance(c, str):
                        text = c
                        break
                if text:
                    break
            elif isinstance(content, str):
                text = content
                break

    text = str(text).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return text


def _parse_json_object(text: str) -> dict:
    """Parse JSON, falling back to the first object-shaped substring."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _apply_volume_matches(trends: list, parsed: dict, label: str) -> int:
    """Apply parsed volumes onto matching trends. Returns number updated."""
    parsed_lower = {
        str(k).lower().strip().lstrip("#"): v
        for k, v in parsed.items()
        if isinstance(k, str)
    }

    def find_vol(trend_name: str):
        name_lower = trend_name.lower().strip()
        name_nohash = name_lower.lstrip("#")
        direct = parsed.get(trend_name)
        if isinstance(direct, (int, float)) and direct > 0:
            return int(direct)
        normalized = parsed_lower.get(name_lower)
        if isinstance(normalized, (int, float)) and normalized > 0:
            return int(normalized)
        normalized_nohash = parsed_lower.get(name_nohash)
        if isinstance(normalized_nohash, (int, float)) and normalized_nohash > 0:
            return int(normalized_nohash)
        for k, v in parsed.items():
            if not isinstance(k, str) or not isinstance(v, (int, float)) or v <= 0:
                continue
            key_lower = k.lower().strip().lstrip("#")
            if key_lower in name_nohash or name_nohash in key_lower:
                return int(v)
        return None

    updated = 0
    for trend in trends:
        if trend.get("tweet_count"):
            continue
        name = trend["trend_name"]
        vol = find_vol(name)
        if vol is not None and vol > 0:
            trend["tweet_count"] = vol
            trend["volume_source"] = "grok_agentic" if "Agentic" in label else "grok_fallback"
            print(f"  [{label}] {name}: {vol:,} posts")
            updated += 1

    return updated


def enrich_volume_with_grok_fast_fallback(trends: list, names: list, yesterday: str, today: str) -> int:
    """
    Use a cheaper non-agentic Grok call as a fallback when the agentic path
    returns no usable counts.
    """
    if not XAI_API_KEY or not names:
        return 0

    names_text = "\n".join(f"- {n}" for n in names)
    prompt = f"""Use X Search to find the approximate number of posts/tweets for each of these X/Twitter trending topics in the last 24 hours.
Return ONLY a valid JSON object with the exact trend names below as keys and integer counts as values.
If the search results expose a total count, use it. If not, make a conservative estimate from the result metadata.
Use 0 only if you cannot find any data.

Trends:
{names_text}"""

    try:
        resp = requests.post(
            "https://api.x.ai/v1/responses",
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-4-1-fast-non-reasoning",
                "input": [{"role": "user", "content": prompt}],
                "tools": [{"type": "x_search", "from_date": yesterday, "to_date": today}],
            },
            timeout=90,
        )

        if resp.status_code != 200:
            print(f"  [!] Grok fallback API error: HTTP {resp.status_code}")
            return 0

        print("  [Grok Fallback] Response received, parsing...")
        text = _extract_response_text(resp.json())
        if not text:
            print("  [Grok Fallback] No text extracted from response")
            return 0

        parsed = _parse_json_object(text)
        updated = _apply_volume_matches(trends, parsed, "Grok Fallback")
        if updated == 0:
            sample = [(k, v) for k, v in list(parsed.items())[:3] if isinstance(v, (int, float))]
            print(f"  [Grok Fallback] No usable volume found. Sample: {sample}")
        return updated
    except json.JSONDecodeError as e:
        print(f"  [!] Grok fallback: could not parse JSON: {e}")
        return 0
    except Exception as e:
        print(f"  [!] Grok fallback enrichment failed: {e}")
        return 0


def enrich_volume_with_grok_agentic(trends: list, limit: int = DEFAULT_GROK_AGENTIC_VOLUME_LIMIT) -> None:
    """
    Use agentic Grok (x_search) to get approximate post volume for trends with tweet_count=0.
    Model runs X Search per trend and extracts/estimates counts from results.
    Updates trend dicts in place. Only runs when XAI_API_KEY is set.
    """
    zero_vol = [t for t in trends if not t.get("tweet_count")]
    if not XAI_API_KEY or not zero_vol:
        return

    # Limit to control cost/latency; agentic runs multiple tool calls.
    names = [t["trend_name"] for t in zero_vol][:max(1, limit)]
    print(f"  [Grok Agentic] Enriching volume for {len(names)} US trends via X Search...")

    names_text = "\n".join(f"- {n}" for n in names)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    prompt = f"""For each of these X/Twitter trending topics, use X Search to find posts from the last 24 hours.
Run one search per trend. For each search:
- If the results show a total count (e.g. "50,000 posts", "Showing 1-10 of 12,345"), extract that number.
- If you only get a list of posts, estimate the approximate volume from the result set size or any metadata.
- Use the exact trend names below as keys.

Trends:
{names_text}

Return ONLY a valid JSON object: {{"trend_name": count, ...}} with integer counts.
Use 0 only if you cannot find any data for that trend. No explanation, no markdown."""

    try:
        resp = requests.post(
            "https://api.x.ai/v1/responses",
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "grok-4.20-beta-latest-non-reasoning",
                "input": [{"role": "user", "content": prompt}],
                "tools": [{"type": "x_search", "from_date": yesterday, "to_date": today}],
            },
            timeout=120,
        )

        if resp.status_code != 200:
            print(f"  [!] Grok agentic API error: HTTP {resp.status_code}")
            return

        print("  [Grok Agentic] Response received, parsing...")
        text = _extract_response_text(resp.json())
        if not text:
            print("  [Grok Agentic] No text extracted from response")
            enrich_volume_with_grok_fast_fallback(trends, names, yesterday, today)
            return

        parsed = _parse_json_object(text)
        updated = _apply_volume_matches(trends, parsed, "Grok Agentic")

        if updated == 0:
            sample = [(k, v) for k, v in list(parsed.items())[:3] if isinstance(v, (int, float))]
            print(f"  [Grok Agentic] No volume matched. Sample: {sample}")
            enrich_volume_with_grok_fast_fallback(trends, names, yesterday, today)
    except json.JSONDecodeError as e:
        print(f"  [!] Grok agentic: could not parse JSON: {e}")
        enrich_volume_with_grok_fast_fallback(trends, names, yesterday, today)
    except Exception as e:
        print(f"  [!] Grok agentic enrichment failed: {e}")
        enrich_volume_with_grok_fast_fallback(trends, names, yesterday, today)


def parse_volume_string(text: str) -> int:
    """Parse volume from strings like '17.7K posts', '1.2M posts', '500 posts'."""
    match = re.search(r'([\d,.]+)\s*([KkMm]?)\s*(?:posts?|tweets?)', text)
    if not match:
        return 0
    num_str = match.group(1).replace(",", "")
    multiplier = match.group(2).upper()
    try:
        val = float(num_str)
    except ValueError:
        return 0
    if multiplier == "K":
        return int(val * 1_000)
    elif multiplier == "M":
        return int(val * 1_000_000)
    return int(val)


def fetch_trends(woeid: int) -> dict:
    """Fetch trends for a single WOEID with source payload and status."""
    if not BEARER_TOKEN:
        print("ERROR: Set X_BEARER_TOKEN environment variable.")
        print("  export X_BEARER_TOKEN=\"your_bearer_token\"")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {BEARER_TOKEN}"}
    url = API_URL.format(woeid=woeid)

    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except requests.RequestException as e:
        print(f"  [!] Request failed for WOEID {woeid}: {e}")
        return {"status": "request_error", "trends": [], "payload": {"error": str(e)}}

    if resp.status_code == 429:
        retry_after = resp.headers.get("retry-after", "unknown")
        print(f"  [!] Rate limited. Retry after {retry_after}s")
        return {"status": "rate_limited", "trends": [], "payload": {"retry_after": retry_after}}

    if resp.status_code != 200:
        print(f"  [!] HTTP {resp.status_code} for WOEID {woeid}: {resp.text[:200]}")
        return {
            "status": f"http_{resp.status_code}",
            "trends": [],
            "payload": {"status_code": resp.status_code, "body": resp.text[:500]},
        }

    data = resp.json()
    raw_trends = data.get("data", [])

    # Try to extract volume from meta_description (e.g. "17.7K posts")
    for trend in raw_trends:
        if trend.get("tweet_count"):
            trend["volume_source"] = "api"
        if not trend.get("tweet_count") and trend.get("meta_description"):
            vol = parse_volume_string(trend["meta_description"])
            if vol > 0:
                trend["tweet_count"] = vol
                trend["volume_source"] = "meta_description"
        trend.setdefault("volume_source", "unknown")

    return {"status": "success", "trends": raw_trends, "payload": data}


def collect_all(grok_limit: int = DEFAULT_GROK_AGENTIC_VOLUME_LIMIT):
    """Fetch trends for all configured locations and store them."""
    print(f"\n{'='*60}")
    print(f"  Trndex Collector — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}")

    total = 0
    for woeid, name in LOCATIONS.items():
        fetch_result = fetch_trends(woeid)
        trends = fetch_result["trends"]
        if trends:
            if woeid == 23424977 and XAI_API_KEY:
                enrich_volume_with_grok_agentic(trends, limit=grok_limit)
                time.sleep(2)
            count = store_snapshot(
                woeid,
                name,
                trends,
                source_status="success",
                source_payload=fetch_result["payload"],
            )
            print(f"  ✓ {name}: {count} trends stored")
            total += count
        else:
            store_snapshot(
                woeid,
                name,
                [],
                source_status=fetch_result["status"],
                source_payload=fetch_result["payload"],
            )
            print(f"  ✗ {name}: no data ({fetch_result['status']})")
        time.sleep(1)  # gentle pause between requests

    print(f"\n  Total: {total} trend records saved to Neon Postgres")
    return total


# ── Momentum Computation ─────────────────────────────────────────────────────

def _to_datetime(ts):
    """Convert timestamp to datetime (handles both datetime and ISO string)."""
    if isinstance(ts, datetime):
        return ts
    s = str(ts).replace("Z", "+00:00")
    return datetime.fromisoformat(s)


def compute_momentum(woeid: int = 23424977, limit: int = 25):
    """
    Compare the two most recent snapshots for a location.
    Returns list of dicts with trend_name, current_count, previous_count, delta_pct, direction.
    """
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT DISTINCT fetched_at FROM snapshots
        WHERE woeid = %s
        ORDER BY fetched_at DESC
        LIMIT 2
    """, (woeid,))
    times = [row["fetched_at"] for row in cur.fetchall()]

    if len(times) < 2:
        cur.close()
        conn.close()
        return None, "Need at least 2 snapshots to compute momentum. Run the collector again later."

    current_time, previous_time = times[0], times[1]

    cur.execute("""
        SELECT trend_name, tweet_count, rank FROM snapshots
        WHERE woeid = %s AND fetched_at = %s
        ORDER BY rank ASC
    """, (woeid, current_time))
    current = {row["trend_name"]: {"count": row["tweet_count"], "rank": row["rank"]} for row in cur.fetchall()}

    cur.execute("""
        SELECT trend_name, tweet_count FROM snapshots
        WHERE woeid = %s AND fetched_at = %s
    """, (woeid, previous_time))
    previous = {row["trend_name"]: row["tweet_count"] for row in cur.fetchall()}

    cur.close()
    conn.close()

    # Compute deltas
    results = []
    for trend_name, data in current.items():
        current_count = data["count"]
        prev_count = previous.get(trend_name, 0)

        if prev_count > 0 and current_count > 0:
            delta_pct = ((current_count - prev_count) / prev_count) * 100
        elif prev_count == 0 and current_count > 0:
            delta_pct = 100.0  # new entry, treat as 100% up
        else:
            delta_pct = 0.0

        is_new = trend_name not in previous

        results.append({
            "trend_name": trend_name,
            "rank": data["rank"],
            "tweet_count": current_count,
            "prev_count": prev_count,
            "delta_pct": round(delta_pct, 1),
            "direction": "up" if delta_pct > 0 else ("down" if delta_pct < 0 else "flat"),
            "is_new": is_new,
        })

    results.sort(key=lambda x: abs(x["delta_pct"]), reverse=True)

    meta = {
        "current_snapshot": current_time.isoformat() if hasattr(current_time, "isoformat") else str(current_time),
        "previous_snapshot": previous_time.isoformat() if hasattr(previous_time, "isoformat") else str(previous_time),
        "location_woeid": woeid,
    }

    return results[:limit], meta


# ── Pulse: Conversation Velocity Index (0-100) ───────────────────────────────

def compute_pulse(woeid: int = 23424977, window_hours: int = 24):
    """
    Trend Pulse — measures how loud X is right now vs the recent baseline.
    """
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT DISTINCT fetched_at FROM snapshots
        WHERE woeid = %s
        ORDER BY fetched_at DESC
        LIMIT 1
    """, (woeid,))
    row = cur.fetchone()
    if not row:
        cur.close()
        conn.close()
        return None

    latest_time = _to_datetime(row["fetched_at"])
    cutoff = latest_time - timedelta(hours=window_hours)

    cur.execute("""
        SELECT COALESCE(SUM(tweet_count), 0) as total FROM snapshots
        WHERE woeid = %s AND fetched_at = %s
    """, (woeid, latest_time))
    current_vol = cur.fetchone()["total"]

    cur.execute("""
        SELECT fetched_at, SUM(tweet_count)::bigint as total
        FROM snapshots
        WHERE woeid = %s AND fetched_at >= %s AND fetched_at < %s
        GROUP BY fetched_at
    """, (woeid, cutoff, latest_time))
    window_rows = cur.fetchall()
    cur.close()
    conn.close()

    if not window_rows:
        return {
            "score": 50,
            "label": "NEUTRAL",
            "color": "#FFD600",
            "current_vol": current_vol,
            "avg_vol": current_vol,
            "pct_deviation": 0.0,
            "snapshots_in_window": 0,
            "window_hours": window_hours,
            "note": "Baseline forming — need more snapshots",
        }

    window_totals = [r["total"] for r in window_rows]
    avg_vol = sum(window_totals) / len(window_totals)

    if avg_vol > 0:
        pct_deviation = ((current_vol - avg_vol) / avg_vol) * 100
    else:
        pct_deviation = 0.0

    raw_score = 50 + (pct_deviation / 50) * 50
    score = max(0, min(100, round(raw_score)))

    if score >= 80:
        label, color = "SURGING", "#00E676"
    elif score >= 60:
        label, color = "BULLISH", "#69F0AE"
    elif score >= 40:
        label, color = "NEUTRAL", "#FFD600"
    elif score >= 20:
        label, color = "COOLING", "#FF9100"
    else:
        label, color = "DEAD", "#FF5252"

    return {
        "score": score,
        "label": label,
        "color": color,
        "current_vol": current_vol,
        "avg_vol": round(avg_vol),
        "pct_deviation": round(pct_deviation, 1),
        "snapshots_in_window": len(window_totals),
        "window_hours": window_hours,
    }


# ── Display ───────────────────────────────────────────────────────────────────

def display_ticker(woeid: int = 23424977):
    """Print a stock-ticker-style view of trend momentum."""
    location_name = LOCATIONS.get(woeid, f"WOEID {woeid}")

    results, meta = compute_momentum(woeid)
    if results is None:
        print(f"\n  {meta}")
        return

    print(f"\n{'='*70}")
    print(f"  TRNDEX — {location_name.upper()}")
    print(f"  Snapshot: {meta['current_snapshot'][:19]} UTC")
    print(f"  vs:       {meta['previous_snapshot'][:19]} UTC")

    pulse = compute_pulse(woeid)
    if pulse:
        bar_fill = int(pulse["score"] / 5)
        bar = "█" * bar_fill + "░" * (20 - bar_fill)
        print(f"{'='*70}")
        print(f"  TREND PULSE  [{bar}]  {pulse['score']}/100 — {pulse['label']}")
        print(f"  Current vol: {pulse['current_vol']:,}  │  24h avg: {pulse['avg_vol']:,}  │  Δ {pulse['pct_deviation']:+.1f}%")
        if pulse.get("note"):
            print(f"  ⚠ {pulse['note']}")

    print(f"{'='*70}")
    print(f"  {'TREND':<35} {'VOLUME':>10} {'CHANGE':>10}  {'SIGNAL'}")
    print(f"  {'─'*33}   {'─'*8}   {'─'*8}   {'─'*8}")

    for t in results:
        name = t["trend_name"][:33]
        vol = f"{t['tweet_count']:,}" if t["tweet_count"] > 0 else "N/A"

        if t["is_new"]:
            signal = "🆕 NEW"
            change = "—"
        elif t["direction"] == "up":
            signal = "🟢 ▲"
            change = f"+{t['delta_pct']}%"
        elif t["direction"] == "down":
            signal = "🔴 ▼"
            change = f"{t['delta_pct']}%"
        else:
            signal = "⚪ ━"
            change = "0.0%"

        print(f"  {name:<35} {vol:>10} {change:>10}  {signal}")

    print(f"\n  {len(results)} trends tracked")
    print(f"{'='*70}\n")


def export_json(woeid: int = 23424977):
    """Export momentum data as JSON (for feeding into the React frontend)."""
    results, meta = compute_momentum(woeid)
    if results is None:
        return json.dumps({"error": meta})

    output = {
        "meta": meta,
        "location": LOCATIONS.get(woeid, f"WOEID {woeid}"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pulse": compute_pulse(woeid),
        "trends": results,
    }

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "trndex_data.json")
    with open(path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"  Exported to {path}")
    return output


# ── DB Stats ──────────────────────────────────────────────────────────────────

def db_stats():
    """Print database statistics."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("SELECT COUNT(*) as n FROM snapshots")
    total_rows = cur.fetchone()["n"]

    cur.execute("SELECT COUNT(DISTINCT fetched_at) as n FROM snapshots")
    total_snapshots = cur.fetchone()["n"]

    cur.execute("SELECT MIN(fetched_at) as first, MAX(fetched_at) as last FROM snapshots")
    row = cur.fetchone()
    first, last = row["first"], row["last"]

    cur.execute("SELECT COUNT(DISTINCT trend_name) as n FROM snapshots")
    unique_trends = cur.fetchone()["n"]

    cur.execute("SELECT COUNT(*) as n FROM snapshot_runs")
    total_runs = cur.fetchone()["n"]

    cur.execute("SELECT COUNT(*) as n FROM trend_features")
    total_features = cur.fetchone()["n"]

    cur.execute("""
        SELECT MAX(feature_generated_at) as latest, COUNT(*) FILTER (WHERE feature_status = 'ready') as ready
        FROM snapshot_runs
    """)
    feature_meta = cur.fetchone()

    cur.close()
    conn.close()

    print(f"\n  Trndex Database Stats (Neon Postgres)")
    print(f"  ─────────────────────────────────────")
    print(f"  Total records:    {total_rows:,}")
    print(f"  Snapshots taken:  {total_snapshots}")
    print(f"  Unique trends:    {unique_trends}")
    print(f"  Snapshot runs:    {total_runs}")
    print(f"  Trend features:   {total_features}")
    print(f"  First snapshot:   {first}")
    print(f"  Latest snapshot:  {last}\n")
    if feature_meta["latest"]:
        print(f"  Latest features:  {feature_meta['latest']}")
        print(f"  Feature-ready:    {feature_meta['ready']}\n")


def quality_checks():
    """Run basic data quality checks for ingestion and derived features."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT woeid, fetched_at, COUNT(*) AS n
            FROM snapshot_runs
            GROUP BY woeid, fetched_at
            HAVING COUNT(*) > 1
        """)
        duplicate_runs = cur.fetchall()

        cur.execute("""
            SELECT run_id, woeid, location_name, fetched_at
            FROM snapshot_runs
            WHERE fetched_at IS NULL OR location_name IS NULL
        """)
        null_runs = cur.fetchall()

        cur.execute("""
            SELECT run_id, woeid, location_name, item_count
            FROM snapshot_runs
            WHERE source_status IN ('success', 'backfilled')
              AND item_count = 0
        """)
        empty_success = cur.fetchall()

        cur.execute("""
            SELECT run_id, woeid, ARRAY_AGG(rank ORDER BY rank) AS ranks
            FROM snapshot_items
            GROUP BY run_id, woeid
        """)
        rank_rows = cur.fetchall()
        bad_rank_runs = []
        for row in rank_rows:
            expected = list(range(1, len(row["ranks"]) + 1))
            if row["ranks"] != expected:
                bad_rank_runs.append({"run_id": row["run_id"], "woeid": row["woeid"], "ranks": row["ranks"]})

        cur.execute("""
            SELECT woeid, location_name, MAX(fetched_at) AS latest
            FROM snapshot_runs
            WHERE source_status IN ('success', 'backfilled')
            GROUP BY woeid, location_name
            ORDER BY woeid
        """)
        freshness_rows = cur.fetchall()

        now = datetime.now(timezone.utc)
        stale_locations = []
        for row in freshness_rows:
            age_seconds = (now - _to_datetime(row["latest"])).total_seconds()
            if age_seconds > (POLL_INTERVAL_SECONDS * 2):
                stale_locations.append({
                    "woeid": row["woeid"],
                    "location_name": row["location_name"],
                    "age_hours": round(age_seconds / 3600, 2),
                })

        print("\n  Trndex Quality Checks")
        print("  ─────────────────────")
        print(f"  Duplicate runs:      {len(duplicate_runs)}")
        print(f"  Null-timestamp runs: {len(null_runs)}")
        print(f"  Empty success runs:  {len(empty_success)}")
        print(f"  Rank-gap runs:       {len(bad_rank_runs)}")
        print(f"  Stale locations:     {len(stale_locations)}")
        if stale_locations:
            print("  Stale detail:")
            for row in stale_locations:
                print(f"    - {row['location_name']} ({row['woeid']}): {row['age_hours']}h old")

        return {
            "duplicate_runs": duplicate_runs,
            "null_runs": null_runs,
            "empty_success": empty_success,
            "bad_rank_runs": bad_rank_runs,
            "stale_locations": stale_locations,
        }
    finally:
        cur.close()
        conn.close()


def ops_report():
    """Print operational metrics for ingestion and feature freshness."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                COUNT(*) FILTER (WHERE source_status IN ('success', 'backfilled')) AS successful_runs,
                COUNT(*) FILTER (WHERE source_status NOT IN ('success', 'backfilled')) AS failed_runs,
                COUNT(*) FILTER (WHERE feature_status = 'ready') AS ready_features,
                COUNT(*) FILTER (WHERE feature_status = 'error') AS failed_features,
                MAX(feature_generated_at) AS latest_feature_at
            FROM snapshot_runs
        """)
        summary = cur.fetchone()

        cur.execute("""
            SELECT woeid, location_name, MAX(fetched_at) AS latest_snapshot, MAX(feature_generated_at) AS latest_feature
            FROM snapshot_runs
            GROUP BY woeid, location_name
            ORDER BY woeid
        """)
        freshness = cur.fetchall()

        print("\n  Trndex Ops Report")
        print("  ─────────────────")
        print(f"  Successful runs:   {summary['successful_runs']}")
        print(f"  Failed runs:       {summary['failed_runs']}")
        print(f"  Feature-ready runs:{summary['ready_features']}")
        print(f"  Feature errors:    {summary['failed_features']}")
        print(f"  Latest feature at: {summary['latest_feature_at']}")
        print("  Freshness by location:")
        for row in freshness:
            print(
                f"    - {row['location_name']} ({row['woeid']}): "
                f"snapshot={row['latest_snapshot']} feature={row['latest_feature']}"
            )

        return summary
    finally:
        cur.close()
        conn.close()


def bootstrap_intelligence():
    """Backfill legacy snapshots into the new schema when needed."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT COUNT(*) AS n FROM snapshots")
        snapshot_count = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM snapshot_runs")
        run_count = cur.fetchone()["n"]
    finally:
        cur.close()
        conn.close()

    if snapshot_count > 0 and run_count == 0:
        migrated = backfill_intelligence()
        if migrated:
            print(f"  Bootstrapped intelligence schema from {migrated} legacy snapshot groups.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Trndex — X Trends Data Collector")
    parser.add_argument("--once", action="store_true", help="Fetch once and exit")
    parser.add_argument("--loop", action="store_true", help="Fetch every 2 hours continuously")
    parser.add_argument("--view", action="store_true", help="View latest momentum ticker")
    parser.add_argument("--pulse", action="store_true", help="View Trend Pulse score only")
    parser.add_argument("--export", action="store_true", help="Export momentum data as JSON")
    parser.add_argument("--stats", action="store_true", help="Show database statistics")
    parser.add_argument("--backfill-intelligence", action="store_true", help="Backfill raw intelligence tables and derived features from legacy snapshots")
    parser.add_argument("--quality-checks", action="store_true", help="Run data quality checks")
    parser.add_argument("--ops", action="store_true", help="Show ingestion and feature freshness metrics")
    parser.add_argument("--woeid", type=int, default=23424977, help="WOEID for view/export (default: US)")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS,
                        help="Poll interval in seconds for --loop (default: 7200)")
    parser.add_argument(
        "--grok-limit",
        type=int,
        default=DEFAULT_GROK_AGENTIC_VOLUME_LIMIT,
        help=f"Max zero-volume US trends to enrich via Grok agentic search (default: {DEFAULT_GROK_AGENTIC_VOLUME_LIMIT})",
    )

    args = parser.parse_args()

    init_db()

    if args.backfill_intelligence:
        migrated = backfill_intelligence()
        print(f"  Backfilled {migrated} legacy snapshot groups.")
    elif args.quality_checks:
        quality_checks()
    elif args.ops:
        ops_report()
    elif args.stats:
        db_stats()
    elif args.pulse:
        location_name = LOCATIONS.get(args.woeid, f"WOEID {args.woeid}")
        pulse = compute_pulse(args.woeid)
        if pulse is None:
            print("  No data yet. Run collector first.")
        else:
            bar_fill = int(pulse["score"] / 5)
            bar = "█" * bar_fill + "░" * (20 - bar_fill)
            print(f"\n{'='*50}")
            print(f"  TRNDEX TREND PULSE — {location_name.upper()}")
            print(f"{'='*50}")
            print(f"\n  [{bar}]  {pulse['score']}/100\n")
            print(f"  Status:       {pulse['label']}")
            print(f"  Current vol:  {pulse['current_vol']:,}")
            print(f"  24h avg vol:  {pulse['avg_vol']:,}")
            print(f"  Deviation:    {pulse['pct_deviation']:+.1f}%")
            print(f"  Window:       {pulse['snapshots_in_window']} snapshots over {pulse['window_hours']}h")
            if pulse.get("note"):
                print(f"\n  ⚠ {pulse['note']}")
            print(f"\n{'='*50}\n")
    elif args.view:
        display_ticker(args.woeid)
    elif args.export:
        export_json(args.woeid)
    elif args.once:
        collect_all(args.grok_limit)
    elif args.loop:
        print(f"Starting collector loop (every {args.interval}s). Press Ctrl+C to stop.\n")
        try:
            while True:
                collect_all(args.grok_limit)
                print(f"\n  Next fetch in {args.interval // 60} minutes...")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n  Collector stopped.")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
