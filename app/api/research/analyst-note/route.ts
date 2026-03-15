import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const NOTE_CACHE_SECONDS = 60 * 60;

function normalizeNote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractNote(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return typeof data.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
}

async function generateAnalystNote(input: {
  trend: string;
  marketLabel: string;
  conviction: string;
  relationship: string;
  timing: string;
  correlation: string;
  lagHours: string;
  dataPoints: string;
  windowDays: string;
  attentionDelta: string;
  marketDelta: string;
}): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a concise research analyst for an attention-vs-market dashboard. Write exactly 2 short sentences in plain English. Explain what the signal suggests, mention timing if relevant, and avoid hype. Do not mention AI, confidence formulas, or causation claims. Keep it readable for non-technical users.",
        },
        {
          role: "user",
          content:
            `Trend: ${input.trend}\n` +
            `Market: ${input.marketLabel}\n` +
            `Conviction: ${input.conviction}\n` +
            `Relationship: ${input.relationship}\n` +
            `Timing: ${input.timing}\n` +
            `Correlation: ${input.correlation}\n` +
            `Lag hours: ${input.lagHours}\n` +
            `Data points: ${input.dataPoints}\n` +
            `Window days: ${input.windowDays}\n` +
            `Attention delta: ${input.attentionDelta}\n` +
            `Market delta: ${input.marketDelta}`,
        },
      ],
      max_tokens: 120,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`xAI error ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as unknown;
  const note = normalizeNote(extractNote(payload));

  if (!note) {
    throw new Error("xAI returned an empty analyst note");
  }

  return note;
}

const getCachedAnalystNote = unstable_cache(
  async (
    trend: string,
    marketLabel: string,
    conviction: string,
    relationship: string,
    timing: string,
    correlation: string,
    lagHours: string,
    dataPoints: string,
    windowDays: string,
    attentionDelta: string,
    marketDelta: string
  ) =>
    generateAnalystNote({
      trend,
      marketLabel,
      conviction,
      relationship,
      timing,
      correlation,
      lagHours,
      dataPoints,
      windowDays,
      attentionDelta,
      marketDelta,
    }),
  ["research-analyst-note"],
  { revalidate: NOTE_CACHE_SECONDS }
);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const trend = params.get("trend")?.trim();
  const marketLabel = params.get("market_label")?.trim();
  const conviction = params.get("conviction")?.trim();
  const relationship = params.get("relationship")?.trim();
  const timing = params.get("timing")?.trim();
  const correlation = params.get("correlation")?.trim();
  const lagHours = params.get("lag_hours")?.trim();
  const dataPoints = params.get("data_points")?.trim();
  const windowDays = params.get("window_days")?.trim();
  const attentionDelta = params.get("attention_delta")?.trim() ?? "n/a";
  const marketDelta = params.get("market_delta")?.trim() ?? "n/a";

  if (!trend || !marketLabel || !conviction || !relationship || !timing || !correlation || !lagHours || !dataPoints || !windowDays) {
    return NextResponse.json({ error: "Missing required query parameters" }, { status: 400 });
  }

  try {
    const note = await getCachedAnalystNote(
      trend,
      marketLabel,
      conviction,
      relationship,
      timing,
      correlation,
      lagHours,
      dataPoints,
      windowDays,
      attentionDelta,
      marketDelta
    );

    return NextResponse.json(
      { note },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${NOTE_CACHE_SECONDS}, stale-while-revalidate=300`,
        },
      }
    );
  } catch (error) {
    console.error("Error generating analyst note:", error);
    return NextResponse.json({ error: "Unable to generate analyst note" }, { status: 502 });
  }
}
