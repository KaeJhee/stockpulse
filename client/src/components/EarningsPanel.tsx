import { useEarnings, useAnalystRatings, useSnapshot } from "@/lib/hooks";
import { BarChart3, ChevronDown, Users } from "lucide-react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { useState, useMemo, useRef, useId, useEffect, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { EarningsRecord } from "@/lib/mockData";
import { Panel, CountUp, RangeBar, Delta, useAnimate, useAmbient, type RangeMarker } from "@/components/hud";
import { cn } from "@/lib/utils";

interface Props { ticker: string }

const EASE = [0.2, 0.8, 0.2, 1] as const;

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtCur(val: number | null | undefined): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtEps(val: number | null | undefined): string {
  if (val == null) return "—";
  return `$${val.toFixed(2)}`;
}

function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}%`;
}

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function fmtDate(iso: string, pattern = "MMM d, yyyy"): string {
  const d = safeDate(iso);
  return d ? format(d, pattern) : iso || "—";
}

/** Calendar days from today until the report date (null when unknown). */
function daysUntil(iso: string): number | null {
  const d = safeDate(iso);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}

function countdownLabel(days: number | null): string {
  if (days == null) return "date tbd";
  if (days < 0) return "awaiting print";
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

/** EPS surprise %, from the source when present, otherwise derived from actual vs estimate. */
function surpriseOf(r: EarningsRecord): number | null {
  if (r.eps_surprise != null && Number.isFinite(r.eps_surprise)) return r.eps_surprise;
  if (r.actual_eps != null && r.estimated_eps != null && r.estimated_eps !== 0) {
    return ((r.actual_eps - r.estimated_eps) / Math.abs(r.estimated_eps)) * 100;
  }
  return null;
}

type Outcome = "beat" | "miss" | "inline" | "pending";
function outcomeOf(s: number | null): Outcome {
  if (s == null) return "pending";
  return s > 0 ? "beat" : s < 0 ? "miss" : "inline";
}

const OUT = {
  beat:    { text: "text-hit",   border: "border-hit",   bg: "bg-hit",   soft: "bg-hit/10 border-hit/50",     glyph: "▲", word: "Beat",    glow: "glow-hit" },
  miss:    { text: "text-amber", border: "border-amber", bg: "bg-amber", soft: "bg-amber/10 border-amber/50", glyph: "▼", word: "Miss",    glow: "glow-amber" },
  inline:  { text: "text-muted-foreground", border: "border-dim", bg: "bg-dim", soft: "bg-muted/50 border-border", glyph: "◆", word: "In-line", glow: "" },
  pending: { text: "text-up",    border: "border-up",    bg: "bg-up",    soft: "bg-up/10 border-up/40",       glyph: "◇", word: "Est",     glow: "" },
} as const;

function shortQ(r: EarningsRecord): { q: string; y: string } {
  const q = Number.isFinite(r.fiscal_quarter) && r.fiscal_quarter > 0 ? `Q${r.fiscal_quarter}` : (r.fiscal_period.split(/\s+/)[0] || "—");
  const yr = Number.isFinite(r.fiscal_year) && r.fiscal_year > 0 ? String(r.fiscal_year) : "";
  return { q, y: yr ? `'${yr.slice(-2)}` : "" };
}

/** Static or pinging dot depending on the ambient-motion setting. */
function Dot({ tone, ambient }: { tone: "hit" | "amber" | "red" | "dim"; ambient: boolean }) {
  if (ambient) return <span className="live-dot" data-tone={tone === "hit" ? undefined : tone} />;
  const bg = tone === "hit" ? "bg-hit" : tone === "amber" ? "bg-amber" : tone === "red" ? "bg-down" : "bg-dim";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", bg)} />;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BeatMissBadge({ surprise, label }: { surprise: number | null; label?: string }) {
  if (surprise == null) return null;
  const o = OUT[outcomeOf(surprise)];
  const isBeat = surprise > 0;
  const isMiss = surprise < 0;
  return (
    <span className={cn("inline-flex items-center gap-1 h-[18px] px-1.5 border text-[9.5px] uppercase tracking-[.1em] tabular-nums shrink-0", o.soft, o.text)}>
      <span className="text-[8px]" aria-hidden>{o.glyph}</span>
      {label && <span className="opacity-80">{label}</span>}
      <span>{isBeat ? "beat" : isMiss ? "miss" : "in-line"}</span>
      <span>{fmtPct(surprise)}</span>
    </span>
  );
}

function ChangeChip({ value, prefix }: { value: number | null; prefix?: string }) {
  if (value == null) return <span className="text-dim tabular-nums text-[11px]">—</span>;
  const isPos = value > 0;
  const isNeg = value < 0;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-[10.5px] tabular-nums", isPos ? "text-up" : isNeg ? "text-down" : "text-muted-foreground")}
      title="Year over year"
    >
      <span className="text-[8px]" aria-hidden>{isPos ? "▲" : isNeg ? "▼" : "◆"}</span>
      {prefix}{fmtPct(value)} <span className="text-dim">y/y</span>
    </span>
  );
}

