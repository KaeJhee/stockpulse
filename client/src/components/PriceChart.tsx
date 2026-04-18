import { useState, useMemo, useCallback } from "react";
import { useAggregates } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format, subDays, subMonths, subYears, startOfDay } from "date-fns";
import { Calendar, BarChart3 } from "lucide-react";

interface Props {
  ticker: string;
}

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX" | "CUSTOM";

function getDateRange(key: RangeKey): { from: string; to: string; timespan: string; multiplier: string } {
  const now = new Date();
  const toStr = format(now, "yyyy-MM-dd");
  switch (key) {
    case "1D": return { from: toStr, to: toStr, timespan: "minute", multiplier: "5" };
    case "5D": return { from: format(subDays(now, 5), "yyyy-MM-dd"), to: toStr, timespan: "minute", multiplier: "30" };
    case "1M": return { from: format(subMonths(now, 1), "yyyy-MM-dd"), to: toStr, timespan: "day", multiplier: "1" };
    case "3M": return { from: format(subMonths(now, 3), "yyyy-MM-dd"), to: toStr, timespan: "day", multiplier: "1" };
    case "6M": return { from: format(subMonths(now, 6), "yyyy-MM-dd"), to: toStr, timespan: "day", multiplier: "1" };
    case "YTD": return { from: `${now.getFullYear()}-01-01`, to: toStr, timespan: "day", multiplier: "1" };
    case "1Y": return { from: format(subYears(now, 1), "yyyy-MM-dd"), to: toStr, timespan: "day", multiplier: "1" };
    case "5Y": return { from: format(subYears(now, 5), "yyyy-MM-dd"), to: toStr, timespan: "week", multiplier: "1" };
    case "MAX": return { from: "2000-01-01", to: toStr, timespan: "month", multiplier: "1" };
    default: return { from: format(subMonths(now, 3), "yyyy-MM-dd"), to: toStr, timespan: "day", multiplier: "1" };
  }
}

const RANGES: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX", "CUSTOM"];

export function PriceChart({ ticker }: Props) {
  const [rangeKey, setRangeKey] = useState<RangeKey>("3M");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (rangeKey === "CUSTOM" && customFrom && customTo) {
      return { from: customFrom, to: customTo, timespan: "day", multiplier: "1" };
    }
    return getDateRange(rangeKey);
  }, [rangeKey, customFrom, customTo]);

  const { data, isLoading, error } = useAggregates(ticker, range.from, range.to, range.timespan, range.multiplier);

  const chartData = useMemo(() => {
    if (!data?.results) return [];
    return data.results.map((bar: any) => ({
      time: bar.t,
      close: bar.c,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      volume: bar.v,
    }));
  }, [data]);

  const isPositive = chartData.length >= 2 && chartData[chartData.length - 1].close >= chartData[0].close;
  const accentColor = isPositive ? "#10b981" : "#ef4444";

  const formatXLabel = useCallback(
    (ts: number) => {
      const d = new Date(ts);
      if (rangeKey === "1D") return format(d, "h:mm a");
      if (rangeKey === "5D") return format(d, "EEE h a");
      if (["1M", "3M"].includes(rangeKey) || rangeKey === "CUSTOM") return format(d, "MMM d");
      if (["6M", "YTD", "1Y"].includes(rangeKey)) return format(d, "MMM yyyy");
      return format(d, "yyyy");
    },
    [rangeKey]
  );

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="price-chart">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Performance</h2>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRangeKey(r)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                rangeKey === r
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`button-range-${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Date Inputs */}
      {rangeKey === "CUSTOM" && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 px-2 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-custom-from"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 px-2 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-custom-to"
          />
        </div>
      )}

      {/* Chart */}
      {isLoading ? (
        <div className="h-[350px] flex items-center justify-center">
          <Skeleton className="w-full h-full rounded-md" />
        </div>
      ) : error ? (
        <div className="h-[350px] flex items-center justify-center text-sm text-muted-foreground">
          Unable to load chart data. Check API key configuration.
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-[350px] flex items-center justify-center text-sm text-muted-foreground">
          No data available for this range.
        </div>
      ) : (
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={accentColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="[&_line]:stroke-border" stroke="currentColor" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="time"
                tickFormatter={formatXLabel}
                tick={{ fontSize: 11, fill: "hsl(220, 8%, 55%)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 11, fill: "hsl(220, 8%, 55%)" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(v > 100 ? 0 : 2)}`}
                width={65}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-popover border border-popover-border rounded-md px-3 py-2 shadow-lg text-xs">
                      <div className="text-muted-foreground mb-1">
                        {format(new Date(d.time), rangeKey === "1D" ? "h:mm a" : "MMM d, yyyy")}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular-nums">
                        <span className="text-muted-foreground">Open</span>
                        <span className="font-medium text-right">${d.open?.toFixed(2)}</span>
                        <span className="text-muted-foreground">High</span>
                        <span className="font-medium text-right">${d.high?.toFixed(2)}</span>
                        <span className="text-muted-foreground">Low</span>
                        <span className="font-medium text-right">${d.low?.toFixed(2)}</span>
                        <span className="text-muted-foreground">Close</span>
                        <span className="font-bold text-right">${d.close?.toFixed(2)}</span>
                        <span className="text-muted-foreground">Vol</span>
                        <span className="font-medium text-right">{d.volume?.toLocaleString()}</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={accentColor}
                strokeWidth={1.5}
                fill="url(#chartGradient)"
                dot={false}
                animationDuration={600}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
