import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { getFinnhubKey, getPolygonKey, getAvKey, getFmpKey, getMarketauxKey } from "@/lib/apiKeys";
import { useAnimate, useAmbient } from "@/components/hud";
import { cn } from "@/lib/utils";

type Status = "checking" | "ok" | "error" | "skipped";

interface ApiState {
  status: Status;
  latency: number | null;   // ms
  lastOk: Date | null;
  error: string | null;
}

const INITIAL: ApiState = { status: "checking", latency: null, lastOk: null, error: null };
const SKIPPED: ApiState = { status: "skipped",  latency: null, lastOk: null, error: null };

const POLL_MS = 60_000;

/**
 * Alpha Vantage's free tier is 25 calls/day, and nothing else in the app reads it,
 * so its health is sampled at most every 6h (cached across reloads) instead of on
 * the 60s poll. "Refresh now" still forces a live check.
 */
const AV_TTL_MS = 6 * 60 * 60 * 1000;
const AV_CACHE_KEY = "ghost.health.av";

interface AvCache { at: number; ok: boolean; latency: number | null; error: string | null; lastOk: number | null; keyId: string }

/** Cheap non-reversible fingerprint so a changed key invalidates the cache. */
function keyId(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h.toString(36);
}

function readAvCache(key: string): AvCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(AV_CACHE_KEY) || "null") as AvCache | null;
    return c && c.keyId === keyId(key) ? c : null;
  } catch {
    return null;
  }
}

