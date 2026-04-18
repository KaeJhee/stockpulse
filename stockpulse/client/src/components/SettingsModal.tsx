import { useState, useEffect } from "react";
import { X, Settings, Eye, EyeOff, CheckCircle2, XCircle, Loader2, Trash2 } from "lucide-react";
import {
  getFinnhubKey, getPolygonKey, getAvKey, getFmpKey, getMarketauxKey,
  setFinnhubKey, setPolygonKey, setAvKey, setFmpKey, setMarketauxKey,
  getStoredKeys,
} from "@/lib/apiKeys";

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
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual key row
// ─────────────────────────────────────────────────────────────────────────────

function KeyRow({
  label, description, docsUrl,
  value, onChange, onTest, onRemove,
  testStatus, testMessage, hasStored, optional,
}: KeyRowProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">{label}</div>
            {optional && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">OPTIONAL</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary hover:underline mt-0.5 inline-block"
          >
            Get a free key →
          </a>
        </div>
        {hasStored && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            KEY SET
          </span>
        )}
      </div>

      {/* Input */}
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste your API key here…"
          className="w-full bg-background border border-border rounded px-3 py-2 pr-10 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/50"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          tabIndex={-1}
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={testStatus === "loading" || !value.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {testStatus === "loading" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : testStatus === "ok" ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : testStatus === "fail" ? (
              <XCircle className="w-3 h-3 text-red-400" />
            ) : (
              <CheckCircle2 className="w-3 h-3" />
            )}
            Test API
          </button>

          {hasStored && (
            <button
              type="button"
              onClick={onRemove}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Remove Key
            </button>
          )}
        </div>

        {testMessage && (
          <div className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs font-mono border ${
            testStatus === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}>
            {testStatus === "ok"
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              : <XCircle className="w-3.5 h-3.5 shrink-0" />
            }
            {testMessage}
          </div>
        )}
      </div>
    </div>
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

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold tracking-tight">API Settings</span>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Keys are saved in your browser only — never sent to any server or stored in code.
            </p>

            {/* Divider: Core */}
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Core APIs — Quotes & Charts
            </div>

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
            />

            {/* Divider: Technical */}
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-2">
              Technical Analysis
            </div>

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
            />

            {/* Divider: Fundamentals */}
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-2">
              Fundamentals
            </div>

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
            />

            {/* Divider: News */}
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-2">
              News &amp; Sentiment
            </div>

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
            />

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground space-y-1">
              <div className="font-semibold text-foreground">Rate limit notes</div>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Finnhub + Polygon: 60 req/min on free tier — used for all live price data</li>
                <li>Alpha Vantage: 25 req/day — Technical Indicators panel is cached for 1 hour</li>
                <li>FMP: 250 req/day — Fundamentals panel is cached up to 24 hours</li>
                <li>Marketaux: 100 req/day, 3 articles/req — merged with Polygon for max coverage</li>
              </ul>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border bg-muted/20">
            {saved && (
              <div className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-400 text-xs font-mono">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Keys saved — reloading page with new settings…
              </div>
            )}
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saved}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
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
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gear button — drop this anywhere in the nav
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="API Settings"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <Settings className="w-3.5 h-3.5" />
      <span className="text-xs font-semibold hidden sm:inline">Settings</span>
    </button>
  );
}
