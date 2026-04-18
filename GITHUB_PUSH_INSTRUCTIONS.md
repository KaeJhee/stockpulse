# GitHub Push Instructions
## Ghost Strategies StockPulse — Stock Analysis Terminal

This guide covers pushing the StockPulse project to GitHub and keeping it up to date. All commands are for **Command Prompt (cmd)** on Windows — do not use PowerShell.

**GitHub repo:** https://github.com/KaeJhee/stockpulse
**Local path:** `C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse`

---

# PART 1 — First-Time Setup

Use this section once, the first time you push to GitHub.

---

## Step 1: Prerequisites

### Git
Check if Git is installed:
```cmd
git --version
```
If you see a version number, skip ahead. If not, download from https://git-scm.com/download/win and run the installer (click Next through all defaults). Restart cmd after installing.

### Git identity (one-time setup)
```cmd
git config --global user.name "Kris"
git config --global user.email "kris@ghoststrategies.io"
```

### GitHub Personal Access Token
GitHub requires a token instead of your account password for command-line pushes.

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**
3. Fill in:
   - **Note:** `stockpulse`
   - **Expiration:** No expiration (or 90 days)
   - **Scopes:** check the `repo` checkbox (checks all sub-items automatically)
4. Click **Generate token**
5. **Copy the token immediately** — it starts with `ghp_` and GitHub only shows it once. Paste it into Notepad for safekeeping.

---

## Step 2: Initialize Git in the project folder

Open cmd and navigate to the project:
```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
```

Initialize a Git repository:
```cmd
git init
git branch -M main
```

---

## Step 3: Connect to GitHub

```cmd
git remote add origin https://github.com/KaeJhee/stockpulse.git
```

Verify the remote was set:
```cmd
git remote -v
```
You should see:
```
origin  https://github.com/KaeJhee/stockpulse.git (fetch)
origin  https://github.com/KaeJhee/stockpulse.git (push)
```

---

## Step 4: Stage, commit, and push

```cmd
git add .
```

Review what will be committed — make sure you do NOT see `node_modules`, `dist`, or `.env`:
```cmd
git status
```

Commit and push:
```cmd
git commit -m "Initial commit — Ghost Strategies StockPulse Terminal"
git push -u origin main
```

When prompted:
- **Username:** `KaeJhee`
- **Password:** paste your `ghp_` token (not your GitHub account password)

To avoid being asked for credentials every time, save them:
```cmd
git config --global credential.helper store
```

---

## Step 5: Verify

Go to https://github.com/KaeJhee/stockpulse — you should see all your project files.

> **Auto-deploy note:** The repo includes `.github/workflows/deploy.yml`. Once GitHub Actions is configured with your Vercel secrets, every push to `main` automatically triggers a Vercel redeploy — no manual Vercel interaction needed. See `DEPLOY_FROM_SCRATCH.md` Part C/D for Vercel setup details.

---

# PART 2 — Pushing Updates (Ongoing)

After the first-time setup is complete, this is all you need to do when you update the code.

```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
git add .
git commit -m "Brief description of what changed"
git push
```

GitHub Actions redeploys to Vercel automatically in ~60 seconds. Check the **Actions** tab at https://github.com/KaeJhee/stockpulse/actions to watch it run.

---

# PART 3 — Pushing an Update from a New ZIP

Use this when you received a new `stockpulse.zip` with updated files and your repo is already set up on GitHub.

---

## Scenario A: Existing project folder on this machine (fastest)

### Step 1: Open cmd in your project folder
```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
```

