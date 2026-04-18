import { useCallback, useEffect, useRef, useState } from "react";
import { getFinnhubKey, getPolygonKey, getAvKey, getFmpKey, getMarketauxKey } from "@/lib/apiKeys";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Status = "checking" | "ok" | "error" | "skipped";

interface ApiState {
  status: Status;
  latency: number | null;   // ms
  lastOk: Date | null;
  error: string | null;
}

const INITIAL: ApiState = { status: "checking", latency: null, lastOk: null, error: null };
const SKIPPED: ApiState = { status: "skipped",  latency: null, lastOk: null, error: null };

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
  // Use a lightweight time-series query (5min, compact, 1 row)
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=SPY&interval=5min&outputsize=compact&datatype=json&apikey=${key}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const latency = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.["Error Message"]) throw new Error("Invalid API key");
  if (data?.Note)              throw new Error("Rate limit reached");
  if (data?.Information)       throw new Error("API call limit reached");
  // Should have time series data
  if (!data["Time Series (5min)"]) throw new Error("Unexpected response");
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

// ── Dot indicator ─────────────────────────────────────────────────────────────

function Dot({ status }: { status: Status }) {
  const base = "w-2 h-2 rounded-full shrink-0";
  if (status === "checking") return <span className={`${base} bg-yellow-400 animate-pulse`} />;
  if (status === "ok")       return <span className={`${base} bg-emerald-400`} />;
  if (status === "skipped")  return <span className={`${base} bg-muted-foreground/40`} />;
  return                            <span className={`${base} bg-red-500`} />;
}

// ── Row in tooltip ────────────────────────────────────────────────────────────

function ApiRow({
  label,
  state,
  noKeyLabel,
}: {
  label: string;
  state: ApiState;
  noKeyLabel?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        <Dot status={state.status} />
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-right space-y-0.5">
        {state.status === "skipped" && (
          <div className="text-muted-foreground/60 text-[10px] italic">
            {noKeyLabel ?? "No key set"}
          </div>
        )}
        {state.status === "ok" && (
          <>
            <div className="text-emerald-400 font-mono">{formatLatency(state.latency)}</div>
            {state.lastOk && (
              <div className="text-muted-foreground text-[10px]">
                Last ok {formatTime(state.lastOk)}
              </div>
            )}
          </>
        )}
        {state.status === "error" && (
          <>
            <div className="text-red-400 text-[10px] max-w-[130px] text-right">{state.error}</div>
            {state.lastOk && (
              <div className="text-muted-foreground text-[10px]">
                Last ok {formatTime(state.lastOk)}
              </div>
            )}
            {!state.lastOk && (
              <div className="text-muted-foreground text-[10px]">Never succeeded</div>
            )}
          </>
        )}
        {state.status === "checking" && (
          <div className="text-muted-foreground text-[10px]">Checking…</div>
        )}
      </div>
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

  const run = useCallback(() => {
    // Finnhub (always has a default key)
    setFh(prev => ({ ...prev, status: "checking" }));
    checkFinnhub()
      .then(({ latency }) => setFh({ status: "ok", latency, lastOk: new Date(), error: null }))
      .catch(err => setFh(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })));

    // Polygon (always has a default key)
    setPoly(prev => ({ ...prev, status: "checking" }));
    checkPolygon()
      .then(({ latency }) => setPoly({ status: "ok", latency, lastOk: new Date(), error: null }))
      .catch(err => setPoly(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })));

    // Alpha Vantage — only if key is set
    if (getAvKey()) {
      setAv(prev => ({ ...prev, status: "checking" }));
      checkAlphaVantage()
        .then(({ latency }) => setAv({ status: "ok", latency, lastOk: new Date(), error: null }))
        .catch(err => setAv(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })));
    } else {
      setAv(SKIPPED);
    }

    // FMP — only if key is set
    if (getFmpKey()) {
      setFmp(prev => ({ ...prev, status: "checking" }));
      checkFmp()
        .then(({ latency }) => setFmp({ status: "ok", latency, lastOk: new Date(), error: null }))
        .catch(err => setFmp(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })));
    } else {
      setFmp(SKIPPED);
    }

    // Marketaux — only if key is set
    if (getMarketauxKey()) {
      setMaux(prev => ({ ...prev, status: "checking" }));
      checkMarketaux()
        .then(({ latency }) => setMaux({ status: "ok", latency, lastOk: new Date(), error: null }))
        .catch(err => setMaux(prev => ({ status: "error", latency: null, lastOk: prev.lastOk, error: err.message })));
    } else {
      setMaux(SKIPPED);
    }
  }, []);

  useEffect(() => {
    run();
    intervalRef.current = setInterval(run, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Summary dot logic (ignores skipped APIs)
  const active = [fh, poly, ...(getAvKey() ? [av] : []), ...(getFmpKey() ? [fmp] : []), ...(getMarketauxKey() ? [maux] : [])];
  const anyChecking = active.some(s => s.status === "checking");
  const anyError    = active.some(s => s.status === "error");
  const allOk       = active.every(s => s.status === "ok");

  const summaryDot = anyChecking
    ? "bg-yellow-400 animate-pulse"
    : allOk
    ? "bg-emerald-400"
    : anyError
    ? "bg-red-500"
    : "bg-yellow-400";

  const summaryLabel = anyChecking ? "Checking…" : allOk ? "APIs OK" : anyError ? "API Error" : "APIs OK";

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/50 hover:bg-muted border border-border transition-colors text-[11px] font-mono cursor-default"
            data-testid="api-health-indicator"
            aria-label="API connectivity status"
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${summaryDot}`} />
            <span className="hidden sm:inline text-muted-foreground">{summaryLabel}</span>
          </button>
        </TooltipTrigger>

        <TooltipContent side="bottom" align="end" className="p-0 w-72">
          <div className="bg-card border border-border rounded-lg p-3 space-y-3 text-xs">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              API Health
            </div>

            <ApiRow label="Finnhub"       state={fh}   />
            <div className="border-t border-border/60" />
            <ApiRow label="Polygon"       state={poly} />
            <div className="border-t border-border/60" />
            <ApiRow label="Alpha Vantage" state={av}   noKeyLabel="Add key in Settings" />
            <div className="border-t border-border/60" />
            <ApiRow label="FMP"           state={fmp}  noKeyLabel="Add key in Settings" />
            <div className="border-t border-border/60" />
            <ApiRow label="Marketaux"     state={maux} noKeyLabel="Add key in Settings (optional)" />

            <div className="border-t border-border pt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Refreshes every 60s</span>
              <button
                onClick={(e) => { e.stopPropagation(); run(); }}
                className="text-primary hover:underline"
                data-testid="button-health-refresh"
              >
                Refresh now
              </button>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
