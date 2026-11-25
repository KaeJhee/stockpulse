import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TickerSearch } from "@/components/TickerSearch";
import { QuoteHeader } from "@/components/QuoteHeader";
import { AdvancedChart } from "@/components/AdvancedChart";
import { NewsPanel } from "@/components/NewsPanel";
import { EarningsPanel } from "@/components/EarningsPanel";
import { MarketOverview } from "@/components/MarketOverview";
import { SettingsModal, SettingsButton } from "@/components/SettingsModal";
import { ApiHealthIndicator } from "@/components/ApiHealthIndicator";
import { TechnicalIndicators } from "@/components/TechnicalIndicators";
import { FundamentalsPanel } from "@/components/FundamentalsPanel";
import { ValuationPanel } from "@/components/ValuationPanel";
import { GhostMark, Decode, useMotionMode, useAnimate } from "@/components/hud";
import { useSchwabAuth, useMarketStatus } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Link as LinkIcon, Unlink, X, Activity, Sun, Moon } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────────
// Small shell pieces
// ──────────────────────────────────────────────────────────────────────────

const RECENT_KEY = "ghost.valuation.recent";
const MAX_TABS = 7;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string").slice(0, MAX_TABS) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

/** Live clock in Central Time, like the Ghost terminal header. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const t = now.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Chicago",
  });
  return (
    <span className="font-mono text-[12px] tabular-nums text-foreground/90 tracking-wider" data-testid="header-clock">
      {t} <span className="text-dim text-[10px]">CT</span>
    </span>
  );
}

function MarketChip() {
  const { data } = useMarketStatus();
  const open = data?.isOpen;
  const session = data?.session ?? "closed";
  const label = open ? "MARKET OPEN" : session === "pre-market" || session === "pre" ? "PRE-MARKET" : session === "post-market" || session === "post" ? "AFTER HOURS" : "MARKET CLOSED";
  const tone = open ? undefined : session === "closed" ? "dim" : "amber";
  return (
    <span className="hud-chip hidden md:inline-flex" data-testid="market-chip">
      <span className="live-dot" data-tone={tone} />
      {label}
    </span>
  );
}

function MotionToggle() {
  const { mode, cycle } = useMotionMode();
  return (
    <button
      onClick={cycle}
      className="hud-btn hidden md:inline-flex !px-2 2xl:!px-[.7rem]"
      title={`Motion: ${mode} (click: full → reduced → off)`}
      aria-label={`Motion ${mode}`}
      data-testid="button-motion"
    >
      <Activity className="w-3 h-3" />
      <span className="hidden 2xl:inline">Motion {mode}</span>
    </button>
  );
}

/** First-load boot sequence (skipped when motion is off). */
function BootOverlay({ onDone }: { onDone: () => void }) {
  const lines = [
    ["ghost", "valuation terminal · boot"],
    ["feeds", "polygon · finnhub · fmp · alpha vantage"],
    ["model", "dcf · multiples · scenarios"],
    ["ready", "analysis, not a recommendation"],
  ];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown < lines.length) {
      const id = setTimeout(() => setShown((s) => s + 1), 170);
      return () => clearTimeout(id);
    }
    const id = setTimeout(onDone, 380);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(6px)" }}
      transition={{ duration: 0.45 }}
      onClick={onDone}
    >
      <div className="w-[340px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-5">
          <GhostMark size={9} />
          <span className="text-primary font-bold tracking-[.22em] glow-teal">GHOST</span>
          <span className="font-bold tracking-[.22em]">VALUATION</span>
        </div>
        <div className="space-y-1.5 font-mono text-[11px]">
          {lines.slice(0, shown).map(([k, v], i) => (
            <motion.div
              key={k}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-3"
            >
              <span className="text-dim w-5 text-right">{String(i + 1).padStart(2, "0")}</span>
              <span className={cn("w-12", k === "ready" ? "text-hit" : "text-primary")}>{k}</span>
              <span className="text-muted-foreground">{v}</span>
            </motion.div>
          ))}
          {shown < lines.length && <div className="pl-8 cursor-block" />}
        </div>
        <div className="mt-5 h-px bg-border overflow-hidden">
          <motion.div
            className="h-full bg-primary box-glow-teal"
            initial={{ width: "0%" }}
            animate={{ width: `${(shown / lines.length) * 100}%` }}
            transition={{ duration: 0.2 }}
          />
        </div>
      </div>
    </motion.div>
  );
}

