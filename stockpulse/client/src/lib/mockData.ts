// Mock data for demo mode (when no API key is configured)

export const MOCK_DETAILS: Record<string, any> = {
  AAPL: { name: "Apple Inc.", market_cap: 3420000000000, primary_exchange: "XNAS", type: "CS" },
  NVDA: { name: "NVIDIA Corporation", market_cap: 2890000000000, primary_exchange: "XNAS", type: "CS" },
  MSFT: { name: "Microsoft Corporation", market_cap: 3100000000000, primary_exchange: "XNAS", type: "CS" },
  TSLA: { name: "Tesla, Inc.", market_cap: 780000000000, primary_exchange: "XNAS", type: "CS" },
  GOOGL: { name: "Alphabet Inc.", market_cap: 2100000000000, primary_exchange: "XNAS", type: "CS" },
};

export const MOCK_SNAPSHOT: Record<string, any> = {
  AAPL: {
    lastTrade: { p: 237.42 },
    prevDay: { c: 234.18, o: 233.50, h: 236.80, l: 232.90, v: 48500000 },
    day: { o: 235.20, h: 238.15, l: 234.80, c: 237.42, v: 52300000 },
  },
  NVDA: {
    lastTrade: { p: 142.85 },
    prevDay: { c: 139.20, o: 138.50, h: 140.90, l: 137.60, v: 310000000 },
    day: { o: 140.10, h: 143.70, l: 139.55, c: 142.85, v: 285000000 },
  },
  MSFT: {
    lastTrade: { p: 418.30 },
    prevDay: { c: 415.60, o: 414.90, h: 417.20, l: 413.50, v: 22100000 },
    day: { o: 416.00, h: 419.80, l: 415.20, c: 418.30, v: 19800000 },
  },
  TSLA: {
    lastTrade: { p: 268.50 },
    prevDay: { c: 272.40, o: 273.10, h: 275.80, l: 270.20, v: 98000000 },
    day: { o: 271.00, h: 273.50, l: 265.80, c: 268.50, v: 102000000 },
  },
  GOOGL: {
    lastTrade: { p: 175.20 },
    prevDay: { c: 173.80, o: 173.20, h: 175.00, l: 172.50, v: 28500000 },
    day: { o: 174.00, h: 176.30, l: 173.50, c: 175.20, v: 25600000 },
  },
};

function generateMockAggregates(ticker: string, days: number): any[] {
  const snap = MOCK_SNAPSHOT[ticker] || MOCK_SNAPSHOT.AAPL;
  const basePrice = snap.lastTrade.p;
  const results = [];
  const now = Date.now();

  for (let i = days; i >= 0; i--) {
    const ts = now - i * 86400000;
    const volatility = 0.02;
    const drift = (Math.random() - 0.48) * volatility;
    const dayProgress = (days - i) / days;
    const trendFactor = 1 + (dayProgress - 0.5) * 0.1;
    const price = basePrice * trendFactor * (1 + drift);
    const high = price * (1 + Math.random() * 0.015);
    const low = price * (1 - Math.random() * 0.015);
    results.push({
      t: ts,
      o: +(price * (1 + (Math.random() - 0.5) * 0.005)).toFixed(2),
      h: +high.toFixed(2),
      l: +low.toFixed(2),
      c: +price.toFixed(2),
      v: Math.floor(Math.random() * 50000000 + 20000000),
    });
  }
  return results;
}

export function getMockAggregates(ticker: string, from: string, to: string): any[] {
  const fromDate = new Date(from).getTime();
  const toDate = new Date(to).getTime();
  const days = Math.max(1, Math.round((toDate - fromDate) / 86400000));
  return generateMockAggregates(ticker, days);
}

