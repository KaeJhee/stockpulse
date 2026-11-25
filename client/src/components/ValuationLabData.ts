/**
 * Valuation Lab: data plumbing.
 *   - useLabDefaults(ticker): reads the existing hooks (no new network calls) and derives
 *     a sourced default for every model input.
 *   - Lab state (user overrides, scenarios, weights) + per-ticker persistence in localStorage.
 */
import { useMemo } from "react";
import {
  useSnapshot,
  useTickerDetails,
  useEarnings,
  useAnalystRatings,
  useFinancials,
  useFmpIncome,
  useFmpRatios,
  useFmpProfile,
} from "@/lib/hooks";
import { clamp } from "@/lib/valuation";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SourceTag =
  | "quote"
  | "mock"
  | "profile"
  | "fmp"
  | "earnings"
  | "financials"
  | "analyst"
  | "derived"
  | "default"
  | "manual"
  | "missing";

export interface Sourced<T> {
  value: T;
  source: SourceTag;
  note?: string;
}

/** Every user-overridable model input. Money in $ millions, shares in millions, rates as decimals. */
export type InputKey =
  | "price"
  | "shares"
  | "fcf"
  | "epsTtm"
  | "epsFwd"
  | "ebitda"
  | "revenue"
  | "netCash"
  | "growth"
  | "discountRate"
  | "terminalGrowth"
  | "peMultiple"
  | "evEbitdaMultiple"
  | "psMultiple";

export type LabDefaults = Record<InputKey, Sourced<number | null>> & {
  currentPe: number | null;
  currentEvEbitda: number | null;
  currentPs: number | null;
  analyst: { low: number | null; avg: number | null; high: number | null; consensus: string | null; count: number | null } | null;
  loading: boolean;
};

export type ScenarioKey = "bear" | "base" | "bull";
export interface ScenarioAdj {
  /** Added to the base year 1-5 growth (decimal, e.g. -0.05). */
  dGrowth: number;
  /** Margin shift applied to base FCF (decimal, e.g. -0.15 = 15% lower cash margin). */
  margin: number;
  /** Exit multiple as a factor of the Gordon-equivalent multiple. */
  multFactor: number;
}

export type FcfMode = "auto" | "fcf" | "eps";

export interface LabState {
  v: 1;
  overrides: Partial<Record<InputKey, number>>;
  fcfMode: FcfMode;
  scenarios: Record<ScenarioKey, ScenarioAdj>;
  /** Integer percentages, sum 100, order bear/base/bull. */
  weights: [number, number, number];
  selected: ScenarioKey;
}

export const SCENARIO_KEYS: ScenarioKey[] = ["bear", "base", "bull"];

const INPUT_KEYS: InputKey[] = [
  "price",
  "shares",
  "fcf",
  "epsTtm",
  "epsFwd",
  "ebitda",
  "revenue",
  "netCash",
  "growth",
  "discountRate",
  "terminalGrowth",
  "peMultiple",
  "evEbitdaMultiple",
  "psMultiple",
];

export const DEFAULT_SCENARIOS: Record<ScenarioKey, ScenarioAdj> = {
  bear: { dGrowth: -0.05, margin: -0.15, multFactor: 0.8 },
  base: { dGrowth: 0, margin: 0, multFactor: 1 },
  bull: { dGrowth: 0.05, margin: 0.1, multFactor: 1.2 },
};

