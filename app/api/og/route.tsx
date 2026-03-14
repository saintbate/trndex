import { ImageResponse } from "next/og";
import { getDb } from "@/lib/db";

export const runtime = "edge";

export async function GET() {
  let topTrends: string[] = [];

  try {
    const sql = getDb();

    const currentTrends = await sql`
      SELECT trend_name, tweet_count, rank
      FROM snapshots
      WHERE woeid = 23424977
        AND fetched_at = (
          SELECT DISTINCT fetched_at FROM snapshots
          WHERE woeid = 23424977
          ORDER BY fetched_at DESC
          LIMIT 1
        )
      ORDER BY rank ASC
      LIMIT 5
    `;

    topTrends = currentTrends.map((t) => t.trend_name);
  } catch {
    // Use defaults
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "#07070C",
          fontFamily: "monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontSize: "64px",
                fontWeight: 800,
                color: "#fff",
                letterSpacing: "-0.08em",
              }}
            >
              TRNDE
            </div>
            <svg
              width="34"
              height="34"
              viewBox="0 0 34 34"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M7 7L27 27" stroke="#00E676" strokeWidth="6" strokeLinecap="round" />
              <path d="M27 7L7 27" stroke="#00E676" strokeWidth="6" strokeLinecap="round" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 800,
              color: "#00E676",
              letterSpacing: "0.1em",
            }}
          >
            LIVE
          </div>
        </div>

        <div
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.35)",
            letterSpacing: "0.12em",
            marginBottom: "24px",
          }}
        >
          TRENDING NOW
        </div>

        {topTrends.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              justifyContent: "center",
              maxWidth: "900px",
            }}
          >
            {topTrends.map((name) => (
              <div
                key={name}
                style={{
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "6px",
                  padding: "6px 14px",
                }}
              >
                {name}
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            bottom: "30px",
            fontSize: "14px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.15)",
            letterSpacing: "0.1em",
          }}
        >
          TRNDEX.LIVE — THE TREND EXCHANGE
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
