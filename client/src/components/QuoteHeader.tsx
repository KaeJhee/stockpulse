import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useSnapshot, useTickerDetails, usePrevClose, usePrevDayOHLCV, useFmpProfile } from "@/lib/hooks";
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Panel, Diamond, Sparkline, RangeBar, fmtNum, useAnimate, useAmbient } from "@/components/hud";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
}

/** Quote poll cadence; mirrors refetchInterval in useRawQuote (lib/hooks.ts). */
const POLL_MS = 15000;
const MAX_TICKS = 80;

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

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const signed = (n: number, digits = 2) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const dollars = (n: number) => `$${fmtNum(n, 2)}`;

type Tone = "up" | "down" | "amber" | "dim";
const toneText: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  amber: "text-amber",
  dim: "text-dim",
};
const toneBorder: Record<Tone, string> = {
  up: "border-up/40 bg-up/10",
  down: "border-down/40 bg-down/10",
  amber: "border-amber/40 bg-amber/10",
  dim: "border-border bg-muted/40",
};

export function QuoteHeader({ ticker }: Props) {
  const { data: snapshot, isLoading: snapLoading, dataUpdatedAt, isMock, source } = useSnapshot(ticker);
  const { data: details, isLoading: detLoading } = useTickerDetails(ticker);
  const { data: prevClose } = usePrevClose(ticker);
  // Polygon /prev gives us volume (Finnhub free tier omits it)
  const { data: prevDay } = usePrevDayOHLCV(ticker);
  // FMP profile (cached 24h, shared with FundamentalsPanel; only runs with an FMP key)
  const { data: fmpProfile } = useFmpProfile(ticker);

  const animate = useAnimate();
  const ambient = useAmbient();

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
  const marketCap = details?.market_cap ?? (snapshot as any)?.marketCap ?? fmpProfile?.market_cap ?? null;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  // ── Session tick path: prev close → open → each poll since this ticker loaded ──
  // Tagged with the ticker so switching symbols (no remount) starts a fresh path,
  // and only fed once the quote query has settled (no mock placeholder prints).
  const [tickState, setTickState] = useState<{ ticker: string; ticks: number[] }>({ ticker, ticks: [] });
  useEffect(() => {
    if (snapLoading || !isNum(lastPrice)) return;
    setTickState((prev) => {
      if (prev.ticker !== ticker || prev.ticks.length === 0) {
        const seed = [prevClosePrice, dayOpen].filter(isNum);
        return { ticker, ticks: [...seed, lastPrice] };
      }
      return { ticker, ticks: [...prev.ticks, lastPrice].slice(-MAX_TICKS) };
    });
    // one entry per poll (dataUpdatedAt changes every refetch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, snapLoading, lastPrice, dataUpdatedAt]);
  const ticks = tickState.ticker === ticker ? tickState.ticks : [];

  // Ambient loops (blink / ping / shimmer) stop when motion is reduced or off.
  const still = !ambient && "after:!animate-none";

  if (isLoading) {
    const shimmer = cn("skeleton-shimmer", !ambient && "!animate-none");
    return (
      <section className="hud-panel" data-testid="quote-header-skeleton" aria-busy="true">
        <header className="flex items-center gap-2 px-4 h-10 border-b border-border/70">
          <Diamond size={6} />
          <span className="hud-title">Quote</span>
          <span className={cn("hud-tag cursor-block truncate", still)}>syncing {ticker}</span>
        </header>
        <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 space-y-3 min-w-0">
            <div className={cn(shimmer, "h-5 w-40 max-w-full")} />
            <div className={cn(shimmer, "h-12 w-56 max-w-full")} />
            <div className="flex gap-2">
              <div className={cn(shimmer, "h-5 w-16")} />
              <div className={cn(shimmer, "h-5 w-20")} />
              <div className={cn(shimmer, "h-5 w-14")} />
            </div>
          </div>
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn(shimmer, "h-14")} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  // ── Derived, descriptive readings (no advice) ──────────────────────────────
  const gapPct = isNum(dayOpen) && isNum(prevClosePrice) && prevClosePrice ? ((dayOpen - prevClosePrice) / prevClosePrice) * 100 : null;
  const hasRange = isNum(dayHigh) && isNum(dayLow) && dayHigh > dayLow;
  const rangePos = hasRange && isNum(lastPrice) ? Math.max(0, Math.min(1, (lastPrice - dayLow!) / (dayHigh! - dayLow!))) : null;
  const spread = hasRange ? dayHigh! - dayLow! : null;
  const spreadPct = spread != null && isNum(prevClosePrice) && prevClosePrice ? (spread / prevClosePrice) * 100 : null;
  const offHigh = isNum(lastPrice) && isNum(dayHigh) && dayHigh ? ((lastPrice - dayHigh) / dayHigh) * 100 : null;
  const offLow = isNum(lastPrice) && isNum(dayLow) && dayLow ? ((lastPrice - dayLow) / dayLow) * 100 : null;
  const prevVol = isNum(prevDay?.volume) ? prevDay!.volume : null;
  const volVsPrev = isNum(dayVol) && prevVol && dayVol !== prevVol ? (dayVol / prevVol) * 100 : null;

  const regimes: { key: string; label: string; tone: Tone; tip: string }[] = [];
  if (gapPct != null && Math.abs(gapPct) >= 0.25) {
    regimes.push({
      key: "gap",
      label: `Gap ${gapPct > 0 ? "▲ up" : "▼ down"} ${Math.abs(gapPct).toFixed(2)}%`,
      tone: gapPct > 0 ? "up" : "down",
      tip: "Session open vs previous close",
    });
  }
  if (rangePos != null) {
    const r = rangePos >= 0.8 ? "Upper range" : rangePos <= 0.2 ? "Lower range" : "Mid range";
    regimes.push({
      key: "range",
      label: `${r} ·${(rangePos * 100).toFixed(0)}%`,
      tone: rangePos >= 0.8 ? "up" : rangePos <= 0.2 ? "down" : "amber",
      tip: "Where the last print sits inside today's low → high",
    });
  }

  const tone: Tone = isPositive ? "up" : isNegative ? "down" : "dim";
  const exchange = details?.primary_exchange || fmpProfile?.exchange || null;
  const industry = details?.description || fmpProfile?.industry || null;
  const sector = fmpProfile?.sector || null;
  const currency = details?.currency_name || null;
  // De-duplicated (e.g. Finnhub industry can equal the FMP sector) so React keys stay unique.
  const chips = Array.from(
    new Set([exchange, sector, industry, currency].filter((c): c is string => !!c && typeof c === "string")),
  );

  const stats: StatDef[] = [
    {
      key: "open",
      label: "Open",
      value: dayOpen,
      format: dollars,
      sub: gapPct != null ? <span className={gapPct >= 0 ? "text-up" : "text-down"}>gap {signed(gapPct)}%</span> : "session open",
      tip: "First print of the session. Gap = open vs previous close.",
    },
    {
      key: "high",
      label: "High",
      value: dayHigh,
      format: dollars,
      sub: offHigh != null ? `${signed(offHigh)}% from last` : "session high",
      tip: "Highest print today; distance shown relative to the last price.",
    },
    {
      key: "low",
      label: "Low",
      value: dayLow,
      format: dollars,
      sub: offLow != null ? `${signed(offLow)}% from last` : "session low",
      tip: "Lowest print today; distance shown relative to the last price.",
    },
    {
      key: "prev",
      label: "Prev Close",
      value: prevClosePrice,
      format: dollars,
      sub: change != null ? <span className={isPositive ? "text-up" : isNegative ? "text-down" : "text-dim"}>{isPositive ? "▲" : isNegative ? "▼" : "·"} {signed(change)}</span> : "reference",
      tip: "Previous session close; the basis for today's change.",
    },
    {
      key: "vol",
      label: "Volume",
      value: dayVol,
      format: (n) => formatVol(n),
      sub: volVsPrev != null ? `${volVsPrev.toFixed(0)}% of prev day` : prevVol && dayVol === prevVol ? "prev session" : "shares",
      tip: "Shares traded. Falls back to the previous session (Polygon) when the live feed omits volume.",
    },
    {
      key: "mcap",
      label: "Mkt Cap",
      value: marketCap,
      format: (n) => formatLargeNum(n),
      sub: isNum(fmpProfile?.beta) ? `beta ${fmpProfile!.beta.toFixed(2)}` : "equity value",
      tip: "Market capitalization from the company profile feed.",
    },
    {
      key: "spread",
      label: "Day Spread",
      value: spread,
      format: dollars,
      sub: spreadPct != null ? `${spreadPct.toFixed(2)}% of prev close` : "high − low",
      tip: "High minus low for the session: a quick read of intraday drift.",
    },
    {
      key: "pos",
      label: "Range Pos",
      value: rangePos != null ? rangePos * 100 : null,
      format: (n) => `${n.toFixed(0)}%`,
      sub: <RangeMini pct={rangePos} animate={animate} />,
      tip: "0% = at the session low, 100% = at the session high.",
    },
  ];

  // Day range track spans low/high plus prev close and last, so every marker fits.
  const rangeVals = [dayLow, dayHigh, prevClosePrice, lastPrice].filter(isNum);
  const trackMin = rangeVals.length ? Math.min(...rangeVals) : 0;
  const trackMax = rangeVals.length ? Math.max(...rangeVals) : 0;
  const showRange = rangeVals.length >= 2 && trackMax > trackMin && isNum(lastPrice);
  const lastPct = showRange ? Math.max(0, Math.min(100, (((lastPrice as number) - trackMin) / (trackMax - trackMin)) * 100)) : 0;

  return (
    <Panel
      title="Quote"
      tag={isMock ? "sample data" : `${source} · ${POLL_MS / 1000}s poll`}
      accent={isNegative ? "red" : "teal"}
      flush
      data-testid="quote-header"
      actions={
        <span className={cn("hud-chip !h-[20px]", isMock && "!border-amber/40 !text-amber")} aria-label={isMock ? "Sample data, live quote unavailable" : `Live quote via ${source}`}>
          <span className={cn("live-dot", still)} data-tone={isMock ? "amber" : undefined} />
          {isMock ? "mock" : "live"}
        </span>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* ── Left: identity, price, change ─────────────────────────────── */}
        <div className="lg:col-span-5 p-4 sm:p-5 lg:border-r border-border/70 min-w-0 flex flex-col gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="font-mono text-[22px] sm:text-[26px] font-bold tracking-[.18em] text-primary glow-teal leading-none shrink-0"
              data-testid="text-ticker"
            >
              <ScrambleText text={ticker} animate={animate} />
            </span>
            <span className="h-5 w-px bg-border shrink-0" aria-hidden />
            <span className="text-sm text-muted-foreground truncate min-w-0" title={companyName} data-testid="text-company-name">
              {companyName}
            </span>
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c, i) => (
                <motion.span
                  key={c}
                  className="hud-chip !shrink min-w-0 max-w-[15rem]"
                  initial={animate ? { opacity: 0, x: -6 } : false}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.06, duration: 0.3 }}
                  title={c}
                >
                  <span className="truncate">{c}</span>
                </motion.span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <span
              className={cn(
                "font-mono font-semibold leading-none tracking-tight text-[40px] sm:text-[52px] text-foreground",
                isPositive && "glow-teal",
                isNegative && "glow-red",
              )}
              data-testid="text-price"
            >
              <span className="text-[0.55em] text-dim align-top mr-0.5">$</span>
              {/* keyed by ticker: a symbol switch counts up fresh instead of tweening/flashing across symbols */}
              <LiveNumber key={ticker} value={lastPrice} flash duration={900} format={(n) => fmtNum(n, 2)} />
            </span>

            {change != null && (
              <div className={cn("flex items-center gap-1.5 pb-1 text-sm sm:text-base font-medium", toneText[tone])}>
                <span aria-hidden className="text-[0.8em]">{isPositive ? "▲" : isNegative ? "▼" : "■"}</span>
                <span className="sr-only">{isPositive ? "Up" : isNegative ? "Down" : "Unchanged"}</span>
                <LiveNumber
                  key={`${ticker}-chg`}
                  value={change}
                  duration={900}
                  format={(n) => `${isPositive ? "+" : ""}${formatPrice(n)}`}
                  data-testid="text-change"
                />
                <LiveNumber
                  key={`${ticker}-pct`}
                  value={changePercent}
                  duration={900}
                  format={(n) => `(${isPositive ? "+" : ""}${n.toFixed(2)}%)`}
                  data-testid="text-change-percent"
                />
              </div>
            )}
          </div>

          {(regimes.length > 0 || ticks.length >= 2) && (
            <div className="flex flex-wrap items-center gap-2">
              {regimes.map((r, i) => (
                <motion.span
                  key={r.key}
                  className={cn("inline-flex items-center h-[20px] px-2 border text-[9.5px] uppercase tracking-[.12em] tabular-nums", toneBorder[r.tone], toneText[r.tone])}
                  initial={animate ? { opacity: 0, scale: 0.92 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.5 + i * 0.08, type: "spring", stiffness: 260, damping: 20 }}
                  title={r.tip}
                >
                  {r.label}
                </motion.span>
              ))}
              {ticks.length >= 2 && (
                <span className="inline-flex items-center gap-2 ml-auto" title="Path: previous close → open → each quote poll since this view opened">
                  <span className="hud-tag">ticks {ticks.length}</span>
                  <Sparkline data={ticks} width={110} height={22} area={false} />
                </span>
              )}
            </div>
          )}

          {isMock ? (
            <div className="flex items-center gap-1.5 text-[11px] text-amber" data-testid="quote-mock-warning">
              <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
              <span>Live quote unavailable — open Settings and enter your Finnhub key</span>
            </div>
          ) : lastUpdated ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 hud-tag">
              <span>
                sync <span className="text-foreground/80 tabular-nums">{lastUpdated}</span>
              </span>
              <span className="px-1 border border-border text-muted-foreground">{source}</span>
              {ambient && dataUpdatedAt ? (
                <span className="inline-flex items-center gap-1.5" aria-hidden>
                  <span>next</span>
                  <span className="relative w-14 h-px bg-border overflow-hidden">
                    <motion.span
                      key={dataUpdatedAt}
                      className="absolute inset-y-0 left-0 bg-primary"
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: POLL_MS / 1000, ease: "linear" }}
                    />
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── Right: stat strip + day range ─────────────────────────────── */}
        <div className="lg:col-span-7 p-4 sm:p-5 border-t lg:border-t-0 border-border/70 min-w-0 flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/60 border border-border/60">
            {stats.map((s, i) => (
              <StatTile key={`${ticker}-${s.key}`} def={s} index={i} animate={animate} />
            ))}
          </div>

          {showRange && (
            <motion.div
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, duration: 0.4 }}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="hud-label">Day range</span>
                <span className="hud-tag tabular-nums">
                  {rangePos != null ? (
                    <>
                      last at <span className="text-foreground/85">{(rangePos * 100).toFixed(0)}%</span> of low → high
                    </>
                  ) : (
                    "low → high"
                  )}
                </span>
              </div>
              <div className="px-3 relative">
                {/* Last-price label lives here (not as a RangeBar marker label): RangeBar keys markers
                    by label, so a label that changes every poll would remount the pin and replay its fly-in. */}
                <div className="absolute inset-x-3 top-0 h-3 pointer-events-none" aria-hidden>
                  <motion.span
                    className="absolute top-0"
                    initial={animate ? { left: "0%", opacity: 0 } : false}
                    animate={{ left: `${lastPct}%`, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 90, damping: 18, delay: animate ? 0.3 : 0 }}
                  >
                    <span
                      className={cn(
                        "block text-[9px] leading-none whitespace-nowrap tabular-nums",
                        isNegative ? "text-down" : "text-up",
                        lastPct < 12 ? "translate-x-[-4px]" : lastPct > 88 ? "-translate-x-[calc(100%-4px)]" : "-translate-x-1/2",
                      )}
                    >
                      {formatPrice(lastPrice)}
                    </span>
                  </motion.span>
                </div>
                <RangeBar
                  min={trackMin}
                  max={trackMax}
                  height={4}
                  markers={[
                    ...(isNum(prevClosePrice) ? [{ value: prevClosePrice, tone: "amber" as const, shape: "tri" as const }] : []),
                    ...(isNum(dayOpen) ? [{ value: dayOpen, tone: "fg" as const, shape: "tri" as const }] : []),
                    { value: lastPrice as number, tone: isNegative ? ("down" as const) : ("up" as const), shape: "pin" as const },
                  ]}
                  minLabel={`${isNum(dayLow) && dayLow <= trackMin ? "L" : "min"} ${formatPrice(trackMin)}`}
                  maxLabel={`${isNum(dayHigh) && dayHigh >= trackMax ? "H" : "max"} ${formatPrice(trackMax)}`}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 hud-tag">
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("inline-block w-[2px] h-2.5", isNegative ? "bg-down" : "bg-up")} aria-hidden /> last
                </span>
                {isNum(dayOpen) && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-foreground text-[8px]" aria-hidden>▲</span> open {formatPrice(dayOpen)}
                  </span>
                )}
                {isNum(prevClosePrice) && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-amber text-[8px]" aria-hidden>▲</span> prev close {formatPrice(prevClosePrice)}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Stat tiles
// ──────────────────────────────────────────────────────────────────────────

interface StatDef {
  key: string;
  label: string;
  value: number | null | undefined;
  format: (n: number) => string;
  sub?: ReactNode;
  tip: string;
}

function StatTile({ def, index, animate }: { def: StatDef; index: number; animate: boolean }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <motion.div
          tabIndex={0}
          role="group"
          aria-label={`${def.label}: ${isNum(def.value) ? def.format(def.value) : "not available"}`}
          className={cn(
            "group relative bg-card px-3 py-2.5 min-w-0 outline-none transition-[background-color,box-shadow] duration-200",
            // z-index lifts the hovered tile so its outer glow is not painted over by its grid neighbours
            "hover:z-[1] focus-visible:z-[1] hover:bg-up/[0.06] hover:box-glow-teal focus-visible:bg-up/[0.06] focus-visible:box-glow-teal",
            "focus-visible:ring-1 focus-visible:ring-primary",
          )}
          initial={animate ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + index * 0.05, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
          data-testid={`quote-stat-${def.key}`}
        >
          {/* hover tick */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 h-2 w-2 border-l border-t border-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
          <div className="hud-label truncate">{def.label}</div>
          <div className="mt-1 font-mono text-[15px] font-medium text-foreground leading-tight truncate">
            <LiveNumber value={def.value} from={null} flash format={def.format} />
          </div>
          {def.sub != null && <div className="mt-0.5 text-[10px] text-dim tabular-nums truncate">{def.sub}</div>}
        </motion.div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="rounded-sm border-card-border bg-popover px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-muted-foreground max-w-[240px]"
      >
        <span className="text-primary uppercase tracking-[.12em] mr-1.5">{def.label}</span>
        {def.tip}
      </TooltipContent>
    </Tooltip>
  );
}

function RangeMini({ pct, animate }: { pct: number | null; animate: boolean }) {
  if (pct == null) return <span>low → high</span>;
  const tone = pct >= 0.8 ? "bg-up" : pct <= 0.2 ? "bg-down" : "bg-amber";
  return (
    <span className="flex items-center gap-1.5 pt-1" aria-hidden>
      <span className="relative flex-1 h-[3px] bg-muted overflow-hidden">
        <motion.span
          className={cn("absolute inset-y-0 left-0", tone)}
          initial={animate ? { width: "0%" } : false}
          animate={{ width: `${Math.max(2, pct * 100)}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 18, delay: animate ? 0.45 : 0 }}
        />
      </span>
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Local motion helpers. Same look as hud CountUp / Decode, but every animation
// also has a timer that snaps to the final value, so numbers and the ticker are
// correct even when requestAnimationFrame is paused (background tab / pane).
// ──────────────────────────────────────────────────────────────────────────

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface LiveNumberProps {
  value: number | null | undefined;
  format: (n: number) => string;
  duration?: number;
  /** First-mount start value (default 0); null starts at the value. */
  from?: number | null;
  /** Flash teal/crimson when the value changes after it has settled. */
  flash?: boolean;
  fallback?: string;
  className?: string;
  "data-testid"?: string;
}

function LiveNumber({ value, format, duration = 700, from = 0, flash = false, fallback = "—", className, ...rest }: LiveNumberProps) {
  const animate = useAnimate();
  const valid = isNum(value);
  const [display, setDisplay] = useState<number | null>(() => (!valid ? null : animate && from !== null ? from : (value as number)));
  const [flashState, setFlashState] = useState<{ dir: "up" | "down" | null; key: number }>({ dir: null, key: 0 });
  const displayRef = useRef<number | null>(display);
  displayRef.current = display;
  const prevRef = useRef<number | null>(valid ? (value as number) : null);
  const firstRef = useRef(true);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!valid) {
      setDisplay(null);
      prevRef.current = null;
      return;
    }
    const target = value as number;
    const isFirst = firstRef.current;
    firstRef.current = false;

    const prev = prevRef.current;
    // Skip the placeholder → live swap right after mount; flash only real updates.
    if (!isFirst && flash && prev !== null && target !== prev && Date.now() - mountedAtRef.current > 2500) {
      setFlashState((f) => ({ dir: target > prev ? "up" : "down", key: f.key + 1 }));
    }
    prevRef.current = target;

    const start = displayRef.current ?? (isFirst && from !== null ? from : target);
    if (!animate || start === target) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setDisplay(start + (target - start) * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const snap = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      setDisplay(target);
    }, duration + 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(snap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, valid, animate, duration]);

  return (
    <span
      key={flashState.key}
      className={cn(
        "tabular-nums",
        flashState.key > 0 && flashState.dir === "up" && "flash-up",
        flashState.key > 0 && flashState.dir === "down" && "flash-down",
        className,
      )}
      {...rest}
    >
      {display === null ? fallback : format(display)}
    </span>
  );
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>/";

/** Scramble → decode for the ticker. Timer-driven so it always lands on the real text. */
function ScrambleText({ text, animate, duration = 520 }: { text: string; animate: boolean; duration?: number }) {
  const [out, setOut] = useState(text);

  // Layout effect: the first scrambled frame replaces the text before paint (no flash of the final value).
  useLayoutEffect(() => {
    if (!animate || !text) {
      setOut(text);
      return;
    }
    const scramble = (settled: number) => {
      let s = text.slice(0, settled);
      for (let i = settled; i < text.length; i++) s += text[i] === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      return s;
    };
    setOut(scramble(0));
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const t = (Date.now() - t0) / duration;
      if (t >= 1) {
        window.clearInterval(id);
        setOut(text);
      } else {
        setOut(scramble(Math.floor(t * text.length)));
      }
    }, 40);
    return () => {
      window.clearInterval(id);
    };
  }, [text, animate, duration]);

  return <span>{out}</span>;
}
