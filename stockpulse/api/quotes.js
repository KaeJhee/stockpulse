/**
 * GET /api/quotes?symbol=NVDA
 * Proxies Schwab real-time quote. Returns normalized shape for QuoteHeader.
 * Access token is read from httpOnly cookie — never exposed to the browser.
 */
import { getValidToken, schwabGet } from "./_schwabAuth.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    const { accessToken, setCookies } = await getValidToken(req);
    if (setCookies.length) res.setHeader("Set-Cookie", setCookies);

    // Schwab: GET /quotes/{symbol_id}/quotes  OR  GET /quotes?symbols=NVDA
    const data = await schwabGet(`/quotes`, { symbols: symbol.toUpperCase(), fields: "quote" }, accessToken);

    // Schwab quote response shape: { "NVDA": { quote: { lastPrice, openPrice, highPrice, lowPrice, closePrice, totalVolume, ... } } }
    const q = data[symbol.toUpperCase()]?.quote;
    if (!q) throw new Error("No quote data in response");

    // Normalize to the shape QuoteHeader already expects
    const normalized = {
      lastTrade: { p: q.lastPrice ?? q.mark },
      day: {
        o: q.openPrice,
        h: q.highPrice,
        l: q.lowPrice,
        c: q.lastPrice ?? q.mark,
        v: q.totalVolume,
      },
      prevDay: { c: q.closePrice },
    };

    res.json(normalized);
  } catch (err) {
    if (err.message === "NOT_AUTHENTICATED") {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }
    res.status(500).json({ error: err.message });
  }
}
