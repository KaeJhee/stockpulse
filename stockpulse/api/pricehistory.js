/**
 * GET /api/pricehistory?symbol=NVDA&from=2026-01-01&to=2026-04-16&periodType=year&frequencyType=daily&frequency=1
 * Proxies Schwab price history. Returns candles in {t, o, h, l, c, v} format for PriceChart.
 */
import { getValidToken, schwabGet } from "./_schwabAuth.js";

export default async function handler(req, res) {
  const { symbol, from, to, periodType, frequencyType, frequency } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    const { accessToken, setCookies } = await getValidToken(req);
    if (setCookies.length) res.setHeader("Set-Cookie", setCookies);

    const params = {
      periodType:    periodType    || "year",
      frequencyType: frequencyType || "daily",
      frequency:     frequency     || "1",
      needExtendedHoursData: "false",
    };

    // Convert date strings to epoch milliseconds if provided
    if (from) params.startDate = new Date(from).getTime();
    if (to)   params.endDate   = new Date(to + "T23:59:59").getTime();

    const data = await schwabGet(`/pricehistory`, { symbol: symbol.toUpperCase(), ...params }, accessToken);

    // Schwab candles: [{ open, high, low, close, volume, datetime }]
    const results = (data.candles || []).map(c => ({
      t: c.datetime, // already in ms
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));

    res.json({ results, resultsCount: results.length });
  } catch (err) {
    if (err.message === "NOT_AUTHENTICATED") {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }
    res.status(500).json({ error: err.message });
  }
}
