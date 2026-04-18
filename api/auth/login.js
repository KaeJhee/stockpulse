/**
 * GET /api/auth/login
 * Redirects the user to Schwab's OAuth login page.
 * After the user logs in, Schwab redirects back to /api/auth/callback.
 */
export default function handler(req, res) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     process.env.SCHWAB_CLIENT_ID,
    redirect_uri:  process.env.SCHWAB_REDIRECT_URI,
    scope:         "readonly",
  });
  res.redirect(302, `https://api.schwabapi.com/oauth/authorize?${params}`);
}
