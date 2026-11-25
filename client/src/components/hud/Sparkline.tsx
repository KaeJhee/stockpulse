import { useId, useMemo } from "react";
import { motion } from "framer-motion";
import { useAmbient } from "./motion";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Force a tone; default is up if last >= first. */
  tone?: "up" | "down" | "amber" | "auto";
  /** Draw a soft gradient area under the line. */
  area?: boolean;
  /** Show a pulsing dot at the last point. */
  dot?: boolean;
  /** Draw-in duration (s). */
  duration?: number;
  className?: string;
  strokeWidth?: number;
}

const toneVar = { up: "--up", down: "--down", amber: "--amber" } as const;

/** SVG sparkline that draws itself left→right, with a glowing live tip. */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  tone = "auto",
  area = true,
  dot = true,
  duration = 1.1,
  className,
  strokeWidth = 1.5,
}: SparklineProps) {
  const id = useId().replace(/:/g, "");
  const ambient = useAmbient();
  const clean = useMemo(() => data.filter((n) => Number.isFinite(n)), [data]);

  const { line, fill, last } = useMemo(() => {
    if (clean.length < 2) return { line: "", fill: "", last: null as null | [number, number] };
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const pad = 3;
    const pts = clean.map((v, i) => {
      const x = (i / (clean.length - 1)) * width;
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return [x, y] as [number, number];
    });
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const fill = `${line} L${width},${height} L0,${height} Z`;
    return { line, fill, last: pts[pts.length - 1] };
  }, [clean, width, height]);

  if (!line) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }

  const resolved = tone === "auto" ? (clean[clean.length - 1] >= clean[0] ? "up" : "down") : tone;
  const color = `hsl(var(${toneVar[resolved]}))`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area && (
        <motion.path
          d={fill}
          fill={`url(#sg-${id})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: duration * 0.6 }}
        />
      )}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration, ease: [0.2, 0.8, 0.2, 1] }}
        style={{ filter: `drop-shadow(0 0 calc(3px * var(--glow-strength)) ${color})` }}
      />
      {dot && last && (
        <g>
          {ambient && (
            <motion.circle
              cx={last[0]}
              cy={last[1]}
              r={2.5}
              fill={color}
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: [1, 2.8], opacity: [0.6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: duration }}
              style={{ transformOrigin: `${last[0]}px ${last[1]}px` }}
            />
          )}
          <motion.circle
            cx={last[0]}
            cy={last[1]}
            r={2.2}
            fill={color}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: duration * 0.9 }}
          />
        </g>
      )}
    </svg>
  );
}
