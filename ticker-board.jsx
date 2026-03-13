import { useState, useEffect, useMemo } from "react";

// ── Mock Data ────────────────────────────────────────────────────────────
const MOCK_TRENDS = [
  { trend_name: "#AI", rank: 1, tweet_count: 487200, prev_count: 312000, delta_pct: 56.2, direction: "up", is_new: false, category: "Tech" },
  { trend_name: "Supreme Court", rank: 2, tweet_count: 392100, prev_count: 445000, delta_pct: -11.9, direction: "down", is_new: false, category: "Politics" },
  { trend_name: "#NBAPlayoffs", rank: 3, tweet_count: 341800, prev_count: 198000, delta_pct: 72.6, direction: "up", is_new: false, category: "Sports" },
  { trend_name: "NVIDIA", rank: 4, tweet_count: 289400, prev_count: 215000, delta_pct: 34.6, direction: "up", is_new: false, category: "Tech" },
  { trend_name: "Beyoncé", rank: 5, tweet_count: 276500, prev_count: 310000, delta_pct: -10.8, direction: "down", is_new: false, category: "Culture" },
  { trend_name: "#Bitcoin", rank: 6, tweet_count: 264100, prev_count: 189000, delta_pct: 39.7, direction: "up", is_new: false, category: "Crypto" },
  { trend_name: "Fed Rate", rank: 7, tweet_count: 231000, prev_count: 280000, delta_pct: -17.5, direction: "down", is_new: false, category: "Finance" },
  { trend_name: "#Breaking", rank: 8, tweet_count: 218700, prev_count: 0, delta_pct: 100, direction: "up", is_new: true, category: "News" },
  { trend_name: "Elon Musk", rank: 9, tweet_count: 198300, prev_count: 167000, delta_pct: 18.7, direction: "up", is_new: false, category: "Tech" },
  { trend_name: "Drake", rank: 10, tweet_count: 187600, prev_count: 224000, delta_pct: -16.3, direction: "down", is_new: false, category: "Culture" },
  { trend_name: "ChatGPT", rank: 11, tweet_count: 176200, prev_count: 142000, delta_pct: 24.1, direction: "up", is_new: false, category: "Tech" },
  { trend_name: "Netflix", rank: 12, tweet_count: 164800, prev_count: 171000, delta_pct: -3.6, direction: "down", is_new: false, category: "Entertainment" },
  { trend_name: "#Election2026", rank: 13, tweet_count: 153400, prev_count: 0, delta_pct: 100, direction: "up", is_new: true, category: "Politics" },
  { trend_name: "Warriors", rank: 14, tweet_count: 142100, prev_count: 188000, delta_pct: -24.4, direction: "down", is_new: false, category: "Sports" },
  { trend_name: "Ethereum", rank: 15, tweet_count: 131700, prev_count: 98000, delta_pct: 34.4, direction: "up", is_new: false, category: "Crypto" },
  { trend_name: "Climate", rank: 16, tweet_count: 94200, prev_count: 102000, delta_pct: -7.6, direction: "down", is_new: false, category: "Science" },
  { trend_name: "Taylor Swift", rank: 17, tweet_count: 88900, prev_count: 76000, delta_pct: 17.0, direction: "up", is_new: false, category: "Culture" },
  { trend_name: "Wordle", rank: 18, tweet_count: 67300, prev_count: 71000, delta_pct: -5.2, direction: "down", is_new: false, category: "Games" },
  { trend_name: "#MentalHealth", rank: 19, tweet_count: 54100, prev_count: 48000, delta_pct: 12.7, direction: "up", is_new: false, category: "Health" },
  { trend_name: "Luka Doncic", rank: 20, tweet_count: 47800, prev_count: 0, delta_pct: 100, direction: "up", is_new: true, category: "Sports" },
];

const genSparkline = (direction, points = 16) => {
  const data = [];
  let val = 40 + Math.random() * 20;
  for (let i = 0; i < points; i++) {
    val += (direction === "up" ? 2 : -1.5) + (Math.random() - 0.45) * 10;
    val = Math.max(5, Math.min(95, val));
    data.push(val);
  }
  return data;
};

const CATEGORY_COLORS = {
  Tech: "#A78BFA", Politics: "#FB923C", Sports: "#34D399", Crypto: "#FBBF24",
  Culture: "#F472B6", Finance: "#60A5FA", News: "#EF4444", Entertainment: "#EC4899",
  Science: "#22D3EE", Games: "#A3E635", Health: "#6EE7B7",
};

const fmt = (n) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);

