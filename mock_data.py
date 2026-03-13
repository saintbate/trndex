"""
Trndex Mock Data Generator
Generates realistic fake trend snapshots so you can test the UI
without needing an X API key yet.

Usage:
    python mock_data.py          # Generate 6 snapshots over 12 hours
    python mock_data.py --days 3 # Generate 3 days of data
"""

import os
import sys
import json
import random
import sqlite3
import argparse
from datetime import datetime, timezone, timedelta

# Add parent dir for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collector import init_db, DB_PATH, LOCATIONS

# Realistic trending topics pool
TREND_POOL = [
    # Sports
    ("#NBAPlayoffs", "sports"),
    ("#MarchMadness", "sports"),
    ("LeBron", "sports"),
    ("Luka Doncic", "sports"),
    ("#SuperBowl", "sports"),
    ("Warriors", "sports"),
    ("UFC300", "sports"),

    # Tech
    ("#AI", "tech"),
    ("ChatGPT", "tech"),
    ("OpenAI", "tech"),
    ("#Bitcoin", "tech"),
    ("Ethereum", "tech"),
    ("Apple", "tech"),
    ("#CryptoTwitter", "tech"),
    ("NVIDIA", "tech"),
    ("Elon Musk", "tech"),

    # Politics / News
    ("Congress", "politics"),
    ("Supreme Court", "politics"),
    ("#Breaking", "news"),
    ("White House", "politics"),
    ("Fed Rate", "finance"),
    ("#Election2026", "politics"),

    # Culture / Entertainment
    ("Beyoncé", "entertainment"),
    ("Drake", "entertainment"),
    ("#Oscars", "entertainment"),
    ("Netflix", "entertainment"),
    ("Taylor Swift", "entertainment"),
    ("SNL", "entertainment"),
    ("#GRAMMYs", "entertainment"),

    # Misc
    ("#MentalHealth", "health"),
    ("Climate", "science"),
    ("#FoodTok", "lifestyle"),
    ("Wordle", "games"),
    ("#Trending", "meta"),
    ("RIP", "memorial"),
    ("#Viral", "meta"),
]


def generate_snapshots(num_days: int = 1):
    """Generate mock snapshots: one every 2 hours for num_days."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    snapshots_per_day = 12  # every 2 hours
    total_snapshots = snapshots_per_day * num_days
    start_time = datetime.now(timezone.utc) - timedelta(days=num_days)

    print(f"\n  Generating {total_snapshots} snapshots over {num_days} day(s)...\n")

    # Track "persistent" trends and their trajectories
    active_trends = {}

    for i in range(total_snapshots):
        snapshot_time = start_time + timedelta(hours=i * 2)
        time_str = snapshot_time.isoformat()

        # For each location, generate trends
        for woeid, location_name in LOCATIONS.items():
            # Pick 15-20 trends per snapshot
            num_trends = random.randint(15, 20)

            # Some trends persist, some rotate out
            if not active_trends.get(woeid):
                active_trends[woeid] = random.sample(TREND_POOL, num_trends)
            else:
                # Rotate ~20% of trends each snapshot
                rotate_count = max(1, num_trends // 5)
                current = active_trends[woeid]
                available = [t for t in TREND_POOL if t not in current]

                # Remove some old trends
                if len(current) > rotate_count:
                    for _ in range(rotate_count):
                        current.pop(random.randint(0, len(current) - 1))

                # Add some new ones
                new_trends = random.sample(available, min(rotate_count + 1, len(available)))
                current.extend(new_trends)
                active_trends[woeid] = current[:num_trends]

            # Generate volume data with realistic patterns
            for rank, (trend_name, category) in enumerate(active_trends[woeid], 1):
                # Base volume varies by category
                base_volumes = {
                    "sports": 150000,
                    "tech": 200000,
                    "politics": 180000,
                    "news": 250000,
                    "entertainment": 300000,
                    "finance": 100000,
                    "health": 80000,
                    "science": 60000,
                    "lifestyle": 90000,
                    "games": 70000,
                    "meta": 50000,
                    "memorial": 400000,
                }

                base = base_volumes.get(category, 100000)

                # Add randomness: volume fluctuates ±60%
                volume = int(base * random.uniform(0.4, 2.5))

                # Higher-ranked trends get more volume
                volume = int(volume * (1 + (num_trends - rank) * 0.1))

                # Time-of-day factor (more activity in US evening hours)
                hour = snapshot_time.hour
                if 18 <= hour <= 23 or 0 <= hour <= 2:
                    volume = int(volume * 1.4)
                elif 6 <= hour <= 10:
                    volume = int(volume * 0.7)

                c.execute(
                    "INSERT INTO snapshots (fetched_at, woeid, location_name, trend_name, tweet_count, rank) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (time_str, woeid, location_name, trend_name, volume, rank),
                )

        if (i + 1) % snapshots_per_day == 0:
            day_num = (i + 1) // snapshots_per_day
            print(f"  ✓ Day {day_num} complete ({snapshots_per_day} snapshots)")

    conn.commit()
    conn.close()

    total_records = total_snapshots * len(LOCATIONS) * 17  # ~avg trends per snapshot
    print(f"\n  Done. ~{total_records:,} records generated.")
    print(f"  DB: {DB_PATH}")
    print(f"\n  Test it:")
    print(f"    python collector.py --view")
    print(f"    python collector.py --export")
    print(f"    python collector.py --stats\n")


def reset_db():
    """Wipe the database for a fresh start."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print("  Database wiped.")
    init_db()
    print("  Fresh database created.")


def main():
    parser = argparse.ArgumentParser(description="Trndex Mock Data Generator")
    parser.add_argument("--days", type=int, default=1, help="Number of days of data to generate (default: 1)")
    parser.add_argument("--reset", action="store_true", help="Wipe database before generating")

    args = parser.parse_args()

    if args.reset:
        reset_db()
    else:
        init_db()

    generate_snapshots(args.days)


if __name__ == "__main__":
    main()
