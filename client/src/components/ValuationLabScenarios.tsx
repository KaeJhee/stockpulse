/**
 * Valuation Lab: Bear / Base / Bull scenario cards with linked probability weights.
 */
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Delta, Sparkline, useAnimate } from "@/components/hud";
import { LabCount } from "./ValuationLabCount";
import type { ScenarioAdj, ScenarioKey } from "./ValuationLabData";
import { NumField, RangeSlider, fmtPct, fmtUsd, fmtX } from "./ValuationLabControls";

export interface ScenarioView {
  key: ScenarioKey;
  adj: ScenarioAdj;
  /** Effective year 1-5 growth. */
  growth: number;
  /** Effective exit multiple on final-year FCF. */
  multiple: number;
  value: number;
  upside: number;
  weight: number;
  path: number[];
  /** True when the scenario's inputs equal the DCF block's (no growth/margin shift, Gordon-equivalent exit multiple). */
  matchesDcf: boolean;
}

const meta: Record<ScenarioKey, { label: string; glyph: string; tone: string; border: string; glow: string; spark: "down" | "amber" | "up" }> = {
  bear: { label: "Bear", glyph: "▼", tone: "text-down", border: "border-down/60", glow: "box-glow-red", spark: "down" },
  base: { label: "Base", glyph: "■", tone: "text-amber", border: "border-amber/70", glow: "box-glow-amber", spark: "amber" },
  bull: { label: "Bull", glyph: "▲", tone: "text-up", border: "border-up/60", glow: "box-glow-teal", spark: "up" },
};

export function ScenarioCards({
  views,
  selected,
  layoutKey,
  onSelect,
  onAdj,
  onWeight,
  baseGrowth,
  gordonMult,
}: {
  views: ScenarioView[];
  selected: ScenarioKey;
  layoutKey: string;
  onSelect: (k: ScenarioKey) => void;
  onAdj: (k: ScenarioKey, patch: Partial<ScenarioAdj>) => void;
  onWeight: (k: ScenarioKey, w: number) => void;
  baseGrowth: number;
  gordonMult: number;
}) {
  const animate = useAnimate();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {views.map((v, i) => {
        const m = meta[v.key];
        const active = selected === v.key;
        return (
          <motion.div
            key={v.key}
            initial={animate ? { opacity: 0, y: 10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: animate ? 0.15 + i * 0.08 : 0 }}
            whileHover={animate ? { y: -2 } : undefined}
            onClick={() => onSelect(v.key)}
            className={cn(
              "relative border bg-background/40 p-3 min-w-0 cursor-pointer transition-colors",
              active ? "border-transparent" : "border-card-border hover:border-primary/40",
            )}
            data-testid={`scenario-${v.key}`}
          >
            {active && (
              <motion.span
                layoutId={`vl-scn-${layoutKey}`}
                aria-hidden
                className={cn("pointer-events-none absolute -inset-px border", m.border, m.glow)}
                transition={animate ? { type: "spring", stiffness: 380, damping: 32 } : { duration: 0 }}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`Select ${m.label} scenario`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(v.key);
                }}
                className={cn("hud-title flex items-center gap-1.5 focus:outline-none focus-visible:underline", m.tone)}
              >
                <span className="text-[9px]">{m.glyph}</span>
                {m.label}
              </button>
              <span className="hud-tag tabular-nums">p {v.weight}%</span>
            </div>

            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <LabCount
                value={v.value}
                format={(n) => fmtUsd(n)}
                flash
                className={cn("text-[22px] font-semibold leading-none", m.tone, active && (v.key === "bear" ? "glow-red" : v.key === "bull" ? "glow-teal" : "glow-amber"))}
                data-testid={`scenario-${v.key}-value`}
              />
              <Delta pct={Number.isFinite(v.upside) ? v.upside * 100 : null} className="text-[10.5px]" glow={false} />
            </div>
            <div className="mt-1 hud-tag text-[8.5px] truncate" title="Terminal value method for this scenario">
              {v.matchesDcf ? "= dcf · exit multiple ≡ gordon" : `tv · exit ${fmtX(v.multiple)} on y10`}
            </div>

            <div className="mt-2 h-6">
              <Sparkline data={v.path} width={160} height={24} tone={m.spark} dot={active} area className="max-w-full" strokeWidth={1.25} />
            </div>

            <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <Row label="growth 1-5y" hint={`base ${fmtPct(baseGrowth, 1)}`}>
                <NumField
                  value={v.growth}
                  unit="pct"
                  step={0.005}
                  min={-0.5}
                  max={1}
                  onChange={(g) => onAdj(v.key, { dGrowth: +(g - baseGrowth).toFixed(6) })}
                  aria-label={`${m.label} scenario growth years 1 to 5`}
                />
              </Row>
              <Row label="cash margin" hint="vs base FCF">
                <NumField
                  value={v.adj.margin}
                  unit="pct"
                  step={0.01}
                  min={-0.9}
                  max={2}
                  onChange={(x) => onAdj(v.key, { margin: x })}
                  aria-label={`${m.label} scenario cash margin shift`}
                />
              </Row>
              <Row label="exit multiple" hint={Number.isFinite(gordonMult) ? `gordon ${fmtX(gordonMult)}` : undefined}>
                <NumField
                  value={v.multiple}
                  unit="x"
                  step={0.5}
                  min={0.5}
                  max={200}
                  onChange={(x) => Number.isFinite(gordonMult) && gordonMult > 0 && onAdj(v.key, { multFactor: +(x / gordonMult).toFixed(6) })}
                  aria-label={`${m.label} scenario exit multiple on year 10 cash flow`}
                />
              </Row>
              <div className="pt-1">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="hud-tag">probability</span>
                  <span className={cn("text-[10.5px] tabular-nums", m.tone)}>{v.weight}%</span>
                </div>
                <RangeSlider
                  value={v.weight}
                  min={0}
                  max={100}
                  step={1}
                  tone={v.key === "bear" ? "down" : v.key === "base" ? "amber" : "up"}
                  onChange={(w) => onWeight(v.key, w)}
                  aria-label={`${m.label} scenario probability`}
                  aria-valuetext={`${v.weight} percent`}
                />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_84px] items-center gap-2">
      <div className="min-w-0 leading-tight">
        <div className="hud-label text-[9.5px] truncate">{label}</div>
        {hint && <div className="hud-tag text-[8.5px] truncate">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