### Step 2: Copy updated files from the new ZIP
1. Unzip `stockpulse.zip` somewhere temporary (e.g., your Desktop)
2. Copy the **contents** of the unzipped `stockpulse\` folder into your existing folder, replacing everything:
   - Open both folders in Explorer
   - Select all files in the new folder → drag into your existing folder → click **Replace the files in the destination**

> Do not copy `.env` from the new ZIP — it is intentionally blank. Your Schwab vars live in Vercel, not in a local `.env`.

### Step 3: Check what changed
```cmd
git status
```
You'll see modified files such as `client/src/components/`, `client/src/lib/hooks.ts`, `README.md`, etc.
You should NOT see `node_modules`, `dist`, or `.env`.

### Step 4: Commit and push
```cmd
git add .
git commit -m "Update — describe what changed"
git push
```

GitHub Actions redeploys to Vercel automatically.

---

## Scenario B: Fresh machine (no existing local repo)

### Step 1: Unzip and install dependencies
```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
npm install
```

### Step 2: Connect to your existing GitHub repo
```cmd
git init
git remote add origin https://github.com/KaeJhee/stockpulse.git
```

### Step 3: Pull existing history so GitHub accepts the push
```cmd
git fetch origin
git branch -M main
git reset --soft origin/main
```

### Step 4: Commit and push
```cmd
git add .
git commit -m "Update from new ZIP"
git push origin main
```

If prompted, enter your GitHub username and Personal Access Token as the password.

---

## Scenario C: Force push (nuclear option)

Use only if Scenarios A and B failed and you want a clean slate. This replaces all history on GitHub.

```cmd
cd "C:\Users\krisg\OneDrive\Documents\Ghost Strategies\Tools\Valuation Dashboard\stockpulse"
git init
git remote add origin https://github.com/KaeJhee/stockpulse.git
git add .
git commit -m "Full replace"
git branch -M main
git push -f origin main
```

> **Warning:** `-f` deletes all previous commit history on GitHub. Use only when you're okay losing that history.

---

# PART 4 — Daily Workflow (After Everything Is Set Up)

1. Make your changes (edit a component, adjust styling, etc.)
2. Save the file
3. In cmd from your project folder:
   ```cmd
   git add .
   git commit -m "Brief description of what you changed"
   git push
   ```
4. GitHub Actions handles the rest — Vercel redeploys in ~60 seconds

---

# Quick Reference

## What goes where

| Item | Where it lives |
|---|---|
| Finnhub key | Browser localStorage (Settings modal) — never in code |
| Polygon key | Browser localStorage (Settings modal) — never in code |
| FMP key | Browser localStorage (Settings modal) — never in code |
| Marketaux key | Browser localStorage (Settings modal) — never in code |
| `SCHWAB_CLIENT_ID` | Vercel Environment Variables only |
| `SCHWAB_CLIENT_SECRET` | Vercel Environment Variables only |
| `SCHWAB_REDIRECT_URI` | Vercel Environment Variables only |
| `VERCEL_TOKEN` | GitHub Actions secret |
| `VERCEL_ORG_ID` | GitHub Actions secret |
| `VERCEL_PROJECT_ID` | GitHub Actions secret |

## Useful commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (run once after unzipping) |
| `npm run dev` | Start local dev server at http://localhost:5000 |
| `npm run build` | Build for production |
| `git add .` | Stage all changed files |
| `git commit -m "message"` | Save a snapshot of your changes |
| `git push` | Push to GitHub (triggers auto-deploy) |
| `git status` | See what files changed since last commit |
| `git log --oneline` | View recent commit history |
| `git pull origin main` | Pull latest changes from GitHub |

---

# Common Issues

**"Authentication failed" when pushing**
→ Use your Personal Access Token (starts with `ghp_`) as the password — not your GitHub account password.

**"rejected — non-fast-forward" when pushing**
→ Your local repo is behind the remote. Run `git pull origin main --rebase` first, then push again. If that fails, use Scenario C (force push).

**GitHub Actions workflow failing**
→ Check that all three GitHub secrets are set: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Go to GitHub → your repo → **Settings** → **Secrets and variables** → **Actions**. Do NOT add `VITE_FINNHUB_KEY` or `VITE_POLYGON_KEY` — those are stored in the browser via the Settings modal, not baked into the build.

**`'NODE_ENV' is not recognized`**
→ You ran `npm run dev` in PowerShell instead of Command Prompt. Open cmd (`Win + R` → type `cmd` → Enter), navigate to your project folder, and run `npm run dev` again.

**"npm: command not found"**
→ Node.js is not installed. Download from https://nodejs.org and reinstall.

**App shows mock data / no live prices after deploy**
→ Open Settings, enter your keys (FMP first, then Finnhub and Polygon), click **Test API** for each, then **Save & Close**. The page reloads with live data.

**API keys disappear after clearing browser data**
→ Keys are stored in localStorage — clearing browser data removes them. Re-enter them in Settings.
