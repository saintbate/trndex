import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyTrend } from "@/lib/categories";
import type { TrendsResponse, Trend, Pulse } from "@/lib/types";

function getPulseLabel(score: number): { label: Pulse["label"]; color: string } {
  if (score >= 80) return { label: "CHAOTIC", color: "#FF5252" };
  if (score >= 60) return { label: "VOLATILE", color: "#FF9100" };
  if (score >= 40) return { label: "ACTIVE", color: "#FFD600" };
  if (score >= 20) return { label: "CALM", color: "#69F0AE" };
  return { label: "STABLE", color: "#00E676" };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);

  try {
    const sql = getDb();

    // 1. Get current snapshot trends (rank = array index + 1)
    const currentTrends = await sql`
      SELECT trend_name, rank, location_name
      FROM snapshots
      WHERE woeid = ${woeid}
        AND fetched_at = (
          SELECT DISTINCT fetched_at FROM snapshots
          WHERE woeid = ${woeid}
          ORDER BY fetched_at DESC
          LIMIT 1
        )
      ORDER BY rank ASC
    `;

    if (currentTrends.length === 0) {
      return NextResponse.json(
        { error: "No data available yet" },
        { status: 404 }
      );
    }

    const locationName = currentTrends[0].location_name;

    // 2. Get snapshot times
    const snapshotTimes = await sql`
      SELECT DISTINCT fetched_at
      FROM snapshots
      WHERE woeid = ${woeid}
      ORDER BY fetched_at DESC
      LIMIT 2
    `;

    const currentTime = snapshotTimes[0].fetched_at;
    const previousTime = snapshotTimes.length > 1 ? snapshotTimes[1].fetched_at : null;

    // 3. Previous snapshot: trend_name -> rank
    // Query the previous timestamp entirely in SQL so we do not lose
    // sub-millisecond precision when round-tripping through JS dates.
    const prevRankMap = new Map<string, number>();
    if (previousTime) {
      const prevTrends = await sql`
        SELECT trend_name, rank
        FROM snapshots
        WHERE woeid = ${woeid}
          AND fetched_at = (
            SELECT fetched_at FROM (
              SELECT DISTINCT fetched_at
              FROM snapshots
              WHERE woeid = ${woeid}
              ORDER BY fetched_at DESC
              LIMIT 1 OFFSET 1
            ) t
          )
      `;
      for (const row of prevTrends) {
        prevRankMap.set(row.trend_name, row.rank);
      }
    }

    // 4. Last 6 snapshots for sparklines (oldest to newest)
    const rankHistory = await sql`
      SELECT trend_name, fetched_at, rank
      FROM snapshots
      WHERE woeid = ${woeid}
        AND fetched_at IN (
          SELECT fetched_at FROM (
            SELECT DISTINCT fetched_at
            FROM snapshots
            WHERE woeid = ${woeid}
            ORDER BY fetched_at DESC
            LIMIT 6
          ) t
        )
      ORDER BY fetched_at ASC
    `;

    const sixSnapshotTimes = await sql`
      SELECT fetched_at FROM (
        SELECT DISTINCT fetched_at
        FROM snapshots
        WHERE woeid = ${woeid}
        ORDER BY fetched_at DESC
        LIMIT 6
      ) t
      ORDER BY fetched_at ASC
    `;

    const sparklineMap = new Map<string, (number | null)[]>();
    if (sixSnapshotTimes.length > 0) {
      const times = sixSnapshotTimes.map((r) => r.fetched_at);
      const byTrend = new Map<string, Map<string, number>>();
      for (const row of rankHistory) {
        if (!byTrend.has(row.trend_name)) {
          byTrend.set(row.trend_name, new Map());
        }
        byTrend.get(row.trend_name)!.set(String(row.fetched_at), row.rank);
      }

      for (const trend of currentTrends) {
        const arr: (number | null)[] = [];
        for (const t of times) {
          const m = byTrend.get(trend.trend_name);
          arr.push(m ? (m.get(String(t)) ?? null) : null);
        }
        sparklineMap.set(trend.trend_name, arr);
      }
    }

    // 5. Build trend objects with rank-based momentum
    const trends: Trend[] = currentTrends.map((row) => {
      const prevRank = prevRankMap.get(row.trend_name) ?? null;
      const isNew = previousTime ? prevRank === null : false;
      const delta = prevRank !== null ? prevRank - row.rank : 0;

      let direction: "up" | "down" | "flat" = "flat";
      if (delta > 0) direction = "up";
      else if (delta < 0) direction = "down";

      const sparkline = sparklineMap.get(row.trend_name) ?? [row.rank];
      const category = classifyTrend(row.trend_name);

      return {
        trend_name: row.trend_name,
        rank: row.rank,
        prev_rank: prevRank,
        delta,
        direction,
        is_new: isNew,
        sparkline,
        category,
      };
    });

    // 6. Pulse: churn formula
    const newCount = previousTime
      ? trends.filter((t) => t.is_new).length
      : 0;
    const persisting = trends.filter((t) => !t.is_new);
    const totalDisplacement = persisting.reduce(
      (sum, t) => sum + Math.abs(t.delta),
      0
    );
    const persistingCount = persisting.length;
    const churnRatio = newCount / 20;
    const avgDisplacement =
      persistingCount > 0 ? totalDisplacement / persistingCount : 0;
    const displacementComponent = (Math.min(avgDisplacement, 10) / 10) * 40;
    const rawScore = churnRatio * 60 + displacementComponent;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const { label, color } = getPulseLabel(score);

    const pulse: Pulse = { score, label, color };

    const response: TrendsResponse = {
      meta: {
        current_snapshot: currentTime,
        previous_snapshot: previousTime,
        location_woeid: woeid,
        location_name: locationName,
      },
      pulse,
      trends,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Error fetching trends:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
