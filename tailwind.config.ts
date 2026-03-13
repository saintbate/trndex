import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#07070C",
          card: "rgba(255,255,255,0.02)",
          "card-hover": "rgba(255,255,255,0.04)",
        },
        border: {
          subtle: "rgba(255,255,255,0.05)",
          medium: "rgba(255,255,255,0.08)",
        },
        txt: {
          primary: "#FFFFFF",
          secondary: "rgba(255,255,255,0.5)",
          muted: "rgba(255,255,255,0.2)",
        },
        up: "#00E676",
        down: "#FF5252",
        "new-entry": "#FBBF24",
        cat: {
          tech: "#A78BFA",
          politics: "#FB923C",
          sports: "#34D399",
          crypto: "#FBBF24",
          culture: "#F472B6",
          finance: "#60A5FA",
          news: "#EF4444",
          entertainment: "#EC4899",
          science: "#22D3EE",
          games: "#A3E635",
          health: "#6EE7B7",
        },
      },
      fontFamily: {
        mono: ["var(--font-jetbrains)", "monospace"],
        grotesk: ["var(--font-grotesk)", "sans-serif"],
      },
      keyframes: {
        "ticker-scroll": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-33.33%)" },
        },
        "row-in": {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 6px rgba(0,230,118,0.25)" },
          "50%": { boxShadow: "0 0 14px rgba(0,230,118,0.38)" },
        },
      },
      animation: {
        "ticker-scroll": "ticker-scroll 50s linear infinite",
        "row-in": "row-in 0.2s ease both",
        "pulse-glow": "pulse-glow 3s ease infinite",
      },
    },
  },
  plugins: [],
};
export default config;