function SurpriseBar({ value }: { value: number | null }) {
  const animate = useAnimate();
  if (value == null) return null;
  const clamped = Math.max(-20, Math.min(20, value));
  const w = Math.abs(clamped / 20) * 50;
  const color = value > 0 ? "bg-hit" : value < 0 ? "bg-amber" : "bg-dim";
  return (
    <div className="relative h-1.5 bg-muted overflow-hidden w-24" aria-hidden>
      <motion.div
        className={cn("absolute top-0 h-full", color)}
        style={value >= 0 ? { left: "50%" } : { right: "50%" }}
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${w}%` }}
        transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
      />
      <div className="absolute top-0 left-1/2 w-px h-full bg-foreground/40" />
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="hud-tag mb-0.5 truncate">{label}</div>
      <div className={cn("text-[12px] tabular-nums truncate", highlight ? "text-foreground font-semibold" : "text-muted-foreground")}>
        {value}
      </div>
    </div>
  );
}

/** Expand / collapse wrapper with an animated height. */
function Expand({ open, children, className }: { open: boolean; children: React.ReactNode; className?: string }) {
  const animate = useAnimate();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
          initial={animate ? { height: 0, opacity: 0 } : false}
          animate={{ height: "auto", opacity: 1 }}
          exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
          transition={{ duration: animate ? 0.28 : 0, ease: EASE }}
          className={cn("overflow-hidden", className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Chevron({ open }: { open: boolean }) {
  const animate = useAnimate();
  return (
    <motion.span initial={false} animate={{ rotate: open ? 180 : 0 }} transition={{ duration: animate ? 0.25 : 0 }} className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
      <ChevronDown className="w-3.5 h-3.5" />
    </motion.span>
  );
}

// ── Past Earnings Card ────────────────────────────────────────────────────────

function PastEarningsRow({ record, isExpanded, onToggle, idx }: {
  record: EarningsRecord;
  isExpanded: boolean;
  onToggle: () => void;
  idx: number;
}) {
  const yoyEps = record.prior_year_eps && record.actual_eps != null
    ? ((record.actual_eps - record.prior_year_eps) / Math.abs(record.prior_year_eps)) * 100
    : null;
  const yoyRev = record.prior_year_revenue && record.actual_revenue != null
    ? ((record.actual_revenue - record.prior_year_revenue) / Math.abs(record.prior_year_revenue)) * 100
    : null;
  const outcome = outcomeOf(record.eps_surprise);
  const edge = outcome === "beat" ? "bg-hit" : outcome === "miss" ? "bg-amber" : "bg-dim";
  const bodyId = `earn-body-${record.id}`;

  return (
    <div
      className={cn(
        "group relative border bg-background/30 transition-colors duration-200",
        isExpanded ? "border-primary/50 bg-up/[0.04]" : "border-border/60 hover:border-primary/40 hover:bg-up/[0.03]",
      )}
      data-testid={`earnings-past-${idx}`}
      data-record-id={record.id}
    >
      <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-[2px] opacity-70", edge)} />
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        className="w-full pl-3.5 pr-3 py-2.5 flex items-center gap-2 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1"
        data-testid={`button-expand-past-${idx}`}
      >
        <div className="flex-1 min-w-0">
          {/* Row 1: Period + date + beat/miss */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold tracking-wider shrink-0 text-foreground">{record.fiscal_period}</span>
            <span className="hud-tag shrink-0 tabular-nums">{fmtDate(record.date)}</span>
            {record.time && record.time !== "—" && (
              <span className="hud-tag border border-border px-1 shrink-0">{record.time}</span>
            )}
            <BeatMissBadge surprise={record.eps_surprise} label="EPS" />
            <BeatMissBadge surprise={record.revenue_surprise} label="Rev" />
          </div>

          {/* Row 2: EPS + Revenue actuals vs estimates */}
          <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="hud-label">EPS</span>
              <span className="text-[12px] font-semibold tabular-nums text-foreground">{fmtEps(record.actual_eps)}</span>
              {record.estimated_eps != null && (
                <span className="text-[10px] text-dim tabular-nums">vs est. {fmtEps(record.estimated_eps)}</span>
              )}
              <ChangeChip value={yoyEps} />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="hud-label">Rev</span>
              <span className="text-[12px] font-semibold tabular-nums text-foreground">{fmtCur(record.actual_revenue)}</span>
              {record.estimated_revenue != null && (
                <span className="text-[10px] text-dim tabular-nums">vs est. {fmtCur(record.estimated_revenue)}</span>
              )}
              <ChangeChip value={yoyRev} />
            </div>
          </div>
        </div>
        <Chevron open={isExpanded} />
      </button>

      <Expand open={isExpanded}>
        <div id={bodyId} className="pl-3.5 pr-3 pb-3 border-t border-border/60">
          <div className="grid grid-cols-1 gap-3 mt-3">
            <div>
              <div className="hud-label mb-1.5">EPS</div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Actual" value={fmtEps(record.actual_eps)} highlight />
                <Metric label="Estimate" value={fmtEps(record.estimated_eps)} />
                <Metric label="Prior Year" value={fmtEps(record.prior_year_eps)} />
              </div>
              {record.eps_surprise != null && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="hud-tag">Surprise</span>
                  <SurpriseBar value={record.eps_surprise} />
                  <span className={cn("text-[11px] tabular-nums", OUT[outcomeOf(record.eps_surprise)].text)}>
                    {OUT[outcomeOf(record.eps_surprise)].glyph} {fmtPct(record.eps_surprise)}
                  </span>
                </div>
              )}
            </div>

            <div className="border-t border-border/50 pt-2">
              <div className="hud-label mb-1.5">Revenue</div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Actual" value={fmtCur(record.actual_revenue)} highlight />
                <Metric label="Estimate" value={fmtCur(record.estimated_revenue)} />
                <Metric label="Prior Year" value={fmtCur(record.prior_year_revenue)} />
              </div>
              {record.revenue_surprise != null && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="hud-tag">Surprise</span>
                  <SurpriseBar value={record.revenue_surprise} />
                  <span className={cn("text-[11px] tabular-nums", OUT[outcomeOf(record.revenue_surprise)].text)}>
                    {OUT[outcomeOf(record.revenue_surprise)].glyph} {fmtPct(record.revenue_surprise)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Expand>
    </div>
  );
}

// ── Upcoming Earnings Card ────────────────────────────────────────────────────

function UpcomingEarningsRow({ record, isExpanded, onToggle, idx }: {
  record: EarningsRecord;
  isExpanded: boolean;
  onToggle: () => void;
  idx: number;
}) {
  const ambient = useAmbient();
  const days = daysUntil(record.date);
  const bodyId = `earn-body-${record.id}`;
  return (
    <div
      className={cn(
        "group relative border transition-colors duration-200",
        isExpanded ? "border-primary/60 bg-up/[0.07]" : "border-primary/30 bg-up/[0.04] hover:border-primary/60",
      )}
      data-testid={`earnings-upcoming-${idx}`}
      data-record-id={record.id}
    >
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-up box-glow-teal" />
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        className="w-full pl-3.5 pr-3 py-2.5 flex items-center gap-2 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1"
        data-testid={`button-expand-upcoming-${idx}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] font-semibold tracking-wider shrink-0 text-foreground">{record.fiscal_period}</span>
            <span className="hud-tag shrink-0 tabular-nums">{fmtDate(record.date)}</span>
            {record.time && record.time !== "—" && (
              <span className="hud-tag border border-border px-1 shrink-0">{record.time}</span>
            )}
            <span className="inline-flex items-center gap-1.5 h-[18px] px-1.5 border border-up/40 bg-up/10 text-up text-[9.5px] uppercase tracking-[.1em] tabular-nums shrink-0">
              <Dot tone="hit" ambient={ambient} />
              Upcoming · {countdownLabel(days)}
            </span>
          </div>

          <div className="flex items-center gap-x-4 gap-y-1 mt-1.5 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="hud-label">EPS Est.</span>
              <span className="text-[12px] font-semibold tabular-nums text-foreground">{fmtEps(record.estimated_eps)}</span>
              {record.eps_estimate_low != null && record.eps_estimate_high != null && (
                <span className="text-[10px] text-dim tabular-nums">
                  ({fmtEps(record.eps_estimate_low)} – {fmtEps(record.eps_estimate_high)})
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="hud-label">Rev Est.</span>
              <span className="text-[12px] font-semibold tabular-nums text-foreground">{fmtCur(record.estimated_revenue)}</span>
              {record.revenue_estimate_low != null && record.revenue_estimate_high != null && (
                <span className="text-[10px] text-dim tabular-nums">
                  ({fmtCur(record.revenue_estimate_low)} – {fmtCur(record.revenue_estimate_high)})
                </span>
              )}
            </div>
          </div>
        </div>
        <Chevron open={isExpanded} />
      </button>

      <Expand open={isExpanded}>
        <div id={bodyId} className="pl-3.5 pr-3 pb-3 border-t border-primary/25">
          <div className="grid grid-cols-1 gap-3 mt-3">
            <div>
              <div className="hud-label mb-1.5">EPS Consensus Estimate</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Consensus" value={fmtEps(record.estimated_eps)} highlight />
                <Metric label="High" value={fmtEps(record.eps_estimate_high)} />
                <Metric label="Low" value={fmtEps(record.eps_estimate_low)} />
                <Metric label="Prior Year" value={fmtEps(record.prior_year_eps)} />
              </div>
              {record.eps_estimate_low != null && record.eps_estimate_high != null && record.estimated_eps != null && record.eps_estimate_high > record.eps_estimate_low && (
                <RangeBar
                  className="mt-2"
                  track="teal"
                  min={record.eps_estimate_low}
                  max={record.eps_estimate_high}
                  minLabel={`low ${fmtEps(record.eps_estimate_low)}`}
                  maxLabel={`high ${fmtEps(record.eps_estimate_high)}`}
                  markers={[{ value: record.estimated_eps, label: "cons", tone: "amber" }]}
                />
              )}
            </div>

            <div className="border-t border-border/50 pt-2">
              <div className="hud-label mb-1.5">Revenue Consensus Estimate</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Metric label="Consensus" value={fmtCur(record.estimated_revenue)} highlight />
                <Metric label="High" value={fmtCur(record.revenue_estimate_high)} />
                <Metric label="Low" value={fmtCur(record.revenue_estimate_low)} />
                <Metric label="Prior Year" value={fmtCur(record.prior_year_revenue)} />
              </div>
            </div>

            {record.num_analysts_eps != null && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-border/50 pt-2 flex-wrap">
                <Users className="w-3.5 h-3.5 text-primary" aria-hidden />
                <span className="tabular-nums">{record.num_analysts_eps} analysts covering EPS</span>
                {record.num_analysts_revenue != null && record.num_analysts_revenue !== record.num_analysts_eps && (
                  <span className="tabular-nums">· {record.num_analysts_revenue} covering revenue</span>
                )}
              </div>
            )}
          </div>
        </div>
      </Expand>
    </div>
  );
}

