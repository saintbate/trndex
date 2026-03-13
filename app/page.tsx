"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { TrendsResponse } from "@/lib/types";
import { CATEGORY_COLORS } from "@/lib/categories";
import TickerTape from "@/components/TickerTape";
import MoverCard from "@/components/MoverCard";
import TrendRow from "@/components/TrendRow";

type SortMode = "rank" | "momentum" | "gainers" | "losers";

const SORT_OPTIONS: [SortMode, string][] = [
  ["rank", "RANK"],
  ["momentum", "MOVERS"],
  ["gainers", "GAINERS"],
  ["losers", "LOSERS"],
];

const ALL_CATEGORIES = [
  "All",
  "Tech",
  "Politics",
  "Sports",
  "Crypto",
  "Culture",
  "Finance",
  "News",
  "Entertainment",
  "Science",
  "Games",
  "Health",
];

function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      className="trend-row-grid items-center px-5 py-3 border-b border-white/[0.025] no-vol"
      style={{ animation: `row-in 0.2s ease ${index * 0.02}s both` }}
    >
      <div className="w-5 h-3 rounded bg-white/[0.04] animate-pulse" />
      <div className="flex items-center gap-2">
        <div className="h-3.5 rounded bg-white/[0.04] animate-pulse" style={{ width: `${80 + Math.random() * 100}px` }} />
        <div className="w-10 h-3 rounded bg-white/[0.03] animate-pulse" />
      </div>
      <div className="flex justify-center sparkline-cell">
        <div className="w-16 h-5 rounded bg-white/[0.03] animate-pulse" />
      </div>
      <div className="flex justify-end">
        <div className="w-12 h-4 rounded bg-white/[0.04] animate-pulse" />
      </div>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="min-h-screen bg-surface text-white">
      <div className="h-8 border-b border-white/5 bg-black/50 overflow-hidden">
        <div className="flex items-center gap-8 px-4 py-2 animate-pulse">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 flex-shrink-0">
              <div className="w-16 h-2.5 rounded bg-white/[0.04]" />
              <div className="w-8 h-2.5 rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center px-5 pt-3.5 pb-2.5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <div className="font-mono text-[22px] font-extrabold tracking-tighter text-white">TRNDEX</div>
          <span className="font-mono text-[9px] font-bold text-up tracking-[0.1em]">LIVE</span>
        </div>
        <div className="text-right">
          <div className="w-20 h-4 rounded bg-white/[0.04] animate-pulse mb-1 ml-auto" />
          <div className="w-32 h-2.5 rounded bg-white/[0.03] animate-pulse ml-auto" />
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pt-4 pb-3.5 border-b border-white/5">
        <div className="h-5 w-full max-w-md mx-auto rounded bg-white/[0.04] animate-pulse" />
        <div className="flex gap-2.5 flex-wrap flex-1 min-w-[280px]">
          <div className="flex-1 min-w-[130px] h-28 rounded-lg bg-white/[0.02] animate-pulse" />
          <div className="flex-1 min-w-[130px] h-28 rounded-lg bg-white/[0.02] animate-pulse" />
          <div className="flex-1 min-w-[140px] h-28 rounded-lg bg-white/[0.02] animate-pulse" />
        </div>
      </div>

      <div className="flex justify-between items-center px-5 py-2 border-b border-white/5">
        <div className="flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-12 h-5 rounded bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>

      <div className="trend-row-grid items-center px-5 py-1.5 border-b border-white/5 font-mono text-[8px] font-semibold tracking-[0.1em] text-white/[0.18] sticky top-0 bg-surface z-10 no-vol">
        <span>#</span>
        <span>TREND</span>
        <span className="text-center sparkline-cell">6S</span>
        <span className="text-right">&Delta;</span>
      </div>

      <div className="pb-5">
        {Array.from({ length: 15 }).map((_, i) => (
          <SkeletonRow key={i} index={i} />
        ))}
      </div>
    </div>
  );
}

