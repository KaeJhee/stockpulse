/**
 * Valuation Lab: visual modules (cash-flow bars, sensitivity heatmap, football field,
 * probability tiles, priced-in ring). All colors come from theme tokens.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAnimate } from "@/components/hud";
import type { DcfResult, SensitivityGrid } from "@/lib/valuation";
import { fmtMoneyM, fmtPct, fmtUsd } from "./ValuationLabControls";

const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
/** Axis percent: 2 decimals, trailing zero trimmed to 1 (9.0%, 9.25%, 2.5%, 2.75%), so off-lattice rates are not mislabeled. */
const fmtAxisPct = (d: number) => `${(d * 100).toFixed(2).replace(/(\.\d)0$/, "$1")}%`;

// ─────────────────────────────────────────────────────────────────────────────
// Projected cash-flow bars (10 years + terminal value)
// ─────────────────────────────────────────────────────────────────────────────

export function CashFlowBars({ result, highYears = 5 }: { result: DcfResult; highYears?: number }) {
  const animate = useAnimate();
  const [hover, setHover] = useState<number | null>(null);
  const maxFcf = useMemo(() => Math.max(1e-9, ...result.years.map((y) => Math.abs(y.fcf))), [result.years]);
  const negative = result.years.some((y) => y.fcf < 0);
  const bars = [
    ...result.years.map((y) => ({ key: `y${y.year}`, label: `Y${y.year}`, ...y, terminal: false })),
    {
      key: "tv",
      label: "TV",
      year: result.years.length + 1,
      growth: NaN,
      fcf: result.terminalValue,
      discountFactor: result.years.length ? result.years[result.years.length - 1].discountFactor : 1,
      pv: result.pvTerminal,
      terminal: true,
    },
  ];
  const active = hover != null ? bars[hover] : null;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {/* tooltip / readout */}
      <div className="h-9 mb-1 flex items-end">
        <AnimatePresence mode="wait" initial={false}>
          {active ? (
            <motion.div
              key={active.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums"
              role="status"
            >
              <span className={cn("hud-title", active.terminal ? "text-amber" : "text-up")}>
                {active.terminal ? "Terminal value" : `Year ${active.year}`}
              </span>
              {!active.terminal && <span className="text-dim">g {fmtPct(active.growth, 1, true)}</span>}
              <span>
                <span className="text-dim">{active.terminal ? "TV " : "FCF "}</span>
                {fmtMoneyM(active.fcf)}
              </span>
              <span>
                <span className="text-dim">PV </span>
                <span className={active.terminal ? "text-amber" : "text-up"}>{fmtMoneyM(active.pv)}</span>
              </span>
              <span className="text-dim">df {active.discountFactor.toFixed(3)}</span>
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hud-tag">
              hover or focus a bar · outline = FCF, fill = present value
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative h-36 flex items-end gap-[3px] sm:gap-1.5 border-b border-border">
        {/* phase divider: high growth | fade */}
        <span
          aria-hidden
          className="absolute top-0 bottom-0 border-l border-dashed border-amber/30"
          style={{ left: `${(highYears / bars.length) * 100}%` }}
        />
        <span aria-hidden className="absolute top-0 hud-tag text-[8.5px]" style={{ left: 2 }}>
          high growth
        </span>
        <span aria-hidden className="absolute top-0 hud-tag text-[8.5px]" style={{ left: `calc(${(highYears / bars.length) * 100}% + 4px)` }}>
          fade → terminal
        </span>
        {bars.map((b, i) => {
          const h = b.terminal ? 100 : (Math.abs(b.fcf) / maxFcf) * 82;
          const pvH = b.terminal ? Math.max(8, Math.min(100, (b.pv / (b.fcf || 1)) * 100)) : (Math.abs(b.pv) / maxFcf) * 82;
          const isHover = hover === i;
          const tone = b.terminal ? "amber" : b.fcf < 0 ? "down" : "up";
          return (
            <button
              key={b.key}
              type="button"
              className="relative flex-1 h-full flex flex-col justify-end items-stretch focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={
                b.terminal
                  ? `Terminal value ${fmtMoneyM(b.fcf)}, present value ${fmtMoneyM(b.pv)}`
                  : `Year ${b.year}: FCF ${fmtMoneyM(b.fcf)}, growth ${fmtPct(b.growth, 1)}, present value ${fmtMoneyM(b.pv)}`
              }
            >
              <motion.span
                className={cn(
                  "relative block w-full border",
                  tone === "amber" ? "border-amber/70" : tone === "down" ? "border-down/60" : "border-up/45",
                  isHover && (tone === "amber" ? "box-glow-amber" : tone === "down" ? "box-glow-red" : "box-glow-teal"),
                )}
                style={{ transformOrigin: "bottom" }}
                initial={animate ? { height: "0%" } : false}
                animate={{ height: `${Math.max(1.5, h)}%` }}
                transition={animate ? { type: "spring", stiffness: 140, damping: 22, delay: 0.1 + i * 0.045 } : { duration: 0 }}
              >
                <motion.span
                  className={cn(
                    "absolute bottom-0 left-0 right-0",
                    tone === "amber" ? "bg-amber/60" : tone === "down" ? "bg-down/50" : "bg-up/45",
                    isHover && "brightness-125",
                  )}
                  initial={animate ? { height: "0%" } : false}
                  animate={{ height: `${Math.max(0, Math.min(100, b.terminal ? pvH : (pvH / Math.max(h, 1e-9)) * 100))}%` }}
                  transition={animate ? { type: "spring", stiffness: 120, damping: 22, delay: 0.25 + i * 0.045 } : { duration: 0 }}
                />
                {b.terminal && (
                  <span aria-hidden className="absolute -top-[5px] left-0 right-0 text-center text-[9px] leading-none text-amber bg-card">
                    ≈
                  </span>
                )}
              </motion.span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-[3px] sm:gap-1.5 mt-1">
        {bars.map((b, i) => (
          <span
            key={b.key}
            className={cn(
              "flex-1 text-center text-[8.5px] sm:text-[9px] tracking-wider tabular-nums",
              b.terminal ? "text-amber" : hover === i ? "text-foreground" : "text-dim",
            )}
          >
            {b.label}
          </span>
        ))}
      </div>
      {negative && <p className="hud-tag text-down mt-1">▼ negative cash flows in the projection</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensitivity heatmap: discount rate (rows) × terminal growth (cols)
// ─────────────────────────────────────────────────────────────────────────────

export function SensitivityHeatmap({
  grid,
  currentRate,
  currentGrowth,
  onPick,
}: {
  grid: SensitivityGrid;
  currentRate: number;
  currentGrowth: number;
  onPick: (rate: number, growth: number) => void;
}) {
  const animate = useAnimate();
  const n = grid.rates.length;
  const center = Math.floor(n / 2);
  const [focus, setFocus] = useState<[number, number]>([center, center]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const maxAbs = useMemo(() => {
    let m = 0;
    for (const row of grid.cells) for (const c of row) if (ok(c.upside)) m = Math.max(m, Math.abs(c.upside));
    return Math.max(0.15, Math.min(1, m));
  }, [grid]);

  const isCurrent = (r: number, g: number) => Math.abs(r - currentRate) < 1e-6 && Math.abs(g - currentGrowth) < 1e-6;
  const shown = hover ?? null;
  const hc = shown ? grid.cells[shown[0]][shown[1]] : null;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, ri: number, ci: number) => {
    let [r, c] = [ri, ci];
    if (e.key === "ArrowUp") r = Math.max(0, ri - 1);
    else if (e.key === "ArrowDown") r = Math.min(n - 1, ri + 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, ci - 1);
    else if (e.key === "ArrowRight") c = Math.min(grid.growths.length - 1, ci + 1);
    else return;
    e.preventDefault();
    setFocus([r, c]);
    setHover([r, c]);
    refs.current[r * grid.growths.length + c]?.focus();
  };

  return (
    <div>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full border-separate tabular-nums" style={{ borderSpacing: 2 }} role="grid" aria-label="Sensitivity: discount rate by terminal growth">
          <thead>
            <tr>
              <th className="hud-tag text-left font-normal pr-1 whitespace-nowrap">r ↓ · g →</th>
              {grid.growths.map((g, ci) => (
                <th
                  key={g}
                  scope="col"
                  className={cn(
                    "text-[9px] font-normal tracking-wider pb-0.5",
                    Math.abs(g - currentGrowth) < 1e-6 ? "text-amber" : shown?.[1] === ci ? "text-foreground" : "text-dim",
                  )}
                >
                  {fmtAxisPct(g)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.cells.map((row, ri) => (
              <tr key={grid.rates[ri]}>
                <th
                  scope="row"
                  className={cn(
                    "text-[9px] font-normal tracking-wider text-left pr-1",
                    Math.abs(grid.rates[ri] - currentRate) < 1e-6 ? "text-amber" : shown?.[0] === ri ? "text-foreground" : "text-dim",
                  )}
                >
                  {fmtAxisPct(grid.rates[ri])}
                </th>
                {row.map((c, ci) => {
                  const valid = ok(c.value);
                  const up = ok(c.upside) ? c.upside : 0;
                  const intensity = ok(c.upside) ? 0.08 + Math.min(1, Math.abs(up) / maxAbs) * 0.5 : 0;
                  const bg = !valid
                    ? "transparent"
                    : !ok(c.upside)
                      ? "hsl(var(--muted))"
                      : up >= 0
                        ? `hsl(var(--up) / ${intensity.toFixed(3)})`
                        : `hsl(var(--down) / ${intensity.toFixed(3)})`;
                  const cur = isCurrent(c.discountRate, c.terminalGrowth);
                  const idx = ri * row.length + ci;
                  return (
                    <td key={c.terminalGrowth} className="p-0">
                      <motion.button
                        ref={(el) => (refs.current[idx] = el)}
                        type="button"
                        disabled={!valid}
                        tabIndex={focus[0] === ri && focus[1] === ci ? 0 : -1}
                        onClick={() => {
                          if (!valid) return;
                          onPick(c.discountRate, c.terminalGrowth);
                          // the grid re-centers on the picked cell: keep the roving focus on it
                          setFocus([center, center]);
                          setHover(null);
                          if (document.activeElement === refs.current[idx]) refs.current[center * row.length + center]?.focus();
                        }}
                        onKeyDown={(e) => onKey(e, ri, ci)}
                        onMouseEnter={() => setHover([ri, ci])}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover([ri, ci])}
                        onBlur={() => setHover(null)}
                        initial={animate ? { opacity: 0, scale: 0.85 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={animate ? { duration: 0.25, delay: (ri + ci) * 0.025 } : { duration: 0 }}
                        className={cn(
                          "relative w-full h-7 sm:h-8 px-0.5 text-[9.5px] sm:text-[10.5px] leading-none border transition-[border-color,box-shadow,filter] duration-150",
                          valid ? "cursor-pointer hover:brightness-125 hover:border-foreground/50" : "cursor-not-allowed text-dim",
                          cur ? "border-amber box-glow-amber text-amber font-semibold" : "border-transparent",
                          "focus:outline-none focus-visible:border-ring",
                        )}
                        style={{ background: bg }}
                        aria-label={
                          valid
                            ? `Discount ${fmtAxisPct(c.discountRate)}, terminal growth ${fmtAxisPct(c.terminalGrowth)}: ${fmtUsd(c.value)}${ok(c.upside) ? `, ${fmtPct(c.upside, 1, true)} vs price` : ""}. Click to apply.`
                            : "Invalid: discount rate must exceed terminal growth"
                        }
                        aria-current={cur ? "true" : undefined}
                      >
                        {valid ? (c.value >= 1000 ? Math.round(c.value).toLocaleString("en-US") : c.value.toFixed(c.value >= 100 ? 0 : 1)) : "—"}
                      </motion.button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 min-h-[18px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] tabular-nums" aria-live="polite">
        {hc && ok(hc.value) ? (
          <>
            <span className="text-dim">
              r {fmtAxisPct(hc.discountRate)} · g {fmtAxisPct(hc.terminalGrowth)}
            </span>
            <span className="text-foreground">{fmtUsd(hc.value)}</span>
            {ok(hc.upside) && (
              <span className={hc.upside >= 0 ? "text-up" : "text-down"}>
                {hc.upside >= 0 ? "▲" : "▼"} {fmtPct(hc.upside, 1, true)} implied
              </span>
            )}
            <span className="hud-tag ml-auto">click / enter to apply</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 hud-tag">
              <span className="inline-block w-2.5 h-2.5 bg-up/50" /> above price
            </span>
            <span className="inline-flex items-center gap-1.5 hud-tag">
              <span className="inline-block w-2.5 h-2.5 bg-down/50" /> below price
            </span>
            <span className="inline-flex items-center gap-1.5 hud-tag">
              <span className="inline-block w-2.5 h-2.5 border border-amber" /> current
            </span>
            <span className="hud-tag ml-auto">arrows move · enter applies</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Football field
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldRow {
  key: string;
  label: string;
  low: number;
  high: number;
  mid?: number | null;
  tone: "up" | "amber" | "dim" | "violet";
  note?: string;
}

/** Keeps an overlay label inside the plot near the left/right edges. */
const edgeShift = (p: number) => (p < 12 ? "translate-x-0" : p > 88 ? "-translate-x-full" : "-translate-x-1/2");

const rowTone = {
  up: "bg-up/30 border-up/60",
  amber: "bg-amber/25 border-amber/60",
  dim: "bg-muted-foreground/20 border-muted-foreground/40",
  violet: "bg-violet/25 border-violet/60",
};

export function FootballField({ rows, price, fair }: { rows: FieldRow[]; price: number | null; fair: number | null }) {
  const animate = useAnimate();
  const [hover, setHover] = useState<string | null>(null);
  const valid = rows.filter((r) => ok(r.low) && ok(r.high));
  const { lo, hi } = useMemo(() => {
    const xs = valid.flatMap((r) => [r.low, r.high]);
    if (ok(price)) xs.push(price);
    if (ok(fair)) xs.push(fair);
    if (!xs.length) return { lo: 0, hi: 1 };
    const mn = Math.min(...xs);
    const mx = Math.max(...xs);
    const pad = (mx - mn) * 0.08 || Math.abs(mx) * 0.1 || 1;
    return { lo: Math.max(0, mn - pad), hi: mx + pad };
  }, [valid, price, fair]);
  const pct = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i++) out.push(lo + ((hi - lo) * i) / 4);
    return out;
  }, [lo, hi]);

  if (!valid.length) return <p className="hud-tag py-6 text-center">not enough inputs for a range yet</p>;

  return (
    <div className="grid grid-cols-[76px_1fr] sm:grid-cols-[104px_1fr] gap-x-2 pt-4 pb-1">
      {/* rows */}
      {valid.map((r, i) => {
        const left = pct(Math.min(r.low, r.high));
        const width = Math.max(0.8, pct(Math.max(r.low, r.high)) - left);
        const isHover = hover === r.key;
        return (
          <div key={r.key} className="contents">
            <div
              className={cn("flex items-center h-8 hud-label truncate transition-colors", isHover && "text-foreground")}
              style={{ gridColumn: 1, gridRow: i + 1 }}
              title={r.note}
            >
              {r.label}
            </div>
            <div
              className="relative h-8"
              style={{ gridColumn: 2, gridRow: i + 1 }}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
            >
              {/* grid ticks */}
              {ticks.map((t) => (
                <span key={t} aria-hidden className="absolute top-0 bottom-0 w-px bg-border/50" style={{ left: `${pct(t)}%` }} />
              ))}
              <motion.div
                className={cn("absolute top-1.5 bottom-1.5 border", rowTone[r.tone], isHover && "brightness-125")}
                initial={animate ? { left: `${pct(price ?? lo)}%`, width: "0%", opacity: 0 } : false}
                animate={{ left: `${left}%`, width: `${width}%`, opacity: 1 }}
                transition={animate ? { type: "spring", stiffness: 110, damping: 20, delay: 0.1 + i * 0.07 } : { duration: 0 }}
                title={`${r.label}: ${fmtUsd(r.low)} → ${fmtUsd(r.high)}${r.note ? ` · ${r.note}` : ""}`}
              >
                {ok(r.mid) && (
                  <span
                    aria-hidden
                    className="absolute top-0 bottom-0 w-[2px] bg-foreground/80"
                    style={{ left: `${((r.mid - Math.min(r.low, r.high)) / (Math.abs(r.high - r.low) || 1)) * 100}%` }}
                  />
                )}
              </motion.div>
              {/* value labels */}
              <motion.span
                className="absolute top-1/2 -translate-y-1/2 text-[9.5px] tabular-nums text-muted-foreground pr-1 -translate-x-full whitespace-nowrap"
                animate={{ left: `${left}%` }}
                transition={animate ? { type: "spring", stiffness: 110, damping: 20 } : { duration: 0 }}
                style={{ display: left > 14 ? undefined : "none" }}
              >
                {fmtUsd(Math.min(r.low, r.high), 0)}
              </motion.span>
              <motion.span
                className="absolute top-1/2 -translate-y-1/2 text-[9.5px] tabular-nums text-muted-foreground pl-1 whitespace-nowrap"
                animate={{ left: `${left + width}%` }}
                transition={animate ? { type: "spring", stiffness: 110, damping: 20 } : { duration: 0 }}
                style={{ display: left + width < 86 ? undefined : "none" }}
              >
                {fmtUsd(Math.max(r.low, r.high), 0)}
              </motion.span>
            </div>
          </div>
        );
      })}

      {/* axis */}
      <div className="relative h-9 border-t border-border" style={{ gridColumn: 2, gridRow: valid.length + 1 }}>
        {ticks.map((t, ti) => (
          <span
            key={t}
            className={cn(
              "absolute bottom-0 text-[9px] text-dim tabular-nums",
              ti === 0 ? "translate-x-0" : ti === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
            )}
            style={{ left: `${pct(t)}%` }}
          >
            {fmtUsd(t, 0)}
          </span>
        ))}
      </div>

      {/* overlay lines: price + fair value (span all rows) */}
      <div className="relative pointer-events-none" style={{ gridColumn: 2, gridRow: `1 / span ${valid.length}` }}>
        {ok(price) && (
          <motion.div
            className="absolute -top-1 -bottom-1 w-0 border-l border-dashed border-foreground/70"
            animate={{ left: `${pct(price)}%` }}
            transition={animate ? { type: "spring", stiffness: 120, damping: 20 } : { duration: 0 }}
          >
            <span className={cn("absolute -top-4 text-[9px] tabular-nums text-foreground whitespace-nowrap bg-card px-0.5", edgeShift(pct(price)))}>
              px {fmtUsd(price, 0)}
            </span>
          </motion.div>
        )}
        {ok(fair) && (
          <motion.div
            className="absolute -top-1 -bottom-1 w-[2px] bg-amber box-glow-amber"
            animate={{ left: `${pct(fair)}%` }}
            transition={animate ? { type: "spring", stiffness: 120, damping: 20 } : { duration: 0 }}
          >
            <span className={cn("absolute -bottom-4 text-[9px] tabular-nums text-amber whitespace-nowrap bg-card px-0.5", edgeShift(pct(fair)))}>
              fv {fmtUsd(fair, 0)}
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 100-tile probability grid (bear / base / bull)
// ─────────────────────────────────────────────────────────────────────────────

export function ProbabilityTiles({ weights }: { weights: [number, number, number] }) {
  const animate = useAnimate();
  const [bear, base] = weights;
  const tiles = useMemo(
    () => Array.from({ length: 100 }, (_, i) => (i < bear ? "bear" : i < bear + base ? "base" : "bull")),
    [bear, base],
  );
  return (
    <div
      className="grid gap-[2px]"
      style={{ gridTemplateColumns: "repeat(25, minmax(0, 1fr))" }}
      role="img"
      aria-label={`Probability mass: bear ${weights[0]}%, base ${weights[1]}%, bull ${weights[2]}%`}
    >
      {tiles.map((t, i) => (
        <motion.span
          key={i}
          className={cn(
            "block aspect-square transition-colors duration-500",
            t === "bear" ? "bg-down/70" : t === "base" ? "bg-amber/65" : "bg-up/70",
          )}
          initial={animate ? { opacity: 0, scale: 0.4 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={animate ? { duration: 0.2, delay: 0.2 + (i % 25) * 0.012 + Math.floor(i / 25) * 0.05 } : { duration: 0 }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Priced-in ring: implied growth vs your assumption
// ─────────────────────────────────────────────────────────────────────────────

export function PricedInRing({ implied, yours }: { implied: number | null; yours: number }) {
  const animate = useAnimate();
  const R = 34;
  const C = 2 * Math.PI * R;
  // map growth −10%…40% onto the ring
  const frac = (g: number) => Math.max(0, Math.min(1, (g + 0.1) / 0.5));
  const above = ok(implied) ? yours >= implied : null;
  return (
    <svg viewBox="0 0 84 84" className="w-[84px] h-[84px] shrink-0 -rotate-90" aria-hidden>
      <circle cx="42" cy="42" r={R} fill="none" stroke="hsl(var(--muted-foreground) / .18)" strokeWidth="5" />
      <motion.circle
        cx="42"
        cy="42"
        r={R}
        fill="none"
        stroke="hsl(var(--up))"
        strokeWidth="2"
        strokeDasharray={C}
        initial={animate ? { strokeDashoffset: C } : false}
        animate={{ strokeDashoffset: C * (1 - frac(yours)) }}
        transition={animate ? { type: "spring", stiffness: 60, damping: 16 } : { duration: 0 }}
      />
      {ok(implied) && (
        <motion.circle
          cx="42"
          cy="42"
          r={R - 6}
          fill="none"
          stroke={above ? "hsl(var(--hit))" : "hsl(var(--amber))"}
          strokeWidth="5"
          strokeDasharray={2 * Math.PI * (R - 6)}
          initial={animate ? { strokeDashoffset: 2 * Math.PI * (R - 6) } : false}
          animate={{ strokeDashoffset: 2 * Math.PI * (R - 6) * (1 - frac(implied)) }}
          transition={animate ? { type: "spring", stiffness: 60, damping: 16, delay: 0.15 } : { duration: 0 }}
          style={{ filter: `drop-shadow(0 0 calc(4px * var(--glow-strength)) ${above ? "hsl(var(--hit))" : "hsl(var(--amber))"})` }}
        />
      )}
    </svg>
  );
}