function writeAvCache(c: AvCache) {
  try { localStorage.setItem(AV_CACHE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

function avStateFromCache(c: AvCache): ApiState {
  return {
    status: c.ok ? "ok" : "error",
    latency: c.latency,
    lastOk: c.lastOk ? new Date(c.lastOk) : null,
    error: c.error,
  };
}

// ── Check functions ───────────────────────────────────────────────────────────

async function checkFinnhub(): Promise<{ latency: number }> {
  const key = getFinnhubKey();
  const url = `https://finnhub.io/api/v1/quote?symbol=SPY&token=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  if (!data.c && data.c !== 0) throw new Error("Unexpected response");
  if (data.c === 0) throw new Error("Rate limited or no data");
  return { latency };
}

async function checkPolygon(): Promise<{ latency: number }> {
  const key = getPolygonKey();
  const url = `https://api.polygon.io/v2/aggs/ticker/SPY/prev?adjusted=true&apiKey=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === "ERROR" || data.status === "NOT_AUTHORIZED") throw new Error(data.error || "Auth failed");
  return { latency };
}

async function checkAlphaVantage(): Promise<{ latency: number }> {
  const key = getAvKey();
  // GLOBAL_QUOTE: one call, tiny payload (the old intraday series returned ~100 rows)
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&datatype=json&apikey=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.["Error Message"]) throw new Error("Invalid API key");
  if (data?.Note)              throw new Error("Rate limit reached");
  if (data?.Information)       throw new Error("API call limit reached");
  if (!data?.["Global Quote"]?.["05. price"]) throw new Error("Unexpected response");
  return { latency };
}

async function checkFmp(): Promise<{ latency: number }> {
  const key = getFmpKey();
  const url = `https://financialmodelingprep.com/stable/quote-short?symbol=SPY&apikey=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.["Error Message"] || data?.message?.includes("Invalid")) throw new Error("Invalid API key");
  if (!Array.isArray(data) || data.length === 0) throw new Error("Unexpected response");
  return { latency };
}

async function checkMarketaux(): Promise<{ latency: number }> {
  const key = getMarketauxKey();
  const url = `https://api.marketaux.com/v1/news/all?symbols=AAPL&filter_entities=true&language=en&limit=1&api_token=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || data.error.code || "Invalid key");
  // meta.found >= 0 means key is valid even if no articles
  if (typeof data?.meta?.found === "undefined" && !data?.data) throw new Error("Unexpected response");
  return { latency };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Latency → tone. <600ms fast, <1500ms slow, else sluggish. */
function latencyTone(ms: number | null): "hit" | "amber" | "down" {
  if (ms === null) return "hit";
  return ms < 600 ? "hit" : ms < 1500 ? "amber" : "down";
}

const TONE_BG: Record<"hit" | "amber" | "down", string> = { hit: "bg-hit", amber: "bg-amber", down: "bg-down" };
const TONE_TEXT: Record<"hit" | "amber" | "down", string> = { hit: "text-hit", amber: "text-amber", down: "text-down" };

/** Scale used for the latency bar: 2.5s fills the track. */
const LATENCY_CAP = 2500;

type Outcome = "ok" | "error";
interface HistoryEntry { o: Outcome; n: number }
type HistoryKey = "fh" | "poly" | "av" | "fmp" | "maux";
const HISTORY_LEN = 12;

// ── Status light ──────────────────────────────────────────────────────────────

/** .live-dot with tone; the ping ring only runs when ambient motion is on. */
function LiveDot({ tone, className }: { tone?: "amber" | "red" | "dim"; className?: string }) {
  const ambient = useAmbient();
  return <span className={cn("live-dot shrink-0", !ambient && "after:!animate-none", className)} data-tone={tone} aria-hidden />;
}

function StatusLight({ status }: { status: Status }) {
  const tone = status === "skipped" ? "dim" : status === "checking" ? "amber" : status === "error" ? "red" : undefined;
  return <LiveDot tone={tone} />;
}

// ── Row in popover ────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<Status, string> = {
  ok: "Online",
  error: "Error",
  checking: "Sampling",
  skipped: "No key",
};

function ApiRow({
  label,
  state,
  noKeyLabel,
  cadence,
  history,
  index,
}: {
  label: string;
  state: ApiState;
  noKeyLabel?: string;
  /** Shown after "Last ok" when this provider is sampled less often than the main poll. */
  cadence?: string;
  history: HistoryEntry[];
  index: number;
}) {
  const animate = useAnimate();
  const ambient = useAmbient();
  const tone = latencyTone(state.latency);
  const pct = state.latency !== null ? Math.max(4, Math.min(100, (state.latency / LATENCY_CAP) * 100)) : 0;
  const statusColor =
    state.status === "ok" ? "text-hit" :
    state.status === "error" ? "text-down" :
    state.status === "checking" ? "text-amber" : "text-dim";

  return (
    <motion.li
      initial={animate ? { opacity: 0, x: 8 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: 0.05 + index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
      className="group/row relative px-3 py-2.5 space-y-1.5 border-l-2 border-transparent hover:border-primary/60 hover:bg-primary/[.04] transition-colors"
      data-testid={`api-health-row-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      {/* Name + status */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusLight status={state.status} />
          <span className="text-[11px] uppercase tracking-[.12em] text-foreground truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {state.status === "ok" && (
            <span className={cn("text-[11px] tabular-nums", TONE_TEXT[tone])}>{formatLatency(state.latency)}</span>
          )}
          <span className={cn("hud-tag !tracking-[.12em]", statusColor)}>{STATUS_TEXT[state.status]}</span>
        </div>
      </div>

      {/* Latency bar */}
      <div className="relative h-[3px] bg-muted overflow-hidden" aria-hidden>
        {state.status === "ok" && (
          <motion.span
            className={cn("absolute inset-y-0 left-0", TONE_BG[tone])}
            initial={animate ? { width: 0 } : false}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 160, damping: 24 }}
          />
        )}
        {state.status === "error" && (
          <span
            className="absolute inset-0"
            style={{ background: "repeating-linear-gradient(135deg, hsl(var(--down) / .55) 0 4px, transparent 4px 8px)" }}
          />
        )}
        {state.status === "checking" && (
          <span className={cn("absolute inset-0 bg-gradient-to-r from-transparent via-amber to-transparent", ambient ? "animate-scan-x" : "opacity-50")} />
        )}
        {state.status === "skipped" && (
          <span className="absolute inset-0 border-t border-dashed border-dim/50" />
        )}
      </div>

      {/* Detail line + recent check history */}
      <div className="flex items-center justify-between gap-3 min-h-[14px]">
        <div className="text-[10px] text-muted-foreground min-w-0">
          {state.status === "skipped" && (
            <span className="text-dim italic">{noKeyLabel ?? "No key set"}</span>
          )}
          {state.status === "ok" && state.lastOk && (
            <span className="tabular-nums">Last ok {formatTime(state.lastOk)}{cadence && <span className="text-dim"> · {cadence}</span>}</span>
          )}
          {state.status === "error" && (
            <span className="block">
              <span className="text-down break-words">{state.error}</span>
              <span className="block tabular-nums">
                {state.lastOk ? `Last ok ${formatTime(state.lastOk)}` : "Never succeeded"}
              </span>
            </span>
          )}
          {state.status === "checking" && <span>Checking…</span>}
        </div>
        {history.length > 0 && (
          <div
            className="flex gap-[2px] shrink-0"
            role="img"
            aria-label={`Last ${history.length} checks: ${history.filter((h) => h.o === "ok").length} ok, ${history.filter((h) => h.o === "error").length} failed`}
          >
            {history.map((h) => (
              <motion.span
                key={h.n}
                title={h.o === "ok" ? "check ok" : "check failed"}
                className={cn("block w-[5px] h-[8px] origin-bottom", h.o === "ok" ? "bg-hit/80" : "bg-down/80")}
                initial={animate ? { scaleY: 0, opacity: 0 } : false}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: 0.25 }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.li>
  );
}

// ── Poll countdown (only mounted while the popover is open) ───────────────────

function PollCountdown({ lastPoll }: { lastPoll: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = Math.min(POLL_MS, Math.max(0, now - lastPoll));
  const remaining = Math.ceil((POLL_MS - elapsed) / 1000);
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="hud-tag tabular-nums whitespace-nowrap">Next poll {remaining}s</span>
      <span className="relative flex-1 h-px bg-border min-w-[24px]" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 bg-primary/70 transition-[width] duration-1000 ease-linear"
          style={{ width: `${(elapsed / POLL_MS) * 100}%` }}
        />
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ApiHealthIndicator() {
  const [fh,   setFh]   = useState<ApiState>(INITIAL);
  const [poly, setPoly] = useState<ApiState>(INITIAL);
  const [av,   setAv]   = useState<ApiState>(getAvKey()  ? INITIAL : SKIPPED);
  const [fmp,  setFmp]  = useState<ApiState>(getFmpKey()       ? INITIAL : SKIPPED);
  const [maux, setMaux] = useState<ApiState>(getMarketauxKey() ? INITIAL : SKIPPED);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Visual-only additions: recent outcome history per provider + poll timestamp
  const [history, setHistory] = useState<Record<HistoryKey, HistoryEntry[]>>({ fh: [], poly: [], av: [], fmp: [], maux: [] });
  const [lastPoll, setLastPoll] = useState(() => Date.now());
  const seqRef = useRef(0);
  const record = useCallback((k: HistoryKey, o: Outcome) => {
    const n = ++seqRef.current;
    setHistory((h) => ({ ...h, [k]: [...h[k], { o, n }].slice(-HISTORY_LEN) }));
  }, []);

  const run = useCallback((forceAv = false) => {
    // Finnhub (always has a default key)
    setFh(prev => ({ ...prev, status: "checking" }));
    checkFinnhub()
      .then(({ latency }) => { setFh({ status: "ok", latency, lastOk: new Date(), error: null }); record("fh", "ok"); })
      .catch(err => { setFh(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })); record("fh", "error"); });

    // Polygon (always has a default key)
    setPoly(prev => ({ ...prev, status: "checking" }));
    checkPolygon()
      .then(({ latency }) => { setPoly({ status: "ok", latency, lastOk: new Date(), error: null }); record("poly", "ok"); })
      .catch(err => { setPoly(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })); record("poly", "error"); });

    // Alpha Vantage — only if key is set, and only when the cached result is stale (or forced)
    const avKey = getAvKey();
    if (avKey) {
      const cached = readAvCache(avKey);
      if (!forceAv && cached && Date.now() - cached.at < AV_TTL_MS) {
        setAv(avStateFromCache(cached));
      } else {
        const id = keyId(avKey);
        setAv(prev => ({ ...prev, status: "checking" }));
        checkAlphaVantage()
          .then(({ latency }) => {
            const now = Date.now();
            writeAvCache({ at: now, ok: true, latency, error: null, lastOk: now, keyId: id });
            setAv({ status: "ok", latency, lastOk: new Date(now), error: null });
            record("av", "ok");
          })
          .catch(err => {
            const lastOk = cached?.lastOk ?? null;
            writeAvCache({ at: Date.now(), ok: false, latency: null, error: err.message, lastOk, keyId: id });
            setAv(prev => ({ status: "error", latency: null, lastOk: prev.lastOk ?? (lastOk ? new Date(lastOk) : null), error: err.message }));
            record("av", "error");
          });
      }
    } else {
      setAv(SKIPPED);
    }

    // FMP — only if key is set
    if (getFmpKey()) {
      setFmp(prev => ({ ...prev, status: "checking" }));
      checkFmp()
        .then(({ latency }) => { setFmp({ status: "ok", latency, lastOk: new Date(), error: null }); record("fmp", "ok"); })
        .catch(err => { setFmp(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })); record("fmp", "error"); });
    } else {
      setFmp(SKIPPED);
    }

    // Marketaux — only if key is set
    if (getMarketauxKey()) {
      setMaux(prev => ({ ...prev, status: "checking" }));
      checkMarketaux()
        .then(({ latency }) => { setMaux({ status: "ok", latency, lastOk: new Date(), error: null }); record("maux", "ok"); })
        .catch(err => { setMaux(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })); record("maux", "error"); });
    } else {
      setMaux(SKIPPED);
    }
  }, [record]);

  useEffect(() => {
    const poll = () => { setLastPoll(Date.now()); run(); };
    poll();
    intervalRef.current = setInterval(poll, POLL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Summary logic (ignores skipped APIs)
  const active = [fh, poly, ...(getAvKey() ? [av] : []), ...(getFmpKey() ? [fmp] : []), ...(getMarketauxKey() ? [maux] : [])];
  const anyChecking = active.some(s => s.status === "checking");
  // While a provider is re-polling, keep its previous verdict (state keeps error/lastOk)
  // so the chip doesn't flicker every 60s; only providers never seen read "checking".
  const verdicts    = active.map(s =>
    s.status === "ok" || s.status === "error" ? s.status
    : s.error !== null ? "error" : s.lastOk ? "ok" : null);
  const known       = verdicts.filter(v => v !== null).length;
  const okCount     = verdicts.filter(v => v === "ok").length;
  const errCount    = verdicts.filter(v => v === "error").length;

  type Tone = "ok" | "amber" | "red";
  const tone: Tone = known === 0 ? "amber" : errCount === 0 ? "ok" : errCount >= known ? "red" : "amber";
  const summaryLabel =
    known === 0 ? "Checking"
    : errCount === 0 ? "APIs OK"
    : errCount >= known ? "API Error"
    : "Degraded";

  // Re-checking providers keep their previous latency, so the average doesn't blank every poll.
  const latencies = active
    .filter(s => (s.status === "ok" || s.status === "checking") && s.latency !== null)
    .map(s => s.latency as number);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  // ── Popover state ───────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const popId = useId();
  const animate = useAnimate();
  const ambient = useAmbient();

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(340, vw - 16);
    const left = Math.max(8, Math.min(r.right - width, vw - width - 8));
    setPos({ top: r.bottom + 8, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the (portalled) popover once per open so keyboard users can reach
  // REFRESH NOW; the popover lives at the end of <body>, outside the header's tab order.
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!open) { focusedRef.current = false; return; }
    if (focusedRef.current || !pos || !popRef.current) return;
    focusedRef.current = true;
    popRef.current.focus({ preventScroll: true });
  }, [open, pos]);

  // Close when keyboard focus leaves both the popover and the chip.
  const onPopBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next) return; // focus went to the page/body (e.g. a click) — handled by pointerdown
    if (popRef.current?.contains(next) || btnRef.current?.contains(next)) return;
    setOpen(false);
  };

  const dotTone = tone === "ok" ? undefined : tone;
  const labelColor = tone === "ok" ? "text-hit" : tone === "red" ? "text-down" : "text-amber";

  const rows: { key: HistoryKey; label: string; state: ApiState; noKeyLabel?: string; cadence?: string }[] = [
    { key: "fh", label: "Finnhub", state: fh },
    { key: "poly", label: "Polygon", state: poly },
    { key: "av", label: "Alpha Vantage", state: av, noKeyLabel: "Add key in Settings", cadence: "checked every 6h" },
    { key: "fmp", label: "FMP", state: fmp, noKeyLabel: "Add key in Settings" },
    { key: "maux", label: "Marketaux", state: maux, noKeyLabel: "Add key in Settings (optional)" },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          "hud-chip relative overflow-hidden focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:outline-offset-2",
          open && "!border-primary/70 !text-foreground",
        )}
        data-testid="api-health-indicator"
        aria-label={`API connectivity status: ${summaryLabel}. ${okCount} of ${active.length} online`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        title={`${summaryLabel} — ${okCount}/${active.length} online`}
      >
        <LiveDot tone={dotTone} />
        <span className={cn("hidden lg:inline", labelColor)}>{summaryLabel}</span>
        {anyChecking && (
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
            <span className={cn("block h-full w-full bg-gradient-to-r from-transparent via-amber to-transparent", ambient ? "animate-scan-x" : "opacity-50")} />
          </span>
        )}
      </button>

      {typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              key="api-health-pop"
              ref={popRef}
              id={popId}
              role="dialog"
              aria-label="API health"
              tabIndex={-1}
              onBlur={onPopBlur}
              className="hud-panel fixed z-[90] shadow-xl text-xs outline-none"
              style={{ top: pos.top, left: pos.left, width: pos.width, transformOrigin: "top right" }}
              initial={animate ? { opacity: 0, y: -6, scale: 0.98 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={animate ? { opacity: 0, y: -4, scale: 0.98 } : undefined}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              data-testid="api-health-popover"
            >
              {/* one-shot top scan */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 top-0 h-px origin-left"
                style={{ background: "linear-gradient(90deg, transparent, hsl(var(--up)), transparent)" }}
                initial={animate ? { scaleX: 0 } : false}
                animate={{ scaleX: 1, opacity: [1, 1, 0.35] }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />

              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-3 h-9 border-b border-border/70">
                <div className="flex items-center gap-2 min-w-0">
                  <LiveDot tone={dotTone} />
                  <span className="hud-title">API Health</span>
                  <span className={cn("hud-tag", labelColor)}>{summaryLabel}</span>
                </div>
                <span className="hud-tag tabular-nums shrink-0">
                  <span className="text-foreground">{okCount}</span>/{active.length} online
                </span>
              </div>

              {/* Summary strip */}
              <div className="grid grid-cols-3 border-b border-border/70 text-center">
                <div className="py-2 border-r border-border/70">
                  <div className="hud-tag">Online</div>
                  <div className="text-sm tabular-nums text-hit glow-hit">{okCount}</div>
                </div>
                <div className="py-2 border-r border-border/70">
                  <div className="hud-tag">Errors</div>
                  <div className={cn("text-sm tabular-nums", errCount ? "text-down glow-red" : "text-dim")}>{errCount}</div>
                </div>
                <div className="py-2">
                  <div className="hud-tag">Avg latency</div>
                  <div className={cn("text-sm tabular-nums", avgLatency === null ? "text-dim" : TONE_TEXT[latencyTone(avgLatency)])}>
                    {avgLatency === null ? "—" : formatLatency(avgLatency)}
                  </div>
                </div>
              </div>

              {/* Provider rows */}
              <ul className="divide-y divide-border/60 max-h-[min(60vh,420px)] overflow-y-auto">
                {rows.map((r, i) => (
                  <ApiRow
                    key={r.key}
                    label={r.label}
                    state={r.state}
                    noKeyLabel={r.noKeyLabel}
                    cadence={r.cadence}
                    history={history[r.key]}
                    index={i}
                  />
                ))}
              </ul>

              {/* Footer */}
              <div className="border-t border-border/70 px-3 py-2 flex items-center justify-between gap-3">
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <span className="hud-tag" title="Alpha Vantage free tier is 25 calls/day, so it is sampled every 6h unless you press Refresh now">
                    Every 60s · Alpha Vantage 6h
                  </span>
                  <PollCountdown lastPoll={lastPoll} />
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); run(true); }}
                  className="hud-btn !h-7 shrink-0"
                  data-testid="button-health-refresh"
                  aria-label="Refresh API health now"
                >
                  <RefreshCw className={cn("w-3 h-3", anyChecking && ambient && "animate-spin")} />
                  Refresh now
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
