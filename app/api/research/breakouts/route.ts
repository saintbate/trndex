import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseWindowHours } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const windowHours = parseWindowHours(searchParams.get("window"), 24 * 7);
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "20", 10)));
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const sql = getDb();

  if (woeid !== 23424977) {
    return NextResponse.json(
      { error: "Breakout research is currently available for US trends only." },
      { status: 400 }
    );
  }

  try {
    const rows = await sql`
      SELECT DISTINCT ON (tf.entity_id)
        tf.entity_id,
        tf.run_id,
        tf.fetched_at,
        tf.trend_name_raw,
        tf.canonical_name,
        tf.category,
        tf.rank,
        tf.rank_delta,
        tf.breakout_score,
        tf.persistence_score,
        tf.volatility_score,
        tls.appearances,
        tls.reentry_count,
        tls.best_rank
      FROM trend_features tf
      LEFT JOIN trend_lifecycle_summary tls
        ON tls.entity_id = tf.entity_id AND tls.woeid = tf.woeid
      WHERE tf.woeid = ${woeid}
        AND tf.fetched_at >= ${cutoff}
      ORDER BY tf.entity_id, tf.breakout_score DESC, tf.fetched_at DESC
    `;

    return NextResponse.json({
      meta: {
        location_woeid: woeid,
        scope: "US",
        window_hours: windowHours,
        limit,
      },
      breakouts: rows
        .sort((a, b) => b.breakout_score - a.breakout_score)
        .slice(0, limit),
    });
  } catch (error) {
    console.error("Error fetching breakouts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
