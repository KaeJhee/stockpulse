import { useState, useCallback } from "react";
import { TickerSearch } from "@/components/TickerSearch";
import { QuoteHeader } from "@/components/QuoteHeader";
import { AdvancedChart } from "@/components/AdvancedChart";
import { NewsPanel } from "@/components/NewsPanel";
import { EarningsPanel } from "@/components/EarningsPanel";
import { MarketOverview } from "@/components/MarketOverview";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SettingsModal, SettingsButton } from "@/components/SettingsModal";
import { ApiHealthIndicator } from "@/components/ApiHealthIndicator";
import { TechnicalIndicators } from "@/components/TechnicalIndicators";
import { FundamentalsPanel } from "@/components/FundamentalsPanel";
import { useSchwabAuth } from "@/lib/hooks";
import { TrendingUp, Moon, Sun, Link, Unlink, ChevronLeft } from "lucide-react";

export default function Dashboard() {
  const [ticker, setTicker] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: schwabAuth } = useSchwabAuth();
  const schwabConnected = schwabAuth?.authenticated ?? false;

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight hidden sm:inline" data-testid="app-title">
              StockPulse
            </span>
          </div>

          <div className="flex-1 max-w-md">
            <TickerSearch onSelect={setTicker} />
          </div>

          {/* Schwab connect/disconnect button */}
          {schwabConnected ? (
            <a
              href="/api/auth/logout"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors border border-emerald-500/20"
              title="Schwab connected — click to disconnect"
            >
              <Link className="w-3 h-3" />
              <span className="hidden sm:inline">Schwab</span>
            </a>
          ) : (
            <a
              href="/api/auth/login"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-accent transition-colors border border-border"
              title="Connect your Schwab account for real-time data"
            >
              <Unlink className="w-3 h-3 text-muted-foreground" />
              <span className="hidden sm:inline text-muted-foreground">Connect Schwab</span>
            </a>
          )}

          {/* API health indicator */}
          <ApiHealthIndicator />

          {/* Settings gear */}
          <SettingsButton onClick={() => setSettingsOpen(true)} />

          <button
            onClick={toggleTheme}
            className="p-2 rounded-md hover:bg-muted transition-colors"
            aria-label="Toggle theme"
            data-testid="button-toggle-theme"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-4 sm:py-6">
        {!ticker ? (
          <MarketOverview onSelect={setTicker} />
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* Back to market overview */}
            <button
              onClick={() => setTicker(null)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-back-overview"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Market Overview
            </button>

            {/* Quote + Price Chart */}
            <QuoteHeader ticker={ticker} />
            <AdvancedChart ticker={ticker} />

            {/* Technical + Fundamentals row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <TechnicalIndicators ticker={ticker} />
              <FundamentalsPanel ticker={ticker} />
            </div>

            {/* News + Earnings row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <NewsPanel ticker={ticker} />
              <EarningsPanel ticker={ticker} />
            </div>
          </div>
        )}
      </main>

      <PerplexityAttribution />

      {/* Settings Modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
