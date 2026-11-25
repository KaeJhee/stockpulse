import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAnimate } from "./motion";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface CountUpProps {
  value: number | null | undefined;
  /** Formats the in-flight number. Defaults to 2 decimals with thousands separators. */
  format?: (n: number) => string;
  /** Tween duration in ms. */
  duration?: number;
  /** On first mount, count from this value (default 0). Pass `null` to start at the value. */
  from?: number | null;
  /** Flash the background teal/red when the value changes after mount. */
  flash?: boolean;
  /** Shown when value is null/undefined/NaN. */
  fallback?: string;
  className?: string;
  "data-testid"?: string;
}

export const fmtNum = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Animated number. Counts up on first mount, tweens between later values,
 * and optionally flashes teal (up) or crimson (down) on change.
 */
export function CountUp({
  value,
  format = (n) => fmtNum(n, 2),
  duration = 700,
  from = 0,
  flash = false,
  fallback = "—",
  className,
  ...rest
}: CountUpProps) {
  const animate = useAnimate();
  const valid = typeof value === "number" && Number.isFinite(value);
  const [display, setDisplay] = useState<number | null>(() => {
    if (!valid) return null;
    if (!animate || from === null) return value as number;
    return from;
  });
  const [flashDir, setFlashDir] = useState<"up" | "down" | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const prevRef = useRef<number | null>(valid ? (value as number) : null);
  const displayRef = useRef<number | null>(display);
  const mountedRef = useRef(false);
  const mountedAtRef = useRef(performance.now());

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!valid) {
      setDisplay(null);
      prevRef.current = null;
      return;
    }
    const target = value as number;
    const isFirst = !mountedRef.current;
    mountedRef.current = true;

    // Only flash real updates, not the initial placeholder → live-data swap right after mount.
    const settled = performance.now() - mountedAtRef.current > 2500;
    if (!isFirst && flash && settled && prevRef.current !== null && target !== prevRef.current) {
      setFlashDir(target > prevRef.current ? "up" : "down");
      setFlashKey((k) => k + 1);
    }
    prevRef.current = target;

    const start = displayRef.current ?? (isFirst && from !== null ? from : target);
    if (!animate || start === target) {
      setDisplay(target);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setDisplay(start + (target - start) * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // rAF pauses in background tabs; always land on the exact value regardless.
    const snap = setTimeout(() => {
      cancelAnimationFrame(raf);
      setDisplay(target);
    }, duration + 60);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(snap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, valid, animate, duration]);

  return (
    <span
      key={flashKey}
      className={cn(
        "tabular-nums",
        flashDir === "up" && flashKey > 0 && "flash-up",
        flashDir === "down" && flashKey > 0 && "flash-down",
        className,
      )}
      {...rest}
    >
      {display === null ? fallback : format(display)}
    </span>
  );
}
