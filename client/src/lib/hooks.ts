import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  MOCK_DETAILS, MOCK_SNAPSHOT,
  getMockAggregates, getMockNews, getMockFinancials,
  getMockEarnings, getMockAnalystRatings,
} from "./mockData";
import { getFinnhubKey, getPolygonKey, getAvKey, getFmpKey, getMarketauxKey } from "./apiKeys";

// ─────────────────────────────────────────────────────────────────────────────
// API base URLs
// Keys are read at call-time from localStorage (set via Settings modal)
// so users never need to touch env vars or redeploy.
// ─────────────────────────────────────────────────────────────────────────────
const FINNHUB_BASE = "https://finnhub.io/api/v1";
const POLYGON_BASE   = "https://api.polygon.io";
const MARKETAUX_BASE = "https://api.marketaux.com/v1";

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────────────────────────────────
async function finnhubGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(FINNHUB_BASE + path); // string concat preserves /api/v1 prefix
  url.searchParams.set("token", getFinnhubKey());
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res  = await fetch(url.toString());
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Finnhub parse error: ${text.slice(0, 100)}`); }
  if (!res.ok)  throw new Error(`Finnhub ${res.status}: ${JSON.stringify(data)}`);
  if (data?.error) throw new Error(`Finnhub error: ${data.error}`);
  return data;
}

async function polygonGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(POLYGON_BASE + path); // string concat preserves path prefix
  url.searchParams.set("apiKey", getPolygonKey());
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Polygon ${res.status}`);
  return res.json();
}

/** Call our own Vercel serverless proxy — credentials stay server-side */
async function apiGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res  = await fetch(url.toString(), { credentials: "include" });
  const data = await res.json();
  if (res.status === 401 && data.error === "NOT_AUTHENTICATED") throw new Error("NOT_AUTHENTICATED");
  if (!res.ok) throw new Error(data.error || `API ${res.status}`);
  return data;
}

