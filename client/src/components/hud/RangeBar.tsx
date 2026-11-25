import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface RangeMarker {
  value: number;
  label?: string;
  tone?: "up" | "down" | "amber" | "fg" | "hit";
  /** "pin" = vertical tick with label above, "tri" = small triangle below the track */
  shape?: "pin" | "tri";
}

interface RangeBarProps {
  min: number;
  max: number;
  markers: RangeMarker[];
  /** Labels under the ends of the track. */
  minLabel?: string;
  maxLabel?: string;
  className?: string;
  /** Track gradient: "rg" red→gray→teal (default), "teal" solid, "none" neutral. */
  track?: "rg" | "teal" | "none";
  height?: number;
}

const toneColor = {
  up: "hsl(var(--up))",
  down: "hsl(var(--down))",
  amber: "hsl(var(--amber))",
  hit: "hsl(var(--hit))",
  fg: "hsl(var(--foreground))",
};

const trackBg = {
  rg: "linear-gradient(90deg, hsl(var(--down) / .85), hsl(var(--muted-foreground) / .35) 50%, hsl(var(--up) / .85))",
  teal: "linear-gradient(90deg, hsl(var(--up) / .2), hsl(var(--up) / .8))",
  none: "hsl(var(--muted))",
};

/** Horizontal range track with animated markers (52w range, analyst targets, valuation bands). */
export function RangeBar({ min, max, markers, minLabel, maxLabel, className, track = "rg", height = 4 }: RangeBarProps) {
  const span = max - min || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100));

  return (
    <div className={cn("w-full", className)}>
      <div className="relative" style={{ height: height + 22, paddingTop: 16 }}>
        <div className="absolute left-0 right-0" style={{ top: 16, height, background: trackBg[track] }} />
        {markers.map((m, i) => {
          const color = toneColor[m.tone ?? "amber"];
          const left = pct(m.value);
          return (
            <motion.div
              key={`${m.label ?? ""}-${i}`}
              className="absolute"
              style={{ top: 0 }}
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: `${left}%`, opacity: 1 }}
              transition={{ type: "spring", stiffness: 90, damping: 18, delay: 0.15 + i * 0.08 }}
            >
              {m.shape === "tri" ? (
                <div className="-translate-x-1/2 flex flex-col items-center" style={{ marginTop: 16 + height + 1 }}>
                  <div
                    style={{
                      width: 0,
                      height: 0,
                      borderLeft: "4px solid transparent",
                      borderRight: "4px solid transparent",
                      borderBottom: `5px solid ${color}`,
                    }}
                  />
                </div>
              ) : (
                <div className="-translate-x-1/2 flex flex-col items-center">
                  {m.label && (
                    <span className="text-[9px] leading-none mb-[3px] whitespace-nowrap tabular-nums" style={{ color }}>
                      {m.label}
                    </span>
                  )}
                  <div
                    style={{
                      width: 2,
                      height: height + 8,
                      marginTop: m.label ? 0 : 12,
                      background: color,
                      boxShadow: `0 0 calc(8px * var(--glow-strength)) ${color}`,
                    }}
                  />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      {(minLabel || maxLabel) && (
        <div className="flex justify-between hud-tag mt-0.5 tabular-nums">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  );
}
