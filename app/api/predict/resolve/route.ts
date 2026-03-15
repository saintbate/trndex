import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trend = searchParams.get("trend")?.trim();
  const predictedAt = searchParams.get("predicted_at")?.trim();
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const resolutionHours = 4;
  const toleranceHours = 8;

  if (!trend || !predictedAt) {
    return NextResponse.json({ error: "Missing trend or predicted_at" }, { status: 400 });
  }
  if (woeid !== 23424977) {
    return NextResponse.json(
      { error: "Prediction resolution is currently available for US trends only." },
      { status: 400 }
    );
  }

  const predTime = new Date(predictedAt);
  if (isNaN(predTime.getTime())) {
    return NextResponse.json({ error: "Invalid predicted_at" }, { status: 400 });
  }

  const targetTime = new Date(predTime.getTime() + resolutionHours * 60 * 60 * 1000);
  const windowEnd = new Date(targetTime.getTime() + toleranceHours * 60 * 60 * 1000);
  const now = new Date();

  if (targetTime > now) {
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
      WHERE woeid = ${woeid}
        AND source_status IN ('success', 'backfilled')
        AND fetched_at >= ${targetTime.toISOString()}
        AND fetched_at <= ${windowEnd.toISOString()}
      ORDER BY fetched_at ASC
      LIMIT 1
    `;

    if (runs.length === 0) {
      return NextResponse.json({
        resolved: false,
        was_on_board: null,
        snapshot_at: null,
        reason: now < windowEnd ? "awaiting_snapshot" : "no_usable_snapshot",
        message:
          now < windowEnd
            ? "Waiting for the first usable post-target snapshot."
            : "No usable post-target snapshot was collected for this prediction yet.",
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
