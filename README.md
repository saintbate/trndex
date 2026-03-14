# Trndex — The Trend Exchange

**trndex.live** — A stock-exchange-style visualization of X/Twitter trending topics with momentum signals and a Conversation Velocity index (Trend Pulse).

---

## What It Is

Trndex polls X's trends API on a schedule, stores timestamped snapshots, and derives signals that don't exist in the raw data: momentum (trending up/down), velocity (how loud is X right now vs baseline), and trend lifecycle tracking. The consumer-facing product is a dark, terminal-aesthetic dashboard that looks like a stock exchange for culture.

## Architecture

```
┌──────────────────┐       ┌───────────┐       ┌──────────────────┐
│  X Trends API    │──────▶│ Collector  │──────▶│   Neon Postgres  │
│  /2/trends/woeid │ poll  │ (Python)   │ store │   (snapshots)    │
└──────────────────┘ 2hr   └───────────┘       └────────┬─────────┘
                                                        │
                                                        │ query
                                                        ▼
                           ┌───────────┐       ┌──────────────────┐
                           │  Frontend  │◀──────│  JSON API route  │
                           │  Next.js   │ fetch │  (compute pulse  │
                           │  React     │       │   + momentum)    │
                           └───────────┘       └──────────────────┘
                                │
                                ▼
                        Cloudflare / Vercel
                         (edge cached)
```

## Stack

- **Data collector:** Python + requests (cron job or VPS)
- **Database:** Neon Postgres (free tier, serverless)
- **Frontend:** Next.js + React
- **Hosting:** Cloudflare Pages or Vercel
- **No auth required** — public dashboard, no accounts

## Data Source

X API v2 `GET /2/trends/by/woeid/:id`
- Returns: `trend_name` + `tweet_count` per trend (up to 20 per location)
- Pricing: Pay-per-use (launched Feb 2026), no minimum spend
- Estimated cost: ~$5-15/month for 6 locations × 12 polls/day
- Deduplication: same resource within 24hr UTC window = one charge

## Key Signals (Derived, Not From API)

### Trend Pulse (Conversation Velocity Index, 0-100)
- Compares current total tweet volume vs 24h rolling average
- 50 = normal, 80+ = surging, 20- = dead
- One number that tells the story — the CNN Fear & Greed Index for culture
- Ships day one with real data

### Momentum (Per-Trend Delta)
- Compares each trend's volume between consecutive snapshots
- Green (up), Red (down), New (just entered the board)
- Sparkline charts show 12h trajectory

### Planned Signals (Phase 2-3)
- **Trend Prediction:** Early detection of trends likely to reach top 5
- **Weekly Market Correlation:** Overlay trend data against S&P 500 / sector ETFs
- **Trend Churn Rate:** Cultural volatility meter
- **Reddit Confirmation Layer:** Cross-platform signal validation

## Tracked Locations

| Location | WOEID |
|----------|-------|
| Worldwide | 1 |
| United States | 23424977 |
| New York | 2459115 |
| Los Angeles | 2442047 |
| Chicago | 2514815 |
| Atlanta | 2357024 |

---

## Deploy to trndex.live

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for step-by-step instructions to deploy on Vercel and connect your Squarespace domain.

---

## Quick Start (Local Development)

### 1. No API key yet? Use mock data
```bash
python mock_data.py --days 3
python collector.py --view
python collector.py --pulse
python collector.py --export
```

### 2. With X API Bearer Token
```bash
export X_BEARER_TOKEN="your_token"
python collector.py --once        # single fetch
python collector.py --view        # momentum ticker
python collector.py --pulse       # pulse score only
python collector.py --loop        # every 2 hours
python collector.py --export      # JSON for frontend
```

## GitHub Actions (Collector)

The collector can run on GitHub Actions’ free tier on a schedule:

1. **Add repository secrets** (Settings → Secrets and variables → Actions):
   - `X_BEARER_TOKEN` — X API bearer token
   - `DATABASE_URL` — Neon Postgres connection string
   - `XAI_API_KEY` — Optional, for Grok volume enrichment

2. **Push the workflow** — `.github/workflows/collect-trends.yml` runs every 2 hours and on manual trigger.

3. **Manual run** — Actions → Collect Trends → Run workflow.

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `--once` | Fetch all locations once |
| `--loop` | Poll every 2 hours continuously |
| `--view` | Terminal ticker with pulse + momentum |
| `--pulse` | Standalone pulse score display |
| `--export` | Write `trndex_data.json` for frontend |
| `--stats` | Database statistics |
| `--woeid N` | Target specific location |
| `--interval N` | Custom poll interval (seconds) |

---

## File Structure

```
trndex/
├── collector.py          # Data pipeline: fetch, store, compute pulse + momentum
├── mock_data.py          # Generate fake data for UI development
├── ticker-board.jsx      # React component: stock exchange UI prototype
├── CURSOR_PROMPT.md      # Production build prompt for Cursor
└── README.md             # This file
```

---

## Roadmap

### Phase 1: Ship the Board (NOW)
- [x] Data collector with SQLite (local dev)
- [x] Mock data generator
- [x] Trend Pulse (conversation velocity)
- [x] Momentum computation (per-trend delta)
- [x] React ticker board prototype
- [ ] Migrate collector to Neon Postgres
- [ ] Next.js frontend on Cloudflare/Vercel
- [ ] Deploy collector as cron job (or use [GitHub Actions](#github-actions-collector))
- [ ] Go live at trndex.live

### Phase 2: Depth (After 2-3 Weeks of Data)
- [ ] Trend prediction heuristics
- [ ] Trend lifecycle visualization (entry → peak → decay)
- [ ] Category-level momentum (Tech sector up, Politics cooling)
- [ ] Daily/weekly historical views

### Phase 3: Correlation + API (After 4-8 Weeks)
- [ ] Weekly market correlation overlay
- [ ] Reddit as confirmation signal layer
- [ ] Public API for trend data consumers
- [ ] Premium tier: weekly digest, market correlation reports

---

## Business Model Thesis

**Phase 1:** Free public dashboard → organic distribution via screenshots on X

**Phase 2:** API product → sell historical trend data + derived signals to:
- Quant funds / alt-data shops
- Marketing agencies
- Media companies
- Prediction market platforms

**The moat:** Accumulated historical data with computed signals. X sells raw counts. Trndex sells processed intelligence with a time dimension.