export const DEFAULT_STATE: LabState = {
  v: 1,
  overrides: {},
  fcfMode: "auto",
  scenarios: DEFAULT_SCENARIOS,
  weights: [25, 50, 25],
  selected: "base",
};

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export const storageKey = (ticker: string) => `ghost.valuation.${ticker.toUpperCase()}`;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function loadLabState(ticker: string): LabState {
  try {
    const raw = localStorage.getItem(storageKey(ticker));
    if (!raw) return DEFAULT_STATE;
    const p = JSON.parse(raw);
    if (!p || p.v !== 1) return DEFAULT_STATE;
    const overrides: Partial<Record<InputKey, number>> = {};
    if (p.overrides && typeof p.overrides === "object") {
      for (const [k, v] of Object.entries(p.overrides)) if (INPUT_KEYS.includes(k as InputKey) && finite(v)) overrides[k as InputKey] = v;
    }
    const scenarios = { ...DEFAULT_SCENARIOS };
    for (const k of SCENARIO_KEYS) {
      const s = p.scenarios?.[k];
      if (s && finite(s.dGrowth) && finite(s.margin) && finite(s.multFactor)) scenarios[k] = { dGrowth: s.dGrowth, margin: s.margin, multFactor: s.multFactor };
    }
    const w =
      Array.isArray(p.weights) &&
      p.weights.length === 3 &&
      p.weights.every((x: unknown) => finite(x) && Number.isInteger(x) && x >= 0 && x <= 100) &&
      p.weights.reduce((a: number, b: number) => a + b, 0) === 100
        ? ([p.weights[0], p.weights[1], p.weights[2]] as [number, number, number])
        : DEFAULT_STATE.weights;
    return {
      v: 1,
      overrides,
      fcfMode: p.fcfMode === "fcf" || p.fcfMode === "eps" ? p.fcfMode : "auto",
      scenarios,
      weights: w,
      selected: SCENARIO_KEYS.includes(p.selected) ? p.selected : "base",
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function isDefaultState(s: LabState): boolean {
  return (
    Object.keys(s.overrides).length === 0 &&
    s.fcfMode === "auto" &&
    s.weights.join() === DEFAULT_STATE.weights.join() &&
    SCENARIO_KEYS.every((k) => {
      const a = s.scenarios[k];
      const b = DEFAULT_SCENARIOS[k];
      return a.dGrowth === b.dGrowth && a.margin === b.margin && a.multFactor === b.multFactor;
    })
  );
}

export function saveLabState(ticker: string, s: LabState) {
  try {
    if (isDefaultState(s)) localStorage.removeItem(storageKey(ticker));
    else localStorage.setItem(storageKey(ticker), JSON.stringify(s));
  } catch {
    /* storage unavailable: assumptions last for this session only */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults from existing data hooks
// ─────────────────────────────────────────────────────────────────────────────

const S = <T,>(value: T, source: SourceTag, note?: string): Sourced<T> => ({ value, source, note });
const num = (v: unknown): number | null => (finite(v) ? v : null);

interface EarnRow {
  date: string;
  actual_eps: number | null;
  estimated_eps: number | null;
  is_upcoming: boolean;
}

export function useLabDefaults(ticker: string): LabDefaults {
  const snap = useSnapshot(ticker);
  const details = useTickerDetails(ticker);
  const earnings = useEarnings(ticker);
  const analyst = useAnalystRatings(ticker);
  const financials = useFinancials(ticker);
  const fmpIncome = useFmpIncome(ticker);
  const fmpRatios = useFmpRatios(ticker);
  const fmpProfile = useFmpProfile(ticker);

  const snapData = snap.data as any;
  const detailsData = details.data as any;
  const earnData = earnings.data as any;
  const analystData = analyst.data as any;
  const finData = financials.data as any;
  const income = fmpIncome.data as any[] | undefined;
  const ratios = fmpRatios.data as any;
  const profile = fmpProfile.data as any;

  const loading = snap.isLoading || details.isLoading || earnings.isLoading;

  return useMemo<LabDefaults>(() => {
    // ── price
    const priceRaw = num(snapData?.lastTrade?.p) ?? num(snapData?.day?.c);
    const price: Sourced<number | null> = priceRaw && priceRaw > 0
      ? S(priceRaw, snap.isMock ? "mock" : "quote", snap.isMock ? "sample quote" : snap.source)
      : S(null, "missing");

    // ── shares (millions) from market cap / price
    const mcapFmp = num(profile?.market_cap);
    const mcapProfile = num(detailsData?.market_cap);
    const mcap = mcapProfile ?? mcapFmp;
    const shares: Sourced<number | null> =
      mcap && priceRaw
        ? S(mcap / priceRaw / 1e6, mcapProfile ? "profile" : "fmp", "market cap ÷ price")
        : S(null, "missing");

    // ── EPS from earnings history
    const rows: EarnRow[] = Array.isArray(earnData?.results) ? earnData.results : [];
    const past = rows
      .filter((r) => !r.is_upcoming && finite(r.actual_eps))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const upcoming = rows
      .filter((r) => r.is_upcoming && finite(r.estimated_eps))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const ttmEps = past.length >= 4 ? sum(past.slice(0, 4).map((r) => r.actual_eps as number)) : null;
    const prevTtmEps = past.length >= 8 ? sum(past.slice(4, 8).map((r) => r.actual_eps as number)) : null;
    const fmpEps = num(income?.[0]?.eps_diluted) ?? num(income?.[0]?.eps);
    const epsTtm: Sourced<number | null> =
      ttmEps != null
        ? S(ttmEps, "earnings", "sum of last 4 reported quarters")
        : fmpEps != null
          ? S(fmpEps, "fmp", "latest annual diluted EPS")
          : S(null, "missing");

    let epsFwd: Sourced<number | null> = S(null, "missing");
    if (upcoming.length) {
      const est = upcoming.slice(0, 4).map((r) => r.estimated_eps as number);
      const fill = past.slice(0, Math.max(0, 4 - est.length)).map((r) => r.actual_eps as number);
      if (est.length + fill.length === 4) epsFwd = S(sum([...est, ...fill]), "earnings", `${est.length} est + ${fill.length} reported qtrs`);
    }

    // ── FCF ($M)
    const fcfPerShare = num(ratios?.free_cash_flow);
    const fcf: Sourced<number | null> =
      fcfPerShare != null && shares.value
        ? S(fcfPerShare * shares.value, "fmp", "FCF/share TTM × shares")
        : S(null, "missing");

    // ── EBITDA / revenue ($M)
    const ebitdaRaw = num(income?.[0]?.ebitda);
    const ebitda: Sourced<number | null> = ebitdaRaw != null ? S(ebitdaRaw / 1e6, "fmp", "latest annual") : S(null, "missing");
    const revFmp = num(income?.[0]?.revenue);
    const finRows: any[] = Array.isArray(finData?.results) ? finData.results : [];
    const finRev =
      finRows.length >= 4 && finRows.slice(0, 4).every((r) => finite(r?.financials?.income_statement?.revenues?.value))
        ? sum(finRows.slice(0, 4).map((r) => r.financials.income_statement.revenues.value))
        : null;
    const revenue: Sourced<number | null> =
      revFmp != null
        ? S(revFmp / 1e6, "fmp", "latest annual")
        : finRev != null
          ? S(finRev / 1e6, "financials", "last 4 quarters")
          : S(null, "missing");

    // ── net cash ($M): market cap − EV, EV = EV/EBITDA × EBITDA (FMP)
    let netCash: Sourced<number | null> = S(0, "default", "unknown → 0");
    const evMult = num(ratios?.ev_ebitda);
    if (evMult != null && ebitdaRaw != null && mcap) {
      const ev = evMult * ebitdaRaw;
      const nc = (mcap - ev) / 1e6;
      if (Math.abs(nc) < (mcap / 1e6) * 2) netCash = S(nc, "derived", "mkt cap − EV/EBITDA × EBITDA");
    }

    // ── growth
    let growth: Sourced<number | null> = S(0.08, "default");
    if (ttmEps != null && prevTtmEps != null && prevTtmEps > 0 && ttmEps > 0) {
      growth = S(clamp(ttmEps / prevTtmEps - 1, -0.05, 0.3), "earnings", "TTM EPS vs prior TTM, clamped −5…30%");
    } else if (income && income.length >= 2 && num(income[0]?.revenue) && num(income[1]?.revenue)) {
      growth = S(clamp(income[0].revenue / income[1].revenue - 1, -0.05, 0.3), "fmp", "revenue YoY, clamped −5…30%");
    }

    // ── discount rate: CAPM-lite from beta
    const beta = num(profile?.beta);
    const discountRate: Sourced<number | null> =
      beta != null && beta > 0
        ? S(clamp(0.0425 + beta * 0.055, 0.06, 0.14), "fmp", `4.25% + β ${beta.toFixed(2)} × 5.5%`)
        : S(0.09, "default");

    const currentPe = price.value && epsTtm.value && epsTtm.value > 0 ? price.value / epsTtm.value : num(ratios?.pe_ratio);
    const currentPs =
      num(ratios?.ps_ratio) ?? (price.value && shares.value && revenue.value ? (price.value * shares.value) / revenue.value : null);

    const a = analystData;
    const low = num(a?.low_price_target);
    const avg = num(a?.avg_price_target);
    const high = num(a?.high_price_target);
    const analystOut =
      a && (low != null || avg != null || high != null || typeof a.consensus === "string")
        ? {
            low,
            avg,
            high,
            consensus: typeof a.consensus === "string" && a.consensus !== "N/A" ? a.consensus : null,
            count: num(a.num_analysts) ?? num(a.total_analysts) ?? num(a.total),
          }
        : null;

    return {
      price,
      shares,
      fcf,
      epsTtm,
      epsFwd,
      ebitda,
      revenue,
      netCash,
      growth,
      discountRate,
      terminalGrowth: S(0.025, "default"),
      peMultiple: S(20, "default", "market-like P/E"),
      evEbitdaMultiple: S(14, "default"),
      psMultiple: S(4, "default"),
      currentPe: currentPe != null && currentPe > 0 ? currentPe : null,
      currentEvEbitda: evMult,
      currentPs,
      analyst: analystOut,
      loading,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapData, snap.isMock, snap.source, detailsData, earnData, analystData, finData, income, ratios, profile, loading]);
}
