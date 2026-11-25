import { useState, useRef, useEffect, useId, useMemo, useCallback, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { X } from "lucide-react";
import { useTickerSearch } from "@/lib/hooks";
import { useAnimate, useAmbient } from "@/components/hud";
import { cn } from "@/lib/utils";

interface Props {
  onSelect: (ticker: string) => void;
}

interface Result {
  ticker: string;
  name?: string;
  market?: string;
}

/**
 * "Looks like a symbol" for direct loads: one token of letters/digits with an optional
 * class / exchange suffix or index caret (AAPL, BRK.B, BF-B, SHOP.TO, 7203.T, ^GSPC).
 * Free text with spaces ("apple inc") is not a symbol.
 */
const SYMBOL_RE = /^\^?[A-Za-z0-9]{1,10}([.\-=][A-Za-z0-9]{1,5})?$/;
/** Typing settle time before a search is sent (keeps Finnhub calls down). */
const DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Wraps the first case-insensitive match of `q` in a highlight span. */
function Highlight({ text, q, className }: { text: string; q: string; className?: string }) {
  const needle = q.trim();
  if (!needle) return <span className={className}>{text}</span>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {text.slice(0, i)}
      <mark className="bg-up/15 text-up glow-teal px-0">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </span>
  );
}

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function TickerSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [popStyle, setPopStyle] = useState<CSSProperties | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const animate = useAnimate();
  const ambient = useAmbient();
  const uid = useId().replace(/:/g, "");
  const listId = `ticker-search-list-${uid}`;
  const shake = useAnimationControls();

  // Invalid Enter: small horizontal shake (one-shot)
  useEffect(() => {
    if (!nudge || !animate) return;
    shake.start({ x: [0, -4, 4, -2, 0], transition: { duration: 0.28 } });
  }, [nudge, animate, shake]);

  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const { data, isLoading, isFetching } = useTickerSearch(debounced);

  const settling = query.trim() !== debounced;
  const loading = query.trim().length > 0 && (settling || isLoading || (isFetching && !data));
  const results: Result[] = useMemo(() => (settling || isLoading ? [] : ((data?.results as Result[]) || [])), [data, settling, isLoading]);

  // ── Close on outside click ────────────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Global shortcuts: "/" and Ctrl/Cmd+K focus the search ────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSlash = e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isCmdK = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
      if (!isSlash && !isCmdK) return;
      if (e.target === inputRef.current) {
        if (isCmdK) {
          e.preventDefault();
          inputRef.current?.select();
        }
        return;
      }
      if (isTypingTarget(e.target)) return;
      // Leave open dialogs (settings, etc.) alone
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Default highlight ─────────────────────────────────────────────────────
  // Exact ticker match wins. Otherwise, if the query itself looks like a symbol, nothing is
  // highlighted and Enter loads the typed symbol directly (the original Enter behavior).
  // Free text ("apple") highlights the first row so Enter picks it.
  useEffect(() => {
    const q = query.trim();
    const exact = results.findIndex((r) => r.ticker?.toUpperCase() === q.toUpperCase());
    setActive(exact >= 0 ? exact : SYMBOL_RE.test(q) ? -1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  // Keep the active row in view during keyboard navigation
  useEffect(() => {
    if (active < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // ── Popover sizing: on narrow screens, span the viewport instead of the input ─
  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    if (vw >= 640) {
      setPopStyle(undefined);
      return;
    }
    const rect = el.getBoundingClientRect();
    setPopStyle({ left: 12 - rect.left, width: vw - 24, right: "auto" });
  }, []);

  const showPop = open && query.trim().length >= 1;

  useEffect(() => {
    if (!showPop) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [showPop, measure]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const commit = useCallback(
    (sym: string) => {
      onSelect(sym);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onSelect],
  );

  const q = query.trim();
  const validSymbol = SYMBOL_RE.test(q);

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (results.length) setActive((i) => (i < 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length) setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (!q) return;
      e.preventDefault();
      const pick = active >= 0 ? results[active] : undefined;
      if (!loading && pick) {
        commit(pick.ticker);
      } else if (validSymbol) {
        commit(q.toUpperCase());
      } else {
        setOpen(true);
        setNudge((n) => n + 1);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "Tab") {
      // focus is leaving the combobox; don't leave the popover hanging
      setOpen(false);
    }
  }

  const activeId = showPop && active >= 0 && results[active] ? `${listId}-opt-${active}` : undefined;
  // Ambient loops (dot ping / cursor blink / shimmer) stop when motion is reduced or off.
  const still = !ambient && "after:!animate-none";
  const shimmer = cn("skeleton-shimmer", !ambient && "!animate-none");

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      {/* ── Command input ─────────────────────────────────────────────────── */}
      <motion.div
        animate={shake}
        className={cn(
          "relative flex items-center h-9 border bg-background/60 transition-[border-color,box-shadow] duration-200",
          focused ? "border-primary box-glow-teal" : "border-card-border hover:border-primary/50",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "pl-2.5 pr-1.5 text-[13px] font-bold select-none transition-colors",
            focused ? "text-primary glow-teal" : "text-dim",
          )}
        >
          &gt;
        </span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search ticker"
          aria-expanded={showPop}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            if (query) setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder="SEARCH TICKER"
          className="flex-1 min-w-0 h-full bg-transparent font-mono text-[12.5px] uppercase tracking-[.12em] text-foreground placeholder:text-dim placeholder:tracking-[.16em] focus:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
          data-testid="input-ticker-search"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="mr-1.5 p-1 text-dim hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary transition-colors"
            data-testid="button-clear-search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="mr-2 flex items-center gap-1 pointer-events-none select-none" aria-hidden>
            {focused ? (
              <kbd className="px-1 h-[18px] inline-flex items-center border border-border text-[9.5px] text-dim tracking-wider">ESC</kbd>
            ) : (
              <>
                <kbd className="px-1.5 h-[18px] inline-flex items-center border border-border text-[10px] text-dim">/</kbd>
                <kbd className="hidden sm:inline-flex px-1 h-[18px] items-center border border-border text-[9.5px] text-dim tracking-wider">
                  CTRL K
                </kbd>
              </>
            )}
          </span>
        )}

        {/* scan-line loading indicator */}
        {loading && (
          <span aria-hidden className="pointer-events-none absolute left-0 right-0 -bottom-px h-px overflow-hidden">
            {ambient ? (
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-x" />
            ) : (
              <span className="absolute inset-0 bg-primary/60" />
            )}
          </span>
        )}
      </motion.div>

      {/* ── Results popover ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPop && (
          <motion.div
            key="pop"
            initial={animate ? { opacity: 0, y: -4, scaleY: 0.96 } : false}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ transformOrigin: "top", ...popStyle }}
            className="hud-panel absolute top-full left-0 right-0 mt-1.5 z-50 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 px-3 h-7 border-b border-border/70">
              <span className="hud-tag flex items-center gap-1.5 min-w-0" aria-live="polite">
                <span className={cn("live-dot shrink-0", still)} data-tone={loading ? "amber" : results.length ? undefined : "dim"} />
                <span className="truncate">{loading ? "sampling" : results.length ? `results · ${results.length}` : "no match"}</span>
              </span>
              {!loading && results.length > 0 && active < 0 && validSymbol ? (
                <span className="hud-tag truncate min-w-0">
                  ↵ load <span className="text-primary">{q.toUpperCase()}</span>
                </span>
              ) : (
                <span className="hud-tag hidden sm:inline">↑↓ move · ↵ select · esc close</span>
              )}
            </div>

            <div ref={listRef} id={listId} role="listbox" aria-label="Ticker results" className="max-h-72 overflow-y-auto py-1">
              {loading ? (
                <div className="px-3 py-2.5 space-y-2" role="presentation">
                  <div className={cn("hud-tag cursor-block truncate", still)}>
                    query <span className="text-foreground/80">{q.toUpperCase()}</span>
                  </div>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={cn(shimmer, "h-3 w-12")} />
                      <div className={cn(shimmer, "h-3 flex-1")} style={{ maxWidth: `${70 - i * 15}%` }} />
                    </div>
                  ))}
                </div>
              ) : results.length === 0 ? (
                <div className="px-3 py-3 space-y-1" role="presentation">
                  <div className="text-[11px] text-muted-foreground break-all">
                    No results for <span className="text-foreground">"{q.toUpperCase()}"</span>
                  </div>
                  {validSymbol ? (
                    <div className="hud-tag">
                      press <kbd className="px-1 border border-border text-primary">↵</kbd> to load{" "}
                      <span className="text-primary">{q.toUpperCase()}</span> directly
                    </div>
                  ) : (
                    <div className="hud-tag text-amber">enter a symbol (e.g. AAPL, BRK.B) or a company name</div>
                  )}
                </div>
              ) : (
                results.map((r, i) => {
                  const isActive = i === active;
                  return (
                    <motion.button
                      key={`${r.ticker}-${i}`}
                      id={`${listId}-opt-${i}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-idx={i}
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(r.ticker)}
                      initial={animate ? { opacity: 0, x: -6 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i, 10) * 0.03, duration: 0.2 }}
                      className={cn(
                        "relative w-full px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors",
                        isActive ? "text-foreground" : "text-muted-foreground",
                      )}
                      data-testid={`search-result-${r.ticker}`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId={`ts-active-${uid}`}
                          aria-hidden
                          className="absolute inset-0 bg-up/10 border-l-2 border-primary"
                          transition={{ type: "spring", stiffness: 500, damping: 38 }}
                        />
                      )}
                      <span className="relative flex items-center gap-2.5 min-w-0">
                        <span className="text-[9.5px] text-dim tabular-nums w-4 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                        <Highlight
                          text={r.ticker}
                          q={q}
                          className={cn("font-mono text-[12.5px] font-semibold tracking-wider shrink-0", isActive && "text-primary")}
                        />
                        {r.name && <Highlight text={r.name} q={q} className="text-[11px] truncate" />}
                      </span>
                      <span className="relative flex items-center gap-2 shrink-0">
                        {r.market && <span className="hud-tag">{r.market}</span>}
                        <kbd
                          aria-hidden
                          className={cn(
                            "px-1 border text-[10px] transition-opacity",
                            isActive ? "opacity-100 border-primary/50 text-primary" : "opacity-0 border-border",
                          )}
                        >
                          ↵
                        </kbd>
                      </span>
                    </motion.button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