const SECTIONS = [
  { id: "sec-quote", label: "Quote" },
  { id: "sec-chart", label: "Chart" },
  { id: "sec-valuation", label: "Valuation" },
  { id: "sec-signals", label: "Signals" },
  { id: "sec-news", label: "News · Earnings" },
];

/** Sticky jump-rail with scroll-spy for the ticker view. */
function SectionRail() {
  const [active, setActive] = useState(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <nav className="hidden md:flex items-center gap-1" aria-label="Sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className={cn(
            "relative h-7 px-2.5 text-[10px] uppercase tracking-[.14em] transition-colors",
            active === s.id ? "text-primary" : "text-dim hover:text-foreground",
          )}
        >
          {active === s.id && (
            <motion.span layoutId="rail-active" className="absolute inset-x-1 bottom-0 h-px bg-primary box-glow-teal" />
          )}
          {s.label}
        </button>
      ))}
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const animate = useAnimate();
  const [booting, setBooting] = useState(() => {
    if (!animate) return false;
    try {
      return sessionStorage.getItem("ghost.booted") !== "1";
    } catch {
      return true;
    }
  });
  const finishBoot = useCallback(() => {
    setBooting(false);
    try {
      sessionStorage.setItem("ghost.booted", "1");
    } catch {
      /* ignore */
    }
  }, []);

  const [ticker, setTickerState] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);
  // Read the saved preference directly: App's effect that applies the class
  // runs after this first render, so the DOM class isn't reliable yet.
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("ghost.theme") !== "light";
    } catch {
      return true;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: schwabAuth } = useSchwabAuth();
  const schwabConnected = schwabAuth?.authenticated ?? false;
  const mainRef = useRef<HTMLElement>(null);

  const setTicker = useCallback((t: string | null) => {
    const sym = t ? t.trim().toUpperCase() : null;
    setTickerState(sym);
    if (sym) {
      setRecent((prev) => {
        const next = [sym, ...prev.filter((p) => p !== sym)].slice(0, MAX_TABS);
        writeRecent(next);
        return next;
      });
    }
    window.scrollTo({ top: 0, behavior: animate ? "smooth" : "auto" });
  }, [animate]);

  const closeTab = useCallback((sym: string) => {
    setRecent((prev) => {
      const next = prev.filter((p) => p !== sym);
      writeRecent(next);
      return next;
    });
    setTickerState((cur) => (cur === sym ? null : cur));
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("ghost.theme", next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Keyboard: Esc → overview, [ / ] → previous / next tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing || settingsOpen) return;
      if (e.key === "Escape" && ticker) {
        setTickerState(null);
      } else if ((e.key === "[" || e.key === "]") && recent.length) {
        const tabs: (string | null)[] = [null, ...recent];
        const idx = tabs.indexOf(ticker);
        const nextIdx = (idx + (e.key === "]" ? 1 : -1) + tabs.length) % tabs.length;
        setTickerState(tabs[nextIdx]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticker, recent, settingsOpen]);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    [],
  );

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* Stage backdrop */}
      <div className="ghost-stage" aria-hidden>
        <div className="ghost-stage__floor" />
        <div className="ghost-stage__scan" />
      </div>

      <AnimatePresence>{booting && <BootOverlay onDone={finishBoot} />}</AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="max-w-[1680px] mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setTicker(null)}
            className="flex items-center gap-2.5 shrink-0 group"
            data-testid="app-title"
            title="Market overview"
          >
            <GhostMark size={7} />
            <span className="text-[13px] tracking-[.2em] font-bold hidden sm:inline">
              <span className="text-primary glow-teal">GHOST</span> VALUATION
            </span>
            <span className="hud-tag hidden xl:inline group-hover:text-muted-foreground transition-colors">// stockpulse</span>
          </button>

          <div className="flex-1 min-w-0 max-w-lg">
            <TickerSearch onSelect={setTicker} />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
            <MarketChip />
            {schwabConnected ? (
              <a
                href="/api/auth/logout"
                className="hud-chip hidden sm:inline-flex !text-hit !border-hit/40"
                title="Schwab connected — click to disconnect"
              >
                <LinkIcon className="w-3 h-3" />
                Schwab
              </a>
            ) : (
              <a
                href="/api/auth/login"
                className="hud-chip hidden sm:inline-flex"
                title="Connect your Schwab account for real-time data"
              >
                <Unlink className="w-3 h-3" />
                Schwab
              </a>
            )}
            <ApiHealthIndicator />
            <MotionToggle />
            <SettingsButton onClick={() => setSettingsOpen(true)} />
            <button
              onClick={toggleTheme}
              className="hud-btn !px-2"
              aria-label="Toggle theme"
              title={isDark ? "Switch to paper (light)" : "Switch to dark"}
              data-testid="button-toggle-theme"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
            <span className="hidden lg:inline pl-2 border-l border-border">
              <Clock />
            </span>
          </div>
        </div>

        {/* ── Tab strip: overview + recent tickers ── */}
        <div className="max-w-[1680px] mx-auto px-4 sm:px-6 h-9 flex items-center gap-3 overflow-x-auto">
          <div className="flex items-center gap-px shrink-0" role="tablist" aria-label="Views">
            {[null, ...recent].map((sym) => {
              const active = sym === ticker;
              return (
                <div key={sym ?? "__overview"} className="relative group flex items-center">
                  <button
                    role="tab"
                    aria-selected={active}
                    onClick={() => (sym ? setTicker(sym) : setTicker(null))}
                    className={cn(
                      "relative h-9 pl-3 text-[10.5px] uppercase tracking-[.14em] transition-colors",
                      sym ? "pr-6" : "pr-3",
                      active ? "text-foreground" : "text-dim hover:text-muted-foreground",
                    )}
                    data-testid={sym ? `tab-${sym}` : "button-back-overview"}
                  >
                    {active && (
                      <motion.span
                        layoutId="tab-active"
                        className="absolute inset-x-0 bottom-0 h-[2px] bg-primary box-glow-teal"
                        transition={{ type: "spring", stiffness: 400, damping: 34 }}
                      />
                    )}
                    {sym ?? "Overview"}
                  </button>
                  {sym && (
                    <button
                      onClick={() => closeTab(sym)}
                      className="absolute right-1 p-0.5 text-dim opacity-0 group-hover:opacity-100 hover:text-down transition"
                      aria-label={`Close ${sym}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {ticker ? <SectionRail key={ticker} /> : null}
            <span className="hud-tag hidden xl:inline">
              <kbd className="text-muted-foreground">/</kbd> search · <kbd className="text-muted-foreground">[ ]</kbd> tabs · <kbd className="text-muted-foreground">esc</kbd> overview
            </span>
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main ref={mainRef} className="relative z-10 flex-1 max-w-[1680px] mx-auto w-full px-4 sm:px-6 py-5 sm:py-6">
        <AnimatePresence mode="wait">
          {!ticker ? (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
            >
              <MarketOverview onSelect={setTicker} />
            </motion.div>
          ) : (
            <motion.div
              key={ticker}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28 }}
              className="space-y-4 sm:space-y-5"
            >
              <div className="flex items-baseline gap-3">
                <span className="hud-tag">{"// ticker"}</span>
                <Decode text={ticker} className="text-[11px] tracking-[.3em] text-primary" />
              </div>

              <div id="sec-quote" className="scroll-mt-28">
                <QuoteHeader ticker={ticker} />
              </div>
              <div id="sec-chart" className="scroll-mt-28">
                <AdvancedChart ticker={ticker} />
              </div>
              <div id="sec-valuation" className="scroll-mt-28">
                <ValuationPanel ticker={ticker} />
              </div>
              <div id="sec-signals" className="scroll-mt-28 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                <TechnicalIndicators ticker={ticker} />
                <FundamentalsPanel ticker={ticker} />
              </div>
              <div id="sec-news" className="scroll-mt-28 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
                <NewsPanel ticker={ticker} />
                <EarningsPanel ticker={ticker} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ── Footer bar ─────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-[1680px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] tracking-[.1em] uppercase">
          <span className="flex items-center gap-2 text-muted-foreground">
            <GhostMark size={5} />
            {ticker ?? "market overview"} · polygon · finnhub · fmp
          </span>
          <span className="text-amber/90 border border-amber/40 px-1.5 py-0.5">Analysis, not a recommendation · {today}</span>
          <span className="text-dim normal-case tracking-normal">Market data may be delayed. Research only.</span>
          <a
            href="https://www.perplexity.ai/computer"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-dim hover:text-muted-foreground normal-case tracking-normal transition-colors"
          >
            built on Perplexity Computer
          </a>
        </div>
      </footer>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
