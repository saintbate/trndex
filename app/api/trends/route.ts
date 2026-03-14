import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyTrend } from "@/lib/categories";
import { computeMarketRegimeScore, getPulseMeta } from "@/lib/intelligence";
import type { TrendsResponse, Trend, Pulse } from "@/lib/types";

async function getLegacyTrendsResponse(sql: ReturnType<typeof getDb>, woeid: number): Promise<TrendsResponse | null> {
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

  if (currentTrends.length === 0) return null;

  const locationName = currentTrends[0].location_name;
  const snapshotTimes = await sql`
    SELECT DISTINCT fetched_at
    FROM snapshots
    WHERE woeid = ${woeid}
    ORDER BY fetched_at DESC
    LIMIT 2
  `;

  const currentTime = snapshotTimes[0].fetched_at;
  const previousTime = snapshotTimes.length > 1 ? snapshotTimes[1].fetched_at : null;
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
  const times = sixSnapshotTimes.map((row) => String(row.fetched_at));
  const byTrend = new Map<string, Map<string, number>>();

  for (const row of rankHistory) {
    if (!byTrend.has(row.trend_name)) {
      byTrend.set(row.trend_name, new Map());
    }
    byTrend.get(row.trend_name)!.set(String(row.fetched_at), row.rank);
  }

  for (const trend of currentTrends) {
    const arr = times.map((time) => byTrend.get(trend.trend_name)?.get(time) ?? null);
    sparklineMap.set(trend.trend_name, arr);
  }

  const trends: Trend[] = currentTrends.map((row) => {
    const prevRank = prevRankMap.get(row.trend_name) ?? null;
    const delta = prevRank !== null ? prevRank - row.rank : 0;

    return {
      trend_name: row.trend_name,
      rank: row.rank,
      prev_rank: prevRank,
      delta,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      is_new: previousTime ? prevRank === null : false,
      sparkline: sparklineMap.get(row.trend_name) ?? [row.rank],
      category: classifyTrend(row.trend_name),
    };
  });

  const newCount = previousTime ? trends.filter((trend) => trend.is_new).length : 0;
  const persisting = trends.filter((trend) => !trend.is_new);
  const totalDisplacement = persisting.reduce((sum, trend) => sum + Math.abs(trend.delta), 0);
  const avgDisplacement = persisting.length > 0 ? totalDisplacement / persisting.length : 0;
  const score = computeMarketRegimeScore(newCount / 20, avgDisplacement);
  const { label, color } = getPulseMeta(score);

  return {
    meta: {
      current_snapshot: currentTime,
      previous_snapshot: previousTime,
      location_woeid: woeid,
      location_name: locationName,
    },
    pulse: { score, label, color },
    trends,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);

  try {
    const sql = getDb();
    const latestRuns = await sql`
      SELECT run_id, fetched_at, location_name
      FROM snapshot_runs
      WHERE woeid = ${woeid}
        AND source_status IN ('success', 'backfilled')
        AND feature_status = 'ready'
      ORDER BY fetched_at DESC
      LIMIT 6
    `;

    if (latestRuns.length === 0) {
      const legacy = await getLegacyTrendsResponse(sql, woeid);
      if (!legacy) {
        return NextResponse.json(
          { error: "No data available yet" },
          { status: 404 }
        );
      }

      return NextResponse.json(legacy, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
    }

    const latestRun = latestRuns[0];
    const previousRun = latestRuns[1] ?? null;
    const currentTrends = await sql`
      SELECT entity_id, trend_name_raw, rank, prev_rank, rank_delta, entry_flag, category
      FROM trend_features
      WHERE run_id = ${latestRun.run_id}
      ORDER BY rank ASC
    `;

    if (currentTrends.length === 0) {
      const legacy = await getLegacyTrendsResponse(sql, woeid);
      if (!legacy) {
        return NextResponse.json(
          { error: "No data available yet" },
          { status: 404 }
        );
      }

      return NextResponse.json(legacy, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      });
    }

    const marketRows = await sql`
      SELECT turnover_ratio, avg_rank_displacement, market_regime_label
      FROM market_features
      WHERE run_id = ${latestRun.run_id}
      LIMIT 1
    `;

    const rankHistory = await sql`
      SELECT entity_id, fetched_at, rank
      FROM trend_features
      WHERE woeid = ${woeid}
        AND fetched_at IN (
          SELECT fetched_at FROM (
            SELECT fetched_at
            FROM snapshot_runs
            WHERE woeid = ${woeid}
              AND source_status IN ('success', 'backfilled')
              AND feature_status = 'ready'
            ORDER BY fetched_at DESC
            LIMIT 6
          ) t
        )
      ORDER BY fetched_at ASC
    `;

    const sparklineMap = new Map<string, (number | null)[]>();
    const timeKeys = [...latestRuns].reverse().map((row) => String(row.fetched_at));
    const byEntity = new Map<number, Map<string, number>>();

    for (const row of rankHistory) {
      if (!byEntity.has(row.entity_id)) {
        byEntity.set(row.entity_id, new Map());
      }
      byEntity.get(row.entity_id)!.set(String(row.fetched_at), row.rank);
    }

    for (const trend of currentTrends) {
      sparklineMap.set(
        trend.trend_name_raw,
        timeKeys.map((timeKey) => byEntity.get(trend.entity_id)?.get(timeKey) ?? null)
      );
    }

    const trends: Trend[] = currentTrends.map((row) => {
      const delta = row.rank_delta;

      return {
        trend_name: row.trend_name_raw,
        rank: row.rank,
        prev_rank: row.prev_rank,
        delta,
        direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
        is_new: row.entry_flag,
        sparkline: sparklineMap.get(row.trend_name_raw) ?? [row.rank],
        category: row.category || classifyTrend(row.trend_name_raw),
      };
    });

    const market = marketRows[0];
    const score = market
      ? computeMarketRegimeScore(market.turnover_ratio, market.avg_rank_displacement)
      : 0;
    const { color } = getPulseMeta(score);

    const pulse: Pulse = {
      score,
      label: (market?.market_regime_label ?? getPulseMeta(score).label) as Pulse["label"],
      color,
    };

    const response: TrendsResponse = {
      meta: {
        current_snapshot: latestRun.fetched_at,
        previous_snapshot: previousRun?.fetched_at ?? null,
        location_woeid: woeid,
        location_name: latestRun.location_name,
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
