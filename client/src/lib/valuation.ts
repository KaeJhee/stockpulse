/**
 * Valuation math for the Valuation Lab. Pure, typed, no React, no I/O.
 *
 * Conventions
 *   - Rates are decimals (0.09 = 9%).
 *   - Cash flows are end-of-year; year t is discounted by (1 + r)^t.
 *   - Money values are in whatever unit the caller uses (the Lab uses $ millions),
 *     shares in the matching unit (millions), so per-share values come out in $.
 *
 * Growth path (two-stage with linear fade):
 *   years 1..N1          g_t = g1
 *   years N1+1..N        g_t = g1 + (gT - g1) * (t - N1) / (N - N1)   (reaches gT in year N)
 * Terminal value at year N:
 *   Gordon:       TV = FCF_N * (1 + gT) / (r - gT)       (requires r > gT)
 *   Exit multiple TV = FCF_N * multiple
 */

export interface DcfParams {
  /** Base-year (year 0) free cash flow. */
  baseFcf: number;
  /** Growth rate for years 1..highYears. */
  growth: number;
  /** Long-run growth after the forecast horizon. */
  terminalGrowth: number;
  /** Discount rate (cost of capital). */
  discountRate: number;
  /** Shares outstanding (same unit scale as cash flows). */
  shares: number;
  /** Net cash (positive) or net debt (negative), added to enterprise value. */
  netCash?: number;
  /** Years at the high growth rate (default 5). */
  highYears?: number;
  /** Total explicit forecast years (default 10). */
  years?: number;
  /** When set, terminal value = FCF_N * exitMultiple instead of Gordon growth. */
  exitMultiple?: number | null;
}

export interface DcfYear {
  year: number;
  growth: number;
  fcf: number;
  discountFactor: number;
  pv: number;
}

