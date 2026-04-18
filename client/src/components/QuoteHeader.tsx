import { useSnapshot, useTickerDetails, usePrevClose, usePrevDayOHLCV } from "@/lib/hooks";
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  ticker: string;
}

function formatPrice(val: number | undefined | null): string {
  if (val == null) return "—";
  return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLargeNum(val: number | undefined | null): string {
  if (val == null) return "—";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  return `$${val.toLocaleString()}`;
}

function formatVol(val: number | undefined | null): string {
  if (val == null) return "—";
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
  return val.toLocaleString();
}

export function QuoteHeader({ ticker }: Props) {
  const { data: snapshot, isLoading: snapLoading, dataUpdatedAt, isMock, source } = useSnapshot(ticker);
  const { data: details, isLoading: detLoading } = useTickerDetails(ticker);
  const { data: prevClose } = usePrevClose(ticker);
  // Polygon /prev gives us volume (Finnhub free tier omits it)
  const { data: prevDay } = usePrevDayOHLCV(ticker);

  const isLoading = snapLoading && detLoading;

  // Derive prices from snapshot or prevClose
  const lastPrice = snapshot?.lastTrade?.p ?? snapshot?.day?.c ?? prevClose?.c ?? null;
  const prevClosePrice = snapshot?.prevDay?.c ?? prevClose?.c ?? null;
  const change = lastPrice != null && prevClosePrice != null ? lastPrice - prevClosePrice : null;
  const changePercent = change != null && prevClosePrice ? (change / prevClosePrice) * 100 : null;
  const isPositive = change != null && change > 0;
  const isNegative = change != null && change < 0;

  // OHLCV: prefer live snapshot (FMP/Schwab have volume), fall back to Polygon /prev
  const dayOpen = snapshot?.day?.o ?? prevClose?.o ?? prevDay?.open  ?? null;
  const dayHigh = snapshot?.day?.h ?? prevClose?.h ?? prevDay?.high  ?? null;
  const dayLow  = snapshot?.day?.l ?? prevClose?.l ?? prevDay?.low   ?? null;
  // Volume: use || null so 0-volume (FMP market-closed) falls through to Polygon
  const dayVol  = (snapshot?.day?.v || null) ?? (prevClose?.v || null) ?? prevDay?.volume ?? null;

  const companyName = details?.name || ticker;
  const marketCap = details?.market_cap ?? null;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  if (isLoading) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="quote-header-skeleton">
        <div className="flex items-start gap-4">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-48" />
            <div className="flex gap-4 mt-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="quote-header">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        {/* Left: Name, Price, Change */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-bold text-primary" data-testid="text-ticker">{ticker}</span>
            <span className="text-sm text-muted-foreground truncate max-w-[300px]" data-testid="text-company-name">
              {companyName}
            </span>
          </div>

          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums" data-testid="text-price">
              ${formatPrice(lastPrice)}
            </span>
            {change != null && (
              <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? "text-emerald-500" : isNegative ? "text-red-500" : "text-muted-foreground"}`}>
                {isPositive ? <TrendingUp className="w-4 h-4" /> : isNegative ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                <span className="tabular-nums" data-testid="text-change">
                  {isPositive ? "+" : ""}{formatPrice(change)}
                </span>
                <span className="tabular-nums" data-testid="text-change-percent">
                  ({isPositive ? "+" : ""}{changePercent?.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>

          {isMock ? (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-400" data-testid="quote-mock-warning">
              <AlertTriangle className="w-3 h-3" />
              <span>Live quote unavailable — open Settings and enter your Finnhub key</span>
            </div>
          ) : lastUpdated ? (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
              <RefreshCw className="w-3 h-3" />
              <span>Updated {lastUpdated}</span>
              <span className="ml-1 px-1 py-0.5 rounded bg-muted font-mono text-[10px] uppercase">
                {source}
              </span>
            </div>
          ) : null}
        </div>

        {/* Right: KPI grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          <KPI label="Open" value={`$${formatPrice(dayOpen)}`} />
          <KPI label="High" value={`$${formatPrice(dayHigh)}`} />
          <KPI label="Low" value={`$${formatPrice(dayLow)}`} />
          <KPI label="Volume" value={formatVol(dayVol)} />
          <KPI label="Prev Close" value={`$${formatPrice(prevClosePrice)}`} />
          <KPI label="Mkt Cap" value={formatLargeNum(marketCap)} />
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-mono text-sm tabular-nums font-medium">{value}</div>
    </div>
  );
}
