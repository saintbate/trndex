"use client";

import type { Trend } from "@/lib/types";

interface TickerTapeProps {
  trends: Trend[];
}

function formatDelta(trend: Trend): string {
  if (trend.is_new) return "NEW";
  if (trend.delta === 0) return "—";
  const sign = trend.delta > 0 ? "+" : "";
  return `${sign}${trend.delta}`;
}

export default function TickerTape({ trends }: TickerTapeProps) {
  const items = [...trends, ...trends, ...trends];

  return (
    <div className="overflow-hidden whitespace-nowrap py-1 sm:py-1.5 border-b border-white/5 bg-black/50">
      <div className="inline-block animate-ticker-scroll">
        {items.map((t, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 mr-4 sm:mr-6 font-mono text-[9px] sm:text-[10px]"
          >
            <span className="text-white/40 font-medium inline-block max-w-[110px] sm:max-w-[150px] truncate align-bottom">
              {t.trend_name}
            </span>
            <span
              className="font-bold"
              style={{ color: t.direction === "up" ? "#00E676" : t.direction === "down" ? "#FF5252" : "rgba(255,255,255,0.3)" }}
            >
              {t.direction === "up" ? (
                <svg
                  className="inline w-2 h-2 mr-0.5 -mt-px"
                  viewBox="0 0 8 8"
                  fill="currentColor"
                >
                  <path d="M4 1L7 5H1L4 1Z" />
                </svg>
              ) : t.direction === "down" ? (
                <svg
                  className="inline w-2 h-2 mr-0.5 -mt-px"
                  viewBox="0 0 8 8"
                  fill="currentColor"
                >
                  <path d="M4 7L1 3H7L4 7Z" />
                </svg>
              ) : null}
              {formatDelta(t)}
              {!t.is_new && t.delta !== 0 && (t.direction === "up" ? " ▲" : " ▼")}
            </span>
            <span className="text-white/[0.08]">|</span>
          </span>
        ))}
      </div>
    </div>
  );
}
