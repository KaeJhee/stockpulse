/**
 * GET /api/auth/logout
 * Clears the token cookies, effectively logging the user out.
 */
export default function handler(req, res) {
  res.setHeader("Set-Cookie", [
    "schwab_access=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
    "schwab_refresh=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
  ]);
  res.redirect(302, "/");
}
