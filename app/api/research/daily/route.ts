import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const days = Math.max(1, Math.min(90, parseInt(searchParams.get("days") || "7", 10)));

  if (woeid !== 23424977) {
    return NextResponse.json(
      { error: "Daily recap is currently available for US trends only." },
      { status: 400 }
    );
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const sql = getDb();

  try {
    const [trendRows, categoryRows, boardRows] = await Promise.all([
      sql`
        SELECT bucket_date, entity_id, trend_name_raw, canonical_name, category,
               appearances, avg_rank, best_rank
        FROM daily_trend_rollup
        WHERE woeid = ${woeid}
          AND bucket_date >= ${cutoffStr}
        ORDER BY bucket_date DESC, avg_rank ASC
      `,
      sql`
        SELECT bucket_date, category, trend_count, share_pct
        FROM daily_category_rollup
        WHERE woeid = ${woeid}
          AND bucket_date >= ${cutoffStr}
        ORDER BY bucket_date DESC, share_pct DESC
      `,
      sql`
        SELECT bucket_date, location_name, snapshot_count, distinct_trends,
               new_entries, exits, avg_turnover
        FROM daily_board_summary
        WHERE woeid = ${woeid}
          AND bucket_date >= ${cutoffStr}
        ORDER BY bucket_date DESC
      `,
    ]);

    const byDate = new Map<
      string,
      {
        trends: Record<string, unknown>[];
        categories: Record<string, unknown>[];
        board: Record<string, unknown> | null;
      }
    >();

    for (const row of trendRows as Record<string, unknown>[]) {
      const d = String((row.bucket_date as string).slice(0, 10));
      if (!byDate.has(d)) byDate.set(d, { trends: [], categories: [], board: null });
      byDate.get(d)!.trends.push(row);
    }
    for (const row of categoryRows as Record<string, unknown>[]) {
      const d = String((row.bucket_date as string).slice(0, 10));
      if (!byDate.has(d)) byDate.set(d, { trends: [], categories: [], board: null });
      byDate.get(d)!.categories.push(row);
    }
    for (const row of boardRows as Record<string, unknown>[]) {
      const d = String((row.bucket_date as string).slice(0, 10));
      if (!byDate.has(d)) byDate.set(d, { trends: [], categories: [], board: null });
      byDate.get(d)!.board = row;
    }

    const days_data = Array.from(byDate.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({ date, ...data }));

    return NextResponse.json({
      meta: { woeid, days, from: cutoffStr, scope: "US" },
      days: days_data,
    });
  } catch (error) {
    console.error("Error fetching daily rollup:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
