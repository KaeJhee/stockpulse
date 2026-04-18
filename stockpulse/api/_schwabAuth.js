/**
 * Shared Schwab OAuth helpers used by all api/ functions.
 * Tokens are stored in httpOnly cookies — the client_secret never reaches the browser.
 */

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/oauth/token";
const SCHWAB_BASE      = "https://api.schwabapi.com/marketdata/v1";

/** Base64-encode "client_id:client_secret" for Basic auth header */
function basicAuth() {
  const creds = `${process.env.SCHWAB_CLIENT_ID}:${process.env.SCHWAB_CLIENT_SECRET}`;
  return Buffer.from(creds).toString("base64");
}

/** Exchange an auth code or refresh token for a new token pair */
async function fetchTokens(body) {
  const res = await fetch(SCHWAB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth()}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Token exchange failed");
  return data; // { access_token, refresh_token, expires_in, ... }
}

/** Parse cookies from the request header into a plain object */
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map(c => c.trim().split("=").map(decodeURIComponent))
  );
}

/**
 * Set secure httpOnly cookies for the token pair.
 * access_token: 30-min session cookie
 * refresh_token: 7-day persistent cookie
 */
function tokenCookies(access_token, refresh_token) {
  const secure    = "Secure; SameSite=Lax; Path=/";
  const accessExp = new Date(Date.now() + 28 * 60 * 1000).toUTCString();   // 28 min
  const refreshExp= new Date(Date.now() + 6.5 * 86400 * 1000).toUTCString(); // 6.5 days
  return [
    `schwab_access=${access_token}; HttpOnly; ${secure}; Expires=${accessExp}`,
    `schwab_refresh=${refresh_token}; HttpOnly; ${secure}; Expires=${refreshExp}`,
  ];
}

/**
 * Get a valid access token from cookies.
 * Auto-refreshes if the access token is missing but a refresh token exists.
 * Returns { accessToken, setCookies } where setCookies may be [] or new cookie strings.
 */
async function getValidToken(req) {
  const cookies = parseCookies(req);
  if (cookies.schwab_access) {
    return { accessToken: cookies.schwab_access, setCookies: [] };
  }
  if (!cookies.schwab_refresh) {
    throw new Error("NOT_AUTHENTICATED");
  }
  // Access token expired — use refresh token
  const tokens = await fetchTokens({
    grant_type:    "refresh_token",
    refresh_token: cookies.schwab_refresh,
    redirect_uri:  process.env.SCHWAB_REDIRECT_URI,
  });
  return {
    accessToken: tokens.access_token,
    setCookies:  tokenCookies(tokens.access_token, tokens.refresh_token),
  };
}

/** Call a Schwab market data endpoint with a valid token */
async function schwabGet(path, params, accessToken) {
  const url = new URL(path, SCHWAB_BASE);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

export { fetchTokens, parseCookies, tokenCookies, getValidToken, schwabGet };
