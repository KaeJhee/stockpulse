/**
 * GET /api/auth/login
 * Redirects the user to Schwab's OAuth login page.
 * After the user logs in, Schwab redirects back to /api/auth/callback.
 */
export default function handler(req, res) {
  const state = Math.random().toString(36).substring(2, 15);
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     process.env.SCHWAB_CLIENT_ID,
    redirect_uri:  process.env.SCHWAB_REDIRECT_URI,
    scope:         "readonly",
    state:         state,
  });
  res.redirect(302, `https://api.schwabapi.com/v1/oauth/authorize?${params}`);
}
