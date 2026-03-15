import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName, parseWindowHours } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trend = searchParams.get("trend")?.trim();
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const windowHours = parseWindowHours(searchParams.get("window"), 24 * 7);

  if (!trend) {
    return NextResponse.json({ error: "Missing trend query parameter" }, { status: 400 });
  }
  if (woeid !== 23424977) {
    return NextResponse.json(
      { error: "Trend history is currently available for US trends only." },
      { status: 400 }
    );
  }

  const sql = getDb();
  const normalized = normalizeTrendName(trend);

  try {
    const aliases = await sql`
      SELECT entity_id, alias_name
      FROM trend_aliases
      WHERE alias_normalized = ${normalized}
      LIMIT 1
    `;

    if (aliases.length === 0) {
      return NextResponse.json({ error: "Trend not found" }, { status: 404 });
    }

    const entityId = aliases[0].entity_id;
    const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

    const lifecycleRows = await sql`
      SELECT *
      FROM trend_lifecycle_summary
      WHERE entity_id = ${entityId}
        AND woeid = ${woeid}
      LIMIT 1
    `;
    const historyRows = await sql`
      SELECT run_id, fetched_at, trend_name_raw, rank, prev_rank, rank_delta, rank_velocity,
             rank_acceleration, board_age_snapshots, persistence_score, breakout_score,
             volatility_score, entry_flag, exit_flag, reentry_count, tweet_count,
             prev_tweet_count, volume_delta_pct, volume_source, category, methodology_version
      FROM trend_features
      WHERE entity_id = ${entityId}
        AND woeid = ${woeid}
        AND fetched_at >= ${cutoff}
      ORDER BY fetched_at ASC
    `;

    const entityRow = await sql`
      SELECT canonical_name FROM trend_entities WHERE entity_id = ${entityId} LIMIT 1
    `;
    const canonicalName = (entityRow[0] as { canonical_name: string } | undefined)?.canonical_name ?? trend;
    const gtKeyword = canonicalName.replace(/^#/, "").trim().toLowerCase();

    const gtRows = await sql`
      SELECT bucket_date, interest_value
      FROM google_trends_bars
      WHERE LOWER(TRIM(REPLACE(keyword, '#', ''))) = ${gtKeyword}
        AND geo = 'US'
        AND bucket_date >= ${cutoff.slice(0, 10)}
      ORDER BY bucket_date ASC
    `;

    return NextResponse.json({
      meta: {
        trend,
        normalized_trend: normalized,
        entity_id: entityId,
        location_woeid: woeid,
        window_hours: windowHours,
        google_trends_mode: "qualitative",
      },
      lifecycle: lifecycleRows[0] ?? null,
      history: historyRows,
      google_trends: gtRows,
    });
  } catch (error) {
    console.error("Error fetching trend history:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
