import { useNews } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { Newspaper, ExternalLink, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Props {
  ticker: string;
}

export function NewsPanel({ ticker }: Props) {
  const { data, isLoading, error } = useNews(ticker);
  const articles = data?.results || [];

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6 flex flex-col" data-testid="news-panel">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">News</h2>
        <span className="text-[11px] text-muted-foreground">14 days · Marketaux + Polygon</span>
        <span className="text-[11px] text-muted-foreground ml-auto">{ticker}</span>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[500px] space-y-1 -mx-1 px-1">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="p-3 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))
        ) : error ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Unable to load news. Check API configuration.
          </div>
        ) : articles.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No news found for {ticker} in the last 14 days.
          </div>
        ) : (
          articles.map((article: any, idx: number) => (
            <a
              key={idx}
              href={article.article_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 rounded-md hover:bg-accent/50 transition-colors group"
              data-testid={`news-article-${idx}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                  {article.title}
                </h3>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {article.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground flex-wrap">
                {article.publisher?.name && (
                  <span className="font-medium">{article.publisher.name}</span>
                )}
                {article.published_utc && (
                  <>
                    <span>·</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatDistanceToNow(new Date(article.published_utc), { addSuffix: true })}</span>
                    </div>
                  </>
                )}
                {article.sentiment != null && (
                  <span className={`ml-auto px-1.5 py-0.5 text-[10px] font-semibold rounded ${
                    article.sentiment > 0.1
                      ? "bg-emerald-500/15 text-emerald-400"
                      : article.sentiment < -0.1
                      ? "bg-red-500/15 text-red-400"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {article.sentiment > 0.1 ? "▲ Bullish" : article.sentiment < -0.1 ? "▼ Bearish" : "◆ Neutral"}
                  </span>
                )}
              </div>
              {article.tickers && article.tickers.length >= 1 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {article.tickers.slice(0, 6).map((t: string) => (
                    <span
                      key={t}
                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                        t === ticker ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </a>
          ))
        )}
      </div>
    </div>
  );
}
