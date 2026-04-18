# StockPulse — Ghost Strategies Stock Analysis Terminal

A professional Bloomberg-style stock analysis dashboard for Ghost Strategies. The landing page opens directly to a live market overview — indices, scrolling ticker tape, top movers, sector heat map, and market news — with no ticker required. Search any US equity or click any index card for real-time quotes, an interactive advanced chart, technical indicators, fundamental data, earnings history, and analyst consensus, all in a dark finance-grade terminal UI.

**Live site:** https://stockpulse-theta-nine.vercel.app/

**API keys are entered directly in the app via the Settings button — no environment variables, no rebuilds, no deployment config required.**

---

## What's on the Landing Page (Bloomberg-Style Market Overview)

| Section | Description |
|---|---|
| **Scrolling Ticker Tape** | Continuous horizontal scroll — S&P 500, NASDAQ, DOW, Russell 2K, VIX, Gold, Silver, WTI Crude, Brent Crude, Bitcoin, EUR/USD, GBP/USD, USD/JPY, 2Y Treasury, 5Y Treasury, 10Y Treasury |
| **Market Status Badge** | Live pulsing dot (green = open, gray = closed) with real-time clock |
| **Market Indices Grid** | 16 clickable cards — SPY, QQQ, DIA, IWM, VIX, GLD, SLV, USO, BNO, SHY, IEI, TLT, X:BTCUSD, C:EURUSD, C:GBPUSD, C:USDJPY — price, change, and % change with color-coded borders. Refreshes every 60 seconds. **Click any card to open the full chart and analysis for that symbol.** |
| **Top Movers** | Biggest gainers and losers with volume. Toggle GAINERS / LOSERS. Click any name to open full analysis. Volume sourced from Polygon /prev when FMP returns 0. |
| **Sector Heat Map** | All 11 SPDR sector ETFs — color-coded tiles scaled by % move |
| **Market News** | Live general market headlines — Marketaux (sentiment) → Polygon → Finnhub fallback, last 14 days |
| **Quick Access** | One-click buttons for major stocks (AAPL, NVDA, MSFT, TSLA, GOOGL, AMZN, META, AMD, JPM, SPY) |

> **Market Overview data routing:** When your FMP key is set, Market Indices, Top Movers, and Sector Performance all load via a single FMP batch quote call (`/stable/quote?symbol=...`) — one round trip for all symbols. Finnhub is kept as a fallback if FMP is unavailable.

---

## Ticker Analysis Panels (after clicking any stock or index)

| Panel | Source | Description |
|---|---|---|
| **Quote Header** | Finnhub → FMP (Schwab optional) | Real-time price with full OHLCV, prev close, market cap, change %. Polygon /prev used for reliable volume. Auto-refreshes every 15s. Source badge shows which API provided the price. |
| **AdvancedChart** | Polygon | Interactive chart built on lightweight-charts v5. See full feature list below. |
| **Technical Indicators** | Polygon | RSI(14) gauge, MACD(12/26/9) histogram, SMA 50/200 with golden/death cross signal, Bollinger Bands(20, 2σ) — all computed from Polygon daily bars using rolling calculations. No Alpha Vantage key required. |
| **Fundamentals** | FMP | Valuation tab (P/E, P/B, P/S, EV/EBITDA, ROE, ROA, margins), Financials tab (4-year revenue/net income bar chart), Profile tab (sector, industry, CEO, description) |
| **News Feed** | Marketaux → Polygon → Finnhub | Latest headlines filtered by ticker, with sentiment scores where available |
| **Earnings Panel** | Finnhub | Past EPS with beat/miss badges, upcoming estimates, analyst Buy/Hold/Sell consensus, price targets (Schwab when connected) |

A **← Market Overview** link at the top of every ticker view returns to the landing page.

### AdvancedChart Features (lightweight-charts v5)

- **Chart types:** Candlestick, Heikin Ashi, Area, Line
- **Time ranges:** 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, MAX, and a custom date picker
- **Volume sub-pane:** Always visible, color-coded green/red by price direction
- **Indicator overlays:** Bollinger Bands (upper/lower bands), SMA 50 (amber), SMA 200 (pink)
- **Indicator sub-panes:** RSI(14) in violet, MACD with sky/orange histogram
- **Toggle buttons** for each indicator, legend row showing live values
- **Dark/light theme** auto-detection

---

## API Keys — Settings Modal

Click the **⚙ Settings** button in the top navigation bar to open the API key manager.

