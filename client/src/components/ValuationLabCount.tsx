/**
 * Valuation Lab: exact-settling count-up.
 *
 * Same look and API subset as the HUD CountUp, but the tween is backed by a timer that
 * snaps to the exact target when the duration ends. rAF does not fire in hidden or
 * background tabs, so a pure rAF tween can sit on a stale intermediate value; the Lab's
 * numbers must agree with each other (DCF per share = sensitivity current cell = base
 * scenario), so the settled value never depends on rAF.
 *
 * The exact (unformatted) target is also exposed as data-value for verification.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fmtNum, useAnimate } from "@/components/hud";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const ok = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function LabCount({
  value,
  format = (n) => fmtNum(n, 2),
  duration = 700,
  from = 0,
  flash = false,
  fallback = "—",
  className,
  "data-testid": testId,
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  duration?: number;
  /** First-mount start value (default 0); null starts at the value. */
  from?: number | null;
  flash?: boolean;
  fallback?: string;
  className?: string;
  "data-testid"?: string;
}) {
  const animate = useAnimate();
  const valid = ok(value);
  const [display, setDisplay] = useState<number | null>(() => (!valid ? null : !animate || from === null ? (value as number) : from));
  const displayRef = useRef<number | null>(display);
  const prevRef = useRef<number | null>(valid ? (value as number) : null);
  const mountedRef = useRef(false);
  const mountedAt = useRef(typeof performance !== "undefined" ? performance.now() : 0);
  const [flashDir, setFlashDir] = useState<"up" | "down" | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    const set = (n: number | null) => {
      displayRef.current = n;
      setDisplay(n);
    };
    if (!valid) {
      set(null);
      prevRef.current = null;
      return;
    }
    const target = value as number;
    const isFirst = !mountedRef.current;
    mountedRef.current = true;

    const settled = performance.now() - mountedAt.current > 2500;
    if (!isFirst && flash && animate && settled && prevRef.current !== null && target !== prevRef.current) {
      setFlashDir(target > prevRef.current ? "up" : "down");
      setFlashKey((k) => k + 1);
    }
    prevRef.current = target;

    const start = displayRef.current ?? (isFirst && from !== null ? from : target);
    if (!animate || start === target) {
      set(target);
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      set(t >= 1 ? target : start + (target - start) * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Guarantee the exact final value even when rAF is throttled or paused.
    const snap = setTimeout(() => {
      cancelAnimationFrame(raf);
      set(target);
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
      className={cn("tabular-nums", flashKey > 0 && flashDir === "up" && "flash-up", flashKey > 0 && flashDir === "down" && "flash-down", className)}
      data-testid={testId}
      data-value={valid ? String(value) : undefined}
    >
      {display === null ? fallback : format(display)}
    </span>
  );
}
