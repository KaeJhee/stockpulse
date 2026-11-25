import { useFmpIncome, useFmpRatios, useFmpProfile } from "@/lib/hooks";
import { getFmpKey } from "@/lib/apiKeys";
import { cn } from "@/lib/utils";
import {
  Children, isValidElement, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  BarChart2, KeyRound, ExternalLink, Users, Globe, Briefcase,
} from "lucide-react";
import {
  Panel, CountUp, Delta, Decode, RangeBar, Segmented, useAnimate, useAmbient,
} from "@/components/hud";

interface Props { ticker: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtLarge(val: number | null | undefined, digits = 2): string {
  if (val == null || !Number.isFinite(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(digits)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(digits)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(digits)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Ratio (0.253) → "+25.3%" */
function fmtPct(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  const v = val * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

/** Ratio (0.253) → "25.3%" (unsigned) */
function fmtPctPlain(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

function fmtMultiple(val: number | null | undefined, suffix = "x"): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return `${val.toFixed(1)}${suffix}`;
}

function fmtNum(val: number | null | undefined, decimals = 2): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val.toFixed(decimals);
}

function fmtEmployees(val: string | number | null | undefined): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseInt(val.replace(/,/g, "")) : val;
  if (isNaN(n)) return String(val);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function yoy(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}

type Tone = "up" | "down" | "amber" | "fg";
const toneText: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  amber: "text-amber",
  fg: "text-foreground",
};

function signTone(v: number | null | undefined, upAbove = 0): Tone {
  if (v == null || !Number.isFinite(v)) return "fg";
  if (v < 0) return "down";
  if (v > upAbove) return "up";
  return "fg";
}

// ── Entrance motion (CSS, so content never depends on rAF to become visible) ──

/** Local keyframes for one-shot reveals. html[data-motion="off"] zeroes their duration globally. */
const FUND_KEYFRAMES = `
@keyframes fund-grow-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes fund-grow-y { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes fund-reveal { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes fund-pop { from { opacity: 0; transform: rotate(45deg) scale(0); } to { opacity: 1; transform: rotate(45deg) scale(1); } }
`;
const EASE = "cubic-bezier(.2,.8,.2,1)";

function anim(name: string, durMs: number, delayMs: number): CSSProperties {
  return { animation: `${name} ${durMs}ms ${EASE} ${delayMs}ms both` };
}

/** Grid/flex container whose element children fade up one after another. */
function Stagger({ children, className, step = 45, base = 50 }: { children: ReactNode; className?: string; step?: number; base?: number }) {
  const animate = useAnimate();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <div className={className}>
      {items.map((el, i) => (
        <div
          key={el.key ?? i}
          className={cn("relative min-w-0 hover:z-10 focus-within:z-10", animate && "animate-fade-up")}
          style={animate ? { animationDelay: `${base + i * step}ms` } : undefined}
        >
          {el}
        </div>
      ))}
    </div>
  );
}

// ── Section header ───────────────────────────────────────────────────────────

function SectionHead({ title, source }: { title: string; source?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="w-[5px] h-[5px] rotate-45 bg-up/70 shrink-0" />
        <div className="hud-label truncate">{title}</div>
      </div>
      {source && <span className="hud-tag shrink-0">{source}</span>}
    </div>
  );
}

// ── Stat tile (CountUp value, optional meter + hover hint) ───────────────────

function Stat({
  label, value, format, tone = "fg", sub, hint, meter, glyph, big,
}: {
  label: string;
  value: number | null | undefined;
  format: (n: number) => string;
  tone?: Tone;
  sub?: ReactNode;
  hint?: string;
  /** 10-segment meter: position of value on 0..max */
  meter?: { max: number };
  /** Prefix ▲/▼ glyph based on the sign of value. */
  glyph?: boolean;
  big?: boolean;
}) {
  const hintId = useId();
  const animate = useAnimate();
  const v = num(value);
  const filled = meter && v != null ? Math.round(Math.max(0, Math.min(1, v / meter.max)) * 10) : 0;
  const glowCls = !big ? "" : tone === "up" ? "glow-teal" : tone === "down" ? "glow-red" : tone === "amber" ? "glow-amber" : "";
  return (
    <div
      tabIndex={hint ? 0 : undefined}
      aria-describedby={hint ? hintId : undefined}
      className={cn(
        "group relative h-full min-w-0 border border-card-border bg-background/40 px-3 py-2.5 hover:z-10 focus-visible:z-10",
        "transition-[border-color,box-shadow,background-color] duration-200",
        "hover:border-up/50 hover:bg-up/[0.04] hover:box-glow-teal",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2",
      )}
    >
      <div className="hud-label truncate">{label}</div>
      <div className={cn("mt-1 font-semibold tabular-nums leading-none truncate", big ? "text-xl" : "text-sm sm:text-base", toneText[tone], glowCls)}>
        {glyph && v != null && v !== 0 && (
          <span aria-hidden className="text-[0.6em] mr-1 align-middle">{v > 0 ? "▲" : "▼"}</span>
        )}
        <CountUp value={v} format={format} duration={850} />
      </div>
      {sub && <div className="mt-1 hud-tag truncate">{sub}</div>}
      {meter && (
        <div className="mt-2 flex gap-[2px]" aria-hidden>
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-[3px] flex-1",
                i < filled ? "bg-up/75" : "bg-muted",
                i < filled && animate && "animate-fade-up",
              )}
              style={i < filled && animate ? { animationDelay: `${300 + i * 45}ms` } : undefined}
            />
          ))}
        </div>
      )}
      {hint && (
        <span
          id={hintId}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full mb-1 z-20",
            "border border-popover-border bg-popover px-2 py-1.5 text-[10px] leading-snug text-popover-foreground normal-case tracking-normal",
            "opacity-0 translate-y-1 transition-all duration-150",
            "group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0",
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

// ── Margin bars (gross / operating / net) ────────────────────────────────────

function MarginBars({ rows }: { rows: { label: string; value: number | null; ref: number; refLabel: string }[] }) {
  const animate = useAnimate();
  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const v = r.value;
        const w = v == null ? 0 : Math.max(0, Math.min(1, Math.abs(v))) * 100;
        const neg = v != null && v < 0;
        const tone = v == null ? "fg" : neg ? "down" : v > r.ref ? "up" : "fg";
        return (
          <div key={r.label} className="group" title={`${r.label}: ${fmtPct(v)} · amber tick = ${r.refLabel} reference`}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="hud-label group-hover:text-foreground transition-colors">{r.label}</span>
              <span className={cn("text-xs font-semibold tabular-nums", toneText[tone])}>
                {v != null && v !== 0 && <span aria-hidden className="text-[0.7em] mr-1">{neg ? "▼" : "▲"}</span>}
                <CountUp value={v} format={(n) => fmtPct(n)} duration={900} />
              </span>
            </div>
            <div className="relative h-[6px] bg-muted overflow-hidden">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 origin-left",
                  neg ? "bg-down/85" : "bg-up/80",
                  "group-hover:brightness-125 transition-[width,filter] duration-700",
                )}
                style={{ width: `${w}%`, ...(animate ? anim("fund-grow-x", 900, 150 + i * 120) : {}) }}
              />
              {/* reference tick */}
              <span
                aria-hidden
                className="absolute inset-y-0 w-[2px] bg-amber"
                style={{ left: `${Math.min(99, r.ref * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 100-tile "per $100 of revenue" grid ──────────────────────────────────────

type SegKey = "net" | "other" | "opex" | "cogs";
const SEGS: { key: SegKey; label: string; long: string; tile: string; dot: string }[] = [
  { key: "net",   label: "NET",   long: "Net income",              tile: "bg-up box-glow-teal", dot: "bg-up" },
  { key: "other", label: "OTHER", long: "Interest, tax and other", tile: "bg-amber/75",          dot: "bg-amber/75" },
  { key: "opex",  label: "OPEX",  long: "Operating expenses",      tile: "bg-up/30",             dot: "bg-up/30" },
  { key: "cogs",  label: "COGS",  long: "Cost of revenue",         tile: "bg-muted-foreground/25", dot: "bg-muted-foreground/25" },
];

function RevenueGrid({ gross, op, net }: { gross: number; op: number; net: number }) {
  const animate = useAnimate();
  const [hl, setHl] = useState<SegKey | null>(null);
  const [locked, setLocked] = useState<SegKey | null>(null);
  const active = hl ?? locked;

  const g = Math.round(gross * 100);
  const o = Math.round(op * 100);
  const n = Math.round(net * 100);
  const counts: Record<SegKey, number> = { net: n, other: o - n, opex: g - o, cogs: 100 - g };
  const tiles: SegKey[] = [];
  (["net", "other", "opex", "cogs"] as SegKey[]).forEach((k) => {
    for (let i = 0; i < counts[k]; i++) tiles.push(k);
  });

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div
        className="grid grid-cols-10 gap-[2px] w-[150px] sm:w-[160px]"
        role="img"
        aria-label={`Of every $100 of revenue: cost of revenue $${counts.cogs}, operating expenses $${counts.opex}, interest tax and other $${counts.other}, net income $${counts.net}`}
      >
        {tiles.map((k, i) => {
          const seg = SEGS.find((s) => s.key === k)!;
          // Entrance animation on the outer cell, highlight dimming on the inner one:
          // a finished `fill-mode: both` animation would otherwise pin opacity at 1.
          return (
            <span
              key={i}
              className={cn("block aspect-square", animate && "animate-fade-up")}
              style={animate ? { animationDelay: `${i * 9}ms` } : undefined}
            >
              <span
                className={cn(
                  "block w-full h-full transition-opacity duration-200",
                  seg.tile,
                  active && active !== k && "opacity-20",
                )}
              />
            </span>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-1 w-[150px] sm:w-[160px]">
        {SEGS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={locked === s.key}
            aria-label={`Highlight ${s.long}: $${counts[s.key]} of every $100 revenue`}
            onMouseEnter={() => setHl(s.key)}
            onMouseLeave={() => setHl(null)}
            onFocus={() => setHl(s.key)}
            onBlur={() => setHl(null)}
            onClick={() => setLocked((p) => (p === s.key ? null : s.key))}
            className={cn(
              "flex items-center gap-1.5 px-1 py-0.5 border text-left transition-colors",
              "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary",
              active === s.key ? "border-up/50 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden className={cn("w-2 h-2 shrink-0", s.dot)} />
            <span className="text-[9.5px] tracking-[.08em]">{s.label}</span>
            <span className="ml-auto text-[10px] tabular-nums">${counts[s.key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── No-key state ─────────────────────────────────────────────────────────────

function NoKey() {
  const ambient = useAmbient();
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
      <div className="relative w-12 h-12 grid place-items-center border border-amber/50 bg-amber/10 box-glow-amber">
        {ambient && <span aria-hidden className="absolute inset-0 border border-amber/50 animate-ring-expand" />}
        <KeyRound className="w-5 h-5 text-amber" aria-hidden />
      </div>
      <div className="space-y-1.5">
        <p className="hud-title text-amber glow-amber">FMP key needed</p>
        <p className="font-read text-xs text-muted-foreground max-w-xs mx-auto">
          Open Settings and enter your Financial Modeling Prep key to see fundamentals.
        </p>
      </div>
      <a
        href="https://site.financialmodelingprep.com/register"
        target="_blank"
        rel="noopener noreferrer"
        className="hud-btn"
        aria-label="Get a free Financial Modeling Prep key (opens in a new tab)"
      >
        Get a free key →
        <ExternalLink className="w-3 h-3" aria-hidden />
      </a>
      <div className={cn("hud-tag", ambient && "cursor-block")}>status: waiting for key</div>
    </div>
  );
}

// ── Loading state ────────────────────────────────────────────────────────────

function LoadingState({ ticker }: { ticker: string }) {
  // The shimmer is a looping effect: only run it when ambient motion is on.
  const sk = useAmbient() ? "skeleton-shimmer" : "bg-muted";
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="hud-tag">
        <span className="text-up">fmp</span> · sampling {ticker.toUpperCase()} ratios, statements, profile…
      </div>
      <div className={cn(sk, "h-7 w-full max-w-[320px]")} />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className={cn(sk, "h-[66px] w-full")} />)}
      </div>
      <div className={cn(sk, "h-36 w-full")} />
    </div>
  );
}

/** Header status dot: pings only while waiting/sampling and only with ambient motion; static otherwise. */
function StatusDot({ status }: { status: "waiting" | "sampling" | "set" }) {
  const ambient = useAmbient();
  if (ambient && status !== "set") {
    return <span aria-hidden className="live-dot" data-tone={status === "waiting" ? "amber" : undefined} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full shrink-0",
        status === "waiting" ? "bg-amber" : status === "sampling" ? "bg-hit" : "bg-up",
      )}
    />
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border border-dashed border-card-border px-3 py-6 justify-center hud-tag">
      <span className="live-dot" data-tone="dim" />
      {children}
    </div>
  );
}

// ── Revenue / income chart (custom, animated, keyboard + hover) ──────────────

interface IncomeRow {
  date?: string;
  revenue?: number | null;
  gross_profit?: number | null;
  gross_margin?: number | null;
  operating_income?: number | null;
  operating_margin?: number | null;
  net_income?: number | null;
  net_margin?: number | null;
  ebitda?: number | null;
  eps?: number | null;
  eps_diluted?: number | null;
}

type ChartMode = "bars" | "margins";

const MARGIN_LINES = [
  { key: "gm" as const, label: "GROSS", color: "hsl(var(--up))",    dot: "bg-up" },
  { key: "om" as const, label: "OPER",  color: "hsl(var(--amber))", dot: "bg-amber" },
  { key: "nm" as const, label: "NET",   color: "hsl(var(--hit))",   dot: "bg-hit" },
];

function IncomeChart({ data }: { data: IncomeRow[] }) {
  const animate = useAnimate();
  const hlId = useId();
  const [mode, setMode] = useState<ChartMode>("bars");

  const rows = useMemo(() => {
    const asc = [...data].reverse();
    return asc.map((r, i) => {
      const prev = i > 0 ? asc[i - 1] : undefined;
      return {
        year: r.date?.slice(0, 4) ?? "",
        revenue: num(r.revenue),
        ni: num(r.net_income),
        gm: num(r.gross_margin),
        om: num(r.operating_margin),
        nm: num(r.net_margin),
        revYoY: yoy(num(r.revenue), num(prev?.revenue)),
        niYoY: yoy(num(r.net_income), num(prev?.net_income)),
      };
    });
  }, [data]);

  const n = rows.length;
  const [sel, setSel] = useState(n - 1);
  const [hover, setHover] = useState<number | null>(null);
  const active = Math.min(n - 1, Math.max(0, hover ?? sel));
  const cur = rows[active];

  // Domain
  const { top, bottom, ticks, fmtTick } = useMemo(() => {
    if (mode === "bars") {
      const vals = rows.flatMap((r) => [r.revenue, r.ni]).filter((v): v is number => v != null);
      const hi = Math.max(0, ...vals);
      const lo = Math.min(0, ...vals);
      const t = hi === lo ? hi + 1 : hi;
      const tk = [t, t / 2, 0];
      if (lo < 0) tk.push(lo);
      return { top: t, bottom: lo, ticks: tk, fmtTick: (v: number) => fmtLarge(v, 0) };
    }
    const vals = rows.flatMap((r) => [r.gm, r.om, r.nm]).filter((v): v is number => v != null);
    const hi = Math.max(0.1, ...vals);
    const lo = Math.min(0, ...vals);
    const pad = (hi - lo) * 0.12;
    const t = hi + pad;
    const b = lo < 0 ? lo - pad : 0;
    const tk = [t, (t + b) / 2, 0];
    if (b < 0) tk.push(b);
    return { top: t, bottom: b, ticks: tk, fmtTick: (v: number) => `${(v * 100).toFixed(0)}%` };
  }, [rows, mode]);

  const range = top - bottom || 1;
  const yPct = (v: number) => ((top - v) / range) * 100; // % from top
  const zero = yPct(0);
  const xPct = (i: number) => ((i + 0.5) / n) * 100;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = Math.max(0, active - 1);
    else if (e.key === "ArrowRight") next = Math.min(n - 1, active + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next != null) {
      e.preventDefault();
      setHover(null);
      setSel(next);
    }
  };

  const bar = (v: number | null, cls: string, delay: number) => {
    if (v == null) return null;
    const h = (Math.abs(v) / range) * 100;
    const pos = v >= 0;
    const place: CSSProperties = pos ? { bottom: `${100 - zero}%`, height: `${h}%` } : { top: `${zero}%`, height: `${h}%` };
    return (
      <div
        className={cn("absolute inset-x-0", cls, pos ? "origin-bottom" : "origin-top")}
        style={{ ...place, ...(animate ? anim("fund-grow-y", 700, delay * 1000) : {}) }}
      />
    );
  };

  const linePath = (key: "gm" | "om" | "nm") => {
    let d = "";
    rows.forEach((r, i) => {
      const v = r[key];
      if (v == null) return;
      d += `${d ? "L" : "M"}${xPct(i).toFixed(2)},${yPct(v).toFixed(2)} `;
    });
    return d.trim();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 hud-tag">
          {mode === "bars" ? (
            <>
              <span className="flex items-center gap-1.5"><span aria-hidden className="w-2 h-2 bg-up/40 border-t-2 border-up" /> revenue</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="w-2 h-2 bg-amber/85" /> net income</span>
            </>
          ) : (
            MARGIN_LINES.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("w-2 h-[2px]", l.dot)} /> {l.label.toLowerCase()}
              </span>
            ))
          )}
        </div>
        <Segmented<ChartMode>
          aria-label="Chart view"
          value={mode}
          onChange={setMode}
          options={[
            { value: "bars", label: "Rev / NI", title: "Revenue vs net income" },
            { value: "margins", label: "Margins", title: "Gross, operating and net margin trend" },
          ]}
        />
      </div>

      <div className="flex">
        {/* Y axis */}
        <div className="relative w-12 shrink-0 h-40" aria-hidden>
          {ticks.map((t, i) => (
            <span
              key={`${mode}-${i}`}
              className="absolute right-2 -translate-y-1/2 text-[9px] text-dim tabular-nums whitespace-nowrap"
              style={{ top: `${yPct(t)}%` }}
            >
              {fmtTick(t)}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div
          role="group"
          tabIndex={0}
          aria-label={`${mode === "bars" ? "Revenue and net income" : "Margin trend"} by fiscal year. Use left and right arrow keys to step through years.`}
          onKeyDown={onKey}
          onMouseLeave={() => setHover(null)}
          className="relative flex-1 min-w-0 h-40 border-l border-b border-border/70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2"
        >
          {/* grid lines */}
          {ticks.map((t, i) => (
            <span
              key={`g-${mode}-${i}`}
              aria-hidden
              className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-up/35" : "bg-border/50")}
              style={{ top: `${yPct(t)}%` }}
            />
          ))}

          {/* columns */}
          <div className="absolute inset-0 flex">
            {rows.map((r, i) => (
              <div
                key={r.year + i}
                className="relative flex-1 h-full cursor-crosshair"
                onMouseEnter={() => setHover(i)}
                onClick={() => { setSel(i); setHover(null); }}
              >
                {i === active && (
                  <motion.div
                    layoutId={`fund-col-${hlId}`}
                    aria-hidden
                    className="absolute inset-0 bg-up/[0.06] border-x border-up/25"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
                {mode === "bars" && (
                  <div
                    className={cn(
                      "absolute inset-y-0 left-[20%] right-[20%] flex gap-[3px] transition-opacity duration-200",
                      i === active ? "opacity-100" : "opacity-60",
                    )}
                  >
                    <div className="relative flex-1 h-full">
                      {bar(r.revenue, cn("bg-up/35 border-t-2 border-up", i === active && "box-glow-teal"), 0.1 + i * 0.09)}
                    </div>
                    <div className="relative flex-1 h-full">
                      {bar(r.ni, r.ni != null && r.ni < 0 ? "bg-down/85" : "bg-amber/85", 0.18 + i * 0.09)}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* margin lines */}
          {mode === "margins" && (
            <>
              <div
                key="lines"
                className="absolute inset-0 pointer-events-none"
                style={animate ? anim("fund-reveal", 1100, 0) : undefined}
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible" aria-hidden>
                  {MARGIN_LINES.map((l) => (
                    <path
                      key={l.key}
                      d={linePath(l.key)}
                      fill="none"
                      vectorEffect="non-scaling-stroke"
                      style={{ stroke: l.color, strokeWidth: 1.75, filter: `drop-shadow(0 0 calc(4px * var(--glow-strength)) ${l.color})` }}
                    />
                  ))}
                </svg>
              </div>
              {MARGIN_LINES.map((l) =>
                rows.map((r, i) => {
                  const v = r[l.key];
                  if (v == null) return null;
                  return (
                    <span
                      key={`${l.key}-${i}`}
                      aria-hidden
                      className={cn("absolute pointer-events-none", l.dot)}
                      style={{
                        left: `${xPct(i)}%`,
                        top: `${yPct(v)}%`,
                        width: i === active ? 8 : 5,
                        height: i === active ? 8 : 5,
                        marginLeft: i === active ? -4 : -2.5,
                        marginTop: i === active ? -4 : -2.5,
                        transform: "rotate(45deg)",
                        ...(animate ? anim("fund-pop", 250, 200 + (i / Math.max(1, n)) * 900) : {}),
                      }}
                    />
                  );
                }),
              )}
            </>
          )}

          {/* hover tooltip: outer box positions, inner box fades in */}
          {hover != null && cur && (
            <div
              className="absolute top-1 z-10 pointer-events-none transition-[left] duration-150"
              style={{
                left: `${xPct(hover)}%`,
                transform: `translateX(${hover === 0 ? "-12%" : hover === n - 1 ? "-88%" : "-50%"})`,
              }}
            >
              <div
                className={cn(
                  "border border-popover-border bg-popover/95 px-2 py-1.5 text-[10px] leading-tight space-y-0.5 min-w-[118px]",
                  animate && "animate-fade-up",
                )}
              >
                <div className="hud-label text-foreground">FY{cur.year}</div>
                {mode === "bars" ? (
                  <>
                    <div className="flex justify-between gap-3"><span className="text-dim">REV</span><span className="tabular-nums text-up">{fmtLarge(cur.revenue, 1)}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-dim">NI</span><span className={cn("tabular-nums", cur.ni != null && cur.ni < 0 ? "text-down" : "text-amber")}>{fmtLarge(cur.ni, 1)}</span></div>
                  </>
                ) : (
                  MARGIN_LINES.map((l) => (
                    <div key={l.key} className="flex justify-between gap-3">
                      <span className="text-dim">{l.label}</span>
                      <span className="tabular-nums" style={{ color: l.color }}>{fmtPctPlain(cur[l.key])}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* X axis */}
      <div className="flex pl-12" aria-hidden>
        {rows.map((r, i) => (
          <button
            key={r.year + i}
            type="button"
            tabIndex={-1}
            onClick={() => { setSel(i); setHover(null); }}
            className={cn(
              "flex-1 text-center text-[10px] tabular-nums tracking-[.08em] py-0.5 transition-colors",
              i === active ? "text-up glow-teal" : "text-dim hover:text-foreground",
            )}
          >
            {r.year}
          </button>
        ))}
      </div>

      {/* Readout */}
      {cur && (
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[10.5px]"
        >
          <span className="hud-label text-foreground">FY{cur.year}</span>
          {mode === "bars" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="text-dim">REV</span>
                <span className="tabular-nums">{fmtLarge(cur.revenue)}</span>
                {cur.revYoY != null && <Delta pct={cur.revYoY * 100} className="text-[10px]" />}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-dim">NI</span>
                <span className="tabular-nums">{fmtLarge(cur.ni)}</span>
                {cur.niYoY != null && <Delta pct={cur.niYoY * 100} className="text-[10px]" />}
              </span>
            </>
          ) : (
            MARGIN_LINES.map((l) => (
              <span key={l.key} className="flex items-center gap-1.5">
                <span className="text-dim">{l.label}</span>
                <span className="tabular-nums" style={{ color: l.color }}>{fmtPctPlain(cur[l.key])}</span>
              </span>
            ))
          )}
          {cur.revYoY != null && mode === "bars" && <span className="hud-tag">yoy drift</span>}
        </div>
      )}
    </div>
  );
}

// ── Tab bar (sliding highlight, keeps testids) ───────────────────────────────

type Tab = "overview" | "income" | "profile";

function TabBar({ tab, setTab, tabs }: { tab: Tab; setTab: (t: Tab) => void; tabs: { key: Tab; label: string }[] }) {
  const lid = useId();
  // Per-instance refs (not a document-wide testid lookup, which would hit the wrong
  // panel if two FundamentalsPanels were ever mounted).
  const btnRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === tab);
    let next: Tab | null = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length].key;
    else if (e.key === "ArrowLeft") next = tabs[(i + tabs.length - 1) % tabs.length].key;
    else if (e.key === "Home") next = tabs[0].key;
    else if (e.key === "End") next = tabs[tabs.length - 1].key;
    if (next) {
      e.preventDefault();
      setTab(next);
      btnRefs.current[next]?.focus();
    }
  };
  return (
    <div
      role="tablist"
      aria-label="Fundamentals view"
      onKeyDown={onKey}
      className="flex items-stretch border border-card-border bg-background/60 p-[2px] gap-[2px] w-full sm:w-auto"
    >
      {tabs.map(({ key, label }, i) => {
        const on = tab === key;
        return (
          <button
            key={key}
            ref={(el) => { btnRefs.current[key] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => setTab(key)}
            className={cn(
              "relative flex-1 sm:flex-none h-7 px-3 text-[10.5px] uppercase tracking-[.12em] transition-colors",
              "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-1",
              on ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`tab-fundamentals-${key}`}
          >
            {on && (
              <motion.span
                layoutId={`fund-tab-${lid}`}
                className="absolute inset-0 bg-primary box-glow-teal"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">
              <span className={cn("mr-1.5 hidden sm:inline", on ? "opacity-70" : "text-dim")}>0{i + 1}</span>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function FundamentalsPanel({ ticker }: Props) {
  const hasFmpKey = !!getFmpKey();
  const [tab, setTab] = useState<Tab>("overview");
  const [aboutOpen, setAboutOpen] = useState(false);
  const animate = useAnimate();

  const { data: income,  isLoading: incLoading  } = useFmpIncome(ticker);
  const { data: ratios,  isLoading: ratLoading  } = useFmpRatios(ticker);
  const { data: profile, isLoading: profLoading } = useFmpProfile(ticker);

  const isLoading = incLoading || ratLoading || profLoading;
  const latest = income?.[0];
  const prior = income?.[1];

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Valuation" },
    { key: "income",   label: "Financials" },
    { key: "profile",  label: "Profile" },
  ];

  const status: "waiting" | "sampling" | "set" = !hasFmpKey ? "waiting" : isLoading ? "sampling" : "set";
  const revYoY = yoy(num(latest?.revenue), num(prior?.revenue));
  const niYoY = yoy(num(latest?.net_income), num(prior?.net_income));
  const ebitdaYoY = yoy(num(latest?.ebitda), num(prior?.ebitda));
  const epsYoY = yoy(num(latest?.eps_diluted), num(prior?.eps_diluted));

  const gm = num(ratios?.gross_margin);
  const om = num(ratios?.operating_margin);
  const nm = num(ratios?.net_margin);
  const gridOk = gm != null && om != null && nm != null && nm >= 0 && om >= nm && gm >= om && gm <= 1;

  const p = profile as Record<string, any> | undefined;
  const beta = num(p?.beta);
  const mcap = num(p?.market_cap);

  return (
    <Panel
      title="Fundamentals"
      tag="FMP · TTM"
      icon={<BarChart2 className="w-3.5 h-3.5 text-up" aria-hidden />}
      delay={0.1}
      className="h-full"
      actions={
        <span className="hud-tag flex items-center gap-1.5" aria-label={`Fundamentals status: ${status}`}>
          <StatusDot status={status} />
          {status}
        </span>
      }
      data-testid="fundamentals-panel"
    >
      <style>{FUND_KEYFRAMES}</style>
      {!hasFmpKey ? (
        <NoKey />
      ) : isLoading ? (
        <LoadingState ticker={ticker} />
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <TabBar tab={tab} setTab={setTab} tabs={TABS} />
            <span className="hud-tag hidden sm:inline">
              {p?.name ? <span className="text-muted-foreground">{p.name}</span> : ticker.toUpperCase()}
            </span>
          </div>

          {/* Keyed so each tab switch fades its content in (CSS, no exit wait: the new
              tab's DOM is present immediately even if rAF is throttled). */}
          <div
            key={tab}
            role="tabpanel"
            aria-label={TABS.find((t) => t.key === tab)?.label}
            className={cn(animate && "animate-fade-up")}
          >
              {/* OVERVIEW — Valuation ratios */}
              {tab === "overview" && (
                <div className="space-y-5">
                  <div>
                    <SectionHead title="Valuation Ratios (TTM)" source="multiples" />
                    <Stagger className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Stat label="P/E" value={ratios?.pe_ratio} format={(n) => fmtMultiple(n)} meter={{ max: 60 }}
                        hint="Price / earnings, trailing twelve months. Meter: position on a 0–60x scale." />
                      <Stat label="P/B" value={ratios?.pb_ratio} format={(n) => fmtMultiple(n)} meter={{ max: 20 }}
                        hint="Price / book value. Meter: position on a 0–20x scale." />
                      <Stat label="P/S" value={ratios?.ps_ratio} format={(n) => fmtMultiple(n)} meter={{ max: 20 }}
                        hint="Price / sales (revenue). Meter: position on a 0–20x scale." />
                      <Stat label="EV/EBITDA" value={ratios?.ev_ebitda} format={(n) => fmtMultiple(n)} meter={{ max: 40 }}
                        hint="Enterprise value / EBITDA. Meter: position on a 0–40x scale." />
                      <Stat label="Debt/Equity" value={ratios?.debt_equity} format={(n) => fmtMultiple(n)} meter={{ max: 3 }}
                        tone={(num(ratios?.debt_equity) ?? 0) > 2 ? "amber" : "fg"}
                        hint="Total debt / shareholder equity. Amber above 2.0x. Meter: 0–3x scale." />
                      <Stat label="Current Ratio" value={ratios?.current_ratio} format={(n) => fmtMultiple(n)} meter={{ max: 4 }}
                        tone={(num(ratios?.current_ratio) ?? 1) < 1 ? "amber" : "fg"}
                        hint="Current assets / current liabilities. Amber below 1.0x. Meter: 0–4x scale." />
                    </Stagger>
                  </div>

                  <div className="hud-divider" />

                  <div>
                    <SectionHead title="Returns (TTM)" source="on capital" />
                    <Stagger className="grid grid-cols-3 gap-2">
                      <Stat label="ROE" value={ratios?.roe} format={(n) => fmtPct(n)} tone={signTone(ratios?.roe)} glyph
                        hint="Return on equity: net income / shareholder equity." />
                      <Stat label="ROA" value={ratios?.roa} format={(n) => fmtPct(n)} tone={signTone(ratios?.roa)} glyph
                        hint="Return on assets: net income / total assets." />
                      <Stat label="ROIC" value={ratios?.roic} format={(n) => fmtPct(n)} tone={signTone(ratios?.roic)} glyph
                        hint="Return on invested capital." />
                    </Stagger>
                  </div>

                  <div className="hud-divider" />

                  <div>
                    <SectionHead title="Margins (TTM)" source={gridOk ? "per $100 revenue" : undefined} />
                    <div className={cn("grid gap-5", gridOk && "sm:grid-cols-[auto_1fr] sm:items-center")}>
                      {gridOk && <RevenueGrid gross={gm!} op={om!} net={nm!} />}
                      <MarginBars
                        rows={[
                          { label: "Gross Margin", value: gm, ref: 0.4,  refLabel: "40%" },
                          { label: "Op. Margin",   value: om, ref: 0.15, refLabel: "15%" },
                          { label: "Net Margin",   value: nm, ref: 0.1,  refLabel: "10%" },
                        ]}
                      />
                    </div>
                  </div>

                  {(ratios?.dividend_yield != null && ratios.dividend_yield > 0) && (
                    <>
                      <div className="hud-divider" />
                      <div>
                        <SectionHead title="Dividends" source="ttm" />
                        <Stagger className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <Stat label="Dividend Yield" value={ratios?.dividend_yield} format={(n) => fmtPct(n)} tone="up" />
                          <Stat label="Payout Ratio" value={ratios?.payout_ratio} format={(n) => fmtPctPlain(n)}
                            tone={(num(ratios?.payout_ratio) ?? 0) > 1 ? "amber" : "fg"}
                            hint="Share of earnings paid as dividends. Amber above 100%." />
                          <Stat label="FCF / Share" value={ratios?.free_cash_flow}
                            format={(n) => (fmtNum(n) !== "—" ? `$${fmtNum(n)}` : "—")} />
                        </Stagger>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* INCOME — Revenue/Income over time */}
              {tab === "income" && (
                income && income.length > 0 ? (
                  <div className="space-y-5">
                    {/* Headline */}
                    <div>
                      <SectionHead
                        title={`Most Recent Annual (${latest?.date?.slice(0, 4) ?? ""})`}
                        source={prior ? `yoy vs ${prior.date?.slice(0, 4) ?? "prior"}` : "annual"}
                      />
                      <Stagger className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="h-full border border-up/30 bg-up/[0.04] px-3 py-3 hover:box-glow-teal transition-shadow">
                          <div className="hud-label">Revenue</div>
                          <div className="mt-1 text-2xl font-semibold text-foreground glow-teal leading-none">
                            <CountUp value={num(latest?.revenue)} format={(n) => fmtLarge(n)} duration={1000} />
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <Delta pct={revYoY == null ? null : revYoY * 100} />
                            <span className="hud-tag">yoy</span>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "h-full border px-3 py-3 transition-shadow",
                            (num(latest?.net_income) ?? 0) < 0
                              ? "border-down/35 bg-down/[0.04] hover:box-glow-red"
                              : "border-amber/35 bg-amber/[0.04] hover:box-glow-amber",
                          )}
                        >
                          <div className="hud-label">Net Income</div>
                          <div
                            className={cn(
                              "mt-1 text-2xl font-semibold leading-none",
                              (num(latest?.net_income) ?? 0) < 0 ? "text-down glow-red" : "text-amber glow-amber",
                            )}
                          >
                            <CountUp value={num(latest?.net_income)} format={(n) => fmtLarge(n)} duration={1000} />
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                            <Delta pct={niYoY == null ? null : niYoY * 100} />
                            <span className="hud-tag">yoy · {fmtPct(latest?.net_margin)} margin</span>
                          </div>
                        </div>
                      </Stagger>
                    </div>

                    <Stagger className="grid grid-cols-2 gap-2">
                      <Stat label="Gross Profit" value={latest?.gross_profit} format={(n) => fmtLarge(n)}
                        sub={fmtPct(latest?.gross_margin) + " margin"} />
                      <Stat label="Operating Income" value={latest?.operating_income} format={(n) => fmtLarge(n)}
                        sub={fmtPct(latest?.operating_margin) + " margin"}
                        tone={signTone(latest?.operating_income)} glyph />
                      <Stat label="EBITDA" value={latest?.ebitda} format={(n) => fmtLarge(n)}
                        sub={ebitdaYoY == null ? undefined : `${ebitdaYoY > 0 ? "▲" : ebitdaYoY < 0 ? "▼" : ""} ${fmtPct(ebitdaYoY)} yoy`} />
                      <Stat label="EPS (Diluted)" value={latest?.eps_diluted} format={(n) => `$${fmtNum(n)}`}
                        sub={epsYoY == null ? undefined : `${epsYoY > 0 ? "▲" : epsYoY < 0 ? "▼" : ""} ${fmtPct(epsYoY)} yoy`} />
                    </Stagger>

                    {/* 4-year chart */}
                    {income.length >= 2 && (
                      <>
                        <div className="hud-divider" />
                        <div>
                          <SectionHead title="Revenue vs. Net Income (Annual)" source={`${income.length} fy`} />
                          <IncomeChart key={ticker} data={income as IncomeRow[]} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <EmptyNote>no annual statements returned for {ticker.toUpperCase()}</EmptyNote>
                )
              )}

              {/* PROFILE */}
              {tab === "profile" && (
                profile && p ? (
                  <div className="space-y-4 text-xs">
                    {(p.name || mcap != null) && (
                      <div className="flex items-end justify-between gap-3 flex-wrap">
                        {p.name && (
                          <div className="min-w-0">
                            <div className="hud-label">Company</div>
                            <Decode text={String(p.name)} className="block mt-1 text-sm font-semibold tracking-[.06em] text-foreground truncate" />
                          </div>
                        )}
                        {mcap != null && (
                          <div className="text-right">
                            <div className="hud-label">Market Cap</div>
                            <div className="mt-1 text-lg font-semibold text-up glow-teal leading-none">
                              <CountUp value={mcap} format={(n) => fmtLarge(n)} duration={1000} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Identifiers */}
                    <Stagger className="grid grid-cols-2 gap-2">
                      {p.sector   && <IdTile label="Sector"   value={p.sector} />}
                      {p.industry && <IdTile label="Industry" value={p.industry} />}
                      {p.exchange && <IdTile label="Exchange" value={p.exchange} />}
                      {p.country  && <IdTile label="Country"  value={p.country} />}
                      {p.ipo_date && <IdTile label="IPO Date" value={p.ipo_date} />}
                      {p.beta     && <IdTile label="Beta"     value={fmtNum(beta)} />}
                    </Stagger>

                    {beta != null && (
                      <div className="border border-card-border bg-background/40 px-3 pt-2 pb-1.5">
                        <div className="flex items-center justify-between">
                          <span className="hud-label">Beta vs market</span>
                          <span className="hud-tag">▲ market = 1.0</span>
                        </div>
                        <RangeBar
                          min={0}
                          max={3}
                          track="teal"
                          minLabel="0.0 · less sensitive"
                          maxLabel="3.0 · more sensitive"
                          markers={[
                            { value: 1, tone: "fg", shape: "tri" },
                            { value: Math.max(0, Math.min(3, beta)), label: `β ${beta.toFixed(2)}`, tone: "amber", shape: "pin" },
                          ]}
                        />
                      </div>
                    )}

                    {/* CEO + Employees */}
                    {(p.ceo || p.employees) && (
                      <div className="flex flex-wrap gap-2">
                        {p.ceo && (
                          <span className="hud-chip normal-case tracking-normal h-auto py-1 max-w-full min-w-0">
                            <Briefcase className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="hud-tag">CEO</span>
                            <span className="text-foreground truncate min-w-0">{p.ceo}</span>
                          </span>
                        )}
                        {p.employees && (
                          <span className="hud-chip h-auto py-1">
                            <Users className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            <span className="text-foreground tabular-nums">{fmtEmployees(p.employees)}</span>
                            <span className="hud-tag">employees</span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    {p.description && (
                      <div className="pt-3 border-t border-border/60">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="hud-label">About</div>
                          <button
                            type="button"
                            onClick={() => setAboutOpen((o) => !o)}
                            aria-expanded={aboutOpen}
                            aria-label={aboutOpen ? "Collapse company description" : "Expand company description"}
                            className="hud-tag hover:text-up transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                          >
                            {aboutOpen ? "[ less ]" : "[ more ]"}
                          </button>
                        </div>
                        <p
                          className={cn(
                            "font-read text-[12.5px] text-muted-foreground leading-relaxed",
                            !aboutOpen && "line-clamp-5",
                          )}
                        >
                          {p.description}
                        </p>
                      </div>
                    )}

                    {/* Website */}
                    {p.website && (
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hud-btn normal-case tracking-normal max-w-full"
                        aria-label={`Company website ${String(p.website).replace(/^https?:\/\//, "")} (opens in a new tab)`}
                      >
                        <Globe className="w-3 h-3 shrink-0" aria-hidden />
                        <span className="truncate min-w-0">{String(p.website).replace(/^https?:\/\//, "")}</span>
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden />
                      </a>
                    )}
                  </div>
                ) : (
                  <EmptyNote>no profile returned for {ticker.toUpperCase()}</EmptyNote>
                )
              )}
          </div>

          <div className="mt-4 pt-2 border-t border-border/50 hud-tag flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span>src: financial modeling prep</span>
            <span>ttm ratios · annual statements · data only</span>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Profile identifier tile ──────────────────────────────────────────────────

function IdTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="h-full min-w-0 border border-card-border bg-background/40 px-3 py-2 transition-[border-color,box-shadow] duration-200 hover:border-up/50 hover:box-glow-teal"
    >
      <div className="hud-label">{label}</div>
      <div className="mt-0.5 text-[12px] text-foreground truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
    </div>
  );
}