### How it works
- **Paste your key** into the input field (masked by default — click the eye icon to reveal)
- **Test API** — pings the live API instantly:
  - ✅ Green: key is valid, shows a live data sample (e.g. `✓ AAPL $201.68`)
  - ❌ Red: shows the exact error returned by the API
- **Remove Key** — clears your custom key and reverts to the built-in default (Finnhub and Polygon only)
- **Save & Close** — writes keys to browser localStorage, shows a confirmation banner, reloads the page

### Key storage
Keys live in **your browser's localStorage only**. They are never committed to code, never in a ZIP, and never sent to GitHub or Vercel. They go directly from your browser to the respective API when fetching data.

### API keys reference

| API | Purpose | Free Tier | Default Key Built-in? | Sign Up |
|---|---|---|---|---|
| **Finnhub** | Real-time quotes, earnings, news, analyst consensus | 60 calls/min | ✅ Yes | https://finnhub.io/register |
| **Polygon** | Price chart (OHLCV), RSI/SMA/BB/MACD calculations, prev-day data, indices | Unlimited delayed bars | ✅ Yes | https://polygon.io/dashboard/signup |
| **FMP** | Fundamentals, batch quotes for indices/movers/sectors, VIX | 250 req/day (free); paid recommended | ❌ Enter your own | https://site.financialmodelingprep.com/register |
| **Marketaux** | Stock news with sentiment scores | 100 req/day (free) | ❌ Enter your own | https://www.marketaux.com/register |
| **Alpha Vantage** | Kept in Settings for future use — **not used for any indicators** | — | ❌ Not needed | https://www.alphavantage.co/support/#api-key |

> **Recommendation:** Enter your FMP key first — it powers the entire Market Overview (indices, movers, sectors) with a single batch call and provides full fundamental data. Finnhub and Polygon have built-in default keys so the chart and indicators work immediately. Alpha Vantage is optional and not required for any current feature.

---

## Data Sources & Routing

| Data | Primary Source | Fallback |
|---|---|---|
| Market indices / movers / sectors | FMP batch (`/stable/quote`) | Finnhub sequential |
| Market news | Marketaux (sentiment) | Polygon → Finnhub |
| Real-time quote price | Finnhub → FMP | Schwab (optional) |
| Quote OHLCV / prev close | Finnhub → FMP | Polygon /prev for volume |
| Interactive price chart | Polygon daily bars (lightweight-charts v5) | — |
| Technical indicators (RSI, MACD, SMA, Bollinger) | Polygon daily bars — rolling calculations | — (shows "—" if Polygon unavailable) |
| Fundamentals (valuation, income, profile) | FMP `/stable/` endpoints | — (shows prompt to add key) |
| Earnings history + estimates | Finnhub | — |
| Analyst Buy/Hold/Sell consensus | Finnhub | — |
| Analyst price targets | Schwab (when connected) | Shows `—` |

### Polygon request stagger (to avoid rate limits)

When a stock is selected, Polygon requests are staggered to respect rate limits:

| Hook | Delay |
|---|---|
| useAggregates (chart bars) | 0 ms |
| usePrevDayOHLCV | 0 ms |
| usePolyBars (RSI / SMA / Bollinger) | 800 ms |
| useMacd | 2000 ms — clears the 16-request index burst window |

All results are cached for 1 hour. Retries: 3 attempts with exponential backoff (1s → 2s → 4s). The stagger only applies on the first load per ticker per session.

### FMP API endpoints used

All FMP calls use the current `/stable/` path (not legacy `/api/v3/`):

| Endpoint | Data |
|---|---|
| `/stable/quote?symbol=...` | Full quote with OHLCV, market cap, change % |
| `/stable/quote-short?symbol=...` | Lightweight price + volume (Settings test) |
| `/stable/income-statement?symbol=...&period=annual&limit=4` | 4-year income statement |
| `/stable/key-metrics-ttm?symbol=...` | ROE, ROA, ROIC, EV/EBITDA, current ratio |
| `/stable/ratios-ttm?symbol=...` | P/E, P/B, P/S, margins, dividend yield, FCF/share |
| `/stable/profile?symbol=...` | Sector, industry, CEO, employees, description |

---

## API Health Indicator

The top nav bar shows a live status dot next to the settings button:

- 🟡 Pulsing — checking connectivity
- 🟢 Green — all active APIs responding
- 🔴 Red — one or more APIs returning errors

