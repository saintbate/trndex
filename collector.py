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
    from psycopg2.extras import RealDictCursor
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
try:
    DEFAULT_GROK_AGENTIC_VOLUME_LIMIT = max(1, int(os.environ.get("GROK_AGENTIC_VOLUME_LIMIT", "12")))
except ValueError:
    DEFAULT_GROK_AGENTIC_VOLUME_LIMIT = 12


KEYWORD_CATEGORIES = {
    "NBA": "Sports", "NFL": "Sports", "NHL": "Sports", "MLB": "Sports",
    "UFC": "Sports", "FIFA": "Sports", "Premier League": "Sports",
    "Lakers": "Sports", "Warriors": "Sports", "Yankees": "Sports",
    "NBAPlayoffs": "Sports", "Super Bowl": "Sports", "Olympics": "Sports",
    "AI": "Tech", "ChatGPT": "Tech", "OpenAI": "Tech", "Google": "Tech",
    "Apple": "Tech", "NVIDIA": "Tech", "Tesla": "Tech", "Microsoft": "Tech",
    "Elon Musk": "Tech", "TikTok": "Tech", "iPhone": "Tech",
    "Bitcoin": "Crypto", "BTC": "Crypto", "Ethereum": "Crypto", "ETH": "Crypto",
    "Crypto": "Crypto", "Solana": "Crypto", "NFT": "Crypto", "Blockchain": "Crypto",
    "Congress": "Politics", "Senate": "Politics", "SCOTUS": "Politics",
    "Supreme Court": "Politics", "White House": "Politics",
    "Trump": "Politics", "Biden": "Politics", "Election": "Politics",
    "Fed Rate": "Finance", "Stock Market": "Finance", "Wall Street": "Finance",
    "Recession": "Finance", "Inflation": "Finance", "Tariff": "Finance",
    "Beyoncé": "Culture", "Taylor Swift": "Culture", "Drake": "Culture",
    "Grammys": "Culture", "Oscars": "Culture", "Met Gala": "Culture",
    "Netflix": "Entertainment", "Disney": "Entertainment", "Marvel": "Entertainment",
    "Anime": "Entertainment", "K-pop": "Entertainment", "BTS": "Entertainment",
    "Breaking": "News", "BREAKING": "News", "RIP": "News",
    "Climate": "Science", "NASA": "Science", "Space": "Science",
    "Wordle": "Games", "Fortnite": "Games", "GTA": "Games",
    "PlayStation": "Games", "Xbox": "Games", "Nintendo": "Games",
    "Mental Health": "Health", "COVID": "Health", "Vaccine": "Health",
}


def classify_keyword(name: str) -> str:
    """Classify using keyword map. Returns category or empty string."""
    lower = name.lower().lstrip("#")
    for keyword, cat in KEYWORD_CATEGORIES.items():
        if keyword.lower() in lower:
            return cat
    return ""


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
    """Classify a batch of trend names. Uses keyword map first, Grok for unknowns."""
    results = {}
    unknown = []

    for name in trend_names:
        cat = classify_keyword(name)
        if cat:
            results[name] = cat
        else:
            unknown.append(name)

    if unknown:
        grok_results = classify_with_grok(unknown)
        for name in unknown:
            results[name] = grok_results.get(name, "Trending")

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
        conn.commit()
    finally:
        cur.close()
        conn.close()


def store_snapshot(woeid: int, location_name: str, trends: list, use_grok_classify: bool = False):
    """Store a batch of trends from one API call, with category classification."""
    conn = get_conn()
    cur = conn.cursor()
    now = datetime.now(timezone.utc)

    trend_names = [t.get("trend_name", "Unknown") for t in trends]
    categories = classify_trends(trend_names) if use_grok_classify else {
        n: classify_keyword(n) or "Trending" for n in trend_names
    }

    for i, trend in enumerate(trends):
        name = trend.get("trend_name", "Unknown")
        cur.execute(
            """
            INSERT INTO snapshots (fetched_at, woeid, location_name, trend_name, tweet_count, rank, category)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                now,
                woeid,
                location_name,
                name,
                trend.get("tweet_count", 0) or 0,
                i + 1,
                categories.get(name, "Trending"),
            ),
        )

    conn.commit()
    cur.close()
    conn.close()
    return len(trends)


# ── API ───────────────────────────────────────────────────────────────────────

import re


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


def fetch_trends(woeid: int) -> list:
    """Fetch trends for a single WOEID. Returns list of trend dicts."""
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
        return []

    if resp.status_code == 429:
        retry_after = resp.headers.get("retry-after", "unknown")
        print(f"  [!] Rate limited. Retry after {retry_after}s")
        return []

    if resp.status_code != 200:
        print(f"  [!] HTTP {resp.status_code} for WOEID {woeid}: {resp.text[:200]}")
        return []

    data = resp.json()
    raw_trends = data.get("data", [])

    # Try to extract volume from meta_description (e.g. "17.7K posts")
    for trend in raw_trends:
        if not trend.get("tweet_count") and trend.get("meta_description"):
            vol = parse_volume_string(trend["meta_description"])
            if vol > 0:
                trend["tweet_count"] = vol

    return raw_trends


def collect_all(grok_limit: int = DEFAULT_GROK_AGENTIC_VOLUME_LIMIT):
    """Fetch trends for all configured locations and store them."""
    print(f"\n{'='*60}")
    print(f"  Trndex Collector — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"{'='*60}")

    total = 0
    for woeid, name in LOCATIONS.items():
        trends = fetch_trends(woeid)
        if trends:
            if woeid == 23424977 and XAI_API_KEY:
                enrich_volume_with_grok_agentic(trends, limit=grok_limit)
                time.sleep(2)
            count = store_snapshot(woeid, name, trends, use_grok_classify=(woeid == 23424977 and bool(XAI_API_KEY)))
            print(f"  ✓ {name}: {count} trends stored")
            total += count
        else:
            print(f"  ✗ {name}: no data")
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

    cur.close()
    conn.close()

    print(f"\n  Trndex Database Stats (Neon Postgres)")
    print(f"  ─────────────────────────────────────")
    print(f"  Total records:    {total_rows:,}")
    print(f"  Snapshots taken:  {total_snapshots}")
    print(f"  Unique trends:    {unique_trends}")
    print(f"  First snapshot:   {first}")
    print(f"  Latest snapshot:  {last}\n")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Trndex — X Trends Data Collector")
    parser.add_argument("--once", action="store_true", help="Fetch once and exit")
    parser.add_argument("--loop", action="store_true", help="Fetch every 2 hours continuously")
    parser.add_argument("--view", action="store_true", help="View latest momentum ticker")
    parser.add_argument("--pulse", action="store_true", help="View Trend Pulse score only")
    parser.add_argument("--export", action="store_true", help="Export momentum data as JSON")
    parser.add_argument("--stats", action="store_true", help="Show database statistics")
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

    if args.stats:
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
