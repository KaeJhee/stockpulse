/**
 * GET /api/auth/status
 * Returns whether the user has a valid session (access or refresh token present).
 * The dashboard uses this to decide whether to show the "Connect Schwab" button.
 */
import { parseCookies } from "../_schwabAuth.js";

export default function handler(req, res) {
  const cookies = parseCookies(req);
  const authenticated = !!(cookies.schwab_access || cookies.schwab_refresh);
  res.json({ authenticated });
}
