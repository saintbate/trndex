import type { Pulse } from "@/lib/types";

export function getPulseMeta(score: number): { label: Pulse["label"]; color: string } {
  if (score >= 80) return { label: "CHAOTIC", color: "#FF5252" };
  if (score >= 60) return { label: "VOLATILE", color: "#FF9100" };
  if (score >= 40) return { label: "ACTIVE", color: "#FFD600" };
  if (score >= 20) return { label: "CALM", color: "#69F0AE" };
  return { label: "STABLE", color: "#00E676" };
}

export function computeMarketRegimeScore(turnoverRatio: number, avgRankDisplacement: number): number {
  const rawScore = turnoverRatio * 60 + (Math.min(avgRankDisplacement, 10) / 10) * 40;
  return Math.max(0, Math.min(100, Math.round(rawScore)));
}

export function normalizeTrendName(trendName: string): string {
  return trendName.trim().replace(/^#/, "").replace(/\s+/g, " ").toLowerCase();
}

export function parseWindowHours(windowParam: string | null, defaultHours: number): number {
  if (!windowParam) return defaultHours;

  const match = windowParam.trim().match(/^(\d+)([hd])$/i);
  if (!match) return defaultHours;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return unit === "d" ? value * 24 : value;
}