const computePulse = (trends) => {
  const ups = trends.filter(t => t.direction === "up").length;
  const avgMom = trends.reduce((s, t) => s + t.delta_pct, 0) / trends.length;
  const newC = trends.filter(t => t.is_new).length;
  return Math.max(0, Math.min(100, Math.round((ups / trends.length) * 50 + Math.min(avgMom, 50) * 0.6 + newC * 3)));
};

const getPulseLabel = (s) => {
  if (s >= 80) return { label: "SURGING", color: "#00E676" };
  if (s >= 60) return { label: "BULLISH", color: "#69F0AE" };
  if (s >= 40) return { label: "NEUTRAL", color: "#FFD600" };
  if (s >= 20) return { label: "COOLING", color: "#FF9100" };
  return { label: "DEAD", color: "#FF5252" };
};

// ── Pulse Gauge ──────────────────────────────────────────────────────────
const PulseGauge = ({ score }) => {
  const { label, color } = getPulseLabel(score);
  const angle = -135 + (score / 100) * 270;
  const r = 72, cx = 90, cy = 90;
  const arc = (s, e) => {
    const sa = (s - 90) * Math.PI / 180, ea = (e - 90) * Math.PI / 180;
    return `M ${cx + r * Math.cos(sa)} ${cy + r * Math.sin(sa)} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${cx + r * Math.cos(ea)} ${cy + r * Math.sin(ea)}`;
  };
  const na = (angle - 90) * Math.PI / 180;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="180" height="130" viewBox="0 0 180 130">
        <defs>
          <linearGradient id="gg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FF5252" /><stop offset="25%" stopColor="#FF9100" />
            <stop offset="50%" stopColor="#FFD600" /><stop offset="75%" stopColor="#69F0AE" />
            <stop offset="100%" stopColor="#00E676" />
          </linearGradient>
        </defs>
        <path d={arc(-135, 135)} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" strokeLinecap="round" />
        <path d={arc(-135, Math.min(angle, 135))} fill="none" stroke="url(#gg)" strokeWidth="10" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3.5" fill={color} />
        <line x1={cx} y1={cy} x2={cx + 52 * Math.cos(na)} y2={cy + 52 * Math.sin(na)} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <text x={cx} y={cy + 3} textAnchor="middle" style={{ fontSize: "30px", fontWeight: 800, fill: "#fff", fontFamily: "'JetBrains Mono', monospace" }}>{score}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" style={{ fontSize: "8px", fontWeight: 600, fill: "rgba(255,255,255,0.2)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.1em" }}>/ 100</text>
      </svg>
      <div style={{ marginTop: "-8px", padding: "3px 14px", borderRadius: "4px", background: `${color}12`, border: `1px solid ${color}25` }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em", color }}>{label}</span>
      </div>
    </div>
  );
};

// ── Top Mover Card ───────────────────────────────────────────────────────
const MoverCard = ({ trend, type }) => {
  const isG = type === "gainer";
  const c = isG ? "#00E676" : "#FF5252";
  const cc = CATEGORY_COLORS[trend.category] || "#888";
  return (
    <div style={{ flex: "1 1 0", minWidth: "130px", padding: "12px 14px", background: `${c}06`, border: `1px solid ${c}15`, borderRadius: "8px" }}>
      <div style={{ fontSize: "8.5px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)", marginBottom: "5px", fontFamily: "'JetBrains Mono', monospace" }}>
        {isG ? "▲ TOP GAINER" : "▼ TOP LOSER"}
      </div>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", marginBottom: "3px", letterSpacing: "-0.02em" }}>
        {trend.trend_name}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "19px", fontWeight: 800, color: c }}>
          {isG ? "+" : ""}{trend.delta_pct}%
        </span>
        <span style={{ fontSize: "7.5px", fontWeight: 700, color: cc, letterSpacing: "0.08em", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", background: `${cc}12`, border: `1px solid ${cc}25`, borderRadius: "3px", padding: "1.5px 5px" }}>{trend.category}</span>
      </div>
      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace", marginTop: "3px" }}>
        {fmt(trend.tweet_count)} posts
      </div>
    </div>
  );
};

// ── Sparkline ─────────────────────────────────────────────────────────────
const Sparkline = ({ data, color, width = 68, height = 22 }) => {
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - mn) / rng) * height}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
};

