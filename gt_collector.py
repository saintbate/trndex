"""
Trndex Google Trends Collector
Fetches search interest for top X trends and stores in Neon Postgres.
Uses pytrends (unofficial Google Trends API).

Usage:
    python gt_collector.py --once          # Fetch once
    python gt_collector.py --loop          # Every 2 hours

Setup:
    pip install -r requirements.txt
    DATABASE_URL in .env.local
"""

import os
import re
import time
import argparse
import sys
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

try:
    from pytrends.request import TrendReq
except ImportError:
    print("Install pytrends: pip install pytrends")
    exit(1)


DATABASE_URL = os.environ.get("DATABASE_URL", "")
US_WOEID = 23424977
MAX_KEYWORDS_PER_REQUEST = 5
TOP_TRENDS_LIMIT = 15
DELAY_BETWEEN_REQUESTS = 3
POLL_INTERVAL_SECONDS = 2 * 60 * 60


def normalize_for_gt(name: str) -> str:
    """Clean trend name for Google Trends (remove #, trim, limit length)."""
    s = re.sub(r"\s+", " ", (name or "").strip().lstrip("#"))[:50]
    return s or "Unknown"


def get_conn():
    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL")
        exit(1)
    return psycopg2.connect(DATABASE_URL)


def get_top_trends(limit: int) -> list[str]:
    """Get top trend names from latest US snapshot."""
    conn = get_conn()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute(
            """
            SELECT si.trend_name_raw
            FROM snapshot_items si
            JOIN snapshot_runs sr ON sr.run_id = si.run_id
            WHERE si.woeid = %s
              AND sr.source_status IN ('success', 'backfilled')
              AND sr.fetched_at = (
                SELECT MAX(fetched_at) FROM snapshot_runs
                WHERE woeid = %s AND source_status IN ('success', 'backfilled')
              )
            ORDER BY si.rank ASC
            LIMIT %s
            """,
            (US_WOEID, US_WOEID, limit),
        )
        rows = cur.fetchall()
        if rows:
            return [r["trend_name_raw"] for r in rows]
        cur.execute(
            """
            SELECT trend_name FROM snapshots
            WHERE woeid = %s AND fetched_at = (
              SELECT MAX(fetched_at) FROM snapshots WHERE woeid = %s
            )
            ORDER BY rank ASC
            LIMIT %s
            """,
            (US_WOEID, US_WOEID, limit),
        )
        rows = cur.fetchall()
        return [r["trend_name"] for r in rows]
    finally:
        cur.close()
        conn.close()


def fetch_and_store():
    """Fetch Google Trends for top US trends and store in DB."""
    trends = get_top_trends(TOP_TRENDS_LIMIT)
    if not trends:
        print("  No trend data. Run collector.py --once first.")
        return 0

    keywords = [normalize_for_gt(t) for t in trends]
    keywords = list(dict.fromkeys(k for k in keywords if k and k != "Unknown"))

    if not keywords:
        return 0

    conn = get_conn()
    cur = conn.cursor()
    stored = 0
    now = datetime.now(timezone.utc)

    try:
        pytrend = TrendReq(hl="en-US", tz=360)

        for i in range(0, len(keywords), MAX_KEYWORDS_PER_REQUEST):
            batch = keywords[i : i + MAX_KEYWORDS_PER_REQUEST]
            try:
                pytrend.build_payload(batch, timeframe="now 7-d", geo="US")
                df = pytrend.interest_over_time()
            except Exception as e:
                print(f"  [!] pytrends error for {batch}: {e}")
                time.sleep(DELAY_BETWEEN_REQUESTS)
                continue

            if df is None or df.empty:
                time.sleep(DELAY_BETWEEN_REQUESTS)
                continue

            if "isPartial" in df.columns:
                df = df.drop(columns=["isPartial"])

            for col in df.columns:
                keyword = str(col).strip()
                if not keyword:
                    continue
                for idx, row in df.iterrows():
                    val = row.get(col)
                    if val is None or (isinstance(val, float) and (val != val)):
                        continue
                    interest = int(round(float(val)))
                    bucket_date = idx.date() if hasattr(idx, "date") else idx
                    if isinstance(bucket_date, str):
                        bucket_date = datetime.fromisoformat(bucket_date.replace("Z", "+00:00")).date()

                    cur.execute(
                        """
                        INSERT INTO google_trends_bars (keyword, bucket_date, geo, interest_value, fetched_at)
                        VALUES (%s, %s, 'US', %s, %s)
                        ON CONFLICT (keyword, bucket_date, geo) DO UPDATE SET
                            interest_value = EXCLUDED.interest_value,
                            fetched_at = EXCLUDED.fetched_at
                        """,
                        (keyword, bucket_date, interest, now),
                    )
                    stored += 1

            time.sleep(DELAY_BETWEEN_REQUESTS)

        conn.commit()
    finally:
        cur.close()
        conn.close()

    return stored


def main():
    parser = argparse.ArgumentParser(description="Trndex — Google Trends Collector")
    parser.add_argument("--once", action="store_true", help="Fetch once and exit")
    parser.add_argument("--loop", action="store_true", help="Fetch every 2 hours")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS,
                        help="Poll interval in seconds for --loop")

    args = parser.parse_args()

    from collector import init_db
    init_db()

    if args.loop:
        print("Starting Google Trends collector loop. Press Ctrl+C to stop.\n")
        try:
            while True:
                print(f"\n{'='*50}")
                print(f"  Trndex GT — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
                print(f"{'='*50}")
                n = fetch_and_store()
                print(f"  Stored {n} Google Trends bars")
                print(f"\n  Next fetch in {args.interval // 60} minutes...")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n  Stopped.")
    else:
        print(f"\n{'='*50}")
        print(f"  Trndex Google Trends — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
        print(f"{'='*50}")
        n = fetch_and_store()
        print(f"  Stored {n} Google Trends bars\n")
        if n <= 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