export const MOCK_NEWS: Record<string, any[]> = {
  AAPL: [
    { title: "Apple Announces New AI Features for iPhone 17 Lineup", description: "Apple is set to introduce groundbreaking AI capabilities in its upcoming iPhone 17 series, leveraging on-device processing for enhanced privacy.", publisher: { name: "Bloomberg" }, published_utc: new Date(Date.now() - 3600000).toISOString(), article_url: "#", tickers: ["AAPL"] },
    { title: "Apple Services Revenue Hits Record $25B in Q1 2026", description: "The company's services segment continues to grow, driven by App Store, Apple TV+, and Apple One subscriptions.", publisher: { name: "CNBC" }, published_utc: new Date(Date.now() - 7200000).toISOString(), article_url: "#", tickers: ["AAPL"] },
    { title: "Analysts Raise Apple Price Target on Strong Demand Signals", description: "Multiple Wall Street firms raised their price targets for Apple following supplier reports indicating strong component orders.", publisher: { name: "Reuters" }, published_utc: new Date(Date.now() - 14400000).toISOString(), article_url: "#", tickers: ["AAPL", "TSM"] },
    { title: "Apple Expands India Manufacturing to Reduce China Dependency", description: "The tech giant is accelerating its production shift to India, with new assembly lines coming online in Karnataka.", publisher: { name: "WSJ" }, published_utc: new Date(Date.now() - 28800000).toISOString(), article_url: "#", tickers: ["AAPL"] },
    { title: "Apple Vision Pro 2 Rumors Point to Significant Price Cut", description: "Next-generation mixed reality headset expected to start at $1,999, down from $3,499 for the original model.", publisher: { name: "The Verge" }, published_utc: new Date(Date.now() - 43200000).toISOString(), article_url: "#", tickers: ["AAPL", "META"] },
  ],
  NVDA: [
    { title: "NVIDIA Blackwell Ultra GPUs See Record Pre-Orders", description: "Data center demand for NVIDIA's latest AI training chips exceeds supply by 3x, with delivery times extending to Q3 2026.", publisher: { name: "Bloomberg" }, published_utc: new Date(Date.now() - 1800000).toISOString(), article_url: "#", tickers: ["NVDA", "TSM"] },
    { title: "NVIDIA Partners with Leading Automakers on Autonomous Driving", description: "New partnerships announced at GTC 2026 conference expand NVIDIA's automotive AI platform presence.", publisher: { name: "Reuters" }, published_utc: new Date(Date.now() - 5400000).toISOString(), article_url: "#", tickers: ["NVDA"] },
    { title: "Jensen Huang Discusses AI Sovereignty at World Economic Forum", description: "NVIDIA CEO outlines vision for national AI infrastructure and sovereign computing capabilities.", publisher: { name: "CNBC" }, published_utc: new Date(Date.now() - 10800000).toISOString(), article_url: "#", tickers: ["NVDA"] },
  ],
};

export function getMockNews(ticker: string): any[] {
  if (MOCK_NEWS[ticker]) return MOCK_NEWS[ticker];
  return [
    { title: `${ticker} Reports Strong Quarter Amid Market Volatility`, description: `${ticker} shares move on earnings results that came in ahead of analyst expectations.`, publisher: { name: "MarketWatch" }, published_utc: new Date(Date.now() - 3600000).toISOString(), article_url: "#", tickers: [ticker] },
    { title: `Analysts Weigh In on ${ticker} After Recent Performance`, description: `Multiple research firms update their outlook on ${ticker} following recent market activity.`, publisher: { name: "Seeking Alpha" }, published_utc: new Date(Date.now() - 7200000).toISOString(), article_url: "#", tickers: [ticker] },
    { title: `${ticker} Announces Strategic Partnership in Emerging Markets`, description: `The company expands its global footprint with a new partnership aimed at accelerating growth in key regions.`, publisher: { name: "Reuters" }, published_utc: new Date(Date.now() - 14400000).toISOString(), article_url: "#", tickers: [ticker] },
  ];
}

