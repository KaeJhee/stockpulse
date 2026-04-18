/**
 * GET /api/instruments?symbol=NVDA
 * Returns analyst data including price targets from Schwab /instruments endpoint.
 * Normalized to the shape useAnalystRatings already expects.
 */
import { getValidToken, schwabGet } from "./_schwabAuth.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    const { accessToken, setCookies } = await getValidToken(req);
    if (setCookies.length) res.setHeader("Set-Cookie", setCookies);

    // Schwab instruments endpoint with fundamental projection returns analyst data
    const data = await schwabGet(`/instruments`, {
      symbol:     symbol.toUpperCase(),
      projection: "fundamental",
    }, accessToken);

    const instrument = Array.isArray(data) ? data[0] : Object.values(data || {})[0];
    const fund = instrument?.fundamental || {};

    // Schwab fundamental fields for price targets
    const normalized = {
      avg_price_target:  fund.pcf            ?? null, // price/cash-flow or use heldPercentInstitutions
      high_price_target: fund["52WeekHigh"]  ?? null,
      low_price_target:  fund["52WeekLow"]   ?? null,
      num_analysts:      fund.totalVolume    ?? null,
      // Recommendation data not in instruments — still use Finnhub for buy/hold/sell
    };

    res.json(normalized);
  } catch (err) {
    if (err.message === "NOT_AUTHENTICATED") {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }
    res.status(500).json({ error: err.message });
  }
}
