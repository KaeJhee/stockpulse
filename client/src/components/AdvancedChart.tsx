/**
 * AdvancedChart — lightweight-charts v5 interactive price chart (Ghost HUD skin)
 *
 * Features:
 *  • Chart types: Candlestick | Heikin Ashi | Area | Line
 *  • Volume sub-pane (always visible, low-opacity bars)
 *  • Indicator panel with overlays and sub-panes:
 *      Overlays  : Bollinger Bands (on price pane), SMA 50, SMA 200
 *      Sub-panes : RSI (14), MACD (12/26/9)
 *  • Full time-range toolbar (1D → MAX + CUSTOM), keyboard navigable
 *  • Ghost theme read at runtime from CSS variables; re-applied when the
 *    <html> class flips between dark and paper (light)
 *  • OHLC legend overlay that follows the crosshair, glowing "NOW" dot on the
 *    last close, range stats strip, one-shot sweep reveal on new data
 *  • ResizeObserver for responsive sizing
 *  • Proper cleanup on unmount / ticker change
 */

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
  type MutableRefObject, type ReactNode,
} from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type CandlestickData,
  type AreaData,
  type LineData,
  type HistogramData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { AnimatePresence, motion } from "framer-motion";
import { useAggregates } from "@/lib/hooks";
import { useRsi, useMacd, useSma, useBbands, useSnapshot } from "@/lib/hooks";
import { Panel, CountUp, Delta, RangeBar, fmtNum, useAnimate, useAmbient } from "@/components/hud";
import { cn } from "@/lib/utils";
import { format, subDays, subMonths, subYears } from "date-fns";
import {
  Calendar, CandlestickChart,
  ChevronDown, LayoutPanelTop, Maximize2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX" | "CUSTOM";
type ChartType = "candlestick" | "heikin-ashi" | "area" | "line";

interface Props {
  ticker: string;
}

interface Bar {
  time:   UTCTimestamp;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGES: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX", "CUSTOM"];

const RANGE_TITLES: Record<RangeKey, string> = {
  "1D":     "1 day · 5-minute bars",
  "5D":     "5 days · 30-minute bars",
  "1M":     "1 month · daily bars",
  "3M":     "3 months · daily bars",
  "6M":     "6 months · daily bars",
  "YTD":    "Year to date · daily bars",
  "1Y":     "1 year · daily bars",
  "5Y":     "5 years · weekly bars",
  "MAX":    "Since 2000 · monthly bars",
  "CUSTOM": "Custom dates · daily bars",
};

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: "candlestick",  label: "Candle" },
  { key: "heikin-ashi",  label: "Heikin Ashi" },
  { key: "area",         label: "Area" },
  { key: "line",         label: "Line" },
];

// ─── Date range helper ───────────────────────────────────────────────────────

