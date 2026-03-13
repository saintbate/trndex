"use client";

import { useState } from "react";
import { CATEGORY_COLORS } from "@/lib/categories";
import type { Trend } from "@/lib/types";
import Sparkline from "./Sparkline";

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

export default function TrendRow({ trend, index }: TrendRowProps) {
  const [hovered, setHovered] = useState(false);
  const isUp = trend.direction === "up";
  const c = isUp ? "#00E676" : trend.direction === "down" ? "#FF5252" : "rgba(255,255,255,0.25)";
  const cc = trend.category ? CATEGORY_COLORS[trend.category] : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="grid items-center px-4 sm:px-5 py-2.5 border-b border-white/[0.025] transition-colors cursor-default trend-row-grid no-vol"
      style={{
        background: hovered ? "rgba(255,255,255,0.02)" : "transparent",
        animation: `row-in 0.2s ease ${index * 0.02}s both`,
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
      </div>

      <div className="flex justify-center sparkline-cell">
        <Sparkline data={trend.sparkline} color={c} />
      </div>

      <div className="text-right">
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
      </div>
    </div>
  );
}
