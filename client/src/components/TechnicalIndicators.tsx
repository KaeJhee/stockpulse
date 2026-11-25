import {
  useEffect, useId, useRef, useState,
  type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject,
} from "react";
import {
  motion, animate as fmAnimate,
  useInView, useMotionValue, useTransform,
} from "framer-motion";
import { useRsi, useMacd, useSma, useBbands, useSnapshot } from "@/lib/hooks";
import { AlertTriangle } from "lucide-react";
import {
  Panel, CountUp, RangeBar, Delta, Sparkline, fmtNum,
  useAnimate, useAmbient, type RangeMarker,
} from "@/components/hud";
import { cn } from "@/lib/utils";

interface Props { ticker: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val.toFixed(decimals);
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return `$${fmtNum(val, 2)}`;
}

const signed = (n: number, d = 2) => `${n > 0 ? "+" : ""}${n.toFixed(d)}`;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Minimum number of available signals before a regime read is shown. */
const MIN_SIGNALS = 3;

/**
 * In-view gate for one-shot entrance animations, with fail-safes so content
 * never stays hidden when IntersectionObserver doesn't fire (background tabs,
 * programmatic jumps): an on-screen rect check plus a hard timeout.
 */
function useRevealGate(ref: RefObject<HTMLElement>, anim: boolean) {
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [forced, setForced] = useState(false);
  useEffect(() => {
    if (!anim || inView || forced) return;
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) setForced(true);
    };
    const iv = setInterval(check, 700);
    const hard = setTimeout(() => setForced(true), 4000);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      clearInterval(iv);
      clearTimeout(hard);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [anim, inView, forced, ref]);
  return !anim || inView || forced;
}

type Lean = 1 | 0 | -1;
type SectionKey = "rsi" | "macd" | "sma" | "bb";

const leanText  = (l: Lean | null) => l === 1 ? "text-up" : l === -1 ? "text-down" : l === 0 ? "text-amber" : "text-dim";
const leanGlyph = (l: Lean | null) => l === 1 ? "▲" : l === -1 ? "▼" : l === 0 ? "◆" : "·";
const leanWord  = (l: Lean | null) => l === 1 ? "pos" : l === -1 ? "neg" : l === 0 ? "flat" : "n/a";
const leanTile  = (l: Lean | null) =>
  l === 1 ? "bg-up/15 border-up/40"
  : l === -1 ? "bg-down/15 border-down/40"
  : l === 0 ? "bg-amber/10 border-amber/35"
  : "bg-muted/40 border-border";

const EASE = [0.2, 0.8, 0.2, 1] as const;

// ── Scrub hook: pointer + keyboard index over a series ────────────────────────

function useScrub(n: number) {
  const [idx, setIdx] = useState<number | null>(null);
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || n <= 0) return;
    const i = Math.floor(((e.clientX - r.left) / r.width) * n);
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (n <= 0) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.max(0, (i ?? n) - 1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setIdx((i) => Math.min(n - 1, (i ?? -1) + 1)); }
    else if (e.key === "Home") { e.preventDefault(); setIdx(0); }
    else if (e.key === "End") { e.preventDefault(); setIdx(n - 1); }
    else if (e.key === "Escape") { setIdx(null); }
  };
  const clear = () => setIdx(null);
  return {
    idx,
    bind: { onPointerMove, onPointerLeave: clear, onKeyDown, onBlur: clear, tabIndex: 0 },
  };
}

// ── Reveal: left→right wipe (draw-in) for charts ──────────────────────────────

