"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import Wordmark from "@/components/Wordmark";

const MARKET_SYMBOLS = [
  { id: "BTC-USD", label: "Bitcoin", type: "symbol" },
  { id: "ETH-USD", label: "Ethereum", type: "symbol" },
  { id: "SPY", label: "S&P 500", type: "symbol" },
  { id: "QQQ", label: "Nasdaq", type: "symbol" },
  { id: "^VIX", label: "VIX", type: "symbol" },
] as const;

interface CorrelationPoint {
  time: string;
  attention_rank: number | null;
  attention_breakout: number | null;
  price_close: number | null;
  prediction_price_yes: number | null;
  prediction_change_pct?: number | null;
}

interface CorrelationResponse {
  meta: {
    trend: string;
    symbol: string | null;
    contract_id: string | null;
    prediction_question: string | null;
    window_hours: number;
    chart_points?: number;
    data_points: number;
    lag_step_hours?: number;
    google_trends_mode?: string;
  };
  series: CorrelationPoint[];
  lag_correlation: Array<{
    lag_hours: number;
    r_breakout_price: number | null;
    r_breakout_prediction: number | null;
    n: number;
  }>;
  best_lag: {
    lag_hours: number;
    r_breakout_price: number | null;
    r_breakout_prediction: number | null;
    n: number;
  } | null;
}

interface TrendSearchResult {
  entity_id: number;
  canonical_name: string;
  display_name: string;
  last_seen_at: string;
}

interface TrendHistoryResponse {
  meta: {
    entity_id: number;
    google_trends_mode?: string;
  };
  lifecycle: {
    appearances?: number;
    best_rank?: number;
    last_seen_at?: string;
    current_streak?: number;
  } | null;
  history: Array<{
    fetched_at: string;
    rank: number;
    breakout_score: number | null;
    persistence_score: number | null;
  }>;
}

interface BreakoutsResponse {
  breakouts: Array<{
    entity_id: number;
    trend_name_raw: string;
    breakout_score: number;
    rank: number;
  }>;
}

