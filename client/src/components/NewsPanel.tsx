import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll } from "framer-motion";
import { useNews } from "@/lib/hooks";
import { ExternalLink, Newspaper } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Panel, Segmented, useAmbient, useAnimate } from "@/components/hud";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch {
    return null;
  }
}

/** Compact terminal-style age ("now", "12m ago", "3h ago", "2d ago") so the meta line fits at 375px. */
function shortAge(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function ageMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Date.now() - t;
}

function shortLabel(s: string, n = 11): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

type Tone = "bull" | "bear" | "neutral";
function toneOf(s: number | null | undefined): Tone | null {
  if (s == null || !Number.isFinite(s)) return null;
  return s > 0.1 ? "bull" : s < -0.1 ? "bear" : "neutral";
}

/** live-dot that only pings when ambient motion is on. */
function StatusDot({ tone, ambient }: { tone: "hit" | "amber" | "red" | "dim"; ambient: boolean }) {
  if (ambient) return <span className="live-dot" data-tone={tone === "hit" ? undefined : tone} />;
  const bg = tone === "hit" ? "bg-hit" : tone === "amber" ? "bg-amber" : tone === "red" ? "bg-down" : "bg-dim";
  return <span className={cn("inline-block w-1.5 h-1.5 rounded-full", bg)} />;
}

// ── Sentiment strip (only when the source supplies scores) ───────────────────

