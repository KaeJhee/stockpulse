import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string> {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

/** Square segmented control with a sliding teal highlight. */
export function Segmented<T extends string>({ options, value, onChange, size = "sm", className, ...rest }: SegmentedProps<T>) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      aria-label={rest["aria-label"]}
      className={cn("inline-flex items-stretch border border-card-border bg-background/60 p-[2px] gap-[2px]", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative px-2.5 font-mono uppercase tracking-[.12em] transition-colors",
              size === "sm" ? "h-6 text-[10px]" : "h-7 text-[11px]",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 bg-primary box-glow-teal"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