export interface DcfResult {
  years: DcfYear[];
  /** Sum of PV of explicit-period cash flows. */
  pvExplicit: number;
  /** Undiscounted terminal value at year N. */
  terminalValue: number;
  /** PV of terminal value. */
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
  /** Equity value per share (NaN when shares <= 0). */
  perShare: number;
  /** PV terminal / enterprise value (0..1, NaN when EV is 0). */
  terminalShare: number;
  /** False when inputs were invalid (r <= gT under Gordon, non-finite inputs). */
  valid: boolean;
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Growth rate applied in year t (1-indexed). */
export function growthForYear(t: number, growth: number, terminalGrowth: number, highYears = 5, years = 10): number {
  if (t <= highYears) return growth;
  const fadeYears = Math.max(1, years - highYears);
  const k = Math.min(1, (t - highYears) / fadeYears);
  return growth + (terminalGrowth - growth) * k;
}

/** Gordon growth terminal value at the end of the horizon. NaN when r <= g. */
export function terminalValue(finalFcf: number, discountRate: number, terminalGrowth: number): number {
  if (!(discountRate > terminalGrowth)) return NaN;
  return (finalFcf * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
}

/** Equity value per share; NaN when shares are missing or non-positive. */
export function perShare(equityValue: number, shares: number): number {
  if (!isNum(equityValue) || !isNum(shares) || shares <= 0) return NaN;
  return equityValue / shares;
}

/** Discounted cash flow with linear fade to terminal growth. */
export function dcf(p: DcfParams): DcfResult {
  const highYears = p.highYears ?? 5;
  const N = p.years ?? 10;
  const netCash = isNum(p.netCash) ? p.netCash : 0;
  const useExit = isNum(p.exitMultiple);
  const valid =
    isNum(p.baseFcf) &&
    isNum(p.growth) &&
    isNum(p.terminalGrowth) &&
    isNum(p.discountRate) &&
    p.discountRate > -1 &&
    (useExit || p.discountRate > p.terminalGrowth);

  const years: DcfYear[] = [];
  let fcf = p.baseFcf;
  let pvExplicit = 0;
  for (let t = 1; t <= N; t++) {
    const g = growthForYear(t, p.growth, p.terminalGrowth, highYears, N);
    fcf = fcf * (1 + g);
    const discountFactor = 1 / Math.pow(1 + p.discountRate, t);
    const pv = fcf * discountFactor;
    pvExplicit += pv;
    years.push({ year: t, growth: g, fcf, discountFactor, pv });
  }

  const finalFcf = years.length ? years[years.length - 1].fcf : p.baseFcf;
  const tv = useExit ? finalFcf * (p.exitMultiple as number) : terminalValue(finalFcf, p.discountRate, p.terminalGrowth);
  const pvTerminal = tv / Math.pow(1 + p.discountRate, N);
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue + netCash;

  return {
    years,
    pvExplicit,
    terminalValue: tv,
    pvTerminal,
    enterpriseValue,
    equityValue,
    perShare: valid ? perShare(equityValue, p.shares) : NaN,
    terminalShare: enterpriseValue !== 0 ? pvTerminal / enterpriseValue : NaN,
    valid,
  };
}

/** Gordon-equivalent exit multiple on final-year FCF: (1 + gT) / (r - gT). */
export function gordonMultiple(discountRate: number, terminalGrowth: number): number {
  return discountRate > terminalGrowth ? (1 + terminalGrowth) / (discountRate - terminalGrowth) : NaN;
}

export interface SensitivityCell {
  discountRate: number;
  terminalGrowth: number;
  /** Per-share value (NaN when r <= gT). */
  value: number;
  /** Value / price - 1 (NaN when price missing). */
  upside: number;
}

export interface SensitivityGrid {
  rates: number[];
  growths: number[];
  /** cells[row = discount rate][col = terminal growth] */
  cells: SensitivityCell[][];
  min: number;
  max: number;
}

/**
 * Steps centered on a value: center + (i - half) * step for i in 0..n-1.
 * The center is kept exact (not rounded) so the grid's middle cell equals the plain DCF
 * at the same inputs bit for bit; the other steps are rounded to strip float noise.
 */
export function centeredSteps(center: number, step: number, n = 7): number[] {
  const half = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => (i === half ? center : +(center + (i - half) * step).toFixed(6)));
}

/** Discount-rate × terminal-growth grid of per-share values. */
export function sensitivityGrid(
  base: DcfParams,
  price: number | null | undefined,
  opts: { rateStep?: number; growthStep?: number; size?: number; minSpread?: number } = {},
): SensitivityGrid {
  const minSpread = opts.minSpread ?? 0;
  const size = opts.size ?? 7;
  const rates = centeredSteps(base.discountRate, opts.rateStep ?? 0.005, size);
  const growths = centeredSteps(base.terminalGrowth, opts.growthStep ?? 0.0025, size);
  let min = Infinity;
  let max = -Infinity;
  const cells = rates.map((r) =>
    growths.map((g) => {
      const value = r > g && r - g >= minSpread - 1e-12 ? dcf({ ...base, discountRate: r, terminalGrowth: g, exitMultiple: null }).perShare : NaN;
      if (isNum(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const upside = isNum(value) && isNum(price) && price > 0 ? value / price - 1 : NaN;
      return { discountRate: r, terminalGrowth: g, value, upside };
    }),
  );
  return { rates, growths, cells, min: isNum(min) ? min : NaN, max: isNum(max) ? max : NaN };
}

export interface ImpliedGrowthResult {
  /** Year 1-5 growth that makes per-share value equal the target price, or null. */
  growth: number | null;
  iterations: number;
  /** Why no solution was found, when growth is null. */
  reason?: "no-price" | "invalid-inputs" | "non-positive-fcf" | "below-range" | "above-range";
}

/**
 * Reverse DCF: bisection on the year 1-5 growth rate so that dcf(...).perShare == price.
 * Per-share value is increasing in growth when base FCF > 0, so bisection is safe.
 */
export function impliedGrowth(
  base: DcfParams,
  price: number | null | undefined,
  opts: { lo?: number; hi?: number; tol?: number; maxIter?: number } = {},
): ImpliedGrowthResult {
  if (!isNum(price) || price <= 0) return { growth: null, iterations: 0, reason: "no-price" };
  if (!isNum(base.baseFcf) || base.baseFcf <= 0) return { growth: null, iterations: 0, reason: "non-positive-fcf" };
  if ((!(base.discountRate > base.terminalGrowth) && !isNum(base.exitMultiple)) || !(base.shares > 0)) {
    return { growth: null, iterations: 0, reason: "invalid-inputs" };
  }
  let lo = opts.lo ?? -0.5;
  let hi = opts.hi ?? 1.0;
  const tol = opts.tol ?? 1e-9;
  const maxIter = opts.maxIter ?? 200;
  const f = (g: number) => dcf({ ...base, growth: g }).perShare - price;
  const flo = f(lo);
  const fhi = f(hi);
  if (!isNum(flo) || !isNum(fhi)) return { growth: null, iterations: 0, reason: "invalid-inputs" };
  if (flo > 0) return { growth: null, iterations: 0, reason: "below-range" };
  if (fhi < 0) return { growth: null, iterations: 0, reason: "above-range" };
  let i = 0;
  let mid = (lo + hi) / 2;
  for (; i < maxIter; i++) {
    mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-10 || hi - lo < tol) break;
    if (fm < 0) lo = mid;
    else hi = mid;
  }
  return { growth: mid, iterations: i + 1 };
}

/** Normalizes weights to sum to 1 (equal weights when all are zero). */
export function normalizeWeights(weights: number[]): number[] {
  const clean = weights.map((w) => (isNum(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  if (sum <= 0) return clean.map(() => 1 / (clean.length || 1));
  return clean.map((w) => w / sum);
}

/** Probability-weighted value; weights are normalized. Non-finite values are skipped (their weight redistributed). */
export function weightedFairValue(items: { value: number; weight: number }[]): number {
  const usable = items.filter((i) => isNum(i.value));
  if (!usable.length) return NaN;
  const w = normalizeWeights(usable.map((i) => i.weight));
  return usable.reduce((acc, it, k) => acc + it.value * w[k], 0);
}

/**
 * Rebalances integer percentage weights after one weight changes, keeping the sum at 100.
 * The other weights are scaled in proportion to their previous values.
 */
export function rebalanceWeights(weights: number[], index: number, next: number): number[] {
  const n = weights.length;
  const v = Math.max(0, Math.min(100, Math.round(next)));
  const rest = 100 - v;
  const others = weights.map((w, i) => (i === index ? 0 : Math.max(0, w)));
  const otherSum = others.reduce((a, b) => a + b, 0);
  const raw = others.map((w, i) => (i === index ? 0 : otherSum > 0 ? (w / otherSum) * rest : rest / (n - 1)));
  const out = raw.map((x) => Math.floor(x));
  out[index] = v;
  // distribute rounding remainder to the largest fractional parts
  let remainder = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .filter((o) => o.i !== index)
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && order.length; k = (k + 1) % order.length, remainder--) out[order[k].i] += 1;
  return out;
}

export type MultipleKind = "pe" | "ev_ebitda" | "ps";

/**
 * Per-share value from a multiple.
 *   pe:        metric = EPS (per share)          → EPS × multiple
 *   ev_ebitda: metric = EBITDA (total)           → (EBITDA × multiple + netCash) / shares
 *   ps:        metric = revenue (total)          → revenue × multiple / shares
 */
export function multiplesValue(
  kind: MultipleKind,
  metric: number | null | undefined,
  multiple: number,
  shares?: number | null,
  netCash = 0,
): number {
  if (!isNum(metric) || !isNum(multiple)) return NaN;
  if (kind === "pe") return metric * multiple;
  if (!isNum(shares) || shares <= 0) return NaN;
  if (kind === "ev_ebitda") return (metric * multiple + (isNum(netCash) ? netCash : 0)) / shares;
  return (metric * multiple) / shares;
}

/** Upside of value vs price as a decimal (0.12 = +12%). NaN when either is missing. */
export function upside(value: number | null | undefined, price: number | null | undefined): number {
  if (!isNum(value) || !isNum(price) || price <= 0) return NaN;
  return value / price - 1;
}

/** Margin of safety: (value - price) / value. Positive when price sits below value. */
export function marginOfSafety(value: number | null | undefined, price: number | null | undefined): number {
  if (!isNum(value) || !isNum(price) || value <= 0) return NaN;
  return (value - price) / value;
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
