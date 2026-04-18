import { useRsi, useMacd, useSma, useBbands, useSnapshot } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, TrendingUp, TrendingDown, Minus,
  AlertTriangle,
} from "lucide-react";
import {
  LineChart, Line, ReferenceLine, ResponsiveContainer,
  BarChart, Bar, Tooltip as RTooltip,
} from "recharts";

interface Props { ticker: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number | null | undefined, decimals = 2): string {
  if (val == null) return "—";
  return val.toFixed(decimals);
}

function fmtPrice(val: number | null | undefined): string {
  if (val == null) return "—";
  return `$${val.toFixed(2)}`;
}

// ── RSI Gauge ─────────────────────────────────────────────────────────────────

function RsiGauge({ value }: { value: number }) {
  const isOverbought = value >= 70;
  const isOversold   = value <= 30;

  const color = isOverbought ? "text-red-400" : isOversold ? "text-emerald-400" : "text-yellow-400";
  const label = isOverbought ? "Overbought" : isOversold ? "Oversold" : "Neutral";
  const pct   = Math.min(100, Math.max(0, value));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className={`text-2xl font-bold tabular-nums font-mono ${color}`}>{fmt(value, 1)}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
          isOverbought ? "bg-red-500/15 text-red-400"
          : isOversold ? "bg-emerald-500/15 text-emerald-400"
          : "bg-yellow-500/15 text-yellow-400"
        }`}>{label}</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden bg-muted">
        <div className="absolute inset-0 flex">
          <div className="bg-emerald-500/30" style={{ width: "30%" }} />
          <div className="bg-yellow-500/20" style={{ width: "40%" }} />
          <div className="bg-red-500/30"    style={{ width: "30%" }} />
        </div>
        <div
          className="absolute top-0 h-full w-0.5 bg-white rounded-full shadow-sm transition-all"
          style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>0 Oversold</span>
        <span>30</span>
        <span>70</span>
        <span>Overbought 100</span>
      </div>
    </div>
  );
}

// ── Signal Row ────────────────────────────────────────────────────────────────

function Signal({ label, value, bullish, bearish }: {
  label: string;
  value: string;
  bullish?: boolean;
  bearish?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono tabular-nums font-medium">{value}</span>
        {bullish && <TrendingUp  className="w-3 h-3 text-emerald-400" />}
        {bearish && <TrendingDown className="w-3 h-3 text-red-400"    />}
        {!bullish && !bearish && <Minus className="w-3 h-3 text-muted-foreground" />}
      </div>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2 mt-4 first:mt-0">
      {title}
    </div>
  );
}

// ── Error row ─────────────────────────────────────────────────────────────────

function ErrRow({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-red-400">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {msg}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
// All indicators use Polygon daily bars — no AV key required, no daily quota.
// usePolyBars is a shared cached query; RSI/SMA/BB all derive from same fetch.

export function TechnicalIndicators({ ticker }: Props) {
  const { data: rsiData,  isLoading: rsiLoading,  isError: rsiError  } = useRsi(ticker);
  const { data: macdData, isLoading: macdLoading, isError: macdError } = useMacd(ticker);
  const { data: sma50,    isLoading: sma50Loading                     } = useSma(ticker, 50);
  const { data: sma200,   isLoading: sma200Loading                    } = useSma(ticker, 200);
  const { data: bbData,   isLoading: bbLoading,   isError: bbError   } = useBbands(ticker);
  const { data: snapshot } = useSnapshot(ticker);

  const currentPrice = snapshot?.lastTrade?.p ?? snapshot?.day?.c ?? null;

  // RSI/SMA/BB share usePolyBars — all resolve together once bars arrive (~300ms)
  // MACD has its own Polygon fetch (different date range for warm-up)
  const isLoading = rsiLoading || sma50Loading || sma200Loading || bbLoading || macdLoading;

  if (isLoading) return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6 space-y-4" data-testid="tech-indicators-loading">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  );

  // Chart data: 30 most recent bars, reversed oldest→newest for Recharts
  const macdChart = (macdData?.entries ?? []).slice(0, 30).reverse();
  const rsiChart  = (rsiData?.entries  ?? []).slice(0, 30).reverse();

  // SMA golden/death cross
  const smaCross = sma50 != null && sma200 != null
    ? sma50 > sma200 ? "bullish" : "bearish"
    : null;

  // Bollinger position relative to current price
  const bb = bbData?.latest;
  let bbSignal: "overbought" | "oversold" | "neutral" | null = null;
  if (bb && currentPrice != null) {
    if (currentPrice >= bb.upper) bbSignal = "overbought";
    else if (currentPrice <= bb.lower) bbSignal = "oversold";
    else bbSignal = "neutral";
  }

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="tech-indicators">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Technical Indicators</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">Polygon</span>
      </div>

      <div className="space-y-5">

        {/* ── RSI ── */}
        <div>
          <SectionHead title="RSI (14)" />
          {rsiError ? (
            <div className="text-xs text-muted-foreground">RSI unavailable — retrying…</div>
          ) : rsiData?.latest ? (
            <RsiGauge value={rsiData.latest.value} />
          ) : (
            <div className="text-xs text-muted-foreground">No RSI data</div>
          )}

          {rsiChart.length > 1 && (
            <div className="mt-2 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rsiChart}>
                  <ReferenceLine y={70} stroke="rgba(239,68,68,0.3)"  strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="rgba(16,185,129,0.3)" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                  <RTooltip
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div className="bg-card border border-border rounded px-2 py-1 text-xs">
                          <span className="text-muted-foreground">{payload[0].payload.date}</span>
                          <span className="ml-2 font-mono font-semibold">{fmt(payload[0].value as number, 1)}</span>
                        </div>
                      ) : null
                    }
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── MACD ── */}
        <div>
          <SectionHead title="MACD (12/26/9)" />
          {macdError ? (
            <div className="text-xs text-muted-foreground">MACD unavailable — retrying…</div>
          ) : macdData?.latest ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-2">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">MACD</div>
                  <div className={`text-sm font-mono font-semibold tabular-nums ${macdData.latest.macd > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmt(macdData.latest.macd)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">Signal</div>
                  <div className="text-sm font-mono font-semibold tabular-nums">{fmt(macdData.latest.signal)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">Histogram</div>
                  <div className={`text-sm font-mono font-semibold tabular-nums ${macdData.latest.histogram > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmt(macdData.latest.histogram)}
                  </div>
                </div>
              </div>

              {macdChart.length > 1 && (
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={macdChart} barSize={3}>
                      <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      <Bar
                        dataKey="histogram"
                        fill="hsl(var(--primary))"
                        radius={[1, 1, 0, 0]}
                        isAnimationActive={false}
                      />
                      <RTooltip
                        content={({ active, payload }) =>
                          active && payload?.[0] ? (
                            <div className="bg-card border border-border rounded px-2 py-1 text-xs">
                              <span className="text-muted-foreground">{payload[0].payload.date}</span>
                              <span className="ml-2 font-mono font-semibold">{fmt(payload[0].value as number)}</span>
                            </div>
                          ) : null
                        }
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">No MACD data</div>
          )}
        </div>

        {/* ── Moving Averages ── */}
        <div>
          <SectionHead title="Moving Averages" />
          <Signal
            label="SMA 50"
            value={fmtPrice(sma50)}
            bullish={currentPrice != null && sma50 != null && currentPrice > sma50}
            bearish={currentPrice != null && sma50 != null && currentPrice < sma50}
          />
          <Signal
            label="SMA 200"
            value={fmtPrice(sma200)}
            bullish={currentPrice != null && sma200 != null && currentPrice > sma200}
            bearish={currentPrice != null && sma200 != null && currentPrice < sma200}
          />
          {smaCross && (
            <div className={`mt-2 text-xs font-medium px-2 py-1 rounded flex items-center gap-1.5 ${
              smaCross === "bullish"
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}>
              {smaCross === "bullish"
                ? <><TrendingUp className="w-3 h-3" /> Golden Cross — SMA50 above SMA200</>
                : <><TrendingDown className="w-3 h-3" /> Death Cross — SMA50 below SMA200</>
              }
            </div>
          )}
        </div>

        {/* ── Bollinger Bands ── */}
        <div>
          <SectionHead title="Bollinger Bands (20, 2σ)" />
          {bbError ? (
            <div className="text-xs text-muted-foreground">Bollinger Bands unavailable — retrying…</div>
          ) : bb ? (
            <>
              <Signal label="Upper Band"     value={fmtPrice(bb.upper)}  />
              <Signal label="Middle (SMA 20)" value={fmtPrice(bb.middle)} />
              <Signal label="Lower Band"     value={fmtPrice(bb.lower)}  />
              {bbSignal && (
                <div className={`mt-2 text-xs font-medium px-2 py-1 rounded flex items-center gap-1.5 ${
                  bbSignal === "overbought" ? "bg-red-500/10 text-red-400"
                  : bbSignal === "oversold"  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-muted text-muted-foreground"
                }`}>
                  {bbSignal === "overbought" && <><TrendingUp className="w-3 h-3" /> Price at upper band — potential reversal</>}
                  {bbSignal === "oversold"   && <><TrendingDown className="w-3 h-3" /> Price at lower band — potential bounce</>}
                  {bbSignal === "neutral"    && <><Minus className="w-3 h-3" /> Price within bands</>}
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-muted-foreground">No Bollinger data</div>
          )}
        </div>

      </div>
    </div>
  );
}