function Reveal({ go, delay = 0, className, children }: {
  go: boolean; delay?: number; className?: string; children: ReactNode;
}) {
  const anim = useAnimate();
  return (
    <motion.div
      className={className}
      initial={anim ? { clipPath: "inset(0 100% 0 0)" } : false}
      animate={go ? { clipPath: "inset(0 0% 0 0)" } : { clipPath: "inset(0 100% 0 0)" }}
      transition={{ duration: 1.1, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

// ── Section block (highlights when its regime tile is hovered) ────────────────

function Block({ title, params, highlight, right, delay, go, children, sectionId }: {
  title: string; params?: string; highlight?: boolean; right?: ReactNode;
  delay: number; go: boolean; children: ReactNode; sectionId: SectionKey;
}) {
  const anim = useAnimate();
  return (
    <motion.div
      data-section={sectionId}
      initial={anim ? { opacity: 0, y: 10 } : false}
      animate={go ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: 0.45, delay, ease: EASE }}
      className={cn(
        "relative min-w-0 border bg-background/30 p-3 transition-[border-color,box-shadow] duration-300",
        highlight ? "border-up/60 box-glow-teal" : "border-border/60 hover:border-up/35",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="hud-label text-foreground/85 truncate">{title}</span>
          {params && <span className="hud-tag truncate">{params}</span>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {children}
    </motion.div>
  );
}

// ── Error / empty rows ────────────────────────────────────────────────────────

function ErrRow({ msg }: { msg: string }) {
  const ambient = useAmbient();
  return (
    <div className="flex items-center gap-2 text-xs text-amber py-2">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden />
      <span>{msg}</span>
      {ambient && <span className="live-dot ml-auto" data-tone="amber" aria-hidden />}
    </div>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return <div className="text-xs text-muted-foreground py-2">{msg}</div>;
}

// ── RSI semicircle gauge ──────────────────────────────────────────────────────

const GX = 100, GY = 100;
function gaugePt(v: number, r: number): [number, number] {
  const a = Math.PI - (Math.max(0, Math.min(100, v)) / 100) * Math.PI;
  return [GX + r * Math.cos(a), GY - r * Math.sin(a)];
}
function gaugeArc(v1: number, v2: number, r: number) {
  const [x1, y1] = gaugePt(v1, r);
  const [x2, y2] = gaugePt(Math.min(v2, 99.95), r);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

function rsiZone(v: number) {
  if (v >= 70) return { label: "Overbought", tone: "text-down", glow: "glow-red", stroke: "hsl(var(--down))", chip: "border-down/50 text-down" };
  if (v <= 30) return { label: "Oversold", tone: "text-up", glow: "glow-teal", stroke: "hsl(var(--up))", chip: "border-up/50 text-up" };
  return { label: "Neutral", tone: "text-amber", glow: "glow-amber", stroke: "hsl(var(--amber))", chip: "border-amber/50 text-amber" };
}

function RsiGauge({ value, go }: { value: number; go: boolean }) {
  const anim = useAnimate();
  const ambient = useAmbient();
  const zone = rsiZone(value);
  const mv = useMotionValue(anim ? 0 : value);

  useEffect(() => {
    if (!anim) { mv.set(value); return; }
    if (!go) return;
    const ctl = fmAnimate(mv, value, { type: "spring", stiffness: 55, damping: 9, delay: 0.35 });
    // Fail-safe: if frames are throttled/paused, still land on the true value.
    const safety = setTimeout(() => { ctl.stop(); mv.set(value); }, 4000);
    return () => { clearTimeout(safety); ctl.stop(); };
  }, [value, anim, go, mv]);

  const nx = useTransform(mv, (v) => gaugePt(v, 62)[0]);
  const ny = useTransform(mv, (v) => gaugePt(v, 62)[1]);

  const ticks = [30, 50, 70];

  return (
    <div className="w-full max-w-[250px] mx-auto">
      <div className="relative">
        <svg
          viewBox="0 -6 200 114"
          className="w-full h-auto block overflow-visible"
          role="img"
          aria-label={`RSI 14 gauge: ${fmt(value, 1)}, ${zone.label.toLowerCase()} zone`}
        >
          {/* zone track */}
          <path d={gaugeArc(0, 30, 80)} style={{ stroke: "hsl(var(--up) / .45)", strokeWidth: 9, fill: "none" }} />
          <path d={gaugeArc(30, 70, 80)} style={{ stroke: "hsl(var(--muted-foreground) / .22)", strokeWidth: 9, fill: "none" }} />
          <path d={gaugeArc(70, 100, 80)} style={{ stroke: "hsl(var(--down) / .45)", strokeWidth: 9, fill: "none" }} />
          {/* fine tick ring */}
          {Array.from({ length: 21 }, (_, i) => i * 5).map((t) => {
            const [x1, y1] = gaugePt(t, 70);
            const [x2, y2] = gaugePt(t, t % 10 === 0 ? 66 : 68);
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: "hsl(var(--muted-foreground) / .35)", strokeWidth: 0.8 }} />;
          })}
          {/* threshold ticks + labels */}
          {ticks.map((t) => {
            const [x1, y1] = gaugePt(t, 86);
            const [x2, y2] = gaugePt(t, 92);
            const [tx, ty] = gaugePt(t, 99);
            return (
              <g key={t}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke: "hsl(var(--foreground) / .55)", strokeWidth: 1 }} />
                <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" style={{ fill: "hsl(var(--muted-foreground))", fontSize: 8, fontFamily: "var(--font-mono)" }}>
                  {t}
                </text>
              </g>
            );
          })}
          {/* value arc */}
          <motion.path
            d={gaugeArc(0, Math.max(0.5, value), 74)}
            style={{ stroke: zone.stroke, strokeWidth: 2.5, fill: "none", filter: `drop-shadow(0 0 calc(4px * var(--glow-strength)) ${zone.stroke})` }}
            initial={anim ? { pathLength: 0 } : false}
            animate={{ pathLength: go ? 1 : 0 }}
            transition={{ duration: 1.1, delay: 0.3, ease: EASE }}
          />
          {/* needle */}
          <motion.line
            x1={GX} y1={GY} x2={nx} y2={ny}
            style={{ stroke: "hsl(var(--foreground))", strokeWidth: 1.6, strokeLinecap: "round" }}
          />
          <motion.circle
            cx={nx} cy={ny} r={2.6}
            style={{ fill: zone.stroke, filter: `drop-shadow(0 0 calc(5px * var(--glow-strength)) ${zone.stroke})` }}
          />
          {ambient && (
            <motion.circle
              cx={GX} cy={GY} r={9}
              style={{ fill: "none", stroke: zone.stroke, strokeWidth: 0.8 }}
              initial={{ opacity: 0.5, scale: 1 }}
              animate={{ opacity: [0.5, 0], scale: [1, 1.9] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 1.4 }}
            />
          )}
          <circle cx={GX} cy={GY} r={4} style={{ fill: "hsl(var(--card))", stroke: "hsl(var(--foreground) / .7)", strokeWidth: 1 }} />
        </svg>
      </div>
      <div className="flex justify-center mt-1">
        <CountUp
          value={value}
          format={(n) => n.toFixed(1)}
          duration={1100}
          className={cn("text-2xl font-semibold leading-none", zone.tone, zone.glow)}
        />
      </div>
      <div className="flex items-center justify-between gap-2 mt-1 text-[9px] tracking-[.1em] uppercase">
        <span className="text-up">▼ oversold &lt;30</span>
        <span className="text-down">overbought &gt;70 ▲</span>
      </div>
      <div className="flex justify-center mt-1.5">
        <motion.span
          key={zone.label}
          className={cn("hud-chip h-5 px-1.5", zone.chip)}
          initial={anim ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {zone.label} zone
        </motion.span>
      </div>
    </div>
  );
}

// ── RSI 30-bar trace with 30/70 guides and scrub readout ──────────────────────

function RsiTrace({ data, go }: { data: { date: string; value: number }[]; go: boolean }) {
  const n = data.length;
  const { idx, bind } = useScrub(n);
  const W = 300, H = 56;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (Math.max(0, Math.min(100, v)) / 100) * H;
  const d = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const cur = idx != null ? data[idx] : data[n - 1];
  const curZone = rsiZone(cur.value);
  const leftPct = n <= 1 ? 0 : ((idx ?? n - 1) / (n - 1)) * 100;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between hud-tag mb-1 tabular-nums">
        <span>{idx != null ? cur.date : `rsi · ${n}d trace`}</span>
        <span className={curZone.tone}>{fmt(cur.value, 1)}</span>
      </div>
      <div
        role="slider"
        aria-label="RSI trace, use arrow keys to scrub"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, n - 1)}
        aria-valuenow={idx ?? n - 1}
        aria-valuetext={`${cur.date}: RSI ${fmt(cur.value, 1)}`}
        className="relative h-14 cursor-crosshair outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2"
        {...bind}
      >
        <Reveal go={go} delay={0.5} className="absolute inset-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full block" aria-hidden>
            <rect x={0} y={0} width={W} height={y(70)} style={{ fill: "hsl(var(--down) / .07)" }} />
            <rect x={0} y={y(30)} width={W} height={H - y(30)} style={{ fill: "hsl(var(--up) / .07)" }} />
            <line x1={0} x2={W} y1={y(70)} y2={y(70)} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" style={{ stroke: "hsl(var(--down) / .5)", strokeWidth: 1 }} />
            <line x1={0} x2={W} y1={y(30)} y2={y(30)} vectorEffect="non-scaling-stroke" strokeDasharray="3 3" style={{ stroke: "hsl(var(--up) / .5)", strokeWidth: 1 }} />
            <path d={d} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "hsl(var(--primary))", strokeWidth: 1.5, strokeLinejoin: "round" }} />
          </svg>
        </Reveal>
        {idx != null && (
          <div className="absolute top-0 bottom-0 w-px bg-foreground/40 pointer-events-none" style={{ left: `${leftPct}%` }} aria-hidden />
        )}
        <div
          className="absolute w-[6px] h-[6px] rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-[left,top] duration-100"
          style={{
            left: `${leftPct}%`,
            top: `${(1 - Math.max(0, Math.min(100, cur.value)) / 100) * 100}%`,
            background: curZone.stroke,
            boxShadow: `0 0 calc(8px * var(--glow-strength)) ${curZone.stroke}`,
          }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ── MACD histogram + MACD/signal lines ────────────────────────────────────────

type MacdEntry = { date: string; macd: number; signal: number; histogram: number };

function MacdHistogram({ data, go }: { data: MacdEntry[]; go: boolean }) {
  const anim = useAnimate();
  const n = data.length;
  const { idx, bind } = useScrub(n);
  const maxAbs = Math.max(
    1e-9,
    ...data.flatMap((e) => [Math.abs(e.histogram), Math.abs(e.macd), Math.abs(e.signal)]),
  );
  const scale = (v: number) => (v / maxAbs) * 46; // % of height from center
  const lineD = (key: "macd" | "signal") =>
    data.map((e, i) => `${i ? "L" : "M"}${(i + 0.5).toFixed(2)},${(50 - scale(e[key])).toFixed(2)}`).join(" ");
  const cur = data[idx ?? n - 1];

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2 hud-tag mb-1 tabular-nums min-w-0">
        <span className="truncate">{idx != null ? cur.date : `hist · ${n}d`}</span>
        <span className="flex items-center gap-2 shrink-0">
          <span className={cur.histogram >= 0 ? "text-up" : "text-down"}>
            {cur.histogram >= 0 ? "▲" : "▼"} {signed(cur.histogram)}
          </span>
          {idx != null && (
            <span className="hidden sm:inline text-muted-foreground">
              m {signed(cur.macd)} · s {signed(cur.signal)}
            </span>
          )}
        </span>
      </div>
      <div
        role="slider"
        aria-label="MACD histogram, use arrow keys to scrub"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, n - 1)}
        aria-valuenow={idx ?? n - 1}
        aria-valuetext={`${cur.date}: histogram ${signed(cur.histogram)}, MACD ${signed(cur.macd)}, signal ${signed(cur.signal)}`}
        className="relative h-20 cursor-crosshair outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2"
        {...bind}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden />
        <div className="absolute inset-0 flex gap-[2px]" aria-hidden>
          {data.map((e, i) => {
            const pos = e.histogram >= 0;
            const h = Math.max(1.5, Math.abs(scale(e.histogram)));
            const isLast = i === n - 1;
            const isHover = idx === i;
            return (
              <div key={e.date} className={cn("relative flex-1 h-full", isHover && "bg-foreground/[0.06]")}>
                <motion.div
                  className={cn(
                    "absolute inset-x-0",
                    pos ? "bg-up" : "bg-down",
                    isLast || isHover ? "opacity-100" : "opacity-55",
                    isLast && (pos ? "box-glow-teal" : "box-glow-red"),
                  )}
                  style={pos
                    ? { bottom: "50%", height: `${h}%`, originY: 1 }
                    : { top: "50%", height: `${h}%`, originY: 0 }}
                  initial={anim ? { scaleY: 0 } : false}
                  animate={{ scaleY: go ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 22, delay: 0.25 + i * 0.022 }}
                />
              </div>
            );
          })}
        </div>
        <Reveal go={go} delay={0.6} className="absolute inset-0 pointer-events-none">
          <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="w-full h-full block" aria-hidden>
            <path d={lineD("signal")} vectorEffect="non-scaling-stroke" strokeDasharray="3 2" style={{ fill: "none", stroke: "hsl(var(--amber))", strokeWidth: 1.2 }} />
            <path d={lineD("macd")} vectorEffect="non-scaling-stroke" style={{ fill: "none", stroke: "hsl(var(--foreground) / .85)", strokeWidth: 1.3 }} />
          </svg>
        </Reveal>
      </div>
      <div className="flex items-center gap-3 mt-1.5 hud-tag">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-px bg-foreground/85" aria-hidden /> macd</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 border-t border-dashed border-amber" aria-hidden /> signal</span>
        <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-2 bg-up/70" aria-hidden /> hist</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
// All indicators use Polygon daily bars — no AV key required, no daily quota.
// usePolyBars is a shared cached query; RSI/SMA/BB all derive from same fetch.

export function TechnicalIndicators({ ticker }: Props) {
  const { data: rsiData,  isLoading: rsiLoading,  isError: rsiError  } = useRsi(ticker);
  const { data: macdData, isLoading: macdLoading, isError: macdError } = useMacd(ticker);
  const { data: sma50,    isLoading: sma50Loading                     } = useSma(ticker, 50);
  const { data: sma200,   isLoading: sma200Loading                    } = useSma(ticker, 200);
  const { data: bbData,   isLoading: bbLoading,   isError: bbError   } = useBbands(ticker);
  const { data: snapshot } = useSnapshot(ticker);
  const ambient = useAmbient();

  const currentPrice = snapshot?.lastTrade?.p ?? snapshot?.day?.c ?? null;

  // RSI/SMA/BB share usePolyBars — all resolve together once bars arrive (~300ms)
  // MACD has its own Polygon fetch (different date range for warm-up)
  const isLoading = rsiLoading || sma50Loading || sma200Loading || bbLoading || macdLoading;

  if (isLoading) return (
    <Panel
      title="Technicals"
      tag="polygon · daily"
      accent="teal"
      delay={0.05}
      data-testid="tech-indicators-loading"
      actions={
        <span className="flex items-center gap-1.5 hud-tag">
          {ambient
            ? <span className="live-dot" data-tone="amber" aria-hidden />
            : <span className="inline-block w-[6px] h-[6px] rounded-full bg-amber" aria-hidden />}
          waiting
        </span>
      }
    >
      <div className="space-y-4" aria-busy="true">
        <div className={cn("text-[11px] text-muted-foreground", ambient && "cursor-block")}>
          {"> computing rsi · macd · sma · bb from daily bars"}
        </div>
        <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
          <div className={cn("h-[88px]", ambient ? "skeleton-shimmer" : "bg-muted")} />
          <div className="grid grid-cols-3 xl:grid-cols-6 gap-1.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={cn("h-12", ambient ? "skeleton-shimmer" : "bg-muted")} />
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className={cn("h-48", ambient ? "skeleton-shimmer" : "bg-muted")} />
          <div className={cn("h-48", ambient ? "skeleton-shimmer" : "bg-muted")} />
        </div>
        <div className={cn("h-4 w-3/4", ambient ? "skeleton-shimmer" : "bg-muted")} />
      </div>
    </Panel>
  );

  return (
    <Panel
      title="Technicals"
      tag="polygon · daily"
      accent="teal"
      delay={0.05}
      data-testid="tech-indicators"
    >
      <TechBody
        rsiData={rsiData}
        rsiError={rsiError}
        macdData={macdData}
        macdError={macdError}
        sma50={sma50}
        sma200={sma200}
        bbData={bbData}
        bbError={bbError}
        currentPrice={currentPrice}
      />
    </Panel>
  );
}

// ── Body (separate component so in-view detection attaches after loading) ────

interface BodyProps {
  rsiData: { entries: { date: string; value: number }[]; latest: { date: string; value: number } | null } | null | undefined;
  rsiError: boolean;
  macdData: { entries: MacdEntry[]; latest: MacdEntry | null } | null | undefined;
  macdError: boolean;
  sma50: number | null | undefined;
  sma200: number | null | undefined;
  bbData: { entries: { date: string; upper: number; middle: number; lower: number }[]; latest: { date: string; upper: number; middle: number; lower: number } | null } | null | undefined;
  bbError: boolean;
  currentPrice: number | null;
}

interface Sig {
  id: string;
  short: string;
  section: SectionKey;
  lean: Lean | null;
  detail: string;
}

function TechBody({
  rsiData, rsiError, macdData, macdError, sma50, sma200, bbData, bbError, currentPrice,
}: BodyProps) {
  const anim = useAnimate();
  const ambient = useAmbient();
  const ref = useRef<HTMLDivElement>(null);
  // One-shot entrance trigger only; data values never wait on it.
  const go = useRevealGate(ref, anim);
  const hlId = useId();

  const [hoverSig, setHoverSig] = useState<string | null>(null);
  const [pinnedSig, setPinnedSig] = useState<string | null>(null);
  const [settled, setSettled] = useState(!anim);

  // TechBody only mounts once every query has settled (success or error), so the
  // "sampling" phase is purely cosmetic and always resolves (timer-based, not rAF).
  useEffect(() => {
    if (!anim) { setSettled(true); return; }
    if (settled) return;
    const t = setTimeout(() => setSettled(true), go ? 1400 : 5000);
    return () => clearTimeout(t);
  }, [anim, go, settled]);

  // Sanitised inputs: only finite numbers count as data.
  const currentPx = finite(currentPrice) ? currentPrice : null;
  const s50  = finite(sma50)  ? sma50  : null;
  const s200 = finite(sma200) ? sma200 : null;

  // Chart data: 30 most recent bars, reversed oldest→newest
  const macdChart = (macdData?.entries ?? [])
    .filter((e) => finite(e.macd) && finite(e.signal) && finite(e.histogram))
    .slice(0, 30).reverse();
  const rsiChart  = (rsiData?.entries  ?? []).filter((e) => finite(e.value)).slice(0, 30).reverse();

  // SMA golden/death cross
  const smaCross = s50 != null && s200 != null
    ? s50 > s200 ? "bullish" : "bearish"
    : null;

  // Bollinger position relative to current price
  const bb = bbData?.latest;
  const bbOk = !bbError && bb && finite(bb.upper) && finite(bb.middle) && finite(bb.lower) ? bb : null;
  let bbSignal: "overbought" | "oversold" | "neutral" | null = null;
  if (bbOk && currentPx != null) {
    if (currentPx >= bbOk.upper) bbSignal = "overbought";
    else if (currentPx <= bbOk.lower) bbSignal = "oversold";
    else bbSignal = "neutral";
  }

  const rsiVal = !rsiError && rsiData?.latest && finite(rsiData.latest.value) ? rsiData.latest.value : null;
  const ml = macdData?.latest;
  const macdLatest = !macdError && ml && finite(ml.macd) && finite(ml.signal) && finite(ml.histogram) ? ml : null;
  const d50  = currentPx != null && s50  ? ((currentPx - s50)  / s50)  * 100 : null;
  const d200 = currentPx != null && s200 ? ((currentPx - s200) / s200) * 100 : null;
  const spread = s50 != null && s200 ? ((s50 - s200) / s200) * 100 : null;
  const pctB = bbOk && currentPx != null && bbOk.upper !== bbOk.lower
    ? ((currentPx - bbOk.lower) / (bbOk.upper - bbOk.lower)) * 100 : null;
  const bandwidth = bbOk && bbOk.middle ? ((bbOk.upper - bbOk.lower) / bbOk.middle) * 100 : null;

  // MACD: bars since last histogram sign change (entries are newest-first)
  let crossAgo: number | null = null;
  if (macdLatest && macdData?.entries?.length) {
    const s0 = Math.sign(macdData.entries[0].histogram);
    for (let i = 1; i < macdData.entries.length; i++) {
      if (Math.sign(macdData.entries[i].histogram) !== s0) { crossAgo = i - 1; break; }
    }
  }

  // ── Regime signals (descriptive tallies, not a recommendation) ──
  const signals: Sig[] = [
    {
      id: "rsi", short: "RSI", section: "rsi",
      lean: rsiVal == null ? null : rsiVal > 55 ? 1 : rsiVal < 45 ? -1 : 0,
      detail: rsiVal == null
        ? "rsi unavailable"
        : `rsi ${fmt(rsiVal, 1)} · ${rsiVal > 55 ? "above" : rsiVal < 45 ? "below" : "near"} 50 midline${rsiVal >= 70 ? " · overbought zone" : rsiVal <= 30 ? " · oversold zone" : ""}`,
    },
    {
      id: "macd", short: "MACD", section: "macd",
      lean: macdLatest == null ? null : macdLatest.histogram > 0 ? 1 : macdLatest.histogram < 0 ? -1 : 0,
      detail: macdLatest == null
        ? "macd unavailable"
        : `macd ${macdLatest.histogram >= 0 ? "above" : "below"} signal · hist ${signed(macdLatest.histogram)}`,
    },
    {
      id: "px50", short: "PX·50", section: "sma",
      lean: d50 == null ? null : d50 > 0 ? 1 : d50 < 0 ? -1 : 0,
      detail: d50 == null ? "sma 50 unavailable" : `price ${signed(d50)}% vs sma 50`,
    },
    {
      id: "px200", short: "PX·200", section: "sma",
      lean: d200 == null ? null : d200 > 0 ? 1 : d200 < 0 ? -1 : 0,
      detail: d200 == null ? "sma 200 unavailable" : `price ${signed(d200)}% vs sma 200`,
    },
    {
      id: "cross", short: "50/200", section: "sma",
      lean: smaCross == null ? null : smaCross === "bullish" ? 1 : -1,
      detail: smaCross == null
        ? "cross state unavailable"
        : smaCross === "bullish" ? "sma 50 > sma 200 · golden-cross regime" : "sma 50 < sma 200 · death-cross regime",
    },
    {
      id: "bbmid", short: "BB·MID", section: "bb",
      lean: bbOk == null || currentPx == null ? null : currentPx > bbOk.middle ? 1 : currentPx < bbOk.middle ? -1 : 0,
      detail: bbOk == null || currentPx == null
        ? "bollinger unavailable"
        : `price ${currentPx >= bbOk.middle ? "above" : "below"} 20d mid · %B ${fmt(pctB, 0)}`,
    },
  ];

  const avail = signals.filter((s) => s.lean != null);
  const nAvail = avail.length;
  const pos = avail.filter((s) => s.lean === 1).length;
  const neg = avail.filter((s) => s.lean === -1).length;
  const flat = nAvail - pos - neg;
  const nTotal = signals.length;
  const sufficient = nAvail >= MIN_SIGNALS;
  const tilt = sufficient ? ((pos - neg) / nAvail) * 100 : null;

  const regime: { label: string; tone: string; glow: string; box: string; flash: string; word: string | null } = !sufficient
    ? { label: "Insufficient data", tone: "text-amber", glow: "", box: "border-dashed border-amber/40 bg-amber/[0.04]", flash: "", word: null }
    : pos / nAvail >= 0.67
      ? { label: "Leans positive", tone: "text-up", glow: "glow-teal", box: "border-up/50 bg-up/[0.06]", flash: "box-glow-teal border-up", word: "positive" }
      : neg / nAvail >= 0.67
        ? { label: "Leans negative", tone: "text-down", glow: "glow-red", box: "border-down/50 bg-down/[0.06]", flash: "box-glow-red border-down", word: "negative" }
        : { label: "Mixed", tone: "text-amber", glow: "glow-amber", box: "border-amber/50 bg-amber/[0.06]", flash: "box-glow-amber border-amber", word: "mixed" };

  const shownId = hoverSig ?? pinnedSig;
  const shown = signals.find((s) => s.id === shownId) ?? null;
  const hlSection = shown?.section ?? null;

  const readout = shown
    ? `${shown.detail} · ${shown.lean === 1 ? "leans positive" : shown.lean === -1 ? "leans negative" : shown.lean === 0 ? "neutral" : "no read"}`
    : !sufficient
      ? `insufficient data · ${nAvail}/${nTotal} signals available`
      : `${nAvail} signals · ${pos} lean positive · ${neg} lean negative · ${flat} neutral`;

  // SMA range bar
  const smaVals = [s50, s200, currentPx].filter((v): v is number => v != null && Number.isFinite(v));
  const smaMin = smaVals.length ? Math.min(...smaVals) : 0;
  const smaMax = smaVals.length ? Math.max(...smaVals) : 1;
  const smaPad = (smaMax - smaMin) * 0.18 || smaMax * 0.02 || 1;
  const smaMarkers: RangeMarker[] = [];
  if (s200 != null) smaMarkers.push({ value: s200, label: "200", tone: "amber" });
  if (s50 != null) smaMarkers.push({ value: s50, label: "50", tone: "fg" });
  if (currentPx != null) smaMarkers.push({ value: currentPx, label: "px", tone: d200 != null && d200 < 0 ? "down" : "up" });

  // Bollinger range bar (domain widens when price is outside the bands)
  let bbMin = 0, bbMax = 1;
  const bbMarkers: RangeMarker[] = [];
  if (bbOk) {
    const lo = Math.min(bbOk.lower, currentPx ?? bbOk.lower);
    const hi = Math.max(bbOk.upper, currentPx ?? bbOk.upper);
    const pad = (hi - lo) * 0.06 || 1;
    bbMin = lo - pad; bbMax = hi + pad;
    bbMarkers.push({ value: bbOk.lower, tone: "down", shape: "tri" });
    bbMarkers.push({ value: bbOk.upper, tone: "up", shape: "tri" });
    bbMarkers.push({ value: bbOk.middle, label: "mid", tone: "amber" });
    if (currentPx != null) bbMarkers.push({ value: currentPx, label: "px", tone: "fg" });
  }
  const bwSeries = (bbData?.entries ?? []).slice(0, 30).reverse()
    .map((e) => (e.middle ? ((e.upper - e.lower) / e.middle) * 100 : NaN))
    .filter((v) => Number.isFinite(v));
  const bwState = bandwidth != null && bwSeries.length >= 10
    ? bandwidth <= Math.min(...bwSeries) * 1.05 ? "squeeze"
      : bandwidth >= Math.max(...bwSeries) * 0.95 ? "expansion" : null
    : null;

  return (
    <div ref={ref} className="space-y-4">
      {/* ── REGIME strip ── */}
      <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
        <motion.div
          className={cn("relative border px-3 py-2.5 flex flex-col justify-between gap-2 min-w-0", regime.box)}
          initial={anim ? { opacity: 0, x: -8 } : false}
          animate={go ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
          transition={{ duration: 0.45, delay: 0.1, ease: EASE }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="hud-label">Regime</span>
            <span className="flex items-center gap-1.5 hud-tag">
              {ambient && settled && sufficient
                ? <span className="live-dot" aria-hidden />
                : <span
                    className={cn(
                      "inline-block w-[6px] h-[6px] rounded-full",
                      !settled ? "bg-amber" : sufficient ? "bg-hit" : "bg-dim",
                    )}
                    aria-hidden
                  />}
              {!settled ? "sampling" : sufficient ? "set" : "partial"}
            </span>
          </div>
          {/* No AnimatePresence "wait" here: the final label must mount on a
              timer, never on an exit animation finishing (rAF can be paused). */}
          <div className="h-6 flex items-center min-w-0" aria-live="polite">
            {settled ? (
              <motion.span
                key={regime.label}
                className={cn(
                  "font-semibold uppercase truncate",
                  sufficient ? "text-[12.5px] tracking-[.16em]" : "text-[11px] tracking-[.1em]",
                  regime.tone, regime.glow,
                )}
                initial={anim ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                {regime.label}
              </motion.span>
            ) : (
              <span className="text-[12px] text-muted-foreground tracking-[.14em]">reading···</span>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2 tabular-nums min-w-0">
            <span className="hud-tag truncate">
              {sufficient && regime.word
                ? `momentum: ${regime.word} ${Math.max(pos, neg)}/${nAvail}`
                : `${nAvail}/${nTotal} signals`}
            </span>
            <span className="text-[11px] shrink-0" title="Net tilt: (positive − negative) / available signals">
              <CountUp
                value={tilt}
                format={(v) => `${v > 0.5 ? "+" : ""}${Math.round(v)}`}
                duration={1200}
                className={cn(tilt == null ? "text-dim" : tilt > 0 ? "text-up" : tilt < 0 ? "text-down" : "text-amber")}
              />
            </span>
          </div>
          {/* settle flash (one-shot) */}
          {anim && settled && regime.flash && (
            <motion.span
              aria-hidden
              className={cn("absolute inset-[-1px] border pointer-events-none", regime.flash)}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1.3, ease: "easeOut" }}
            />
          )}
        </motion.div>

        <div className="min-w-0 flex flex-col gap-2">
          <div className="grid grid-cols-3 xl:grid-cols-6 gap-1.5" role="group" aria-label="Technical signal tiles">
            {signals.map((s, i) => {
              const active = shownId === s.id;
              return (
                <motion.button
                  key={s.id}
                  type="button"
                  aria-label={`${s.short}: ${leanWord(s.lean)}. ${s.detail}`}
                  aria-pressed={pinnedSig === s.id}
                  title={s.detail}
                  onMouseEnter={() => setHoverSig(s.id)}
                  onMouseLeave={() => setHoverSig(null)}
                  onFocus={() => setHoverSig(s.id)}
                  onBlur={() => setHoverSig(null)}
                  onClick={() => setPinnedSig((p) => (p === s.id ? null : s.id))}
                  initial={anim ? { opacity: 0, scale: 0.6 } : false}
                  animate={go
                    ? { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: 0.25 + i * 0.09 } }
                    : { opacity: 0, scale: 0.6 }}
                  whileHover={anim ? { y: -2, transition: { duration: 0.15 } } : undefined}
                  className={cn(
                    "relative h-12 min-w-0 border flex flex-col items-center justify-center gap-0.5 px-1 transition-colors",
                    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1",
                    leanTile(s.lean),
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={`tech-tile-hl-${hlId}`}
                      className="absolute inset-[-1px] border border-primary box-glow-teal pointer-events-none"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      aria-hidden
                    />
                  )}
                  <span className="text-[9px] tracking-[.12em] uppercase text-muted-foreground truncate max-w-full">{s.short}</span>
                  <span className={cn("text-[11px] tabular-nums uppercase tracking-[.08em]", leanText(s.lean))}>
                    {leanGlyph(s.lean)} {leanWord(s.lean)}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* split bar: positive | neutral | negative */}
          <div className="flex h-[5px] w-full bg-muted/60 overflow-hidden" aria-hidden>
            {[
              { w: nAvail ? (pos / nAvail) * 100 : 0, cls: "bg-up" },
              { w: nAvail ? (flat / nAvail) * 100 : 0, cls: "bg-amber/70" },
              { w: nAvail ? (neg / nAvail) * 100 : 0, cls: "bg-down" },
            ].map((seg, i) => (
              <motion.div
                key={i}
                className={seg.cls}
                initial={anim ? { width: "0%" } : false}
                animate={{ width: go ? `${seg.w}%` : "0%" }}
                transition={{ duration: 0.9, delay: 0.8 + i * 0.1, ease: EASE }}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground min-w-0 h-4">
            <span className="text-primary shrink-0">{">"}</span>
            <motion.span
              key={readout}
              className={cn("truncate", ambient && !shown && "cursor-block")}
              initial={anim ? { opacity: 0, x: -4 } : false}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              {readout}
            </motion.span>
          </div>
        </div>
      </div>

      <div className="hud-divider" aria-hidden />

      {/* ── RSI + MACD ── */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Block title="RSI" params="14 · daily" sectionId="rsi" highlight={hlSection === "rsi"} delay={0.2} go={go}>
          {rsiError ? (
            <ErrRow msg="RSI unavailable — retrying…" />
          ) : rsiVal != null ? (
            <RsiGauge value={rsiVal} go={go} />
          ) : (
            <EmptyRow msg="No RSI data" />
          )}

          {!rsiError && rsiChart.length > 1 && <RsiTrace data={rsiChart} go={go} />}
        </Block>

        <Block
          title="MACD"
          params="12/26/9"
          sectionId="macd"
          highlight={hlSection === "macd"}
          delay={0.3}
          go={go}
          right={macdLatest && crossAgo != null ? (
            <span className="hud-tag tabular-nums" title="Bars since the MACD line last crossed its signal line">
              cross {macdLatest.histogram >= 0 ? "▲" : "▼"} {crossAgo === 0 ? "latest bar" : `${crossAgo} bars ago`}
            </span>
          ) : undefined}
        >
          {macdError ? (
            <ErrRow msg="MACD unavailable — retrying…" />
          ) : macdLatest ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { k: "MACD", v: macdLatest.macd, tone: macdLatest.macd > 0 ? "text-up" : "text-down" },
                  { k: "Signal", v: macdLatest.signal, tone: "text-amber" },
                  { k: "Hist", v: macdLatest.histogram, tone: macdLatest.histogram > 0 ? "text-up" : "text-down" },
                ] as const).map((c) => (
                  <div key={c.k} className="min-w-0">
                    <div className="hud-tag mb-0.5">{c.k}</div>
                    <div className={cn("text-sm font-semibold truncate", c.tone)}>
                      <CountUp value={c.v} format={(n) => signed(n)} duration={900} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Interpretation only renders inside the macdLatest branch, i.e. when
                  MACD, signal and histogram are all finite numbers. */}
              <div className={cn(
                "mt-2 text-[10.5px] tracking-[.06em] flex items-center gap-1.5 min-w-0",
                macdLatest.histogram >= 0 ? "text-up" : "text-down",
              )}>
                <span aria-hidden>{macdLatest.histogram >= 0 ? "▲" : "▼"}</span>
                <span className="uppercase truncate">
                  macd {macdLatest.histogram >= 0 ? "above" : "below"} signal · momentum {macdLatest.histogram >= 0 ? "positive" : "negative"}
                </span>
              </div>

              {macdChart.length > 1 && <MacdHistogram data={macdChart} go={go} />}
            </>
          ) : (
            <EmptyRow msg="No MACD data" />
          )}
        </Block>
      </div>

      {/* ── SMA + Bollinger ── */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Block title="Moving Averages" params="sma 50 / 200" sectionId="sma" highlight={hlSection === "sma"} delay={0.4} go={go}>
          {s50 == null && s200 == null ? (
            <EmptyRow msg="No moving-average data" />
          ) : (
          <>
          <div className="divide-y divide-border/40">
            {([
              { k: "SMA 50", v: s50, d: d50 },
              { k: "SMA 200", v: s200, d: d200 },
            ] as const).map((r) => (
              <div key={r.k} className="flex items-center justify-between gap-2 py-1.5">
                <span className="hud-label">{r.k}</span>
                <div className="flex items-center gap-3 min-w-0">
                  <CountUp
                    value={r.v}
                    format={(n) => `$${fmtNum(n, 2)}`}
                    duration={900}
                    className="text-xs font-medium"
                  />
                  <span className="text-[10.5px] w-[76px] text-right" title={`Price distance from ${r.k}`}>
                    <Delta pct={r.d} />
                  </span>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 py-1.5">
              <span className="hud-label">50 vs 200</span>
              <span className="text-[10.5px]" title="SMA 50 distance from SMA 200"><Delta pct={spread} glow={false} /></span>
            </div>
          </div>

          {(s50 != null || s200 != null) && (
            <div className="mt-2">
              {go
                ? <RangeBar min={smaMin - smaPad} max={smaMax + smaPad} markers={smaMarkers} track="none" />
                : <div className="h-[26px]" />}
            </div>
          )}

          {smaCross && (
            <motion.div
              className={cn(
                "mt-2 text-[10.5px] uppercase tracking-[.08em] px-2 py-1.5 border flex items-center gap-1.5",
                smaCross === "bullish" ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down",
              )}
              initial={anim ? { opacity: 0, y: 6 } : false}
              animate={go ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.4, delay: 0.9 }}
            >
              <span aria-hidden>{smaCross === "bullish" ? "▲" : "▼"}</span>
              <span className="truncate">
                {smaCross === "bullish"
                  ? "50 > 200 · golden-cross regime"
                  : "50 < 200 · death-cross regime"}
              </span>
            </motion.div>
          )}
          </>
          )}
        </Block>

        <Block
          title="Bollinger"
          params="20 · 2σ"
          sectionId="bb"
          highlight={hlSection === "bb"}
          delay={0.5}
          go={go}
          right={bwState ? (
            <span className="hud-tag text-amber border border-amber/40 px-1.5 py-0.5" title="Band width vs its 30-day range">
              {bwState}
            </span>
          ) : undefined}
        >
          {bbError ? (
            <ErrRow msg="Bollinger Bands unavailable — retrying…" />
          ) : bbOk ? (
            <>
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="hud-tag mb-0.5">%B position</div>
                  <CountUp
                    value={pctB}
                    format={(n) => n.toFixed(0)}
                    duration={1000}
                    className={cn(
                      "text-xl font-semibold leading-none",
                      pctB == null ? "text-dim" : pctB >= 100 ? "text-down glow-red" : pctB <= 0 ? "text-up glow-teal" : "text-foreground",
                    )}
                  />
                </div>
                <div className="flex flex-col items-end gap-0.5 min-w-0">
                  <span className="hud-tag tabular-nums">bandwidth {fmt(bandwidth, 1)}%</span>
                  {go && bwSeries.length > 1 && (
                    <Sparkline data={bwSeries} width={96} height={22} tone="amber" area dot={false} />
                  )}
                </div>
              </div>

              <div className="mt-2">
                {go
                  ? <RangeBar min={bbMin} max={bbMax} markers={bbMarkers} track="rg" />
                  : <div className="h-[26px]" />}
              </div>

              <div className="grid grid-cols-3 gap-2 mt-2 tabular-nums">
                {([
                  { k: "Lower", v: bbOk.lower, tone: "text-down" },
                  { k: "Mid · sma20", v: bbOk.middle, tone: "text-amber" },
                  { k: "Upper", v: bbOk.upper, tone: "text-up" },
                ] as const).map((c, i) => (
                  <div key={c.k} className={cn("min-w-0", i === 1 && "text-center", i === 2 && "text-right")}>
                    <div className="hud-tag truncate">{c.k}</div>
                    <div className={cn("text-xs font-medium truncate", c.tone)}>{fmtPrice(c.v)}</div>
                  </div>
                ))}
              </div>

              {bbSignal && (
                <div className={cn(
                  "mt-2 text-[10.5px] uppercase tracking-[.08em] px-2 py-1.5 border flex items-center gap-1.5",
                  bbSignal === "overbought" ? "border-down/40 bg-down/10 text-down"
                  : bbSignal === "oversold" ? "border-up/40 bg-up/10 text-up"
                  : "border-border bg-muted/40 text-muted-foreground",
                )}>
                  {bbSignal === "overbought" && <><span aria-hidden>▲</span> <span className="truncate">price at upper band · stretched vs 20d mean</span></>}
                  {bbSignal === "oversold"   && <><span aria-hidden>▼</span> <span className="truncate">price at lower band · stretched vs 20d mean</span></>}
                  {bbSignal === "neutral"    && <><span aria-hidden>◆</span> <span className="truncate">price within bands</span></>}
                </div>
              )}
            </>
          ) : (
            <EmptyRow msg="No Bollinger data" />
          )}
        </Block>
      </div>

      <div className="hud-tag normal-case tracking-normal text-dim">
        Derived from daily closes. Describes recent price behavior · analysis, not a recommendation.
      </div>
    </div>
  );
}
