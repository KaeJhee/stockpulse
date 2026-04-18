# StockPulse — Deploy From Scratch
## Complete step-by-step guide for Windows

This is the definitive deployment guide. Follow every step in order.

---

## PART A — Set up your local folder

### Step 1 — Extract the ZIP

1. Download `stockpulse.zip`
2. Right-click it → **Extract All**
3. Extract to:
   ```
   C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\
   ```
4. You should now have:
   ```
   C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse\
   ```

---

### Step 2 — Install Node.js (if not already)

1. Go to https://nodejs.org
2. Click the big green **LTS** button → download and run the installer
3. Click Next through everything, keep all defaults
4. Open **Command Prompt** (search "cmd" in Start menu — NOT PowerShell) and verify:
   ```cmd
   node --version
   ```
   You should see `v20.x.x` or higher. (The project has been tested on v24.)

---

### Step 3 — Install project dependencies

In cmd, run:
```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
npm install
```

Wait for it to finish (lots of text is normal). Done when the cursor comes back.

---

## PART B — Deploy to Vercel

### Step 4 — Install Vercel CLI

```cmd
npm install -g vercel
```

Verify:
```cmd
vercel --version
```
Should show a version number like `39.x.x`.

---

### Step 5 — Log in to Vercel

```cmd
vercel login
```

- Choose **Continue with GitHub** (arrow keys to select, Enter to confirm)
- A browser window opens — click **Confirm**
- Back in cmd it will say "Logged in as [your email]"

---

### Step 6 — Deploy

```cmd
vercel --prod
```

Answer the prompts exactly like this:

| Question | Answer |
|---|---|
| Set up and deploy? | `y` → Enter |
| Which scope? | Your account → Enter |
| Link to existing project? | `n` → Enter |
| Project name? | `stockpulse` → Enter |
| Directory? | Just press Enter (uses `./`) |
| Override settings? | `n` → Enter |

After ~60 seconds you'll see:
```
✅  Production: https://stockpulse-theta-nine.vercel.app
```

Your live site is at: **https://stockpulse-theta-nine.vercel.app/**

---

### Step 7 — Enter your API keys in the app

This is all you need to do to get live data working. No environment variables are required for data APIs.

1. Open https://stockpulse-theta-nine.vercel.app/ in a browser
2. Click **Settings** in the top navigation bar
3. **FMP (Financial Modeling Prep) — most important:**
   - Paste your FMP key
   - Click **Test API** — green banner confirms it works
   - FMP powers the Market Overview indices, top movers, sector heat map, and all fundamental data
4. **Finnhub:**
   - A default key is built in, but enter your own for best reliability
   - Click **Test API** — you should see a green banner: `✓ AAPL $xxx.xx`
5. **Polygon:**
   - A default key is built in, but enter your own for best reliability
   - Click **Test API** — green banner confirms it works
   - Polygon powers the chart, RSI, SMA, Bollinger Bands, and MACD — all computed from daily bars
6. **Marketaux (optional):**
   - Powers the news feed with sentiment scores
   - Click **Test API** to confirm
7. **Alpha Vantage:** Not needed — leave blank. AV is not used for any indicators.
8. Click **Save & Close**
9. The page reloads automatically with live data

> Keys are saved in your browser only. They never touch your code, GitHub, or Vercel.

**Where to get keys:**
- FMP (paid subscription recommended): https://site.financialmodelingprep.com/register
- Finnhub (free): https://finnhub.io/register
- Polygon (free): https://polygon.io/dashboard/signup
- Marketaux (free tier available): https://www.marketaux.com/register

---

## PART C — Push to GitHub

### Step 8 — Install Git (if not already)

Check:
```cmd
git --version
```
If you see a version number, skip to Step 9.

If not: download from https://git-scm.com/download/win, run the installer, restart cmd.

---

### Step 9 — Connect your folder to GitHub

Your repo is at https://github.com/KaeJhee/stockpulse

