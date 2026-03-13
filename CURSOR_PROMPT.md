# Trndex — Cursor Build Prompt

## What We're Building

Trndex (trndex.live) is a stock-exchange-style dashboard that visualizes X/Twitter trending topics in real-time with momentum signals and a Conversation Velocity index called "Trend Pulse." No accounts, no auth — it's a public dashboard. Think CNN Fear & Greed Index meets a stock ticker, but for internet culture.

---

## Stack

- **Framework:** Next.js 14+ (App Router)
- **Database:** Neon Postgres (serverless, connection via `@neondatabase/serverless`)
- **Frontend:** React + Tailwind CSS
- **Hosting:** Cloudflare Pages or Vercel (decide at deploy time)
- **Data collection:** Python script runs as external cron job (not part of the Next.js app)
- **Fonts:** JetBrains Mono (data/numbers), Space Grotesk (trend names/headings)
- **No auth. No accounts. No cookies. Pure public dashboard.**

---

## Database Schema (Neon Postgres)

```sql
CREATE TABLE snapshots (
    id SERIAL PRIMARY KEY,
    fetched_at TIMESTAMPTZ NOT NULL,
    woeid INTEGER NOT NULL,
    location_name TEXT NOT NULL,
    trend_name TEXT NOT NULL,
    tweet_count INTEGER DEFAULT 0,
    rank INTEGER DEFAULT 0
);

CREATE INDEX idx_snapshots_trend ON snapshots(trend_name, woeid, fetched_at);
CREATE INDEX idx_snapshots_time ON snapshots(fetched_at DESC);
CREATE INDEX idx_snapshots_woeid_time ON snapshots(woeid, fetched_at DESC);
```

The Python collector populates this table every ~2 hours by polling X's API. The Next.js app only READS from this table.

---

## Pages & Routes

### `/ ` — Main Dashboard (only page)

Single page app. No routing complexity. The entire product is one screen.

**Layout (top to bottom):**

1. **Ticker Tape** — Horizontal scrolling bar showing all trends with green/red delta percentages. CSS animation, infinite scroll. Runs across the very top like a stock exchange.

2. **Header Bar** — "TRNDEX" wordmark (JetBrains Mono, 800 weight), LIVE badge with pulsing green dot, current time (updating every second), date + "US MARKET" label.

3. **Hero Section** — Three cards side by side:
   - **Trend Pulse Gauge** — SVG semicircle gauge (0-100) showing conversation velocity. Color gradient from red (0) through yellow (50) to green (100). Needle points to current score. Labels: DEAD (0-19), COOLING (20-39), NEUTRAL (40-59), BULLISH (60-79), SURGING (80-100). Below the gauge: label badge in the matching color.
   - **Top Gainer Card** — Trend name, delta percentage in large green type, category badge, volume.
   - **Top Loser Card** — Same layout but red.
   - **Market Stats Card** — Key-value pairs: Total Volume, Gainers count, Losers count, New Entries count.

4. **Sort + Filter Bar** — Sort buttons: RANK, VOL, MOVERS, GAINERS, LOSERS. Category filter pills: ALL, TECH, POLITICS, SPORTS, CRYPTO, CULTURE, FINANCE, NEWS, ENTERTAINMENT, SCIENCE, GAMES, HEALTH. Active state has subtle colored background matching category.

5. **Column Headers** — Sticky header: #, TREND, 12H (sparkline), VOL, Δ%

6. **Trend Rows** — One row per trend. Grid layout:
   - Rank number (muted, monospace)
   - Trend name (Space Grotesk 600) + category badge (tiny, colored) + NEW badge if applicable
   - Sparkline SVG (last ~12 hours of volume data, green if up, red if down)
   - Volume (formatted: 487K, 1.2M etc)
   - Delta percentage in colored pill (green background for +, red for -)
   - Hover state: subtle background highlight

7. **Footer** — "TRNDEX.LIVE · REFRESHED EVERY 2H" left, tracking count + up/down count right.

---

## API Routes

### `GET /api/trends?woeid=23424977`

Returns the full dashboard payload. Called on page load + client-side polling every 5 minutes (to catch new snapshots without requiring a page refresh).

