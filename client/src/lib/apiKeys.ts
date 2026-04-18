// ─────────────────────────────────────────────────────────────────────────────
// API Key storage — persisted in localStorage, readable anywhere in the app
// ─────────────────────────────────────────────────────────────────────────────

const LS_FINNHUB   = "sp_finnhub_key";
const LS_POLYGON   = "sp_polygon_key";
const LS_AV        = "sp_av_key";
const LS_FMP       = "sp_fmp_key";
const LS_MARKETAUX = "sp_marketaux_key";

// Built-in fallback keys (free tier) — work out of the box, user can override
const DEFAULT_FINNHUB   = "d7c01o9r01quh9fc0qmgd7c01o9r01quh9fc0qn0";
const DEFAULT_POLYGON   = "YGkqUbEw1R_FLmOAxLY023rlVOAEoWQU";
const DEFAULT_AV        = ""; // No shared default — AV free tier is 25 req/day
const DEFAULT_FMP       = ""; // No shared default — enter your own key
const DEFAULT_MARKETAUX = ""; // No shared default — enter your own key

export function getFinnhubKey(): string {
  return localStorage.getItem(LS_FINNHUB) || DEFAULT_FINNHUB;
}
export function getPolygonKey(): string {
  return localStorage.getItem(LS_POLYGON) || DEFAULT_POLYGON;
}
export function getAvKey(): string {
  return localStorage.getItem(LS_AV) || DEFAULT_AV;
}
export function getFmpKey(): string {
  return localStorage.getItem(LS_FMP) || DEFAULT_FMP;
}
export function getMarketauxKey(): string {
  return localStorage.getItem(LS_MARKETAUX) || DEFAULT_MARKETAUX;
}

export function setFinnhubKey(key: string) {
  key.trim() ? localStorage.setItem(LS_FINNHUB, key.trim()) : localStorage.removeItem(LS_FINNHUB);
}
export function setPolygonKey(key: string) {
  key.trim() ? localStorage.setItem(LS_POLYGON, key.trim()) : localStorage.removeItem(LS_POLYGON);
}
export function setAvKey(key: string) {
  key.trim() ? localStorage.setItem(LS_AV, key.trim()) : localStorage.removeItem(LS_AV);
}
export function setFmpKey(key: string) {
  key.trim() ? localStorage.setItem(LS_FMP, key.trim()) : localStorage.removeItem(LS_FMP);
}
export function setMarketauxKey(key: string) {
  key.trim() ? localStorage.setItem(LS_MARKETAUX, key.trim()) : localStorage.removeItem(LS_MARKETAUX);
}

export function getStoredKeys() {
  return {
    finnhub:   localStorage.getItem(LS_FINNHUB)   || "",
    polygon:   localStorage.getItem(LS_POLYGON)   || "",
    av:        localStorage.getItem(LS_AV)        || "",
    fmp:       localStorage.getItem(LS_FMP)       || "",
    marketaux: localStorage.getItem(LS_MARKETAUX) || "",
  };
}

export function keysAreCustom() {
  return !!(localStorage.getItem(LS_FINNHUB) || localStorage.getItem(LS_POLYGON)
         || localStorage.getItem(LS_AV)       || localStorage.getItem(LS_FMP)
         || localStorage.getItem(LS_MARKETAUX));
}
