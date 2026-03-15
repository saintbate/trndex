import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const WINDOW_HOURS = 24 * 30; // 30 days
const PRIOR_WINDOW_HOURS = 24 * 60; // 60 days for prior month

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const limit = Math.max(5, Math.min(50, parseInt(searchParams.get("limit") || "25", 10)));

  const now = Date.now();
  const cutoff = new Date(now - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const priorCutoff = new Date(now - PRIOR_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const sql = getDb();

  try {
    const [runs, featureRows, priorFeatureRows, marketRows] = await Promise.all([
      sql`
        SELECT run_id, fetched_at
        FROM snapshot_runs
        WHERE woeid = ${woeid}
          AND source_status IN ('success', 'backfilled')
          AND fetched_at >= ${cutoff}
        ORDER BY fetched_at ASC
      `,
      sql`
        SELECT entity_id, trend_name_raw, canonical_name, category, rank, prev_rank,
               rank_delta, persistence_score, breakout_score, entry_flag, exit_flag,
               board_age_snapshots, fetched_at
        FROM trend_features
        WHERE woeid = ${woeid}
          AND fetched_at >= ${cutoff}
        ORDER BY fetched_at ASC
      `,
      sql`
        SELECT entity_id, category
        FROM trend_features
        WHERE woeid = ${woeid}
          AND fetched_at >= ${priorCutoff}
          AND fetched_at < ${cutoff}
      `,
      sql`
        SELECT turnover_ratio, new_entry_count, exit_count, board_size,
               avg_rank_displacement, market_regime_label, fetched_at
        FROM market_features
        WHERE woeid = ${woeid}
          AND fetched_at >= ${cutoff}
        ORDER BY fetched_at ASC
      `,
    ]);

    const byEntity = new Map<
      number,
      {
        trend_name_raw: string;
        canonical_name: string;
        category: string | null;
        ranks: number[];
        persistence_scores: number[];
        breakout_scores: number[];
        entry_count: number;
        exit_count: number;
        board_age_sum: number;
      }
    >();

    for (const row of featureRows as Record<string, unknown>[]) {
      const eid = row.entity_id as number;
      if (!byEntity.has(eid)) {
        byEntity.set(eid, {
          trend_name_raw: row.trend_name_raw as string,
          canonical_name: row.canonical_name as string,
          category: (row.category as string) ?? null,
          ranks: [],
          persistence_scores: [],
          breakout_scores: [],
          entry_count: 0,
          exit_count: 0,
          board_age_sum: 0,
        });
      }
      const e = byEntity.get(eid)!;
      e.ranks.push(row.rank as number);
      e.persistence_scores.push((row.persistence_score as number) ?? 0);
      e.breakout_scores.push((row.breakout_score as number) ?? 0);
      if (row.entry_flag) e.entry_count++;
      if (row.exit_flag) e.exit_count++;
      e.board_age_sum += (row.board_age_snapshots as number) ?? 1;
    }

    const topTrends = Array.from(byEntity.entries())
      .map(([entityId, e]) => ({
        entity_id: entityId,
        trend_name: e.trend_name_raw,
        canonical_name: e.canonical_name,
        category: e.category,
        appearances: e.ranks.length,
        avg_rank: e.ranks.reduce((a, b) => a + b, 0) / e.ranks.length,
        best_rank: Math.min(...e.ranks),
        avg_persistence: e.persistence_scores.reduce((a, b) => a + b, 0) / (e.persistence_scores.length || 1),
        max_breakout: Math.max(...e.breakout_scores, 0),
        entries: e.entry_count,
        exits: e.exit_count,
        avg_board_age: e.board_age_sum / (e.ranks.length || 1),
      }))
      .sort((a, b) => a.avg_rank - b.avg_rank)
      .slice(0, limit);

    const categoryBreakdown: Record<string, number> = {};
    for (const e of Array.from(byEntity.values())) {
      const cat = e.category || "Untagged";
      categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + 1;
    }

    const priorByEntity = new Map<number, string>();
    for (const row of priorFeatureRows as Record<string, unknown>[]) {
      const eid = row.entity_id as number;
      if (!priorByEntity.has(eid)) {
        priorByEntity.set(eid, (row.category as string) ?? "Untagged");
      }
    }
    const priorCategoryBreakdown: Record<string, number> = {};
    for (const cat of Array.from(priorByEntity.values())) {
      const c = cat || "Untagged";
      priorCategoryBreakdown[c] = (priorCategoryBreakdown[c] ?? 0) + 1;
    }

    const totalEntities = Array.from(byEntity.values()).length;
    const priorTotalEntities = priorByEntity.size;
    const categoryShare: Record<string, { count: number; share_pct: number; momentum_pp: number }> = {};
    const allCats = new Set([...Object.keys(categoryBreakdown), ...Object.keys(priorCategoryBreakdown)]);
    for (const cat of Array.from(allCats)) {
      const count = categoryBreakdown[cat] ?? 0;
      const priorCount = priorCategoryBreakdown[cat] ?? 0;
      const share = totalEntities > 0 ? (count / totalEntities) * 100 : 0;
      const priorShare = priorTotalEntities > 0 ? (priorCount / priorTotalEntities) * 100 : 0;
      categoryShare[cat] = {
        count,
        share_pct: Math.round(share * 10) / 10,
        momentum_pp: Math.round((share - priorShare) * 10) / 10,
      };
    }

    const totalNewEntries = (marketRows as Record<string, unknown>[]).reduce(
      (s, r) => s + ((r.new_entry_count as number) ?? 0),
      0
    );
    const totalExits = (marketRows as Record<string, unknown>[]).reduce(
      (s, r) => s + ((r.exit_count as number) ?? 0),
      0
    );
    const avgTurnover =
      marketRows.length > 0
        ? (marketRows as Record<string, unknown>[]).reduce(
            (s, r) => s + ((r.turnover_ratio as number) ?? 0),
            0
          ) / marketRows.length
        : 0;
    const avgDisplacement =
      marketRows.length > 0
        ? (marketRows as Record<string, unknown>[]).reduce(
            (s, r) => s + ((r.avg_rank_displacement as number) ?? 0),
            0
          ) / marketRows.length
        : 0;
    const lastRegime =
      marketRows.length > 0
        ? (marketRows[marketRows.length - 1] as Record<string, unknown>).market_regime_label
        : null;

    const narrativeArcs = Array.from(byEntity.entries())
      .filter(([, e]) => e.exit_count > 0)
      .map(([entityId, e]) => ({
        entity_id: entityId,
        trend_name: e.trend_name_raw,
        category: e.category,
        best_rank: Math.min(...e.ranks),
        appearances: e.ranks.length,
      }))
      .sort((a, b) => a.best_rank - b.best_rank)
      .slice(0, 15);

    return NextResponse.json({
      meta: {
        period: "30d",
        window_hours: WINDOW_HOURS,
        woeid,
        runs_in_window: runs.length,
        from: cutoff,
      },
      board_stats: {
        total_new_entries: totalNewEntries,
        total_exits: totalExits,
        avg_turnover_ratio: Math.round(avgTurnover * 100) / 100,
        avg_rank_displacement: Math.round(avgDisplacement * 100) / 100,
        last_regime: lastRegime,
      },
      category_breakdown: categoryBreakdown,
      category_share: categoryShare,
      top_trends: topTrends,
      narrative_arcs: narrativeArcs,
    });
  } catch (error) {
    console.error("Error fetching monthly analysis:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
