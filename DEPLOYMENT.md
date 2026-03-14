# Deploy Trndex to trndex.live

## 1. Deploy to Vercel

1. **Push your code to GitHub** (if not already):
   ```bash
   git push origin main
   ```

2. **Import the project on Vercel:**
   - Go to [vercel.com](https://vercel.com) and sign in (GitHub)
   - Click **Add New** → **Project**
   - Import `saintbate/trndex` (or your repo)
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./` (default)

3. **Add environment variables** (Settings → Environment Variables):
   | Name | Value | Notes |
   |------|-------|-------|
   | `DATABASE_URL` | `postgresql://...@....neon.tech/neondb?sslmode=require` | From Neon dashboard |
   | `XAI_API_KEY` | Your xAI API key | For Grok trend context on click |

   Add these for **Production**, **Preview**, and **Development** if you use preview deploys.

4. **Deploy** — Vercel builds and deploys automatically. You’ll get a URL like `trndex-xxx.vercel.app`.

---

## 2. Connect Your Domain (Squarespace → Vercel)

You bought **trndex.live** on Squarespace. Point it to Vercel:

### Option A: Use Vercel DNS (recommended)

1. In Vercel: **Project Settings** → **Domains** → **Add** → `trndex.live`
2. Vercel shows nameservers (e.g. `ns1.vercel-dns.com`, `ns2.vercel-dns.com`)
3. In **Squarespace** → **Settings** → **Domains** → **trndex.live** → **DNS Settings** (or **Use Custom Nameservers**)
4. Replace Squarespace nameservers with Vercel’s
5. Wait for propagation (up to 48 hours, often minutes)

### Option B: Keep Squarespace DNS

1. In Vercel: **Project Settings** → **Domains** → **Add** → `trndex.live`
2. Vercel shows a **CNAME** target (e.g. `cname.vercel-dns.com`)
3. In **Squarespace** → **Settings** → **Domains** → **trndex.live** → **DNS Settings** → **Custom Records**
4. Add:
   - **Type:** CNAME  
   - **Host:** `@` (or leave blank for root)  
   - **Data:** `cname.vercel-dns.com`

   **Note:** Some registrars don’t allow CNAME on root (`@`). If so, use:
   - **Host:** `www`  
   - **Data:** `cname.vercel-dns.com`  
   Then in Vercel, add both `trndex.live` and `www.trndex.live` and set one as primary.

5. For root `trndex.live`, Squarespace may require an **A record** instead:
   - **Type:** A  
   - **Host:** `@`  
   - **Data:** `76.76.21.21` (Vercel’s IP for root domains)

6. Wait for DNS propagation.

---

## 3. Verify

- Visit **https://trndex.live** — dashboard should load
- Check **https://trndex.live/api/trends?woeid=23424977** — JSON response
- Click a trend row — Grok context should load (if `XAI_API_KEY` is set)

---

## 4. What’s Already Running

- **Collector:** GitHub Actions runs every 2 hours (cron)
- **Database:** Neon Postgres (same `DATABASE_URL` for app and collector)
- **Secrets:** `X_BEARER_TOKEN`, `DATABASE_URL`, `XAI_API_KEY` in GitHub repo secrets for the collector

The Vercel app only needs `DATABASE_URL` and `XAI_API_KEY`; it does not use `X_BEARER_TOKEN` (that’s for the collector).