export function getMockFinancials(ticker: string): any[] {
  const base = MOCK_SNAPSHOT[ticker]?.lastTrade?.p || 200;
  const baseRev = base * 400000000;
  const quarters = [];
  const now = new Date();

  for (let i = 0; i < 8; i++) {
    const qDate = new Date(now);
    qDate.setMonth(qDate.getMonth() - 3 * i);
    const growth = 1 + (8 - i) * 0.02;
    const revenue = baseRev * growth * (0.95 + Math.random() * 0.1);
    const grossProfit = revenue * (0.38 + Math.random() * 0.08);
    const operatingIncome = grossProfit * (0.35 + Math.random() * 0.1);
    const netIncome = operatingIncome * (0.8 + Math.random() * 0.1);
    const eps = netIncome / 15000000000;

    const fiscalQ = (Math.floor(qDate.getMonth() / 3) + 1);
    const fiscalY = qDate.getFullYear();

    quarters.push({
      end_date: qDate.toISOString().split("T")[0],
      fiscal_period: `Q${fiscalQ}`,
      fiscal_year: fiscalY.toString(),
      filing_date: new Date(qDate.getTime() + 30 * 86400000).toISOString().split("T")[0],
      financials: {
        income_statement: {
          revenues: { value: Math.round(revenue) },
          gross_profit: { value: Math.round(grossProfit) },
          operating_income_loss: { value: Math.round(operatingIncome) },
          net_income_loss: { value: Math.round(netIncome) },
          basic_earnings_per_share: { value: +eps.toFixed(2) },
        },
      },
    });
  }
  return quarters;
}

// ─── EARNINGS WITH ESTIMATES (beat/miss + future projections) ───────────────

/** Seed-based "random" so values don't change on re-render */
function seededRand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export interface EarningsRecord {
  id: string;
  date: string;              // YYYY-MM-DD report date
  fiscal_period: string;     // "Q1 2026"
  fiscal_quarter: number;
  fiscal_year: number;
  time: string;              // "BMO" | "AMC" | "—"
  // Actuals (null = not yet reported)
  actual_eps: number | null;
  actual_revenue: number | null;
  // Estimates (consensus)
  estimated_eps: number | null;
  estimated_revenue: number | null;
  // Prior year same quarter
  prior_year_eps: number | null;
  prior_year_revenue: number | null;
  // Surprise
  eps_surprise: number | null;       // % surprise vs estimate
  revenue_surprise: number | null;
  // Status
  is_upcoming: boolean;
  // Analyst consensus for upcoming
  num_analysts_eps?: number;
  num_analysts_revenue?: number;
  eps_estimate_high?: number | null;
  eps_estimate_low?: number | null;
  revenue_estimate_high?: number | null;
  revenue_estimate_low?: number | null;
}

