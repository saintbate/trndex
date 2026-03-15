"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { CATEGORY_COLORS } from "@/lib/categories";
import type { Trend } from "@/lib/types";
import Sparkline from "./Sparkline";

const PREDICT_STORAGE_KEY = "trndex_predictions";

interface StoredPrediction {
  trend: string;
  prediction: "yes" | "no";
  timestamp: string;
}

function getStoredPredictions(): StoredPrediction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PREDICT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredPredictions(preds: StoredPrediction[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREDICT_STORAGE_KEY, JSON.stringify(preds));
  } catch {}
}

interface TrendRowProps {
  trend: Trend;
  index: number;
}

function formatDelta(trend: Trend): string {
  if (trend.is_new) return "NEW";
  if (trend.delta === 0) return "—";
  const sign = trend.delta > 0 ? "+" : "";
  return `${sign}${trend.delta}`;
}

const contextCache = new Map<string, string>();

async function loadTrendContext(trendName: string): Promise<string> {
  const cached = contextCache.get(trendName);
  if (cached) return cached;

  const response = await fetch(`/api/context?trend=${encodeURIComponent(trendName)}`);
  if (!response.ok) {
    throw new Error("Unable to load context");
  }

  const context = (await response.text()).trim();
  contextCache.set(trendName, context);
  return context;
}

