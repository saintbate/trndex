"use client";

type WordmarkProps = {
  className?: string;
};

export default function Wordmark({ className }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 250 38"
      aria-label="TRNDEX"
      role="img"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="27"
        fill="white"
        fontFamily="var(--font-jetbrains), monospace"
        fontSize="29"
        fontWeight="800"
        letterSpacing="-1.4"
      >
        TRNDE
      </text>
      <path
        d="M210 8L231 30"
        stroke="#00E676"
        strokeLinecap="round"
        strokeWidth="5"
      />
      <path
        d="M231 8L210 30"
        stroke="#00E676"
        strokeLinecap="round"
        strokeWidth="5"
      />
    </svg>
  );
}
