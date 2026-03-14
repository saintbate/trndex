"""
Trndex Market & Prediction Market Collector
Fetches OHLCV bars for key symbols and active Polymarket contracts.
Stores data in Neon Postgres for correlation with trend attention signals.

Usage:
    python market_collector.py --once          # Fetch everything once
    python market_collector.py --prices        # Fetch market prices only
    python market_collector.py --predictions   # Fetch prediction market only
    python market_collector.py --loop          # Fetch every 2 hours continuously

Setup:
    pip install -r requirements.txt
    (yfinance is required for market prices)
"""

import os
import sys
import json
import time
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
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)


DATABASE_URL = os.environ.get("DATABASE_URL", "")

MARKET_SYMBOLS = ["SPY", "QQQ", "BTC-USD", "ETH-USD", "^VIX"]

POLYMARKET_GAMMA_URL = "https://gamma-api.polymarket.com/markets"
POLYMARKET_MIN_LIQUIDITY = 50_000
POLYMARKET_MAX_CONTRACTS = 100

POLL_INTERVAL_SECONDS = 2 * 60 * 60


def get_conn():
    if not DATABASE_URL:
        print("ERROR: Set DATABASE_URL environment variable.")
        sys.exit(1)
    return psycopg2.connect(DATABASE_URL)


def fetch_market_prices() -> list[dict]:
    """Fetch daily OHLCV bars for tracked symbols using yfinance."""
    try:
        import yfinance as yf
    except ImportError:
        print("  [!] yfinance not installed. Run: pip install yfinance")
        return []

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)

    print(f"  Fetching market prices for {', '.join(MARKET_SYMBOLS)}...")

    bars = []
    for symbol in MARKET_SYMBOLS:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"), interval="1d")

            if hist.empty:
                print(f"  [!] No data for {symbol}")
                continue

            for idx, row in hist.iterrows():
                ts = idx.to_pydatetime()
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                bars.append({
                    "symbol": symbol,
                    "bucket_start": ts,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row["Volume"]),
                    "source": "yahoo_finance",
                })

            print(f"  {symbol}: {len(hist)} bars")
        except Exception as e:
            print(f"  [!] Failed to fetch {symbol}: {e}")

    return bars


def store_market_prices(bars: list[dict]) -> int:
    if not bars:
        return 0

    conn = get_conn()
    cur = conn.cursor()
    stored = 0

    try:
        for bar in bars:
            cur.execute(
                """
                INSERT INTO market_price_bars (symbol, bucket_start, open, high, low, close, volume, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (symbol, bucket_start, source) DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume
                """,
                (
                    bar["symbol"],
                    bar["bucket_start"],
                    bar["open"],
                    bar["high"],
                    bar["low"],
                    bar["close"],
                    bar["volume"],
                    bar["source"],
                ),
            )
            stored += 1
        conn.commit()
    finally:
        cur.close()
        conn.close()

    return stored


