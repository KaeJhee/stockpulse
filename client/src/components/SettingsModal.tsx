import { useState, useEffect, useRef, useId, type ReactNode, type Ref, type MutableRefObject, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X, Settings, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Trash2, Activity, Lock, ExternalLink } from "lucide-react";
import {
  getFinnhubKey, getPolygonKey, getAvKey, getFmpKey, getMarketauxKey,
  setFinnhubKey, setPolygonKey, setAvKey, setFmpKey, setMarketauxKey,
  getStoredKeys,
} from "@/lib/apiKeys";
import { GhostMark, useAnimate, useAmbient } from "@/components/hud";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TestStatus = "idle" | "loading" | "ok" | "fail";

interface KeyRowProps {
  label: string;
  description: string;
  docsUrl: string;
  value: string;
  onChange: (v: string) => void;
  onTest: () => Promise<void>;
  onRemove: () => void;
  testStatus: TestStatus;
  testMessage: string;
  hasStored: boolean;
  optional?: boolean;
  /** A built-in shared key is used when nothing is stored. */
  hasDefault?: boolean;
  /** Entrance stagger index. */
  index?: number;
  inputRef?: Ref<HTMLInputElement>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Terminal-style typed text. Renders the final string when motion is off.
 * Progress is derived from elapsed wall-clock time (not tick count), so throttled
 * timers in background tabs just jump ahead instead of stalling; a hard timeout
 * guarantees the full text is shown.
 */
function TypedLine({ text, speed = 16 }: { text: string; speed?: number }) {
  const animate = useAnimate();
  const [n, setN] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate || text.length === 0) {
      setN(text.length);
      return;
    }
    setN(0);
    const t0 = Date.now();
    const total = text.length * speed;
    const id = window.setInterval(() => {
      const next = Math.min(text.length, Math.floor((Date.now() - t0) / speed));
      setN(next);
      if (next >= text.length) window.clearInterval(id);
    }, speed);
    const done = window.setTimeout(() => { window.clearInterval(id); setN(text.length); }, total + 250);
    return () => { window.clearInterval(id); window.clearTimeout(done); };
  }, [text, animate, speed]);

  const done = n >= text.length;
  return (
    <span>
      {/* Full text for assistive tech (inside the aria-live region), typed copy for sighted users */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, n)}</span>
      {!done && <span aria-hidden className="inline-block w-[.55em] h-[1em] align-[-2px] ml-px bg-current opacity-70" />}
    </span>
  );
}

const DECODE_GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=<>/";

/** Scramble→decode title. Timer-based (not rAF) and never renders empty. */
function DecodeTitle({ text, duration = 520 }: { text: string; duration?: number }) {
  const animate = useAnimate();
  const scramble = (settled: number) => {
    let s = text.slice(0, settled);
    for (let i = settled; i < text.length; i++) {
      s += text[i] === " " ? " " : DECODE_GLYPHS[(Math.random() * DECODE_GLYPHS.length) | 0];
    }
    return s;
  };
  const [out, setOut] = useState(() => (animate ? scramble(0) : text));

  useEffect(() => {
    if (!animate) { setOut(text); return; }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      if (t >= 1) { window.clearInterval(id); setOut(text); return; }
      setOut(scramble(Math.floor(t * text.length)));
    }, 40);
    const done = window.setTimeout(() => { window.clearInterval(id); setOut(text); }, duration + 200);
    return () => { window.clearInterval(id); window.clearTimeout(done); };
  }, [text, animate, duration]); // `scramble` is derived from `text`

  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{out}</span>
    </>
  );
}

function SectionLabel({ children, index = 0 }: { children: ReactNode; index?: number }) {
  const animate = useAnimate();
  return (
    <motion.div
      className="flex items-center gap-3 pt-2"
      initial={animate ? { opacity: 0, x: -6 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.08 + index * 0.06 }}
    >
      <span className="hud-label whitespace-nowrap">
        <span className="text-primary">//</span> {children}
      </span>
      <span className="hud-divider flex-1" />
    </motion.div>
  );
}

