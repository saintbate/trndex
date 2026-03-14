import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const asOf = searchParams.get("as_of");
  const sql = getDb();

  try {
    const runs = asOf
      ? await sql`
          SELECT run_id, fetched_at, location_name
          FROM snapshot_runs
          WHERE woeid = ${woeid}
            AND source_status IN ('success', 'backfilled')
            AND feature_status = 'ready'
            AND fetched_at <= ${asOf}
          ORDER BY fetched_at DESC
          LIMIT 1
        `
      : await sql`
          SELECT run_id, fetched_at, location_name
          FROM snapshot_runs
          WHERE woeid = ${woeid}
            AND source_status IN ('success', 'backfilled')
            AND feature_status = 'ready'
          ORDER BY fetched_at DESC
          LIMIT 1
        `;

    if (runs.length === 0) {
      return NextResponse.json({ error: "No research snapshot available" }, { status: 404 });
    }

    const run = runs[0];
    const marketRows = await sql`
      SELECT *
      FROM market_features
      WHERE run_id = ${run.run_id}
      LIMIT 1
    `;
    const trendRows = await sql`
      SELECT tf.*, tls.appearances, tls.current_streak, tls.longest_streak, tls.best_rank
      FROM trend_features tf
      LEFT JOIN trend_lifecycle_summary tls
        ON tls.entity_id = tf.entity_id AND tls.woeid = tf.woeid
      WHERE tf.run_id = ${run.run_id}
      ORDER BY tf.rank ASC
    `;

    return NextResponse.json({
      meta: {
        run_id: run.run_id,
        fetched_at: run.fetched_at,
        location_woeid: woeid,
        location_name: run.location_name,
        methodology_version: marketRows[0]?.methodology_version ?? "rank-v1",
      },
      market: marketRows[0] ?? null,
      trends: trendRows,
    });
  } catch (error) {
    console.error("Error fetching research snapshot:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
