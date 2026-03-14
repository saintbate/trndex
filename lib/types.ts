import type { TrendCategory } from "@/lib/categories";

export interface TrendsMeta {
  current_snapshot: string;
  previous_snapshot: string | null;
  location_woeid: number;
  location_name: string;
}

export interface Pulse {
  score: number;
  label: "STABLE" | "CALM" | "ACTIVE" | "VOLATILE" | "CHAOTIC";
  color: string;
}

export interface Trend {
  trend_name: string;
  rank: number;
  prev_rank: number | null;
  delta: number;
  direction: "up" | "down" | "flat";
  is_new: boolean;
  sparkline: (number | null)[];
  category: TrendCategory | null;
  breakout_score?: number | null;
}

export interface TrendsResponse {
  meta: TrendsMeta;
  pulse: Pulse;
  trends: Trend[];
}