```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
git init
git branch -M main
git remote remove origin
git remote add origin https://github.com/KaeJhee/stockpulse.git
```

---

### Step 10 — Create a Personal Access Token on GitHub

You need this to push. GitHub doesn't accept your account password.

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**
3. Name: `stockpulse`
4. Expiration: **No expiration** (or 90 days)
5. Check the **repo** checkbox (checks all sub-items)
6. Click **Generate token**
7. **Copy it immediately** — it starts with `ghp_` and you won't see it again

---

### Step 11 — Push your code

```cmd
git add .
git commit -m "Initial StockPulse deployment"
git push -f origin main
```

When prompted:
- Username: `KaeJhee`
- Password: paste your `ghp_` token (not your GitHub password)

---

### Step 12 — Connect GitHub to Vercel for auto-deploys (recommended)

Once connected, every push to GitHub automatically redeploys your Vercel site.

1. Go to https://vercel.com/dashboard
2. Click your **stockpulse** project → **Settings** → **Git**
3. Click **Connect Git Repository** → GitHub → find `KaeJhee/stockpulse` → **Connect**

From now on: push to GitHub → Vercel rebuilds in ~60 seconds automatically.

> Once you connect GitHub directly to Vercel, the `.github/workflows/deploy.yml` GitHub Actions workflow is redundant. You can delete it to keep things simple, or leave it in place — it won't cause problems.

---

## PART D — Optional: Schwab Integration

Schwab adds true real-time quotes and analyst price targets. Everything else works without it.

1. Register at https://developer.schwab.com and create an app
2. Go to your Vercel project → **Settings** → **Environment Variables**
3. Add these three variables:

| Name | Value |
|---|---|
| `SCHWAB_CLIENT_ID` | Your app's "App Key" from Schwab |
| `SCHWAB_CLIENT_SECRET` | Your app's "App Secret" from Schwab |
| `SCHWAB_REDIRECT_URI` | `https://stockpulse-theta-nine.vercel.app/api/auth/callback` |

4. In the Schwab Developer Portal, add that same redirect URI to your app
5. Redeploy (push any small change to GitHub, or click Redeploy in Vercel)
6. Open your site → click **Connect Schwab** in the nav bar → log in

---

## Troubleshooting

**"vercel: command not found"**
→ Close cmd and reopen after installing. If still not found, try: `npx vercel --prod`

**"npm: command not found"**
→ Node.js is not installed. Go back to Step 2.

**"Permission denied" or scripts are blocked**
→ You're in PowerShell. Close it and open **Command Prompt (cmd)** instead — search "cmd" in Start menu.

**Data shows "Loading market data..." forever after deploying**
→ You haven't entered your API keys yet. Click **Settings** in the nav bar and paste your keys. FMP is the most important — it powers the Market Overview.

**Technical indicators show "retrying..."**
→ Polygon rate limit. The app staggers requests automatically and retries — wait a few seconds, it resolves on its own.

**MACD takes ~2 seconds longer than RSI/BB to appear**
→ This is by design. MACD is delayed 2000ms to clear the 16-request index burst window and avoid Polygon rate limiting.

**Volume shows `—` on a stock**
→ The app enriches volume via Polygon /prev when FMP returns 0. If it still shows `—`, check your Polygon key in Settings.

**"Authentication failed" when pushing to GitHub**
→ Use your Personal Access Token (starts with `ghp_`) as the password, not your GitHub account password.

**"Updates were rejected (non-fast-forward)"**
→ Run `git push -f origin main` (the `-f` forces it through)

**Schwab "Connect" button not working**
→ Make sure `SCHWAB_REDIRECT_URI` in Vercel matches exactly what's in your Schwab app — even a trailing slash difference will break it.

**Schwab shows "token expired"**
→ Schwab refresh tokens expire every 7 days (Schwab's policy). Click **Connect Schwab** and log in again.