const HIT_GLOW = { boxShadow: "0 0 calc(14px * var(--glow-strength)) hsl(var(--hit) / .35)" };
const RED_GLOW = { boxShadow: "0 0 calc(14px * var(--glow-strength)) hsl(var(--down) / .3)" };

// ─────────────────────────────────────────────────────────────────────────────
// Individual key row — terminal block
// ─────────────────────────────────────────────────────────────────────────────

function KeyRow({
  label, description, docsUrl,
  value, onChange, onTest, onRemove,
  testStatus, testMessage, hasStored, optional, hasDefault,
  index = 0, inputRef,
}: KeyRowProps) {
  const [show, setShow] = useState(false);
  const animate = useAnimate();
  const ambient = useAmbient();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = (el: HTMLInputElement | null) => {
    localInputRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as MutableRefObject<HTMLInputElement | null>).current = el;
  };
  // The REMOVE button unmounts after click; hand focus to the input so it isn't dropped on <body>.
  const handleRemove = () => {
    onRemove();
    localInputRef.current?.focus({ preventScroll: true });
  };
  const inputId = useId();
  const descId = useId();
  const msgId = useId();

  const rail =
    testStatus === "ok" ? "bg-hit" :
    testStatus === "fail" ? "bg-down" :
    testStatus === "loading" ? "bg-amber" :
    hasStored ? "bg-up" : "bg-border";

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + index * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "group/key relative border border-card-border bg-background/50 pl-4 pr-3 py-3 space-y-3 transition-colors duration-200",
        "hover:border-primary/40 focus-within:border-primary/60",
      )}
      data-testid={`settings-key-${label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`}
    >
      {/* status rail */}
      <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-[2px] transition-colors duration-300", rail)} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-primary text-xs" aria-hidden>&gt;</span>
            <span className="text-[12px] font-semibold uppercase tracking-[.14em] text-foreground">{label}</span>
            {optional && (
              <span className="hud-tag border border-card-border px-1.5 py-px">Optional</span>
            )}
          </div>
          <p id={descId} className="font-read text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hud-tag !text-primary/80 hover:!text-primary inline-flex items-center gap-1 mt-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
          >
            Get a free key <ExternalLink className="w-2.5 h-2.5" aria-hidden />
          </a>
        </div>
        <div className="shrink-0">
          {hasStored ? (
            <span className="inline-flex items-center gap-1.5 hud-tag !text-hit border border-hit/40 bg-hit/10 px-1.5 py-0.5">
              <span className={cn("live-dot", !ambient && "after:!animate-none")} aria-hidden />
              Key set
            </span>
          ) : hasDefault ? (
            <span className="hud-tag border border-card-border px-1.5 py-0.5">Default key</span>
          ) : (
            <span className="hud-tag border border-dashed border-card-border px-1.5 py-0.5">No key</span>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="flex items-stretch border border-input bg-background transition-shadow focus-within:border-primary/70 focus-within:shadow-[0_0_0_1px_hsl(var(--primary)/.25)]">
        <label htmlFor={inputId} className="hidden sm:flex items-center px-2.5 hud-tag border-r border-input select-none">
          Key
        </label>
        <input
          id={inputId}
          ref={setInputRef}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your API key here…"
          aria-label={`${label} API key`}
          aria-describedby={testMessage ? `${descId} ${msgId}` : descId}
          className="flex-1 min-w-0 bg-transparent px-3 py-2 text-xs font-mono tabular-nums tracking-wider text-foreground focus:outline-none placeholder:text-muted-foreground/50 placeholder:tracking-normal"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Hide ${label} key` : `Show ${label} key`}
          aria-pressed={show}
          title={show ? "Hide key" : "Show key"}
          className="px-2.5 border-l border-input text-muted-foreground hover:text-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary transition-colors"
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={testStatus === "loading" || !value.trim()}
            aria-label={`Test ${label} API key`}
            aria-busy={testStatus === "loading"}
            className={cn(
              "hud-btn relative overflow-hidden min-w-[92px] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none",
              testStatus === "ok" && "!text-hit !border-hit/60",
              testStatus === "fail" && "!text-down !border-down/60",
              testStatus === "loading" && "!opacity-100 !text-amber !border-amber/50",
            )}
            style={testStatus === "ok" ? HIT_GLOW : testStatus === "fail" ? RED_GLOW : undefined}
          >
            {testStatus === "loading" && (
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
                <span className={cn("block h-full w-full bg-gradient-to-r from-transparent via-amber to-transparent", ambient ? "animate-scan-x" : "opacity-60")} />
              </span>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={testStatus}
                className="inline-flex items-center gap-1.5"
                initial={animate ? { opacity: 0, y: 4 } : false}
                animate={{ opacity: 1, y: 0 }}
                exit={animate ? { opacity: 0, y: -4 } : undefined}
                transition={{ duration: 0.16 }}
              >
                {testStatus === "loading" ? (
                  <><Loader2 className={cn("w-3 h-3", ambient && "animate-spin")} /> Testing</>
                ) : testStatus === "ok" ? (
                  <><CheckCircle2 className="w-3 h-3" /> <span className="glow-hit">OK</span></>
                ) : testStatus === "fail" ? (
                  <><XCircle className="w-3 h-3" /> <span className="glow-red">Fail</span></>
                ) : (
                  <><Activity className="w-3 h-3" /> Test API</>
                )}
              </motion.span>
            </AnimatePresence>
          </button>

          <AnimatePresence initial={false}>
            {hasStored && (
              <motion.button
                key="remove"
                type="button"
                onClick={handleRemove}
                aria-label={`Remove stored ${label} key`}
                initial={animate ? { opacity: 0, x: -6 } : false}
                animate={{ opacity: 1, x: 0 }}
                exit={animate ? { opacity: 0, x: -6 } : undefined}
                transition={{ duration: 0.18 }}
                className="hud-btn text-down/80 hover:!text-down hover:!border-down/60"
              >
                <Trash2 className="w-3 h-3" />
                Remove
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div aria-live="polite" id={msgId}>
          <AnimatePresence initial={false}>
            {testMessage && (
              <motion.div
                key={testMessage}
                initial={animate ? { opacity: 0, height: 0 } : false}
                animate={{ opacity: 1, height: "auto" }}
                exit={animate ? { opacity: 0, height: 0 } : undefined}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  className={cn(
                    "flex items-start gap-2 px-2.5 py-1.5 text-[11px] font-mono border-l-2",
                    testStatus === "ok" ? "border-hit bg-hit/10 text-hit" : "border-down bg-down/10 text-down",
                  )}
                >
                  <span className="shrink-0 opacity-80">{testStatus === "ok" ? "[OK]" : "[ERR]"}</span>
                  <span className="min-w-0 break-words">
                    <TypedLine text={testMessage} />
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Modal
// ─────────────────────────────────────────────────────────────────────────────

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  // Key values
  const [finnhub, setFinnhubVal] = useState("");
  const [polygon, setPolygonVal] = useState("");
  const [av,      setAvVal]      = useState("");
  const [fmp,     setFmpVal]     = useState("");
  const [marketaux, setMarketauxVal] = useState("");

  // Stored flags
  const [finnhubStored, setFinnhubStored] = useState(false);
  const [polygonStored, setPolygonStored] = useState(false);
  const [avStored,      setAvStored]      = useState(false);
  const [fmpStored,     setFmpStored]     = useState(false);
  const [marketauxStored, setMarketauxStored] = useState(false);

  // Test state per key
  const [finnhubTest, setFinnhubTest] = useState<TestStatus>("idle");
  const [finnhubMsg,  setFinnhubMsg]  = useState("");
  const [polygonTest, setPolygonTest] = useState<TestStatus>("idle");
  const [polygonMsg,  setPolygonMsg]  = useState("");
  const [avTest,      setAvTest]      = useState<TestStatus>("idle");
  const [avMsg,       setAvMsg]       = useState("");
  const [fmpTest,     setFmpTest]     = useState<TestStatus>("idle");
  const [fmpMsg,      setFmpMsg]      = useState("");
  const [marketauxTest, setMarketauxTest] = useState<TestStatus>("idle");
  const [marketauxMsg,  setMarketauxMsg]  = useState("");

  const [saved, setSaved] = useState(false);

  const animate = useAnimate();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  // Load stored keys on open
  useEffect(() => {
    if (!open) return;
    const stored = getStoredKeys();
    setFinnhubVal(stored.finnhub);
    setPolygonVal(stored.polygon);
    setAvVal(stored.av);
    setFmpVal(stored.fmp);
    setMarketauxVal(stored.marketaux);
    setFinnhubStored(!!stored.finnhub);
    setPolygonStored(!!stored.polygon);
    setAvStored(!!stored.av);
    setFmpStored(!!stored.fmp);
    setMarketauxStored(!!stored.marketaux);
    setFinnhubTest("idle"); setFinnhubMsg("");
    setPolygonTest("idle"); setPolygonMsg("");
    setAvTest("idle");      setAvMsg("");
    setFmpTest("idle");     setFmpMsg("");
    setMarketauxTest("idle"); setMarketauxMsg("");
    setSaved(false);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus first field on open, restore focus on close, lock page scroll
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => firstFieldRef.current?.focus({ preventScroll: true }), 60);
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus({ preventScroll: true });
    };
  }, [open]);

  // Keep Tab focus inside the dialog
  function trapFocus(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (!active || !dialogRef.current.contains(active) || active === dialogRef.current) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  // ── Test functions ──────────────────────────────────────────────────────────

  async function testFinnhub() {
    const key = finnhub.trim();
    if (!key) return;
    setFinnhubTest("loading"); setFinnhubMsg("");
    try {
      const res  = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${key}`);
      const data = await res.json();
      if (data?.c && data.c > 0) {
        setFinnhubTest("ok");
        setFinnhubMsg(`✓ AAPL $${data.c.toFixed(2)}`);
      } else if (data?.error) {
        setFinnhubTest("fail"); setFinnhubMsg(data.error);
      } else {
        setFinnhubTest("fail"); setFinnhubMsg("No data returned — check your key");
      }
    } catch { setFinnhubTest("fail"); setFinnhubMsg("Network error"); }
  }

  async function testPolygon() {
    const key = polygon.trim();
    if (!key) return;
    setPolygonTest("loading"); setPolygonMsg("");
    try {
      const res  = await fetch(`https://api.polygon.io/v2/aggs/ticker/AAPL/prev?apiKey=${key}`);
      const data = await res.json();
      if (data?.results?.length > 0) {
        setPolygonTest("ok");
        setPolygonMsg(`✓ AAPL prev close $${data.results[0].c.toFixed(2)}`);
      } else if (data?.status === "ERROR" || data?.error) {
        setPolygonTest("fail"); setPolygonMsg(data.error || data.message || "Invalid key");
      } else {
        setPolygonTest("fail"); setPolygonMsg("No data returned — check your key");
      }
    } catch { setPolygonTest("fail"); setPolygonMsg("Network error"); }
  }

  async function testAv() {
    const key = av.trim();
    if (!key) return;
    setAvTest("loading"); setAvMsg("");
    try {
      const res  = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${key}`);
      const data = await res.json();
      if (data?.["Note"]) {
        setAvTest("fail"); setAvMsg("Rate limit hit — wait 1 minute and try again");
      } else if (data?.["Information"]) {
        setAvTest("fail"); setAvMsg("Daily limit reached (25 req/day on free tier)");
      } else if (data?.["Global Quote"]?.["05. price"]) {
        const price = parseFloat(data["Global Quote"]["05. price"]);
        setAvTest("ok"); setAvMsg(`✓ AAPL $${price.toFixed(2)}`);
      } else {
        setAvTest("fail"); setAvMsg("No data returned — check your key");
      }
    } catch { setAvTest("fail"); setAvMsg("Network error"); }
  }

  async function testFmp() {
    const key = fmp.trim();
    if (!key) return;
    setFmpTest("loading"); setFmpMsg("");
    try {
      const res  = await fetch(`https://financialmodelingprep.com/stable/quote-short?symbol=AAPL&apikey=${key}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].price) {
        setFmpTest("ok"); setFmpMsg(`✓ AAPL $${data[0].price.toFixed(2)}`);
      } else if (data?.["Error Message"]) {
        setFmpTest("fail"); setFmpMsg(data["Error Message"]);
      } else if (typeof data === "object" && "message" in data) {
        setFmpTest("fail"); setFmpMsg(String(data.message));
      } else {
        setFmpTest("fail"); setFmpMsg("No data returned — check your key");
      }
    } catch { setFmpTest("fail"); setFmpMsg("Network error"); }
  }

  async function testMarketaux() {
    const key = marketaux.trim();
    if (!key) return;
    setMarketauxTest("loading"); setMarketauxMsg("");
    try {
      const res  = await fetch(`https://api.marketaux.com/v1/news/all?symbols=AAPL&filter_entities=true&language=en&limit=1&api_token=${key}`);
      const data = await res.json();
      if (data?.error) {
        setMarketauxTest("fail"); setMarketauxMsg(data.error.message || data.error.code || "Invalid key");
      } else if (data?.data?.length > 0) {
          setMarketauxTest("ok"); setMarketauxMsg(`✓ ${data.meta?.found ?? data.data.length} articles found`);
      } else if (data?.meta?.found === 0) {
        setMarketauxTest("ok"); setMarketauxMsg("✓ Key valid (no recent AAPL articles)");
      } else {
        setMarketauxTest("fail"); setMarketauxMsg("Unexpected response — check key");
      }
    } catch { setMarketauxTest("fail"); setMarketauxMsg("Network error"); }
  }

  // ── Remove functions ────────────────────────────────────────────────────────

  function removeFinnhub() { setFinnhubKey(""); setFinnhubVal(""); setFinnhubStored(false); setFinnhubTest("idle"); setFinnhubMsg(""); }
  function removePolygon()  { setPolygonKey("");  setPolygonVal("");  setPolygonStored(false);  setPolygonTest("idle");  setPolygonMsg(""); }
  function removeAv()       { setAvKey("");       setAvVal("");       setAvStored(false);       setAvTest("idle");       setAvMsg(""); }
  function removeFmp()      { setFmpKey("");      setFmpVal("");      setFmpStored(false);      setFmpTest("idle");      setFmpMsg(""); }
  function removeMarketaux() { setMarketauxKey(""); setMarketauxVal(""); setMarketauxStored(false); setMarketauxTest("idle"); setMarketauxMsg(""); }

  // ── Save & Close ────────────────────────────────────────────────────────────

  function handleSave() {
    setFinnhubKey(finnhub);
    setPolygonKey(polygon);
    setAvKey(av);
    setFmpKey(fmp);
    setMarketauxKey(marketaux);
    setFinnhubStored(!!finnhub.trim());
    setPolygonStored(!!polygon.trim());
    setAvStored(!!av.trim());
    setFmpStored(!!fmp.trim());
    setMarketauxStored(!!marketaux.trim());
    setSaved(true);
    setTimeout(() => {
      onClose();
      window.location.reload();
    }, 1200);
  }

  // Key-status tile strip (Kronos-style): one tile per provider
  const tiles: { name: string; on: boolean }[] = [
    { name: "Finnhub", on: finnhubStored },
    { name: "Polygon", on: polygonStored },
    { name: "Alpha Vantage", on: avStored },
    { name: "FMP", on: fmpStored },
    { name: "Marketaux", on: marketauxStored },
  ];
  const setCount = tiles.filter((t) => t.on).length;

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100]" key="settings-modal">
          {/* Backdrop: dim stage + faint scanlines (no heavy blur) */}
          <motion.div
            className="absolute inset-0 bg-background/80"
            style={{ backgroundImage: "repeating-linear-gradient(0deg, hsl(var(--primary) / calc(.025 * var(--glow-strength))) 0 1px, transparent 1px 3px)" }}
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            exit={animate ? { opacity: 0 } : undefined}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />

          {/* Modal */}
          <div
            className="absolute inset-0 flex items-center justify-center p-3 sm:p-6"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onKeyDown={trapFocus}
              onClick={(e) => e.stopPropagation()}
              initial={animate ? { opacity: 0, scale: 0.96, y: 10 } : false}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={animate ? { opacity: 0, scale: 0.97, y: 6 } : undefined}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              className="hud-panel relative w-full max-w-xl flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[min(88vh,820px)] shadow-xl"
              data-testid="settings-modal"
            >
              {/* one-shot top scan line */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 top-0 h-px origin-left"
                style={{ background: "linear-gradient(90deg, transparent, hsl(var(--up)), transparent)" }}
                initial={animate ? { scaleX: 0 } : false}
                animate={{ scaleX: 1, opacity: [1, 1, 0.4] }}
                transition={{ duration: 0.9, delay: 0.1, ease: "easeOut" }}
              />

              {/* Header */}
              <div className="flex items-center justify-between gap-3 px-4 sm:px-5 h-12 border-b border-border/70 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <GhostMark size={6} />
                  <h2 id={titleId} className="hud-title truncate">
                    <DecodeTitle text="API Settings" />
                  </h2>
                  <span className="hud-tag hidden sm:inline">// local keys</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close settings"
                  className="hud-btn !px-2 hover:!text-down hover:!border-down/60"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-3">
                {/* Status strip */}
                <div className="flex flex-wrap items-center justify-between gap-3 border border-card-border bg-background/40 px-3 py-2.5">
                  <p className="flex items-start gap-2 text-[11px] text-muted-foreground font-read leading-relaxed min-w-0 flex-1 basis-56">
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden />
                    Keys are saved in your browser only — never sent to any server or stored in code.
                  </p>
                  <div className="flex items-center gap-2 shrink-0" aria-label={`${setCount} of 5 custom keys set`}>
                    <div className="flex gap-[3px]" aria-hidden>
                      {tiles.map((t, i) => (
                        <motion.span
                          key={t.name}
                          title={`${t.name}: ${t.on ? "key set" : "not set"}`}
                          className={cn("block w-2.5 h-2.5 border", t.on ? "bg-hit border-hit" : "bg-transparent border-card-border")}
                          style={t.on ? { boxShadow: "0 0 calc(6px * var(--glow-strength)) hsl(var(--hit) / .6)" } : undefined}
                          initial={animate ? { opacity: 0, scale: 0.4 } : false}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.15 + i * 0.05, type: "spring", stiffness: 420, damping: 22 }}
                        />
                      ))}
                    </div>
                    <span className="hud-tag tabular-nums"><span className="text-foreground">{setCount}</span>/5 set</span>
                  </div>
                </div>

                {/* Divider: Core */}
                <SectionLabel index={0}>Core APIs — Quotes &amp; Charts</SectionLabel>

                <KeyRow
                  label="Finnhub"
                  description="Real-time quotes, earnings, analyst ratings, and market news. Default key included."
                  docsUrl="https://finnhub.io/register"
                  value={finnhub}
                  onChange={(v) => { setFinnhubVal(v); setFinnhubTest("idle"); setFinnhubMsg(""); }}
                  onTest={testFinnhub}
                  onRemove={removeFinnhub}
                  testStatus={finnhubTest}
                  testMessage={finnhubMsg}
                  hasStored={finnhubStored}
                  hasDefault
                  index={0}
                  inputRef={firstFieldRef}
                />

                <KeyRow
                  label="Polygon"
                  description="Price history charts and OHLCV bar data. Default key included."
                  docsUrl="https://polygon.io/dashboard/signup"
                  value={polygon}
                  onChange={(v) => { setPolygonVal(v); setPolygonTest("idle"); setPolygonMsg(""); }}
                  onTest={testPolygon}
                  onRemove={removePolygon}
                  testStatus={polygonTest}
                  testMessage={polygonMsg}
                  hasStored={polygonStored}
                  hasDefault
                  index={1}
                />

                {/* Divider: Technical */}
                <SectionLabel index={1}>Technical Analysis</SectionLabel>

                <KeyRow
                  label="Alpha Vantage"
                  description="RSI, MACD, SMA 50/200, and Bollinger Bands. Free tier: 25 requests/day."
                  docsUrl="https://www.alphavantage.co/support/#api-key"
                  value={av}
                  onChange={(v) => { setAvVal(v); setAvTest("idle"); setAvMsg(""); }}
                  onTest={testAv}
                  onRemove={removeAv}
                  testStatus={avTest}
                  testMessage={avMsg}
                  hasStored={avStored}
                  optional
                  index={2}
                />

                {/* Divider: Fundamentals */}
                <SectionLabel index={2}>Fundamentals</SectionLabel>

                <KeyRow
                  label="Financial Modeling Prep (FMP)"
                  description="Income statements, key ratios, margins, valuation multiples, and company profiles. Free tier: 250 requests/day."
                  docsUrl="https://site.financialmodelingprep.com/register"
                  value={fmp}
                  onChange={(v) => { setFmpVal(v); setFmpTest("idle"); setFmpMsg(""); }}
                  onTest={testFmp}
                  onRemove={removeFmp}
                  testStatus={fmpTest}
                  testMessage={fmpMsg}
                  hasStored={fmpStored}
                  optional
                  index={3}
                />

                {/* Divider: News */}
                <SectionLabel index={3}>News &amp; Sentiment</SectionLabel>

                <KeyRow
                  label="Marketaux"
                  description="Financial news with ticker-level filtering and sentiment scores. Free tier: 100 req/day · 3 articles/request."
                  docsUrl="https://www.marketaux.com/register"
                  value={marketaux}
                  onChange={(v) => { setMarketauxVal(v); setMarketauxTest("idle"); setMarketauxMsg(""); }}
                  onTest={testMarketaux}
                  onRemove={removeMarketaux}
                  testStatus={marketauxTest}
                  testMessage={marketauxMsg}
                  hasStored={marketauxStored}
                  optional
                  index={4}
                />

                {/* Rate limit notes — terminal log */}
                <motion.div
                  className="border border-card-border bg-background/40 px-3 py-2.5 text-[11px] space-y-1.5"
                  initial={animate ? { opacity: 0 } : false}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.45, duration: 0.3 }}
                >
                  <div className="hud-label flex items-center gap-2">
                    <span className="text-amber">◆</span> Rate limit notes
                  </div>
                  <ul className="space-y-1 text-muted-foreground">
                    {[
                      ["Finnhub + Polygon", "60 req/min on free tier — used for all live price data"],
                      ["Alpha Vantage", "25 req/day — Technical Indicators panel is cached for 1 hour"],
                      ["FMP", "250 req/day — Fundamentals panel is cached up to 24 hours"],
                      ["Marketaux", "100 req/day, 3 articles/req — merged with Polygon for max coverage"],
                    ].map(([name, note]) => (
                      <li key={name} className="flex gap-2">
                        <span className="text-primary shrink-0" aria-hidden>›</span>
                        <span className="min-w-0">
                          <span className="text-foreground uppercase tracking-wider text-[10px]">{name}</span>
                          <span className="text-dim"> :: </span>
                          <span className="font-read">{note}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </div>

              {/* Footer */}
              <div className="border-t border-border/70 bg-background/30 shrink-0">
                <AnimatePresence initial={false}>
                  {saved && (
                    <motion.div
                      key="saved"
                      initial={animate ? { height: 0, opacity: 0 } : false}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={animate ? { height: 0, opacity: 0 } : undefined}
                      className="overflow-hidden"
                      role="status"
                    >
                      <div className="relative flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-hit/10 border-b border-hit/30 text-hit text-[11px] font-mono uppercase tracking-wider">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="glow-hit">Keys saved — reloading page with new settings…</span>
                        <motion.span
                          aria-hidden
                          className="absolute left-0 bottom-0 h-px bg-hit origin-left w-full"
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: animate ? 1.2 : 0, ease: "linear" }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3">
                  <span className="hud-tag hidden sm:inline">esc to close</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <button type="button" onClick={onClose} className="hud-btn">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saved}
                      className="hud-btn !bg-primary !text-primary-foreground !border-primary hover:brightness-110 disabled:opacity-70 box-glow-teal"
                      data-testid="button-settings-save"
                    >
                      {saved ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /> Saved — reloading…</>
                      ) : (
                        "Save & Close"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gear button — drop this anywhere in the nav
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="API Settings"
      aria-label="Open API settings"
      aria-haspopup="dialog"
      className="hud-btn group !px-2 xl:!px-[.7rem]"
      data-testid="button-settings"
    >
      <Settings className="w-3.5 h-3.5 transition-transform duration-500 group-hover:rotate-90" />
      <span className="hidden xl:inline">Settings</span>
    </button>
  );
}