function getDateRange(key: RangeKey) {
  const now  = new Date();
  const to   = format(now, "yyyy-MM-dd");
  switch (key) {
    case "1D":  return { from: to,                                             to, timespan: "minute", multiplier: "5" };
    case "5D":  return { from: format(subDays(now, 5),    "yyyy-MM-dd"),       to, timespan: "minute", multiplier: "30" };
    case "1M":  return { from: format(subMonths(now, 1),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "3M":  return { from: format(subMonths(now, 3),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "6M":  return { from: format(subMonths(now, 6),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "YTD": return { from: `${now.getFullYear()}-01-01`,                   to, timespan: "day",    multiplier: "1" };
    case "1Y":  return { from: format(subYears(now, 1),   "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "5Y":  return { from: format(subYears(now, 5),   "yyyy-MM-dd"),       to, timespan: "week",   multiplier: "1" };
    case "MAX": return { from: "2000-01-01",                                   to, timespan: "month",  multiplier: "1" };
    default:    return { from: format(subMonths(now, 3),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
  }
}

function timeframeLabel(timespan: string, multiplier: string) {
  switch (timespan) {
    case "minute": return `${multiplier}MIN`;
    case "day":    return "DAILY";
    case "week":   return "WEEKLY";
    case "month":  return "MONTHLY";
    default:       return timespan.toUpperCase();
  }
}

// ─── Heikin Ashi transform ───────────────────────────────────────────────────

function toHeikinAshi(bars: Bar[]): Bar[] {
  const ha: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b  = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen  = i === 0
      ? (b.open + b.close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh  = Math.max(b.high, haOpen, haClose);
    const haLow   = Math.min(b.low,  haOpen, haClose);
    ha.push({ time: b.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: b.volume });
  }
  return ha;
}

// ─── Number helpers ──────────────────────────────────────────────────────────

function fmtCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6)  return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// ─── Theme helper ─────────────────────────────────────────────────────────────
// lightweight-charts paints to canvas, so it needs concrete colors. Read the
// Ghost tokens (HSL triplets like "172 80% 54%") from <html> at runtime and
// convert them to rgba() so the chart always matches the active theme.

function readVar(name: string, fallback: string) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/**
 * "172 80% 54%" → "rgba(r, g, b, a)" (converted in JS so the chart's parser never
 * sees modern syntax). `dS` / `dL` shift saturation / lightness in percentage
 * points, so muted variants stay derived from the theme token (no hard-coded hex).
 */
function triplet(name: string, fallback: string, alpha = 1, dS = 0, dL = 0) {
  const raw = readVar(name, fallback);
  const parts = raw.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const h = parseFloat(parts[0] ?? "0");
  const s = Math.max(0, Math.min(100, parseFloat(parts[1] ?? "0") + dS)) / 100;
  const l = Math.max(0, Math.min(100, parseFloat(parts[2] ?? "0") + dL)) / 100;
  if (![h, s, l].every(Number.isFinite)) return `rgba(128, 128, 128, ${alpha})`;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to255 = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgba(${to255(f(0))}, ${to255(f(8))}, ${to255(f(4))}, ${alpha})`;
}

function getChartTheme(isDark: boolean) {
  const up    = (a = 1) => triplet("--up",      "172 80% 54%", a);
  const down  = (a = 1) => triplet("--down",    "350 100% 62%", a);
  const amber = (a = 1) => triplet("--amber",   "38 100% 64%", a);
  return {
    isDark,
    font:         readVar("--font-mono", "'JetBrains Mono', ui-monospace, monospace"),
    text:         triplet("--muted-foreground", "204 11% 65%"),
    grid:         triplet("--grid-line", "176 70% 50%", isDark ? 0.07 : 0.09),
    gridVert:     triplet("--grid-line", "176 70% 50%", isDark ? 0.045 : 0.06),
    crosshair:    triplet("--primary", "172 80% 54%", 0.75),
    crosshairLbl: triplet("--primary", "172 80% 54%"),
    priceLine:    triplet("--primary", "172 80% 54%"),
    scaleBorder:  triplet("--card-border", "180 32% 17%"),
    // Candle bodies slightly duller than the accent in dark mode so the glow stays on live elements.
    upColor:      isDark ? triplet("--up",   "172 80% 54%",  1, -8,  -10) : up(),
    downColor:    isDark ? triplet("--down", "350 100% 62%", 1, -32, -9)  : down(),
    wickUp:       up(isDark ? 0.9 : 1),
    wickDown:     down(isDark ? 0.9 : 1),
    volUp:        up(isDark ? 0.22 : 0.28),
    volDown:      down(isDark ? 0.22 : 0.28),
    rsiLine:      triplet("--violet", "262 80% 72%"),
    macdLine:     triplet("--chart-4", "200 85% 62%"),
    signalLine:   amber(),
    histUp:       up(0.55),
    histDown:     down(0.55),
    bbUpper:      triplet("--chart-4", "200 85% 62%", 0.65),
    bbLower:      triplet("--chart-4", "200 85% 62%", 0.65),
    sma50:        amber(),
    sma200:       triplet("--magenta", "306 76% 60%"),
    areaUp:       up(),
    areaUpTop:    up(isDark ? 0.26 : 0.2),
    areaUpBot:    up(0.01),
    areaDown:     down(),
    areaDownTop:  down(isDark ? 0.24 : 0.18),
    areaDownBot:  down(0.01),
  };
}

type ChartTheme = ReturnType<typeof getChartTheme>;

// ─── Range tabs (segmented, sliding highlight, arrow-key navigation) ─────────

function RangeTabs({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  const layoutId = useId();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Roving focus with MANUAL activation: arrow keys only move focus, Enter/Space
  // selects. Auto-activation would fire one aggregates request per keypress,
  // which burns the tight API quota while the user is just scanning the tabs.
  const activeIdx = RANGES.indexOf(value);
  const [focusIdx, setFocusIdx] = useState(activeIdx);
  useEffect(() => { setFocusIdx(activeIdx); }, [activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = focusIdx;
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % RANGES.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + RANGES.length) % RANGES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = RANGES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setFocusIdx(next);
    btnRefs.current[next]?.focus();
  };

  return (
    <div
      className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div
        role="tablist"
        aria-label="Chart time range"
        onKeyDown={onKeyDown}
        onBlur={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIdx(activeIdx);
        }}
        className="inline-flex items-stretch border border-card-border bg-background/60 p-[2px] gap-[2px]"
      >
        {RANGES.map((r, i) => {
          const active = r === value;
          return (
            <button
              key={r}
              ref={el => { btnRefs.current[i] = el; }}
              role="tab"
              aria-selected={active}
              tabIndex={i === focusIdx ? 0 : -1}
              title={RANGE_TITLES[r]}
              onClick={() => onChange(r)}
              className={cn(
                "relative h-6 px-2 sm:px-2.5 text-[10px] font-mono uppercase tracking-[.12em] tabular-nums transition-colors",
                "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1",
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`button-range-${r}`}
            >
              {active && (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 bg-primary box-glow-teal"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1">
                {r === "CUSTOM" && <Calendar className="w-3 h-3" aria-hidden />}
                {r}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Indicator toggle chip ────────────────────────────────────────────────────

function IndBtn({ label, title, color, active, onClick, testId }: {
  label: string; title: string; color: string; active: boolean; onClick: () => void; testId: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      className="hud-chip focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1"
      data-active={active}
      aria-pressed={active}
      aria-label={`${active ? "Hide" : "Show"} ${title}`}
      title={title}
      data-testid={testId}
    >
      <span
        aria-hidden
        className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0 transition-opacity", active && "ring-1 ring-primary-foreground/70")}
        style={{ background: color, opacity: active ? 1 : 0.55 }}
      />
      {label}
    </motion.button>
  );
}

// ─── Chart-type picker (header dropdown) ──────────────────────────────────────

function ChartTypePicker({ value, onChange }: { value: ChartType; onChange: (c: ChartType) => void }) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const clearBlur = () => { if (blurTimer.current) { window.clearTimeout(blurTimer.current); blurTimer.current = null; } };
  useEffect(() => clearBlur, []);
  const current = CHART_TYPES.find(c => c.key === value)?.label ?? "Candle";

  return (
    <div
      className="relative"
      onKeyDown={e => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onFocus={clearBlur}
      onBlur={e => {
        // Focus moving to a menu item (keyboard Tab) keeps the menu open;
        // otherwise close after a beat so a mouse click on an item still lands.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        clearBlur();
        blurTimer.current = window.setTimeout(() => setOpen(false), 150);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="hud-btn !h-6 !px-2 !text-[10px]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Chart type: ${current}`}
        data-testid="button-chart-type"
      >
        <CandlestickChart className="w-3 h-3" aria-hidden />
        <span className="hidden sm:inline">{current}</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scaleY: 0.9 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.9 }}
            transition={{ duration: 0.16 }}
            style={{ transformOrigin: "top" }}
            className="absolute right-0 top-full mt-1 z-30 min-w-[150px] border border-popover-border bg-popover py-1 shadow-lg box-glow-teal"
          >
            <div className="hud-tag px-3 pb-1 pt-0.5">{"// render as"}</div>
            {CHART_TYPES.map(ct => {
              const active = value === ct.key;
              return (
                <button
                  key={ct.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => { onChange(ct.key); setOpen(false); triggerRef.current?.focus(); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-[.1em] transition-colors",
                    "hover:bg-up/10 focus-visible:bg-up/10 focus-visible:outline-none",
                    active ? "text-primary glow-teal" : "text-foreground/85",
                  )}
                  data-testid={`button-type-${ct.key}`}
                >
                  <span aria-hidden className={cn("w-1.5 h-1.5 rotate-45", active ? "bg-primary" : "bg-dim/50")} />
                  {ct.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function Stat({ label, children, delay, className }: {
  label: ReactNode; children: ReactNode; delay: number; className?: string;
}) {
  const canAnimate = useAnimate();
  return (
    <motion.div
      initial={canAnimate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
      className={cn(
        "min-w-0 border-l-2 border-card-border pl-2.5 transition-colors hover:border-primary",
        className,
      )}
    >
      <div className="hud-label truncate">{label}</div>
      <div className="mt-1 text-[15px] sm:text-[17px] font-semibold leading-none tabular-nums text-foreground truncate">
        {children}
      </div>
    </motion.div>
  );
}

// ─── OHLC legend overlay (re-renders on its own; parent never re-renders on hover) ──

function OhlcLegend({ bars, intraday, register }: {
  bars: Bar[];
  intraday: boolean;
  register: MutableRefObject<((t: number | null) => void) | null>;
}) {
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    register.current = setHoverT;
    return () => { register.current = null; };
  }, [register]);

  const index = useMemo(() => {
    const m = new Map<number, number>();
    bars.forEach((b, i) => m.set(b.time as number, i));
    return m;
  }, [bars]);

  if (bars.length === 0) return null;
  const hovering = hoverT != null && index.has(hoverT);
  const i = hovering ? index.get(hoverT as number)! : bars.length - 1;
  const b = bars[i];
  const prev = i > 0 ? bars[i - 1].close : b.open;
  const chg = b.close - prev;
  const pct = prev ? (chg / prev) * 100 : 0;
  const when = format(new Date((b.time as number) * 1000), intraday ? "MMM d HH:mm" : "MMM d, yyyy");

  return (
    <div
      className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-5.5rem)] border border-card-border/70 bg-card/80 px-2 py-1 text-[10px] sm:text-[11px] leading-tight tabular-nums"
      aria-live="off"
      data-testid="chart-ohlc-legend"
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[.12em]">
        <span
          aria-hidden
          className={cn("inline-block w-1.5 h-1.5 rotate-45", hovering ? "bg-amber" : "bg-primary")}
        />
        <span className={hovering ? "text-amber" : "text-primary"}>{hovering ? "cursor" : "last"}</span>
        <span className="text-dim">{when}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <Cell k="O" v={fmtNum(b.open)} />
        <Cell k="H" v={fmtNum(b.high)} />
        <Cell k="L" v={fmtNum(b.low)} />
        <Cell k="C" v={fmtNum(b.close)} cls={chg >= 0 ? "text-up" : "text-down"} />
        <Delta value={chg} pct={pct} glow={false} className="text-[10px]" />
        {b.volume > 0 && <Cell k="V" v={fmtCompact(b.volume)} />}
      </div>
    </div>
  );
}

function Cell({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-dim">{k}</span>
      <span className={cn("text-foreground", cls)}>{v}</span>
    </span>
  );
}

// ─── Loading overlay ──────────────────────────────────────────────────────────

const FAUX_BARS = Array.from({ length: 36 }, (_, i) =>
  28 + Math.round(22 * Math.sin(i * 0.55) + 14 * Math.sin(i * 1.7 + 1)),
);

function LoadingOverlay({ label, ambient }: { label: string; ambient: boolean }) {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 z-20 overflow-hidden bg-card/70"
      data-testid="chart-loading"
    >
      <div className="absolute inset-0 skeleton-shimmer opacity-25" />
      <div className="absolute inset-x-4 bottom-8 top-16 flex items-end gap-[3px]" aria-hidden>
        {FAUX_BARS.map((h, i) => (
          <div
            key={i}
            className="flex-1 bg-up/10 border-t border-up/30"
            style={{ height: `${Math.max(8, Math.min(92, h))}%` }}
          />
        ))}
      </div>
      {ambient && (
        <div
          aria-hidden
          className="absolute inset-0 animate-scan-x"
          style={{ background: "linear-gradient(90deg, transparent 42%, hsl(var(--up) / .16) 50%, transparent 58%)" }}
        />
      )}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="hud-label inline-flex items-center gap-2 border border-card-border bg-card/90 px-3 py-1.5">
          <span className={cn("live-dot", !ambient && "after:!animate-none")} data-tone="amber" aria-hidden />
          <span className="text-amber">sampling</span>
          <span className="text-foreground/80">{label}</span>
          <span className={cn("cursor-block", !ambient && "after:!animate-none")} aria-hidden />
        </span>
      </div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdvancedChart({ ticker }: Props) {
  const canAnimate = useAnimate();
  const ambient    = useAmbient();

  // ── State ──
  const [rangeKey,   setRangeKey]   = useState<RangeKey>("3M");
  const [chartType,  setChartType]  = useState<ChartType>("candlestick");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [isDark,     setIsDark]     = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [showBB,    setShowBB]    = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showSma200,setShowSma200]= useState(false);
  const [showRsi,   setShowRsi]   = useState(false);
  const [showMacd,  setShowMacd]  = useState(false);

  // ── Refs for chart internals ──
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  // main series (price)
  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // volume
  const volSeriesRef  = useRef<ISeriesApi<"Histogram"> | null>(null);
  // overlays
  const bbUpperRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref      = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref     = useRef<ISeriesApi<"Line"> | null>(null);
  // sub-pane series
  const rsiSeriesRef      = useRef<ISeriesApi<"Line">      | null>(null);
  const macdLineRef       = useRef<ISeriesApi<"Line">      | null>(null);
  const macdSignalRef     = useRef<ISeriesApi<"Line">      | null>(null);
  const macdHistRef       = useRef<ISeriesApi<"Histogram"> | null>(null);
  // overlays driven imperatively (no per-frame React state)
  const hoverCbRef    = useRef<((t: number | null) => void) | null>(null);
  const nowDotRef     = useRef<HTMLDivElement>(null);
  const nowPopRef     = useRef<HTMLSpanElement>(null);
  const sweepLineRef  = useRef<HTMLSpanElement>(null);
  const lastPointRef  = useRef<{ time: UTCTimestamp; value: number } | null>(null);
  const scheduleNowRef = useRef<() => void>(() => {});

  // ── Date range ──
  const range = useMemo(() => {
    if (rangeKey === "CUSTOM" && customFrom && customTo)
      return { from: customFrom, to: customTo, timespan: "day", multiplier: "1" };
    return getDateRange(rangeKey);
  }, [rangeKey, customFrom, customTo]);

  // ── Data hooks ──
  const { data: aggData, isLoading: aggLoading, error: aggError } =
    useAggregates(ticker, range.from, range.to, range.timespan, range.multiplier);

  const { data: rsiData  } = useRsi(ticker);
  const { data: macdData } = useMacd(ticker);
  const { data: sma50Val } = useSma(ticker, 50);
  const { data: sma200Val} = useSma(ticker, 200);
  const { data: bbData   } = useBbands(ticker);
  useSnapshot(ticker); // kept to warm the quote cache; data not consumed here

  // ── Processed OHLCV bars ──
  const rawBars = useMemo<Bar[]>(() => {
    if (!aggData?.results) return [];
    return (aggData.results as any[])
      .filter((b: any) => b.c && b.o && b.h && b.l)
      .map((b: any): Bar => ({
        time:   Math.floor(b.t / 1000) as UTCTimestamp,
        open:   b.o,
        high:   b.h,
        low:    b.l,
        close:  b.c,
        volume: b.v ?? 0,
      }));
  }, [aggData]);

  const priceBars = useMemo<Bar[]>(
    () => chartType === "heikin-ashi" ? toHeikinAshi(rawBars) : rawBars,
    [rawBars, chartType]
  );

  // ── Range stats (headline strip) ──
  const stats = useMemo(() => {
    if (rawBars.length === 0) return null;
    const first = rawBars[0];
    const last  = rawBars[rawBars.length - 1];
    let hi = -Infinity, lo = Infinity, vol = 0;
    for (const b of rawBars) {
      if (b.high > hi) hi = b.high;
      if (b.low  < lo) lo = b.low;
      vol += b.volume;
    }
    const base = rawBars.length >= 2 ? first.close : first.open;
    const chg  = last.close - base;
    return {
      first, last, hi, lo,
      avgVol: vol / rawBars.length,
      chg,
      pct: base ? (chg / base) * 100 : 0,
    };
  }, [rawBars]);

  const isPositive = rawBars.length >= 2 &&
    rawBars[rawBars.length - 1].close >= rawBars[0].close;

  // Source label: the mock fallback reports a fixed resultsCount that never
  // matches its bar count, real Polygon responses always match.
  const isSim = !!aggData && Array.isArray(aggData.results) &&
    aggData.resultsCount !== aggData.results.length;
  const srcLabel = isSim ? "SIM" : "POLYGON";
  const tfLabel  = timeframeLabel(range.timespan, range.multiplier);
  const intraday = range.timespan === "minute";

  const status: { tone: "amber" | "red" | "dim" | undefined; label: string } =
    aggLoading            ? { tone: "amber", label: "sampling" } :
    aggError              ? { tone: "red",   label: "fault" } :
    rawBars.length === 0  ? { tone: "dim",   label: "waiting" } :
    isSim                 ? { tone: "amber", label: "sim" } :
                            { tone: undefined, label: "set" };

  // ── Theme detection (watch .dark class toggle) ──
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setIsDark(el.classList.contains("dark"));
    });
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const theme = useMemo<ChartTheme>(() => getChartTheme(isDark), [isDark]);

  // ─────────────────────────────────────────────────────────────────────────
  // Chart lifecycle: create once, update theme, destroy on unmount
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor:  theme.text,
        fontSize:   10,
        fontFamily: theme.font,
      },
      grid: {
        vertLines:  { color: theme.gridVert, style: LineStyle.Solid },
        horzLines:  { color: theme.grid,     style: LineStyle.Solid },
      },
      crosshair: {
        mode:       CrosshairMode.Magnet,
        vertLine:   { color: theme.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: theme.crosshairLbl },
        horzLine:   { color: theme.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: theme.crosshairLbl },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins:  { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderVisible:       true,
        borderColor:         theme.scaleBorder,
        timeVisible:         true,
        secondsVisible:      false,
        fixLeftEdge:         true,
        fixRightEdge:        true,
      },
      handleScroll:      true,
      handleScale:       true,
      autoSize:          true,
    });

    chartRef.current = chart;

    // Volume series — created here alongside the chart so it is always available
    // when the feed-volume effect runs. A separate effect with [chartRef.current]
    // as a dependency would NEVER re-run after mount because React does not track
    // mutations to refs, so chartRef.current changing from null → IChartApi is
    // invisible to the dependency-comparison algorithm.
    const volSeries = chart.addSeries(HistogramSeries, {
      color:        theme.volUp,
      priceFormat:  { type: "volume" },
      priceScaleId: "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });
    volSeriesRef.current = volSeries;

    // ── NOW dot positioning (imperative, rAF-coalesced, with a timer fallback
    //    because rAF is paused in background / hidden documents) ──
    let raf = 0;
    let tmo = 0;
    let pending = false;
    const positionNow = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (tmo) { window.clearTimeout(tmo); tmo = 0; }
      pending = false;
      const el     = nowDotRef.current;
      const series = mainSeriesRef.current;
      const last   = lastPointRef.current;
      const host   = containerRef.current;
      if (!el) return;
      if (!series || !last || !host) { el.style.opacity = "0"; return; }
      const x = chart.timeScale().timeToCoordinate(last.time);
      const y = series.priceToCoordinate(last.value);
      const w = chart.timeScale().width();
      if (x == null || y == null || x < 0 || x > w || y < 0 || y > host.clientHeight) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = "1";
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      raf = requestAnimationFrame(positionNow);
      tmo = window.setTimeout(positionNow, 120);
    };
    scheduleNowRef.current = schedule;

    // ── Crosshair → OHLC legend + keep NOW dot synced while interacting ──
    const onMove = (param: MouseEventParams<Time>) => {
      const t = typeof param.time === "number" ? param.time : null;
      hoverCbRef.current?.(param.point ? t : null);
      schedule();
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.timeScale().subscribeSizeChange(schedule);

    // ResizeObserver — autoSize:true already makes lightweight-charts observe
    // the container; this observer keeps the explicit width in sync (harmless)
    // and re-positions the NOW dot after layout changes.
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
      schedule();
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (tmo) window.clearTimeout(tmo);
      pending = false;
      scheduleNowRef.current = () => {};
      try {
        chart.unsubscribeCrosshairMove(onMove);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(schedule);
        chart.timeScale().unsubscribeSizeChange(schedule);
      } catch {}
      chart.remove();
      chartRef.current     = null;
      mainSeriesRef.current = null;
      volSeriesRef.current  = null;
      bbUpperRef.current    = null;
      bbLowerRef.current    = null;
      sma50Ref.current      = null;
      sma200Ref.current     = null;
      rsiSeriesRef.current  = null;
      macdLineRef.current   = null;
      macdSignalRef.current = null;
      macdHistRef.current   = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: create once

  // ── Re-apply theme when isDark changes ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: theme.text, fontFamily: theme.font },
      grid: {
        vertLines: { color: theme.gridVert },
        horzLines: { color: theme.grid },
      },
      crosshair: {
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLbl },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshairLbl },
      },
      timeScale: { borderColor: theme.scaleBorder },
    });
  }, [theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Price series — recreate when type changes
  // ─────────────────────────────────────────────────────────────────────────

  // ── Create price series + feed data in ONE effect ──────────────────────────
  // IMPORTANT: These must be merged. If split into two effects (create on
  // [chartType,theme], feed on [priceBars]), a race occurs on first load:
  // data arrives from cache before the series exists → feed effect bails
  // on `!series` and the chart stays blank until the user navigates away
  // and back (which re-mounts and re-runs both effects in order).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // 1) Tear down old price series and overlays
    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current); } catch {}
      mainSeriesRef.current = null;
    }
    [bbUpperRef, bbLowerRef, sma50Ref, sma200Ref].forEach(r => {
      if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
    });

    const lastValueOpts = {
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor:   theme.priceLine,
      priceLineStyle:   LineStyle.Dashed,
      priceLineWidth:   1 as const,
      priceScaleId:     "right",
    };

    // 2) Create the new series
    if (chartType === "candlestick" || chartType === "heikin-ashi") {
      mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor:          theme.upColor,
        downColor:        theme.downColor,
        borderUpColor:    theme.wickUp,
        borderDownColor:  theme.wickDown,
        wickUpColor:      theme.wickUp,
        wickDownColor:    theme.wickDown,
        ...lastValueOpts,
      });
    } else if (chartType === "area") {
      mainSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor:         isPositive ? theme.areaUp    : theme.areaDown,
        topColor:          isPositive ? theme.areaUpTop : theme.areaDownTop,
        bottomColor:       isPositive ? theme.areaUpBot : theme.areaDownBot,
        lineWidth:         2,
        crosshairMarkerBackgroundColor: theme.crosshairLbl,
        ...lastValueOpts,
      });
    } else {
      mainSeriesRef.current = chart.addSeries(LineSeries, {
        color:         isPositive ? theme.areaUp : theme.areaDown,
        lineWidth:     2,
        crosshairMarkerBackgroundColor: theme.crosshairLbl,
        ...lastValueOpts,
      });
    }

    // 3) Feed data immediately — no separate effect needed, no race possible
    const series = mainSeriesRef.current;
    if (series && priceBars.length > 0) {
      if (chartType === "area") {
        const areaData: AreaData[] = priceBars.map((b: Bar) => ({ time: b.time, value: b.close }));
        (series as ISeriesApi<"Area">).setData(areaData);
      } else if (chartType === "line") {
        const lineData: LineData[] = priceBars.map((b: Bar) => ({ time: b.time, value: b.close }));
        (series as ISeriesApi<"Line">).setData(lineData);
      } else {
        const candleData: CandlestickData[] = priceBars.map((b: Bar) => ({
          time:  b.time,
          open:  b.open,
          high:  b.high,
          low:   b.low,
          close: b.close,
        }));
        (series as ISeriesApi<"Candlestick">).setData(candleData);
      }
      chart.timeScale().fitContent();
      const last = priceBars[priceBars.length - 1];
      lastPointRef.current = { time: last.time, value: last.close };
    } else {
      lastPointRef.current = null;
    }
    scheduleNowRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, theme, priceBars, isPositive]);

  // ── Feed volume data ──
  useEffect(() => {
    const series = volSeriesRef.current;
    if (!series || rawBars.length === 0) return;

    const volData: HistogramData[] = rawBars.map((b: Bar) => ({
      time:  b.time,
      value: b.volume,
      color: b.close >= b.open ? theme.volUp : theme.volDown,
    }));
    series.setData(volData);
  }, [rawBars, theme]);

  // ── One-shot sweep reveal when new bars land (skipped when motion is off) ──
  // Native WAAPI (time-based, fill:none) instead of a JS/rAF tween: if the page
  // is hidden and rAF is paused, the chart is never left clipped and the sweep
  // line's resting state (opacity 0) is invisible.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !canAnimate || rawBars.length === 0) return;
    const anims: Animation[] = [];
    const opts: KeyframeAnimationOptions = { duration: 850, easing: "cubic-bezier(.2,.8,.2,1)", fill: "none" };
    try {
      anims.push(el.animate(
        [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
        opts,
      ));
      const line = sweepLineRef.current;
      if (line) {
        anims.push(line.animate(
          [{ left: "0%", opacity: 1 }, { left: "100%", opacity: 0 }],
          opts,
        ));
      }
      const pop = nowPopRef.current;
      if (pop) {
        anims.push(pop.animate(
          [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
          { duration: 380, delay: 800, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" },
        ));
      }
    } catch {
      /* WAAPI unavailable: render the final state */
    }
    return () => {
      anims.forEach(a => { try { a.cancel(); } catch {} });
      el.style.clipPath = "";
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawBars, chartType]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: Bollinger Bands
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showBB) {
      [bbUpperRef, bbLowerRef].forEach(r => {
        if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
      });
      return;
    }

    if (!bbData?.entries?.length) return;

    // entries are newest-first from the hook; reverse to oldest-first for the chart
    const entries = [...bbData.entries].reverse();
    const toTs = (e: { date: string }) =>
      (new Date(e.date).getTime() / 1000) as UTCTimestamp;

    if (!bbUpperRef.current) {
      bbUpperRef.current = chart.addSeries(LineSeries, {
        color:      theme.bbUpper,
        lineWidth:  1,
        lineStyle:  LineStyle.Dashed,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    if (!bbLowerRef.current) {
      bbLowerRef.current = chart.addSeries(LineSeries, {
        color:      theme.bbLower,
        lineWidth:  1,
        lineStyle:  LineStyle.Dashed,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    bbUpperRef.current.applyOptions({ color: theme.bbUpper });
    bbLowerRef.current.applyOptions({ color: theme.bbLower });

    bbUpperRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.upper })));
    bbLowerRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.lower })));
  // priceBars: the price-series effect tears overlays down on type/data change; re-add them.
  }, [showBB, bbData, theme, priceBars]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: SMA 50
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showSma50 || sma50Val == null || rawBars.length === 0) {
      if (sma50Ref.current) { try { chart.removeSeries(sma50Ref.current); } catch {} sma50Ref.current = null; }
      return;
    }

    if (!sma50Ref.current) {
      sma50Ref.current = chart.addSeries(LineSeries, {
        color:      theme.sma50,
        lineWidth:  1,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    sma50Ref.current.applyOptions({ color: theme.sma50 });

    // Build rolling SMA from the chart's own price bars for accurate overlay
    const lineData: LineData[] = [];
    let sum = 0;
    for (let i = 0; i < rawBars.length; i++) {
      sum += rawBars[i].close;
      if (i >= 50) sum -= rawBars[i - 50].close;
      if (i >= 49) lineData.push({ time: rawBars[i].time, value: sum / 50 });
    }
    sma50Ref.current.setData(lineData);
  }, [showSma50, sma50Val, rawBars, theme, priceBars]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: SMA 200
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showSma200 || sma200Val == null || rawBars.length === 0) {
      if (sma200Ref.current) { try { chart.removeSeries(sma200Ref.current); } catch {} sma200Ref.current = null; }
      return;
    }

    if (!sma200Ref.current) {
      sma200Ref.current = chart.addSeries(LineSeries, {
        color:      theme.sma200,
        lineWidth:  1,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    sma200Ref.current.applyOptions({ color: theme.sma200 });

    // Rolling SMA 200 from chart bars
    const lineData: LineData[] = [];
    let sum = 0;
    for (let i = 0; i < rawBars.length; i++) {
      sum += rawBars[i].close;
      if (i >= 200) sum -= rawBars[i - 200].close;
      if (i >= 199) lineData.push({ time: rawBars[i].time, value: sum / 200 });
    }
    sma200Ref.current.setData(lineData);
  }, [showSma200, sma200Val, rawBars, theme, priceBars]);

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-pane: RSI
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showRsi) {
      if (rsiSeriesRef.current) {
        try { chart.removeSeries(rsiSeriesRef.current); } catch {}
        rsiSeriesRef.current = null;
      }
      return;
    }

    if (!rsiData?.entries?.length) return;

    if (!rsiSeriesRef.current) {
      rsiSeriesRef.current = chart.addSeries(LineSeries, {
        color:       theme.rsiLine,
        lineWidth:   1,
        priceScaleId: "rsi",
        lastValueVisible: true,
        priceLineVisible: false,
      });
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
        autoScale: false,
        // Fixed 0–100 range for RSI
        visible: true,
      });
      // Fixed RSI scale — force 0–100
      rsiSeriesRef.current.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
          margins:    { above: 0.1, below: 0.1 },
        }),
      });
    }
    rsiSeriesRef.current.applyOptions({ color: theme.rsiLine });

    const entries = [...rsiData.entries].reverse();
    const rsiLineData: LineData[] = entries.map(e => ({
      time:  (new Date(e.date).getTime() / 1000) as UTCTimestamp,
      value: e.value,
    }));
    rsiSeriesRef.current.setData(rsiLineData);
  }, [showRsi, rsiData, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-pane: MACD
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showMacd) {
      [macdLineRef, macdSignalRef, macdHistRef].forEach(r => {
        if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
      });
      return;
    }

    if (!macdData?.entries?.length) return;

    const entries = [...macdData.entries].reverse();
    const toTs    = (e: { date: string }) => (new Date(e.date).getTime() / 1000) as UTCTimestamp;

    if (!macdHistRef.current) {
      macdHistRef.current = chart.addSeries(HistogramSeries, {
        color:        theme.histUp,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.92, bottom: 0 },
      });
    }
    if (!macdLineRef.current) {
      macdLineRef.current = chart.addSeries(LineSeries, {
        color:        theme.macdLine,
        lineWidth:    1,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    if (!macdSignalRef.current) {
      macdSignalRef.current = chart.addSeries(LineSeries, {
        color:        theme.signalLine,
        lineWidth:    1,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    macdLineRef.current.applyOptions({ color: theme.macdLine });
    macdSignalRef.current.applyOptions({ color: theme.signalLine });

    macdHistRef.current.setData(entries.map(e => ({
      time:  toTs(e),
      value: e.histogram,
      color: e.histogram >= 0 ? theme.histUp : theme.histDown,
    })));
    macdLineRef.current.setData(  entries.map(e => ({ time: toTs(e), value: e.macd   })));
    macdSignalRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.signal })));
  }, [showMacd, macdData, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Dynamic scale margins — prevent RSI/MACD sub-pane overlap
  // Re-runs whenever the combination of active sub-pane indicators changes.
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (showRsi && showMacd) {
      // Both active: RSI gets middle band, MACD gets the bottom sliver
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.78, bottom: 0.12 },
      });
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.90, bottom: 0 },
      });
    } else if (showRsi) {
      // RSI only — standard bottom 20%
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.80, bottom: 0 },
      });
    } else if (showMacd) {
      // MACD only — slightly larger pane
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.88, bottom: 0 },
      });
    }
    // No-op when both are off; series have been removed by their own effects.
    scheduleNowRef.current();
  }, [showRsi, showMacd, chartRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitContent = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
    scheduleNowRef.current();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const anyIndicator = showBB || showSma50 || showSma200 || showRsi || showMacd;
  const loadingLabel = `${ticker} · ${rangeKey === "CUSTOM" ? "CUSTOM" : rangeKey}`;

  const indicators = [
    { key: "bb",     label: "BB",      title: "Bollinger Bands (20, 2)", color: theme.bbUpper, active: showBB,     toggle: () => setShowBB(v     => !v) },
    { key: "sma50",  label: "SMA 50",  title: "Simple moving average, 50", color: theme.sma50,  active: showSma50,  toggle: () => setShowSma50(v  => !v) },
    { key: "sma200", label: "SMA 200", title: "Simple moving average, 200", color: theme.sma200, active: showSma200, toggle: () => setShowSma200(v => !v) },
    { key: "rsi",    label: "RSI",     title: "Relative strength index (14)", color: theme.rsiLine, active: showRsi,  toggle: () => setShowRsi(v    => !v) },
    { key: "macd",   label: "MACD",    title: "MACD (12, 26, 9)", color: theme.macdLine, active: showMacd, toggle: () => setShowMacd(v   => !v) },
  ];

  return (
    <Panel
      title="PRICE"
      tag={`${ticker} · ${tfLabel} · ${srcLabel}`}
      accent={aggError ? "red" : "teal"}
      flush
      data-testid="advanced-chart"
      actions={
        <>
          <span
            className="hidden sm:inline-flex items-center gap-1.5 hud-tag"
            title={`Feed status: ${status.label}`}
          >
            <span className={cn("live-dot", !ambient && "after:!animate-none")} data-tone={status.tone} aria-hidden />
            <span className={cn(
              status.tone === "red" ? "text-down" : status.tone === "amber" ? "text-amber" : status.tone === "dim" ? "text-dim" : "text-hit",
            )}>
              {status.label}
            </span>
          </span>
          <span className={cn("sm:hidden live-dot", !ambient && "after:!animate-none")} data-tone={status.tone} aria-label={`Feed status: ${status.label}`} role="img" />
          <ChartTypePicker value={chartType} onChange={setChartType} />
        </>
      }
    >
      <div className="flex flex-col gap-3 p-3 sm:p-4">

        {/* ── Headline strip: range stats + position-in-range track ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)] gap-3 lg:gap-6 items-end">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-3">
            <Stat label="Last" delay={0.05}>
              <CountUp
                value={stats?.last.close}
                format={n => fmtNum(n, 2)}
                flash
                className={cn(stats && (stats.chg >= 0 ? "glow-teal" : "glow-red"))}
                data-testid="text-chart-last"
              />
            </Stat>
            <Stat label={`Chg · ${rangeKey}`} delay={0.1}>
              {stats ? (
                <Delta value={stats.chg} pct={stats.pct} className="text-[13px] sm:text-[14px]" />
              ) : (
                <span className="text-dim">—</span>
              )}
            </Stat>
            <Stat label="Avg vol" delay={0.15}>
              {stats ? (
                <CountUp value={stats.avgVol} format={fmtCompact} />
              ) : (
                <span className="text-dim">—</span>
              )}
            </Stat>
            <Stat label={`Bars · ${tfLabel}`} delay={0.2}>
              <CountUp value={stats ? rawBars.length : null} format={n => Math.round(n).toString()} />
            </Stat>
          </div>

          <div className="min-w-0">
            <div className="hud-label mb-0.5 flex items-center justify-between">
              <span>Range position</span>
              {stats && (
                <span className="tabular-nums text-foreground/80">
                  {(((stats.last.close - stats.lo) / ((stats.hi - stats.lo) || 1)) * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {stats ? (
              <RangeBar
                min={stats.lo}
                max={stats.hi}
                markers={[
                  { value: stats.first.open, tone: "amber", shape: "tri" },
                  { value: stats.last.close, label: "NOW", tone: stats.chg >= 0 ? "up" : "down" },
                ]}
                minLabel={`LO ${fmtNum(stats.lo)}`}
                maxLabel={`HI ${fmtNum(stats.hi)}`}
              />
            ) : (
              <div className="h-[44px] flex flex-col justify-center gap-2">
                <div className="h-1 w-full skeleton-shimmer" />
                <div className="flex justify-between hud-tag"><span>LO —</span><span>HI —</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="hud-divider" />

        {/* ── Toolbar: ranges + indicators ── */}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2 min-w-0">
          <RangeTabs value={rangeKey} onChange={setRangeKey} />

          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="hud-label inline-flex items-center gap-1 mr-0.5">
              <LayoutPanelTop className="w-3 h-3" aria-hidden /> Ind
            </span>
            {indicators.map(ind => (
              <IndBtn
                key={ind.key}
                label={ind.label}
                title={ind.title}
                color={ind.color}
                active={ind.active}
                onClick={ind.toggle}
                testId={`button-indicator-${ind.key}`}
              />
            ))}
          </div>
        </div>

        {/* ── Custom date inputs ── */}
        <AnimatePresence initial={false}>
          {rangeKey === "CUSTOM" && (
            <motion.div
              key="custom-range"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 flex-wrap border border-dashed border-card-border px-2.5 py-2">
                <Calendar className="w-3.5 h-3.5 text-primary" aria-hidden />
                <span className="hud-label">from</span>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  aria-label="Custom range start date"
                  className="h-7 px-2 text-[11px] tabular-nums bg-background/60 border border-card-border text-foreground focus:outline-none focus:border-primary focus-visible:box-glow-teal transition-colors"
                  data-testid="input-custom-from"
                />
                <span className="hud-label">to</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  aria-label="Custom range end date"
                  className="h-7 px-2 text-[11px] tabular-nums bg-background/60 border border-card-border text-foreground focus:outline-none focus:border-primary focus-visible:box-glow-teal transition-colors"
                  data-testid="input-custom-to"
                />
                {!(customFrom && customTo) && (
                  <span className="hud-tag">waiting for both dates · showing 3M</span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Chart canvas ── */}
        <div className="group relative w-full h-[320px] sm:h-[420px] overflow-hidden border border-card-border/60 transition-colors hover:border-primary/40">
          {/* Ticker watermark behind the transparent canvas */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center select-none">
            <span className="text-[52px] sm:text-[88px] font-bold tracking-[.3em] text-foreground/[0.035] whitespace-nowrap">
              {ticker}
            </span>
          </div>

          {/* Canvas always in DOM so containerRef is available on mount */}
          <div
            ref={containerRef}
            className="relative z-[1] w-full h-full"
            data-testid="chart-canvas"
            style={{ background: "transparent" }}
          />

          {/* OHLC legend (follows crosshair, last bar otherwise) */}
          <OhlcLegend bars={rawBars} intraday={intraday} register={hoverCbRef} />

          {/* NOW dot on the last close, positioned imperatively */}
          <div
            ref={nowDotRef}
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-[5]"
            style={{ opacity: 0, transition: "opacity .25s ease" }}
          >
            {/* pop-in is driven by the sweep effect (WAAPI); resting state is fully visible */}
            <span ref={nowPopRef} className="absolute -left-[4px] -top-[4px] block w-2 h-2">
              {ambient && (
                <span className="absolute inset-0 rounded-full bg-primary/60 animate-ring-expand" />
              )}
              <span className="absolute inset-0 rounded-full bg-primary border border-background box-glow-teal" />
            </span>
          </div>

          {/* One-shot sweep line that leads the reveal (animated by the sweep effect; invisible at rest) */}
          <span
            ref={sweepLineRef}
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-[6] w-px bg-primary box-glow-teal"
            style={{ opacity: 0 }}
          />

          {/* Overlays — shown on top while loading/error/empty */}
          <AnimatePresence>
            {aggLoading && <LoadingOverlay label={loadingLabel} ambient={ambient} />}
          </AnimatePresence>
          {!aggLoading && aggError && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-card/70"
            >
              <div className="max-w-sm border border-down/40 bg-down/5 px-4 py-3 text-center box-glow-red">
                <div className="hud-label text-down mb-1">▼ feed fault</div>
                <div className="text-[12px] text-muted-foreground font-read">
                  Unable to load chart data. Check API key configuration.
                </div>
              </div>
            </motion.div>
          )}
          {!aggLoading && !aggError && rawBars.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-20 flex items-center justify-center p-4"
            >
              <div className="border border-dashed border-card-border bg-card/80 px-4 py-3 text-center">
                <div className="hud-label mb-1 inline-flex items-center gap-1.5">
                  <span className="live-dot" data-tone="dim" /> waiting · no bars
                </div>
                <div className="text-[12px] text-muted-foreground font-read">
                  No data available for this range.
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Footer: active indicator readouts + controls ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border/60 pt-2 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <AnimatePresence initial={false}>
              {!anyIndicator && (
                <motion.span
                  key="none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hud-tag"
                >
                  {"// no overlays · toggle ind above"}
                </motion.span>
              )}
              {showBB     && <LegendItem key="bb"     color={theme.bbUpper}  label="Bollinger Bands (20,2)" />}
              {showSma50  && <LegendItem key="sma50"  color={theme.sma50}    label={`SMA 50  $${sma50Val?.toFixed(2) ?? "—"}`} />}
              {showSma200 && <LegendItem key="sma200" color={theme.sma200}   label={`SMA 200  $${sma200Val?.toFixed(2) ?? "—"}`} />}
              {showRsi    && <LegendItem key="rsi"    color={theme.rsiLine}  label={`RSI (14)  ${rsiData?.latest?.value?.toFixed(1) ?? "—"}`} />}
              {showMacd   && <LegendItem key="macd"   color={theme.macdLine}   label={`MACD  ${macdData?.latest?.macd?.toFixed(2) ?? "—"}`} />}
              {showMacd   && <LegendItem key="signal" color={theme.signalLine} label={`Signal  ${macdData?.latest?.signal?.toFixed(2) ?? "—"}`} />}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hud-tag hidden md:inline">drag · pan / wheel · zoom</span>
            <button
              type="button"
              onClick={fitContent}
              className="hud-btn !h-6 !px-2 !text-[10px]"
              aria-label="Fit chart to all bars"
              title="Fit chart to all bars"
              data-testid="button-chart-fit"
            >
              <Maximize2 className="w-3 h-3" aria-hidden /> Fit
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5"
    >
      <span className="w-3 h-0.5 flex-shrink-0" style={{ background: color }} />
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground whitespace-pre">{label}</span>
    </motion.div>
  );
}