export default function TrendRow({ trend, index }: TrendRowProps) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [context, setContext] = useState<string | null>(() => contextCache.get(trend.trend_name) ?? null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [myPrediction, setMyPrediction] = useState<StoredPrediction | null>(() =>
    getStoredPredictions().find((p) => p.trend === trend.trend_name) ?? null
  );
  const [resolveResult, setResolveResult] = useState<{ was_on_board: boolean | null; snapshot_at: string | null } | null>(null);
  const [resolving, setResolving] = useState(false);
  const isUp = trend.direction === "up";
  const c = isUp ? "#00E676" : trend.direction === "down" ? "#FF5252" : "rgba(255,255,255,0.25)";
  const cc = trend.category ? CATEGORY_COLORS[trend.category] : null;

  async function handleToggle() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || context || loadingContext) return;

    setLoadingContext(true);
    setContextError(null);

    try {
      const nextContext = await loadTrendContext(trend.trend_name);
      setContext(nextContext);
    } catch {
      setContextError("Context unavailable right now.");
    } finally {
      setLoadingContext(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void handleToggle();
    }
  }

  function handlePredict(choice: "yes" | "no") {
    const pred: StoredPrediction = { trend: trend.trend_name, prediction: choice, timestamp: new Date().toISOString() };
    const preds = getStoredPredictions().filter((p) => p.trend !== trend.trend_name);
    preds.push(pred);
    setStoredPredictions(preds);
    setMyPrediction(pred);
  }

  useEffect(() => {
    if (!myPrediction || resolveResult) return;
    const predTime = new Date(myPrediction.timestamp).getTime();
    const fourHoursLater = predTime + 4 * 60 * 60 * 1000;
    if (Date.now() < fourHoursLater) return;

    setResolving(true);
    fetch(
      `/api/predict/resolve?trend=${encodeURIComponent(myPrediction.trend)}&predicted_at=${encodeURIComponent(myPrediction.timestamp)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.resolved) {
          setResolveResult({ was_on_board: data.was_on_board ?? null, snapshot_at: data.snapshot_at ?? null });
          const preds = getStoredPredictions().filter((p) => !(p.trend === myPrediction.trend && p.timestamp === myPrediction.timestamp));
          setStoredPredictions(preds);
        }
      })
      .finally(() => setResolving(false));
  }, [myPrediction, resolveResult]);

  return (
    <div
      className="border-b border-white/[0.025]"
      style={{ animation: `row-in 0.2s ease ${index * 0.02}s both` }}
    >
      <div
        onClick={() => void handleToggle()}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        className="grid items-center px-4 sm:px-5 py-2.5 transition-colors cursor-pointer trend-row-grid no-vol"
        style={{
          background: hovered || expanded ? "rgba(255,255,255,0.02)" : "transparent",
        }}
      >
        <span className="font-mono text-[10px] text-white/[0.15] font-medium">
          {String(trend.rank).padStart(2, "0")}
        </span>

        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          <span className="font-grotesk text-[13px] font-semibold text-white tracking-tight whitespace-nowrap overflow-hidden text-ellipsis">
            {trend.trend_name}
          </span>
          {trend.category && cc && (
            <span
              className="font-mono text-[7.5px] font-bold uppercase tracking-[0.06em] rounded px-1 py-px flex-shrink-0"
              style={{
                color: cc,
                background: `${cc}10`,
                border: `1px solid ${cc}20`,
              }}
            >
              {trend.category}
            </span>
          )}
          {trend.is_new && (
            <span className="font-mono text-[7px] font-extrabold tracking-[0.1em] rounded px-1 py-px flex-shrink-0 text-[#FBBF24] bg-[#FBBF24]/[0.06] border border-[#FBBF24]/[0.12]">
              NEW
            </span>
          )}
          {(trend.breakout_score ?? 0) >= 30 && !trend.is_new && (
            <span className="font-mono text-[7px] font-extrabold tracking-[0.08em] rounded px-1 py-px flex-shrink-0 text-[#FBBF24] bg-[#FBBF24]/[0.08] border border-[#FBBF24]/[0.2]">
              BREAKOUT
            </span>
          )}
        </div>

        <div className="flex justify-center sparkline-cell">
          <Sparkline data={trend.sparkline} color={c} />
        </div>

        <div className="text-right">
          <div className="flex flex-col items-end gap-1">
            <span
              className="font-mono text-[12.5px] font-bold rounded px-1.5 py-0.5"
              style={{
                color: trend.is_new ? "#FBBF24" : c,
                background: `${trend.is_new ? "#FBBF24" : c}0D`,
              }}
            >
              {formatDelta(trend)}
              {!trend.is_new && trend.delta !== 0 && (
                <span className="ml-0.5">
                  {trend.direction === "up" ? "▲" : "▼"}
                </span>
              )}
            </span>
            <span className="font-mono text-[8px] tracking-[0.08em] text-white/20">
              {expanded ? "HIDE DETAILS" : "VIEW DETAILS"}
            </span>
          </div>
        </div>
      </div>

      <div
        className="overflow-hidden transition-[max-height,opacity] duration-150 ease-in-out"
        style={{ maxHeight: expanded ? 220 : 0, opacity: expanded ? 1 : 0 }}
      >
        <div className="grid trend-row-grid no-vol px-4 sm:px-5 pb-3">
          <div />
          <div className="col-span-3 border-t border-white/[0.04] pt-2.5 space-y-2.5">
            {loadingContext ? (
              <div className="h-3 w-[72%] rounded bg-white/[0.05] animate-pulse" />
            ) : (
              <div className="font-mono text-[11px] leading-[1.55] text-white/[0.45] pr-2">
                {contextError || context || "Context is still being generated for this trend."}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/research?trend=${encodeURIComponent(trend.trend_name)}`}
                className="font-mono text-[9px] rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-white/55 hover:text-white/85 hover:border-white/20 transition-colors"
              >
                OPEN IN RESEARCH
              </Link>
            </div>
            <div className="font-mono text-[9px] text-white/25 space-y-1">
              <div>Predict: Will this stay on the board in 4 hours?</div>
              {!myPrediction ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePredict("yes")}
                    className="rounded border border-[#00E676]/20 bg-[#00E676]/[0.08] px-2 py-1 text-[#00E676] hover:bg-[#00E676]/[0.12]"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => handlePredict("no")}
                    className="rounded border border-[#FF5252]/20 bg-[#FF5252]/[0.08] px-2 py-1 text-[#FF5252] hover:bg-[#FF5252]/[0.12]"
                  >
                    No
                  </button>
                </div>
              ) : resolveResult ? (
                <div className="text-white/50">
                  {resolveResult.was_on_board === null ? (
                    "Waiting for a usable post-target snapshot."
                  ) : (
                    <>
                      You said {myPrediction.prediction.toUpperCase()} — {resolveResult.was_on_board ? "Still on board" : "Dropped off"}.{" "}
                      {(myPrediction.prediction === "yes" && resolveResult.was_on_board) ||
                      (myPrediction.prediction === "no" && !resolveResult.was_on_board)
                        ? "Correct!"
                        : "Wrong."}
                    </>
                  )}
                </div>
              ) : resolving ? (
                <div className="text-white/30">Checking...</div>
              ) : (
                <div className="text-white/30">You said {myPrediction.prediction.toUpperCase()}. We will resolve this once a usable post-target US snapshot lands.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
