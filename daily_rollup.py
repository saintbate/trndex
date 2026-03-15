"""
Trndex Daily Rollup
Aggregates trend_features and market_features into daily buckets for faster weekly/monthly queries.

Usage:
    python daily_rollup.py --once     # Process last 60 days
    python daily_rollup.py --days 7    # Process last 7 days only

Setup:
    pip install -r requirements.txt
    DATABASE_URL in .env.local
"""

import os
import argparse
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Install psycopg2-binary: pip install psycopg2-binary")
    exit(1)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
US_WOEID = 23424977
DEFAULT_LOOKBACK_DAYS = 60


def get_conn():
    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL")
        exit(1)
    return psycopg2.connect(DATABASE_URL)


def run_rollup(lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> dict:
    """Aggregate trend_features and market_features into daily rollup tables."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        from collector import init_db
        init_db()
    except Exception as e:
        print(f"  [!] init_db: {e}")
        cur.close()
        conn.close()
        return {"trends": 0, "categories": 0, "boards": 0}

    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).date()

    # Get distinct dates with data
    cur.execute(
        """
        SELECT DISTINCT (fetched_at AT TIME ZONE 'UTC')::date AS bucket_date
        FROM snapshot_runs
        WHERE woeid = %s
          AND source_status IN ('success', 'backfilled')
          AND (fetched_at AT TIME ZONE 'UTC')::date >= %s
        ORDER BY bucket_date ASC
        """,
        (US_WOEID, cutoff),
    )
    dates = [r["bucket_date"] for r in cur.fetchall()]

    if not dates:
        print("  No snapshot dates to process.")
        cur.close()
        conn.close()
        return {"trends": 0, "categories": 0, "boards": 0}

    trends_stored = 0
    categories_stored = 0
    boards_stored = 0

    for bucket_date in dates:
        dt_start = datetime.combine(bucket_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        dt_end = dt_start + timedelta(days=1)

        # Daily trend rollup
        cur.execute(
            """
            INSERT INTO daily_trend_rollup (
                bucket_date, woeid, entity_id, trend_name_raw, canonical_name, category,
                appearances, avg_rank, best_rank
            )
            SELECT
                %s,
                tf.woeid,
                tf.entity_id,
                MAX(tf.trend_name_raw),
                MAX(tf.canonical_name),
                MAX(tf.category),
                COUNT(*)::int,
                AVG(tf.rank)::real,
                MIN(tf.rank)::int
            FROM trend_features tf
            WHERE tf.woeid = %s
              AND tf.fetched_at >= %s
              AND tf.fetched_at < %s
            GROUP BY tf.woeid, tf.entity_id
            ON CONFLICT (bucket_date, woeid, entity_id) DO UPDATE SET
                trend_name_raw = EXCLUDED.trend_name_raw,
                canonical_name = EXCLUDED.canonical_name,
                category = EXCLUDED.category,
                appearances = EXCLUDED.appearances,
                avg_rank = EXCLUDED.avg_rank,
                best_rank = EXCLUDED.best_rank
            """,
            (bucket_date, US_WOEID, dt_start, dt_end),
        )
        trends_stored += cur.rowcount

        # Daily category rollup
        cur.execute(
            """
            WITH daily_entities AS (
                SELECT DISTINCT tf.entity_id, COALESCE(tf.category, 'Untagged') AS category
                FROM trend_features tf
                WHERE tf.woeid = %s
                  AND tf.fetched_at >= %s
                  AND tf.fetched_at < %s
            ),
            cat_counts AS (
                SELECT category, COUNT(*)::int AS trend_count
                FROM daily_entities
                GROUP BY category
            ),
            total AS (
                SELECT SUM(trend_count)::real AS n FROM cat_counts
            )
            INSERT INTO daily_category_rollup (bucket_date, woeid, category, trend_count, share_pct)
            SELECT %s, %s, cat_counts.category, cat_counts.trend_count,
                   ROUND((cat_counts.trend_count::real / NULLIF(total.n, 0) * 100)::numeric, 2)::real
            FROM cat_counts, total
            ON CONFLICT (bucket_date, woeid, category) DO UPDATE SET
                trend_count = EXCLUDED.trend_count,
                share_pct = EXCLUDED.share_pct
            """,
            (US_WOEID, dt_start, dt_end, bucket_date, US_WOEID),
        )
        categories_stored += cur.rowcount

        # Daily board summary
        cur.execute(
            """
            INSERT INTO daily_board_summary (
                bucket_date, woeid, location_name, snapshot_count, distinct_trends,
                new_entries, exits, avg_turnover
            )
            SELECT
                %s,
                mf.woeid,
                MAX(mf.location_name),
                COUNT(*)::int,
                (SELECT COUNT(DISTINCT tf.entity_id) FROM trend_features tf
                 WHERE tf.woeid = mf.woeid AND tf.fetched_at >= %s AND tf.fetched_at < %s),
                COALESCE(SUM(mf.new_entry_count), 0)::int,
                COALESCE(SUM(mf.exit_count), 0)::int,
                COALESCE(AVG(mf.turnover_ratio), 0)::real
            FROM market_features mf
            WHERE mf.woeid = %s
              AND mf.fetched_at >= %s
              AND mf.fetched_at < %s
            GROUP BY mf.woeid
            ON CONFLICT (bucket_date, woeid) DO UPDATE SET
                location_name = EXCLUDED.location_name,
                snapshot_count = EXCLUDED.snapshot_count,
                distinct_trends = EXCLUDED.distinct_trends,
                new_entries = EXCLUDED.new_entries,
                exits = EXCLUDED.exits,
                avg_turnover = EXCLUDED.avg_turnover
            """,
            (bucket_date, dt_start, dt_end, US_WOEID, dt_start, dt_end),
        )
        boards_stored += cur.rowcount

    conn.commit()
    cur.close()
    conn.close()

    return {"trends": trends_stored, "categories": categories_stored, "boards": boards_stored, "dates": len(dates)}


def main():
    parser = argparse.ArgumentParser(description="Trndex — Daily Rollup")
    parser.add_argument("--once", action="store_true", help="Run once for last 60 days")
    parser.add_argument("--days", type=int, default=DEFAULT_LOOKBACK_DAYS, help="Lookback days")

    args = parser.parse_args()

    print(f"\n{'='*50}")
    print(f"  Trndex Daily Rollup — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*50}")

    result = run_rollup(args.days)
    print(f"  Processed {result.get('dates', 0)} dates")
    print(f"  Trend rollups: {result.get('trends', 0)}")
    print(f"  Category rollups: {result.get('categories', 0)}")
    print(f"  Board summaries: {result.get('boards', 0)}")
    print(f"\n  Done.\n")


if __name__ == "__main__":
    main()
