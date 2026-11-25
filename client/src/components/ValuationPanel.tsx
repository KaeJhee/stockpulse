/**
 * VALUATION LAB — the model behind the Valuation Dashboard.
 *
 * Two-stage DCF with fade, multiples, bear/base/bull scenarios, football field,
 * sensitivity heatmap and a reverse DCF. Inputs are prefilled from data the app
 * already loads (quote, profile, earnings, analyst, FMP when a key is set) and
 * every one of them can be overridden. Assumptions persist per ticker.
 *
 * Analysis only: outputs are implied values under stated assumptions.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, RotateCcw, Crosshair } from "lucide-react";
import { Panel, Delta, RangeBar, Segmented, useAnimate, type RangeMarker } from "@/components/hud";
import { LabCount } from "./ValuationLabCount";
import { cn } from "@/lib/utils";
import {
  dcf,
  gordonMultiple,
  impliedGrowth,
  marginOfSafety,
  multiplesValue,
  rebalanceWeights,
  sensitivityGrid,
  upside,
  weightedFairValue,
  type DcfParams,
} from "@/lib/valuation";
import {
  DEFAULT_STATE,
  SCENARIO_KEYS,
  isDefaultState,
  loadLabState,
  saveLabState,
  useLabDefaults,
  type FcfMode,
  type InputKey,
  type LabState,
  type ScenarioAdj,
  type ScenarioKey,
  type SourceTag,
} from "./ValuationLabData";
import { LabField, LabStyles, NumField, SourceBadge, fmtMoneyM, fmtPct, fmtUsd, fmtX } from "./ValuationLabControls";
import { CashFlowBars, FootballField, PricedInRing, ProbabilityTiles, SensitivityHeatmap, type FieldRow } from "./ValuationLabCharts";
import { ScenarioCards, type ScenarioView } from "./ValuationLabScenarios";

const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const MIN_SPREAD = 0.005; // discount rate must exceed terminal growth by at least 0.5pp
const clampPct = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

export function ValuationPanel({ ticker }: { ticker: string }) {
  const animate = useAnimate();
  const d = useLabDefaults(ticker);

  // ── state + persistence ────────────────────────────────────────────────
  const [state, setState] = useState<LabState>(() => loadLabState(ticker));
  // Reload during render when the ticker changes, so a committed render never pairs
  // one ticker with another ticker's assumptions (and the save below never writes them across).
  const [stateFor, setStateFor] = useState(ticker);
  if (stateFor !== ticker) {
    setStateFor(ticker);
    setState(loadLabState(ticker));
  }
  useEffect(() => {
    if (stateFor !== ticker) return;
    const id = setTimeout(() => saveLabState(ticker, state), 400);
    return () => clearTimeout(id);
  }, [ticker, stateFor, state]);

  const setInput = useCallback((k: InputKey, v: number) => {
    setState((s) => ({ ...s, overrides: { ...s.overrides, [k]: v } }));
  }, []);
  const resetInput = useCallback((k: InputKey) => {
    setState((s) => {
      const o = { ...s.overrides };
      delete o[k];
      return { ...s, overrides: o };
    });
  }, []);
  const resetAll = useCallback(() => setState(DEFAULT_STATE), []);

  const inp = useCallback(
    (k: InputKey): { value: number | null; source: SourceTag; note?: string } => {
      const o = state.overrides[k];
      if (o !== undefined) return { value: o, source: "manual" };
      return d[k];
    },
    [state.overrides, d],
  );

  // ── effective inputs ───────────────────────────────────────────────────
  const price = inp("price");
  const shares = inp("shares");
  const fcfIn = inp("fcf");
  const epsTtm = inp("epsTtm");
  const epsFwd = inp("epsFwd");
  const ebitda = inp("ebitda");
  const revenue = inp("revenue");
  const netCash = inp("netCash");
  const growth = inp("growth");
  const rate = inp("discountRate");
  const tg = inp("terminalGrowth");
  const peMult = inp("peMultiple");
  const evMult = inp("evEbitdaMultiple");
  const psMult = inp("psMultiple");

  const px = ok(price.value) && price.value > 0 ? price.value : null;
  const sh = ok(shares.value) && shares.value > 0 ? shares.value : null;
  const ownerEarnings = ok(epsTtm.value) && epsTtm.value > 0 && sh ? epsTtm.value * sh : null;
  const fcfPositive = ok(fcfIn.value) && fcfIn.value > 0;
  const usedMode: "fcf" | "eps" =
    state.fcfMode === "fcf" ? "fcf" : state.fcfMode === "eps" ? "eps" : fcfPositive ? "fcf" : ownerEarnings ? "eps" : "fcf";
  const baseFcf = usedMode === "fcf" ? (ok(fcfIn.value) ? fcfIn.value : null) : ownerEarnings;
  const fcfNotice = !ok(fcfIn.value)
    ? "No free-cash-flow data for this ticker (needs an FMP key). Using EPS × shares as an owner-earnings proxy; enter FCF manually to override."
    : fcfIn.value <= 0
      ? "Reported FCF is negative, so an FCF-based DCF is not meaningful here. EPS × shares can stand in as owner earnings."
      : null;

  const g = ok(growth.value) ? growth.value : 0.08;
  const t = ok(tg.value) ? tg.value : 0.025;
  const rRaw = ok(rate.value) ? rate.value : 0.09;
  const rClamped = rRaw < t + MIN_SPREAD;
  const r = rClamped ? +(t + MIN_SPREAD).toFixed(6) : rRaw;
  const nc = ok(netCash.value) ? netCash.value : 0;

  const params: DcfParams = useMemo(
    () => ({ baseFcf: baseFcf ?? NaN, growth: g, terminalGrowth: t, discountRate: r, shares: sh ?? NaN, netCash: nc }),
    [baseFcf, g, t, r, sh, nc],
  );
  const canModel = ok(baseFcf) && baseFcf > 0 && !!sh;

  // ── core computations (memoized) ───────────────────────────────────────
  const dcfRes = useMemo(() => dcf(params), [params]);
  const grid = useMemo(() => sensitivityGrid(params, px, { minSpread: MIN_SPREAD }), [params, px]);
  const implied = useMemo(() => impliedGrowth(params, px), [params, px]);
  const gm = useMemo(() => gordonMultiple(r, t), [r, t]);

  const scenarioViews: ScenarioView[] = useMemo(
    () =>
      SCENARIO_KEYS.map((k, i) => {
        const adj = state.scenarios[k];
        const sg = g + adj.dGrowth;
        const mult = gm * adj.multFactor;
        // multFactor 1 = the Gordon-equivalent exit multiple, i.e. exactly the DCF block's Gordon TV.
        // Run it as Gordon so an unshifted scenario is bit-identical to the DCF / sensitivity current cell.
        const gordonTv = adj.multFactor === 1;
        const res = dcf({ ...params, growth: sg, baseFcf: params.baseFcf * (1 + adj.margin), exitMultiple: gordonTv ? null : mult });
        return {
          key: k,
          adj,
          growth: sg,
          multiple: mult,
          matchesDcf: gordonTv && adj.dGrowth === 0 && adj.margin === 0,
          value: canModel ? res.perShare : NaN,
          upside: canModel ? upside(res.perShare, px) : NaN,
          weight: state.weights[i],
          path: canModel ? [params.baseFcf * (1 + adj.margin), ...res.years.map((y) => y.fcf)] : [],
        };
      }),
    [state.scenarios, state.weights, g, gm, params, canModel, px],
  );
  const fair = useMemo(
    () => (canModel ? weightedFairValue(scenarioViews.map((s) => ({ value: s.value, weight: s.weight }))) : NaN),
    [scenarioViews, canModel],
  );
  const [bearV, baseV, bullV] = scenarioViews.map((s) => s.value);
  const fairUp = upside(fair, px);
  const mos = marginOfSafety(fair, px);

  const mult = useMemo(() => {
    const pe = ok(peMult.value) ? peMult.value : 20;
    const ev = ok(evMult.value) ? evMult.value : 14;
    const ps = ok(psMult.value) ? psMult.value : 4;
    return {
      pe,
      ev,
      ps,
      peTtm: multiplesValue("pe", epsTtm.value, pe),
      peFwd: multiplesValue("pe", epsFwd.value, pe),
      evEbitda: multiplesValue("ev_ebitda", ebitda.value, ev, sh, nc),
      ps_: multiplesValue("ps", revenue.value, ps, sh),
    };
  }, [peMult.value, evMult.value, psMult.value, epsTtm.value, epsFwd.value, ebitda.value, revenue.value, sh, nc]);

  const fieldRows: FieldRow[] = useMemo(() => {
    const rows: FieldRow[] = [];
    const pos = (n: number) => ok(n) && n > 0;
    if (canModel && pos(grid.min) && pos(grid.max))
      rows.push({ key: "dcf", label: "DCF", low: grid.min, high: grid.max, mid: dcfRes.perShare, tone: "up", note: "sensitivity grid min → max" });
    if (pos(bearV) && pos(bullV)) rows.push({ key: "scn", label: "Scenarios", low: bearV, high: bullV, mid: baseV, tone: "amber", note: "bear → bull" });
    const peVals = [mult.peTtm, mult.peFwd].filter(pos);
    if (peVals.length)
      rows.push({
        key: "pe",
        label: "P/E",
        low: Math.min(...peVals) * 0.8,
        high: Math.max(...peVals) * 1.2,
        mid: pos(mult.peTtm) ? mult.peTtm : mult.peFwd,
        tone: "violet",
        note: `TTM/fwd EPS × ${fmtX(mult.pe)} ± 20%`,
      });
    if (pos(mult.evEbitda))
      rows.push({ key: "ev", label: "EV/EBITDA", low: mult.evEbitda * 0.8, high: mult.evEbitda * 1.2, mid: mult.evEbitda, tone: "violet", note: `${fmtX(mult.ev)} ± 20%` });
    if (pos(mult.ps_)) rows.push({ key: "ps", label: "P/S", low: mult.ps_ * 0.8, high: mult.ps_ * 1.2, mid: mult.ps_, tone: "violet", note: `${fmtX(mult.ps)} ± 20%` });
    const a = d.analyst;
    if (a && pos(a.low ?? NaN) && pos(a.high ?? NaN))
      rows.push({ key: "analyst", label: "Analyst tgt", low: a.low!, high: a.high!, mid: a.avg, tone: "dim", note: "analyst price targets, low → high (data)" });
    return rows;
  }, [canModel, grid.min, grid.max, dcfRes.perShare, bearV, baseV, bullV, mult, d.analyst]);

  // ── handlers ───────────────────────────────────────────────────────────
  const setAdj = useCallback((k: ScenarioKey, patch: Partial<ScenarioAdj>) => {
    setState((s) => ({ ...s, scenarios: { ...s.scenarios, [k]: { ...s.scenarios[k], ...patch } } }));
  }, []);
  const setWeight = useCallback((k: ScenarioKey, w: number) => {
    setState((s) => {
      const idx = SCENARIO_KEYS.indexOf(k);
      return { ...s, weights: rebalanceWeights(s.weights, idx, w) as [number, number, number] };
    });
  }, []);
  const setSelected = useCallback((k: ScenarioKey) => setState((s) => (s.selected === k ? s : { ...s, selected: k })), []);
  const setMode = useCallback((m: FcfMode) => setState((s) => ({ ...s, fcfMode: m })), []);
  const pickCell = useCallback(
    (rr: number, gg: number) => setState((s) => ({ ...s, overrides: { ...s.overrides, discountRate: rr, terminalGrowth: gg } })),
    [],
  );

  // ── status (Kronos-style tag) ──────────────────────────────────────────
  const status: { label: string; tone?: "amber" | "red" | "dim" } = d.loading
    ? { label: "sampling", tone: "amber" }
    : !px
      ? { label: "waiting · price", tone: "red" }
      : !canModel
        ? { label: "waiting · inputs", tone: "amber" }
        : { label: Object.keys(state.overrides).length ? "set · manual" : "set" };

  const today = useMemo(() => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), []);
  const dirty = !isDefaultState(state);
  const modelTag = usedMode === "fcf" ? "2-stage DCF · FCF" : "2-stage DCF · owner earnings";

  const rangeMin = Math.min(...[bearV, px ?? NaN, fair].filter(ok));
  const rangeMax = Math.max(...[bullV, px ?? NaN, fair].filter(ok));
  const pad = (rangeMax - rangeMin) * 0.12 || 1;
  const markers: RangeMarker[] = [
    ...(ok(bearV) ? [{ value: bearV, label: "bear", tone: "down" as const }] : []),
    ...(ok(bullV) ? [{ value: bullV, label: "bull", tone: "up" as const }] : []),
    ...(ok(fair) ? [{ value: fair, label: "fv", tone: "amber" as const }] : []),
    ...(px ? [{ value: px, tone: "fg" as const, shape: "tri" as const }] : []),
  ];

  let delay = 0.05;
  const nextDelay = () => (delay += 0.06);

  return (
    <Panel
      title="Valuation Lab"
      tag={`${ticker} · ${modelTag}`}
      accent="amber"
      data-testid="valuation-panel"
      actions={
        <>
          <span className="hud-tag hidden sm:inline-flex items-center gap-1.5" data-testid="valuation-status">
            <span className="live-dot" data-tone={status.tone} />
            {status.label}
          </span>
          <button
            type="button"
            className="hud-btn !h-6 !px-2 disabled:opacity-40 disabled:pointer-events-none"
            onClick={resetAll}
            disabled={!dirty}
            aria-label="Reset all valuation assumptions to data defaults"
            title="Reset assumptions"
            data-testid="valuation-reset"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </>
      }
    >
      <LabStyles />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 sm:gap-4">
        {/* ── 1 · FAIR VALUE hero ─────────────────────────────────────── */}
        <Sub title="Fair value" tag="probability-weighted" accent="amber" delay={nextDelay()} className="xl:col-span-5" testId="valuation-hero"
          right={<span className="hud-tag">{canModel ? `${SCENARIO_KEYS.length} scenarios` : "waiting"}</span>}
        >
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="hud-tag mb-1">implied value / share</div>
              <LabCount
                value={fair}
                format={(n) => fmtUsd(n)}
                flash
                duration={900}
                className="block text-[40px] sm:text-[46px] leading-none font-semibold text-amber glow-amber"
                data-testid="valuation-fair-value"
              />
              <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]">
                <Delta pct={ok(fairUp) ? fairUp * 100 : null} className="text-[12px]" />
                <span className="hud-tag">{ok(fairUp) ? (fairUp >= 0 ? "implied upside vs price" : "implied downside vs price") : "needs price"}</span>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[11px] tabular-nums min-w-[150px]">
              <dt className="hud-tag self-center">bull</dt>
              <dd className="text-right text-up"><LabCount value={bullV} format={(n) => fmtUsd(n)} /></dd>
              <dt className="hud-tag self-center">base</dt>
              <dd className="text-right text-foreground"><LabCount value={baseV} format={(n) => fmtUsd(n)} /></dd>
              <dt className="hud-tag self-center">bear</dt>
              <dd className="text-right text-down"><LabCount value={bearV} format={(n) => fmtUsd(n)} /></dd>
              <dt className="hud-tag self-center">spread</dt>
              <dd className="text-right text-muted-foreground">{ok(bullV) && ok(bearV) ? fmtUsd(bullV - bearV) : "—"}</dd>
            </dl>
          </div>

          {markers.length > 1 && ok(rangeMin) && ok(rangeMax) ? (
            <RangeBar
              className="mt-3"
              min={Math.max(0, rangeMin - pad)}
              max={rangeMax + pad}
              markers={markers}
              minLabel={fmtUsd(Math.max(0, rangeMin - pad), 0)}
              maxLabel={fmtUsd(rangeMax + pad, 0)}
            />
          ) : (
            <div className="mt-4 h-1 bg-muted skeleton-shimmer" aria-hidden />
          )}

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="price" source={price.source}>
              {px ? (
                <LabCount value={px} format={(n) => fmtUsd(n)} from={null} className="text-foreground" />
              ) : (
                <span className="text-down">missing</span>
              )}
            </Stat>
            <Stat label="margin of safety" hint="(fv − px) / fv">
              <span className={cn(ok(mos) ? (mos >= 0 ? "text-up" : "text-down") : "text-dim")}>
                {ok(mos) ? `${mos >= 0 ? "▲" : "▼"} ${fmtPct(mos, 1, true)}` : "—"}
              </span>
            </Stat>
            <Stat label="dcf (base inputs)" hint="gordon tv" className="col-span-2 sm:col-span-1">
              <LabCount value={canModel ? dcfRes.perShare : NaN} format={(n) => fmtUsd(n)} className="text-up" />
            </Stat>
          </div>

          {!px && (
            <div className="mt-3 border border-down/40 p-2.5 flex items-center gap-3 flex-wrap">
              <span className="text-[11px] text-down">▼ No live price. Enter one to compute implied upside.</span>
              <NumField className="w-28 ml-auto" value={null} unit="usd" step={0.5} min={0.01} onChange={(v) => setInput("price", v)} aria-label="Manual price" />
            </div>
          )}
          {price.source === "manual" && (
            <button type="button" className="mt-2 hud-tag hover:text-amber transition-colors" onClick={() => resetInput("price")}>
              ↺ manual price in use · revert to quote
            </button>
          )}
        </Sub>

        {/* ── 4 · SCENARIOS ──────────────────────────────────────────── */}
        <Sub title="Scenarios" tag="bear · base · bull · exit-multiple tv" accent="amber" delay={nextDelay()} className="xl:col-span-7" testId="valuation-scenarios"
          right={
            <span className="hud-tag tabular-nums">
              Σ p {state.weights.reduce((a, b) => a + b, 0)}%
            </span>
          }
        >
          <ScenarioCards
            views={scenarioViews}
            selected={state.selected}
            layoutKey={ticker}
            onSelect={setSelected}
            onAdj={setAdj}
            onWeight={setWeight}
            baseGrowth={g}
            gordonMult={gm}
          />
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-center">
            <ProbabilityTiles weights={state.weights} />
            <div className="text-[10.5px] tabular-nums space-y-0.5 sm:min-w-[150px]">
              <div className="hud-label">probability mass</div>
              <div><span className="text-down">▼ bear</span> <span className="text-dim">{state.weights[0]} / 100</span></div>
              <div><span className="text-amber">■ base</span> <span className="text-dim">{state.weights[1]} / 100</span></div>
              <div><span className="text-up">▲ bull</span> <span className="text-dim">{state.weights[2]} / 100</span></div>
            </div>
          </div>
          <p className="hud-tag mt-2 normal-case tracking-normal">
            Each scenario runs the DCF with its own growth, cash margin and exit multiple (on year-10 cash flow). At the default 1.0× of the Gordon-equivalent multiple ({fmtX(gm)}), the exit-multiple TV equals the Gordon TV, so an unshifted base equals the DCF per share and the sensitivity current cell. Weights stay at 100%: moving one slider rebalances the others.
          </p>
        </Sub>

        {/* ── 2 · DCF ───────────────────────────────────────────────── */}
        <Sub title="Discounted cash flow" tag="10y · fade · gordon tv" accent="teal" delay={nextDelay()} className="xl:col-span-12" testId="valuation-dcf"
          right={
            <Segmented<FcfMode>
              aria-label="Base cash flow source"
              value={state.fcfMode}
              onChange={setMode}
              options={[
                { value: "auto", label: "Auto", title: "FCF when positive, else EPS × shares" },
                { value: "fcf", label: "FCF" },
                { value: "eps", label: "EPS", title: "Owner earnings: EPS × shares" },
              ]}
            />
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
            <div className="lg:col-span-5 space-y-3">
              <AnimatePresence initial={false}>
                {fcfNotice && (state.fcfMode !== "eps") && (
                  <motion.p
                    key="fcf-note"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-[10.5px] text-amber border border-amber/40 px-2 py-1.5 font-read leading-snug overflow-hidden"
                    role="note"
                  >
                    ▲ {fcfNotice}
                  </motion.p>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait" initial={false}>
                {usedMode === "fcf" ? (
                  <motion.div key="fcf" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: animate ? 0.18 : 0 }}>
                    <LabField
                      label="Base FCF ($M)"
                      source={fcfIn.source}
                      note={fcfIn.note}
                      value={fcfIn.value}
                      onChange={(v) => setInput("fcf", v)}
                      onReset={() => resetInput("fcf")}
                      unit="m"
                      min={0}
                      max={Math.max(1000, (ok(d.fcf.value) ? Math.abs(d.fcf.value) : ownerEarnings ?? 1000) * 3)}
                      step={1}
                      hint={fmtMoneyM(fcfIn.value)}
                      testId="input-fcf"
                    />
                  </motion.div>
                ) : (
                  <motion.div key="eps" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 6 }} transition={{ duration: animate ? 0.18 : 0 }}>
                    <LabField
                      label="EPS TTM (owner earnings)"
                      source={epsTtm.source}
                      note={epsTtm.note}
                      value={epsTtm.value}
                      onChange={(v) => setInput("epsTtm", v)}
                      onReset={() => resetInput("epsTtm")}
                      unit="usd"
                      min={0}
                      max={Math.max(20, (ok(d.epsTtm.value) ? Math.abs(d.epsTtm.value) : 5) * 3)}
                      step={0.01}
                      hint={`× shares = ${fmtMoneyM(ownerEarnings)}`}
                      testId="input-eps"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <LabField
                label="Growth · years 1-5"
                source={growth.source}
                note={growth.note}
                value={g}
                onChange={(v) => setInput("growth", v)}
                onReset={() => resetInput("growth")}
                unit="pct"
                min={-0.2}
                max={0.6}
                step={0.0025}
                marks={implied.growth != null ? [{ value: implied.growth, label: `priced-in ${fmtPct(implied.growth, 1)}`, tone: "amber" }] : undefined}
                hint={implied.growth != null ? <span className="text-amber/90">│ priced-in {fmtPct(implied.growth, 1)}</span> : undefined}
                testId="input-growth"
              />
              <div className="hud-tag -mt-1.5">years 6-10 fade linearly from {fmtPct(g, 1)} to {fmtPct(t, 2)}</div>
              <LabField
                label="Terminal growth"
                source={tg.source}
                note={tg.note}
                value={t}
                onChange={(v) => setInput("terminalGrowth", v)}
                onReset={() => resetInput("terminalGrowth")}
                unit="pct"
                min={0}
                max={0.05}
                step={0.0025}
                testId="input-terminal-growth"
              />
              <LabField
                label="Discount rate"
                source={rate.source}
                note={rate.note}
                value={rRaw}
                onChange={(v) => setInput("discountRate", v)}
                onReset={() => resetInput("discountRate")}
                unit="pct"
                min={0.04}
                max={0.2}
                step={0.0025}
                tone={rClamped ? "amber" : "up"}
                testId="input-discount-rate"
              />
              <AnimatePresence initial={false}>
                {rClamped && (
                  <motion.p
                    key="clamp"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-[10.5px] text-amber border border-amber/50 box-glow-amber px-2 py-1.5 overflow-hidden"
                    role="alert"
                  >
                    ▲ Discount rate must exceed terminal growth. Clamped to {fmtPct(r, 2)} (terminal + 0.5pp).
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <LabField
                  label="Shares (M)"
                  source={shares.source}
                  note={shares.note}
                  value={shares.value}
                  onChange={(v) => setInput("shares", v)}
                  onReset={() => resetInput("shares")}
                  unit="num"
                  min={0}
                  max={1e6}
                  step={1}
                  slider={false}
                  testId="input-shares"
                />
                <LabField
                  label="Net cash ($M)"
                  source={netCash.source}
                  note={netCash.note ?? "negative = net debt"}
                  value={netCash.value}
                  onChange={(v) => setInput("netCash", v)}
                  onReset={() => resetInput("netCash")}
                  unit="m"
                  min={-1e7}
                  max={1e7}
                  step={10}
                  slider={false}
                  testId="input-net-cash"
                />
              </div>
            </div>

            <div className="lg:col-span-7 min-w-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <Stat label="enterprise value"><LabCount value={canModel ? dcfRes.enterpriseValue : NaN} format={fmtMoneyM} /></Stat>
                <Stat label="equity value"><LabCount value={canModel ? dcfRes.equityValue : NaN} format={fmtMoneyM} /></Stat>
                <Stat label="per share" hint={px ? undefined : "no price"}>
                  <LabCount value={canModel ? dcfRes.perShare : NaN} format={(n) => fmtUsd(n)} className="text-up glow-teal" flash data-testid="valuation-dcf-per-share" />
                </Stat>
                <Stat label="vs price">
                  <Delta pct={canModel && ok(upside(dcfRes.perShare, px)) ? upside(dcfRes.perShare, px) * 100 : null} />
                </Stat>
              </div>

              {/* terminal-value share bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="hud-label">PV split · explicit vs terminal</span>
                  <span className="text-[10.5px] tabular-nums">
                    <span className="text-up">{canModel ? fmtPct(1 - dcfRes.terminalShare, 0) : "—"}</span>
                    <span className="text-dim"> · </span>
                    <span className="text-amber">{canModel ? fmtPct(dcfRes.terminalShare, 0) : "—"} TV</span>
                  </span>
                </div>
                <div className="h-2 bg-muted flex overflow-hidden" role="img" aria-label={`Terminal value is ${fmtPct(dcfRes.terminalShare, 0)} of enterprise value`}>
                  <motion.div className="h-full bg-up/70" initial={animate ? { width: 0 } : false} animate={{ width: canModel ? `${clampPct((1 - dcfRes.terminalShare) * 100)}%` : "0%" }} transition={animate ? { type: "spring", stiffness: 90, damping: 20 } : { duration: 0 }} />
                  <motion.div className="h-full bg-amber/80 box-glow-amber" initial={animate ? { width: 0 } : false} animate={{ width: canModel ? `${clampPct(dcfRes.terminalShare * 100)}%` : "0%" }} transition={animate ? { type: "spring", stiffness: 90, damping: 20, delay: 0.05 } : { duration: 0 }} />
                </div>
                {canModel && dcfRes.terminalShare > 0.75 && (
                  <p className="hud-tag text-amber mt-1">▲ over 75% of value sits in the terminal value: the result leans heavily on long-run assumptions</p>
                )}
              </div>

              {canModel ? (
                <CashFlowBars result={dcfRes} />
              ) : (
                <Empty>
                  {!sh ? "Shares outstanding missing — enter shares (M) to model." : "Needs a positive base cash flow. Enter FCF, or switch to EPS and enter EPS TTM."}
                </Empty>
              )}
            </div>
          </div>
        </Sub>

        {/* ── 6 · SENSITIVITY ────────────────────────────────────────── */}
        <Sub title="Sensitivity" tag="discount × terminal growth · gordon tv · $/share" delay={nextDelay()} className="xl:col-span-7" testId="valuation-sensitivity"
          right={<span className="hud-tag hidden sm:inline">click a cell to apply</span>}
        >
          {canModel ? (
            <>
              <SensitivityHeatmap grid={grid} currentRate={r} currentGrowth={t} onPick={pickCell} />
              <p className="hud-tag mt-1.5 normal-case tracking-normal tabular-nums" data-testid="valuation-sensitivity-current">
                <span className="text-amber">□ current</span> r {fmtPct(r, 2)} · g∞ {fmtPct(t, 2)} ={" "}
                <span className="text-foreground">{fmtUsd(grid.cells[Math.floor(grid.rates.length / 2)]?.[Math.floor(grid.growths.length / 2)]?.value)}</span>
                {" "}= DCF per share (same inputs, Gordon TV). Bear/bull scenario shifts are not applied here.
              </p>
            </>
          ) : (
            <Empty>Sensitivity appears once the DCF has a positive base cash flow and shares.</Empty>
          )}
        </Sub>

        {/* ── 7 · REVERSE DCF ───────────────────────────────────────── */}
        <Sub title="Reverse DCF" tag="priced-in growth" accent="amber" delay={nextDelay()} className="xl:col-span-5" testId="valuation-reverse-dcf">
          <ReverseDcf implied={implied.growth} reason={implied.reason} yours={g} terminal={t} price={px} onUse={(v) => setInput("growth", +v.toFixed(4))} />
        </Sub>

        {/* ── 5 · FOOTBALL FIELD ────────────────────────────────────── */}
        <Sub title="Football field" tag="value ranges by method" delay={nextDelay()} className="xl:col-span-7" testId="valuation-football-field"
          right={
            <span className="hud-tag hidden sm:inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-foreground/70" /> price</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-[2px] bg-amber" /> fair value</span>
            </span>
          }
        >
          <FootballField rows={fieldRows} price={px} fair={ok(fair) ? fair : null} />
          {d.analyst?.consensus && (
            <p className="hud-tag mt-2">
              analyst consensus (data): <span className="text-muted-foreground">{d.analyst.consensus}</span>
              {d.analyst.count ? ` · ${d.analyst.count} analysts` : ""}
              {ok(d.analyst.avg) ? ` · avg target ${fmtUsd(d.analyst.avg)}` : ""}
            </p>
          )}
        </Sub>

        {/* ── 3 · MULTIPLES ─────────────────────────────────────────── */}
        <Sub title="Multiples" tag="relative value · $/share" delay={nextDelay()} className="xl:col-span-5" testId="valuation-multiples">
          <div className="space-y-3">
            <LabField
              label="P/E multiple"
              source={peMult.source}
              note={peMult.note}
              value={mult.pe}
              onChange={(v) => setInput("peMultiple", v)}
              onReset={() => resetInput("peMultiple")}
              unit="x"
              min={4}
              max={60}
              step={0.5}
              tone="amber"
              marks={d.currentPe ? [{ value: d.currentPe, label: `current ${fmtX(d.currentPe)}`, tone: "dim" }] : undefined}
              hint={d.currentPe ? `current ${fmtX(d.currentPe)}` : undefined}
              testId="input-pe"
            />
            <MultRow label="EPS TTM" unit="usd" metric={epsTtm} onMetric={(v) => setInput("epsTtm", v)} onReset={() => resetInput("epsTtm")} value={mult.peTtm} price={px} formula={`× ${fmtX(mult.pe)}`} />
            <MultRow label="EPS fwd" unit="usd" metric={epsFwd} onMetric={(v) => setInput("epsFwd", v)} onReset={() => resetInput("epsFwd")} value={mult.peFwd} price={px} formula={`× ${fmtX(mult.pe)}`} />
            <div className="hud-divider" />
            <LabField
              label="EV/EBITDA multiple"
              source={evMult.source}
              note={evMult.note}
              value={mult.ev}
              onChange={(v) => setInput("evEbitdaMultiple", v)}
              onReset={() => resetInput("evEbitdaMultiple")}
              unit="x"
              min={3}
              max={40}
              step={0.5}
              tone="amber"
              marks={d.currentEvEbitda ? [{ value: d.currentEvEbitda, label: "current", tone: "dim" }] : undefined}
              hint={d.currentEvEbitda ? `current ${fmtX(d.currentEvEbitda)}` : undefined}
              testId="input-ev-ebitda"
            />
            <MultRow label="EBITDA ($M)" unit="m" metric={ebitda} onMetric={(v) => setInput("ebitda", v)} onReset={() => resetInput("ebitda")} value={mult.evEbitda} price={px} formula="+ net cash ÷ shares" />
            <div className="hud-divider" />
            <LabField
              label="P/S multiple"
              source={psMult.source}
              note={psMult.note}
              value={mult.ps}
              onChange={(v) => setInput("psMultiple", v)}
              onReset={() => resetInput("psMultiple")}
              unit="x"
              min={0.5}
              max={30}
              step={0.1}
              tone="amber"
              marks={d.currentPs ? [{ value: d.currentPs, label: "current", tone: "dim" }] : undefined}
              hint={d.currentPs ? `current ${fmtX(d.currentPs)}` : undefined}
              testId="input-ps"
            />
            <MultRow label="Revenue ($M)" unit="m" metric={revenue} onMetric={(v) => setInput("revenue", v)} onReset={() => resetInput("revenue")} value={mult.ps_} price={px} formula="÷ shares" />
          </div>
        </Sub>

        {/* ── model log ─────────────────────────────────────────────── */}
        <Sub title="Model log" tag="inputs · sources" delay={nextDelay()} className="xl:col-span-5" testId="valuation-log">
          <ModelLog
            key={ticker}
            lines={[
              ["quote", "price", px ? fmtUsd(px) : "—", price.source],
              ["profile", "shares", sh ? `${sh.toLocaleString("en-US", { maximumFractionDigits: 0 })}M` : "—", shares.source],
              ["cash", usedMode === "fcf" ? "base fcf" : "owner earn.", fmtMoneyM(baseFcf), usedMode === "fcf" ? fcfIn.source : epsTtm.source],
              ["eps", "ttm / fwd", `${ok(epsTtm.value) ? fmtUsd(epsTtm.value) : "—"} / ${ok(epsFwd.value) ? fmtUsd(epsFwd.value) : "—"}`, epsTtm.source],
              ["growth", "y1-5", fmtPct(g, 1), growth.source],
              ["rate", "r / g∞", `${fmtPct(r, 2)} / ${fmtPct(t, 2)}`, rate.source === "manual" || tg.source === "manual" ? "manual" : rate.source],
              ["balance", "net cash", fmtMoneyM(nc), netCash.source],
              ["solve", "priced-in g", implied.growth != null ? fmtPct(implied.growth, 1) : "n/a", implied.growth != null ? "derived" : "missing"],
              ["model", "fair value", ok(fair) ? fmtUsd(fair) : "—", ok(fair) ? "derived" : "missing"],
            ]}
          />
        </Sub>

        {/* ── how this is computed ──────────────────────────────────── */}
        <Sub title="How this is computed" tag="formulas" delay={nextDelay()} className="xl:col-span-7" testId="valuation-formulas">
          <HowComputed />
        </Sub>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[10px] uppercase tracking-[.1em] text-amber/90 border border-amber/40 px-1.5 py-0.5" data-testid="valuation-disclaimer">
          Analysis, not a recommendation · {today}
        </span>
        <span className="text-[10.5px] text-dim font-read">
          Implied values under the stated assumptions; scenarios, not forecasts. Assumptions are saved in this browser for {ticker}.
        </span>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local layout pieces
// ─────────────────────────────────────────────────────────────────────────────

function Sub({
  title,
  tag,
  accent = "teal",
  delay,
  className,
  right,
  testId,
  children,
}: {
  title: string;
  tag?: string;
  accent?: "teal" | "amber" | "red";
  delay?: number;
  className?: string;
  right?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Panel
      title={title}
      tag={tag}
      accent={accent}
      delay={delay}
      actions={right}
      className={cn("vl-sub bg-background/35", className)}
      data-testid={testId}
    >
      {children}
    </Panel>
  );
}

function Stat({ label, hint, source, className, children }: { label: string; hint?: string; source?: SourceTag; className?: string; children: ReactNode }) {
  return (
    <div className={cn("border border-card-border bg-background/40 px-2.5 py-2 min-w-0 transition-colors hover:border-primary/40", className)}>
      <div className="flex items-center gap-1.5 mb-1 min-w-0">
        <span className="hud-tag truncate">{label}</span>
        {source && <SourceBadge source={source} />}
      </div>
      <div className="text-[14px] font-semibold tabular-nums leading-none truncate">{children}</div>
      {hint && <div className="hud-tag text-[8.5px] mt-1 truncate">{hint}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-[120px] flex items-center justify-center border border-dashed border-border p-4 text-center">
      <p className="text-[11px] text-muted-foreground font-read max-w-sm">{children}</p>
    </div>
  );
}

function MultRow({
  label,
  unit,
  metric,
  onMetric,
  onReset,
  value,
  price,
  formula,
}: {
  label: string;
  unit: "usd" | "m";
  metric: { value: number | null; source: SourceTag; note?: string };
  onMetric: (v: number) => void;
  onReset: () => void;
  value: number;
  price: number | null;
  formula: string;
}) {
  const up = upside(value, price);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] items-center gap-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="hud-label text-[9.5px] truncate">{label}</span>
          <SourceBadge source={metric.source} note={metric.note} />
          {metric.source === "manual" && (
            <button type="button" onClick={onReset} className="text-[10px] text-dim hover:text-amber" aria-label={`Revert ${label} to data value`}>
              ↺
            </button>
          )}
        </div>
        <div className="hud-tag text-[8.5px] truncate">{formula}</div>
      </div>
      <NumField value={metric.value} unit={unit} step={unit === "usd" ? 0.01 : 10} onChange={onMetric} manual={metric.source === "manual"} placeholder="enter" aria-label={label} />
      <div className="text-right min-w-0">
        <LabCount value={value} format={(n) => fmtUsd(n)} className="block text-[13px] font-semibold text-foreground" />
        <Delta pct={ok(up) ? up * 100 : null} className="text-[9.5px] justify-end" glow={false} />
      </div>
    </div>
  );
}

function ReverseDcf({
  implied,
  reason,
  yours,
  terminal,
  price,
  onUse,
}: {
  implied: number | null;
  reason?: string;
  yours: number;
  terminal: number;
  price: number | null;
  onUse: (g: number) => void;
}) {
  const gap = implied != null ? yours - implied : null;
  const reasonText: Record<string, string> = {
    "no-price": "Needs a price to solve.",
    "non-positive-fcf": "Needs a positive base cash flow to solve.",
    "invalid-inputs": "Inputs incomplete (shares, rates).",
    "below-range": "Price sits below what even −50%/yr growth implies.",
    "above-range": "Price implies more than +100%/yr growth for five years.",
  };
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <PricedInRing implied={implied} yours={yours} />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] tracking-widest text-dim">
            {implied != null ? (gap! >= 0 ? "ABOVE" : "BELOW") : "—"}
          </span>
        </div>
        <div className="min-w-0">
          <div className="hud-tag">price {price ? fmtUsd(price) : "—"} implies</div>
          <div className="flex items-baseline gap-2">
            <LabCount
              value={implied != null ? implied * 100 : NaN}
              format={(n) => `${n.toFixed(1)}%`}
              className="text-[30px] leading-none font-semibold text-amber glow-amber"
              data-testid="valuation-implied-growth"
            />
            <span className="hud-tag">/yr · y1-5</span>
          </div>
          <div className="text-[10.5px] text-muted-foreground mt-1 tabular-nums">
            your scenario <span className="text-up">{fmtPct(yours, 1)}</span>
            {gap != null && (
              <>
                <span className="text-dim"> · gap </span>
                <span className={gap >= 0 ? "text-hit" : "text-amber"}>
                  {gap >= 0 ? "▲" : "▼"} {(gap * 100).toFixed(1)}pp
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {implied != null ? (
        <>
          <RangeBar
            className="mt-3"
            min={-0.1}
            max={0.4}
            track="none"
            markers={[
              { value: Math.max(-0.1, Math.min(0.4, implied)), label: "priced-in", tone: "amber" },
              { value: Math.max(-0.1, Math.min(0.4, yours)), label: "yours", tone: "up" },
            ]}
            minLabel="−10%"
            maxLabel="+40%"
          />
          <p className="text-[11px] text-muted-foreground font-read leading-snug mt-2">
            At this price, the model implies about {fmtPct(implied, 1)} annual cash-flow growth for five years, fading to {fmtPct(terminal, 2)}.
            Your assumption is {gap! >= 0 ? "above" : "below"} what is priced in{Math.abs(gap!) < 0.005 ? " (roughly in line)" : ""}.
          </p>
          <button type="button" onClick={() => onUse(implied)} className="hud-btn mt-2" aria-label="Set growth assumption to the priced-in growth rate">
            <Crosshair className="w-3 h-3" />
            Use priced-in growth
          </button>
        </>
      ) : (
        <p className="text-[11px] text-amber mt-3">▲ {reasonText[reason ?? "invalid-inputs"]}</p>
      )}
    </div>
  );
}

function ModelLog({ lines }: { lines: [string, string, string, SourceTag][] }) {
  const animate = useAnimate();
  const status = (s: SourceTag) =>
    s === "manual" ? { t: "manual", c: "text-amber" } : s === "missing" ? { t: "missing", c: "text-down" } : s === "default" ? { t: "default", c: "text-dim" } : s === "mock" ? { t: "sample", c: "text-amber" } : { t: "ok", c: "text-hit" };
  return (
    <ol className="space-y-1 font-mono text-[10.5px]">
      {lines.map(([k, name, val, src], i) => {
        const st = status(src);
        return (
          <motion.li
            key={k}
            initial={animate ? { opacity: 0, x: -6 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={animate ? { duration: 0.25, delay: 0.1 + i * 0.07 } : { duration: 0 }}
            className="grid grid-cols-[18px_58px_minmax(0,1fr)_auto] sm:grid-cols-[18px_64px_92px_minmax(0,1fr)_auto] gap-2 items-center hover:bg-primary/5 transition-colors"
          >
            <span className="text-dim tabular-nums">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-primary truncate">{k}</span>
            <span className="text-muted-foreground truncate hidden sm:inline">{name}</span>
            <span className="text-foreground tabular-nums truncate">
              {val}
            </span>
            <span className={cn("text-right", st.c)}>
              {st.t} <span className="text-dim">· {src}</span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

function HowComputed() {
  const animate = useAnimate();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="vl-formulas"
        className="hud-btn w-full justify-between"
      >
        <span>{open ? "Hide formulas" : "Show formulas"}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: animate ? 0.2 : 0 }}>
          <ChevronDown className="w-3.5 h-3.5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="vl-formulas"
            key="f"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <pre className="mt-3 text-[10.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
{`Cash flow     FCF₀ = base FCF, or EPS(TTM) × shares as an owner-earnings proxy
Growth        g(t) = g            for t = 1..5
              g(t) = g + (g∞ − g)·(t − 5)/5   for t = 6..10  (reaches g∞ in year 10)
Projection    FCF(t) = FCF(t−1) · (1 + g(t))
Discounting   PV(t) = FCF(t) / (1 + r)^t
Terminal      TV = FCF(10) · (1 + g∞) / (r − g∞)      Gordon; DCF block + sensitivity grid
              requires r ≥ g∞ + 0.5pp (r is clamped otherwise)
              PV(TV) = TV / (1 + r)^10
Value         EV = Σ PV(t) + PV(TV);  equity = EV + net cash
              value / share = equity / shares
Scenarios     each runs the DCF with g + Δg, FCF₀·(1 + margin shift),
              TV = FCF(10) × exit multiple (base multiple = (1 + g∞)/(r − g∞));
              at 1.0× that multiple the TV is the Gordon TV, so an unshifted
              base scenario = DCF per share = sensitivity current cell
Fair value    Σ p(i) · value(i),  p normalized to 100%
Multiples     P/E: EPS × multiple
              EV/EBITDA: (EBITDA × multiple + net cash) / shares
              P/S: revenue × multiple / shares
Sensitivity   7×7 grid, r ± 1.5pp (0.5pp steps) × g∞ ± 0.75pp (0.25pp steps)
Reverse DCF   bisection on g in [−50%, +100%] until value / share = price
Margin of     (fair value − price) / fair value
safety
Defaults      r = 4.25% + β × 5.5% (clamped 6–14%) when β is known, else 9%
              g = TTM EPS vs prior TTM (clamped −5…30%), else revenue YoY, else 8%
              net cash ≈ market cap − EV/EBITDA × EBITDA when FMP data exists, else 0`}
            </pre>
            <p className="mt-2 text-[11px] text-dim font-read leading-snug">
              Every figure is an implied value under the inputs shown, intended for scenario analysis. Change any input to see how
              sensitive the result is; nothing here is a forecast or a recommendation.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
