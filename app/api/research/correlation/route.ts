import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeTrendName, parseWindowHours } from "@/lib/intelligence";

interface AlignedPoint {
  time: string;
  attention_rank: number | null;
  attention_breakout: number | null;
  attention_spread: number | null;
  google_trends_interest: number | null;
  price_close: number | null;
  price_change_pct: number | null;
  prediction_price_yes: number | null;
  prediction_change_pct: number | null;
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

function toDayBucket(value: string | Date): string {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function toHourBucket(value: string | Date, bucketHours: number): string {
  const date = new Date(value);
  const bucketedHour = Math.floor(date.getUTCHours() / bucketHours) * bucketHours;
  date.setUTCHours(bucketedHour, 0, 0, 0);
  return date.toISOString();
}

function shiftBucket(bucket: string, hours: number): string {
  const date = new Date(bucket);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildAttentionBuckets(
  rows: Record<string, unknown>[],
  bucketHours: number
): Map<string, { rank: number; breakout: number; spread: number }> {
  const raw = new Map<string, { ranks: number[]; breakouts: number[]; spreads: number[] }>();

  for (const row of rows) {
    const bucket =
      bucketHours >= 24
        ? toDayBucket(String(row.fetched_at))
        : toHourBucket(String(row.fetched_at), bucketHours);
    if (!raw.has(bucket)) {
      raw.set(bucket, { ranks: [], breakouts: [], spreads: [] });
    }
    const entry = raw.get(bucket)!;
    if (typeof row.rank === "number") entry.ranks.push(row.rank);
    if (typeof row.breakout_score === "number") entry.breakouts.push(row.breakout_score);
    if (typeof row.spread_score === "number") entry.spreads.push(row.spread_score);
  }

  return new Map(
    Array.from(raw.entries()).map(([bucket, entry]) => [
      bucket,
      {
        rank: entry.ranks.length > 0 ? average(entry.ranks) : 0,
        breakout: entry.breakouts.length > 0 ? average(entry.breakouts) : 0,
        spread: entry.spreads.length > 0 ? average(entry.spreads) : 0,
      },
    ])
  );
}

function buildLevelChangeSeries(levels: Map<string, number>, percent = false): Map<string, number> {
  const changes = new Map<string, number>();
  const sorted = Array.from(levels.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (let i = 1; i < sorted.length; i++) {
    const [bucket, current] = sorted[i];
    const [, previous] = sorted[i - 1];
    if (percent) {
      if (previous !== 0) {
        changes.set(bucket, ((current - previous) / previous) * 100);
      }
    } else {
      changes.set(bucket, current - previous);
    }
  }

  return changes;
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
  if (woeid !== 23424977) {
    return NextResponse.json(
      { error: "Correlation research is currently available for US trends only." },
      { status: 400 }
    );
  }
  if (!symbol && !contractId) {
    return NextResponse.json({
      error: "Provide symbol or contract_id to correlate with market data. Use trend-history for attention + Google Trends only.",
    }, { status: 400 });
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
        AND bucket_date >= ${new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString().slice(0, 10)}
      ORDER BY bucket_date ASC
    `;

    const attentionByDay = buildAttentionBuckets(attentionRows as Record<string, unknown>[], 24);
    const attentionByTwoHours = buildAttentionBuckets(attentionRows as Record<string, unknown>[], 2);

    const priceByDay = new Map<string, number>();
    for (const row of priceRows) {
      const bucket = toDayBucket(String(row.bucket_start));
      priceByDay.set(bucket, Number(row.close));
    }

    const predictionByDay = new Map<string, { price_yes: number; question: string }>();
    const predictionByTwoHours = new Map<string, number>();
    for (const row of predictionRows) {
      const dayBucket = toDayBucket(String(row.bucket_start));
      const hourBucket = toHourBucket(String(row.bucket_start), 2);
      predictionByDay.set(dayBucket, {
        price_yes: Number(row.price_yes),
        question: String(row.question ?? ""),
      });
      predictionByTwoHours.set(hourBucket, Number(row.price_yes));
    }

    const gtByDay = new Map<string, number>();
    for (const row of gtRows as { bucket_date: string; interest_value: number }[]) {
      gtByDay.set(toDayBucket(String(row.bucket_date)), Number(row.interest_value));
    }

    const allDays = new Set<string>();
    attentionByDay.forEach((_, k) => allDays.add(k));
    priceByDay.forEach((_, k) => allDays.add(k));
    predictionByDay.forEach((_, k) => allDays.add(k));
    gtByDay.forEach((_, k) => allDays.add(k));
    const sortedDays = Array.from(allDays).sort();

    const series: AlignedPoint[] = [];
    let prevClose: number | null = null;
    let prevPrediction: number | null = null;

    for (const day of sortedDays) {
      const att = attentionByDay.get(day);
      const close = priceByDay.get(day) ?? null;
      const pred = predictionByDay.get(day);

      let priceChangePct: number | null = null;
      if (close !== null && prevClose !== null && prevClose !== 0) {
        priceChangePct = ((close - prevClose) / prevClose) * 100;
      }

      let predictionChangePct: number | null = null;
      if (pred && prevPrediction !== null && prevPrediction !== 0) {
        predictionChangePct = ((pred.price_yes - prevPrediction) / prevPrediction) * 100;
      }

      series.push({
        time: day.slice(0, 10),
        attention_rank: att?.rank ?? null,
        attention_breakout: att?.breakout ?? null,
        attention_spread: att?.spread ?? null,
        google_trends_interest: gtByDay.get(day) ?? null,
        price_close: close,
        price_change_pct: priceChangePct !== null ? Math.round(priceChangePct * 100) / 100 : null,
        prediction_price_yes: pred?.price_yes ?? null,
        prediction_change_pct: predictionChangePct !== null ? Math.round(predictionChangePct * 100) / 100 : null,
      });

      if (close !== null) prevClose = close;
      if (pred) prevPrediction = pred.price_yes;
    }

    const lagStepHours = symbol ? 24 : 2;
    const maxLagSteps = Math.max(1, Math.floor(maxLag / lagStepHours));
    const attentionForCorrelation = symbol
      ? new Map(Array.from(attentionByDay.entries()).map(([bucket, value]) => [bucket, value.breakout]))
      : new Map(Array.from(attentionByTwoHours.entries()).map(([bucket, value]) => [bucket, value.breakout]));
    const attentionChanges = buildLevelChangeSeries(attentionForCorrelation);
    const priceChanges = buildLevelChangeSeries(priceByDay, true);
    const predictionChanges = buildLevelChangeSeries(predictionByTwoHours, true);
    const lagResults: { lag_hours: number; r_breakout_price: number | null; r_breakout_prediction: number | null; n: number }[] = [];

    const attentionBuckets = Array.from(attentionChanges.keys()).sort();
    for (let lagStep = -maxLagSteps; lagStep <= maxLagSteps; lagStep++) {
      const pairedBreakoutPrice: [number, number][] = [];
      const pairedBreakoutPrediction: [number, number][] = [];

      for (const bucket of attentionBuckets) {
        const attChange = attentionChanges.get(bucket);
        if (attChange === undefined) continue;

        const shiftedBucket = shiftBucket(bucket, lagStep * lagStepHours);
        const priceChange = priceChanges.get(shiftedBucket);
        if (priceChange !== undefined) {
          pairedBreakoutPrice.push([attChange, priceChange]);
        }

        const predictionChange = predictionChanges.get(shiftedBucket);
        if (predictionChange !== undefined) {
          pairedBreakoutPrediction.push([attChange, predictionChange]);
        }
      }

      lagResults.push({
        lag_hours: lagStep * lagStepHours,
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
      if (
        strength > bestStrength ||
        (strength === bestStrength && (lr.n ?? 0) > (bestLag?.n ?? 0))
      ) {
        bestLag = lr;
      }
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
        lag_step_hours: lagStepHours,
        chart_points: series.length,
        data_points: bestLag?.n ?? 0,
        google_trends_mode: "qualitative",
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