export function getMockEarnings(ticker: string): EarningsRecord[] {
  const snap = MOCK_SNAPSHOT[ticker] || MOCK_SNAPSHOT.AAPL;
  const basePrice = snap.lastTrade?.p || 200;
  const baseRev = basePrice * 400000000;
  const baseEps = basePrice / 200;

  const now = new Date();
  const currentQ = Math.floor(now.getMonth() / 3) + 1;
  const currentYear = now.getFullYear();

  const records: EarningsRecord[] = [];

  // 8 past quarters + 2 upcoming quarters
  for (let i = -7; i <= 2; i++) {
    // i=0 is current quarter, negative = past, positive = future
    const totalQOffset = (currentQ - 1) + i;
    const fiscalYear = currentYear + Math.floor(totalQOffset / 4);
    const fiscalQ = ((totalQOffset % 4) + 4) % 4 + 1;

    // Report date (end of quarter + ~30 days for reporting)
    const qEndMonth = fiscalQ * 3 - 1; // last month of quarter
    const reportDate = new Date(fiscalYear, qEndMonth, 28 + Math.floor(seededRand(i + 100) * 7));
    reportDate.setDate(reportDate.getDate() + 28); // ~4 weeks after Q end

    const isUpcoming = reportDate > now;

    // Base values with deterministic variation
    const seed = ticker.charCodeAt(0) + i * 17;
    const growthFactor = 1 + (8 - Math.abs(i)) * 0.015;
    const noiseMult = 0.92 + seededRand(seed) * 0.16;

    const actualRev = isUpcoming ? null : Math.round(baseRev * growthFactor * noiseMult);
    const estRev = Math.round(baseRev * growthFactor * (0.97 + seededRand(seed + 1) * 0.06));

    const actualEps = isUpcoming ? null : +(baseEps * growthFactor * noiseMult * (0.8 + seededRand(seed + 2) * 0.4)).toFixed(2);
    const estEps = +(baseEps * growthFactor * (0.95 + seededRand(seed + 3) * 0.1)).toFixed(2);

    const priorRev = Math.round(baseRev * (growthFactor - 0.06) * (0.94 + seededRand(seed + 4) * 0.12));
    const priorEps = +(baseEps * (growthFactor - 0.06) * (0.9 + seededRand(seed + 5) * 0.2)).toFixed(2);

    const epsSurprise = actualEps != null && estEps
      ? +((actualEps - estEps) / Math.abs(estEps) * 100).toFixed(2)
      : null;
    const revSurprise = actualRev != null && estRev
      ? +((actualRev - estRev) / Math.abs(estRev) * 100).toFixed(2)
      : null;

    // Estimate range for upcoming quarters
    const spreadFactor = isUpcoming ? 0.05 + seededRand(seed + 6) * 0.03 : 0;
    const numAnalysts = isUpcoming ? 18 + Math.floor(seededRand(seed + 7) * 14) : undefined;

    records.push({
      id: `${ticker}-Q${fiscalQ}-${fiscalYear}`,
      date: reportDate.toISOString().split("T")[0],
      fiscal_period: `Q${fiscalQ} ${fiscalYear}`,
      fiscal_quarter: fiscalQ,
      fiscal_year: fiscalYear,
      time: seededRand(seed + 8) > 0.5 ? "BMO" : "AMC",
      actual_eps: actualEps,
      actual_revenue: actualRev,
      estimated_eps: estEps,
      estimated_revenue: estRev,
      prior_year_eps: priorEps,
      prior_year_revenue: priorRev,
      eps_surprise: epsSurprise,
      revenue_surprise: revSurprise,
      is_upcoming: isUpcoming,
      num_analysts_eps: numAnalysts,
      num_analysts_revenue: numAnalysts ? numAnalysts - 2 : undefined,
      eps_estimate_high: isUpcoming ? +(estEps * (1 + spreadFactor)).toFixed(2) : null,
      eps_estimate_low: isUpcoming ? +(estEps * (1 - spreadFactor)).toFixed(2) : null,
      revenue_estimate_high: isUpcoming ? Math.round(estRev * (1 + spreadFactor)) : null,
      revenue_estimate_low: isUpcoming ? Math.round(estRev * (1 - spreadFactor)) : null,
    });
  }

  // Most recent first
  return records.reverse();
}

export function getMockAnalystRatings(ticker: string): any {
  const snap = MOCK_SNAPSHOT[ticker] || MOCK_SNAPSHOT.AAPL;
  const price = snap.lastTrade?.p || 200;
  const seed = ticker.charCodeAt(0) + ticker.charCodeAt(1 % ticker.length);

  const avgTarget = +(price * (1.12 + seededRand(seed) * 0.15)).toFixed(2);
  const highTarget = +(avgTarget * (1.12 + seededRand(seed + 1) * 0.1)).toFixed(2);
  const lowTarget = +(avgTarget * (0.82 - seededRand(seed + 2) * 0.1)).toFixed(2);
  const totalAnalysts = 28 + Math.floor(seededRand(seed + 3) * 16);
  const buyCount = Math.floor(totalAnalysts * (0.5 + seededRand(seed + 4) * 0.3));
  const holdCount = Math.floor((totalAnalysts - buyCount) * (0.5 + seededRand(seed + 5) * 0.3));
  const sellCount = totalAnalysts - buyCount - holdCount;

  return {
    avg_price_target: avgTarget,
    high_price_target: highTarget,
    low_price_target: lowTarget,
    total_analysts: totalAnalysts,
    buy: buyCount,
    hold: holdCount,
    sell: sellCount,
    consensus: buyCount / totalAnalysts > 0.6 ? "Strong Buy" : buyCount / totalAnalysts > 0.45 ? "Buy" : holdCount / totalAnalysts > 0.5 ? "Hold" : "Sell",
  };
}
