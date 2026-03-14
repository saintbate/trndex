import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trend = searchParams.get("trend")?.trim();
  const predictedAt = searchParams.get("predicted_at")?.trim();

  if (!trend || !predictedAt) {
    return NextResponse.json({ error: "Missing trend or predicted_at" }, { status: 400 });
  }

  const predTime = new Date(predictedAt);
  if (isNaN(predTime.getTime())) {
    return NextResponse.json({ error: "Invalid predicted_at" }, { status: 400 });
  }

  const windowStart = new Date(predTime.getTime() + 3.5 * 60 * 60 * 1000);
  const windowEnd = new Date(predTime.getTime() + 4.5 * 60 * 60 * 1000);
  const now = new Date();

  if (windowEnd > now) {
    return NextResponse.json({
      resolved: false,
      reason: "too_soon",
      message: "Check back in ~4 hours to see the result",
    });
  }

  const sql = getDb();
  const norm = normalizeTrendName(trend);

  try {
    const runs = await sql`
      SELECT run_id, fetched_at
      FROM snapshot_runs
      WHERE woeid = 23424977
        AND source_status IN ('success', 'backfilled')
        AND fetched_at >= ${windowStart.toISOString()}
        AND fetched_at <= ${windowEnd.toISOString()}
      ORDER BY fetched_at ASC
      LIMIT 1
    `;

    if (runs.length === 0) {
      return NextResponse.json({
        resolved: true,
        was_on_board: null,
        snapshot_at: null,
        reason: "no_snapshot",
        message: "No snapshot in the 4-hour window",
      });
    }

    const run = runs[0] as { run_id: string; fetched_at: string };
    let items = await sql`
      SELECT 1
      FROM snapshot_items si
      JOIN trend_aliases ta ON ta.entity_id = si.entity_id
      WHERE si.run_id = ${run.run_id}
        AND ta.alias_normalized = ${norm}
      LIMIT 1
    `;
    if (items.length === 0) {
      items = await sql`
        SELECT 1 FROM snapshot_items
        WHERE run_id = ${run.run_id}
          AND trend_name_normalized = ${norm}
        LIMIT 1
      `;
    }

    const wasOnBoard = items.length > 0;

    return NextResponse.json({
      resolved: true,
      was_on_board: wasOnBoard,
      snapshot_at: run.fetched_at,
    });
  } catch (error) {
    console.error("Predict resolve error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
