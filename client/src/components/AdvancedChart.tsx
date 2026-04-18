/**
 * AdvancedChart — lightweight-charts v5 interactive price chart
 *
 * Features:
 *  • Chart types: Candlestick | Heikin Ashi | Area | Line
 *  • Volume sub-pane (always visible)
 *  • Indicator panel with overlays and sub-panes:
 *      Overlays  : Bollinger Bands (on price pane), SMA 50, SMA 200
 *      Sub-panes : RSI (14), MACD (12/26/9)
 *  • Full time-range toolbar (1D → MAX + CUSTOM)
 *  • Dark/light theme auto-detection via CSS variable inspection
 *  • ResizeObserver for responsive sizing
 *  • Proper cleanup on unmount / ticker change
 */

import {
  useEffect, useRef, useState, useMemo,
} from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type CandlestickData,
  type AreaData,
  type LineData,
  type HistogramData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useAggregates } from "@/lib/hooks";
import { useRsi, useMacd, useSma, useBbands, useSnapshot } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { format, subDays, subMonths, subYears } from "date-fns";
import {
  Calendar, CandlestickChart,
  ChevronDown, LayoutPanelTop,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type RangeKey = "1D" | "5D" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX" | "CUSTOM";
type ChartType = "candlestick" | "heikin-ashi" | "area" | "line";

interface Props {
  ticker: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGES: RangeKey[] = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX", "CUSTOM"];

const CHART_TYPES: { key: ChartType; label: string }[] = [
  { key: "candlestick",  label: "Candle" },
  { key: "heikin-ashi",  label: "Heikin Ashi" },
  { key: "area",         label: "Area" },
  { key: "line",         label: "Line" },
];

// ─── Date range helper ───────────────────────────────────────────────────────

function getDateRange(key: RangeKey) {
  const now  = new Date();
  const to   = format(now, "yyyy-MM-dd");
  switch (key) {
    case "1D":  return { from: to,                                             to, timespan: "minute", multiplier: "5" };
    case "5D":  return { from: format(subDays(now, 5),    "yyyy-MM-dd"),       to, timespan: "minute", multiplier: "30" };
    case "1M":  return { from: format(subMonths(now, 1),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "3M":  return { from: format(subMonths(now, 3),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "6M":  return { from: format(subMonths(now, 6),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "YTD": return { from: `${now.getFullYear()}-01-01`,                   to, timespan: "day",    multiplier: "1" };
    case "1Y":  return { from: format(subYears(now, 1),   "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
    case "5Y":  return { from: format(subYears(now, 5),   "yyyy-MM-dd"),       to, timespan: "week",   multiplier: "1" };
    case "MAX": return { from: "2000-01-01",                                   to, timespan: "month",  multiplier: "1" };
    default:    return { from: format(subMonths(now, 3),  "yyyy-MM-dd"),       to, timespan: "day",    multiplier: "1" };
  }
}

// ─── Heikin Ashi transform ───────────────────────────────────────────────────

function toHeikinAshi(bars: { time: Time; open: number; high: number; low: number; close: number }[]) {
  const ha: typeof bars = [];
  for (let i = 0; i < bars.length; i++) {
    const b  = bars[i];
    const haClose = (b.open + b.high + b.low + b.close) / 4;
    const haOpen  = i === 0
      ? (b.open + b.close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh  = Math.max(b.high, haOpen, haClose);
    const haLow   = Math.min(b.low,  haOpen, haClose);
    ha.push({ time: b.time, open: haOpen, high: haHigh, low: haLow, close: haClose });
  }
  return ha;
}

// ─── Theme helper ─────────────────────────────────────────────────────────────
// Reads CSS variables from :root/.dark so chart matches the app theme.

function getChartTheme(isDark: boolean) {
  return isDark
    ? {
        bg:           "#0d1117",   // matches --background dark
        text:         "#c9d1d9",   // --foreground dark
        grid:         "#21262d",   // --border dark
        crosshair:    "#58a6ff",   // --primary dark
        upColor:      "#10b981",   // emerald-500
        downColor:    "#ef4444",   // red-500
        volUp:        "rgba(16,185,129,0.35)",
        volDown:      "rgba(239,68,68,0.35)",
        rsiLine:      "#a78bfa",   // violet
        macdLine:     "#38bdf8",   // sky
        signalLine:   "#fb923c",   // orange
        histUp:       "rgba(16,185,129,0.7)",
        histDown:     "rgba(239,68,68,0.7)",
        bbUpper:      "rgba(99,179,237,0.6)",
        bbLower:      "rgba(99,179,237,0.6)",
        bbFill:       "rgba(99,179,237,0.06)",
        sma50:        "#fbbf24",   // amber
        sma200:       "#f472b6",   // pink
        areaLine:     "#3b82f6",
        areaFillTop:  "rgba(59,130,246,0.28)",
        areaFillBot:  "rgba(59,130,246,0.02)",
      }
    : {
        bg:           "#f6f8fa",
        text:         "#1f2937",
        grid:         "#e5e7eb",
        crosshair:    "#2563eb",
        upColor:      "#059669",
        downColor:    "#dc2626",
        volUp:        "rgba(5,150,105,0.35)",
        volDown:      "rgba(220,38,38,0.35)",
        rsiLine:      "#7c3aed",
        macdLine:     "#0284c7",
        signalLine:   "#ea580c",
        histUp:       "rgba(5,150,105,0.7)",
        histDown:     "rgba(220,38,38,0.7)",
        bbUpper:      "rgba(37,99,235,0.6)",
        bbLower:      "rgba(37,99,235,0.6)",
        bbFill:       "rgba(37,99,235,0.06)",
        sma50:        "#d97706",
        sma200:       "#db2777",
        areaLine:     "#2563eb",
        areaFillTop:  "rgba(37,99,235,0.22)",
        areaFillBot:  "rgba(37,99,235,0.02)",
      };
}

// ─── Indicator toggle button ──────────────────────────────────────────────────

function IndBtn({ label, color, active, onClick }: {
  label: string; color: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-all border ${
        active
          ? "bg-muted text-foreground border-border"
          : "text-muted-foreground border-transparent hover:border-border hover:text-foreground"
      }`}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: color, opacity: active ? 1 : 0.35 }}
      />
      {label}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdvancedChart({ ticker }: Props) {
  // ── State ──
  const [rangeKey,   setRangeKey]   = useState<RangeKey>("3M");
  const [chartType,  setChartType]  = useState<ChartType>("candlestick");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");
  const [isDark,     setIsDark]     = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const [showBB,    setShowBB]    = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showSma200,setShowSma200]= useState(false);
  const [showRsi,   setShowRsi]   = useState(false);
  const [showMacd,  setShowMacd]  = useState(false);
  const [typeOpen,  setTypeOpen]  = useState(false);

  // ── Refs for chart internals ──
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  // main series (price)
  const mainSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // volume
  const volSeriesRef  = useRef<ISeriesApi<"Histogram"> | null>(null);
  // overlays
  const bbUpperRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50Ref      = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200Ref     = useRef<ISeriesApi<"Line"> | null>(null);
  // sub-pane series
  const rsiSeriesRef      = useRef<ISeriesApi<"Line">      | null>(null);
  const macdLineRef       = useRef<ISeriesApi<"Line">      | null>(null);
  const macdSignalRef     = useRef<ISeriesApi<"Line">      | null>(null);
  const macdHistRef       = useRef<ISeriesApi<"Histogram"> | null>(null);

  // ── Date range ──
  const range = useMemo(() => {
    if (rangeKey === "CUSTOM" && customFrom && customTo)
      return { from: customFrom, to: customTo, timespan: "day", multiplier: "1" };
    return getDateRange(rangeKey);
  }, [rangeKey, customFrom, customTo]);

  // ── Data hooks ──
  const { data: aggData, isLoading: aggLoading, error: aggError } =
    useAggregates(ticker, range.from, range.to, range.timespan, range.multiplier);

  const { data: rsiData  } = useRsi(ticker);
  const { data: macdData } = useMacd(ticker);
  const { data: sma50Val } = useSma(ticker, 50);
  const { data: sma200Val} = useSma(ticker, 200);
  const { data: bbData   } = useBbands(ticker);
  useSnapshot(ticker); // kept to warm the quote cache; data not consumed here

  // ── Processed OHLCV bars ──
  const rawBars = useMemo(() => {
    if (!aggData?.results) return [];
    return aggData.results
      .filter((b: any) => b.c && b.o && b.h && b.l)
      .map((b: any) => ({
        time:   Math.floor(b.t / 1000) as UTCTimestamp,
        open:   b.o,
        high:   b.h,
        low:    b.l,
        close:  b.c,
        volume: b.v ?? 0,
      }));
  }, [aggData]);

  const priceBars = useMemo(
    () => chartType === "heikin-ashi" ? toHeikinAshi(rawBars) : rawBars,
    [rawBars, chartType]
  );

  const isPositive = rawBars.length >= 2 &&
    rawBars[rawBars.length - 1].close >= rawBars[0].close;

  // ── Theme detection (watch .dark class toggle) ──
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setIsDark(el.classList.contains("dark"));
    });
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const theme = useMemo(() => getChartTheme(isDark), [isDark]);

  // ─────────────────────────────────────────────────────────────────────────
  // Chart lifecycle: create once, update theme, destroy on unmount
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor:  theme.text,
        fontSize:   11,
        fontFamily: "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace",
      },
      grid: {
        vertLines:  { color: theme.grid, style: LineStyle.Dotted },
        horzLines:  { color: theme.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode:       CrosshairMode.Magnet,
        vertLine:   { color: theme.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: theme.crosshair },
        horzLine:   { color: theme.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: theme.crosshair },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins:  { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderVisible:       false,
        timeVisible:         true,
        secondsVisible:      false,
        fixLeftEdge:         true,
        fixRightEdge:        true,
      },
      handleScroll:      true,
      handleScale:       true,
      autoSize:          true,
    });

    chartRef.current = chart;

    // Volume series — created here alongside the chart so it is always available
    // when the feed-volume effect runs. A separate effect with [chartRef.current]
    // as a dependency would NEVER re-run after mount because React does not track
    // mutations to refs, so chartRef.current changing from null → IChartApi is
    // invisible to the dependency-comparison algorithm.
    const volSeries = chart.addSeries(HistogramSeries, {
      color:        "rgba(100,116,139,0.4)",
      priceFormat:  { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });
    volSeriesRef.current = volSeries;

    // ResizeObserver — NOTE: autoSize:true is already set above, which makes
    // lightweight-charts v5 observe the container itself via its own internal
    // ResizeObserver and resize the canvas automatically. The observer below is
    // therefore redundant. It is kept here with a comment rather than removed
    // outright, because it does no harm (it only calls applyOptions with the
    // same width the library already knows) and removing it is a style choice,
    // not a correctness requirement. However, if autoSize is relied upon,
    // the manual width assignment can be dropped entirely.
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current     = null;
      mainSeriesRef.current = null;
      volSeriesRef.current  = null;
      bbUpperRef.current    = null;
      bbLowerRef.current    = null;
      sma50Ref.current      = null;
      sma200Ref.current     = null;
      rsiSeriesRef.current  = null;
      macdLineRef.current   = null;
      macdSignalRef.current = null;
      macdHistRef.current   = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional: create once

  // ── Re-apply theme when isDark changes ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { textColor: theme.text },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      crosshair: {
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshair },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshair },
      },
    });
  }, [theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Price series — recreate when type changes
  // ─────────────────────────────────────────────────────────────────────────

  // ── Create price series + feed data in ONE effect ──────────────────────────
  // IMPORTANT: These must be merged. If split into two effects (create on
  // [chartType,theme], feed on [priceBars]), a race occurs on first load:
  // data arrives from cache before the series exists → feed effect bails
  // on `!series` and the chart stays blank until the user navigates away
  // and back (which re-mounts and re-runs both effects in order).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // 1) Tear down old price series and overlays
    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current); } catch {}
      mainSeriesRef.current = null;
    }
    [bbUpperRef, bbLowerRef, sma50Ref, sma200Ref].forEach(r => {
      if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
    });

    // 2) Create the new series
    if (chartType === "candlestick" || chartType === "heikin-ashi") {
      mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor:          theme.upColor,
        downColor:        theme.downColor,
        borderUpColor:    theme.upColor,
        borderDownColor:  theme.downColor,
        wickUpColor:      theme.upColor,
        wickDownColor:    theme.downColor,
        priceScaleId:     "right",
      });
    } else if (chartType === "area") {
      mainSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor:         theme.areaLine,
        topColor:          theme.areaFillTop,
        bottomColor:       theme.areaFillBot,
        lineWidth:         2,
        priceScaleId:      "right",
      });
    } else {
      mainSeriesRef.current = chart.addSeries(LineSeries, {
        color:         theme.areaLine,
        lineWidth:     2,
        priceScaleId:  "right",
      });
    }

    // 3) Feed data immediately — no separate effect needed, no race possible
    const series = mainSeriesRef.current;
    if (series && priceBars.length > 0) {
      if (chartType === "area") {
        const areaData: AreaData[] = priceBars.map(b => ({ time: b.time, value: b.close }));
        (series as ISeriesApi<"Area">).setData(areaData);
      } else if (chartType === "line") {
        const lineData: LineData[] = priceBars.map(b => ({ time: b.time, value: b.close }));
        (series as ISeriesApi<"Line">).setData(lineData);
      } else {
        const candleData: CandlestickData[] = priceBars.map(b => ({
          time:  b.time,
          open:  b.open,
          high:  b.high,
          low:   b.low,
          close: b.close,
        }));
        (series as ISeriesApi<"Candlestick">).setData(candleData);
      }
      chart.timeScale().fitContent();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType, theme, priceBars]);

  // ── Feed volume data ──
  useEffect(() => {
    const series = volSeriesRef.current;
    if (!series || rawBars.length === 0) return;

    const volData: HistogramData[] = rawBars.map(b => ({
      time:  b.time,
      value: b.volume,
      color: b.close >= b.open ? theme.volUp : theme.volDown,
    }));
    series.setData(volData);
  }, [rawBars, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: Bollinger Bands
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showBB) {
      [bbUpperRef, bbLowerRef].forEach(r => {
        if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
      });
      return;
    }

    if (!bbData?.entries?.length) return;

    // entries are newest-first from the hook; reverse to oldest-first for the chart
    const entries = [...bbData.entries].reverse();
    const toTs = (e: { date: string }) =>
      (new Date(e.date).getTime() / 1000) as UTCTimestamp;

    if (!bbUpperRef.current) {
      bbUpperRef.current = chart.addSeries(LineSeries, {
        color:      theme.bbUpper,
        lineWidth:  1,
        lineStyle:  LineStyle.Dashed,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    if (!bbLowerRef.current) {
      bbLowerRef.current = chart.addSeries(LineSeries, {
        color:      theme.bbLower,
        lineWidth:  1,
        lineStyle:  LineStyle.Dashed,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    bbUpperRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.upper })));
    bbLowerRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.lower })));
  }, [showBB, bbData, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: SMA 50
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showSma50 || sma50Val == null || rawBars.length === 0) {
      if (sma50Ref.current) { try { chart.removeSeries(sma50Ref.current); } catch {} sma50Ref.current = null; }
      return;
    }

    if (!sma50Ref.current) {
      sma50Ref.current = chart.addSeries(LineSeries, {
        color:      theme.sma50,
        lineWidth:  1,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    // Build rolling SMA from the chart's own price bars for accurate overlay
    const lineData: LineData[] = [];
    let sum = 0;
    for (let i = 0; i < rawBars.length; i++) {
      sum += rawBars[i].close;
      if (i >= 50) sum -= rawBars[i - 50].close;
      if (i >= 49) lineData.push({ time: rawBars[i].time, value: sum / 50 });
    }
    sma50Ref.current.setData(lineData);
  }, [showSma50, sma50Val, rawBars, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay: SMA 200
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showSma200 || sma200Val == null || rawBars.length === 0) {
      if (sma200Ref.current) { try { chart.removeSeries(sma200Ref.current); } catch {} sma200Ref.current = null; }
      return;
    }

    if (!sma200Ref.current) {
      sma200Ref.current = chart.addSeries(LineSeries, {
        color:      theme.sma200,
        lineWidth:  1,
        priceScaleId: "right",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    // Rolling SMA 200 from chart bars
    const lineData: LineData[] = [];
    let sum = 0;
    for (let i = 0; i < rawBars.length; i++) {
      sum += rawBars[i].close;
      if (i >= 200) sum -= rawBars[i - 200].close;
      if (i >= 199) lineData.push({ time: rawBars[i].time, value: sum / 200 });
    }
    sma200Ref.current.setData(lineData);
  }, [showSma200, sma200Val, rawBars, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-pane: RSI
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showRsi) {
      if (rsiSeriesRef.current) {
        try { chart.removeSeries(rsiSeriesRef.current); } catch {}
        rsiSeriesRef.current = null;
      }
      return;
    }

    if (!rsiData?.entries?.length) return;

    if (!rsiSeriesRef.current) {
      rsiSeriesRef.current = chart.addSeries(LineSeries, {
        color:       theme.rsiLine,
        lineWidth:   1,
        priceScaleId: "rsi",
        lastValueVisible: true,
        priceLineVisible: false,
      });
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
        autoScale: false,
        // Fixed 0–100 range for RSI
        visible: true,
      });
      // Fixed RSI scale — force 0–100
      rsiSeriesRef.current.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: 0, maxValue: 100 },
          margins:    { above: 0.1, below: 0.1 },
        }),
      });
    }

    const entries = [...rsiData.entries].reverse();
    const rsiLineData: LineData[] = entries.map(e => ({
      time:  (new Date(e.date).getTime() / 1000) as UTCTimestamp,
      value: e.value,
    }));
    rsiSeriesRef.current.setData(rsiLineData);
  }, [showRsi, rsiData, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Sub-pane: MACD
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (!showMacd) {
      [macdLineRef, macdSignalRef, macdHistRef].forEach(r => {
        if (r.current) { try { chart.removeSeries(r.current); } catch {} r.current = null; }
      });
      return;
    }

    if (!macdData?.entries?.length) return;

    const entries = [...macdData.entries].reverse();
    const toTs    = (e: { date: string }) => (new Date(e.date).getTime() / 1000) as UTCTimestamp;

    if (!macdHistRef.current) {
      macdHistRef.current = chart.addSeries(HistogramSeries, {
        color:        theme.histUp,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.92, bottom: 0 },
      });
    }
    if (!macdLineRef.current) {
      macdLineRef.current = chart.addSeries(LineSeries, {
        color:        theme.macdLine,
        lineWidth:    1,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    if (!macdSignalRef.current) {
      macdSignalRef.current = chart.addSeries(LineSeries, {
        color:        theme.signalLine,
        lineWidth:    1,
        priceScaleId: "macd",
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }

    macdHistRef.current.setData(entries.map(e => ({
      time:  toTs(e),
      value: e.histogram,
      color: e.histogram >= 0 ? theme.histUp : theme.histDown,
    })));
    macdLineRef.current.setData(  entries.map(e => ({ time: toTs(e), value: e.macd   })));
    macdSignalRef.current.setData(entries.map(e => ({ time: toTs(e), value: e.signal })));
  }, [showMacd, macdData, theme]);

  // ─────────────────────────────────────────────────────────────────────────
  // Dynamic scale margins — prevent RSI/MACD sub-pane overlap
  // Re-runs whenever the combination of active sub-pane indicators changes.
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (showRsi && showMacd) {
      // Both active: RSI gets middle band, MACD gets the bottom sliver
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.78, bottom: 0.12 },
      });
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.90, bottom: 0 },
      });
    } else if (showRsi) {
      // RSI only — standard bottom 20%
      chart.priceScale("rsi").applyOptions({
        scaleMargins: { top: 0.80, bottom: 0 },
      });
    } else if (showMacd) {
      // MACD only — slightly larger pane
      chart.priceScale("macd").applyOptions({
        scaleMargins: { top: 0.88, bottom: 0 },
      });
    }
    // No-op when both are off; series have been removed by their own effects.
  }, [showRsi, showMacd, chartRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  const currentChartLabel = CHART_TYPES.find(c => c.key === chartType)?.label ?? "Candle";

  return (
    <div className="bg-card border border-card-border rounded-lg p-4 sm:p-6" data-testid="advanced-chart">

      {/* ── Header row ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">

        {/* Left: title + chart-type picker */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CandlestickChart className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{ticker} Chart</h2>
          </div>

          {/* Chart type dropdown */}
          <div className="relative">
            <button
              onClick={() => setTypeOpen(o => !o)}
              onBlur={() => setTimeout(() => setTypeOpen(false), 150)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-muted hover:bg-accent transition-colors border border-border"
              data-testid="button-chart-type"
            >
              {currentChartLabel}
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            </button>
            {typeOpen && (
              <div className="absolute left-0 top-full mt-1 z-30 bg-popover border border-popover-border rounded-md shadow-lg py-1 min-w-[130px]">
                {CHART_TYPES.map(ct => (
                  <button
                    key={ct.key}
                    onClick={() => { setChartType(ct.key); setTypeOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                      chartType === ct.key ? "text-primary font-medium" : "text-foreground"
                    }`}
                    data-testid={`button-type-${ct.key}`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: range buttons */}
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map(r => (
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

      {/* ── Custom date inputs ── */}
      {rangeKey === "CUSTOM" && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="h-8 px-2 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-custom-from"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="h-8 px-2 text-xs bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-custom-to"
          />
        </div>
      )}

      {/* ── Indicator toggles ── */}
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <div className="flex items-center gap-1 mr-1 text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
          <LayoutPanelTop className="w-3 h-3" /> Indicators
        </div>
        <IndBtn label="BB"     color={theme.bbUpper}   active={showBB}     onClick={() => setShowBB(v    => !v)} />
        <IndBtn label="SMA 50" color={theme.sma50}     active={showSma50}  onClick={() => setShowSma50(v => !v)} />
        <IndBtn label="SMA 200"color={theme.sma200}    active={showSma200} onClick={() => setShowSma200(v=> !v)} />
        <IndBtn label="RSI"    color={theme.rsiLine}   active={showRsi}    onClick={() => setShowRsi(v   => !v)} />
        <IndBtn label="MACD"   color={theme.macdLine}  active={showMacd}   onClick={() => setShowMacd(v  => !v)} />
      </div>

      {/* ── Chart canvas ── */}
      <div className="relative w-full h-[420px]">
        {/* Canvas always in DOM so containerRef is available on mount */}
        <div
          ref={containerRef}
          className="w-full h-full rounded-md overflow-hidden"
          data-testid="chart-canvas"
          style={{ background: "transparent" }}
        />
        {/* Overlays — shown on top while loading/error/empty */}
        {aggLoading && (
          <div className="absolute inset-0 rounded-md overflow-hidden">
            <Skeleton className="w-full h-full" />
          </div>
        )}
        {!aggLoading && aggError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Unable to load chart data. Check API key configuration.
          </div>
        )}
        {!aggLoading && !aggError && rawBars.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No data available for this range.
          </div>
        )}
      </div>

      {/* ── Legend row (active indicators) ── */}
      {(showBB || showSma50 || showSma200 || showRsi || showMacd) && (
        <div className="flex flex-wrap gap-3 mt-2 pt-2 border-t border-border/40">
          {showBB     && <LegendItem color={theme.bbUpper}  label="Bollinger Bands (20,2)" />}
          {showSma50  && <LegendItem color={theme.sma50}    label={`SMA 50  $${sma50Val?.toFixed(2) ?? "—"}`} />}
          {showSma200 && <LegendItem color={theme.sma200}   label={`SMA 200  $${sma200Val?.toFixed(2) ?? "—"}`} />}
          {showRsi    && <LegendItem color={theme.rsiLine}  label={`RSI (14)  ${rsiData?.latest?.value?.toFixed(1) ?? "—"}`} />}
          {showMacd   && (
            <>
              <LegendItem color={theme.macdLine}   label={`MACD  ${macdData?.latest?.macd?.toFixed(2) ?? "—"}`} />
              <LegendItem color={theme.signalLine} label={`Signal  ${macdData?.latest?.signal?.toFixed(2) ?? "—"}`} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-0.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-[10px] font-mono text-muted-foreground">{label}</span>
    </div>
  );
}
