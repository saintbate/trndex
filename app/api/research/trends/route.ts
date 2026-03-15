import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const limit = Math.max(5, Math.min(30, parseInt(searchParams.get("limit") || "12", 10)));
  const sql = getDb();

  try {
    if (!query) {
      const rows = await sql`
        SELECT DISTINCT ON (tf.entity_id)
          tf.entity_id,
          tf.trend_name_raw,
          te.canonical_name,
          te.last_seen_at
        FROM trend_features tf
        JOIN trend_entities te ON te.entity_id = tf.entity_id
        WHERE tf.woeid = 23424977
        ORDER BY tf.entity_id, tf.fetched_at DESC
      `;

      return NextResponse.json({
        scope: "US",
        trends: (rows as Record<string, unknown>[])
          .sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)))
          .slice(0, limit)
          .map((row) => ({
            entity_id: row.entity_id,
            canonical_name: row.canonical_name,
            display_name: row.trend_name_raw || row.canonical_name,
            last_seen_at: row.last_seen_at,
          })),
      });
    }

    const normalized = normalizeTrendName(query);
    const like = `%${query}%`;
    const prefix = `${query}%`;

    const rows = await sql`
      SELECT DISTINCT ON (te.entity_id)
        te.entity_id,
        te.canonical_name,
        ta.alias_name,
        te.last_seen_at,
        CASE
          WHEN te.canonical_name_normalized = ${normalized} OR ta.alias_normalized = ${normalized} THEN 0
          WHEN te.canonical_name ILIKE ${prefix} OR ta.alias_name ILIKE ${prefix} THEN 1
          ELSE 2
        END AS match_rank
      FROM trend_entities te
      LEFT JOIN trend_aliases ta ON ta.entity_id = te.entity_id
      LEFT JOIN trend_lifecycle_summary tls ON tls.entity_id = te.entity_id AND tls.woeid = 23424977
      WHERE tls.entity_id IS NOT NULL
        AND (
          te.canonical_name ILIKE ${like}
          OR COALESCE(ta.alias_name, '') ILIKE ${like}
        )
      ORDER BY te.entity_id, match_rank ASC, te.last_seen_at DESC
    `;

    const trends = (rows as Record<string, unknown>[])
      .sort((a, b) => {
        const rankDelta = Number(a.match_rank) - Number(b.match_rank);
        if (rankDelta !== 0) return rankDelta;
        return String(b.last_seen_at).localeCompare(String(a.last_seen_at));
      })
      .slice(0, limit)
      .map((row) => ({
        entity_id: row.entity_id,
        canonical_name: row.canonical_name,
        display_name: row.alias_name || row.canonical_name,
        last_seen_at: row.last_seen_at,
      }));

    return NextResponse.json({ scope: "US", trends });
  } catch (error) {
    console.error("Error searching research trends:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
