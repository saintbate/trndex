import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const CONTEXT_CACHE_SECONDS = 2 * 60 * 60;

function normalizeContext(text: string): string {
  return text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractContextText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";

  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return typeof data.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
}

async function fetchTrendContext(trendName: string): Promise<string> {
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
            "You explain why topics are trending on X/Twitter. Respond in one sentence, max 20 words. Be specific about the actual event or reason. No filler, no hedging.",
        },
        {
          role: "user",
          content: `Why is "${trendName}" trending on X right now?`,
        },
      ],
      max_tokens: 60,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`xAI error ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as unknown;
  const context = normalizeContext(extractContextText(payload));

  if (!context) {
    throw new Error("xAI returned an empty context response");
  }

  return context;
}

const getCachedTrendContext = unstable_cache(
  async (trendName: string) => fetchTrendContext(trendName),
  ["trend-context"],
  { revalidate: CONTEXT_CACHE_SECONDS }
);

export async function GET(request: NextRequest) {
  const trendName = request.nextUrl.searchParams.get("trend")?.trim();

  if (!trendName) {
    return NextResponse.json({ error: "Missing trend query parameter" }, { status: 400 });
  }

  try {
    const context = await getCachedTrendContext(trendName);
    return new NextResponse(context, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": `public, s-maxage=${CONTEXT_CACHE_SECONDS}, stale-while-revalidate=300`,
      },
    });
  } catch (error) {
    console.error("Error fetching trend context:", error);
    return NextResponse.json(
      { error: "Unable to fetch trend context" },
      { status: 502 }
    );
  }
}