interface DailyRecapResponse {
  days: Array<{
    date: string;
    board: {
      snapshot_count: number;
      distinct_trends: number;
      new_entries: number;
      exits: number;
      avg_turnover: number;
    } | null;
  }>;
}

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function formatTimestamp(value: string) {
  const dt = new Date(value);
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getRelationshipLabel(value: number | null) {
  const strength = Math.abs(value ?? 0);
  if (strength >= 0.65) return "strong";
  if (strength >= 0.35) return "moderate";
  if (strength >= 0.15) return "light";
  return "weak";
}

function getDelta(values: Array<number | null | undefined>) {
  const numeric = values.filter((v): v is number => typeof v === "number");
  if (numeric.length < 2) return null;
  return numeric[numeric.length - 1] - numeric[0];
}

function getSignalConviction(value: number | null, points: number) {
  const strength = Math.abs(value ?? 0);

  if (value == null || points < 6) {
    return {
      label: "LOW CONFIDENCE",
      tone: "rgba(255,255,255,0.45)",
      border: "rgba(255,255,255,0.10)",
      bg: "rgba(255,255,255,0.04)",
      summary: "Paired overlap is still thin, so this should be treated as a weak read rather than a durable pattern.",
    };
  }

  if (strength >= 0.7 && points >= 14) {
    return {
      label: "HIGH CONVICTION",
      tone: value > 0 ? "#00E676" : "#FF5252",
      border: value > 0 ? "rgba(0,230,118,0.22)" : "rgba(255,82,82,0.22)",
      bg: value > 0 ? "rgba(0,230,118,0.08)" : "rgba(255,82,82,0.08)",
      summary: "There is enough overlap and enough movement here to treat this as a genuinely notable relationship.",
    };
  }

  if (strength >= 0.45 && points >= 10) {
    return {
      label: "MEDIUM CONVICTION",
      tone: "#FBBF24",
      border: "rgba(251,191,36,0.20)",
      bg: "rgba(251,191,36,0.08)",
      summary: "There is enough overlap to make this useful context, but not enough to overstate it.",
    };
  }

  return {
    label: "EXPLORATORY",
    tone: "#7C4DFF",
    border: "rgba(124,77,255,0.20)",
    bg: "rgba(124,77,255,0.08)",
    summary: "Interesting enough to monitor, but still too soft to treat as a strong behavioral pattern.",
  };
}

function getTimingLabel(lagHours: number) {
  if (lagHours > 0) return "ATTENTION-LED";
  if (lagHours < 0) return "MARKET-LED";
  return "IN SYNC";
}

export default function ResearchPage() {
  const [trendOptions, setTrendOptions] = useState<TrendSearchResult[]>([]);
  const [contracts, setContracts] = useState<{ id: string; question: string }[]>([]);
  const [selectedTrend, setSelectedTrend] = useState("");
  const [marketType, setMarketType] = useState<"symbol" | "contract">("symbol");
  const [selectedMarket, setSelectedMarket] = useState("");
  const [correlation, setCorrelation] = useState<CorrelationResponse | null>(null);
  const [trendHistory, setTrendHistory] = useState<TrendHistoryResponse | null>(null);
  const [breakouts, setBreakouts] = useState<BreakoutsResponse["breakouts"]>([]);
  const [dailyRecap, setDailyRecap] = useState<DailyRecapResponse["days"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);
  const [showRatingHelp, setShowRatingHelp] = useState(false);
  const [analystNote, setAnalystNote] = useState<string | null>(null);
  const [displayedAnalystNote, setDisplayedAnalystNote] = useState("");
  const [analystLoading, setAnalystLoading] = useState(false);

  useEffect(() => {
    const prefilledTrend = new URLSearchParams(window.location.search).get("trend");
    if (prefilledTrend) {
      setSelectedTrend(prefilledTrend);
    }
  }, []);

  useEffect(() => {
    fetch("/api/research/trends?limit=12")
      .then((r) => r.json())
      .then((d) => setTrendOptions(d.trends ?? []))
      .catch(() => setTrendOptions([]));
  }, []);

  useEffect(() => {
    fetch("/api/research/contracts")
      .then((r) => r.json())
      .then((d) => setContracts(d.contracts ?? []))
      .catch(() => setContracts([]));
  }, []);

  useEffect(() => {
    fetch("/api/research/breakouts?limit=5")
      .then((r) => r.json())
      .then((d) => setBreakouts(d.breakouts ?? []))
      .catch(() => setBreakouts([]));

    fetch("/api/research/daily?days=3")
      .then((r) => r.json())
      .then((d) => setDailyRecap(d.days ?? []))
      .catch(() => setDailyRecap([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const trimmed = selectedTrend.trim();
    const timeout = window.setTimeout(() => {
      const url =
        trimmed.length >= 2
          ? `/api/research/trends?q=${encodeURIComponent(trimmed)}&limit=12`
          : "/api/research/trends?limit=12";
      fetch(url, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setTrendOptions(d.trends ?? []))
        .catch(() => undefined);
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [selectedTrend]);

  useEffect(() => {
    if (!selectedTrend) {
      setTrendHistory(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/research/trend-history?trend=${encodeURIComponent(selectedTrend)}&window=${windowDays}d`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed"))))
      .then(setTrendHistory)
      .catch(() => setTrendHistory(null));

    return () => controller.abort();
  }, [selectedTrend, windowDays]);

  const fetchCorrelation = useCallback(() => {
    if (!selectedTrend || !selectedMarket) return;

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      trend: selectedTrend,
      window: `${windowDays}d`,
    });
    if (marketType === "symbol") {
      params.set("symbol", selectedMarket);
    } else {
      params.set("contract_id", selectedMarket);
    }

    fetch(`/api/research/correlation?${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((b) => { throw new Error(b.error || "Failed"); });
        return r.json();
      })
      .then(setCorrelation)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setCorrelation(null);
      })
      .finally(() => setLoading(false));
  }, [selectedTrend, selectedMarket, marketType, windowDays]);

  useEffect(() => {
    if (selectedTrend && selectedMarket) fetchCorrelation();
  }, [selectedTrend, selectedMarket, marketType, windowDays, fetchCorrelation]);

  const chartData = correlation?.series?.map((p) => ({
    ...p,
    date: formatDate(p.time),
    attention: p.attention_breakout ?? p.attention_rank ?? null,
    market: p.price_close ?? p.prediction_price_yes ?? null,
  })) ?? [];

  const hasAttention = chartData.some((d) => d.attention != null);
  const hasMarket = chartData.some((d) => d.market != null);
  const bestLag = correlation?.best_lag;
  const rPrice = bestLag?.r_breakout_price ?? null;
  const rPred = bestLag?.r_breakout_prediction ?? null;
  const r = rPrice ?? rPred;
  const lagHours = bestLag?.lag_hours ?? 0;
  const latestHistoryPoint =
    trendHistory && trendHistory.history.length > 0
      ? trendHistory.history[trendHistory.history.length - 1]
      : null;
  const historyPreview = trendHistory?.history.slice(-10) ?? [];
  const quickTrendOptions = trendOptions.slice(0, 6);
  const recentRecapDays = dailyRecap.slice(0, 3);

  const marketLabel =
    marketType === "symbol"
      ? MARKET_SYMBOLS.find((s) => s.id === selectedMarket)?.label ?? selectedMarket
      : contracts.find((c) => c.id === selectedMarket)?.question?.slice(0, 40) ?? "Polymarket";
  const attentionDelta = getDelta(chartData.map((d) => d.attention));
  const marketDelta = getDelta(chartData.map((d) => d.market));
  const relationshipLabel = getRelationshipLabel(r);
  const conviction = getSignalConviction(r, correlation?.meta.data_points ?? 0);
  const timingLabel = getTimingLabel(lagHours);
  const plainEnglishSummary =
    correlation && selectedTrend && selectedMarket
      ? (() => {
          const directionText =
            r == null
              ? "There is not enough overlap yet to say much about the relationship."
              : r > 0
                ? `${selectedTrend} momentum and ${marketLabel} have shown a ${relationshipLabel} positive relationship in this window, with ${conviction.label.toLowerCase()}.`
                : r < 0
                  ? `${selectedTrend} momentum and ${marketLabel} have shown a ${relationshipLabel} inverse relationship in this window, with ${conviction.label.toLowerCase()}.`
                  : `${selectedTrend} momentum and ${marketLabel} have moved mostly independently in this window.`;

          const lagText =
            lagHours > 0
              ? `Attention has tended to move first, with the market following about ${lagHours} hours later.`
              : lagHours < 0
                ? `${marketLabel} has tended to move first, with attention catching up about ${Math.abs(lagHours)} hours later.`
                : "Both series have tended to move on roughly the same timing.";

          const attentionText =
            attentionDelta == null
              ? "Attention momentum is still too sparse to describe a clear move."
              : attentionDelta > 0
                ? `Breakout momentum strengthened by about ${attentionDelta.toFixed(1)} points across the selected window.`
                : attentionDelta < 0
                  ? `Breakout momentum cooled by about ${Math.abs(attentionDelta).toFixed(1)} points across the selected window.`
                  : "Breakout momentum ended close to where it started.";

          const marketText =
            marketDelta == null
              ? "The paired market series does not yet have enough movement to summarize."
              : marketType === "symbol"
                ? marketDelta > 0
                  ? `${marketLabel} finished about ${marketDelta.toFixed(2)} points higher over the same period.`
                  : marketDelta < 0
                    ? `${marketLabel} finished about ${Math.abs(marketDelta).toFixed(2)} points lower over the same period.`
                    : `${marketLabel} finished roughly flat over the same period.`
                : marketDelta > 0
                  ? `Polymarket yes-odds rose by about ${(marketDelta * 100).toFixed(1)} percentage points.`
                  : marketDelta < 0
                    ? `Polymarket yes-odds fell by about ${Math.abs(marketDelta * 100).toFixed(1)} percentage points.`
                    : "Polymarket yes-odds finished roughly flat.";

          return `${directionText} ${lagText} ${attentionText} ${marketText} ${conviction.summary}`;
        })()
      : null;

  useEffect(() => {
    setAnalystNote(null);
    setDisplayedAnalystNote("");

    if (!correlation || !selectedTrend || !selectedMarket) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      trend: selectedTrend,
      market_label: marketLabel,
      conviction: conviction.label,
      relationship: relationshipLabel,
      timing: timingLabel,
      correlation: r != null ? r.toFixed(3) : "n/a",
      lag_hours: String(lagHours),
      data_points: String(correlation.meta.data_points),
      window_days: String(windowDays),
      attention_delta: attentionDelta != null ? attentionDelta.toFixed(2) : "n/a",
      market_delta: marketDelta != null ? marketDelta.toFixed(2) : "n/a",
    });

    setAnalystLoading(true);
    fetch(`/api/research/analyst-note?${params.toString()}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Analyst note unavailable");
        }
        return response.json();
      })
      .then((payload) => {
        setAnalystNote(typeof payload.note === "string" ? payload.note : null);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setAnalystNote(null);
      })
      .finally(() => setAnalystLoading(false));

    return () => controller.abort();
  }, [
    attentionDelta,
    conviction.label,
    correlation,
    lagHours,
    marketDelta,
    marketLabel,
    relationshipLabel,
    selectedMarket,
    selectedTrend,
    timingLabel,
    windowDays,
    r,
  ]);

  useEffect(() => {
    if (!analystNote) {
      setDisplayedAnalystNote("");
      return;
    }

    setDisplayedAnalystNote("");
    let index = 0;
    const delayMs = 12;
    const timer = window.setInterval(() => {
      index += 2;
      setDisplayedAnalystNote(analystNote.slice(0, index));
      if (index >= analystNote.length) {
        window.clearInterval(timer);
      }
    }, delayMs);

    return () => window.clearInterval(timer);
  }, [analystNote]);

  return (
    <div className="min-h-screen bg-[#07070C] text-white research-shell">
      <header className="border-b border-white/5 px-4 sm:px-5 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Wordmark className="h-5 w-auto" />
          <span className="font-mono text-[8px] text-white/25 tracking-[0.1em]">RESEARCH</span>
        </Link>
        <Link
          href="/"
          className="font-mono text-[9px] text-white/40 hover:text-white/70 transition-colors"
        >
          ← DASHBOARD
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
        <div className="mb-8">
          <h1 className="font-grotesk text-2xl sm:text-3xl font-bold text-white/95 tracking-tight mb-1">
            Trend × Market
          </h1>
          <p className="font-mono text-[11px] text-white/40 tracking-[0.04em]">
            US-only snapshot research. Compare historical attention with market prices or prediction markets and inspect timing, breakout history, and recent board context.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="font-mono text-[8px] px-2.5 py-1 rounded-full border border-[#00E676]/20 bg-[#00E676]/[0.08] text-[#00E676]">
              US-ONLY DATASET
            </span>
            <span className="font-mono text-[8px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/50">
              GOOGLE TRENDS = QUALITATIVE CONFIRMATION
            </span>
            <span className="font-mono text-[8px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/40">
              SNAPSHOT CADENCE, NOT LIVE TICK DATA
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8 flex-wrap research-panel">
          <div className="flex-1 min-w-[200px]">
            <label className="font-mono text-[9px] text-white/35 tracking-[0.08em] block mb-1.5">
              TREND SEARCH
            </label>
            <input
              value={selectedTrend}
              onChange={(e) => setSelectedTrend(e.target.value)}
              list="trend-search-options"
              placeholder="Search current or historical US trends"
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 font-mono text-[12px] text-white/90 focus:outline-none focus:border-white/25"
            />
            <datalist id="trend-search-options">
              {trendOptions.map((t) => (
                <option key={t.entity_id} value={t.display_name}>
                  {t.canonical_name}
                </option>
              ))}
            </datalist>
            <div className="mt-1 font-mono text-[8px] text-white/25 tracking-[0.06em]">
              SEARCHES THE US TREND HISTORY, NOT JUST THE CURRENT BOARD
            </div>
            {quickTrendOptions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {quickTrendOptions.map((trend) => (
                  <button
                    key={trend.entity_id}
                    type="button"
                    onClick={() => setSelectedTrend(trend.display_name)}
                    className={`research-select-chip ${
                      selectedTrend === trend.display_name ? "research-select-chip-active" : ""
                    }`}
                  >
                    {trend.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setMarketType("symbol"); setSelectedMarket(""); }}
              className={`px-3 py-2 rounded font-mono text-[10px] transition-colors ${
                marketType === "symbol"
                  ? "bg-white/10 text-white border border-white/20"
                  : "bg-white/[0.02] text-white/40 border border-white/5 hover:border-white/10"
              }`}
            >
              MARKETS
            </button>
            <button
              onClick={() => { setMarketType("contract"); setSelectedMarket(""); }}
              className={`px-3 py-2 rounded font-mono text-[10px] transition-colors ${
                marketType === "contract"
                  ? "bg-white/10 text-white border border-white/20"
                  : "bg-white/[0.02] text-white/40 border border-white/5 hover:border-white/10"
              }`}
            >
              POLYMARKET
            </button>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="font-mono text-[9px] text-white/35 tracking-[0.08em] block mb-1.5">
              {marketType === "symbol" ? "MARKET" : "CONTRACT"}
            </label>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 font-mono text-[12px] text-white/90 focus:outline-none focus:border-white/25"
            >
              <option value="">Select</option>
              {marketType === "symbol"
                ? MARKET_SYMBOLS.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))
                : contracts.map((c) => (
                    <option key={c.id} value={c.id} title={c.question}>
                      {c.question?.slice(0, 50)}…
                    </option>
                  ))}
            </select>
          </div>

          <div className="w-28">
            <label className="font-mono text-[9px] text-white/35 tracking-[0.08em] block mb-1.5">
              WINDOW
            </label>
            <select
              value={windowDays}
              onChange={(e) => setWindowDays(parseInt(e.target.value, 10))}
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 font-mono text-[12px] text-white/90 focus:outline-none focus:border-white/25"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 research-card research-mini-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                TREND HISTORY
              </div>
              <div className="font-mono text-[8px] tracking-[0.08em] text-white/18">
                ENTITY VIEW
              </div>
            </div>
            {selectedTrend && trendHistory ? (
              <div className="space-y-3">
                <div>
                  <div className="font-grotesk text-[18px] sm:text-[20px] text-white/92 leading-6">
                    {selectedTrend}
                  </div>
                  <div className="font-mono text-[8px] text-white/28 mt-1 tracking-[0.08em]">
                    {latestHistoryPoint ? `LAST SEEN ${formatTimestamp(latestHistoryPoint.fetched_at).toUpperCase()}` : "HISTORY LOADED"}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="research-stat-chip">
                    <div className="research-stat-label">APPEARANCES</div>
                    <div className="research-stat-value">{trendHistory.lifecycle?.appearances ?? "—"}</div>
                  </div>
                  <div className="research-stat-chip">
                    <div className="research-stat-label">BEST RANK</div>
                    <div className="research-stat-value">#{trendHistory.lifecycle?.best_rank ?? "—"}</div>
                  </div>
                  <div className="research-stat-chip">
                    <div className="research-stat-label">CURRENT STREAK</div>
                    <div className="research-stat-value">{trendHistory.lifecycle?.current_streak ?? "—"}</div>
                  </div>
                  <div className="research-stat-chip">
                    <div className="research-stat-label">LAST POINT</div>
                    <div className="research-stat-value">{latestHistoryPoint?.rank != null ? `#${latestHistoryPoint.rank}` : "—"}</div>
                  </div>
                </div>

                {historyPreview.length > 0 && (
                  <div>
                    <div className="font-mono text-[8px] text-white/24 tracking-[0.08em] mb-2">
                      RECENT BREAKOUT PATH
                    </div>
                    <div className="research-history-track">
                      {historyPreview.map((point, index) => {
                        const breakout = Math.max(0, Math.min(100, point.breakout_score ?? 0));
                        return (
                          <div key={`${point.fetched_at}-${index}`} className="flex-1 min-w-0">
                            <div
                              className="research-history-bar"
                              style={{ height: `${Math.max(10, breakout)}%` }}
                              title={`${formatTimestamp(point.fetched_at)} · breakout ${breakout.toFixed(1)} · rank #${point.rank}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="font-mono text-[8px] text-white/25">
                  Google Trends stays in this view as a qualitative confirmation signal only.
                </div>
              </div>
            ) : (
              <div className="font-mono text-[10px] text-white/30 leading-5">
                Pick a trend to inspect its historical lifecycle, recent rank path, and breakout persistence.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 research-card research-mini-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                CURRENT BREAKOUTS
              </div>
              <div className="font-mono text-[8px] tracking-[0.08em] text-white/18">
                TAP TO PREFILL
              </div>
            </div>
            <div className="space-y-2">
              {breakouts.slice(0, 5).map((item) => {
                const isActive = selectedTrend === item.trend_name_raw;
                return (
                  <button
                    key={item.entity_id}
                    type="button"
                    onClick={() => setSelectedTrend(item.trend_name_raw)}
                    className={`research-breakout-row ${isActive ? "research-breakout-row-active" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] text-white/80 truncate">{item.trend_name_raw}</div>
                      <div className="font-mono text-[8px] text-white/28 mt-1">
                        Current board breakout candidate
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="font-mono text-[8px] rounded-full px-2 py-1 border border-[#FBBF24]/20 bg-[#FBBF24]/[0.08] text-[#FBBF24]">
                        {item.breakout_score.toFixed(1)}
                      </span>
                      <span className="font-mono text-[8px] text-white/35">#{item.rank}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 research-card research-mini-card">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                DAILY RECAP
              </div>
              <div className="font-mono text-[8px] tracking-[0.08em] text-white/18">
                LAST 3 BUCKETS
              </div>
            </div>
            {recentRecapDays.length > 0 ? (
              <div className="space-y-2">
                {recentRecapDays.map((day) => (
                  <div key={day.date} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="font-mono text-[9px] text-white/65">{formatDate(day.date)}</div>
                      <div className="font-mono text-[8px] text-white/22">{day.board?.snapshot_count ?? 0} snapshots</div>
                    </div>
                    {day.board ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="research-stat-chip">
                          <div className="research-stat-label">DISTINCT</div>
                          <div className="research-stat-value">{day.board.distinct_trends}</div>
                        </div>
                        <div className="research-stat-chip">
                          <div className="research-stat-label">TURNOVER</div>
                          <div className="research-stat-value">{day.board.avg_turnover.toFixed(2)}</div>
                        </div>
                        <div className="research-stat-chip">
                          <div className="research-stat-label">NEW</div>
                          <div className="research-stat-value">{day.board.new_entries}</div>
                        </div>
                        <div className="research-stat-chip">
                          <div className="research-stat-label">EXITS</div>
                          <div className="research-stat-value">{day.board.exits}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-[9px] text-white/26">No recap data for this bucket.</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="font-mono text-[10px] text-white/30 leading-5">
                Daily rollup recap will appear here once recent US rollups are available.
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded bg-[#FF5252]/10 border border-[#FF5252]/20 font-mono text-[11px] text-[#FF5252]">
            {error}
          </div>
        )}

        {loading && (
          <div className="h-80 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center research-card">
            <div className="font-mono text-[11px] text-white/30 animate-pulse">Loading…</div>
          </div>
        )}

        {!loading && correlation && chartData.length > 0 && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <span
                className="font-mono text-[9px] px-2.5 py-1 rounded-full border"
                style={{
                  color: conviction.tone,
                  background: conviction.bg,
                  borderColor: conviction.border,
                }}
              >
                {conviction.label}
              </span>
              <span className="font-mono text-[9px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/55">
                {timingLabel}
              </span>
              <span className="font-mono text-[9px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/45">
                {relationshipLabel.toUpperCase()} RELATIONSHIP
              </span>
              <button
                type="button"
                onClick={() => setShowRatingHelp((current) => !current)}
                className="font-mono text-[9px] px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03] text-white/45 hover:text-white/75 hover:border-white/20 transition-colors"
              >
                WHY THIS RATING?
              </button>
            </div>

            {showRatingHelp && (
              <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 research-card research-rise">
                <div className="font-mono text-[8px] tracking-[0.12em] text-white/35 mb-2">
                  CONVICTION EXPLAINER
                </div>
                <p className="font-mono text-[10px] leading-5 text-white/55">
                  This rating is based on two things: how strong the correlation is and how many paired change observations
                  exist after alignment. Right now the reading is <span style={{ color: conviction.tone }}>{r != null ? r.toFixed(3) : "n/a"}</span> across{" "}
                  <span className="text-white/75">{correlation.meta.data_points}</span> paired observations.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-[9px] text-white/35">
                  <span className="rounded-full border border-white/10 px-2 py-1 bg-white/[0.03]">High: |r| ≥ 0.70 and 14+ paired points</span>
                  <span className="rounded-full border border-white/10 px-2 py-1 bg-white/[0.03]">Medium: |r| ≥ 0.45 and 10+ paired points</span>
                  <span className="rounded-full border border-white/10 px-2 py-1 bg-white/[0.03]">Otherwise: exploratory / low overlap</span>
                </div>
              </div>
            )}

            {(hasAttention || hasMarket) && (
              <div className="mb-6 p-4 sm:p-5 rounded-xl bg-white/[0.02] border border-white/[0.06] research-card research-rise">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-[#00E676]/[0.05] border border-[#00E676]/[0.12] px-3 py-2">
                    <div className="font-mono text-[8px] text-white/30 tracking-[0.08em] mb-0.5">
                      CORRELATION
                    </div>
                    <div
                      className="font-mono text-lg font-bold"
                      style={{
                        color: r != null && r > 0 ? "#00E676" : r != null && r < 0 ? "#FF5252" : "rgba(255,255,255,0.5)",
                      }}
                    >
                      {r != null ? r.toFixed(3) : "—"}
                    </div>
                    <div className="font-mono text-[8px] text-white/25 mt-0.5">
                      {conviction.label}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#7C4DFF]/[0.05] border border-[#7C4DFF]/[0.12] px-3 py-2">
                    <div className="font-mono text-[8px] text-white/30 tracking-[0.08em] mb-0.5">
                      BEST LAG
                    </div>
                    <div className="font-mono text-lg font-bold text-white/90">
                      {lagHours > 0 ? `+${lagHours}h` : lagHours < 0 ? `${lagHours}h` : "0h"}
                    </div>
                    <div className="font-mono text-[8px] text-white/25 mt-0.5">
                      {lagHours > 0 ? "Attention leads" : lagHours < 0 ? "Market leads" : "In sync"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2">
                    <div className="font-mono text-[8px] text-white/30 tracking-[0.08em] mb-0.5">
                      PAIRED POINTS
                    </div>
                    <div className="font-mono text-lg font-bold text-white/90">
                      {correlation.meta.data_points}
                    </div>
                    <div className="font-mono text-[8px] text-white/25 mt-0.5">
                      {correlation.meta.chart_points ?? chartData.length} chart points
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#FBBF24]/[0.05] border border-[#FBBF24]/[0.12] px-3 py-2">
                    <div className="font-mono text-[8px] text-white/30 tracking-[0.08em] mb-0.5">
                      WINDOW
                    </div>
                    <div className="font-mono text-lg font-bold text-white/90">
                      {correlation.meta.window_hours / 24}d
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 sm:p-5 research-card research-rise">
              <div className="h-72 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <defs>
                      <linearGradient id="attentionFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00E676" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#00E676" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="marketFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FBBF24" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="#FBBF24" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                      stroke="rgba(255,255,255,0.1)"
                    />
                    <YAxis
                      yAxisId="attention"
                      orientation="left"
                      tick={{ fontSize: 10, fill: "#00E676" }}
                      stroke="#00E676"
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
                    />
                    <YAxis
                      yAxisId="market"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "#FBBF24" }}
                      stroke="#FBBF24"
                      domain={["auto", "auto"]}
                      tickFormatter={(v) => (typeof v === "number" ? v.toFixed(2) : v)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(10,10,12,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontFamily: "var(--font-jetbrains)",
                        fontSize: "11px",
                      }}
                      labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                      formatter={(value, name) => [
                        typeof value === "number" ? value.toFixed(3) : String(value ?? ""),
                        String(name) === "attention" ? "Attention (breakout)" : "Market",
                      ]}
                      labelFormatter={(label) => label}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "10px" }}
                      formatter={(value) => (
                        <span className="font-mono text-[10px]">
                          {value === "attention" ? "Attention" : marketLabel}
                        </span>
                      )}
                    />
                    {hasAttention && (
                      <Area
                        yAxisId="attention"
                        type="monotone"
                        dataKey="attention"
                        stroke="none"
                        fill="url(#attentionFill)"
                        connectNulls
                        isAnimationActive
                        animationDuration={900}
                      />
                    )}
                    {hasMarket && (
                      <Area
                        yAxisId="market"
                        type="monotone"
                        dataKey="market"
                        stroke="none"
                        fill="url(#marketFill)"
                        connectNulls
                        isAnimationActive
                        animationDuration={1100}
                      />
                    )}
                    {hasAttention && (
                      <Line
                        yAxisId="attention"
                        type="monotone"
                        dataKey="attention"
                        stroke="#00E676"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "#00E676", stroke: "#07070C", strokeWidth: 2 }}
                        name="attention"
                        connectNulls
                        isAnimationActive
                        animationDuration={900}
                      />
                    )}
                    {hasMarket && (
                      <Line
                        yAxisId="market"
                        type="monotone"
                        dataKey="market"
                        stroke="#FBBF24"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, fill: "#FBBF24", stroke: "#07070C", strokeWidth: 2 }}
                        name="market"
                        connectNulls
                        isAnimationActive
                        animationDuration={1100}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between mt-2 font-mono text-[8px] text-white/25">
                <span style={{ color: "#00E676" }}>● Attention (breakout score)</span>
                <span style={{ color: "#FBBF24" }}>● {marketLabel}</span>
              </div>
            </div>

            {plainEnglishSummary && (
              <div className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-4 sm:px-5 research-card research-rise">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                    SIGNAL READOUT
                  </div>
                  <div className="font-mono text-[8px] tracking-[0.08em] text-white/20">
                    {conviction.label}
                  </div>
                </div>
                <p className="font-grotesk text-[15px] sm:text-[17px] leading-6 text-white/88">
                  {plainEnglishSummary}
                </p>
                <p className="mt-2 font-mono text-[9px] leading-4 text-white/28">
                  Read this as directional context rather than proof. Correlation can highlight alignment and timing,
                  but it does not prove causation.
                </p>

                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="font-mono text-[8px] tracking-[0.12em] text-white/35">
                      ANALYST NOTE
                    </div>
                    <div className="font-mono text-[8px] tracking-[0.08em] text-white/20">
                      OPTIONAL AI LAYER
                    </div>
                  </div>
                  {analystLoading ? (
                    <div className="font-mono text-[10px] text-white/28 animate-pulse">
                      Writing analyst note...
                    </div>
                  ) : analystNote ? (
                    <div className="analyst-note-card rounded-xl px-4 py-4 sm:px-5">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="font-mono text-[8px] tracking-[0.12em] text-white/30">
                          DESK NOTE
                        </div>
                        <div className="font-mono text-[8px] tracking-[0.08em] text-white/18">
                          GENERATED FROM CURRENT SIGNAL
                        </div>
                      </div>
                      <p className="font-grotesk text-[14px] sm:text-[15px] leading-6 text-white/78 min-h-[48px]">
                        {displayedAnalystNote}
                        {displayedAnalystNote.length < analystNote.length && (
                          <span className="analyst-note-cursor" aria-hidden="true" />
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="font-mono text-[9px] leading-4 text-white/22">
                      Analyst note unavailable right now. The core interpretation above still reflects the selected signal.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !correlation && selectedTrend && selectedMarket && (
          <div className="h-48 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-center">
            <div className="font-mono text-[11px] text-white/30">No data for this combination yet.</div>
          </div>
        )}

        {!selectedTrend && !selectedMarket && (
          <div className="mt-12 p-8 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
            <div className="font-mono text-[11px] text-white/40 max-w-md mx-auto">
              Select a trend and a market to see how attention correlates with price or prediction odds.
              Lower rank = higher attention. Breakout score measures momentum.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
