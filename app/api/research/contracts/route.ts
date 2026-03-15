import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT contract_id, MAX(question) AS question
      FROM prediction_market_bars
      WHERE venue = 'polymarket'
        AND question IS NOT NULL
        AND question != ''
      GROUP BY contract_id
      ORDER BY contract_id
      LIMIT 50
    `;
    return NextResponse.json({
      contracts: (rows as { contract_id: string; question: string }[]).map((r) => ({
        id: r.contract_id,
        question: r.question?.slice(0, 120) ?? r.contract_id,
      })),
    });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
