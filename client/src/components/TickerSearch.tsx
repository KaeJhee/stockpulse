import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useTickerSearch } from "@/lib/hooks";

interface Props {
  onSelect: (ticker: string) => void;
}

export function TickerSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useTickerSearch(query);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const results = data?.results || [];

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query) {
              onSelect(query.toUpperCase());
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder="Search ticker (AAPL, NVDA...)"
          className="w-full h-9 pl-9 pr-8 text-sm bg-muted/60 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-muted-foreground"
          data-testid="input-ticker-search"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
            data-testid="button-clear-search"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && query.length >= 1 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-popover-border rounded-md shadow-lg z-50 max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 text-sm text-muted-foreground">Searching...</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              No results. Press Enter to look up "{query.toUpperCase()}" directly.
            </div>
          ) : (
            results.map((r: any) => (
              <button
                key={r.ticker}
                onClick={() => {
                  onSelect(r.ticker);
                  setQuery("");
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left hover:bg-accent flex items-center justify-between gap-2 transition-colors"
                data-testid={`search-result-${r.ticker}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-sm font-semibold shrink-0">{r.ticker}</span>
                  <span className="text-xs text-muted-foreground truncate">{r.name}</span>
                </div>
                <span className="text-[10px] text-muted-foreground uppercase shrink-0">{r.market}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
