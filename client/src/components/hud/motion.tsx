import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";

/**
 * Motion preference, Ghost Suite rule: "Motion: full / reduced / off",
 * defaulting to the OS prefers-reduced-motion setting.
 *   full    → entrance animations + ambient loops + glow
 *   reduced → entrance animations only (short), no ambient loops, no glow
 *   off     → everything renders instantly
 * The mode is mirrored to <html data-motion="..."> so CSS can react too.
 */
export type MotionMode = "full" | "reduced" | "off";

const STORAGE_KEY = "ghost.motion";

function readStored(): MotionMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "full" || v === "reduced" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

function osPrefersReduced(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface MotionCtx {
  mode: MotionMode;
  setMode: (m: MotionMode) => void;
  cycle: () => void;
}

const Ctx = createContext<MotionCtx>({ mode: "full", setMode: () => {}, cycle: () => {} });

export function MotionProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<MotionMode>(() => readStored() ?? (osPrefersReduced() ? "reduced" : "full"));

  useEffect(() => {
    document.documentElement.dataset.motion = mode;
  }, [mode]);

  const setMode = useCallback((m: MotionMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage unavailable: preference lasts for this session only */
    }
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next: MotionMode = prev === "full" ? "reduced" : prev === "reduced" ? "off" : "full";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, setMode, cycle }), [mode, setMode, cycle]);

  return (
    <Ctx.Provider value={value}>
      <MotionConfig
        reducedMotion={mode === "full" ? "never" : "always"}
        transition={mode === "off" ? { duration: 0 } : undefined}
      >
        {children}
      </MotionConfig>
    </Ctx.Provider>
  );
}

export function useMotionMode() {
  return useContext(Ctx);
}

/** True when one-shot entrance animations (count-ups, draw-ins) should run. */
export function useAnimate() {
  return useContext(Ctx).mode !== "off";
}

/** True when ambient / looping effects and glow should run. */
export function useAmbient() {
  return useContext(Ctx).mode === "full";
}
