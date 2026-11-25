import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Clock, ExternalLink, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Panel,
  Diamond,
  GhostMark,
  CountUp,
  Segmented,
  Delta,
  Decode,
  useAnimate,
  useAmbient,
} from "@/components/hud";
import {
  useMarketIndices,
  useTopMovers,
  useSectorPerformance,
  useMarketNews,
  useMarketStatus,
  type IndexQuote,
  type MoverQuote,
  type SectorPerf,
} from "@/lib/hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const EASE = [0.2, 0.8, 0.2, 1] as const;

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Prices under 10 (FX pairs) get 4 decimals so moves stay visible. */
function fmtPrice(n: number) {
  return fmt(n, Math.abs(n) < 10 ? 4 : 2);
}

function fmtPct(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmt(n, 2)}%`;
}

function fmtVol(n: number | null) {
  if (n == null || n <= 0) return "—"; // guard: null, undefined, and 0 all show dash
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Strip provider prefixes (X:BTCUSD → BTCUSD, ^VIX → VIX) for display only. */
function shortSym(s: string) {
  return s.replace(/^(X:|C:|I:|\^)/, "");
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Loading placeholder: shimmers only while ambient motion is on. */
function Shimmer({ className }: { className?: string }) {
  const ambient = useAmbient();
  return <div className={cn(ambient ? "skeleton-shimmer" : "bg-muted", className)} />;
}

function LiveDot({ tone }: { tone?: "amber" | "red" | "dim" }) {
  const ambient = useAmbient();
  return <span className={cn("live-dot", !ambient && "after:hidden")} data-tone={tone} aria-hidden />;
}

/** True while the document is hidden (background tab / pane) — rAF is paused there,
 *  so rAF-driven transitions that gate content (exit-then-enter, layout springs) are skipped. */
function docHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

// ── Balanced tile rows ───────────────────────────────────────────────────────
// Tile counts vary (7 indices, 11 sectors, …). A fixed grid leaves orphans
// (6 + 1). Instead, per breakpoint we pick the column count that gives the
// fewest rows with the most even split (7 → 4+3 rather than 6+1, or 1×7 when
// it fits), lay tiles out with flex-wrap, and let a short last row stretch.
// Class strings are written out in full so Tailwind's JIT picks them up.
const COLS_BP = ["base", "sm", "md", "lg", "xl", "2xl"] as const;
type ColsMax = readonly [number, number, number, number, number, number];
const COLS_CLASS: Record<(typeof COLS_BP)[number], readonly string[]> = {
  base: ["", "[--cols:1]", "[--cols:2]", "[--cols:3]", "[--cols:4]", "[--cols:5]", "[--cols:6]", "[--cols:7]", "[--cols:8]"],
  sm: ["", "sm:[--cols:1]", "sm:[--cols:2]", "sm:[--cols:3]", "sm:[--cols:4]", "sm:[--cols:5]", "sm:[--cols:6]", "sm:[--cols:7]", "sm:[--cols:8]"],
  md: ["", "md:[--cols:1]", "md:[--cols:2]", "md:[--cols:3]", "md:[--cols:4]", "md:[--cols:5]", "md:[--cols:6]", "md:[--cols:7]", "md:[--cols:8]"],
  lg: ["", "lg:[--cols:1]", "lg:[--cols:2]", "lg:[--cols:3]", "lg:[--cols:4]", "lg:[--cols:5]", "lg:[--cols:6]", "lg:[--cols:7]", "lg:[--cols:8]"],
  xl: ["", "xl:[--cols:1]", "xl:[--cols:2]", "xl:[--cols:3]", "xl:[--cols:4]", "xl:[--cols:5]", "xl:[--cols:6]", "xl:[--cols:7]", "xl:[--cols:8]"],
  "2xl": ["", "2xl:[--cols:1]", "2xl:[--cols:2]", "2xl:[--cols:3]", "2xl:[--cols:4]", "2xl:[--cols:5]", "2xl:[--cols:6]", "2xl:[--cols:7]", "2xl:[--cols:8]"],
};

function balancedCols(n: number, max: number) {
  const m = Math.max(1, Math.min(8, max));
  if (n <= 0) return 1;
  if (n <= m) return n;
  const rows = Math.ceil(n / m);
  return Math.ceil(n / rows);
}

/** Responsive `--cols` classes for `n` tiles given the max columns per breakpoint. */
function balancedColsClass(n: number, max: ColsMax) {
  return COLS_BP.map((bp, i) => COLS_CLASS[bp][balancedCols(n, max[i])]).join(" ");
}

/** Flex cell sized to 1/--cols of the row (minus gaps); grows to fill a short last row. */
function cellStyle(gap: string): CSSProperties {
  return {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: `calc((100% - (var(--cols, 2) - 1) * ${gap}) / var(--cols, 2) - 0.5px)`,
  };
}

// base / sm / md / lg / xl / 2xl — indices run full width; sectors sit in a half column at lg+.
const INDEX_COLS_MAX: ColsMax = [2, 3, 4, 5, 7, 8];
const SECTOR_COLS_MAX: ColsMax = [2, 3, 4, 3, 4, 4];
const INDEX_GAP = "0.5rem";
const SECTOR_GAP = "0.375rem";

type FeedState = "sampling" | "set" | "fault" | "empty";

function feedState(loading: boolean, error: boolean, count: number): FeedState {
  if (loading) return "sampling";
  if (error) return "fault";
  if (count === 0) return "empty";
  return "set";
}

const feedTone: Record<FeedState, { cls: string; dot?: "amber" | "red" | "dim" }> = {
  sampling: { cls: "text-amber", dot: "amber" },
  set: { cls: "text-hit" },
  fault: { cls: "text-down", dot: "red" },
  empty: { cls: "text-dim", dot: "dim" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Scrolling ticker tape
// ─────────────────────────────────────────────────────────────────────────────

function TickerTape({ indices, onSelect }: { indices: IndexQuote[]; onSelect?: (t: string) => void }) {
  const ambient = useAmbient();
  // Duplicate for a seamless loop only when the tape actually scrolls.
  const items = ambient ? [...indices, ...indices] : indices;
  const fade = "linear-gradient(90deg, transparent, #000 20px, #000 calc(100% - 48px), transparent)";

  return (
    <div className="relative flex items-stretch h-9 border-y border-border bg-card/70 overflow-hidden">
      <div className="relative z-10 flex items-center gap-2 pl-4 sm:pl-6 pr-3 border-r border-border bg-card shrink-0">
        <LiveDot />
        <span className="hud-title !text-[9.5px]">Tape</span>
      </div>
      <div
        className={cn("relative flex-1 min-w-0", ambient ? "overflow-hidden" : "overflow-x-auto")}
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      >
        <div
          className={cn(
            "flex items-center h-full whitespace-nowrap",
            ambient && "animate-ticker focus-within:[animation-play-state:paused]",
          )}
          style={ambient ? { animationDuration: `${Math.max(40, indices.length * 4)}s` } : undefined}
        >
          {items.map((idx, i) => {
            const dup = i >= indices.length;
            return (
              <button
                key={`${idx.symbol}-${i}`}
                type="button"
                tabIndex={dup ? -1 : 0}
                aria-hidden={dup || undefined}
                aria-label={dup ? undefined : `${idx.label} ${fmtPrice(idx.price)}, ${fmtPct(idx.changePct)}. Open ${shortSym(idx.symbol)}`}
                onClick={() => onSelect?.(idx.symbol)}
                className="group inline-flex items-center gap-2 h-full px-3 text-[11px] shrink-0 transition-colors hover:bg-primary/[.06] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-2"
              >
                <Diamond size={4} color="hsl(var(--dim))" className="group-hover:!bg-primary transition-colors" />
                <span className="text-muted-foreground tracking-[.08em] uppercase group-hover:text-foreground transition-colors">
                  {idx.label}
                </span>
                <span className="text-foreground tabular-nums">{fmtPrice(idx.price)}</span>
                <Delta pct={idx.changePct} className="text-[10.5px]" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page heading + market status
// ─────────────────────────────────────────────────────────────────────────────

const etFormatter = (() => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
})();

/** Minutes since midnight, New York time. */
function etMinutes(d: Date): number {
  if (!etFormatter) return d.getUTCHours() * 60 + d.getUTCMinutes() - 300;
  const parts = etFormatter.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

function MarketStatusBadge() {
  const { data: status } = useMarketStatus();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  const isOpen = status?.isOpen ?? false;
  const session = (status as { session?: string } | undefined)?.session ?? "closed";
  const label = isOpen
    ? "MARKET OPEN"
    : session === "pre-market" || session === "pre"
    ? "PRE-MARKET"
    : session === "post-market" || session === "post"
    ? "AFTER HOURS"
    : session === "extended"
    ? "EXTENDED"
    : "MARKET CLOSED";
  const tone: "amber" | "dim" | undefined = isOpen ? undefined : label === "MARKET CLOSED" ? "dim" : "amber";

  // Regular-session progress (09:30 → 16:00 ET)
  const mins = etMinutes(now);
  const progress = isOpen
    ? Math.max(0, Math.min(1, (mins - OPEN_MIN) / (CLOSE_MIN - OPEN_MIN)))
    : mins >= CLOSE_MIN
    ? 1
    : 0;

  return (
    <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto" data-testid="market-status">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("hud-chip", isOpen && "!text-hit !border-hit/40", tone === "amber" && "!text-amber !border-amber/40")}>
          <LiveDot tone={tone} />
          {label}
        </span>
        <span className="hud-chip tabular-nums !text-foreground/85">
          <Clock className="w-3 h-3" aria-hidden />
          {timeStr}
        </span>
      </div>
      <div className="w-full sm:w-[260px]">
        <div className="flex justify-between hud-tag tabular-nums mb-1">
          <span>session 09:30 → 16:00 ET</span>
          <span className={isOpen ? "text-hit" : undefined}>{Math.round(progress * 100)}%</span>
        </div>
        <div
          className="relative h-[3px] bg-muted"
          role="progressbar"
          aria-label="Regular session elapsed"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div
            className={cn("absolute inset-y-0 left-0 transition-[width] duration-700", isOpen ? "bg-hit box-glow-teal" : "bg-dim/50")}
            style={{ width: `${progress * 100}%` }}
          />
          {isOpen && (
            <span
              className="absolute -top-[3px] h-[9px] w-[2px] bg-amber box-glow-amber"
              style={{ left: `calc(${progress * 100}% - 1px)` }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewHeading({ feeds }: { feeds: { name: string; state: FeedState }[] }) {
  const ready = feeds.filter((f) => f.state === "set").length;
  const anySampling = feeds.some((f) => f.state === "sampling");
  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    [],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 hud-tag">
            <GhostMark size={5} />
            <span className="truncate">{"// ghost · overview · "}{today}</span>
          </div>
          <h1 className="mt-1.5 text-[19px] sm:text-[24px] leading-none font-bold tracking-[.22em] sm:tracking-[.26em] text-foreground">
            <Decode text="MARKET OVERVIEW" duration={720} />
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className={cn("hud-chip !h-5 !text-[9px]", anySampling ? "!text-amber !border-amber/40" : "!text-hit !border-hit/40")}>
              <LiveDot tone={anySampling ? "amber" : undefined} />
              {anySampling ? "sampling" : "live"} · {ready}/{feeds.length} set
            </span>
            {["polygon", "fmp", "finnhub"].map((src) => (
              <span key={src} className="hud-tag border border-border px-1.5 h-5 inline-flex items-center">
                {src}
              </span>
            ))}
          </div>
        </div>
        <MarketStatusBadge />
      </div>
      <div className="hud-divider" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Indices grid
// ─────────────────────────────────────────────────────────────────────────────

/** Centre-zero bar: prev close in the middle, fill toward today's drift. */
function DriftBar({ pct, maxAbs, delay }: { pct: number; maxAbs: number; delay: number }) {
  const animate = useAnimate();
  const w = Math.min(50, (Math.abs(pct) / maxAbs) * 50);
  const up = pct >= 0;
  return (
    <div className="relative h-[3px] bg-muted mt-2.5" aria-hidden>
      <span className="absolute left-1/2 -top-[3px] h-[9px] w-px bg-foreground/35" />
      {pct !== 0 && (
        <motion.span
          className={cn("absolute inset-y-0", up ? "bg-up box-glow-teal" : "bg-down box-glow-red")}
          style={{
            [up ? "left" : "right"]: "50%",
            width: `${w}%`,
            transformOrigin: up ? "left center" : "right center",
          }}
          initial={animate ? { scaleX: 0 } : false}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, delay, ease: EASE }}
        />
      )}
    </div>
  );
}

function IndexTile({
  idx,
  maxAbs,
  i,
  onSelect,
}: {
  idx: IndexQuote;
  maxAbs: number;
  i: number;
  onSelect?: (t: string) => void;
}) {
  const animate = useAnimate();
  const up = idx.changePct > 0;
  const flat = idx.changePct === 0;
  const prev = idx.price - idx.change;
  const clickable = !!onSelect;

  return (
    <motion.button
      type="button"
      tabIndex={clickable ? 0 : -1}
      onClick={() => onSelect?.(idx.symbol)}
      aria-label={clickable ? `${idx.label} ${fmtPrice(idx.price)}, ${fmtPct(idx.changePct)}. Open ${shortSym(idx.symbol)}` : undefined}
      title={`${idx.label} · prev close ${fmtPrice(prev)} → ${fmtPrice(idx.price)} (${fmtPct(idx.changePct)})`}
      data-testid={`button-index-${idx.symbol}`}
      initial={animate ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      whileHover={animate && clickable ? { y: -2 } : undefined}
      transition={{ duration: 0.45, delay: 0.1 + Math.min(i, 16) * 0.035, ease: EASE }}
      style={cellStyle(INDEX_GAP)}
      className={cn(
        "group relative text-left p-3 pl-3.5 border border-card-border bg-background/40 min-w-0 transition-[border-color,box-shadow,background-color] duration-200",
        clickable && "cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2",
        flat
          ? "hover:border-dim/60"
          : up
          ? "hover:border-up/50 hover:box-glow-teal hover:bg-up/[.04]"
          : "hover:border-down/50 hover:box-glow-red hover:bg-down/[.04]",
      )}
    >
      {/* accent rail */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-2 bottom-2 w-[2px] transition-all duration-300 group-hover:top-0 group-hover:bottom-0",
          flat ? "bg-dim/40" : up ? "bg-up" : "bg-down",
        )}
      />
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="hud-label truncate !text-[9.5px]">{idx.label}</span>
        <span className="hud-tag shrink-0 group-hover:text-primary transition-colors">{shortSym(idx.symbol)}</span>
      </div>
      <div className="mt-1 text-[17px] sm:text-[18px] font-semibold leading-tight text-foreground truncate">
        <CountUp value={idx.price} format={fmtPrice} flash duration={900} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-[11px]">
        <Delta pct={idx.changePct} />
        <span className={cn("tabular-nums text-[10px]", flat ? "text-dim" : up ? "text-up/80" : "text-down/80")}>
          {idx.change >= 0 ? "+" : ""}
          {fmtPrice(idx.change)}
        </span>
      </div>
      <DriftBar pct={idx.changePct} maxAbs={maxAbs} delay={0.25 + Math.min(i, 16) * 0.035} />
      <div className="mt-1 flex justify-between hud-tag tabular-nums !text-[9px]">
        <span>prev {fmtPrice(prev)}</span>
        {clickable && (
          <ChevronRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 text-primary transition-all" aria-hidden />
        )}
      </div>
    </motion.button>
  );
}

function IndicesPanel({ indices, isLoading, onSelect }: { indices?: IndexQuote[]; isLoading: boolean; onSelect?: (t: string) => void }) {
  const list = indices || [];
  const maxAbs = useMemo(() => Math.max(0.5, ...list.map((i) => Math.abs(i.changePct))), [list]);
  const upN = list.filter((i) => i.changePct > 0).length;
  const downN = list.filter((i) => i.changePct < 0).length;

  return (
    <Panel
      title="Market Indices"
      tag="prev close → last"
      delay={0.05}
      data-testid="panel-indices"
      actions={
        list.length > 0 ? (
          <span className="hud-tag tabular-nums flex items-center gap-2">
            <span className="text-up">▲ {upN}</span>
            <span className="text-down">▼ {downN}</span>
          </span>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className={cn("flex flex-wrap gap-2", balancedColsClass(7, INDEX_COLS_MAX))}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="p-3 border border-card-border space-y-2 min-w-0 overflow-hidden" style={cellStyle(INDEX_GAP)}>
              <Shimmer className="h-2.5 w-16 max-w-full" />
              <Shimmer className="h-5 w-24 max-w-full" />
              <Shimmer className="h-3 w-14 max-w-full" />
              <Shimmer className="h-[3px] w-full" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">No index data available. Add API keys in Settings.</div>
      ) : (
        <div className={cn("flex flex-wrap gap-2", balancedColsClass(list.length, INDEX_COLS_MAX))}>
          {list.map((idx, i) => (
            <IndexTile key={idx.symbol} idx={idx} i={i} maxAbs={maxAbs} onSelect={onSelect} />
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top Movers
// ─────────────────────────────────────────────────────────────────────────────

function MoverRow({
  mover,
  rank,
  maxAbs,
  onSelect,
}: {
  mover: MoverQuote;
  rank: number;
  maxAbs: number;
  onSelect: (t: string) => void;
}) {
  const animate = useAnimate();
  const up = mover.changePct > 0;
  const mag = Math.min(1, Math.abs(mover.changePct) / maxAbs);
  return (
    <button
      type="button"
      data-row
      onClick={() => onSelect(mover.symbol)}
      aria-label={`${mover.symbol} ${fmtPct(mover.changePct)} at $${fmt(mover.price)}. Open ${mover.symbol}`}
      className="relative w-full grid grid-cols-[22px_minmax(0,1fr)_auto_74px] items-center gap-2 sm:gap-3 px-4 h-10 text-left group transition-colors hover:bg-primary/[.05] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1"
      data-testid={`button-mover-${mover.symbol}`}
    >
      {/* magnitude bar */}
      <motion.span
        aria-hidden
        className={cn("absolute inset-y-[5px] left-0 origin-left", up ? "bg-up/[.09]" : "bg-down/[.09]")}
        style={{ width: `${mag * 100}%` }}
        initial={animate ? { scaleX: 0 } : false}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, delay: 0.1 + rank * 0.05, ease: EASE }}
      >
        <span className={cn("absolute right-0 inset-y-0 w-px", up ? "bg-up/70" : "bg-down/70")} />
      </motion.span>

      <span className="relative hud-tag tabular-nums">{pad2(rank + 1)}</span>
      <span className="relative flex items-center gap-2 min-w-0">
        <span className="text-[12px] font-bold tracking-[.06em] truncate group-hover:text-primary transition-colors">{mover.symbol}</span>
        <span className="hud-tag tabular-nums hidden sm:inline truncate">Vol {fmtVol(mover.volume)}</span>
      </span>
      <span className="relative text-[11.5px] tabular-nums text-foreground/90">${fmt(mover.price)}</span>
      <span className="relative flex items-center justify-end gap-1 text-[11.5px]">
        <Delta pct={mover.changePct} />
        <ChevronRight className="w-3 h-3 text-primary opacity-0 -mr-1 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" aria-hidden />
      </span>
    </button>
  );
}

function TopMoversPanel({
  gainers,
  losers,
  isLoading,
  onSelect,
}: {
  gainers?: MoverQuote[];
  losers?: MoverQuote[];
  isLoading: boolean;
  onSelect: (t: string) => void;
}) {
  const animate = useAnimate();
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");
  const rows = tab === "gainers" ? gainers : losers;
  const list = rows || [];
  const maxAbs = useMemo(() => Math.max(0.5, ...list.map((m) => Math.abs(m.changePct))), [list]);
  const avg = list.length ? list.reduce((s, m) => s + m.changePct, 0) / list.length : null;

  // ↑ / ↓ roving focus between rows
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]"));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !btns.length) return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    btns[(i + dir + btns.length) % btns.length]?.focus();
  };

  return (
    <Panel
      title="Top Movers"
      tag="session · % chg"
      accent={tab === "losers" ? "red" : "teal"}
      delay={0.12}
      flush
      className="h-full"
      data-testid="panel-movers"
      actions={
        <Segmented
          aria-label="Top movers direction"
          value={tab}
          onChange={setTab}
          options={[
            { value: "gainers", label: "▲ Gainers", title: "Largest % gains" },
            { value: "losers", label: "▼ Losers", title: "Largest % declines" },
          ]}
        />
      }
    >
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-[22px_minmax(0,1fr)_auto_74px] gap-2 sm:gap-3 px-4 h-7 items-center border-b border-border/60 hud-tag">
          <span>#</span>
          <span>symbol</span>
          <span>last</span>
          <span className="text-right">chg</span>
        </div>
        <div className="flex-1 divide-y divide-border/50" onKeyDown={onKeyDown}>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between px-4 h-10">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-3 w-24" />
              </div>
            ))
          ) : (
            // Keyed remount (no exit-then-enter wait): the new tab's rows are in the DOM
            // immediately, so the swap never depends on an exit animation finishing.
            <motion.div
                key={tab}
                className="divide-y divide-border/50"
                initial={animate && !docHidden() ? { opacity: 0, x: tab === "gainers" ? -10 : 10 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
              >
                {list.map((m, i) => (
                  <motion.div
                    key={m.symbol}
                    initial={animate ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.045, ease: EASE }}
                  >
                    <MoverRow mover={m} rank={i} maxAbs={maxAbs} onSelect={onSelect} />
                  </motion.div>
                ))}
            </motion.div>
          )}
          {!isLoading && (!rows || rows.length === 0) && (
            <p className="text-xs text-muted-foreground text-center py-6">No market data available. Check API keys in Settings.</p>
          )}
        </div>
        {!isLoading && list.length > 0 && (
          <div className="flex items-center justify-between px-4 h-8 border-t border-border/60 hud-tag tabular-nums">
            <span>
              n={list.length} · avg <Delta pct={avg} showArrow={false} glow={false} className="text-[9.5px]" />
            </span>
            <span className="hidden sm:inline">
              <kbd className="text-muted-foreground">↑ ↓</kbd> move · <kbd className="text-muted-foreground">enter</kbd> open
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector heat map + breadth
// ─────────────────────────────────────────────────────────────────────────────

function heatStyle(pct: number): CSSProperties {
  if (pct === 0) {
    return { background: "hsl(var(--muted) / .6)", borderColor: "hsl(var(--card-border))" };
  }
  const k = Math.min(1, Math.abs(pct) / 2.5);
  const alpha = 0.06 + k * 0.4;
  const v = pct > 0 ? "--up" : "--down";
  return {
    background: `hsl(var(${v}) / ${alpha.toFixed(3)})`,
    borderColor: `hsl(var(${v}) / ${Math.min(0.7, alpha + 0.12).toFixed(3)})`,
  };
}

function Breadth({ sectors }: { sectors: SectorPerf[] }) {
  const animate = useAnimate();
  const n = sectors.length;
  const up = sectors.filter((s) => s.changePct > 0).length;
  const down = sectors.filter((s) => s.changePct < 0).length;
  const flat = n - up - down;
  const upShare = n ? up / n : 0;
  const upTiles = Math.round((up / n) * 100);
  const flatTiles = Math.round((flat / n) * 100);
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct);
  const lead = sorted[0];
  const lag = sorted[sorted.length - 1];
  const dispersion = lead && lag ? lead.changePct - lag.changePct : 0;
  const avg = n ? sectors.reduce((s, x) => s + x.changePct, 0) / n : 0;

  const regime =
    upShare >= 0.73
      ? { label: "Broad advance", cls: "text-up border-up/50 glow-teal box-glow-teal" }
      : upShare <= 0.27
      ? { label: "Broad decline", cls: "text-down border-down/50 glow-red box-glow-red" }
      : { label: "Mixed / rotation", cls: "text-amber border-amber/50 glow-amber box-glow-amber" };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-3">
      {/* counts + proportion bar */}
      <div className="min-w-0">
        <div className="flex items-center justify-between">
          <span className="hud-label">Breadth</span>
          <span className="hud-tag tabular-nums">A/D {up}:{down}</span>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <span className="flex items-baseline gap-1.5">
            <CountUp value={up} format={(v) => String(Math.round(v))} className="text-[30px] leading-none font-bold text-up glow-teal" />
            <span className="hud-tag">up</span>
          </span>
          {flat > 0 && <span className="hud-tag tabular-nums mb-1">{flat} flat</span>}
          <span className="flex items-baseline gap-1.5">
            <span className="hud-tag">down</span>
            <CountUp value={down} format={(v) => String(Math.round(v))} className="text-[30px] leading-none font-bold text-down glow-red" />
          </span>
        </div>
        <div className="mt-2 flex h-[4px] bg-muted overflow-hidden" aria-hidden>
          <motion.div
            className="h-full bg-up box-glow-teal"
            initial={animate ? { width: "0%" } : false}
            animate={{ width: `${(up / n) * 100}%` }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
          />
          <div className="flex-1" />
          <motion.div
            className="h-full bg-down box-glow-red"
            initial={animate ? { width: "0%" } : false}
            animate={{ width: `${(down / n) * 100}%` }}
            transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
          />
        </div>
        <div className="mt-1 flex justify-between hud-tag tabular-nums">
          <span>{n} sectors</span>
          <span>up {Math.round(upShare * 100)}%</span>
        </div>
      </div>

      {/* 100-tile fill grid */}
      <div className="flex flex-col gap-1.5">
        <div
          key={`${up}-${down}-${n}`}
          className="grid grid-cols-[repeat(25,6px)] gap-[2px]"
          role="img"
          aria-label={`${up} of ${n} sectors up, ${down} down`}
        >
          {Array.from({ length: 100 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-[6px] w-[6px]",
                i < upTiles ? "bg-up/85" : i < upTiles + flatTiles ? "bg-dim/40" : "bg-down/80",
                animate && "animate-fade-up",
              )}
              style={animate ? { animationDelay: `${150 + i * 7}ms` } : undefined}
            />
          ))}
        </div>
        <div className="flex justify-between hud-tag tabular-nums">
          <span>drawn 100/100</span>
          <span>scaled to {n}</span>
        </div>
      </div>

      {/* regime + stats */}
      <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 items-center">
        <div className={cn("h-9 border flex items-center justify-center text-[11px] font-semibold uppercase tracking-[.22em]", regime.cls)}>
          {regime.label}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10.5px] tabular-nums">
          <span className="flex justify-between gap-2">
            <span className="hud-tag">avg</span>
            <Delta pct={avg} showArrow={false} glow={false} />
          </span>
          <span className="flex justify-between gap-2">
            <span className="hud-tag">dispersion</span>
            <span className="text-amber">{fmt(dispersion)} pts</span>
          </span>
          {lead && (
            <span className="flex justify-between gap-2 min-w-0">
              <span className="hud-tag">lead</span>
              <span className="truncate">
                {lead.symbol} <Delta pct={lead.changePct} showArrow={false} glow={false} />
              </span>
            </span>
          )}
          {lag && (
            <span className="flex justify-between gap-2 min-w-0">
              <span className="hud-tag">lag</span>
              <span className="truncate">
                {lag.symbol} <Delta pct={lag.changePct} showArrow={false} glow={false} />
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function SectorHeatMap({
  sectors,
  isLoading,
  spyPct,
  onSelect,
}: {
  sectors?: SectorPerf[];
  isLoading: boolean;
  spyPct?: number | null;
  onSelect?: (t: string) => void;
}) {
  const animate = useAnimate();
  const [sort, setSort] = useState<"chg" | "az">("chg");
  const [hover, setHover] = useState<string | null>(null);
  const list = sectors || [];

  const ranked = useMemo(() => [...list].sort((a, b) => b.changePct - a.changePct), [list]);
  const shown = useMemo(
    () => (sort === "chg" ? ranked : [...list].sort((a, b) => a.label.localeCompare(b.label))),
    [sort, ranked, list],
  );
  const inspected = ranked.find((s) => s.symbol === hover) ?? ranked[0];
  const inspectedRank = inspected ? ranked.indexOf(inspected) + 1 : 0;
  const rel = inspected && spyPct != null && Number.isFinite(spyPct) ? inspected.changePct - spyPct : null;

  return (
    <Panel
      title="Sector Performance"
      tag="spdr · heat"
      delay={0.18}
      className="h-full"
      data-testid="panel-sectors"
      actions={
        <Segmented
          aria-label="Sort sectors"
          value={sort}
          onChange={setSort}
          options={[
            { value: "chg", label: "Δ chg", title: "Sort by % change" },
            { value: "az", label: "A–Z", title: "Sort alphabetically" },
          ]}
        />
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          <Shimmer className="h-16 w-full" />
          <div className={cn("flex flex-wrap gap-1.5", balancedColsClass(11, SECTOR_COLS_MAX))}>
            {Array.from({ length: 11 }).map((_, i) => (
              <div key={i} className="min-w-0" style={cellStyle(SECTOR_GAP)}>
                <Shimmer className="h-[58px] w-full" />
              </div>
            ))}
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">No sector data available. Add API keys in Settings.</div>
      ) : (
        <div className="space-y-4">
          <Breadth sectors={list} />
          <div className="hud-divider" />

          <div
            className={cn("flex flex-wrap gap-1.5", balancedColsClass(shown.length, SECTOR_COLS_MAX))}
            onMouseLeave={() => setHover(null)}
          >
            {shown.map((s, i) => {
              const up = s.changePct > 0;
              const flat = s.changePct === 0;
              const active = inspected?.symbol === s.symbol && hover !== null;
              return (
                <motion.button
                  key={s.symbol}
                  type="button"
                  layout={animate && !docHidden() ? "position" : false}
                  initial={animate ? { opacity: 0, scale: 0.94 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    layout: { type: "spring", stiffness: 380, damping: 32 },
                    default: { duration: 0.35, delay: 0.25 + i * 0.03, ease: EASE },
                  }}
                  onMouseEnter={() => setHover(s.symbol)}
                  onFocus={() => setHover(s.symbol)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect?.(s.symbol)}
                  title={`${s.label} (${s.symbol}) ${fmtPct(s.changePct)}`}
                  aria-label={`${s.label} sector, ${s.symbol}, ${fmtPct(s.changePct)}. Open ${s.symbol}`}
                  data-testid={`sector-${s.symbol}`}
                  style={{ ...cellStyle(SECTOR_GAP), ...heatStyle(s.changePct) }}
                  className={cn(
                    "relative h-[58px] px-2.5 py-2 border text-left flex flex-col justify-between min-w-0 transition-shadow duration-200",
                    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1",
                    flat ? "hover:box-glow-amber" : up ? "hover:box-glow-teal" : "hover:box-glow-red",
                    active && "ring-1 ring-foreground/40",
                  )}
                >
                  <span className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-[.08em] text-foreground truncate">{s.label}</span>
                    <span className="hud-tag shrink-0 !text-[8.5px] !text-foreground/60">{s.symbol}</span>
                  </span>
                  <Delta pct={s.changePct} className="text-[12px] font-bold" />
                </motion.button>
              );
            })}
          </div>

          {/* inspector readout */}
          {inspected && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border/70 bg-background/40 px-3 py-2 text-[10.5px] tabular-nums min-h-[34px]" aria-live="polite">
              <span className="hud-tag text-primary">{hover ? "inspect ▸" : "leader ▸"}</span>
              <span className="font-semibold">{inspected.symbol}</span>
              <span className="text-muted-foreground truncate">{inspected.label}</span>
              <Delta pct={inspected.changePct} />
              <span className="hud-tag">#{inspectedRank}/{ranked.length}</span>
              {rel != null && (
                <span className="hud-tag">
                  vs SPY <Delta value={rel} digits={2} showArrow={false} glow={false} className="text-[10px]" /> pts
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Market News
// ─────────────────────────────────────────────────────────────────────────────

function MarketNewsPanel({ news, isLoading }: { news?: any[]; isLoading: boolean }) {
  const animate = useAnimate();
  const list = news || [];
  return (
    <Panel
      title="Market News"
      tag={list.length ? `${list.length} items · 3d` : "wire"}
      delay={0.24}
      flush
      className="h-full"
      data-testid="panel-market-news"
    >
      <div className="divide-y divide-border/50 overflow-y-auto max-h-[460px]">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-4 py-3 space-y-2">
              <Shimmer className="h-2.5 w-28" />
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-3/4" />
            </div>
          ))
        ) : list.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No market news available. Add API keys in Settings.</div>
        ) : (
          list.map((item, i) => (
            <motion.a
              key={item.id ?? item.uuid ?? item.article_url ?? (item.title || "").slice(0, 60)}
              href={item.article_url}
              target="_blank"
              rel="noopener noreferrer"
              initial={animate ? { opacity: 0, x: -8 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.3 + Math.min(i, 12) * 0.04, ease: EASE }}
              className="relative block px-4 py-3 group transition-colors hover:bg-primary/[.04] focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1"
            >
              <span
                aria-hidden
                className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary box-glow-teal origin-top scale-y-0 group-hover:scale-y-100 group-focus-visible:scale-y-100 transition-transform duration-300"
              />
              <div className="flex items-center gap-2 min-w-0 mb-1">
                <span className="hud-tag tabular-nums shrink-0">{pad2(i + 1)}</span>
                {item.publisher?.name && (
                  <span className="shrink min-w-0 truncate max-w-[45%] border border-up/30 text-up px-1.5 h-[16px] inline-flex items-center text-[9px] uppercase tracking-[.12em]">
                    {item.publisher.name}
                  </span>
                )}
                {item.published_utc && <span className="hud-tag tabular-nums shrink-0">{timeAgo(item.published_utc)}</span>}
                <ExternalLink
                  className="ml-auto w-3 h-3 shrink-0 text-primary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 transition-all"
                  aria-hidden
                />
              </div>
              <p className="text-[12px] font-medium leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
                {item.title}
              </p>
              {item.description && (
                <p className="font-read text-[12px] text-muted-foreground leading-snug mt-1 line-clamp-1 group-hover:line-clamp-3 group-focus-visible:line-clamp-3">
                  {item.description}
                </p>
              )}
              {item.tickers && item.tickers.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {item.tickers.slice(0, 4).map((t: string) => (
                    <span key={t} className="px-1 h-[15px] inline-flex items-center text-[9px] tracking-[.08em] border border-border text-muted-foreground group-hover:border-primary/40 transition-colors">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </motion.a>
          ))
        )}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist Quick Access
// ─────────────────────────────────────────────────────────────────────────────

const WATCHLIST = [
  "AAPL", "NVDA", "MSFT", "TSLA", "GOOGL",
  "AMZN", "META", "AMD", "JPM", "SPY",
];

const HOTKEYS = "1234567890";

function WatchlistPanel({
  onSelect,
  quotes,
}: {
  onSelect: (t: string) => void;
  quotes?: Map<string, number>;
}) {
  const animate = useAnimate();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Number keys 1–9, 0 jump straight to a watchlist ticker (ignored while typing or in a dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const n = HOTKEYS.indexOf(e.key);
      if (n < 0 || n >= WATCHLIST.length) return;
      e.preventDefault();
      onSelectRef.current(WATCHLIST[n]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Panel title="Quick Access" tag="keys 1–0" delay={0.28} data-testid="panel-quick-access">
      {/* 10 chips: 2×5 / 5×2 / 2×5 — every row full (3 columns would orphan one). */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-2 gap-1.5">
        {WATCHLIST.map((t, i) => {
          const pct = quotes?.get(t);
          return (
            <motion.button
              key={t}
              type="button"
              onClick={() => onSelect(t)}
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.35 + i * 0.03, ease: EASE }}
              className="hud-chip !h-8 w-full justify-between !tracking-[.08em] group focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1 hover:box-glow-teal"
              aria-label={`Open ${t} (key ${HOTKEYS[i]})`}
              aria-keyshortcuts={HOTKEYS[i]}
              data-testid={`button-watchlist-${t}`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <kbd className="hidden sm:inline-flex items-center justify-center w-4 h-4 border border-border text-[9px] text-dim group-hover:text-primary group-hover:border-primary/50 transition-colors">
                  {HOTKEYS[i]}
                </kbd>
                <span className="font-semibold text-foreground">{t}</span>
              </span>
              {pct != null && Number.isFinite(pct) ? (
                <Delta pct={pct} showArrow={false} glow={false} className="text-[9.5px] tracking-normal" />
              ) : (
                <ChevronRight className="w-3 h-3 text-dim group-hover:text-primary transition-colors" aria-hidden />
              )}
            </motion.button>
          );
        })}
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feed log (Kronos-style typed status lines)
// ─────────────────────────────────────────────────────────────────────────────

function FeedLog({ lines }: { lines: { key: string; state: FeedState; detail: string }[] }) {
  const animate = useAnimate();
  const ambient = useAmbient();
  return (
    <Panel title="Feed Log" tag="session" delay={0.32} data-testid="panel-feed-log">
      <ol className="space-y-1.5 text-[10.5px] tabular-nums">
        {lines.map((l, i) => {
          const tone = feedTone[l.state];
          return (
            <motion.li
              key={l.key}
              initial={animate ? { opacity: 0, x: -6 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.4 + i * 0.12 }}
              className="grid grid-cols-[18px_62px_minmax(0,1fr)_64px] items-center gap-2"
            >
              <span className="text-dim">{pad2(i + 1)}</span>
              <span className="text-primary">{l.key}</span>
              <span className="text-muted-foreground truncate">{l.detail}</span>
              <span className="flex justify-end">
                {/* Keyed remount: the new status text replaces the old at once (no exit wait). */}
                <motion.span
                  key={l.state}
                  initial={animate && !docHidden() ? { opacity: 0, y: -4 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn("inline-flex items-center gap-1.5 uppercase tracking-[.1em] text-[9.5px]", tone.cls)}
                >
                  {l.state === "sampling" && <LiveDot tone="amber" />}
                  {l.state}
                </motion.span>
              </span>
            </motion.li>
          );
        })}
        <motion.li
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 + lines.length * 0.12 }}
          className="pt-1.5 border-t border-border/60 text-dim"
        >
          <span className="text-primary">&gt;</span> select a ticker, or press 1–0
          {ambient && <span className="cursor-block" aria-hidden />}
        </motion.li>
      </ol>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

export function MarketOverview({ onSelect }: { onSelect: (ticker: string) => void }) {
  const { data: indices, isLoading: idxLoading, isError: idxError } = useMarketIndices();
  const { data: movers, isLoading: moversLoading, isError: moversError } = useTopMovers();
  const { data: sectors, isLoading: sectorLoading, isError: sectorError } = useSectorPerformance();
  const { data: news, isLoading: newsLoading, isError: newsError } = useMarketNews();

  const idxList = idxError ? [] : indices;
  const sectorList = sectorError ? [] : sectors;
  const gainers = moversError ? [] : movers?.gainers;
  const losers = moversError ? [] : movers?.losers;
  const newsList: any[] | undefined = news?.results;

  const spyPct = useMemo(() => idxList?.find((i) => i.symbol === "SPY")?.changePct ?? null, [idxList]);

  // Known % changes for quick-access chips, from data already on the page.
  const quotes = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of [...(gainers || []), ...(losers || [])]) m.set(q.symbol, q.changePct);
    for (const q of idxList || []) if (!m.has(q.symbol)) m.set(q.symbol, q.changePct);
    return m;
  }, [gainers, losers, idxList]);

  const idxState = feedState(idxLoading, idxError, idxList?.length ?? 0);
  const moversState = feedState(moversLoading, moversError, (gainers?.length ?? 0) + (losers?.length ?? 0));
  const sectorState = feedState(sectorLoading, sectorError, sectorList?.length ?? 0);
  const newsState = feedState(newsLoading, newsError, newsList?.length ?? 0);

  const sUp = (sectorList || []).filter((s) => s.changePct > 0).length;
  const sDown = (sectorList || []).filter((s) => s.changePct < 0).length;

  const logLines = [
    { key: "indices", state: idxState, detail: idxState === "set" ? `${idxList!.length} quotes · tape live` : idxState === "sampling" ? "polygon + fmp batch" : "no quotes" },
    { key: "movers", state: moversState, detail: moversState === "set" ? `${gainers?.length ?? 0} ▲ / ${losers?.length ?? 0} ▼ ranked` : moversState === "sampling" ? "fmp batch · universe" : "no movers" },
    { key: "sectors", state: sectorState, detail: sectorState === "set" ? `${sectorList!.length} spdr · ${sUp} up ${sDown} down` : sectorState === "sampling" ? "spdr sector etfs" : "no sectors" },
    { key: "news", state: newsState, detail: newsState === "set" ? `${newsList!.length} items · last 3d` : newsState === "sampling" ? "wire · 3 sources" : "no items" },
  ];

  return (
    <div className="space-y-0 -mx-4 sm:-mx-6" data-testid="market-overview">
      {/* Ticker tape — only show once indices load */}
      {!idxLoading && indices && indices.length > 0 && <TickerTape indices={indices} onSelect={onSelect} />}

      {/* Main content */}
      <div className="px-4 sm:px-6 pt-5 space-y-4 sm:space-y-5">
        <OverviewHeading
          feeds={[
            { name: "indices", state: idxState },
            { name: "movers", state: moversState },
            { name: "sectors", state: sectorState },
            { name: "news", state: newsState },
          ]}
        />

        {/* Indices */}
        <IndicesPanel indices={idxList} isLoading={idxLoading} onSelect={onSelect} />

        {/* Movers + Sector Heat side by side on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-stretch">
          <TopMoversPanel gainers={gainers} losers={losers} isLoading={moversLoading} onSelect={onSelect} />
          <SectorHeatMap sectors={sectorList} isLoading={sectorLoading} spyPct={spyPct} onSelect={onSelect} />
        </div>

        {/* News + Quick Access */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5">
          <div className="lg:col-span-2 min-w-0">
            <MarketNewsPanel news={newsList} isLoading={newsLoading} />
          </div>
          <div className="flex flex-col gap-4 sm:gap-5 min-w-0">
            <WatchlistPanel onSelect={onSelect} quotes={quotes} />
            <FeedLog lines={logLines} />
          </div>
        </div>
      </div>
    </div>
  );
}