// ── Ticker Tape ───────────────────────────────────────────────────────────
const TickerTape = ({ trends }) => {
  const items = [...trends, ...trends, ...trends];
  return (
    <div style={{ overflow: "hidden", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "7px 0", background: "rgba(0,0,0,0.5)" }}>
      <div style={{ display: "inline-block", animation: "ticker-scroll 50s linear infinite" }}>
        {items.map((t, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "5px", marginRight: "26px", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
            <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 500 }}>{t.trend_name}</span>
            <span style={{ color: t.direction === "up" ? "#00E676" : "#FF5252", fontWeight: 700 }}>
              {t.direction === "up" ? "▲+" : "▼"}{t.delta_pct}%
            </span>
            <span style={{ color: "rgba(255,255,255,0.08)" }}>│</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Trend Row ─────────────────────────────────────────────────────────────
const TrendRow = ({ trend, sparkData, index }) => {
  const isUp = trend.direction === "up";
  const c = isUp ? "#00E676" : "#FF5252";
  const cc = CATEGORY_COLORS[trend.category] || "#888";
  const [h, setH] = useState(false);

  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{
      display: "grid", gridTemplateColumns: "34px 1fr 68px 82px 84px",
      alignItems: "center", padding: "9px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.025)",
      background: h ? "rgba(255,255,255,0.02)" : "transparent",
      transition: "background 0.1s", cursor: "default",
      animation: `row-in 0.2s ease ${index * 0.02}s both`,
    }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "rgba(255,255,255,0.15)", fontWeight: 500 }}>
        {String(trend.rank).padStart(2, "0")}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0, overflow: "hidden" }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: "13px", fontWeight: 600, color: "#fff", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {trend.trend_name}
        </span>
        <span style={{ fontSize: "7.5px", fontWeight: 700, letterSpacing: "0.06em", color: cc, background: `${cc}10`, border: `1px solid ${cc}20`, borderRadius: "3px", padding: "1px 4px", flexShrink: 0, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>
          {trend.category}
        </span>
        {trend.is_new && <span style={{ fontSize: "7px", fontWeight: 800, color: "#FBBF24", background: "#FBBF2410", border: "1px solid #FBBF2420", borderRadius: "3px", padding: "1px 4px", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>NEW</span>}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Sparkline data={sparkData} color={c} />
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px", fontWeight: 500, color: "rgba(255,255,255,0.5)" }}>{fmt(trend.tweet_count)}</span>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12.5px", fontWeight: 700, color: c, background: `${c}0D`, padding: "2px 7px", borderRadius: "4px" }}>
          {isUp ? "+" : ""}{trend.delta_pct}%
        </span>
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────
export default function Trndex() {
  const [sortBy, setSortBy] = useState("rank");
  const [filter, setFilter] = useState("All");
  const [time, setTime] = useState(new Date());
  const sparklines = useMemo(() => MOCK_TRENDS.reduce((a, t) => { a[t.trend_name] = genSparkline(t.direction); return a; }, {}), []);

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);

  const pulse = computePulse(MOCK_TRENDS);
  const topGainer = [...MOCK_TRENDS].filter(t => t.direction === "up" && !t.is_new).sort((a, b) => b.delta_pct - a.delta_pct)[0];
  const topLoser = [...MOCK_TRENDS].filter(t => t.direction === "down").sort((a, b) => a.delta_pct - b.delta_pct)[0];

  const categories = ["All", ...new Set(MOCK_TRENDS.map(t => t.category))];
  let filtered = filter === "All" ? [...MOCK_TRENDS] : MOCK_TRENDS.filter(t => t.category === filter);
  switch (sortBy) {
    case "volume": filtered.sort((a, b) => b.tweet_count - a.tweet_count); break;
    case "momentum": filtered.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct)); break;
    case "gainers": filtered = filtered.filter(t => t.direction === "up").sort((a, b) => b.delta_pct - a.delta_pct); break;
    case "losers": filtered = filtered.filter(t => t.direction === "down").sort((a, b) => a.delta_pct - b.delta_pct); break;
    default: filtered.sort((a, b) => a.rank - b.rank);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#07070C", color: "#fff" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');
        @keyframes ticker-scroll { 0%{transform:translateX(0)} 100%{transform:translateX(-33.33%)} }
        @keyframes row-in { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse-glow { 0%,100%{box-shadow:0 0 6px #00E67640} 50%{box-shadow:0 0 14px #00E67660} }
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.06);border-radius:3px}
      `}</style>

      <TickerTape trends={MOCK_TRENDS} />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.04em", color: "#fff" }}>TRNDEX</h1>
          <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "2.5px 7px", borderRadius: "4px", background: "#00E67610", border: "1px solid #00E67620", animation: "pulse-glow 3s ease infinite" }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#00E676" }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", fontWeight: 700, color: "#00E676", letterSpacing: "0.1em" }}>LIVE</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{time.toLocaleTimeString("en-US", { hour12: false })}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "rgba(255,255,255,0.18)", letterSpacing: "0.06em" }}>
            {time.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()} · US MARKET
          </div>
        </div>
      </div>

      {/* Hero: Pulse + Movers */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "20px", padding: "16px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.22)", marginBottom: "2px" }}>TREND PULSE</div>
          <PulseGauge score={pulse} />
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", flex: "1 1 280px" }}>
          {topGainer && <MoverCard trend={topGainer} type="gainer" />}
          {topLoser && <MoverCard trend={topLoser} type="loser" />}
          <div style={{ flex: "1 1 0", minWidth: "120px", padding: "12px 14px", background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px" }}>
            <div style={{ fontSize: "8.5px", fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.25)", marginBottom: "6px", fontFamily: "'JetBrains Mono', monospace" }}>MARKET</div>
            {[
              { l: "TOTAL VOL", v: fmt(MOCK_TRENDS.reduce((s, t) => s + t.tweet_count, 0)), c: "rgba(255,255,255,0.75)" },
              { l: "GAINERS", v: MOCK_TRENDS.filter(t => t.direction === "up").length, c: "#00E676" },
              { l: "LOSERS", v: MOCK_TRENDS.filter(t => t.direction === "down").length, c: "#FF5252" },
              { l: "NEW ENTRIES", v: MOCK_TRENDS.filter(t => t.is_new).length, c: "#FBBF24" },
            ].map(s => (
              <div key={s.l} style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em" }}>{s.l}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px", fontWeight: 700, color: s.c }}>{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sort + Filter */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap", gap: "6px" }}>
        <div style={{ display: "flex", gap: "3px" }}>
          {[["rank","RANK"],["volume","VOL"],["momentum","MOVERS"],["gainers","GAINERS"],["losers","LOSERS"]].map(([k, l]) => (
            <button key={k} onClick={() => setSortBy(k)} style={{
              background: sortBy === k ? "rgba(255,255,255,0.07)" : "transparent",
              border: sortBy === k ? "1px solid rgba(255,255,255,0.12)" : "1px solid transparent",
              borderRadius: "4px", padding: "3px 7px", cursor: "pointer",
              color: sortBy === k ? "#fff" : "rgba(255,255,255,0.25)",
              fontSize: "8.5px", fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.08em", fontWeight: 600, transition: "all 0.1s",
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{
              background: filter === c ? `${CATEGORY_COLORS[c] || "rgba(255,255,255,0.08)"}15` : "transparent",
              border: filter === c ? `1px solid ${CATEGORY_COLORS[c] || "rgba(255,255,255,0.12)"}35` : "1px solid transparent",
              borderRadius: "4px", padding: "2px 6px", cursor: "pointer",
              color: filter === c ? (CATEGORY_COLORS[c] || "#fff") : "rgba(255,255,255,0.18)",
              fontSize: "8px", fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "0.06em", fontWeight: 600, transition: "all 0.1s",
            }}>{c.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {/* Column Headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "34px 1fr 68px 82px 84px",
        alignItems: "center", padding: "6px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        fontFamily: "'JetBrains Mono', monospace", fontSize: "8px",
        fontWeight: 600, letterSpacing: "0.1em", color: "rgba(255,255,255,0.18)",
        position: "sticky", top: 0, background: "#07070C", zIndex: 10,
      }}>
        <span>#</span><span>TREND</span><span style={{ textAlign: "center" }}>12H</span>
        <span style={{ textAlign: "right" }}>VOL</span><span style={{ textAlign: "right" }}>Δ%</span>
      </div>

      {/* Rows */}
      <div style={{ paddingBottom: "20px" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "36px", textAlign: "center", color: "rgba(255,255,255,0.12)", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>No trends match</div>
        ) : filtered.map((t, i) => (
          <TrendRow key={t.trend_name} trend={t} index={i} sparkData={sparklines[t.trend_name] || genSparkline(t.direction)} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 20px", borderTop: "1px solid rgba(255,255,255,0.03)", display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace", fontSize: "8px", color: "rgba(255,255,255,0.1)", letterSpacing: "0.06em" }}>
        <span>TRNDEX.LIVE · REFRESHED EVERY 2H</span>
        <span>{MOCK_TRENDS.length} TRACKING · {MOCK_TRENDS.filter(t => t.direction === "up").length}↑ {MOCK_TRENDS.filter(t => t.direction === "down").length}↓</span>
      </div>
    </div>
  );
}
