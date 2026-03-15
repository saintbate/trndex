"use client";

import { CATEGORY_COLORS } from "@/lib/categories";
import type { TrendCategory } from "@/lib/categories";

interface MoverCardProps {
  trendName: string;
  delta: number;
  category: TrendCategory | null;
  type: "gainer" | "loser";
}

export default function MoverCard({
  trendName,
  delta,
  category,
  type,
}: MoverCardProps) {
  const isGainer = type === "gainer";
  const c = isGainer ? "#00E676" : "#FF5252";
  const cc = category ? CATEGORY_COLORS[category] : null;

  return (
    <div
      className="rounded-lg p-3 h-full min-h-[108px] min-w-0"
      style={{
        background: `${c}06`,
        border: `1px solid ${c}15`,
      }}
    >
      <div className="font-mono text-[8.5px] font-bold tracking-[0.1em] text-white/25 mb-1.5">
        {isGainer ? (
          <span>
            <svg
              className="inline w-2.5 h-2.5 mr-1 -mt-0.5"
              viewBox="0 0 10 10"
              fill={c}
            >
              <path d="M5 1L9 7H1L5 1Z" />
            </svg>
            TOP GAINER
          </span>
        ) : (
          <span>
            <svg
              className="inline w-2.5 h-2.5 mr-1 -mt-0.5"
              viewBox="0 0 10 10"
              fill={c}
            >
              <path d="M5 9L1 3H9L5 9Z" />
            </svg>
            TOP LOSER
          </span>
        )}
      </div>
      <div className="font-grotesk text-[14px] sm:text-[15px] font-bold text-white mb-1 tracking-tight leading-5 break-words">
        {trendName}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="font-mono text-[17px] sm:text-[19px] font-extrabold"
          style={{ color: c }}
        >
          {isGainer ? "+" : ""}
          {delta}
        </span>
        <span
          className="font-mono text-[9px] text-white/40"
          style={{ letterSpacing: "0.05em" }}
        >
          {isGainer ? "▲" : "▼"}
        </span>
        {category && cc && (
          <span
            className="font-mono text-[7.5px] font-bold uppercase tracking-[0.08em] rounded px-1 py-px"
            style={{
              color: cc,
              background: `${cc}12`,
              border: `1px solid ${cc}25`,
            }}
          >
            {category}
          </span>
        )}
      </div>
    </div>
  );
}