Hover the dot to see per-API latency, last-success timestamp, and specific error messages. Finnhub and Polygon always check (they have built-in default keys). FMP and Marketaux only check when you've entered a key — otherwise they show "Add key in Settings" in gray. Refreshes every 60 seconds with a "Refresh now" link.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui
- **Charts:** lightweight-charts v5.1.0 (AdvancedChart), Recharts (indicators / fundamentals)
- **Data layer:** TanStack Query v5 (caching, retries, staggered fetching)
- **Serverless backend:** Vercel Functions (Node.js) — handles Schwab OAuth only
- **Data APIs:** Finnhub, Polygon, FMP, Marketaux, Schwab (optional)

---

## Quick Start — Run Locally

> **Windows users:** Always use **Command Prompt (cmd)** — not PowerShell — for all commands below. The `package.json` scripts use `cross-env` to handle environment variables on Windows.

### Step 1: Install Node.js
Download and install from [nodejs.org](https://nodejs.org) (LTS version recommended).
Verify installation:
```cmd
node --version
```
Should show v20 or higher (the project has been tested on v24).

### Step 2: Navigate to the project folder
Press `Win + R`, type `cmd`, press Enter. Then:
```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
```

### Step 3: Install dependencies
```cmd
npm install
```
This installs all packages. Wait until the cursor returns.

### Step 4: Start the dev server
```cmd
npm run dev
```
Open [http://localhost:5000](http://localhost:5000) in your browser. The Market Overview loads immediately.

### Step 5: Enter your API keys
Click **⚙ Settings** in the top nav bar. The built-in Finnhub and Polygon keys are already active — the chart and technical indicators work right away. To unlock the full experience:

1. Enter your **FMP key** first — powers Market Overview indices, movers, sectors, and all fundamental data
2. Enter your **Marketaux key** — adds sentiment-tagged news
3. Click **Test API** for each key
4. Click **Save & Close** — the page reloads with live data

> No `.env` file is needed for local development. The Settings modal handles all keys.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `'NODE_ENV' is not recognized` | You're in PowerShell. Close it, open **Command Prompt (cmd)**, run `npm run dev` again. |
| `npm: command not found` | Node.js not installed or not in PATH. Reinstall from [nodejs.org](https://nodejs.org). |
| `ENOTSUP: operation not supported on socket` | Node.js version issue. Upgrade to Node v20+ from [nodejs.org](https://nodejs.org). |
| Market Overview stuck on "Loading market data…" | Enter your FMP key in Settings — Market Overview uses FMP batch quotes. Without it, it falls back to Finnhub which rate-limits quickly on the shared default key. |
| OHLC shows `$—` (Open, High, Low blank) | Enter your FMP key — full OHLC comes from FMP's `/stable/quote` endpoint. |
| Technical indicators show "retrying…" | Polygon rate limit. The app waits ~800ms then retries automatically — this resolves on its own within a few seconds. |
| MACD takes ~2 seconds longer than RSI/BB to appear | This is by design. MACD is delayed 2000ms to clear the 16-request index burst window and avoid Polygon rate limiting. |
| Volume shows `—` | Should be resolved — volume is enriched via Polygon /prev when FMP returns 0. If still showing, check your Polygon key in Settings. |
| Chart blank on first click from index card | Should be resolved. Index cards now correctly pass the symbol to the chart. |
| Price shows amber "Live quote unavailable" warning | Finnhub returned a zero quote (rate limited on shared key). Enter your own Finnhub key in Settings, or the FMP fallback kicks in automatically if your FMP key is set. |
| Keys disappear after clearing browser data | Keys live in localStorage — re-enter them in Settings. |
| Schwab shows "token expired" | Schwab refresh tokens expire every 7 days. Click **Connect Schwab** and log in again. |
| FMP Test API shows "Legacy Endpoint" error | Ensure the app is up to date — all FMP calls use `/stable/` paths, not `/api/v3/`. |

---

## Deploy to Vercel

See `DEPLOY_FROM_SCRATCH.md` for the full step-by-step guide.

**Summary:**
1. Navigate to the project folder and run `npm install`
2. Push to GitHub (see `GITHUB_PUSH_INSTRUCTIONS.md`)
3. Import the repo in Vercel → it auto-deploys
4. Open your live URL (https://stockpulse-theta-nine.vercel.app/) → click **⚙ Settings** → enter API keys → **Save & Close**
5. Done — no Vercel environment variables are needed for FMP, Finnhub, Polygon, or Marketaux

> Schwab integration requires Vercel environment variables (`SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_REDIRECT_URI`). See `DEPLOY_FROM_SCRATCH.md` for setup.

---

## Schwab Integration (Optional)

Schwab provides true real-time quotes and analyst price targets. Requires a Vercel deployment (not available locally).

### Setup
1. Register at [developer.schwab.com](https://developer.schwab.com) and create an app
2. In Vercel → your project → **Settings** → **Environment Variables**, add:

| Variable | Where to find it |
|---|---|
| `SCHWAB_CLIENT_ID` | developer.schwab.com → Your App → "App Key" |
| `SCHWAB_CLIENT_SECRET` | developer.schwab.com → Your App → "App Secret" |
| `SCHWAB_REDIRECT_URI` | `https://stockpulse-theta-nine.vercel.app/api/auth/callback` |

3. Add the same redirect URI in your Schwab Developer Portal app settings
4. Redeploy → click **Connect Schwab** in the nav bar → log in

### Token lifecycle
| Token | Expires | Behavior |
|---|---|---|
| Access token | 30 min | Auto-refreshed silently |
| Refresh token | 7 days | Click "Connect Schwab" again to re-authenticate |

---

## Project Structure

```
stockpulse/
├── .github/
│   └── workflows/
│       └── deploy.yml              ← GitHub Actions auto-deploy to Vercel on push
├── api/                            ← Vercel serverless functions (Schwab OAuth only)
│   ├── _schwabAuth.js
│   ├── auth/
│   │   ├── login.js                ← GET /api/auth/login
│   │   ├── callback.js             ← GET /api/auth/callback
│   │   ├── status.js               ← GET /api/auth/status
│   │   └── logout.js               ← GET /api/auth/logout
│   ├── quotes.js                   ← GET /api/quotes?symbol=NVDA
│   ├── pricehistory.js             ← GET /api/pricehistory
│   └── instruments.js              ← GET /api/instruments (price targets)
├── client/
│   └── src/
│       ├── components/
│       │   ├── AdvancedChart.tsx       ← Interactive chart (lightweight-charts v5)
│       │   ├── ApiHealthIndicator.tsx  ← Live per-API status dot in nav bar
│       │   ├── EarningsPanel.tsx       ← EPS history, estimates, analyst consensus
│       │   ├── FundamentalsPanel.tsx   ← FMP valuation / income / profile tabs
│       │   ├── MarketOverview.tsx      ← Landing page — 16-symbol indices, clickable cards
│       │   ├── NewsPanel.tsx           ← Marketaux → Polygon → Finnhub news feed
│       │   ├── QuoteHeader.tsx         ← Price, OHLCV, prev close, market cap
│       │   ├── SettingsModal.tsx       ← API key manager (test/save/remove)
│       │   ├── TechnicalIndicators.tsx ← RSI, MACD, SMA, BB — all from Polygon bars
│       │   └── TickerSearch.tsx
│       ├── lib/
│       │   ├── hooks.ts            ← All data hooks (Finnhub, Polygon, FMP, Marketaux, Schwab)
│       │   ├── apiKeys.ts          ← localStorage key manager
│       │   └── mockData.ts         ← Fallback data when APIs are unavailable
│       └── pages/
│           └── Dashboard.tsx       ← Main layout, routing, Settings modal wiring
├── .env.example                    ← Template showing Schwab vars only
├── .gitignore
├── vercel.json                     ← Vercel build + routing config
├── package.json
├── README.md
├── DEPLOY_FROM_SCRATCH.md          ← Full Vercel deployment guide
└── GITHUB_PUSH_INSTRUCTIONS.md    ← GitHub push guide (Windows cmd)
```

---

## Security Architecture

```
Browser  ──(fetch /api/quotes)──▶  Vercel Function  ──(Bearer token)──▶  Schwab API
                                         ▲
                                   SCHWAB_CLIENT_SECRET
                                   lives only here — never in browser
```

- **Schwab secret** never leaves Vercel's server environment
- **Tokens** stored in httpOnly cookies — unreadable by JavaScript
- **All other API keys** (Finnhub, Polygon, FMP, Marketaux) stored in browser localStorage — never in source code, never in the repository, never in Vercel environment variables
- **No secrets in the repository** — `.gitignore` covers `.env`, `dist/`, `node_modules/`

---

## License

MIT License — Ghost Strategies, LLC
