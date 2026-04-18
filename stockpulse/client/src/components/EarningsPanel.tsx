import { useEarnings, useAnalystRatings, useFinancials } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Clock, Target, Users,
  CheckCircle2, XCircle, AlertCircle, CalendarClock,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState, useMemo } from "react";
import type { EarningsRecord } from "@/lib/mockData";

interface Props { ticker: string }

// ── Formatters ──────────────────────────────────────────────────────────────

function fmtCur(val: number | null | undefined): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtEps(val: number | null | undefined): string {
  if (val == null) return "—";
  return `$${val.toFixed(2)}`;
}

function fmtPct(val: number | null | undefined, decimals = 1): string {
  if (val == null) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}%`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BeatMissBadge({ surprise, label }: { surprise: number | null; label?: string }) {
  if (surprise == null) return null;
  const isBeat = surprise > 0;
  const isMiss = surprise < 0;
  const isInline = surprise === 0;

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
      isBeat ? "bg-emerald-500/15 text-emerald-500"
      : isMiss ? "bg-red-500/15 text-red-500"
      : "bg-muted text-muted-foreground"
    }`}>
      {isBeat ? <CheckCircle2 className="w-2.5 h-2.5" />
       : isMiss ? <XCircle className="w-2.5 h-2.5" />
       : <AlertCircle className="w-2.5 h-2.5" />}
      {label ?? (isBeat ? "Beat" : isMiss ? "Miss" : "In-line")} {fmtPct(surprise)}
    </span>
  );
}

