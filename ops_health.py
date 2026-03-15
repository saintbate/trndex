"""
Trndex Pipeline Health Checks
Fails loudly when ingestion or rollups are stale.
"""

import argparse
import os
import sys
from datetime import datetime, timezone, timedelta, date

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
    sys.exit(1)


DATABASE_URL = os.environ.get("DATABASE_URL", "")
US_WOEID = 23424977


def get_conn():
    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL environment variable.")
        sys.exit(1)
    return psycopg2.connect(DATABASE_URL)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_recent(ts: datetime | None, max_age: timedelta, label: str):
    if ts is None:
        raise RuntimeError(f"{label}: missing timestamp")
    dt = ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    age = _utc_now() - dt
    if age > max_age:
        raise RuntimeError(f"{label}: stale by {age}")


def check_collector(cur):
    cur.execute(
        """
        SELECT fetched_at, item_count, feature_status, feature_generated_at
        FROM snapshot_runs
        WHERE woeid = %s
          AND source_status IN ('success', 'backfilled')
        ORDER BY fetched_at DESC
        LIMIT 1
        """,
        (US_WOEID,),
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError("collector: no successful US snapshot_runs")
    if int(row["item_count"] or 0) <= 0:
        raise RuntimeError("collector: latest run has zero items")
    if row["feature_status"] != "ready":
        raise RuntimeError(f"collector: latest feature_status is {row['feature_status']}")
    _ensure_recent(row["fetched_at"], timedelta(hours=4), "collector snapshot")
    _ensure_recent(row["feature_generated_at"], timedelta(hours=4), "collector features")


def check_markets(cur):
    cur.execute("SELECT MAX(bucket_start) AS latest_price FROM market_price_bars")
    latest_price = cur.fetchone()["latest_price"]
    _ensure_recent(latest_price, timedelta(days=3), "market prices")

    cur.execute(
        """
        SELECT MAX(bucket_start) AS latest_prediction
        FROM prediction_market_bars
        WHERE venue = 'polymarket'
        """
    )
    latest_prediction = cur.fetchone()["latest_prediction"]
    _ensure_recent(latest_prediction, timedelta(hours=6), "prediction markets")


def check_google_trends(cur):
    cur.execute("SELECT MAX(fetched_at) AS latest_gt, COUNT(*) AS n FROM google_trends_bars")
    row = cur.fetchone()
    if int(row["n"] or 0) <= 0:
        raise RuntimeError("google trends: no rows present")
    _ensure_recent(row["latest_gt"], timedelta(hours=6), "google trends")


def check_rollup(cur):
    cur.execute(
        """
        SELECT MAX(bucket_date) AS latest_rollup, COUNT(*) AS n
        FROM daily_board_summary
        WHERE woeid = %s
        """,
        (US_WOEID,),
    )
    row = cur.fetchone()
    latest_rollup = row["latest_rollup"]
    if latest_rollup is None:
        raise RuntimeError("daily rollup: no rows present")
    if isinstance(latest_rollup, datetime):
        latest_rollup = latest_rollup.date()
    if latest_rollup < (_utc_now().date() - timedelta(days=1)):
        raise RuntimeError(f"daily rollup: stale latest bucket {latest_rollup}")


CHECKS = {
    "collector": check_collector,
    "markets": check_markets,
    "google-trends": check_google_trends,
    "rollup": check_rollup,
}


def main():
    parser = argparse.ArgumentParser(description="Trndex pipeline health checks")
    parser.add_argument(
        "--check",
        choices=["collector", "markets", "google-trends", "rollup", "all"],
        default="all",
        help="Check a specific pipeline or all pipelines",
    )
    args = parser.parse_args()

    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    failures: list[str] = []
    try:
        names = list(CHECKS.keys()) if args.check == "all" else [args.check]
        for name in names:
            try:
                CHECKS[name](cur)
                print(f"[ok] {name}")
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{name}: {exc}")
                print(f"[fail] {name}: {exc}")
    finally:
        cur.close()
        conn.close()

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