def fetch_polymarket_contracts() -> list[dict]:
    """Fetch active, high-liquidity contracts from Polymarket's Gamma API."""
    print("  Fetching Polymarket contracts...")
    contracts = []
    offset = 0
    limit = 100

    while len(contracts) < POLYMARKET_MAX_CONTRACTS:
        try:
            resp = requests.get(
                POLYMARKET_GAMMA_URL,
                params={
                    "limit": limit,
                    "offset": offset,
                    "active": "true",
                    "closed": "false",
                    "order": "liquidityNum",
                    "ascending": "false",
                },
                timeout=30,
            )

            if resp.status_code != 200:
                print(f"  [!] Polymarket API error: HTTP {resp.status_code}")
                break

            data = resp.json()
            if not data:
                break

            for market in data:
                liquidity = float(market.get("liquidityNum") or 0)
                if liquidity < POLYMARKET_MIN_LIQUIDITY:
                    continue

                outcomes = market.get("outcomes", "")
                if isinstance(outcomes, str):
                    try:
                        outcomes = json.loads(outcomes)
                    except (json.JSONDecodeError, TypeError):
                        outcomes = []

                prices = market.get("outcomePrices", "")
                if isinstance(prices, str):
                    try:
                        prices = json.loads(prices)
                    except (json.JSONDecodeError, TypeError):
                        prices = []

                price_yes = None
                price_no = None
                for i, outcome in enumerate(outcomes):
                    if i < len(prices):
                        p = float(prices[i])
                        if str(outcome).lower() == "yes":
                            price_yes = p
                        elif str(outcome).lower() == "no":
                            price_no = p

                if price_yes is None and prices:
                    price_yes = float(prices[0])
                if price_no is None and len(prices) > 1:
                    price_no = float(prices[1])

                contracts.append({
                    "contract_id": market.get("conditionId") or market.get("id") or str(market.get("slug", "")),
                    "question": (market.get("question") or market.get("title") or "")[:500],
                    "price_yes": price_yes,
                    "price_no": price_no,
                    "volume": float(market.get("volumeNum") or 0),
                    "liquidity": liquidity,
                    "venue": "polymarket",
                })

            offset += limit
            if len(data) < limit:
                break

            time.sleep(0.5)
        except Exception as e:
            print(f"  [!] Polymarket fetch error: {e}")
            break

    print(f"  Polymarket: {len(contracts)} active contracts (>{POLYMARKET_MIN_LIQUIDITY:,} liquidity)")
    return contracts


def store_polymarket_contracts(contracts: list[dict]) -> int:
    if not contracts:
        return 0

    conn = get_conn()
    cur = conn.cursor()
    stored = 0
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    try:
        for c in contracts:
            cur.execute(
                """
                INSERT INTO prediction_market_bars (
                    contract_id, bucket_start, venue, question, price_yes, price_no, volume, open_interest
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (contract_id, bucket_start, venue) DO UPDATE SET
                    question = EXCLUDED.question,
                    price_yes = EXCLUDED.price_yes,
                    price_no = EXCLUDED.price_no,
                    volume = EXCLUDED.volume,
                    open_interest = EXCLUDED.open_interest
                """,
                (
                    c["contract_id"],
                    now,
                    c["venue"],
                    c["question"],
                    c["price_yes"],
                    c["price_no"],
                    c["volume"],
                    c["liquidity"],
                ),
            )
            stored += 1
        conn.commit()
    finally:
        cur.close()
        conn.close()

    return stored


def collect_prices():
    bars = fetch_market_prices()
    stored = store_market_prices(bars)
    print(f"  Stored {stored} market price bars")
    return stored


def collect_predictions():
    contracts = fetch_polymarket_contracts()
    stored = store_polymarket_contracts(contracts)
    print(f"  Stored {stored} prediction market snapshots")
    return stored


def collect_all():
    print(f"\n{'='*60}")
    print(f"  Trndex Market Collector — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}")

    collect_prices()
    collect_predictions()

    print(f"\n  Done.\n")


def main():
    parser = argparse.ArgumentParser(description="Trndex — Market & Prediction Market Collector")
    parser.add_argument("--once", action="store_true", help="Fetch all market data once")
    parser.add_argument("--prices", action="store_true", help="Fetch market prices only")
    parser.add_argument("--predictions", action="store_true", help="Fetch prediction market data only")
    parser.add_argument("--loop", action="store_true", help="Fetch every 2 hours continuously")
    parser.add_argument("--interval", type=int, default=POLL_INTERVAL_SECONDS,
                        help="Poll interval in seconds for --loop (default: 7200)")

    args = parser.parse_args()

    if args.prices:
        collect_prices()
    elif args.predictions:
        collect_predictions()
    elif args.once:
        collect_all()
    elif args.loop:
        print(f"Starting market collector loop (every {args.interval}s). Press Ctrl+C to stop.\n")
        try:
            while True:
                collect_all()
                print(f"\n  Next fetch in {args.interval // 60} minutes...")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n  Market collector stopped.")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
