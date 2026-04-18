import { useFmpIncome, useFmpRatios, useFmpProfile } from "@/lib/hooks";
import { getFmpKey } from "@/lib/apiKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import {
  BarChart2, Building2, Settings2, TrendingUp, TrendingDown, Minus,
  ExternalLink, Users, Globe, Briefcase,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";

interface Props { ticker: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtLarge(val: number | null | undefined): string {
  if (val == null) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(val: number | null | undefined, asRatio = false): string {
  if (val == null) return "—";
  const v = asRatio ? val * 100 : val * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtMultiple(val: number | null | undefined, suffix = "x"): string {
  if (val == null) return "—";
  return `${val.toFixed(1)}${suffix}`;
}

function fmtNum(val: number | null | undefined, decimals = 2): string {
  if (val == null) return "—";
  return val.toFixed(decimals);
}

function fmtEmployees(val: string | number | null | undefined): string {
  if (val == null) return "—";
  const n = typeof val === "string" ? parseInt(val.replace(/,/g, "")) : val;
  if (isNaN(n)) return String(val);
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// ── KPI Cell ─────────────────────────────────────────────────────────────────

function Kpi({
  label, value, sub, positive, negative,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  negative?: boolean;
}) {
  const valueColor = positive ? "text-emerald-400" : negative ? "text-red-400" : "text-foreground";
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-mono font-semibold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ title, source }: { title: string; source?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{title}</div>
      {source && <span className="text-[10px] text-muted-foreground font-mono">{source}</span>}
    </div>
  );
}

// ── No-key state ─────────────────────────────────────────────────────────────

function NoKey() {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
        <Settings2 className="w-5 h-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">FMP key needed</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Open Settings and enter your Financial Modeling Prep key to see fundamentals.
        </p>
        <a href="https://site.financialmodelingprep.com/register" target="_blank" rel="noopener noreferrer"
          className="text-xs text-primary hover:underline mt-1 inline-block">
          Get a free key →
        </a>
      </div>
    </div>
  );
}

// ── Revenue/Income Bar Chart ──────────────────────────────────────────────────

function IncomeChart({ data }: { data: any[] }) {
  const chartData = [...data].reverse().map(r => ({
    year:       r.date?.slice(0, 4) ?? "",
    revenue:    r.revenue    != null ? r.revenue    / 1e9 : null,
    net_income: r.net_income != null ? r.net_income / 1e9 : null,
  }));

  return (
    <div className="h-36 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} barGap={2} barCategoryGap="25%">
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={v => `$${v.toFixed(0)}B`}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false} tickLine={false} width={48}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <RTooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="bg-card border border-border rounded px-2 py-1.5 text-xs space-y-0.5">
                  <div className="font-semibold">{label}</div>
                  {payload.map((p: any) => (
                    <div key={p.name} style={{ color: p.fill }}>
                      {p.name === "revenue" ? "Revenue" : "Net Income"}: ${(p.value as number).toFixed(1)}B
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          <Bar dataKey="revenue"    name="revenue"    fill="hsl(var(--primary))"  radius={[2, 2, 0, 0]} />
          <Bar dataKey="net_income" name="net_income" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.net_income != null && entry.net_income >= 0 ? "hsl(142 70% 45%)" : "hsl(0 72% 51%)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = "overview" | "income" | "profile";

export function FundamentalsPanel({ ticker }: Props) {
  const hasFmpKey = !!getFmpKey();
  const [tab, setTab] = useState<Tab>("overview");

  const { data: income,  isLoading: incLoading  } = useFmpIncome(ticker);
  const { data: ratios,  isLoading: ratLoading  } = useFmpRatios(ticker);
  const { data: profile, isLoading: profLoading } = useFmpProfile(ticker);

  const isLoading = incLoading || ratLoading || profLoading;
  const latest = income?.[0];

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Valuation" },
    { key: "income",   label: "Financials" },
    { key: "profile",  label: "Profile" },
  ];

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="fundamentals-panel">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Fundamentals</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">FMP</span>
      </div>

      {!hasFmpKey ? (
        <NoKey />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-full" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
          <Skeleton className="h-36 w-full" />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  tab === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
                data-testid={`tab-fundamentals-${key}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* OVERVIEW — Valuation ratios */}
          {tab === "overview" && (
            <div className="space-y-5">
              <div>
                <SectionHead title="Valuation Ratios (TTM)" />
                <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                  <Kpi label="P/E"         value={fmtMultiple(ratios?.pe_ratio)} />
                  <Kpi label="P/B"         value={fmtMultiple(ratios?.pb_ratio)} />
                  <Kpi label="P/S"         value={fmtMultiple(ratios?.ps_ratio)} />
                  <Kpi label="EV/EBITDA"   value={fmtMultiple(ratios?.ev_ebitda)} />
                  <Kpi label="Debt/Equity" value={fmtMultiple(ratios?.debt_equity)} />
                  <Kpi label="Current Ratio" value={fmtMultiple(ratios?.current_ratio)} />
                </div>
              </div>

              <div className="border-t border-border/50 pt-4">
                <SectionHead title="Returns & Margins (TTM)" />
                <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                  <Kpi label="ROE"
                    value={fmtPct(ratios?.roe)}
                    positive={(ratios?.roe ?? 0) > 0}
                    negative={(ratios?.roe ?? 0) < 0}
                  />
                  <Kpi label="ROA"
                    value={fmtPct(ratios?.roa)}
                    positive={(ratios?.roa ?? 0) > 0}
                    negative={(ratios?.roa ?? 0) < 0}
                  />
                  <Kpi label="ROIC"
                    value={fmtPct(ratios?.roic)}
                    positive={(ratios?.roic ?? 0) > 0}
                    negative={(ratios?.roic ?? 0) < 0}
                  />
                  <Kpi label="Gross Margin"
                    value={fmtPct(ratios?.gross_margin)}
                    positive={(ratios?.gross_margin ?? 0) > 0.4}
                  />
                  <Kpi label="Op. Margin"
                    value={fmtPct(ratios?.operating_margin)}
                    positive={(ratios?.operating_margin ?? 0) > 0.15}
                    negative={(ratios?.operating_margin ?? 0) < 0}
                  />
                  <Kpi label="Net Margin"
                    value={fmtPct(ratios?.net_margin)}
                    positive={(ratios?.net_margin ?? 0) > 0.1}
                    negative={(ratios?.net_margin ?? 0) < 0}
                  />
                </div>
              </div>

              {(ratios?.dividend_yield != null && ratios.dividend_yield > 0) && (
                <div className="border-t border-border/50 pt-4">
                  <SectionHead title="Dividends" />
                  <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                    <Kpi label="Dividend Yield" value={fmtPct(ratios?.dividend_yield)} positive />
                    <Kpi label="Payout Ratio"   value={fmtPct(ratios?.payout_ratio)} />
                    <Kpi label="FCF / Share"    value={fmtNum(ratios?.free_cash_flow) !== "—" ? `$${fmtNum(ratios?.free_cash_flow)}` : "—"} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* INCOME — Revenue/Income over time */}
          {tab === "income" && income && income.length > 0 && (
            <div className="space-y-4">
              {/* Most recent year KPIs */}
              <div>
                <SectionHead title={`Most Recent Annual (${latest?.date?.slice(0, 4) ?? ""})`} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                  <Kpi label="Revenue"         value={fmtLarge(latest?.revenue)} />
                  <Kpi label="Gross Profit"    value={fmtLarge(latest?.gross_profit)}
                    sub={fmtPct(latest?.gross_margin) + " margin"} />
                  <Kpi label="Operating Income" value={fmtLarge(latest?.operating_income)}
                    sub={fmtPct(latest?.operating_margin) + " margin"}
                    positive={(latest?.operating_income ?? 0) > 0}
                    negative={(latest?.operating_income ?? 0) < 0}
                  />
                  <Kpi label="Net Income"      value={fmtLarge(latest?.net_income)}
                    sub={fmtPct(latest?.net_margin) + " margin"}
                    positive={(latest?.net_income ?? 0) > 0}
                    negative={(latest?.net_income ?? 0) < 0}
                  />
                  <Kpi label="EBITDA"          value={fmtLarge(latest?.ebitda)} />
                  <Kpi label="EPS (Diluted)"   value={latest?.eps_diluted != null ? `$${fmtNum(latest.eps_diluted)}` : "—"} />
                </div>
              </div>

              {/* 4-year chart */}
              {income.length >= 2 && (
                <div className="border-t border-border/50 pt-4">
                  <SectionHead title="Revenue vs. Net Income (Annual)" />
                  <IncomeChart data={income} />
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-primary inline-block" /> Revenue
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Net Income
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {tab === "profile" && profile && (
            <div className="space-y-4 text-xs">
              {/* Identifiers */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {profile.sector    && <Kpi label="Sector"   value={profile.sector} />}
                {profile.industry  && <Kpi label="Industry" value={profile.industry} />}
                {profile.exchange  && <Kpi label="Exchange" value={profile.exchange} />}
                {profile.country   && <Kpi label="Country"  value={profile.country} />}
                {profile.ipo_date  && <Kpi label="IPO Date" value={profile.ipo_date} />}
                {profile.beta      && <Kpi label="Beta"     value={fmtNum(profile.beta)} />}
              </div>

              {/* CEO + Employees */}
              {(profile.ceo || profile.employees) && (
                <div className="flex flex-wrap gap-4 pt-2 border-t border-border/50">
                  {profile.ceo && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Briefcase className="w-3.5 h-3.5 shrink-0" />
                      <span>CEO: <span className="text-foreground font-medium">{profile.ceo}</span></span>
                    </div>
                  )}
                  {profile.employees && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="w-3.5 h-3.5 shrink-0" />
                      <span>{fmtEmployees(profile.employees)} employees</span>
                    </div>
                  )}
                </div>
              )}

              {/* Description */}
              {profile.description && (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">About</div>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-5">
                    {profile.description}
                  </p>
                </div>
              )}

              {/* Website */}
              {profile.website && (
                <a
                  href={profile.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Globe className="w-3 h-3" />
                  {profile.website.replace(/^https?:\/\//, "")}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