function ChangeChip({ value, prefix }: { value: number | null; prefix?: string }) {
  if (value == null) return <span className="text-muted-foreground tabular-nums">—</span>;
  const isPos = value > 0;
  const isNeg = value < 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${
      isPos ? "text-emerald-500" : isNeg ? "text-red-500" : "text-muted-foreground"
    }`}>
      {isPos ? <TrendingUp className="w-3 h-3" /> : isNeg ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {prefix}{fmtPct(value)}
    </span>
  );
}

function SurpriseBar({ value }: { value: number | null }) {
  if (value == null) return null;
  const clamped = Math.max(-20, Math.min(20, value));
  const pct = ((clamped + 20) / 40) * 100;
  const color = value > 0 ? "bg-emerald-500" : value < 0 ? "bg-red-500" : "bg-muted-foreground";
  return (
    <div className="relative h-1.5 bg-muted rounded-full overflow-hidden w-20">
      <div
        className={`absolute top-0 h-full rounded-full transition-all ${color}`}
        style={{ left: "50%", width: `${Math.abs(clamped / 20) * 50}%`, transform: value >= 0 ? "none" : "translateX(-100%)" }}
      />
      <div className="absolute top-0 left-1/2 w-px h-full bg-border" />
    </div>
  );
}

// ── Past Earnings Card ────────────────────────────────────────────────────────

function PastEarningsRow({ record, isExpanded, onToggle, idx }: {
  record: EarningsRecord;
  isExpanded: boolean;
  onToggle: () => void;
  idx: number;
}) {
  const yoyEps = record.prior_year_eps && record.actual_eps != null
    ? ((record.actual_eps - record.prior_year_eps) / Math.abs(record.prior_year_eps)) * 100
    : null;
  const yoyRev = record.prior_year_revenue && record.actual_revenue != null
    ? ((record.actual_revenue - record.prior_year_revenue) / Math.abs(record.prior_year_revenue)) * 100
    : null;

  return (
    <div
      className="rounded-md border border-transparent hover:border-border transition-colors"
      data-testid={`earnings-past-${idx}`}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
        data-testid={`button-expand-past-${idx}`}
      >
        <div className="flex-1 min-w-0">
          {/* Row 1: Period + date + beat/miss */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold shrink-0">{record.fiscal_period}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {format(parseISO(record.date), "MMM d, yyyy")}
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
              {record.time}
            </span>
            <BeatMissBadge surprise={record.eps_surprise} label="EPS" />
            <BeatMissBadge surprise={record.revenue_surprise} label="Rev" />
          </div>

          {/* Row 2: EPS + Revenue actuals vs estimates */}
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">EPS</span>
              <span className="text-xs font-mono font-semibold tabular-nums">{fmtEps(record.actual_eps)}</span>
              {record.estimated_eps != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  vs est. {fmtEps(record.estimated_eps)}
                </span>
              )}
              <ChangeChip value={yoyEps} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Rev</span>
              <span className="text-xs font-mono font-semibold tabular-nums">{fmtCur(record.actual_revenue)}</span>
              {record.estimated_revenue != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  vs est. {fmtCur(record.estimated_revenue)}
                </span>
              )}
              <ChangeChip value={yoyRev} />
            </div>
          </div>
        </div>

        {isExpanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        }
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs">
            {/* EPS block */}
            <div className="col-span-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">EPS</div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Actual" value={fmtEps(record.actual_eps)} highlight />
                <Metric label="Estimate" value={fmtEps(record.estimated_eps)} />
                <Metric label="Prior Year" value={fmtEps(record.prior_year_eps)} />
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-muted-foreground">Surprise</span>
                <SurpriseBar value={record.eps_surprise} />
                <span className={`text-[11px] font-medium tabular-nums ${
                  record.eps_surprise! > 0 ? "text-emerald-500" : record.eps_surprise! < 0 ? "text-red-500" : "text-muted-foreground"
                }`}>{fmtPct(record.eps_surprise)}</span>
              </div>
            </div>

            <div className="col-span-2 border-t border-border/50 pt-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Revenue</div>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="Actual" value={fmtCur(record.actual_revenue)} highlight />
                <Metric label="Estimate" value={fmtCur(record.estimated_revenue)} />
                <Metric label="Prior Year" value={fmtCur(record.prior_year_revenue)} />
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] text-muted-foreground">Surprise</span>
                <SurpriseBar value={record.revenue_surprise} />
                <span className={`text-[11px] font-medium tabular-nums ${
                  record.revenue_surprise! > 0 ? "text-emerald-500" : record.revenue_surprise! < 0 ? "text-red-500" : "text-muted-foreground"
                }`}>{fmtPct(record.revenue_surprise)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upcoming Earnings Card ────────────────────────────────────────────────────

function UpcomingEarningsRow({ record, isExpanded, onToggle, idx }: {
  record: EarningsRecord;
  isExpanded: boolean;
  onToggle: () => void;
  idx: number;
}) {
  return (
    <div
      className="rounded-md border border-primary/20 bg-primary/5 transition-colors hover:border-primary/40"
      data-testid={`earnings-upcoming-${idx}`}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
        data-testid={`button-expand-upcoming-${idx}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold shrink-0">{record.fiscal_period}</span>
            <span className="text-[11px] text-muted-foreground shrink-0">
              {format(parseISO(record.date), "MMM d, yyyy")}
            </span>
            <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded shrink-0">
              {record.time}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-primary/15 text-primary">
              <CalendarClock className="w-2.5 h-2.5" />
              Upcoming
            </span>
          </div>

          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">EPS Est.</span>
              <span className="text-xs font-mono font-semibold tabular-nums">{fmtEps(record.estimated_eps)}</span>
              {record.eps_estimate_low != null && record.eps_estimate_high != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ({fmtEps(record.eps_estimate_low)} – {fmtEps(record.eps_estimate_high)})
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Rev Est.</span>
              <span className="text-xs font-mono font-semibold tabular-nums">{fmtCur(record.estimated_revenue)}</span>
              {record.revenue_estimate_low != null && record.revenue_estimate_high != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  ({fmtCur(record.revenue_estimate_low)} – {fmtCur(record.revenue_estimate_high)})
                </span>
              )}
            </div>
          </div>
        </div>

        {isExpanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        }
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-primary/20">
          <div className="grid grid-cols-1 gap-3 mt-3 text-xs">
            {/* EPS Estimates */}
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">EPS Consensus Estimate</div>
              <div className="grid grid-cols-4 gap-2">
                <Metric label="Consensus" value={fmtEps(record.estimated_eps)} highlight />
                <Metric label="High" value={fmtEps(record.eps_estimate_high)} />
                <Metric label="Low" value={fmtEps(record.eps_estimate_low)} />
                <Metric label="Prior Year" value={fmtEps(record.prior_year_eps)} />
              </div>
            </div>

            {/* Revenue Estimates */}
            <div className="border-t border-border/50 pt-2">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Revenue Consensus Estimate</div>
              <div className="grid grid-cols-4 gap-2">
                <Metric label="Consensus" value={fmtCur(record.estimated_revenue)} highlight />
                <Metric label="High" value={fmtCur(record.revenue_estimate_high)} />
                <Metric label="Low" value={fmtCur(record.revenue_estimate_low)} />
                <Metric label="Prior Year" value={fmtCur(record.prior_year_revenue)} />
              </div>
            </div>

            {/* Analyst count */}
            {record.num_analysts_eps != null && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                <Users className="w-3.5 h-3.5" />
                <span>{record.num_analysts_eps} analysts covering EPS</span>
                {record.num_analysts_revenue != null && record.num_analysts_revenue !== record.num_analysts_eps && (
                  <span>· {record.num_analysts_revenue} covering revenue</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Analyst Ratings Bar ───────────────────────────────────────────────────────

function AnalystConsensus({ ticker }: { ticker: string }) {
  const { data: ratings, isLoading } = useAnalystRatings(ticker);

  if (isLoading) return <Skeleton className="h-20 w-full rounded-md" />;
  if (!ratings) return null;

  const total = (ratings.buy || 0) + (ratings.hold || 0) + (ratings.sell || 0);
  const buyPct  = total ? (ratings.buy  / total) * 100 : 0;
  const holdPct = total ? (ratings.hold / total) * 100 : 0;
  const sellPct = total ? (ratings.sell / total) * 100 : 0;

  const consensusColor =
    ratings.consensus === "Strong Buy" ? "text-emerald-500"
    : ratings.consensus === "Buy"       ? "text-emerald-400"
    : ratings.consensus === "Hold"      ? "text-yellow-500"
    : "text-red-500";

  return (
    <div className="rounded-md bg-muted/40 border border-border px-4 py-3 space-y-3" data-testid="analyst-consensus">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">Analyst Consensus</span>
        </div>
        <span className={`text-xs font-bold ${consensusColor}`} data-testid="text-consensus">
          {ratings.consensus}
        </span>
      </div>

      {/* Rating bar */}
      <div className="space-y-1">
        <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
          <div className="bg-emerald-500 rounded-full transition-all" style={{ width: `${buyPct}%` }} />
          <div className="bg-yellow-500/70 rounded-full transition-all" style={{ width: `${holdPct}%` }} />
          <div className="bg-red-500 rounded-full transition-all" style={{ width: `${sellPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className="text-emerald-500">{ratings.buy} Buy ({buyPct.toFixed(0)}%)</span>
          <span className="text-yellow-500">{ratings.hold} Hold</span>
          <span className="text-red-500">{ratings.sell} Sell</span>
        </div>
      </div>

      {/* Price targets */}
      <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50">
        <Metric label="Avg Target"  value={ratings.avg_price_target != null ? `$${ratings.avg_price_target.toFixed(2)}` : "—"} highlight />
        <Metric label="High Target" value={ratings.high_price_target != null ? `$${ratings.high_price_target.toFixed(2)}` : "—"} />
        <Metric label="Low Target"  value={ratings.low_price_target != null ? `$${ratings.low_price_target.toFixed(2)}` : "—"} />
      </div>
    </div>
  );
}

// ── Metric cell ───────────────────────────────────────────────────────────────

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-xs font-mono tabular-nums font-medium ${highlight ? "text-foreground" : "text-muted-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function EarningsPanel({ ticker }: Props) {
  const { data, isLoading } = useEarnings(ticker);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "past" | "upcoming">("all");

  // Normalise Polygon Benzinga response vs mock data
  const records: EarningsRecord[] = useMemo(() => {
    const raw = data?.results || [];
    if (!raw.length) return [];

    // If it's already our EarningsRecord shape (mock data), use as-is
    if ("fiscal_period" in (raw[0] as any)) return raw as EarningsRecord[];

    // Otherwise map Benzinga API shape
    return raw.map((r: any) => {
      const isUpcoming = !r.actual_eps_normalized && !r.actual_revenue_normalized;
      return {
        id: `${ticker}-${r.date}-${r.period}`,
        date: r.date,
        fiscal_period: r.period || "",
        fiscal_quarter: parseInt(r.period?.replace(/Q(\d).*/,"$1") || "0"),
        fiscal_year: parseInt(r.period?.replace(/Q\d\s+/,"") || "0"),
        time: r.time || "—",
        actual_eps: r.actual_eps_normalized ?? null,
        actual_revenue: r.actual_revenue_normalized ?? null,
        estimated_eps: r.consensus_eps_estimate ?? null,
        estimated_revenue: r.consensus_revenue_estimate ?? null,
        prior_year_eps: r.prior_year_same_quarter_eps_normalized ?? null,
        prior_year_revenue: null,
        eps_surprise: r.eps_surprise_percent ?? null,
        revenue_surprise: r.revenue_surprise_percent ?? null,
        is_upcoming: isUpcoming,
        num_analysts_eps: r.number_of_estimates ?? undefined,
      } as EarningsRecord;
    });
  }, [data, ticker]);

  const past     = records.filter(r => !r.is_upcoming);
  const upcoming = records.filter(r => r.is_upcoming);
  const visible  = tab === "past" ? past : tab === "upcoming" ? upcoming : records;

  const TABS: { key: typeof tab; label: string; count: number }[] = [
    { key: "all",      label: "All",          count: records.length  },
    { key: "upcoming", label: "Upcoming",      count: upcoming.length },
    { key: "past",     label: "Past",          count: past.length     },
  ];

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6 flex flex-col" data-testid="earnings-panel">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Earnings & Estimates</h2>
      </div>

      {/* Analyst consensus */}
      <div className="mb-3">
        <AnalystConsensus ticker={ticker} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-3">
        {TABS.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            data-testid={`tab-earnings-${key}`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-1 text-[10px] px-1 rounded-full ${
                tab === key ? "bg-white/20" : "bg-muted text-muted-foreground"
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto max-h-[560px] space-y-1 -mx-1 px-1">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-3 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No {tab === "upcoming" ? "upcoming" : tab === "past" ? "past" : ""} earnings records for {ticker}.
          </div>
        ) : (
          visible.map((record, idx) => {
            const isExpanded = expandedId === record.id;
            const toggle = () => setExpandedId(isExpanded ? null : record.id);
            return record.is_upcoming
              ? <UpcomingEarningsRow key={record.id} record={record} isExpanded={isExpanded} onToggle={toggle} idx={idx} />
              : <PastEarningsRow    key={record.id} record={record} isExpanded={isExpanded} onToggle={toggle} idx={idx} />;
          })
        )}
      </div>
    </div>
  );
}
