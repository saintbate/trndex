"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
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
}

interface CorrelationResponse {
  meta: {
    trend: string;
    symbol: string | null;
    contract_id: string | null;
    prediction_question: string | null;
    window_hours: number;
    data_points: number;
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

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function ResearchPage() {
  const [trends, setTrends] = useState<{ trend_name: string }[]>([]);
  const [contracts, setContracts] = useState<{ id: string; question: string }[]>([]);
  const [selectedTrend, setSelectedTrend] = useState("");
  const [marketType, setMarketType] = useState<"symbol" | "contract">("symbol");
  const [selectedMarket, setSelectedMarket] = useState("");
  const [correlation, setCorrelation] = useState<CorrelationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);

  useEffect(() => {
    fetch("/api/trends?woeid=23424977")
      .then((r) => r.json())
      .then((d) => setTrends(d.trends ?? []))
      .catch(() => setTrends([]));
  }, []);

  useEffect(() => {
    fetch("/api/research/contracts")
      .then((r) => r.json())
      .then((d) => setContracts(d.contracts ?? []))
      .catch(() => setContracts([]));
  }, []);

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

  const marketLabel =
    marketType === "symbol"
      ? MARKET_SYMBOLS.find((s) => s.id === selectedMarket)?.label ?? selectedMarket
      : contracts.find((c) => c.id === selectedMarket)?.question?.slice(0, 40) ?? "Polymarket";

  return (
    <div className="min-h-screen bg-[#07070C] text-white">
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
            Compare X attention with market prices or prediction markets. See if attention leads or lags.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-8 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="font-mono text-[9px] text-white/35 tracking-[0.08em] block mb-1.5">
              TREND
            </label>
            <select
              value={selectedTrend}
              onChange={(e) => setSelectedTrend(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded px-3 py-2 font-mono text-[12px] text-white/90 focus:outline-none focus:border-white/25"
            >
              <option value="">Select a trend</option>
              {trends.map((t) => (
                <option key={t.trend_name} value={t.trend_name}>
                  {t.trend_name}
                </option>
              ))}
            </select>
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

        {error && (
          <div className="mb-6 p-4 rounded bg-[#FF5252]/10 border border-[#FF5252]/20 font-mono text-[11px] text-[#FF5252]">
            {error}
          </div>
        )}

        {loading && (
          <div className="h-80 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center">
            <div className="font-mono text-[11px] text-white/30 animate-pulse">Loading…</div>
          </div>
        )}

        {!loading && correlation && chartData.length > 0 && (
          <>
            {(hasAttention || hasMarket) && (
              <div className="mb-6 p-4 sm:p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
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
                  </div>
                  <div>
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
                  <div>
                    <div className="font-mono text-[8px] text-white/30 tracking-[0.08em] mb-0.5">
                      DATA POINTS
                    </div>
                    <div className="font-mono text-lg font-bold text-white/90">
                      {correlation.meta.data_points}
                    </div>
                  </div>
                  <div>
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

            <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 sm:p-5">
              <div className="h-72 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
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
                      <Line
                        yAxisId="attention"
                        type="monotone"
                        dataKey="attention"
                        stroke="#00E676"
                        strokeWidth={2}
                        dot={false}
                        name="attention"
                        connectNulls
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
                        name="market"
                        connectNulls
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