function SentimentStrip({ articles }: { articles: any[] }) {
  const animate = useAnimate();
  const counts = useMemo(() => {
    const c = { bull: 0, neutral: 0, bear: 0 };
    for (const a of articles) {
      const t = toneOf(a.sentiment);
      if (t) c[t] += 1;
    }
    return c;
  }, [articles]);
  const total = counts.bull + counts.neutral + counts.bear;
  if (!total) return null;

  const segs: { key: Tone; n: number; cls: string; glyph: string; label: string; text: string }[] = [
    { key: "bull", n: counts.bull, cls: "bg-up", glyph: "▲", label: "Bullish", text: "text-up" },
    { key: "neutral", n: counts.neutral, cls: "bg-dim", glyph: "◆", label: "Neutral", text: "text-muted-foreground" },
    { key: "bear", n: counts.bear, cls: "bg-down", glyph: "▼", label: "Bearish", text: "text-down" },
  ];

  return (
    <div className="mb-3" data-testid="news-sentiment">
      <div className="flex items-center justify-between mb-1.5">
        <span className="hud-label">Sentiment · scored {total}</span>
        <span className="hud-tag">marketaux</span>
      </div>
      <div className="flex h-1.5 gap-[2px] bg-muted/40" role="img" aria-label={segs.map((s) => `${s.label} ${s.n}`).join(", ")}>
        {segs.map((s, i) =>
          s.n > 0 ? (
            <motion.div
              key={s.key}
              className={cn("h-full", s.cls)}
              initial={animate ? { width: 0 } : false}
              animate={{ width: `${(s.n / total) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.2 + i * 0.1, ease: [0.2, 0.8, 0.2, 1] }}
              title={`${s.label}: ${s.n} of ${total}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex gap-3 mt-1 text-[10px] tabular-nums">
        {segs.map((s) => (
          <span key={s.key} className={cn("inline-flex items-center gap-1", s.text)}>
            <span className="text-[8px]">{s.glyph}</span>
            {s.label} {s.n}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Article row ──────────────────────────────────────────────────────────────

function ArticleRow({
  article,
  idx,
  order,
  ticker,
  ambient,
  animate,
}: {
  article: any;
  idx: number;
  order: number;
  ticker: string;
  ambient: boolean;
  animate: boolean;
}) {
  const when = relTime(article.published_utc);
  const short = shortAge(article.published_utc);
  const age = ageMs(article.published_utc);
  const fresh = age != null && age >= 0 && age < 3 * 3600_000;
  const tone = toneOf(article.sentiment);
  const publisher: string | undefined = article.publisher?.name;

  return (
    <motion.a
      href={article.article_url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${article.title}${publisher ? `, ${publisher}` : ""}${when ? `, ${when}` : ""} (opens in new tab)`}
      className={cn(
        "group relative block pl-4 pr-3 py-3 border-b border-border/50 last:border-b-0",
        "transition-colors duration-200 hover:bg-up/[0.05] focus-visible:bg-up/[0.06]",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary focus-visible:-outline-offset-1",
      )}
      initial={animate ? { opacity: 0, x: -8 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: animate ? Math.min(order * 0.04, 0.6) : 0, ease: [0.2, 0.8, 0.2, 1] }}
      data-testid={`news-article-${idx}`}
    >
      {/* teal edge on hover / focus */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2px] bg-up box-glow-teal origin-top scale-y-0 transition-transform duration-300 group-hover:scale-y-100 group-focus-visible:scale-y-100"
      />

      {/* meta line */}
      <div className="flex items-center gap-2 text-[10px] tabular-nums min-w-0">
        <span className="text-dim shrink-0">{String(order + 1).padStart(2, "0")}</span>
        {publisher && (
          <span className="uppercase tracking-[.12em] text-primary/90 truncate min-w-0 max-w-[45%]">{publisher}</span>
        )}
        {short && (
          <>
            <span className="text-dim shrink-0" aria-hidden>·</span>
            <span className="text-muted-foreground shrink-0 whitespace-nowrap" title={when ?? undefined}>{short}</span>
          </>
        )}
        {fresh && (
          <span className="inline-flex items-center gap-1 text-up uppercase tracking-[.12em] shrink-0">
            {ambient ? <span className="live-dot" style={{ width: 5, height: 5 }} /> : <span className="w-[5px] h-[5px] rounded-full bg-up" />}
            new
          </span>
        )}
        {tone && (
          <span
            className={cn(
              "ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 h-[16px] border text-[9px] uppercase tracking-[.1em]",
              tone === "bull" && "border-up/40 bg-up/10 text-up",
              tone === "bear" && "border-down/40 bg-down/10 text-down",
              tone === "neutral" && "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            {tone === "bull" ? "▲ Bullish" : tone === "bear" ? "▼ Bearish" : "◆ Neutral"}
          </span>
        )}
        <ExternalLink
          aria-hidden
          className={cn(
            "w-3.5 h-3.5 text-primary shrink-0 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0",
            !tone && "ml-auto",
          )}
        />
      </div>

      {/* headline + summary */}
      <h3 className="font-read text-[13.5px] font-medium leading-snug text-foreground mt-1.5 line-clamp-2 group-hover:text-primary transition-colors">
        {article.title}
      </h3>
      {article.description && (
        <p className="font-read text-[12px] leading-relaxed text-muted-foreground mt-1 line-clamp-2">{article.description}</p>
      )}

      {/* related tickers */}
      {article.tickers && article.tickers.length >= 1 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {article.tickers.slice(0, 6).map((t: string) => (
            <span
              key={t}
              className="hud-chip !h-[18px] !px-1.5 !text-[9px] tabular-nums"
              data-active={t === ticker ? "true" : undefined}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </motion.a>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function NewsPanel({ ticker }: Props) {
  const { data, isLoading, error } = useNews(ticker);
  const articles: any[] = data?.results || [];
  const animate = useAnimate();
  const ambient = useAmbient();
  const [filter, setFilter] = useState<string>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: listRef });

  useEffect(() => {
    setFilter("all");
    listRef.current?.scrollTo({ top: 0 });
  }, [ticker]);

  // Top publishers for the filter (cheap: computed from the already-loaded list)
  const publishers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) {
      const name = a.publisher?.name;
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, n]) => ({ name, n }));
  }, [articles]);

  const showFilter = publishers.length >= 2 && articles.length >= 4;
  const activeFilter = showFilter && publishers.some((p) => p.name === filter) ? filter : "all";

  const visible = useMemo(
    () =>
      articles
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) => activeFilter === "all" || a.publisher?.name === activeFilter),
    [articles, activeFilter],
  );

  const status = isLoading ? "sampling" : error ? "offline" : articles.length ? "set" : "waiting";

  return (
    <Panel
      title="News"
      tag={<span className="hidden sm:inline">14d · marketaux + polygon</span>}
      icon={<Newspaper className="w-3.5 h-3.5 text-primary" aria-hidden />}
      delay={0.05}
      className="h-full"
      bodyClassName="flex flex-col"
      data-testid="news-panel"
      actions={
        <>
          <span className="hud-tag hidden md:inline-flex items-center gap-1.5">
            <StatusDot
              ambient={ambient}
              tone={status === "set" ? "hit" : status === "sampling" ? "amber" : status === "offline" ? "red" : "dim"}
            />
            {status}
          </span>
          <span className="hud-chip tabular-nums" title={`${articles.length} articles for ${ticker}`}>
            {ticker}
            <span className="text-foreground">{isLoading ? "··" : articles.length}</span>
          </span>
        </>
      }
    >
      {/* controls */}
      {!isLoading && !error && articles.length > 0 && (
        <>
          {showFilter && (
            <div className="mb-3 -mx-1 px-1 overflow-x-auto">
              <Segmented
                aria-label="Filter news by publisher"
                value={activeFilter}
                onChange={(v) => {
                  setFilter(v);
                  listRef.current?.scrollTo({ top: 0, behavior: animate ? "smooth" : "auto" });
                }}
                options={[
                  { value: "all", label: <span className="tabular-nums">All {articles.length}</span>, title: "All publishers" },
                  ...publishers.map((p) => ({
                    value: p.name,
                    label: (
                      <span className="tabular-nums">
                        {shortLabel(p.name)} <span className="opacity-60">{p.n}</span>
                      </span>
                    ),
                    title: `${p.name} (${p.n})`,
                  })),
                ]}
              />
            </div>
          )}
          <SentimentStrip articles={articles} />
        </>
      )}

      {/* scroll area: fixed height on mobile, fills the row (matched to Earnings) on desktop */}
      <div className="relative flex-1 min-h-[280px] lg:min-h-[520px] border border-border/60 bg-background/30">
        <motion.div
          aria-hidden
          className="absolute left-0 right-0 top-0 h-px bg-primary origin-left z-10 box-glow-teal"
          style={{ scaleX: scrollYProgress }}
        />
        <div
          ref={listRef}
          className="relative max-h-[460px] overflow-y-auto overflow-x-hidden pb-6 lg:max-h-none lg:absolute lg:inset-0"
        >
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="pl-4 pr-3 py-3 space-y-2 border-b border-border/50">
                <div className="h-2.5 w-1/3 skeleton-shimmer" />
                <div className="h-3.5 w-11/12 skeleton-shimmer" />
                <div className="h-3 w-3/4 skeleton-shimmer" />
              </div>
            ))
          ) : error ? (
            <div className="py-10 px-4 text-center">
              <div className="hud-label text-down mb-1">▼ feed error</div>
              <div className="text-sm text-muted-foreground">Unable to load news. Check API configuration.</div>
            </div>
          ) : articles.length === 0 ? (
            <div className="py-10 px-4 text-center">
              <div className="hud-label mb-1">◆ no signal</div>
              <div className="text-sm text-muted-foreground">No news found for {ticker} in the last 14 days.</div>
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeFilter}
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={animate ? { opacity: 0 } : undefined}
                transition={{ duration: 0.15 }}
              >
                {visible.map(({ a, idx }, order) => (
                  <ArticleRow
                    key={`${a.id ?? "n"}-${idx}`}
                    article={a}
                    idx={idx}
                    order={order}
                    ticker={ticker}
                    ambient={ambient}
                    animate={animate}
                  />
                ))}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        {/* bottom fade */}
        <div aria-hidden className="pointer-events-none absolute left-0 right-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
      </div>

      {!isLoading && !error && articles.length > 0 && (
        <div className="flex items-center justify-between gap-x-3 gap-y-0.5 flex-wrap mt-2 hud-tag tabular-nums">
          <span>
            showing {visible.length}/{articles.length}
          </span>
          <span>headlines from third-party sources</span>
        </div>
      )}
    </Panel>
  );
}
