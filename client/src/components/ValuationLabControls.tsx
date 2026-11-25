/**
 * Valuation Lab: small input primitives (slider + numeric field + source tag) and formatters.
 */
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SourceTag } from "./ValuationLabData";

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export const fmtUsd = (n: number | null | undefined, digits = 2) =>
  ok(n) ? `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : "—";

/** $ millions → compact ($2.55T, $412.3B, $950M). */
export const fmtMoneyM = (m: number | null | undefined) => {
  if (!ok(m)) return "—";
  const a = Math.abs(m);
  const s = m < 0 ? "-" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}T`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}B`;
  return `${s}$${a.toFixed(a >= 100 ? 0 : 1)}M`;
};

export const fmtPct = (d: number | null | undefined, digits = 1, signed = false) =>
  ok(d) ? `${signed && d > 0 ? "+" : ""}${(d * 100).toFixed(digits)}%` : "—";

export const fmtX = (n: number | null | undefined, digits = 1) => (ok(n) ? `${n.toFixed(digits)}×` : "—");

// ─────────────────────────────────────────────────────────────────────────────
// Scoped styles for the range slider (thin track, teal fill, square thumb)
// ─────────────────────────────────────────────────────────────────────────────

export function LabStyles() {
  return (
    <style>{`
.vl-range{-webkit-appearance:none;appearance:none;width:100%;height:18px;background:transparent;cursor:pointer;margin:0;--vl-c:hsl(var(--up))}
.vl-range[data-tone="amber"]{--vl-c:hsl(var(--amber))}
.vl-range[data-tone="down"]{--vl-c:hsl(var(--down))}
.vl-range::-webkit-slider-runnable-track{height:2px;background:linear-gradient(90deg,var(--vl-c) 0,var(--vl-c) var(--fill,0%),hsl(var(--muted-foreground)/.25) var(--fill,0%))}
.vl-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:10px;height:10px;margin-top:-4px;border-radius:0;background:hsl(var(--card));border:1px solid var(--vl-c);box-shadow:0 0 calc(8px * var(--glow-strength)) var(--vl-c);transition:transform .15s ease}
.vl-range:hover::-webkit-slider-thumb,.vl-range:focus-visible::-webkit-slider-thumb{transform:scale(1.3);background:var(--vl-c)}
.vl-range::-moz-range-track{height:2px;background:hsl(var(--muted-foreground)/.25)}
.vl-range::-moz-range-progress{height:2px;background:var(--vl-c)}
.vl-range::-moz-range-thumb{width:10px;height:10px;border-radius:0;background:hsl(var(--card));border:1px solid var(--vl-c);box-shadow:0 0 calc(8px * var(--glow-strength)) var(--vl-c)}
.vl-range:focus{outline:none}
.vl-range:focus-visible{outline:1px solid hsl(var(--ring));outline-offset:3px}
.vl-num{width:100%;height:24px;padding:0 6px;font-family:var(--font-mono);font-size:11px;font-variant-numeric:tabular-nums;text-align:right;color:hsl(var(--foreground));background:hsl(var(--background)/.6);border:1px solid hsl(var(--card-border));border-radius:var(--radius);transition:border-color .2s,box-shadow .2s}
.vl-num:hover{border-color:hsl(var(--primary)/.55)}
.vl-num:focus{outline:none;border-color:hsl(var(--primary));box-shadow:0 0 calc(10px * var(--glow-strength)) hsl(var(--primary)/.35)}
.vl-num[data-manual="true"]{border-color:hsl(var(--amber)/.6)}
.vl-sub{transition:border-color .25s ease, box-shadow .25s ease}
.vl-sub:hover{border-color:hsl(var(--primary)/.45);box-shadow:0 0 calc(18px * var(--glow-strength)) hsl(var(--primary)/.12)}
`}</style>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Source tag
// ─────────────────────────────────────────────────────────────────────────────

const sourceTone: Record<SourceTag, string> = {
  quote: "text-up border-up/40",
  mock: "text-amber border-amber/40",
  profile: "text-up border-up/40",
  fmp: "text-up border-up/40",
  earnings: "text-up border-up/40",
  financials: "text-up border-up/30",
  analyst: "text-up border-up/40",
  derived: "text-muted-foreground border-border",
  default: "text-dim border-border",
  manual: "text-amber border-amber/50",
  missing: "text-down border-down/40",
};

export function SourceBadge({ source, note }: { source: SourceTag; note?: string }) {
  return (
    <span
      className={cn("inline-flex items-center h-4 px-1 border text-[8.5px] uppercase tracking-[.12em] leading-none shrink-0", sourceTone[source])}
      title={note ? `source: ${source} · ${note}` : `source: ${source}`}
    >
      {source}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Numeric field: free typing, commit on blur / Enter, arrow keys step
// ─────────────────────────────────────────────────────────────────────────────

export type Unit = "pct" | "usd" | "x" | "m" | "num";

const toDisplay = (v: number | null | undefined, unit: Unit) => {
  if (!ok(v)) return "";
  if (unit === "pct") return (v * 100).toFixed(2).replace(/\.?0+$/, "");
  if (unit === "m") return v.toFixed(v >= 1000 ? 0 : 1);
  if (unit === "x") return v.toFixed(1);
  return v.toFixed(2);
};

const fromDisplay = (s: string, unit: Unit): number | null => {
  const n = parseFloat(s.replace(/[$,%×x\s]/gi, ""));
  if (!Number.isFinite(n)) return null;
  return unit === "pct" ? n / 100 : n;
};

const suffix: Record<Unit, string> = { pct: "%", usd: "", x: "×", m: "M", num: "" };

export function NumField({
  value,
  onChange,
  unit,
  step,
  min,
  max,
  manual,
  className,
  placeholder,
  ...rest
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  unit: Unit;
  /** Step in model units (decimal for pct). */
  step?: number;
  min?: number;
  max?: number;
  manual?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label": string;
  "data-testid"?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? toDisplay(value, unit);
  const commit = (raw: string) => {
    const n = fromDisplay(raw, unit);
    setDraft(null);
    if (n == null) return;
    let v = n;
    if (ok(min)) v = Math.max(min, v);
    if (ok(max)) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return (
    <div className={cn("relative", className)}>
      {unit === "usd" && <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-dim pointer-events-none">$</span>}
      <input
        inputMode="decimal"
        className={cn("vl-num", unit === "usd" && "pl-4", suffix[unit] && "pr-4")}
        data-manual={manual ? "true" : undefined}
        value={shown}
        placeholder={placeholder ?? "—"}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && step && ok(value)) {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : 1;
            let v = value + (e.key === "ArrowUp" ? step : -step) * mult;
            if (ok(min)) v = Math.max(min, v);
            if (ok(max)) v = Math.min(max, v);
            setDraft(null);
            onChange(+v.toFixed(6));
          }
        }}
        {...rest}
      />
      {suffix[unit] && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-dim pointer-events-none">{suffix[unit]}</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Range slider with optional reference marks
// ─────────────────────────────────────────────────────────────────────────────

export interface SliderMark {
  value: number;
  label: string;
  tone?: "amber" | "up" | "down" | "dim";
}

const markColor = { amber: "hsl(var(--amber))", up: "hsl(var(--up))", down: "hsl(var(--down))", dim: "hsl(var(--dim))" };

export function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
  tone = "up",
  marks,
  ...rest
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  tone?: "up" | "amber" | "down";
  marks?: SliderMark[];
  "aria-label": string;
  "aria-valuetext"?: string;
}) {
  const v = ok(value) ? Math.min(max, Math.max(min, value)) : min;
  const fill = ((v - min) / (max - min || 1)) * 100;
  return (
    <div className="relative">
      <input
        type="range"
        className="vl-range"
        data-tone={tone}
        min={min}
        max={max}
        step={step}
        value={v}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        {...rest}
      />
      {marks?.map((m) =>
        ok(m.value) && m.value >= min && m.value <= max ? (
          <span
            key={m.label}
            className="pointer-events-none absolute -top-[3px] -translate-x-1/2 flex flex-col items-center"
            style={{ left: `calc(5px + ${((m.value - min) / (max - min)) * 100}% - ${((m.value - min) / (max - min)) * 10}px)` }}
            title={m.label}
          >
            <span className="block w-px h-[7px]" style={{ background: markColor[m.tone ?? "amber"] }} />
          </span>
        ) : null,
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labeled input row: label · source · [slider] · [number]
// ─────────────────────────────────────────────────────────────────────────────

export function LabField({
  label,
  hint,
  source,
  note,
  value,
  onChange,
  unit,
  min,
  max,
  step,
  tone,
  marks,
  slider = true,
  testId,
  children,
  onReset,
}: {
  label: string;
  hint?: ReactNode;
  source: SourceTag;
  note?: string;
  value: number | null;
  onChange: (v: number) => void;
  unit: Unit;
  min: number;
  max: number;
  step: number;
  tone?: "up" | "amber" | "down";
  marks?: SliderMark[];
  slider?: boolean;
  testId?: string;
  children?: ReactNode;
  /** Shown as a small revert button when the value is a manual override. */
  onReset?: () => void;
}) {
  const id = useId();
  const valueText =
    unit === "pct" ? fmtPct(value, 2) : unit === "usd" ? fmtUsd(value) : unit === "x" ? fmtX(value) : unit === "m" ? fmtMoneyM(value) : String(value ?? "—");
  return (
    <div className="group/field" data-testid={testId}>
      <div className="flex items-center gap-2 mb-1 min-w-0">
        <label htmlFor={id} className="hud-label truncate group-hover/field:text-foreground transition-colors">
          {label}
        </label>
        <SourceBadge source={source} note={note} />
        {source === "manual" && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] leading-none text-dim hover:text-amber focus-visible:text-amber focus:outline-none transition-colors"
            aria-label={`Revert ${label} to data value`}
            title="Revert to data value"
          >
            ↺
          </button>
        )}
        {hint && <span className="hud-tag truncate ml-auto">{hint}</span>}
      </div>
      <div className={cn("grid items-center gap-2", slider ? "grid-cols-[1fr_88px]" : "grid-cols-1")}>
        {slider && (
          <RangeSlider
            value={value ?? min}
            min={min}
            max={max}
            step={step}
            onChange={onChange}
            tone={tone}
            marks={marks}
            aria-label={`${label} slider`}
            aria-valuetext={valueText}
          />
        )}
        <NumField id={id} value={value} onChange={onChange} unit={unit} step={step} min={min < 0 || unit === "m" ? undefined : min} manual={source === "manual"} aria-label={label} />
      </div>
      {children}
    </div>
  );
}
