"use client";

interface SparklineProps {
  /** Rank positions over last 6 snapshots (1–20). Null = off-board. Y inverted: rank 1 at top. */
  data: (number | null)[];
  color: string;
  width?: number;
  height?: number;
}

export default function Sparkline({
  data,
  color,
  width = 68,
  height = 22,
}: SparklineProps) {
  const OFF_BOARD = 21;
  const withOffBoard = data.map((v) => (v === null ? OFF_BOARD : v));

  if (withOffBoard.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth="1.5"
          strokeOpacity={0.3}
          strokeDasharray="2 2"
        />
      </svg>
    );
  }

  // Y inverted: rank 1 at top (y=0), rank 20 at bottom (y=height)
  const rng = 20;
  const pts = withOffBoard
    .map(
      (rank, i) =>
        `${(i / (withOffBoard.length - 1)) * width},${((rank - 1) / rng) * height}`
    )
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