**Response shape:**
```json
{
  "meta": {
    "current_snapshot": "2026-03-13T14:00:00+00:00",
    "previous_snapshot": "2026-03-13T12:00:00+00:00",
    "location_woeid": 23424977,
    "location_name": "United States"
  },
  "pulse": {
    "score": 72,
    "label": "BULLISH",
    "color": "#69F0AE",
    "current_vol": 4850000,
    "avg_vol": 3200000,
    "pct_deviation": 51.6,
    "snapshots_in_window": 12,
    "window_hours": 24
  },
  "trends": [
    {
      "trend_name": "#AI",
      "rank": 1,
      "tweet_count": 487200,
      "prev_count": 312000,
      "delta_pct": 56.2,
      "direction": "up",
      "is_new": false,
      "sparkline": [312000, 335000, 360000, 398000, 420000, 487200]
    }
  ]
}
```

**Query logic (pseudo-code):**

```
1. Get two most recent DISTINCT fetched_at values for given woeid
2. For each trend in current snapshot:
   - Find same trend in previous snapshot
   - Compute delta_pct = (current - previous) / previous * 100
   - Mark is_new if trend wasn't in previous snapshot
   - Direction: up/down/flat based on delta
3. Compute Pulse:
   - Sum tweet_count for current snapshot = current_vol
   - Get all snapshot totals in last 24h window (excluding current)
   - avg_vol = mean of those totals
   - pct_deviation = (current_vol - avg_vol) / avg_vol * 100
   - score = clamp(50 + (pct_deviation / 50) * 50, 0, 100)
   - Label based on score thresholds
4. Sparkline: get last 6 snapshot volumes for each trend
5. Return JSON
```

**Caching:** Set `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` — data only updates every 2 hours so aggressive caching is fine. The client polls every 5 minutes but will get cached responses most of the time.

### `GET /api/pulse?woeid=23424977`

Lightweight endpoint returning just the Pulse score. Useful for embedding, future API consumers, or a minimal widget.

---

## Design System

### Colors
```
Background:        #07070C (near-black with blue undertone)
Surface:           rgba(255,255,255,0.02) - rgba(255,255,255,0.04)
Borders:           rgba(255,255,255,0.05) - rgba(255,255,255,0.08)
Text primary:      #FFFFFF
Text secondary:    rgba(255,255,255,0.5)
Text muted:        rgba(255,255,255,0.2)

Green (up):        #00E676
Red (down):        #FF5252
Yellow (new):      #FBBF24

Category colors:
  Tech:            #A78BFA
  Politics:        #FB923C
  Sports:          #34D399
  Crypto:          #FBBF24
  Culture:         #F472B6
  Finance:         #60A5FA
  News:            #EF4444
  Entertainment:   #EC4899
  Science:         #22D3EE
  Games:           #A3E635
  Health:          #6EE7B7
```

### Typography
```
JetBrains Mono:    All data, numbers, labels, badges, ticker tape
Space Grotesk:     Trend names, headings
```

### Visual Rules
- Dark theme only (no light mode)
- Monospace everywhere except trend names
- Category badges: tiny, uppercase, colored text on 12% opacity background with 25% opacity border
- Delta percentages: colored pill with 8% opacity background
- Subtle row hover states
- Staggered row entrance animations (0.02s delay per row)
- Ticker tape: CSS infinite scroll animation
- LIVE badge: pulsing green glow animation
- Gauge: SVG with gradient arc from red→yellow→green
- NO emojis in the production build (the prototype uses them, replace with SVG arrows/icons)

---

## Category Detection

The X API does NOT return categories. We need to classify trends ourselves.

**Approach: keyword mapping + fallback.**

Create a mapping object of known keywords → categories. Check each trend name against the map. Anything unmatched gets "Other" or "Trending" as default category.

