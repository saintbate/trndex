import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseWindowHours } from "@/lib/intelligence";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const windowHours = parseWindowHours(searchParams.get("window"), 24 * 7);
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const sql = getDb();

  try {
    const rows = await sql`
      SELECT *
      FROM market_features
      WHERE woeid = ${woeid}
        AND fetched_at >= ${cutoff}
      ORDER BY fetched_at ASC
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "No market regime data available" }, { status: 404 });
    }

    return NextResponse.json({
      meta: {
        location_woeid: woeid,
        window_hours: windowHours,
      },
      latest: rows[rows.length - 1],
      series: rows,
    });
  } catch (error) {
    console.error("Error fetching market regime:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
