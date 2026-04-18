import type { Express } from "express";
import { createServer, type Server } from "http";

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || "YOUR_API_KEY_HERE";
const POLYGON_BASE = "https://api.polygon.io";

async function polygonFetch(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, POLYGON_BASE);
  url.searchParams.set("apiKey", POLYGON_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polygon API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Ticker search/autocomplete
  app.get("/api/tickers/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) return res.json({ results: [] });
      const data = await polygonFetch("/v3/reference/tickers", {
        search: query,
        active: "true",
        limit: "10",
        market: "stocks",
      });
      res.json({ results: data.results || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Ticker details
  app.get("/api/ticker/:ticker/details", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await polygonFetch(`/v3/reference/tickers/${ticker.toUpperCase()}`);
      res.json(data.results || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Snapshot — real-time quote data
  app.get("/api/ticker/:ticker/snapshot", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await polygonFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker.toUpperCase()}`);
      res.json(data.ticker || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Previous close (fallback for snapshot)
  app.get("/api/ticker/:ticker/prev", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await polygonFetch(`/v2/aggs/ticker/${ticker.toUpperCase()}/prev`);
      res.json(data.results?.[0] || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Aggregates (OHLCV bars) for charting
  app.get("/api/ticker/:ticker/aggregates", async (req, res) => {
    try {
      const { ticker } = req.params;
      const { from, to, timespan, multiplier } = req.query as Record<string, string>;
      const ts = timespan || "day";
      const mult = multiplier || "1";
      const data = await polygonFetch(
        `/v2/aggs/ticker/${ticker.toUpperCase()}/range/${mult}/${ts}/${from}/${to}`,
        { adjusted: "true", sort: "asc", limit: "50000" }
      );
      res.json({ results: data.results || [], resultsCount: data.resultsCount || 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Ticker news
  app.get("/api/ticker/:ticker/news", async (req, res) => {
    try {
      const { ticker } = req.params;
      const limit = (req.query.limit as string) || "20";
      const data = await polygonFetch("/v2/reference/news", {
        ticker: ticker.toUpperCase(),
        limit,
        order: "desc",
        sort: "published_utc",
      });
      res.json({ results: data.results || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Financial data (quarterly/annual from SEC filings)
  app.get("/api/ticker/:ticker/financials", async (req, res) => {
    try {
      const { ticker } = req.params;
      const timeframe = (req.query.timeframe as string) || "quarterly";
      const limit = (req.query.limit as string) || "8";
      const data = await polygonFetch("/vX/reference/financials", {
        ticker: ticker.toUpperCase(),
        timeframe,
        limit,
        sort: "period_of_report_date",
        order: "desc",
        include_sources: "false",
      });
      res.json({ results: data.results || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Earnings estimates — Benzinga partner endpoint via Massive/Polygon
  // Returns historical earnings with actuals vs estimates (beat/miss),
  // plus upcoming earnings events with analyst consensus estimates.
  app.get("/api/ticker/:ticker/earnings", async (req, res) => {
    try {
      const { ticker } = req.params;
      // Fetch both past (last 8 quarters) and upcoming (next 2 quarters)
      // by using a date range spanning ~2 years back to ~6 months forward
      const now = new Date();
      const fromDate = new Date(now);
      fromDate.setFullYear(fromDate.getFullYear() - 2);
      const toDate = new Date(now);
      toDate.setMonth(toDate.getMonth() + 6);

      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const data = await polygonFetch("/benzinga/v1/earnings", {
        ticker: ticker.toUpperCase(),
        date_from: fmt(fromDate),
        date_to: fmt(toDate),
        pagesize: "20",
      });

      res.json({ results: data.data || data.results || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Analyst price targets and ratings
  app.get("/api/ticker/:ticker/analyst-ratings", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await polygonFetch("/benzinga/v1/analyst-ratings", {
        ticker: ticker.toUpperCase(),
        pagesize: "20",
        sort: "date",
        order: "desc",
      });
      res.json({ results: data.data || data.results || [] });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // RSI indicator
  app.get("/api/ticker/:ticker/rsi", async (req, res) => {
    try {
      const { ticker } = req.params;
      const data = await polygonFetch(`/v1/indicators/rsi/${ticker.toUpperCase()}`, {
        timespan: "day",
        window: "14",
        series_type: "close",
        limit: "1",
      });
      res.json(data.results?.values?.[0] || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // SMA indicator
  app.get("/api/ticker/:ticker/sma", async (req, res) => {
    try {
      const { ticker } = req.params;
      const window = (req.query.window as string) || "50";
      const data = await polygonFetch(`/v1/indicators/sma/${ticker.toUpperCase()}`, {
        timespan: "day",
        window,
        series_type: "close",
        limit: "1",
      });
      res.json(data.results?.values?.[0] || {});
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return httpServer;
}