```javascript
const CATEGORY_MAP = {
  // Sports - teams, leagues, players, events
  "NBA": "Sports", "NFL": "Sports", "NHL": "Sports", "MLB": "Sports",
  "UFC": "Sports", "FIFA": "Sports", "Premier League": "Sports",
  "Lakers": "Sports", "Warriors": "Sports", "Yankees": "Sports",
  // ... expand with top ~200 sports terms

  // Tech
  "AI": "Tech", "ChatGPT": "Tech", "OpenAI": "Tech", "Google": "Tech",
  "Apple": "Tech", "NVIDIA": "Tech", "Tesla": "Tech", "Microsoft": "Tech",
  // ... etc

  // Crypto
  "Bitcoin": "Crypto", "BTC": "Crypto", "Ethereum": "Crypto", "ETH": "Crypto",
  "Crypto": "Crypto", "Solana": "Crypto",
  // ... etc

  // Politics
  "Congress": "Politics", "Senate": "Politics", "SCOTUS": "Politics",
  "Supreme Court": "Politics", "White House": "Politics",
  "Democrat": "Politics", "Republican": "Politics", "Election": "Politics",
  // ... etc
};
```

Check trend_name against keys (case-insensitive, partial match). This is good enough for v1. Later: use Claude API for smarter classification if needed.

---

## Sparkline Generation

For each trend in the current snapshot, query the last 6 snapshots (12 hours) of volume data:

```sql
SELECT fetched_at, tweet_count
FROM snapshots
WHERE woeid = $1
  AND trend_name = $2
  AND fetched_at >= (NOW() - INTERVAL '12 hours')
ORDER BY fetched_at ASC
```

Return as array of numbers. Frontend renders as SVG polyline. If a trend has fewer than 2 data points (it's new), skip the sparkline or show a flat line.

---

## Client-Side Behavior

- **Initial load:** Fetch `/api/trends`, render everything.
- **Polling:** Every 5 minutes, re-fetch. If data changed (new snapshot detected via `meta.current_snapshot`), animate the update. If same snapshot, do nothing.
- **Clock:** Update time display every second (client-side `setInterval`).
- **Sort/Filter:** Client-side only. No API calls. Just re-sort/filter the already-fetched trends array.
- **Responsive:** Single column on mobile. Ticker tape still scrolls. Hero section stacks vertically. Trend rows hide sparkline column on small screens.

---

## SEO / Meta

```html
<title>TRNDEX — The Trend Exchange</title>
<meta name="description" content="Real-time stock exchange for internet culture. See what's trending, what's surging, what's crashing." />
<meta property="og:title" content="TRNDEX — The Trend Exchange" />
<meta property="og:description" content="Real-time momentum signals for X/Twitter trends." />
<meta property="og:image" content="/og-image.png" />
<meta property="og:url" content="https://trndex.live" />
<meta name="twitter:card" content="summary_large_image" />
```

The OG image should be a static rendering of the dashboard — or better, dynamically generated showing the current Pulse score. This is a stretch goal.

---

## Environment Variables

```
DATABASE_URL=postgres://...@....neon.tech/trndex    # Neon connection string
```

That's it. No API keys in the Next.js app. The X API bearer token lives only in the Python collector's environment, which runs separately.

---

## What NOT to Build

- No accounts / auth / login
- No cookies / tracking / analytics (maybe add Plausible later)
- No dark/light mode toggle (dark only)
- No notifications / alerts (phase 2)
- No comments / social features
- No mobile app
- No server-side rendering complexity — this is essentially a static page that fetches JSON

---

## Python Collector (Reference — runs separately)

The collector (`collector.py`) runs as a standalone cron job, NOT inside Next.js.

In production it needs to be adapted to write to Neon Postgres instead of SQLite:
- Replace `sqlite3` with `psycopg2` or `asyncpg`
- Same schema, same logic, different driver
- Deploy on: Railway cron, Render cron, any cheap VPS with crontab, or a Cloudflare Worker on a schedule

The collector's `--export` command (JSON output) is for local dev only. In production, the Next.js API route queries Neon directly.

---

## Launch Checklist

- [ ] Neon database created, schema applied
- [ ] Collector adapted for Postgres, deployed as cron
- [ ] Collector running for 24+ hours (need data for Pulse baseline)
- [ ] Next.js app deployed to Cloudflare/Vercel
- [ ] Domain trndex.live pointed at deployment
- [ ] OG image created
- [ ] Test: does the screenshot look good when shared on X?
- [ ] First post on X from personal account with screenshot