async function withFallback<T>(fetchFn: () => Promise<T>, fallbackFn: () => T): Promise<T> {
  try {
    return await fetchFn();
  } catch (err) {
    console.warn("[API fallback triggered]", err);
    return fallbackFn();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schwab auth status — tells the UI whether to show "Connect Schwab" button
// ─────────────────────────────────────────────────────────────────────────────
export function useSchwabAuth() {
  return useQuery({
    queryKey: ["/api/auth/status"],
    queryFn: async () => {
      try {
        const data = await apiGet("/api/auth/status");
        return data as { authenticated: boolean };
      } catch {
        return { authenticated: false };
      }
    },
    staleTime: 60000,
    retry: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticker search
// ─────────────────────────────────────────────────────────────────────────────
export function useTickerSearch(query: string) {
  return useQuery({
    queryKey: ["/finnhub/search", query],
    queryFn: async () => {
      if (!query || query.length < 1) return { results: [] };
      return withFallback(
        async () => {
          const data = await finnhubGet("/search", { q: query });
          const results = (data.result || [])
            .filter((r: any) => r.type === "Common Stock")
            .slice(0, 10)
            .map((r: any) => ({ ticker: r.symbol, name: r.description, market: "stocks" }));
          return { results };
        },
        () => {
          const q = query.toUpperCase();
          const all = Object.entries({
            AAPL: "Apple Inc.", NVDA: "NVIDIA Corporation",
            MSFT: "Microsoft Corporation", TSLA: "Tesla, Inc.",
            GOOGL: "Alphabet Inc.", AMZN: "Amazon.com, Inc.",
            META: "Meta Platforms, Inc.", AMD: "Advanced Micro Devices",
            INTC: "Intel Corporation", NFLX: "Netflix, Inc.",
          });
          return {
            results: all
              .filter(([t, n]) => t.includes(q) || n.toUpperCase().includes(q))
              .map(([ticker, name]) => ({ ticker, name, market: "stocks" })),
          };
        }
      );
    },
    enabled: query.length >= 1,
    staleTime: 30000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ticker details
// ─────────────────────────────────────────────────────────────────────────────
export function useTickerDetails(ticker: string | null) {
  return useQuery({
    queryKey: ["/finnhub/profile", ticker],
    queryFn: () => withFallback(
      async () => {
        const data = await finnhubGet("/stock/profile2", { symbol: ticker!.toUpperCase() });
        return {
          name: data.name,
          market_cap: data.marketCapitalization ? data.marketCapitalization * 1e6 : null,
          ticker: data.ticker,
          primary_exchange: data.exchange,
          currency_name: data.currency,
          description: data.finnhubIndustry,
        };
      },
      () => MOCK_DETAILS[ticker!] || { name: ticker, market_cap: null }
    ),
    enabled: !!ticker,
    staleTime: 300000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-time quote
// Priority: Schwab (via /api/quotes) → Finnhub → mock
// ─────────────────────────────────────────────────────────────────────────────
function useRawQuote(ticker: string | null) {
  const { data: auth } = useSchwabAuth();
  const schwabConnected = auth?.authenticated ?? false;

  return useQuery({
    queryKey: ["/quote/raw", ticker, schwabConnected],
    queryFn: async () => {
      if (!ticker) return null;

      // Try Schwab first if authenticated
      if (schwabConnected) {
        try {
          const data = await apiGet("/api/quotes", { symbol: ticker.toUpperCase() });
          // data is already normalized by the serverless function
          return { source: "schwab", ...data };
        } catch (err: any) {
          if (err.message !== "NOT_AUTHENTICATED") {
            console.warn("[Schwab quote failed, falling back to Finnhub]", err);
          }
        }
      }

      // Fall back to Finnhub
      try {
        const data = await finnhubGet("/quote", { symbol: ticker.toUpperCase() });
        if (!data.c || data.c === 0) throw new Error("Empty quote");
        return {
          source: "finnhub",
          lastTrade: { p: data.c },
          day: { o: data.o, h: data.h, l: data.l, c: data.c, v: (data.v != null && data.v > 0) ? data.v : null },
          prevDay: { c: data.pc },
        };
      } catch (err) {
        console.warn("[Finnhub quote failed, trying FMP]", err);
      }

      // Fall back to FMP full quote if key is available (includes OHLC)
      const fmpKey = getFmpKey();
      if (fmpKey) {
        try {
          const url = `https://financialmodelingprep.com/stable/quote?symbol=${ticker.toUpperCase()}&apikey=${fmpKey}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            const q = Array.isArray(data) ? data[0] : null;
            if (q?.price) {
              return {
                source: "fmp",
                lastTrade: { p: q.price },
                day: {
                  o: q.open          ?? null,
                  h: q.dayHigh       ?? null,
                  l: q.dayLow        ?? null,
                  c: q.price,
                  v: (q.volume != null && q.volume > 0) ? q.volume : null,  // guard: FMP returns 0 when market closed
                },
                prevDay: { c: q.previousClose ?? null },
                marketCap: q.marketCap ?? null,
              };
            }
          }
        } catch (err) {
          console.warn("[FMP quote failed, falling back to mock]", err);
        }
      }

      return null;
    },
    enabled: !!ticker,
    refetchInterval: 15000,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
}

export function useSnapshot(ticker: string | null) {
  const { data: raw, dataUpdatedAt, isLoading } = useRawQuote(ticker);
  const isMock = !raw && !!ticker;
  const data = raw ?? (ticker ? (MOCK_SNAPSHOT[ticker] || MOCK_SNAPSHOT.AAPL) : null);
  const source: "schwab" | "finnhub" | "fmp" | "mock" = isMock ? "mock" : (raw as any)?.source ?? "finnhub";
  return { data, isLoading, dataUpdatedAt, isMock, source };
}

export function usePrevClose(ticker: string | null) {
  const { data: raw } = useRawQuote(ticker);
  // Include v (volume) so QuoteHeader's dayVol chain works when source is FMP/Schwab
  const data = raw
    ? { c: raw.prevDay?.c, o: raw.day?.o, h: raw.day?.h, l: raw.day?.l, v: (raw.day?.v != null && raw.day.v > 0) ? raw.day.v : null }
    : (ticker ? (MOCK_SNAPSHOT[ticker]?.prevDay || {}) : {});
  return { data, isLoading: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Previous-day OHLCV from Polygon /v2/aggs/ticker/{sym}/prev
// Finnhub free tier does NOT return volume. This hook provides volume + full
// OHLC by hitting Polygon’s free /prev endpoint and caching for 30 minutes.
// Used by QuoteHeader to populate Volume, Open, High, Low reliably.
// ─────────────────────────────────────────────────────────────────────────────
export function usePrevDayOHLCV(ticker: string | null) {
  return useQuery({
    queryKey: ["/polygon/prev", ticker],
    queryFn: async () => {
      const key = getPolygonKey();
      if (!key) throw new Error("No Polygon key");
      const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker!.toUpperCase()}/prev?adjusted=true&apiKey=${key}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Polygon prev ${res.status}`);
      const json = await res.json();
      const r = (json.results || [])[0];
      if (!r) throw new Error("No prev-day data");
      return {
        open:   r.o  ?? null,
        high:   r.h  ?? null,
        low:    r.l  ?? null,
        close:  r.c  ?? null,
        volume: r.v  ?? null,  // v is present on Polygon free tier ✔
        vwap:   r.vw ?? null,
      };
    },
    enabled: !!ticker && !!getPolygonKey(),
    staleTime: 1800000, // 30 min — prev-day data doesn’t change during session
    retry: 1,            // one retry on transient failure (rate limit, network blip)
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Price chart candles
// Priority: Schwab /api/pricehistory → Polygon → mock
// ─────────────────────────────────────────────────────────────────────────────
export function useAggregates(
  ticker: string | null,
  from: string,
  to: string,
  timespan = "day",
  multiplier = "1"
) {
  return useQuery({
    queryKey: ["/candles", ticker, from, to, timespan, multiplier],
    queryFn: () => withFallback(
      async () => {
        const data = await polygonGet(
          `/v2/aggs/ticker/${ticker!.toUpperCase()}/range/${multiplier}/${timespan}/${from}/${to}`,
          { adjusted: "true", sort: "asc", limit: "50000" }
        );
        return { results: data.results || [], resultsCount: data.resultsCount || 0 };
      },
      () => ({ results: getMockAggregates(ticker!, from, to), resultsCount: 90 })
    ),
    enabled: !!ticker && !!from && !!to,
    staleTime: 60000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// News — Marketaux primary → Polygon → Finnhub fallback (14-day window)
// ─────────────────────────────────────────────────────────────────────────────
function normalizeMarketauxArticle(n: any) {
  return {
    id:            n.uuid || String(Math.random()),
    title:         n.title,
    description:   n.description || n.snippet || "",
    article_url:   n.url,
    image_url:     n.image_url || null,
    published_utc: n.published_at,
    publisher:     { name: n.source, favicon_url: null },
    tickers:       (n.entities || []).map((e: any) => e.symbol).filter(Boolean),
    sentiment:     n.entities?.[0]?.sentiment_score ?? null,
  };
}

function normalizePolygonArticle(n: any) {
  return {
    id:            n.id || String(Math.random()),
    title:         n.title,
    description:   n.description || "",
    article_url:   n.article_url,
    image_url:     n.image_url || null,
    published_utc: n.published_utc,
    publisher:     { name: n.publisher?.name || "Polygon", favicon_url: n.publisher?.favicon_url || null },
    tickers:       n.tickers || [],
    sentiment:     null,
  };
}

export function useNews(ticker: string | null) {
  return useQuery({
    queryKey: ["/news", ticker],
    queryFn: () => withFallback(
      async () => {
        const to   = new Date().toISOString().split("T")[0];
        const from = new Date(Date.now() - 14 * 864e5).toISOString().split("T")[0];

        // 1) Marketaux — ticker-level filtering, sentiment scores, 14-day window
        const maKey = getMarketauxKey();
        if (maKey) {
          try {
            const url = new URL(`${MARKETAUX_BASE}/news/all`);
            url.searchParams.set("symbols",        ticker!.toUpperCase());
            url.searchParams.set("filter_entities","true");
            url.searchParams.set("published_after", from);
            url.searchParams.set("published_before", to);
            url.searchParams.set("language",        "en");
            url.searchParams.set("limit",           "3"); // free tier cap per request
            url.searchParams.set("api_token",       maKey);
            const resp = await fetch(url.toString());
            if (resp.ok) {
              const json = await resp.json();
              const articles = (json.data || []);
              if (articles.length > 0) {
                // Marketaux free = 3/req — supplement with Polygon for fuller coverage
                const maResults = articles.map(normalizeMarketauxArticle);
                // Try Polygon too and merge
                try {
                  const polyKey = getPolygonKey();
                  if (polyKey) {
                    const pUrl = new URL(`${POLYGON_BASE}/v2/reference/news`);
                    pUrl.searchParams.set("ticker", ticker!.toUpperCase());
                    pUrl.searchParams.set("published_utc.gte", from);
                    pUrl.searchParams.set("published_utc.lte", to);
                    pUrl.searchParams.set("limit", "50");
                    pUrl.searchParams.set("order", "desc");
                    pUrl.searchParams.set("sort", "published_utc");
                    pUrl.searchParams.set("apiKey", polyKey);
                    const pResp = await fetch(pUrl.toString());
                    if (pResp.ok) {
                      const pJson = await pResp.json();
                      const polyResults = (pJson.results || []).map(normalizePolygonArticle);
                      // Merge: Marketaux first (sentiment data), then Polygon, dedup by title prefix
                      const seen = new Set(maResults.map((a: any) => (a.title || "").slice(0, 40)));
                      const merged = [...maResults];
                      for (const a of polyResults) {
                        const titleKey = (a.title || "").slice(0, 40);
                        if (!seen.has(titleKey)) {
                          merged.push(a);
                          seen.add(titleKey);
                        }
                      }
                      return { results: merged };
                    }
                  }
                } catch { /* return just Marketaux results */ }
                return { results: maResults };
              }
            }
          } catch { /* fall through */ }
        }

        // 2) Polygon standalone (no Marketaux key)
        const polyKey = getPolygonKey();
        if (polyKey) {
          try {
            const pUrl = new URL(`${POLYGON_BASE}/v2/reference/news`);
            pUrl.searchParams.set("ticker", ticker!.toUpperCase());
            pUrl.searchParams.set("published_utc.gte", from);
            pUrl.searchParams.set("published_utc.lte", to);
            pUrl.searchParams.set("limit", "50");
            pUrl.searchParams.set("order", "desc");
            pUrl.searchParams.set("sort", "published_utc");
            pUrl.searchParams.set("apiKey", polyKey);
            const pResp = await fetch(pUrl.toString());
            if (pResp.ok) {
              const pJson = await pResp.json();
              const articles = (pJson.results || []);
              if (articles.length > 0) return { results: articles.map(normalizePolygonArticle) };
            }
          } catch { /* fall through */ }
        }

        // 3) Finnhub fallback
        const data = await finnhubGet("/company-news", { symbol: ticker!.toUpperCase(), from, to });
        const results = (data || []).slice(0, 30).map((n: any) => ({
          id:            String(n.id),
          title:         n.headline,
          description:   n.summary,
          article_url:   n.url,
          image_url:     n.image || null,
          published_utc: new Date(n.datetime * 1000).toISOString(),
          publisher:     { name: n.source, favicon_url: null },
          tickers:       [],
          sentiment:     null,
        }));
        return { results };
      },
      () => ({ results: getMockNews(ticker!) })
    ),
    enabled: !!ticker,
    staleTime: 120000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Financials — Finnhub metrics
// ─────────────────────────────────────────────────────────────────────────────
export function useFinancials(ticker: string | null, _timeframe = "quarterly") {
  return useQuery({
    queryKey: ["/finnhub/financials", ticker],
    queryFn: () => withFallback(
      async () => {
        const data = await finnhubGet("/stock/metric", { symbol: ticker!.toUpperCase(), metric: "all" });
        const m = data.metric || {};
        return {
          results: [{
            period_of_report_date: new Date().toISOString().split("T")[0],
            financials: {
              income_statement: {
                revenues:        { value: m["revenuePerShareTTM"] ? m["revenuePerShareTTM"] * 1e9 : null },
                net_income_loss: { value: m["netProfitMarginTTM"] ? m["netProfitMarginTTM"] * 1e9 : null },
              },
            },
          }],
        };
      },
      () => ({ results: getMockFinancials(ticker!) })
    ),
    enabled: !!ticker,
    staleTime: 300000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Earnings — Finnhub (past + upcoming)
// ─────────────────────────────────────────────────────────────────────────────
export function useEarnings(ticker: string | null) {
  return useQuery({
    queryKey: ["/finnhub/earnings", ticker],
    queryFn: () => withFallback(
      async () => {
        const past = await finnhubGet("/stock/earnings", { symbol: ticker!.toUpperCase(), limit: "8" });
        const now  = new Date();
        const from = now.toISOString().split("T")[0];
        const to   = new Date(now.getTime() + 180 * 864e5).toISOString().split("T")[0];
        let upcomingRaw: any[] = [];
        try {
          const cal = await finnhubGet("/calendar/earnings", { symbol: ticker!.toUpperCase(), from, to });
          upcomingRaw = (cal.earningsCalendar || []).filter((e: any) => e.epsActual == null);
        } catch { /* non-fatal */ }

        const pastRecords = (past || []).map((r: any) => ({
          id: `${ticker}-past-${r.period}-${r.quarter}`,
          date: r.period, fiscal_period: `Q${r.quarter} FY${r.year}`,
          fiscal_quarter: r.quarter, fiscal_year: r.year, time: "—",
          actual_eps: r.actual ?? null, estimated_eps: r.estimate ?? null,
          actual_revenue: null, estimated_revenue: null,
          prior_year_eps: null, prior_year_revenue: null,
          eps_surprise: r.surprisePercent ?? null, revenue_surprise: null,
          is_upcoming: false,
        }));

        const upcomingRecords = upcomingRaw.map((r: any) => ({
          id: `${ticker}-upcoming-${r.date}-${r.quarter}`,
          date: r.date, fiscal_period: `Q${r.quarter} FY${r.year}`,
          fiscal_quarter: r.quarter, fiscal_year: r.year,
          time: r.hour === "bmo" ? "Before Open" : r.hour === "amc" ? "After Close" : "—",
          actual_eps: null, estimated_eps: r.epsEstimate ?? null,
          eps_estimate_low: null, eps_estimate_high: null,
          actual_revenue: null, estimated_revenue: r.revenueEstimate ?? null,
          revenue_estimate_low: null, revenue_estimate_high: null,
          prior_year_eps: null, prior_year_revenue: null,
          eps_surprise: null, revenue_surprise: null, is_upcoming: true,
        }));

        const results = [...upcomingRecords, ...pastRecords];
        if (!results.length) throw new Error("no earnings data");
        return { results };
      },
      () => ({ results: getMockEarnings(ticker!) })
    ),
    enabled: !!ticker,
    staleTime: 300000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyst ratings
// Price targets: Schwab /api/instruments (when connected) → show "—" otherwise
// Buy/Hold/Sell: always Finnhub (free, works well)
// ─────────────────────────────────────────────────────────────────────────────
export function useAnalystRatings(ticker: string | null) {
  const { data: auth } = useSchwabAuth();
  const schwabConnected = auth?.authenticated ?? false;

  return useQuery({
    queryKey: ["/analyst", ticker, schwabConnected],
    queryFn: () => withFallback(
      async () => {
        // Buy/Hold/Sell counts from Finnhub (always)
        const recData = await finnhubGet("/stock/recommendation", { symbol: ticker!.toUpperCase() });
        const rec   = Array.isArray(recData) ? recData[0] : null;
        const buy   = (rec?.strongBuy ?? 0) + (rec?.buy ?? 0);
        const hold  = rec?.hold  ?? 0;
        const sell  = (rec?.sell ?? 0) + (rec?.strongSell ?? 0);
        const total = buy + hold + sell;
        let consensus = "N/A";
        if (total > 0) {
          const score = (buy * 2 + hold * 1 + sell * 0) / total;
          if      (score >= 1.7) consensus = "Strong Buy";
          else if (score >= 1.3) consensus = "Buy";
          else if (score >= 0.7) consensus = "Hold";
          else if (score >= 0.3) consensus = "Sell";
          else                   consensus = "Strong Sell";
        }

        // Price targets from Schwab (when connected)
        let avg_price_target  = null;
        let high_price_target = null;
        let low_price_target  = null;
        if (schwabConnected) {
          try {
            const inst = await apiGet("/api/instruments", { symbol: ticker!.toUpperCase() });
            avg_price_target  = inst.avg_price_target;
            high_price_target = inst.high_price_target;
            low_price_target  = inst.low_price_target;
          } catch { /* non-fatal — price targets just show "—" */ }
        }

        return { buy, hold, sell, total, consensus, avg_price_target, high_price_target, low_price_target, num_analysts: total };
      },
      () => getMockAnalystRatings(ticker!)
    ),
    enabled: !!ticker,
    staleTime: 300000,
  });
}

export function useRSI(ticker: string | null) {
  return useQuery({
    queryKey: ["/rsi/stub", ticker],
    queryFn: () => Promise.resolve({ value: 52 + Math.random() * 20 }),
    enabled: !!ticker,
    staleTime: 60000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Overview — used on the landing page (Bloomberg-style)
// ─────────────────────────────────────────────────────────────────────────────

// Major indices / ETFs / FX / Crypto / Commodities / Treasuries for the overview bar
// Symbols prefixed with X: = crypto (Polygon), C: = forex (Polygon)
// All others are ETFs that trade on US exchanges and are available on Polygon free tier
const INDICES = [
  // ── US Equity Indices ──
  { symbol: "SPY",      label: "S&P 500" },
  { symbol: "QQQ",      label: "NASDAQ" },
  { symbol: "DIA",      label: "DOW" },
  { symbol: "IWM",      label: "RUSSELL 2K" },
  // ── Volatility ──
  { symbol: "VIX",      label: "VIX" },
  // ── Commodities ──
  { symbol: "GLD",      label: "GOLD" },
  { symbol: "SLV",      label: "SILVER" },
  { symbol: "USO",      label: "WTI CRUDE" },
  { symbol: "BNO",      label: "BRENT CRUDE" },
  // ── Crypto ──
  { symbol: "X:BTCUSD", label: "BITCOIN" },
  // ── FX Markets ──
  { symbol: "C:EURUSD", label: "EUR/USD" },
  { symbol: "C:GBPUSD", label: "GBP/USD" },
  { symbol: "C:USDJPY", label: "USD/JPY" },
  // ── US Treasuries ──
  { symbol: "SHY",      label: "2Y TREASURY" },
  { symbol: "IEI",      label: "5Y TREASURY" },
  { symbol: "TLT",      label: "10Y TREASURY" },
];

export type IndexQuote = {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
};

// Helper: fetch batch quotes from FMP (single API call for up to 50 symbols)
async function fmpBatchQuotes(symbols: string[]): Promise<Map<string, { price: number; change: number; changePct: number; open: number | null; high: number | null; low: number | null; volume: number | null; prevClose: number | null }>> {
  const key = getFmpKey();
  if (!key) throw new Error("No FMP key");
  // Use batch-quote endpoint with ?symbols= (comma-separated) for multi-symbol requests
  const symbolsParam = symbols.join(",");
  const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${symbolsParam}&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const data = await res.json();
  const map = new Map<string, any>();
  if (Array.isArray(data)) {
    for (const q of data) {
      if (q.symbol && q.price) {
        map.set(q.symbol, {
          price:     q.price,
          change:    q.change     ?? 0,
          changePct: q.changePercentage ?? q.changesPercentage ?? 0, // stable=changePercentage, v3=changesPercentage
          open:      q.open      ?? null,
          high:      q.dayHigh   ?? null,
          low:       q.dayLow    ?? null,
          volume:    (q.volume != null && q.volume > 0) ? q.volume : null,  // guard: 0 during market-closed hours
          prevClose: q.previousClose ?? null,
        });
      }
    }
  }
  return map;
}

export function useMarketIndices() {
  return useQuery({
    queryKey: ["/market/indices"],
    queryFn: async (): Promise<IndexQuote[]> => {
      // Strategy:
      // • FMP batch (single call, all symbols) runs in parallel with Polygon
      // • Polygon fetches ETFs with a small 150ms stagger between each (avoids 429
      //   on free tier 5 req/min, still resolves all 7 in ~1s total)
      // • VIX: not available on Polygon or Finnhub free tier.
      //   Fetch ^VIX via FMP single-quote when FMP key is present, else skip.
      // • Results merged: Polygon seeds map, FMP overlays (more accurate intraday)

      const polyKey = getPolygonKey();
      const fmpKey  = getFmpKey();
      const pDelay  = (ms: number) => new Promise(r => setTimeout(r, ms));

      // ETFs reliably available on Polygon free tier
      // All symbols Polygon /prev supports — includes crypto (X:) and forex (C:) prefixes
      const ETF_SYMBOLS = ["SPY", "QQQ", "DIA", "IWM", "GLD", "SLV", "USO", "BNO", "SHY", "IEI", "TLT", "X:BTCUSD", "C:EURUSD", "C:GBPUSD", "C:USDJPY"];

      // ── Run Polygon (staggered), FMP batch, and FMP VIX all at once ─────────
      const [polygonSettled, fmpMap, vixQuote] = await Promise.allSettled([

        // Polygon: stagger 150ms between each fetch — 15 symbols = ~2.25s worst case
        // Free tier is 5 req/min but small 150ms bursts are tolerated without 429.
        // If a symbol 429s, it returns null and FMP overlays in step 2.
        // X:BTCUSD, C:EURUSD, C:GBPUSD, C:USDJPY work on Polygon /prev endpoint.
        Promise.allSettled(
          ETF_SYMBOLS.map(async (symbol, i) => {
            await pDelay(i * 150); // 0ms, 150ms, 300ms … up to ~2100ms for last symbol
            const label = INDICES.find(idx => idx.symbol === symbol)?.label || symbol;
            const url = `${POLYGON_BASE}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${polyKey}`;
            const resp = await fetch(url);
            if (!resp.ok) return null; // 429 or error — FMP will fill gap
            const json = await resp.json();
            const r = (json.results || [])[0];
            if (!r?.c) return null;
            const price  = r.c;
            const prevRef = r.vw ?? r.o ?? price;
            const change  = price - prevRef;
            const changePct = prevRef !== 0 ? (change / prevRef) * 100 : 0;
            return { symbol, label, price, change, changePct } as IndexQuote;
          })
        ),

        // FMP batch: single call covers SPY/QQQ/DIA/IWM and often GLD/USO/TLT too
        fmpKey ? fmpBatchQuotes(INDICES.map(i => i.symbol)) : Promise.resolve(new Map()),

        // VIX via FMP single-quote (^VIX) — only works with a paid FMP key
        // On free tiers this will fail gracefully and VIX slot is omitted
        fmpKey
          ? fetch(`https://financialmodelingprep.com/stable/quote?symbol=%5EVIX&apikey=${fmpKey}`)
              .then(r => r.ok ? r.json() : null)
              .then((data: any) => {
                const q = Array.isArray(data) ? data[0] : null;
                if (!q?.price) return null;
                return { price: q.price, change: q.change ?? 0, changePct: q.changePercentage ?? q.changesPercentage ?? 0 };
              })
              .catch(() => null)
          : Promise.resolve(null),

      ] as const);

      // ── Build result map — Polygon seeds, FMP overlays ──────────────────
      const resultMap = new Map<string, IndexQuote>();

      // 1) Seed with Polygon results
      if (polygonSettled.status === "fulfilled") {
        for (const r of polygonSettled.value) {
          if (r.status === "fulfilled" && r.value) {
            resultMap.set(r.value.symbol, r.value);
          }
        }
      }

      // 2) Overlay FMP (better intraday prices, fills any Polygon 429 gaps)
      if (fmpMap.status === "fulfilled" && fmpMap.value.size > 0) {
        for (const { symbol, label } of INDICES) {
          const q = fmpMap.value.get(symbol);
          if (q?.price) {
            resultMap.set(symbol, { symbol, label, price: q.price, change: q.change, changePct: q.changePct });
          }
        }
      }

      // 3) VIX from FMP ^VIX quote
      const vixEntry = INDICES.find(i => i.symbol === "VIX");
      if (vixEntry && vixQuote.status === "fulfilled" && vixQuote.value) {
        const v = vixQuote.value;
        resultMap.set("VIX", { symbol: "VIX", label: vixEntry.label, price: v.price, change: v.change, changePct: v.changePct });
      }

      // ── Return in INDICES order ───────────────────────────────────────────
      const ordered = INDICES
        .map(({ symbol }) => resultMap.get(symbol))
        .filter(Boolean) as IndexQuote[];

      // If we somehow got nothing (all APIs failed), fall back to sequential Finnhub
      if (ordered.length === 0) {
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const fallback: IndexQuote[] = [];
        for (const { symbol, label } of INDICES) {
          try {
            const data = await finnhubGet("/quote", { symbol });
            if (data.c && data.c !== 0 && data.pc && data.pc !== 0) {
              fallback.push({ symbol, label, price: data.c, change: data.c - data.pc, changePct: ((data.c - data.pc) / data.pc) * 100 });
            }
          } catch { /* skip */ }
          await delay(120);
        }
        return fallback;
      }

      return ordered;
    },
    staleTime: 30000,
    refetchInterval: 60000,
    retry: 1,
  });
}

// Top movers — gainers and losers among a watchlist of liquid names
const MOVER_UNIVERSE = [
  "AAPL","NVDA","MSFT","TSLA","GOOGL","AMZN","META","AMD",
  "NFLX","INTC","BABA","BA","JPM","GS","BAC","XOM",
  "CVX","WMT","COST","DIS","PYPL","CRM","ORCL","ADBE",
  "QCOM","AVGO","MU","ARM","PLTR","SOFI",
];

export type MoverQuote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number | null;
};

export function useTopMovers() {
  return useQuery({
    queryKey: ["/market/movers"],
    queryFn: async (): Promise<{ gainers: MoverQuote[]; losers: MoverQuote[] }> => {
      // 1) FMP batch — best free option for top movers
      const fmpKey = getFmpKey();
      if (fmpKey) {
        try {
          const map = await fmpBatchQuotes(MOVER_UNIVERSE);
          if (map.size > 0) {
            const all: MoverQuote[] = [];
            for (const symbol of MOVER_UNIVERSE) {
              const q = map.get(symbol);
              if (q) all.push({ symbol, price: q.price, change: q.change, changePct: q.changePct, volume: q.volume });
            }

            // Enrich null volumes from Polygon /prev (free tier, always has volume)
            const polyKey = getPolygonKey();
            if (polyKey) {
              const nullVolSymbols = all.filter(m => m.volume == null).map(m => m.symbol);
              if (nullVolSymbols.length > 0) {
                const volResults = await Promise.allSettled(
                  nullVolSymbols.map(async (sym) => {
                    const res = await fetch(
                      `${POLYGON_BASE}/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${polyKey}`
                    );
                    if (!res.ok) return null;
                    const json = await res.json();
                    const r = (json.results || [])[0];
                    return r?.v ? { symbol: sym, volume: r.v as number } : null;
                  })
                );
                const volMap = new Map<string, number>();
                for (const r of volResults) {
                  if (r.status === "fulfilled" && r.value) {
                    volMap.set(r.value.symbol, r.value.volume);
                  }
                }
                for (const mover of all) {
                  if (mover.volume == null && volMap.has(mover.symbol)) {
                    mover.volume = volMap.get(mover.symbol)!;
                  }
                }
              }
            }

            const sorted = [...all].sort((a, b) => b.changePct - a.changePct);
            return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() };
          }
        } catch { /* fall through */ }
      }

      // 2) Finnhub batched fallback
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
      const all: MoverQuote[] = [];
      const batches: string[][] = [];
      for (let i = 0; i < MOVER_UNIVERSE.length; i += 5) batches.push(MOVER_UNIVERSE.slice(i, i + 5));
      for (let b = 0; b < batches.length; b++) {
        const settled = await Promise.allSettled(
          batches[b].map(async (symbol) => {
            const data = await finnhubGet("/quote", { symbol });
            if (!data.c || data.c === 0) return null;
            return { symbol, price: data.c, change: data.c - data.pc, changePct: ((data.c - data.pc) / data.pc) * 100, volume: (data.v != null && data.v > 0) ? data.v : null } as MoverQuote;
          })
        );
        for (const r of settled) { if (r.status === "fulfilled" && r.value) all.push(r.value); }
        if (b < batches.length - 1) await delay(300);
      }

      // Enrich null volumes from Polygon /prev (free tier, always has volume)
      const polyKey = getPolygonKey();
      if (polyKey) {
        const nullVolSymbols = all.filter(m => m.volume == null).map(m => m.symbol);
        if (nullVolSymbols.length > 0) {
          const volResults = await Promise.allSettled(
            nullVolSymbols.map(async (sym) => {
              const res = await fetch(
                `${POLYGON_BASE}/v2/aggs/ticker/${sym}/prev?adjusted=true&apiKey=${polyKey}`
              );
              if (!res.ok) return null;
              const json = await res.json();
              const r = (json.results || [])[0];
              return r?.v ? { symbol: sym, volume: r.v as number } : null;
            })
          );
          const volMap = new Map<string, number>();
          for (const r of volResults) {
            if (r.status === "fulfilled" && r.value) {
              volMap.set(r.value.symbol, r.value.volume);
            }
          }
          for (const mover of all) {
            if (mover.volume == null && volMap.has(mover.symbol)) {
              mover.volume = volMap.get(mover.symbol)!;
            }
          }
        }
      }

      const sorted = [...all].sort((a, b) => b.changePct - a.changePct);
      return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() };
    },
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
}

// Sector ETF performance
const SECTORS = [
  { symbol: "XLK",  label: "Technology" },
  { symbol: "XLF",  label: "Financials" },
  { symbol: "XLV",  label: "Healthcare" },
  { symbol: "XLE",  label: "Energy" },
  { symbol: "XLC",  label: "Comm Svcs" },
  { symbol: "XLI",  label: "Industrials" },
  { symbol: "XLY",  label: "Cons Discr" },
  { symbol: "XLP",  label: "Cons Staples" },
  { symbol: "XLB",  label: "Materials" },
  { symbol: "XLRE", label: "Real Estate" },
  { symbol: "XLU",  label: "Utilities" },
];

export type SectorPerf = {
  symbol: string;
  label: string;
  changePct: number;
};

export function useSectorPerformance() {
  return useQuery({
    queryKey: ["/market/sectors"],
    queryFn: async (): Promise<SectorPerf[]> => {
      const symbols = SECTORS.map(s => s.symbol);

      // Try FMP batch first
      const fmpKey = getFmpKey();
      if (fmpKey) {
        try {
          const map = await fmpBatchQuotes(symbols);
          if (map.size > 0) {
            return SECTORS
              .map(({ symbol, label }) => {
                const q = map.get(symbol);
                if (!q) return null;
                return { symbol, label, changePct: q.changePct };
              })
              .filter(Boolean)
              .sort((a: any, b: any) => b.changePct - a.changePct) as SectorPerf[];
          }
        } catch { /* fall through to Finnhub */ }
      }

      // Fallback: Finnhub batched
      const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
      const results: SectorPerf[] = [];
      const batches: typeof SECTORS[] = [];
      for (let i = 0; i < SECTORS.length; i += 4) batches.push(SECTORS.slice(i, i + 4));
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const settled = await Promise.allSettled(
          batch.map(async ({ symbol, label }) => {
            const data = await finnhubGet("/quote", { symbol });
            if (!data.c || data.c === 0) return null;
            return { symbol, label, changePct: ((data.c - data.pc) / data.pc) * 100 } as SectorPerf;
          })
        );
        for (const r of settled) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
        if (b < batches.length - 1) await delay(300);
      }
      return results.sort((a, b) => b.changePct - a.changePct);
    },
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 1,
  });
}

// General market news — Marketaux + Polygon merged → Finnhub fallback
export function useMarketNews() {
  return useQuery({
    queryKey: ["/market-news"],
    queryFn: () => withFallback(
      async () => {
        const from = new Date(Date.now() - 3 * 864e5).toISOString().split("T")[0]; // last 3 days
        const to   = new Date().toISOString().split("T")[0];
        const allArticles: any[] = [];
        const seen = new Set<string>();

        // 1) Marketaux broad market news (general category = no symbols param)
        const maKey = getMarketauxKey();
        if (maKey) {
          try {
            const url = new URL(`${MARKETAUX_BASE}/news/all`);
            url.searchParams.set("published_after",  from);
            url.searchParams.set("published_before", to);
            url.searchParams.set("language",         "en");
            url.searchParams.set("limit",            "3"); // free tier cap
            url.searchParams.set("api_token",        maKey);
            const resp = await fetch(url.toString());
            if (resp.ok) {
              const json = await resp.json();
              for (const n of (json.data || [])) {
                const a = normalizeMarketauxArticle(n);
                const titleKey = (a.title || "").slice(0, 40);
                if (!seen.has(titleKey)) {
                  allArticles.push(a);
                  seen.add(titleKey);
                }
              }
            }
          } catch { /* fall through */ }
        }

        // 2) Polygon broad market news (no ticker = all)
        const polyKey = getPolygonKey();
        if (polyKey) {
          try {
            const url = new URL(`${POLYGON_BASE}/v2/reference/news`);
            url.searchParams.set("published_utc.gte", from);
            url.searchParams.set("limit", "50");
            url.searchParams.set("order", "desc");
            url.searchParams.set("sort", "published_utc");
            url.searchParams.set("apiKey", polyKey);
            const resp = await fetch(url.toString());
            if (resp.ok) {
              const json = await resp.json();
              for (const n of (json.results || [])) {
                const a = normalizePolygonArticle(n);
                const titleKey = (a.title || "").slice(0, 40);
                if (!seen.has(titleKey)) {
                  allArticles.push(a);
                  seen.add(titleKey);
                }
              }
            }
          } catch { /* fall through */ }
        }

        if (allArticles.length > 0) {
          // Sort merged results by date desc
          allArticles.sort((a, b) => new Date(b.published_utc).getTime() - new Date(a.published_utc).getTime());
          return { results: allArticles };
        }

        // 3) Finnhub fallback
        const data = await finnhubGet("/news", { category: "general" });
        const results = (data || []).slice(0, 30).map((n: any) => ({
          id:            String(n.id),
          title:         n.headline,
          description:   n.summary,
          article_url:   n.url,
          image_url:     n.image || null,
          published_utc: new Date(n.datetime * 1000).toISOString(),
          publisher:     { name: n.source, favicon_url: null },
          tickers:       [],
          sentiment:     null,
        }));
        return { results };
      },
      () => ({
        results: [
          {
            id: "m1", title: "Fed holds rates steady amid inflation concerns",
            description: "The Federal Reserve kept interest rates unchanged at its latest meeting.",
            article_url: "#", image_url: null,
            published_utc: new Date().toISOString(),
            publisher: { name: "Reuters", favicon_url: null },
          },
          {
            id: "m2", title: "Tech stocks rally on strong earnings reports",
            description: "Semiconductor and AI-related stocks led gains across major indices.",
            article_url: "#", image_url: null,
            published_utc: new Date(Date.now() - 3600000).toISOString(),
            publisher: { name: "Bloomberg", favicon_url: null },
          },
          {
            id: "m3", title: "Oil prices dip as global demand forecasts ease",
            description: "Crude oil fell amid revised demand projections from the IEA.",
            article_url: "#", image_url: null,
            published_utc: new Date(Date.now() - 7200000).toISOString(),
            publisher: { name: "CNBC", favicon_url: null },
          },
        ],
      })
    ),
    staleTime: 120000,
    refetchInterval: 120000,
  });
}

// Market status — are we open or closed?
export function useMarketStatus() {
  return useQuery({
    queryKey: ["/finnhub/market-status"],
    queryFn: async () => {
      try {
        const data = await finnhubGet("/stock/market-status", { exchange: "US" });
        return {
          isOpen: data.isOpen ?? false,
          session: data.session ?? "closed",
        };
      } catch {
        // Derive from local time as fallback
        const now  = new Date();
        const day  = now.getUTCDay(); // 0=Sun 6=Sat
        const hour = now.getUTCHours();
        const min  = now.getUTCMinutes();
        const mins = hour * 60 + min;
        const isWeekday  = day >= 1 && day <= 5;
        const isRegular  = mins >= 870 && mins < 1260; // 9:30 AM ET open (14:30 UTC) to 4:00 PM ET close (21:00 UTC)
        const isExtended = mins >= 540 && mins < 1200; // 9am-8pm UTC rough
        return {
          isOpen: isWeekday && isRegular,
          session: isWeekday ? (isExtended ? "extended" : "closed") : "closed",
        };
      }
    },
    staleTime: 60000,
    refetchInterval: 60000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Alpha Vantage helpers
// Free tier: 25 req/day, 5/min — use sparingly, staleTime kept very high
// ─────────────────────────────────────────────────────────────────────────────

// Small delay helper to avoid AV 5 req/min burst limit
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function avGet(params: Record<string, string>, delayMs = 0): Promise<any> {
  if (delayMs > 0) await sleep(delayMs);
  const key = getAvKey();
  if (!key) throw new Error("No Alpha Vantage key set");
  const url = new URL("https://www.alphavantage.co/query");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("apikey", key);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`AV HTTP ${res.status}`);
  const data = await res.json();
  if (data["Note"]) throw new Error("Rate limit — wait 1 min");
  if (data["Information"]) throw new Error("Daily limit reached (25/day)");
  if (data["Error Message"]) throw new Error(data["Error Message"]);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// FMP helpers
// Free tier: 250 req/day — used for fundamentals
// ─────────────────────────────────────────────────────────────────────────────

async function fmpGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const key = getFmpKey();
  if (!key) throw new Error("No FMP key set");
  const url = new URL(path, "https://financialmodelingprep.com");
  url.searchParams.set("apikey", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const data = await res.json();
  if (data?.["Error Message"]) throw new Error(data["Error Message"]);
  if (typeof data === "object" && data !== null && "message" in data) throw new Error(String(data.message));
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Polygon bars fetch — one call powers RSI, SMA, and Bollinger Bands
// Requires 250 bars to warm up SMA200 (200 periods) plus history for RSI/BB
// All indicators calculated with the same rolling math used for MACD
// No AV key needed — Polygon free tier, no daily quota
// ─────────────────────────────────────────────────────────────────────────────

function usePolyBars(ticker: string | null) {
  return useQuery({
    queryKey: ["/polygon/bars", ticker],
    queryFn: async () => {
      // Stagger: wait 800ms so useAggregates + usePrevDayOHLCV fire first
      // This prevents 4 simultaneous Polygon requests on stock selection
      await new Promise(resolve => setTimeout(resolve, 800));

      const polyKey = getPolygonKey();
      if (!polyKey) throw new Error("No Polygon key");
      const to   = new Date().toISOString().split("T")[0];
      const from = new Date(Date.now() - 550 * 864e5).toISOString().split("T")[0]; // ~550 calendar days → 250+ trading days
      const url  = `${POLYGON_BASE}/v2/aggs/ticker/${ticker!.toUpperCase()}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=300&apiKey=${polyKey}`;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`Polygon bars fetch failed: ${res.status}`);
      const json = await res.json();
      const bars: { t: number; c: number; h: number; l: number; v: number }[] = json.results || [];
      if (bars.length === 0) throw new Error("No bar data returned");
      return bars;
    },
    enabled: !!ticker && !!getPolygonKey(),
    staleTime: 3600000,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 10000), // exponential: 1s, 2s, 4s
    // Shared by RSI, SMA, Bbands — cached once, used by all three
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling RSI — Wilder's smoothed method (standard)
// RS = avg_gain / avg_loss over 14 periods, then smoothed
// ─────────────────────────────────────────────────────────────────────────────

function calcRsi(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;

  // Seed: simple average of first `period` gains and losses
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0);

  // Wilder smoothing for subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return rsi;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling SMA — simple average over N closes
// ─────────────────────────────────────────────────────────────────────────────

function calcSma(closes: number[], period: number): number[] {
  const sma: number[] = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) sma[i] = sum / period;
  }
  return sma;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rolling Bollinger Bands — SMA20 ± 2 standard deviations
// ─────────────────────────────────────────────────────────────────────────────

function calcBbands(closes: number[], period = 20, stdMult = 2): { upper: number; middle: number; lower: number }[] {
  const result: { upper: number; middle: number; lower: number }[] = closes.map(() => ({ upper: NaN, middle: NaN, lower: NaN }));
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean   = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std    = Math.sqrt(variance);
    result[i] = { upper: mean + stdMult * std, middle: mean, lower: mean - stdMult * std };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI — 14-period daily (Polygon, no AV)
// ─────────────────────────────────────────────────────────────────────────────

export function useRsi(ticker: string | null) {
  const { data: bars, isLoading, isError } = usePolyBars(ticker);
  const result = useMemo(() => {
    if (!bars || bars.length < 15) return null;
    const closes = bars.map(b => b.c);
    const dates  = bars.map(b => new Date(b.t).toISOString().split("T")[0]);
    const rsiVals = calcRsi(closes);
    const entries: { date: string; value: number }[] = [];
    for (let i = closes.length - 1; i >= 0 && entries.length < 60; i--) {
      if (!isNaN(rsiVals[i])) entries.push({ date: dates[i], value: rsiVals[i] });
    }
    const latest = entries[0] ?? null;
    return { entries, latest };
  }, [bars]);
  return { data: result, isLoading, isError };
}

// ─────────────────────────────────────────────────────────────────────────────
// MACD — calculated manually from Polygon daily closes (free tier)
// EMA formula: EMA(t) = price * k + EMA(t-1) * (1-k), k = 2/(N+1)
// MACD = EMA12 - EMA26, Signal = EMA9 of MACD, Histogram = MACD - Signal
// Polygon /v2/aggs/.../range/1/day is free tier — no AV premium required
// ─────────────────────────────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  // seed with simple average of first `period` prices
  if (prices.length < period) return prices.map(() => NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  ema[period - 1] = sum / period;
  for (let i = period; i < prices.length; i++) {
    ema[i] = prices[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

export function useMacd(ticker: string | null) {
  return useQuery({
    queryKey: ["/polygon/macd", ticker],
    queryFn: async () => {
      // Stagger: wait 2000ms so the ~16 concurrent index /prev requests from
      // MarketOverview finish before MACD fires — prevents 429 rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

      const polyKey = getPolygonKey();
      if (!polyKey) throw new Error("No Polygon key");

      // Fetch ~200 daily bars — enough to warm up EMA26 + signal EMA9 with history
      const to   = new Date().toISOString().split("T")[0];
      const from = new Date(Date.now() - 400 * 864e5).toISOString().split("T")[0]; // ~400 calendar days
      const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker!.toUpperCase()}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=250&apiKey=${polyKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Polygon MACD fetch failed: ${res.status}`);
      const json = await res.json();
      const bars: { t: number; c: number }[] = (json.results || []);
      if (bars.length < 35) throw new Error("Insufficient data for MACD");

      const closes = bars.map(b => b.c);
      const dates  = bars.map(b => new Date(b.t).toISOString().split("T")[0]);

      const ema12 = calcEMA(closes, 12);
      const ema26 = calcEMA(closes, 26);

      // MACD line starts where both EMAs are valid (index 25+)
      const macdLine: number[] = closes.map((_, i) =>
        !isNaN(ema12[i]) && !isNaN(ema26[i]) ? ema12[i] - ema26[i] : NaN
      );

      // Extract valid MACD values for signal EMA calculation
      const firstValid = macdLine.findIndex(v => !isNaN(v));
      const macdForSignal = macdLine.slice(firstValid);
      const signalFull = calcEMA(macdForSignal, 9);
      // Put signal back into original index space
      const signalLine: number[] = new Array(firstValid).fill(NaN).concat(signalFull);

      // Build entries from most recent 60 bars with valid data
      const entries: { date: string; macd: number; signal: number; histogram: number }[] = [];
      for (let i = closes.length - 1; i >= 0 && entries.length < 60; i--) {
        const m = macdLine[i];
        const s = signalLine[i];
        if (!isNaN(m) && !isNaN(s)) {
          entries.push({ date: dates[i], macd: m, signal: s, histogram: m - s });
        }
      }

      const latest = entries[0] ?? null;
      return { entries, latest };
    },
    enabled: !!ticker && !!getPolygonKey(),
    staleTime: 3600000,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 10000), // exponential: 1s, 2s, 4s
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMA — 50 and 200 day (Polygon, no AV)
// ─────────────────────────────────────────────────────────────────────────────

export function useSma(ticker: string | null, period: 50 | 200) {
  const { data: bars, isLoading } = usePolyBars(ticker);
  const value = useMemo(() => {
    if (!bars || bars.length < period) return null;
    const closes = bars.map(b => b.c);
    const smaVals = calcSma(closes, period);
    // Latest valid value (last bar)
    for (let i = smaVals.length - 1; i >= 0; i--) {
      if (!isNaN(smaVals[i])) return smaVals[i];
    }
    return null;
  }, [bars, period]);
  return { data: value, isLoading };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bollinger Bands — 20-period, 2σ daily (Polygon, no AV)
// ─────────────────────────────────────────────────────────────────────────────

export function useBbands(ticker: string | null) {
  const { data: bars, isLoading, isError } = usePolyBars(ticker);
  const result = useMemo(() => {
    if (!bars || bars.length < 20) return null;
    const closes = bars.map(b => b.c);
    const dates  = bars.map(b => new Date(b.t).toISOString().split("T")[0]);
    const bbVals = calcBbands(closes);
    const entries: { date: string; upper: number; middle: number; lower: number }[] = [];
    for (let i = closes.length - 1; i >= 0 && entries.length < 30; i--) {
      const bb = bbVals[i];
      if (!isNaN(bb.upper)) entries.push({ date: dates[i], ...bb });
    }
    const latest = entries[0] ?? null;
    return { entries, latest };
  }, [bars]);
  return { data: result, isLoading, isError };
}

// ─────────────────────────────────────────────────────────────────────────────
// FMP — Income Statement (annual, last 4 years)
// ─────────────────────────────────────────────────────────────────────────────

export function useFmpIncome(ticker: string | null) {
  return useQuery({
    queryKey: ["/fmp/income", ticker],
    queryFn: async () => {
      const data = await fmpGet(`/stable/income-statement`, {
        symbol: ticker!.toUpperCase(),
        period: "annual",
        limit: "4",
      });
      return (data as any[]).map((r: any) => {
        const rev = r.revenue || 0;
        return {
          date:             r.date,
          period:           r.period,
          revenue:          r.revenue,
          gross_profit:     r.grossProfit,
          gross_margin:     rev ? r.grossProfit    / rev : null,
          operating_income: r.operatingIncome,
          operating_margin: rev ? r.operatingIncome / rev : null,
          net_income:       r.netIncome,
          net_margin:       rev ? r.netIncome       / rev : null,
          ebitda:           r.ebitda,
          eps:              r.eps,
          eps_diluted:      r.epsDiluted,
        };
      });
    },
    enabled: !!ticker && !!getFmpKey(),
    staleTime: 86400000, // 24hr — annual data changes rarely
    retry: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FMP — Key Metrics & Ratios (TTM)
// ─────────────────────────────────────────────────────────────────────────────

export function useFmpRatios(ticker: string | null) {
  return useQuery({
    queryKey: ["/fmp/ratios", ticker],
    queryFn: async () => {
      const [metrics, ratios] = await Promise.all([
        fmpGet(`/stable/key-metrics-ttm`, { symbol: ticker!.toUpperCase() }),
        fmpGet(`/stable/ratios-ttm`,       { symbol: ticker!.toUpperCase() }),
      ]);
      // key-metrics-ttm returns a single object (not array) on stable endpoint
      const m = Array.isArray(metrics) ? (metrics[0] ?? {}) : (metrics ?? {});
      const r = Array.isArray(ratios)  ? (ratios[0]  ?? {}) : (ratios  ?? {});
      return {
        pe_ratio:          r.priceToEarningsRatioTTM,
        pb_ratio:          r.priceToBookRatioTTM,
        ps_ratio:          r.priceToSalesRatioTTM,
        ev_ebitda:         m.evToEBITDATTM          ?? r.enterpriseValueMultipleTTM,
        debt_equity:       r.debtToEquityRatioTTM,
        current_ratio:     r.currentRatioTTM         ?? m.currentRatioTTM,
        roe:               m.returnOnEquityTTM,
        roa:               m.returnOnAssetsTTM,
        roic:              m.returnOnInvestedCapitalTTM,
        gross_margin:      r.grossProfitMarginTTM,
        operating_margin:  r.operatingProfitMarginTTM,
        net_margin:        r.netProfitMarginTTM,
        dividend_yield:    r.dividendYieldTTM,
        payout_ratio:      r.dividendPayoutRatioTTM,
        free_cash_flow:    r.freeCashFlowPerShareTTM,
      };
    },
    enabled: !!ticker && !!getFmpKey(),
    staleTime: 3600000,
    retry: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FMP — Company Profile (sector, industry, description, employees, exchange)
// ─────────────────────────────────────────────────────────────────────────────

export function useFmpProfile(ticker: string | null) {
  return useQuery({
    queryKey: ["/fmp/profile", ticker],
    queryFn: async () => {
      const data = await fmpGet(`/stable/profile`, { symbol: ticker!.toUpperCase() });
      const p = (data as any[])[0] ?? {};
      return {
        name:          p.companyName,
        sector:        p.sector,
        industry:      p.industry,
        description:   p.description,
        employees:     p.fullTimeEmployees,
        exchange:      p.exchangeShortName,
        country:       p.country,
        website:       p.website,
        ceo:           p.ceo,
        ipo_date:      p.ipoDate,
        market_cap:    p.mktCap,
        beta:          p.beta,
        last_dividend: p.lastDiv,
      };
    },
    enabled: !!ticker && !!getFmpKey(),
    staleTime: 86400000,
    retry: false,
  });
}
