import { useEffect, useRef, useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, Activity,
  Clock, ExternalLink, BarChart2, Globe, Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarketIndices,
  useTopMovers,
  useSectorPerformance,
  useMarketNews,
  useMarketStatus,
  type IndexQuote,
  type MoverQuote,
  type SectorPerf,
} from "@/lib/hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number) {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmt(n, 2)}%`;
}

function fmtVol(n: number | null) {
  if (n == null || n <= 0) return "—";  // guard: null, undefined, and 0 all show dash
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ChangeTag({ pct, size = "sm" }: { pct: number; size?: "xs" | "sm" }) {
  const up = pct > 0;
  const flat = pct === 0;
  const base = size === "xs" ? "text-[10px] px-1 py-0.5" : "text-xs px-1.5 py-0.5";
  const color = flat
    ? "text-muted-foreground bg-muted"
    : up
    ? "text-emerald-400 bg-emerald-500/10"
    : "text-red-400 bg-red-500/10";
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded font-mono font-medium tabular-nums ${base} ${color}`}>
      <Icon className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {fmtPct(pct)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrolling ticker tape
// ─────────────────────────────────────────────────────────────────────────────

function TickerTape({ indices }: { indices: IndexQuote[] }) {
  const items = [...indices, ...indices]; // duplicate for seamless loop
  return (
    <div className="overflow-hidden border-b border-border bg-card/50 h-8 flex items-center">
      <div className="flex animate-ticker whitespace-nowrap gap-8 px-4">
        {items.map((idx, i) => {
          const up = idx.changePct > 0;
          const flat = idx.changePct === 0;
          const color = flat ? "text-muted-foreground" : up ? "text-emerald-400" : "text-red-400";
          return (
            <span key={`${idx.symbol}-${i}`} className="inline-flex items-center gap-2 text-xs font-mono shrink-0">
              <span className="text-muted-foreground font-medium">{idx.label}</span>
              <span className="font-semibold tabular-nums">{fmt(idx.price)}</span>
              <span className={`${color} tabular-nums`}>{fmtPct(idx.changePct)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Indices grid
// ─────────────────────────────────────────────────────────────────────────────

function IndicesPanel({ indices, isLoading, onSelect }: { indices?: IndexQuote[]; isLoading: boolean; onSelect?: (t: string) => void }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Activity className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market Indices</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="p-3 space-y-1.5">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))
          : (indices || []).length === 0
          ? <div className="col-span-4 py-8 text-center text-xs text-muted-foreground">No index data available. Add API keys in Settings.</div>
          : (indices || []).map((idx) => {
              const up = idx.changePct > 0;
              const flat = idx.changePct === 0;
              const accent = flat ? "" : up ? "border-l-2 border-l-emerald-500" : "border-l-2 border-l-red-500";
              return (
                <div
                  key={idx.symbol}
                  className={`p-3 transition-colors ${accent} ${onSelect ? "cursor-pointer hover:bg-muted/50 active:bg-muted/70" : "hover:bg-muted/30"}`}
                  onClick={() => onSelect?.(idx.symbol)}
                  role={onSelect ? "button" : undefined}
                  data-testid={`button-index-${idx.symbol}`}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{idx.label}</div>
                  <div className="text-base font-mono font-bold tabular-nums leading-tight">{fmt(idx.price)}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <ChangeTag pct={idx.changePct} size="xs" />
                    <span className={`text-[10px] font-mono tabular-nums ${flat ? "text-muted-foreground" : up ? "text-emerald-400" : "text-red-400"}`}>
                      {idx.change >= 0 ? "+" : ""}{fmt(idx.change)}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Top Movers
// ─────────────────────────────────────────────────────────────────────────────

function MoverRow({
  mover,
  onSelect,
}: {
  mover: MoverQuote;
  onSelect: (t: string) => void;
}) {
  const up = mover.changePct > 0;
  return (
    <button
      onClick={() => onSelect(mover.symbol)}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors text-left group"
      data-testid={`button-mover-${mover.symbol}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-bold w-12 truncate group-hover:text-primary transition-colors">{mover.symbol}</span>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums hidden sm:inline">Vol {fmtVol(mover.volume)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono tabular-nums">${fmt(mover.price)}</span>
        <ChangeTag pct={mover.changePct} size="xs" />
      </div>
    </button>
  );
}

function TopMoversPanel({
  gainers,
  losers,
  isLoading,
  onSelect,
}: {
  gainers?: MoverQuote[];
  losers?: MoverQuote[];
  isLoading: boolean;
  onSelect: (t: string) => void;
}) {
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");
  const rows = tab === "gainers" ? gainers : losers;
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Movers</span>
        </div>
        <div className="flex rounded-md overflow-hidden border border-border text-[10px] font-semibold">
          <button
            onClick={() => setTab("gainers")}
            className={`px-2.5 py-1 transition-colors ${tab === "gainers" ? "bg-emerald-500/15 text-emerald-400" : "text-muted-foreground hover:bg-muted"}`}
          >
            GAINERS
          </button>
          <button
            onClick={() => setTab("losers")}
            className={`px-2.5 py-1 transition-colors ${tab === "losers" ? "bg-red-500/15 text-red-400" : "text-muted-foreground hover:bg-muted"}`}
          >
            LOSERS
          </button>
        </div>
      </div>
      <div className="flex-1 divide-y divide-border/50">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between px-3 py-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))
          : (rows || []).map((m) => (
              <MoverRow key={m.symbol} mover={m} onSelect={onSelect} />
            ))}
        {!isLoading && (!rows || rows.length === 0) && (
          <p className="text-xs text-muted-foreground text-center py-6">No market data available. Check API keys in Settings.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector heat map
// ─────────────────────────────────────────────────────────────────────────────

function sectorColor(pct: number): string {
  if (pct >=  2) return "bg-emerald-500 text-emerald-950";
  if (pct >=  1) return "bg-emerald-500/60 text-emerald-100";
  if (pct >=  0.25) return "bg-emerald-500/25 text-emerald-300";
  if (pct > -0.25) return "bg-muted text-muted-foreground";
  if (pct > -1)  return "bg-red-500/25 text-red-300";
  if (pct > -2)  return "bg-red-500/60 text-red-100";
  return "bg-red-600 text-red-50";
}

function SectorHeatMap({ sectors, isLoading }: { sectors?: SectorPerf[]; isLoading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <BarChart2 className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sector Performance</span>
      </div>
      <div className="p-3 grid grid-cols-3 sm:grid-cols-4 gap-1.5">
        {isLoading
          ? Array.from({ length: 11 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded" />
            ))
          : (sectors || []).length === 0
          ? <div className="col-span-4 py-8 text-center text-xs text-muted-foreground">No sector data available. Add API keys in Settings.</div>
          : (sectors || []).map((s) => (
              <div
                key={s.symbol}
                className={`rounded px-2 py-2 flex flex-col gap-0.5 ${sectorColor(s.changePct)}`}
              >
                <span className="text-[10px] font-semibold leading-tight">{s.label}</span>
                <span className="text-xs font-mono font-bold tabular-nums">{fmtPct(s.changePct)}</span>
              </div>
            ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Market News
// ─────────────────────────────────────────────────────────────────────────────

function MarketNewsPanel({ news, isLoading }: { news?: any[]; isLoading: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Market News</span>
      </div>
      <div className="flex-1 divide-y divide-border/50 overflow-y-auto max-h-[420px]">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            ))
          : (news || []).length === 0
          ? <div className="py-8 text-center text-xs text-muted-foreground">No market news available. Add API keys in Settings.</div>
          : (news || []).map((item) => (
              <a
                key={item.id ?? item.uuid ?? item.article_url ?? (item.title || "").slice(0,60)}
                href={item.article_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {item.title}
                    </p>
                    {item.description && (
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-1">
                        {item.description}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {item.publisher?.name && (
                        <span className="text-[10px] text-primary/70 font-medium">{item.publisher.name}</span>
                      )}
                      {item.publisher?.name && item.published_utc && (
                        <span className="text-[10px] text-muted-foreground">·</span>
                      )}
                      {item.published_utc && (
                        <span className="text-[10px] text-muted-foreground">{timeAgo(item.published_utc)}</span>
                      )}
                      {item.tickers && item.tickers.slice(0, 4).map((t: string) => (
                        <span key={t} className="px-1 py-0.5 text-[9px] font-mono bg-muted text-muted-foreground rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </a>
            ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchlist Quick Access
// ─────────────────────────────────────────────────────────────────────────────

const WATCHLIST = [
  "AAPL", "NVDA", "MSFT", "TSLA", "GOOGL",
  "AMZN", "META", "AMD", "JPM", "SPY",
];

function WatchlistPanel({
  onSelect,
}: {
  onSelect: (t: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Access</span>
      </div>
      <div className="p-3 flex flex-wrap gap-1.5">
        {WATCHLIST.map((t) => (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className="px-2.5 py-1.5 text-xs font-mono font-semibold bg-muted hover:bg-primary/10 hover:text-primary border border-border hover:border-primary/30 rounded transition-all"
            data-testid={`button-watchlist-${t}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Market Status Badge
// ─────────────────────────────────────────────────────────────────────────────

function MarketStatusBadge() {
  const { data: status } = useMarketStatus();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  const isOpen = status?.isOpen ?? false;

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border ${
        isOpen
          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
          : "bg-muted text-muted-foreground border-border"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
        {isOpen ? "MARKET OPEN" : "MARKET CLOSED"}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
        <Clock className="w-2.5 h-2.5" />
        {timeStr}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────────────────────

export function MarketOverview({ onSelect }: { onSelect: (ticker: string) => void }) {
  const { data: indices, isLoading: idxLoading, isError: idxError } = useMarketIndices();
  const { data: movers, isLoading: moversLoading, isError: moversError } = useTopMovers();
  const { data: sectors, isLoading: sectorLoading, isError: sectorError } = useSectorPerformance();
  const { data: news, isLoading: newsLoading } = useMarketNews();

  return (
    <div className="space-y-0 -mx-4 sm:-mx-6" data-testid="market-overview">
      {/* Ticker tape — only show once indices load */}
      {!idxLoading && indices && indices.length > 0 && (
        <TickerTape indices={indices} />
      )}

      {/* Main content */}
      <div className="px-4 sm:px-6 pt-4 space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold tracking-tight">Market Overview</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Live data · Polygon / FMP / Finnhub</p>
          </div>
          <MarketStatusBadge />
        </div>

        {/* Indices */}
        <IndicesPanel indices={idxError ? [] : indices} isLoading={idxLoading} onSelect={onSelect} />

        {/* Movers + Sector Heat side by side on large screens */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopMoversPanel
            gainers={moversError ? [] : movers?.gainers}
            losers={moversError ? [] : movers?.losers}
            isLoading={moversLoading}
            onSelect={onSelect}
          />
          <SectorHeatMap sectors={sectorError ? [] : sectors} isLoading={sectorLoading} />
        </div>

        {/* News + Quick Access */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <MarketNewsPanel news={news?.results} isLoading={newsLoading} />
          </div>
          <div>
            <WatchlistPanel onSelect={onSelect} />
          </div>
        </div>
      </div>
    </div>
  );
}