// ── Analyst consensus (stacked bar + target range) ───────────────────────────

function AnalystConsensus({ ticker }: { ticker: string }) {
  const { data: ratings, isLoading } = useAnalystRatings(ticker);
  const { data: snapshot } = useSnapshot(ticker);
  const animate = useAnimate();
  const [hover, setHover] = useState<"buy" | "hold" | "sell" | null>(null);

  if (isLoading) {
    return (
      <div className="border border-border/60 p-3 space-y-2.5 h-full">
        <div className="h-2.5 w-1/3 skeleton-shimmer" />
        <div className="h-2 w-full skeleton-shimmer" />
        <div className="h-8 w-full skeleton-shimmer" />
      </div>
    );
  }
  if (!ratings) return null;

  const total = (ratings.buy || 0) + (ratings.hold || 0) + (ratings.sell || 0);
  const buyPct  = total ? (ratings.buy  / total) * 100 : 0;
  const holdPct = total ? (ratings.hold / total) * 100 : 0;
  const sellPct = total ? (ratings.sell / total) * 100 : 0;

  const consensusTone =
    ratings.consensus === "Strong Buy" || ratings.consensus === "Buy" ? "text-up glow-teal"
    : ratings.consensus === "Hold" ? "text-amber glow-amber"
    : ratings.consensus === "Sell" || ratings.consensus === "Strong Sell" ? "text-down glow-red"
    : "text-muted-foreground";

  const segs = [
    { key: "buy" as const,  n: ratings.buy || 0,  pct: buyPct,  bar: "bg-up",    text: "text-up",    label: "Buy",  glyph: "▲" },
    { key: "hold" as const, n: ratings.hold || 0, pct: holdPct, bar: "bg-amber", text: "text-amber", label: "Hold", glyph: "◆" },
    { key: "sell" as const, n: ratings.sell || 0, pct: sellPct, bar: "bg-down",  text: "text-down",  label: "Sell", glyph: "▼" },
  ];

  const last: number | null = (snapshot as any)?.lastTrade?.p ?? (snapshot as any)?.day?.c ?? null;
  const lo = ratings.low_price_target as number | null;
  const hi = ratings.high_price_target as number | null;
  const avg = ratings.avg_price_target as number | null;
  const hasRange = lo != null && hi != null && hi > lo;
  const implied = avg != null && last != null && last > 0 ? ((avg - last) / last) * 100 : null;

  let rangeMin = 0, rangeMax = 1;
  const markers: RangeMarker[] = [];
  if (hasRange) {
    const pts = [lo!, hi!, ...(last != null ? [last] : [])];
    const a = Math.min(...pts), b = Math.max(...pts);
    const pad = (b - a) * 0.06;
    rangeMin = a - pad;
    rangeMax = b + pad;
    markers.push({ value: lo!, tone: "down", shape: "tri" }, { value: hi!, tone: "up", shape: "tri" });
    if (avg != null) markers.push({ value: avg, label: "avg", tone: "amber" });
    if (last != null) markers.push({ value: last, label: "last", tone: "fg" });
  }

  return (
    <div className="border border-border/60 bg-background/30 p-3 space-y-3 h-full transition-colors hover:border-primary/40" data-testid="analyst-consensus">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="hud-label">Analyst consensus</div>
          <div className="hud-tag mt-0.5 tabular-nums">source: finnhub · {total} ratings</div>
        </div>
        <div className="text-right">
          <div className="hud-tag">consensus</div>
          <div className={cn("text-[13px] font-bold tracking-[.12em] uppercase", consensusTone)} data-testid="text-consensus">
            {ratings.consensus}
          </div>
        </div>
      </div>

      {/* Stacked rating bar */}
      <div>
        <div className="flex h-2.5 gap-[2px] bg-muted/40" role="img" aria-label={`Buy ${ratings.buy}, Hold ${ratings.hold}, Sell ${ratings.sell}`}>
          {segs.map((s, i) =>
            s.pct > 0 ? (
              <motion.div
                key={s.key}
                className={cn("h-full transition-opacity duration-200", s.bar, hover && hover !== s.key && "opacity-30")}
                initial={animate ? { width: 0 } : false}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.8, delay: 0.15 + i * 0.12, ease: EASE }}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                title={`${s.label}: ${s.n} of ${total} (${s.pct.toFixed(0)}%)`}
              />
            ) : null,
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          {segs.map((s) => (
            <div
              key={s.key}
              className={cn("min-w-0 transition-opacity duration-200", hover && hover !== s.key && "opacity-40")}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
            >
              <div className={cn("text-[10px] uppercase tracking-[.12em] flex items-center gap-1", s.text)}>
                <span className="text-[8px]" aria-hidden>{s.glyph}</span>{s.label}
              </div>
              <div className="flex items-baseline gap-1.5">
                <CountUp value={s.n} format={(n) => String(Math.round(n))} className="text-[16px] font-semibold text-foreground" />
                <CountUp value={s.pct} format={(n) => `${n.toFixed(0)}%`} className="text-[10px] text-dim" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Price targets */}
      <div className="pt-2 border-t border-border/50">
        {hasRange && (
          <RangeBar
            className="mb-2"
            min={rangeMin}
            max={rangeMax}
            markers={markers}
            minLabel={`low $${lo!.toFixed(2)}`}
            maxLabel={`high $${hi!.toFixed(2)}`}
          />
        )}
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Avg Target"  value={avg != null ? `$${avg.toFixed(2)}` : "—"} highlight />
          <Metric label="High Target" value={hi != null ? `$${hi.toFixed(2)}` : "—"} />
          <Metric label="Low Target"  value={lo != null ? `$${lo.toFixed(2)}` : "—"} />
        </div>
        {implied != null ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground flex-wrap">
            <span className="hud-tag">avg target implies</span>
            <Delta pct={implied} className="text-[11px]" />
            <span className="hud-tag">vs last</span>
          </div>
        ) : avg == null ? (
          <div className="mt-1.5 hud-tag">price targets via schwab when connected</div>
        ) : null}
      </div>
    </div>
  );
}

// ── Hit-rate readout (Kronos style) ──────────────────────────────────────────

function HitRate({
  quarters,
  hoverId,
  setHoverId,
  onSelect,
}: {
  quarters: EarningsRecord[];
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const animate = useAnimate();
  const scored = quarters.map((r) => ({ r, s: surpriseOf(r) })).filter((x) => x.s != null) as { r: EarningsRecord; s: number }[];
  const n = scored.length;
  const beats = scored.filter((x) => x.s > 0).length;
  const rate = n ? (beats / n) * 100 : 0;
  const avgSurprise = n ? scored.reduce((a, x) => a + x.s, 0) / n : null;

  // current streak from the most recent quarter backwards
  let streak = 0;
  let streakKind: Outcome | null = null;
  for (let i = scored.length - 1; i >= 0; i--) {
    const o = outcomeOf(scored[i].s);
    if (streakKind == null) streakKind = o;
    if (o !== streakKind) break;
    streak++;
  }

  const rateTone = rate >= 75 ? "text-hit glow-hit" : rate >= 50 ? "text-foreground" : "text-amber glow-amber";

  return (
    <div className="border border-border/60 bg-background/30 p-3 h-full flex flex-col transition-colors hover:border-primary/40" data-testid="earnings-hit-rate">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="hud-label">Hit-rate</div>
          <div className="hud-tag mt-0.5">eps vs consensus</div>
        </div>
        <div className="hud-tag text-right tabular-nums">last {n} prints</div>
      </div>

      {n === 0 ? (
        <div className="flex-1 flex items-center justify-center py-6 hud-tag">waiting · no scored quarters</div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3 mt-2">
            <div className="flex items-baseline gap-1">
              <CountUp value={beats} format={(v) => String(Math.round(v))} className={cn("text-[30px] leading-none font-semibold", rateTone)} />
              <span className="text-[16px] text-dim tabular-nums">/{n}</span>
            </div>
            <div className="text-right">
              <CountUp value={rate} format={(v) => `${v.toFixed(0)}%`} className={cn("text-[15px] font-semibold", rateTone)} />
              <div className="hud-tag">beat rate</div>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            beat {beats}/{n} · {rate.toFixed(0)}%
          </div>

          {/* R1..Rn slots */}
          <div className="flex gap-1 mt-3" role="group" aria-label="Quarterly results R1 oldest to newest">
            {scored.map(({ r, s }, i) => {
              const o = outcomeOf(s);
              const st = OUT[o];
              const active = hoverId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onMouseEnter={() => setHoverId(r.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onFocus={() => setHoverId(r.id)}
                  onBlur={() => setHoverId(null)}
                  onClick={() => onSelect(r.id)}
                  aria-label={`R${i + 1}: ${r.fiscal_period}, ${st.word} ${fmtPct(s)}`}
                  title={`${r.fiscal_period} · ${st.word} ${fmtPct(s)}`}
                  className={cn(
                    "flex-1 min-w-0 flex flex-col items-center gap-1 py-1.5 border transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
                    active ? cn(st.soft) : "border-border/70 hover:border-primary/50",
                  )}
                >
                  <motion.span
                    className={cn("w-3 h-3 rounded-full border-2 flex items-center justify-center", st.border)}
                    initial={animate ? { scale: 0, opacity: 0 } : false}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 16, delay: 0.25 + i * 0.07 }}
                  >
                    {o === "beat" && <span className={cn("w-1 h-1 rounded-full", st.bg)} />}
                  </motion.span>
                  <span className={cn("text-[8.5px] tracking-wider tabular-nums", active ? st.text : "text-dim")}>R{i + 1}</span>
                </button>
              );
            })}
          </div>

          {/* rate bar */}
          <div className="mt-3">
            <div className="relative h-1 bg-muted">
              <motion.div
                className={cn("absolute inset-y-0 left-0", rate >= 50 ? "bg-hit" : "bg-amber")}
                initial={animate ? { width: 0 } : false}
                animate={{ width: `${rate}%` }}
                transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
              />
              <span className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-foreground/40" aria-hidden />
            </div>
            <div className="flex justify-between hud-tag mt-1 tabular-nums">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          <div className="mt-auto pt-2 border-t border-border/50 grid grid-cols-2 gap-2">
            <div>
              <div className="hud-tag">avg surprise</div>
              <div className={cn("text-[12px] tabular-nums", avgSurprise != null && avgSurprise > 0 ? "text-hit" : avgSurprise != null && avgSurprise < 0 ? "text-amber" : "text-muted-foreground")}>
                {avgSurprise != null ? `${avgSurprise > 0 ? "▲" : avgSurprise < 0 ? "▼" : "◆"} ${fmtPct(avgSurprise)}` : "—"}
              </div>
            </div>
            <div>
              <div className="hud-tag">streak</div>
              <div className={cn("text-[12px] tabular-nums", streakKind ? OUT[streakKind].text : "text-muted-foreground")}>
                {streakKind ? `${streak} ${streakKind === "beat" ? (streak === 1 ? "beat" : "beats") : streakKind === "miss" ? (streak === 1 ? "miss" : "misses") : "in-line"}` : "—"}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── EPS chart: estimate vs actual per quarter ────────────────────────────────

function EpsChart({
  past,
  upcoming,
  hoverId,
  setHoverId,
  onSelect,
}: {
  past: EarningsRecord[];
  upcoming: EarningsRecord[];
  hoverId: string | null;
  setHoverId: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const animate = useAnimate();
  const ambient = useAmbient();
  const cols = useMemo(() => [...past, ...upcoming], [past, upcoming]);

  const vals = cols.flatMap((r) => [r.actual_eps, r.estimated_eps]).filter((v): v is number => v != null && Number.isFinite(v));
  if (cols.length === 0 || vals.length === 0) return null;

  const a = Math.min(...vals), b = Math.max(...vals);
  const pad = (b - a) * 0.18 || Math.abs(b) * 0.15 || 1;
  const lo = a - pad, hi = b + pad;
  const y = (v: number) => ((v - lo) / (hi - lo)) * 100; // % from bottom
  const zeroIn = lo < 0 && hi > 0;

  const n = cols.length;
  const xc = (i: number) => ((i + 0.5) / n) * 100;
  const pathFor = (key: "actual_eps" | "estimated_eps") => {
    const pts = cols
      .map((r, i) => (r[key] != null ? `${xc(i).toFixed(2)},${(100 - y(r[key] as number)).toFixed(2)}` : null))
      .filter(Boolean) as string[];
    return pts.length >= 2 ? `M${pts.join(" L")}` : null;
  };
  const actPath = pathFor("actual_eps");
  const estPath = pathFor("estimated_eps");

  const focus = cols.find((r) => r.id === hoverId) ?? past[past.length - 1] ?? cols[0];
  const fs = surpriseOf(focus);
  const fo = focus.is_upcoming ? "pending" : outcomeOf(fs);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = Math.max(0, Math.min(n - 1, i + (e.key === "ArrowRight" ? 1 : -1)));
    const row = e.currentTarget.parentElement?.parentElement;
    const el = (row?.children[next] as HTMLElement | undefined)?.querySelector("button");
    el?.focus();
  };

  return (
    <div className="border border-border/60 bg-background/30 p-3 transition-colors hover:border-primary/40" data-testid="earnings-eps-chart">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="hud-label">EPS · estimate vs actual</div>
          <div className="flex items-center gap-3 mt-1 hud-tag">
            <span className="inline-flex items-center gap-1"><span className="w-3 border-t border-dashed border-muted-foreground" />est</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-px bg-up" />actual</span>
            <span className="inline-flex items-center gap-1 text-hit"><span className="w-2 h-2 rounded-full border-2 border-hit" />beat</span>
            <span className="inline-flex items-center gap-1 text-amber"><span className="w-2 h-2 rounded-full border-2 border-amber" />miss</span>
          </div>
        </div>
      </div>

      {/* readout line (typed-log feel) */}
      {/* visual mirror of the focused column; each column button carries the same text as its aria-label */}
      <div className="h-6 flex items-center gap-2 px-2 mb-2 border border-border/50 bg-background/50 text-[10.5px] tabular-nums overflow-hidden" aria-hidden>
        <span className="text-primary shrink-0">&gt;</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={focus.id}
            className="flex items-center gap-2 min-w-0 whitespace-nowrap"
            initial={animate ? { opacity: 0, x: -4 } : false}
            animate={{ opacity: 1, x: 0 }}
            exit={animate ? { opacity: 0 } : undefined}
            transition={{ duration: 0.15 }}
          >
            <span className="text-foreground">{focus.fiscal_period}</span>
            {focus.is_upcoming ? (
              <>
                <span className="text-dim">est</span><span className="text-foreground">{fmtEps(focus.estimated_eps)}</span>
                <span className="text-up truncate">· reports {countdownLabel(daysUntil(focus.date))}</span>
              </>
            ) : (
              <>
                <span className="text-dim">act</span><span className="text-foreground">{fmtEps(focus.actual_eps)}</span>
                <span className="text-dim">est</span><span className="text-muted-foreground">{fmtEps(focus.estimated_eps)}</span>
                <span className={cn("truncate", OUT[fo].text)}>{OUT[fo].glyph} {OUT[fo].word} {fmtPct(fs)}</span>
              </>
            )}
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex gap-2">
        {/* y axis */}
        <div className="relative w-9 shrink-0 h-[132px] hud-tag tabular-nums">
          <span className="absolute right-0 -translate-y-1/2" style={{ top: "0%" }}>{fmtEps(hi)}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: "50%" }}>{fmtEps((hi + lo) / 2)}</span>
          <span className="absolute right-0 -translate-y-1/2" style={{ top: "100%" }}>{fmtEps(lo)}</span>
        </div>

        <div className="relative flex-1 min-w-0">
          {/* plot */}
          <div className="relative h-[132px]">
            {[0, 50, 100].map((t) => (
              <div key={t} className="absolute left-0 right-0 border-t border-dashed border-border/60" style={{ top: `${t}%` }} aria-hidden />
            ))}
            {zeroIn && (
              <div className="absolute left-0 right-0 border-t border-foreground/30" style={{ bottom: `${y(0)}%` }} aria-hidden />
            )}

            {/* lines */}
            <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {estPath && (
                <motion.path
                  d={estPath}
                  fill="none"
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                  initial={animate ? { opacity: 0 } : false}
                  animate={{ opacity: 0.7 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                />
              )}
              {actPath && (
                <motion.path
                  d={actPath}
                  fill="none"
                  stroke="hsl(var(--up))"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 calc(4px * var(--glow-strength)) hsl(var(--up) / .6))" }}
                  initial={animate ? { pathLength: 0 } : false}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.1, delay: 0.25, ease: "easeOut" }}
                />
              )}
            </svg>

            {/* per-quarter markers */}
            {cols.map((r, i) => {
              const s = surpriseOf(r);
              const o: Outcome = r.is_upcoming ? "pending" : outcomeOf(s);
              const st = OUT[o];
              const active = hoverId === r.id;
              const left = `${(i / n) * 100}%`;
              const ey = r.estimated_eps != null ? y(r.estimated_eps) : null;
              const ay = r.actual_eps != null ? y(r.actual_eps) : null;
              return (
                <div key={r.id} className="absolute inset-y-0" style={{ left, width: `${100 / n}%` }} aria-hidden>
                  {/* hover column */}
                  <div className={cn("absolute inset-0 transition-colors duration-150", active ? "bg-up/[0.07]" : "bg-transparent")} />
                  {/* connector est → actual */}
                  {ey != null && ay != null && (
                    <motion.div
                      className={cn("absolute w-[2px] opacity-60", st.bg)}
                      style={{ left: "calc(50% - 1px)", bottom: `${Math.min(ey, ay)}%`, height: `${Math.abs(ay - ey)}%`, originY: ay >= ey ? 1 : 0 }}
                      initial={animate ? { scaleY: 0 } : false}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.4, delay: 0.35 + i * 0.06 }}
                    />
                  )}
                  {/* estimate dash */}
                  {ey != null && (
                    <div className="absolute left-1/2 -translate-x-1/2 w-3 h-[2px] bg-muted-foreground/80" style={{ bottom: `calc(${ey}% - 1px)` }} />
                  )}
                  {/* actual ring, or hollow pending ring for upcoming */}
                  {(ay != null || (r.is_upcoming && ey != null)) && (
                    <div className="absolute left-1/2" style={{ bottom: `${ay ?? ey}%` }}>
                      {/* outer: hover scale (instant CSS); inner: one-shot spring entrance */}
                      <div
                        className={cn(
                          "w-[11px] h-[11px] -ml-[5.5px] -mb-[5.5px]",
                          animate && "transition-transform duration-150",
                          active && "scale-[1.3]",
                        )}
                      >
                        <motion.div
                          className={cn(
                            "w-full h-full rounded-full border-2 bg-card",
                            st.border,
                            r.is_upcoming && "border-dashed",
                          )}
                          style={{ boxShadow: o === "beat" || o === "miss" ? `0 0 calc(8px * var(--glow-strength)) hsl(var(--${o === "beat" ? "hit" : "amber"}) / .6)` : undefined }}
                          initial={animate ? { scale: 0 } : false}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 420, damping: 15, delay: 0.45 + i * 0.07 }}
                        />
                      </div>
                      {r.is_upcoming && ambient && i === past.length && (
                        <span className="absolute -left-[5.5px] -bottom-[5.5px] w-[11px] h-[11px] rounded-full border border-up animate-ring-expand pointer-events-none" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* interactive columns + labels */}
          <div className="flex">
            {cols.map((r, i) => {
              const s = surpriseOf(r);
              const o: Outcome = r.is_upcoming ? "pending" : outcomeOf(s);
              const st = OUT[o];
              const { q, y: yy } = shortQ(r);
              const active = hoverId === r.id;
              const desc = r.is_upcoming
                ? `${r.fiscal_period}: estimate ${fmtEps(r.estimated_eps)}, reports ${countdownLabel(daysUntil(r.date))}`
                : `${r.fiscal_period}: actual ${fmtEps(r.actual_eps)} vs estimate ${fmtEps(r.estimated_eps)}, ${st.word} ${fmtPct(s)}`;
              return (
                <div key={r.id} className="flex-1 min-w-0">
                  <button
                    type="button"
                    onMouseEnter={() => setHoverId(r.id)}
                    onMouseLeave={() => setHoverId(null)}
                    onFocus={() => setHoverId(r.id)}
                    onBlur={() => setHoverId(null)}
                    onClick={() => onSelect(r.id)}
                    onKeyDown={(e) => onKey(e, i)}
                    tabIndex={r.id === focus.id ? 0 : -1}
                    aria-label={desc}
                    title={desc}
                    className={cn(
                      "relative w-full -mt-[132px] h-[132px] block focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
                    )}
                  />
                  <div className="flex flex-col items-center pt-1.5 gap-0.5 select-none">
                    <motion.span
                      className={cn(
                        "inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border text-[8px]",
                        st.border, st.text, r.is_upcoming && "border-dashed",
                      )}
                      initial={animate ? { scale: 0, opacity: 0 } : false}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 420, damping: 16, delay: 0.55 + i * 0.07 }}
                      aria-hidden
                    >
                      {st.glyph}
                    </motion.span>
                    <span className={cn("hidden sm:block text-[8.5px] uppercase tracking-[.08em] leading-none", st.text)}>
                      {o === "pending" ? "est" : st.word === "In-line" ? "inl" : st.word}
                    </span>
                    <span className={cn("hidden sm:block text-[8.5px] tabular-nums leading-none", s != null ? st.text : "text-dim")}>
                      {r.is_upcoming ? (() => { const d = daysUntil(r.date); return d != null && d >= 0 ? `${d}d` : "—"; })() : s != null ? fmtPct(s, Math.abs(s) >= 10 ? 0 : 1) : "—"}
                    </span>
                    <span className={cn("text-[9px] leading-none tabular-nums mt-0.5", active ? "text-foreground" : "text-muted-foreground")}>{q}</span>
                    <span className="text-[8.5px] leading-none tabular-nums text-dim">{yy}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tabs (segmented, keeps the tab-earnings-* test ids) ──────────────────────

type TabKey = "all" | "past" | "upcoming";

function EarningsTabs({ tabs, value, onChange }: {
  tabs: { key: TabKey; label: string; count: number }[];
  value: TabKey;
  onChange: (k: TabKey) => void;
}) {
  const layoutId = useId();
  const animate = useAnimate();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Earnings records" className="inline-flex items-stretch border border-card-border bg-background/60 p-[2px] gap-[2px]">
      {tabs.map(({ key, label, count }, i) => {
        const active = value === key;
        return (
          <button
            key={key}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "relative h-6 px-2.5 text-[10px] uppercase tracking-[.12em] transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`tab-earnings-${key}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 bg-primary box-glow-teal"
                transition={animate ? { type: "spring", stiffness: 420, damping: 34 } : { duration: 0 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {label}
              {count > 0 && <span className={cn("tabular-nums", active ? "opacity-80" : "text-dim")}>{count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function EarningsPanel({ ticker }: Props) {
  const { data, isLoading } = useEarnings(ticker);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const animate = useAnimate();
  const ambient = useAmbient();
  const listRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{ id: string; crossFade: boolean } | null>(null);

  // Normalise Polygon Benzinga response vs mock data
  const records: EarningsRecord[] = useMemo(() => {
    const raw = data?.results || [];
    if (!raw.length) return [];

    // If it's already our EarningsRecord shape (mock data), use as-is
    if ("fiscal_period" in (raw[0] as any)) return raw as EarningsRecord[];

    // Otherwise map Benzinga API shape
    return raw.map((r: any) => {
      const isUpcoming = !r.actual_eps_normalized && !r.actual_revenue_normalized;
      return {
        id: `${ticker}-${r.date}-${r.period}`,
        date: r.date,
        fiscal_period: r.period || "",
        fiscal_quarter: parseInt(r.period?.replace(/Q(\d).*/,"$1") || "0"),
        fiscal_year: parseInt(r.period?.replace(/Q\d\s+/,"") || "0"),
        time: r.time || "—",
        actual_eps: r.actual_eps_normalized ?? null,
        actual_revenue: r.actual_revenue_normalized ?? null,
        estimated_eps: r.consensus_eps_estimate ?? null,
        estimated_revenue: r.consensus_revenue_estimate ?? null,
        prior_year_eps: r.prior_year_same_quarter_eps_normalized ?? null,
        prior_year_revenue: null,
        eps_surprise: r.eps_surprise_percent ?? null,
        revenue_surprise: r.revenue_surprise_percent ?? null,
        is_upcoming: isUpcoming,
        num_analysts_eps: r.number_of_estimates ?? undefined,
      } as EarningsRecord;
    });
  }, [data, ticker]);

  const past     = records.filter(r => !r.is_upcoming);
  const upcoming = records.filter(r => r.is_upcoming);
  const visible  = tab === "past" ? past : tab === "upcoming" ? upcoming : records;

  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: "all",      label: "All",          count: records.length  },
    { key: "upcoming", label: "Upcoming",      count: upcoming.length },
    { key: "past",     label: "Past",          count: past.length     },
  ];

  // Chronological series for the chart / hit-rate (oldest → newest)
  const byDate = (a: EarningsRecord, b: EarningsRecord) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const chartPast = useMemo(
    () => records.filter(r => !r.is_upcoming && (r.actual_eps != null || r.estimated_eps != null)).sort(byDate).slice(-8),
    [records],
  );
  const chartUpcoming = useMemo(() => records.filter(r => r.is_upcoming).sort(byDate).slice(0, 2), [records]);
  const nextReport = chartUpcoming[0] ?? null;
  const nextDays = nextReport ? daysUntil(nextReport.date) : null;

  // Reset UI state when the ticker changes
  useEffect(() => {
    setExpandedId(null);
    setHoverId(null);
    setTab("all");
    pendingScroll.current = null;
  }, [ticker]);

  // Chart / slot click → open that quarter in the list and scroll the list to it.
  // A request counter (not expandedId/tab) drives the scroll, so re-selecting an
  // already-open quarter still scrolls to it.
  const [scrollReq, setScrollReq] = useState(0);
  const selectRecord = (id: string) => {
    const tabSwitch = !visible.some((r) => r.id === id);
    if (tabSwitch) setTab("all");
    setExpandedId(id);
    pendingScroll.current = { id, crossFade: tabSwitch };
    setScrollReq((n) => n + 1);
  };
  useEffect(() => {
    const req = pendingScroll.current;
    if (!req || scrollReq === 0) return;
    const { id, crossFade } = req;
    // the list cross-fades on tab change (AnimatePresence "wait") and other rows collapse,
    // so give it a beat to settle before measuring
    const wait = animate ? (crossFade ? 420 : 300) : 0;
    const t = window.setTimeout(() => {
      const list = listRef.current;
      pendingScroll.current = null;
      if (!list) return;
      const el = list.querySelector<HTMLElement>(`[data-record-id="${CSS.escape(id)}"]`);
      if (!el) return;
      const behavior: ScrollBehavior = animate ? "smooth" : "auto";
      const top = el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 4;
      list.scrollTo({ top, behavior });
      list.scrollIntoView({ block: "nearest", behavior });
    }, wait);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollReq]);

  const status = isLoading ? "sampling" : records.length ? "set" : "waiting";

  return (
    <Panel
      title="Earnings"
      tag={<span className="hidden sm:inline">est vs actual · finnhub</span>}
      icon={<BarChart3 className="w-3.5 h-3.5 text-primary" aria-hidden />}
      delay={0.12}
      className="h-full"
      data-testid="earnings-panel"
      actions={
        <>
          <span className="hud-tag hidden md:inline-flex items-center gap-1.5">
            <Dot ambient={ambient} tone={status === "set" ? "hit" : status === "sampling" ? "amber" : "dim"} />
            {status}
          </span>
          {nextReport && (
            <span className="hud-chip !text-amber !border-amber/40 tabular-nums" title={`Next report ${fmtDate(nextReport.date)} (${nextReport.fiscal_period})`} data-testid="earnings-next-countdown">
              <Dot ambient={ambient} tone="amber" />
              <span className="hidden sm:inline">next</span>
              {nextDays != null && nextDays >= 0 ? (
                <span>{nextDays === 0 ? "today" : `in ${nextDays}d`}</span>
              ) : (
                <span>{fmtDate(nextReport.date, "MMM d")}</span>
              )}
            </span>
          )}
        </>
      }
    >
      {/* Consensus + hit-rate */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <AnalystConsensus ticker={ticker} />
        {isLoading ? (
          <div className="border border-border/60 p-3 space-y-2.5">
            <div className="h-2.5 w-1/3 skeleton-shimmer" />
            <div className="h-8 w-1/2 skeleton-shimmer" />
            <div className="h-6 w-full skeleton-shimmer" />
          </div>
        ) : chartPast.length > 0 ? (
          <HitRate quarters={chartPast} hoverId={hoverId} setHoverId={setHoverId} onSelect={selectRecord} />
        ) : null}
      </div>

      {/* EPS chart */}
      {isLoading ? (
        <div className="border border-border/60 p-3 mb-3 space-y-2">
          <div className="h-2.5 w-1/4 skeleton-shimmer" />
          <div className="h-[150px] w-full skeleton-shimmer" />
        </div>
      ) : (chartPast.length + chartUpcoming.length) > 0 ? (
        <div className="mb-3">
          <EpsChart past={chartPast} upcoming={chartUpcoming} hoverId={hoverId} setHoverId={setHoverId} onSelect={selectRecord} />
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <EarningsTabs tabs={TABS} value={tab} onChange={setTab} />
        <span className="hud-tag tabular-nums">{visible.length} records</span>
      </div>

      {/* List */}
      <div ref={listRef} className="relative overflow-y-auto max-h-[420px] -mx-1 px-1">
        {isLoading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 space-y-2 border border-border/50">
                <div className="h-3.5 w-1/2 skeleton-shimmer" />
                <div className="flex gap-4">
                  <div className="h-3 w-20 skeleton-shimmer" />
                  <div className="h-3 w-20 skeleton-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="py-8 text-center">
            <div className="hud-label mb-1">◆ waiting</div>
            <div className="text-sm text-muted-foreground">
              No {tab === "upcoming" ? "upcoming" : tab === "past" ? "past" : ""} earnings records for {ticker}.
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="space-y-1.5"
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={animate ? { opacity: 0, y: -4 } : undefined}
              transition={{ duration: 0.18 }}
            >
              {visible.map((record, idx) => {
                const isExpanded = expandedId === record.id;
                const toggle = () => setExpandedId(isExpanded ? null : record.id);
                return (
                  <motion.div
                    key={record.id}
                    initial={animate ? { opacity: 0, x: -8 } : false}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: animate ? Math.min(idx * 0.04, 0.4) : 0, ease: EASE }}
                    onMouseEnter={() => setHoverId(record.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    {record.is_upcoming
                      ? <UpcomingEarningsRow record={record} isExpanded={isExpanded} onToggle={toggle} idx={idx} />
                      : <PastEarningsRow    record={record} isExpanded={isExpanded} onToggle={toggle} idx={idx} />}
                  </motion.div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </Panel>
  );
}
