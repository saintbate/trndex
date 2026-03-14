import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName, parseWindowHours } from "@/lib/intelligence";

interface AlignedPoint {
  time: string;
  attention_rank: number | null;
  attention_breakout: number | null;
  attention_spread: number | null;
  price_close: number | null;
  price_change_pct: number | null;
  prediction_price_yes: number | null;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const xd = xs[i] - mx;
    const yd = ys[i] - my;
    num += xd * yd;
    dx += xd * xd;
    dy += yd * yd;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trend = searchParams.get("trend")?.trim();
  const symbol = searchParams.get("symbol")?.trim();
  const contractId = searchParams.get("contract_id")?.trim();
  const woeid = parseInt(searchParams.get("woeid") || "23424977", 10);
  const windowHours = parseWindowHours(searchParams.get("window"), 24 * 14);
  const maxLag = Math.min(48, Math.max(0, parseInt(searchParams.get("max_lag") || "24", 10)));

  if (!trend) {
    return NextResponse.json({ error: "Missing trend parameter" }, { status: 400 });
  }
  if (!symbol && !contractId) {
    return NextResponse.json({ error: "Provide symbol or contract_id" }, { status: 400 });
  }

  const sql = getDb();
  const normalized = normalizeTrendName(trend);
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  try {
    const aliases = await sql`
      SELECT entity_id FROM trend_aliases
      WHERE alias_normalized = ${normalized}
      LIMIT 1
    `;

    if (aliases.length === 0) {
      return NextResponse.json({ error: "Trend not found" }, { status: 404 });
    }

    const entityId = aliases[0].entity_id;

    const attentionRows = await sql`
      SELECT fetched_at, rank, breakout_score, spread_score
      FROM trend_features
      WHERE entity_id = ${entityId}
        AND woeid = ${woeid}
        AND fetched_at >= ${cutoff}
      ORDER BY fetched_at ASC
    `;

    let priceRows: Record<string, unknown>[] = [];
    let predictionRows: Record<string, unknown>[] = [];

    if (symbol) {
      priceRows = await sql`
        SELECT bucket_start, close
        FROM market_price_bars
        WHERE symbol = ${symbol}
          AND bucket_start >= ${cutoff}
        ORDER BY bucket_start ASC
      `;
    }

    if (contractId) {
      predictionRows = await sql`
        SELECT bucket_start, price_yes, question
        FROM prediction_market_bars
        WHERE contract_id = ${contractId}
          AND bucket_start >= ${cutoff}
        ORDER BY bucket_start ASC
      `;
    }

    const attentionByDay = new Map<string, { rank: number; breakout: number; spread: number }>();
    for (const row of attentionRows) {
      const day = new Date(row.fetched_at).toISOString().slice(0, 10);
      const existing = attentionByDay.get(day);
      if (!existing || row.breakout_score > existing.breakout) {
        attentionByDay.set(day, {
          rank: row.rank,
          breakout: row.breakout_score,
          spread: row.spread_score ?? 0,
        });
      }
    }

    const priceByDay = new Map<string, number>();
    for (const row of priceRows) {
      const day = new Date(String(row.bucket_start)).toISOString().slice(0, 10);
      priceByDay.set(day, Number(row.close));
    }

    const predictionByDay = new Map<string, { price_yes: number; question: string }>();
    for (const row of predictionRows) {
      const day = new Date(String(row.bucket_start)).toISOString().slice(0, 10);
      predictionByDay.set(day, { price_yes: Number(row.price_yes), question: String(row.question ?? "") });
    }

    const allDays = new Set<string>();
    attentionByDay.forEach((_, k) => allDays.add(k));
    priceByDay.forEach((_, k) => allDays.add(k));
    predictionByDay.forEach((_, k) => allDays.add(k));
    const sortedDays = Array.from(allDays).sort();

    const series: AlignedPoint[] = [];
    let prevClose: number | null = null;

    for (const day of sortedDays) {
      const att = attentionByDay.get(day);
      const close = priceByDay.get(day) ?? null;
      const pred = predictionByDay.get(day);

      let priceChangePct: number | null = null;
      if (close !== null && prevClose !== null && prevClose !== 0) {
        priceChangePct = ((close - prevClose) / prevClose) * 100;
      }

      series.push({
        time: day,
        attention_rank: att?.rank ?? null,
        attention_breakout: att?.breakout ?? null,
        attention_spread: att?.spread ?? null,
        price_close: close,
        price_change_pct: priceChangePct !== null ? Math.round(priceChangePct * 100) / 100 : null,
        prediction_price_yes: pred?.price_yes ?? null,
      });

      if (close !== null) prevClose = close;
    }

    const lagResults: { lag_hours: number; r_breakout_price: number | null; r_breakout_prediction: number | null; n: number }[] = [];

    const attDays = sortedDays.filter((d) => attentionByDay.has(d));
    const lagStepDays = Math.max(1, Math.round(maxLag / 24));

    for (let lagDays = -lagStepDays; lagDays <= lagStepDays; lagDays++) {
      const pairedBreakoutPrice: [number, number][] = [];
      const pairedBreakoutPrediction: [number, number][] = [];

      for (const day of attDays) {
        const att = attentionByDay.get(day);
        if (!att) continue;

        const targetDate = new Date(day);
        targetDate.setDate(targetDate.getDate() + lagDays);
        const targetDay = targetDate.toISOString().slice(0, 10);

        const close = priceByDay.get(targetDay);
        if (close !== undefined) {
          pairedBreakoutPrice.push([att.breakout, close]);
        }

        const pred = predictionByDay.get(targetDay);
        if (pred !== undefined) {
          pairedBreakoutPrediction.push([att.breakout, pred.price_yes]);
        }
      }

      lagResults.push({
        lag_hours: lagDays * 24,
        r_breakout_price: pearson(
          pairedBreakoutPrice.map((p) => p[0]),
          pairedBreakoutPrice.map((p) => p[1])
        ),
        r_breakout_prediction: pearson(
          pairedBreakoutPrediction.map((p) => p[0]),
          pairedBreakoutPrediction.map((p) => p[1])
        ),
        n: Math.max(pairedBreakoutPrice.length, pairedBreakoutPrediction.length),
      });
    }

    let bestLag = lagResults[0] ?? null;
    for (const lr of lagResults) {
      const strength = Math.abs(lr.r_breakout_price ?? 0) + Math.abs(lr.r_breakout_prediction ?? 0);
      const bestStrength = Math.abs(bestLag?.r_breakout_price ?? 0) + Math.abs(bestLag?.r_breakout_prediction ?? 0);
      if (strength > bestStrength) bestLag = lr;
    }

    const predQuestion = predictionRows.length > 0 ? String(predictionRows[0].question ?? "") : null;

    return NextResponse.json({
      meta: {
        trend,
        entity_id: entityId,
        symbol: symbol ?? null,
        contract_id: contractId ?? null,
        prediction_question: predQuestion,
        location_woeid: woeid,
        window_hours: windowHours,
        max_lag_hours: maxLag,
        data_points: series.length,
      },
      series,
      lag_correlation: lagResults,
      best_lag: bestLag,
    });
  } catch (error) {
    console.error("Error computing correlation:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
