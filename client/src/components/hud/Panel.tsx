import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

type Accent = "teal" | "amber" | "red" | "none";

const accentColor: Record<Accent, string> = {
  teal: "hsl(var(--up))",
  amber: "hsl(var(--amber))",
  red: "hsl(var(--down))",
  none: "transparent",
};

interface PanelProps {
  /** Uppercase panel title, top-left. */
  title?: ReactNode;
  /** Small dim tag next to the title (e.g. source, "live", "1y"). */
  tag?: ReactNode;
  /** Optional icon before the title. Defaults to a small diamond. */
  icon?: ReactNode;
  /** Right-aligned header content (toggles, status). */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Entrance delay in seconds (stagger panels). */
  delay?: number;
  /** Color of the diamond and the top scan line. */
  accent?: Accent;
  /** Remove body padding. */
  flush?: boolean;
  id?: string;
  "data-testid"?: string;
}

export function Diamond({ color = "hsl(var(--up))", size = 7, className }: { color?: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rotate-45", className)}
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 calc(8px * var(--glow-strength)) ${color}`,
      }}
    />
  );
}

/** Ghost brand mark: teal, amber, magenta diamonds. */
export function GhostMark({ size = 7 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      <Diamond color="hsl(var(--up))" size={size} />
      <Diamond color="hsl(var(--amber))" size={size} />
      <Diamond color="hsl(var(--magenta))" size={size} />
    </span>
  );
}

/**
 * Ghost HUD panel: square, 1px border, teal corner ticks, uppercase title,
 * fades and lifts in when scrolled into view, with a one-shot scan line along the top.
 */
export function Panel({
  title,
  tag,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  delay = 0,
  accent = "teal",
  flush = false,
  id,
  ...rest
}: PanelProps) {
  const color = accentColor[accent];
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -40px 0px" });
  // Fail-safe: never leave content invisible if the observer doesn't fire
  // (programmatic jumps, resizes, background tabs). Reveal after a short wait.
  const [forced, setForced] = useState(false);
  useEffect(() => {
    if (inView || forced) return;
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) setForced(true);
    };
    const id = setInterval(check, 700);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [inView, forced]);
  const shown = inView || forced;

  return (
    <motion.section
      ref={ref}
      id={id}
      initial={{ opacity: 0, y: 14 }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 14 }}
      transition={{ duration: 0.5, delay: inView ? delay : 0, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn("hud-panel flex flex-col min-w-0", className)}
      {...rest}
    >
      {/* one-shot scan line */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute left-0 right-0 top-0 h-px origin-left"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        initial={{ scaleX: 0, opacity: 1 }}
        animate={shown ? { scaleX: 1, opacity: [1, 1, 0.35] } : { scaleX: 0, opacity: 1 }}
        transition={{ duration: 1.1, delay: (inView ? delay : 0) + 0.15, ease: "easeOut" }}
      />
      {(title || actions || tag) && (
        <header className="flex items-center justify-between gap-3 px-4 h-10 border-b border-border/70 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon ?? <Diamond color={color === "transparent" ? "hsl(var(--up))" : color} size={6} />}
            {title && <h2 className="hud-title truncate">{title}</h2>}
            {tag && <span className="hud-tag truncate">{tag}</span>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-4", "flex-1 min-h-0", bodyClassName)}>{children}</div>
    </motion.section>
  );
}
