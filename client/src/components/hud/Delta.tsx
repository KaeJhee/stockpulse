import { cn } from "@/lib/utils";

/** Signed % / value change with ▲▼ glyph, teal up, crimson down, glow in dark mode. */
export function Delta({
  pct,
  value,
  digits = 2,
  className,
  glow = true,
  showArrow = true,
}: {
  pct?: number | null;
  value?: number | null;
  digits?: number;
  className?: string;
  glow?: boolean;
  showArrow?: boolean;
}) {
  const basis = pct ?? value;
  if (basis == null || !Number.isFinite(basis)) return <span className={cn("text-dim tabular-nums", className)}>—</span>;
  const up = basis > 0;
  const flat = basis === 0;
  const tone = flat ? "text-muted-foreground" : up ? "text-up" : "text-down";
  const glowCls = !glow || flat ? "" : up ? "glow-teal" : "glow-red";
  const sign = up ? "+" : "";
  return (
    <span className={cn("inline-flex items-center gap-1 tabular-nums", tone, glowCls, className)}>
      {showArrow && !flat && <span className="text-[0.75em]">{up ? "▲" : "▼"}</span>}
      {value != null && Number.isFinite(value) && (
        <span>
          {sign}
          {value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
        </span>
      )}
      {pct != null && Number.isFinite(pct) && (
        <span>
          {value != null ? "(" : ""}
          {sign}
          {pct.toFixed(2)}%{value != null ? ")" : ""}
        </span>
      )}
    </span>
  );
}