function EmptyMoverCard({ type }: { type: "gainer" | "loser" }) {
  const c = type === "gainer" ? "#00E676" : "#FF5252";
  return (
    <div
      className="flex-1 min-w-[130px] rounded-lg p-3 flex flex-col items-center justify-center"
      style={{ background: `${c}04`, border: `1px solid ${c}10` }}
    >
      <div className="font-mono text-[8.5px] font-bold tracking-[0.1em] text-white/25 mb-2">
        {type === "gainer" ? (
          <span>
            <svg className="inline w-2.5 h-2.5 mr-1 -mt-0.5" viewBox="0 0 10 10" fill={c}><path d="M5 1L9 7H1L5 1Z" /></svg>
            TOP GAINER
          </span>
        ) : (
          <span>
            <svg className="inline w-2.5 h-2.5 mr-1 -mt-0.5" viewBox="0 0 10 10" fill={c}><path d="M5 9L1 3H9L5 9Z" /></svg>
            TOP LOSER
          </span>
        )}
      </div>
      <div className="font-mono text-[10px] text-white/10">No movers yet</div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>("rank");
  const [filter, setFilter] = useState("All");
  const [time, setTime] = useState(new Date());
  const lastSnapshot = useRef<string | null>(null);

  const fetchTrends = useCallback(async () => {
    try {
      const res = await fetch("/api/trends?woeid=23424977");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: TrendsResponse = await res.json();

      if (lastSnapshot.current && json.meta.current_snapshot === lastSnapshot.current) {
        return;
      }

      lastSnapshot.current = json.meta.current_snapshot;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrends();
    const interval = setInterval(fetchTrends, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchTrends]);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const filteredTrends = useMemo(() => {
    if (!data) return [];
    let list =
      filter === "All"
        ? [...data.trends]
        : data.trends.filter((t) => t.category === filter);

    switch (sortBy) {
      case "momentum":
        list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        break;
      case "gainers":
        list = list
          .filter((t) => t.direction === "up")
          .sort((a, b) => b.delta - a.delta);
        break;
      case "losers":
        list = list
          .filter((t) => t.direction === "down")
          .sort((a, b) => a.delta - b.delta);
        break;
      default:
        list.sort((a, b) => a.rank - b.rank);
    }

    return list;
  }, [data, sortBy, filter]);

  const topGainer = useMemo(() => {
    if (!data) return null;
    return [...data.trends]
      .filter((t) => t.direction === "up" && !t.is_new)
      .sort((a, b) => b.delta - a.delta)[0] || null;
  }, [data]);

  const topLoser = useMemo(() => {
    if (!data) return null;
    return [...data.trends]
      .filter((t) => t.direction === "down")
      .sort((a, b) => a.delta - b.delta)[0] || null;
  }, [data]);

  const marketStats = useMemo(() => {
    if (!data) return null;
    const trends = data.trends;
    const persisting = trends.filter((t) => !t.is_new);
    const totalDisplacement = persisting.reduce((s, t) => s + Math.abs(t.delta), 0);
    const avgDisplacement = persisting.length > 0 ? totalDisplacement / persisting.length : 0;
    return {
      gainers: trends.filter((t) => t.direction === "up").length,
      losers: trends.filter((t) => t.direction === "down").length,
      newEntries: trends.filter((t) => t.is_new).length,
      avgDisplacement,
    };
  }, [data]);

  if (loading) return <SkeletonLoader />;

  if (error || !data) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="font-mono text-2xl font-extrabold text-white tracking-tighter mb-3">
            TRNDEX
          </div>
          <div className="font-mono text-xs text-down/80 mb-2">
            {error || "No data available"}
          </div>
          <button
            onClick={() => { setLoading(true); fetchTrends(); }}
            className="font-mono text-[10px] text-white/40 border border-white/10 rounded px-3 py-1.5 hover:bg-white/5 transition-colors"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-white">
      <TickerTape trends={data.trends} />

      <div className="flex justify-between items-center px-4 sm:px-5 pt-3.5 pb-2.5 border-b border-white/5 flex-wrap gap-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="font-mono text-[22px] font-extrabold tracking-tighter text-white">
            TRNDEX
          </h1>
          <span className="font-mono text-[9px] font-bold text-up tracking-[0.1em]">
            LIVE
          </span>
        </div>
        <div className="text-right">
          <div className="font-mono text-[15px] font-bold text-white/70">
            {time.toLocaleTimeString("en-US", { hour12: false })}
          </div>
          <div className="font-mono text-[8.5px] text-white/[0.18] tracking-[0.06em]">
            {time
              .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              .toUpperCase()}{" "}
            &middot; US MARKET
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:gap-4 px-4 sm:px-5 pt-4 pb-3.5 border-b border-white/5">
        {marketStats && (
          <div
            className="font-mono text-[13px] sm:text-[15px] font-bold tracking-[0.08em] text-white/90 text-center"
            style={{ color: data.pulse.color }}
          >
            {marketStats.newEntries} NEW TREND{marketStats.newEntries === 1 ? "" : "S"} · AVG MOVEMENT: {marketStats.avgDisplacement.toFixed(1)} POSITIONS · BOARD STATUS: {data.pulse.label}
          </div>
        )}
        <div className="flex gap-2.5 flex-wrap flex-1 min-w-0 sm:min-w-[280px]">
          {topGainer ? (
            <MoverCard
              trendName={topGainer.trend_name}
              delta={topGainer.delta}
              category={topGainer.category}
              type="gainer"
            />
          ) : (
            <EmptyMoverCard type="gainer" />
          )}
          {topLoser ? (
            <MoverCard
              trendName={topLoser.trend_name}
              delta={topLoser.delta}
              category={topLoser.category}
              type="loser"
            />
          ) : (
            <EmptyMoverCard type="loser" />
          )}
          {marketStats && (
            <div className="flex-1 min-w-[140px] p-3 bg-white/[0.015] border border-white/5 rounded-lg">
              <div className="font-mono text-[8.5px] font-bold tracking-[0.1em] text-white/25 mb-1.5">
                MARKET SUMMARY
              </div>
              {[
                { l: "BOARD SIZE", v: 20, c: "rgba(255,255,255,0.75)" },
                { l: "GAINERS", v: marketStats.gainers, c: "#00E676" },
                { l: "LOSERS", v: marketStats.losers, c: "#FF5252" },
                { l: "NEW ENTRIES", v: marketStats.newEntries, c: "#FBBF24" },
              ].map((s) => (
                <div key={s.l} className="flex justify-between items-center mb-0.5">
                  <span className="font-mono text-[8.5px] text-white/20 tracking-[0.06em]">{s.l}</span>
                  <span className="font-mono text-[11.5px] font-bold" style={{ color: s.c }}>{s.v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 sm:px-5 py-2 border-b border-white/5 gap-1.5">
        <div className="flex gap-1">
          {SORT_OPTIONS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className="rounded px-2 py-0.5 font-mono text-[8.5px] font-semibold tracking-[0.08em] transition-all"
              style={{
                background: sortBy === key ? "rgba(255,255,255,0.07)" : "transparent",
                border: sortBy === key ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
                color: sortBy === key ? "#fff" : "rgba(255,255,255,0.25)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap overflow-x-auto max-w-full hide-scrollbar">
          {ALL_CATEGORIES.map((cat) => {
            const cc = CATEGORY_COLORS[cat] || "rgba(255,255,255,0.08)";
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className="rounded px-1.5 py-0.5 font-mono text-[8px] font-semibold tracking-[0.06em] transition-all flex-shrink-0"
                style={{
                  background: filter === cat ? `${cc}15` : "transparent",
                  border: filter === cat ? `1px solid ${cc}35` : "1px solid transparent",
                  color: filter === cat ? cc : "rgba(255,255,255,0.18)",
                }}
              >
                {cat.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>

      <div className="trend-row-grid items-center px-4 sm:px-5 py-1.5 border-b border-white/5 font-mono text-[8px] font-semibold tracking-[0.1em] text-white/[0.18] sticky top-0 bg-surface z-10 no-vol">
        <span>#</span>
        <span>TREND</span>
        <span className="text-center sparkline-cell">6S</span>
        <span className="text-right">&Delta;</span>
      </div>

      <div className="pb-5">
        {filteredTrends.length === 0 ? (
          <div className="p-9 text-center text-white/[0.12] font-mono text-[10px]">
            No trends match
          </div>
        ) : (
          filteredTrends.map((t, i) => (
            <TrendRow key={t.trend_name} trend={t} index={i} />
          ))
        )}
      </div>

      <div className="px-4 sm:px-5 py-2.5 border-t border-white/[0.03] flex justify-between font-mono text-[8px] text-white/10 tracking-[0.06em]">
        <span>TRNDEX.LIVE &middot; REFRESHED EVERY 2H</span>
        <span>
          {data.trends.length} TRACKING &middot;{" "}
          {data.trends.filter((t) => t.direction === "up").length}
          <svg className="inline w-2 h-2 mx-0.5 -mt-px" viewBox="0 0 8 8" fill="#00E676"><path d="M4 1L7 5H1L4 1Z" /></svg>
          {data.trends.filter((t) => t.direction === "down").length}
          <svg className="inline w-2 h-2 mx-0.5 -mt-px" viewBox="0 0 8 8" fill="#FF5252"><path d="M4 7L1 3H7L4 7Z" /></svg>
        </span>
      </div>
    </div>
  );
}
