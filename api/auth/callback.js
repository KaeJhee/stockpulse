/**
 * GET /api/auth/callback
 * Schwab redirects here after user login with ?code=...
 * We exchange the code for access + refresh tokens and store them in httpOnly cookies.
 * The user is then redirected back to the dashboard homepage.
 */
import { fetchTokens, tokenCookies } from "../_schwabAuth.js";

export default async function handler(req, res) {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).json({ error, error_description });
  }
  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const tokens = await fetchTokens({
      grant_type:   "authorization_code",
      code:         decodeURIComponent(code),
      redirect_uri: process.env.SCHWAB_REDIRECT_URI,
    });

    const cookies = tokenCookies(tokens.access_token, tokens.refresh_token);
    res.setHeader("Set-Cookie", cookies);

    // Redirect back to the dashboard
    res.redirect(302, "/");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
