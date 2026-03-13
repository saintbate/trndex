export type TrendCategory =
  | "Tech"
  | "Politics"
  | "Sports"
  | "Crypto"
  | "Culture"
  | "Finance"
  | "News"
  | "Entertainment"
  | "Science"
  | "Games"
  | "Health";

const CATEGORY_RULES: Array<{
  category: TrendCategory;
  hashtags?: string[];
  phrases?: string[];
  anyWords?: string[];
  allWords?: string[];
  custom?: (normalized: string, hashtags: Set<string>) => boolean;
}> = [
  {
    category: "Politics",
    hashtags: ["#election2026"],
    phrases: [
      "supreme court",
      "white house",
      "executive order",
      "bipartisan",
      "congress",
      "senate",
      "scotus",
      "president",
      "democrat",
      "republican",
      "gop",
      "election",
      "impeach",
      "filibuster",
    ],
  },
  {
    category: "Tech",
    hashtags: ["#ai"],
    phrases: [
      "chatgpt",
      "openai",
      "google",
      "apple",
      "nvidia",
      "tesla",
      "microsoft",
      "github",
      "android",
      "iphone",
      "ios",
      "samsung",
      "amd",
      "intel",
      "copilot",
      "gemini",
      "claude",
      "gpt",
      "anthropic",
      "meta",
    ],
  },
  {
    category: "Crypto",
    hashtags: ["#crypto"],
    phrases: [
      "bitcoin",
      "btc",
      "ethereum",
      "eth",
      "solana",
      "sol",
      "dogecoin",
      "doge",
      "xrp",
      "blockchain",
      "defi",
      "nft",
      "binance",
      "coinbase",
      "cardano",
      "polygon",
    ],
    custom: (normalized) =>
      hasWord(normalized, "whale") &&
      (hasWord(normalized, "buy") ||
        hasWord(normalized, "sell") ||
        hasWord(normalized, "alert")),
  },
  {
    category: "Sports",
    phrases: [
      "premier league",
      "champions league",
      "march madness",
      "world cup",
      "super bowl",
      "grand prix",
      "olympics",
      "lakers",
      "warriors",
      "celtics",
      "yankees",
      "dodgers",
      "cowboys",
      "chiefs",
      "eagles",
      "lebron james",
      "stephen curry",
      "lionel messi",
      "cristiano ronaldo",
      "shohei ohtani",
      "caitlin clark",
    ],
    anyWords: ["nba", "nfl", "nhl", "mlb", "ufc", "fifa", "mls", "f1"],
  },
  {
    category: "Finance",
    phrases: [
      "fed rate",
      "s&p 500",
      "dow jones",
      "nasdaq",
      "wall street",
      "interest rate",
      "ipo",
      "earnings",
      "gdp",
      "core pce",
      "cpi",
      "treasury",
      "recession",
      "inflation",
    ],
  },
  {
    category: "News",
    hashtags: ["#breaking"],
    phrases: ["breaking", "rip", "shooting", "evacuation", "wildfire", "hurricane"],
    custom: (normalized) =>
      hasWord(normalized, "earthquake") && !hasAnyWord(normalized, ["seismic", "geology", "tectonic"]),
  },
  {
    category: "Entertainment",
    phrases: [
      "netflix",
      "disney+",
      "hulu",
      "hbo",
      "spotify",
      "grammy",
      "oscar",
      "emmy",
      "tony",
      "billboard",
      "box office",
      "streaming",
      "album",
      "trailer",
    ],
  },
  {
    category: "Culture",
    hashtags: [
      "#fridayvibes",
      "#fursuitfriday",
      "#motivationmonday",
      "#mondaymotivation",
      "#throwbackthursday",
      "#tuesdaythoughts",
      "#wednesdaywisdom",
      "#thursdaythoughts",
      "#fridayfeeling",
      "#sundayfunday",
      "#selfcaresunday",
    ],
    phrases: ["beyonce", "taylor swift", "drake", "kendrick", "rihanna"],
  },
  {
    category: "Science",
    phrases: ["nasa", "spacex", "climate", "cern", "telescope", "mars", "asteroid"],
    custom: (normalized) =>
      hasWord(normalized, "earthquake") && hasAnyWord(normalized, ["seismic", "geology", "tectonic"]),
  },
  {
    category: "Games",
    phrases: [
      "wordle",
      "fortnite",
      "minecraft",
      "gta",
      "playstation",
      "xbox",
      "nintendo",
      "steam",
      "elden ring",
      "zelda",
    ],
  },
  {
    category: "Health",
    hashtags: ["#mentalhealth"],
    phrases: ["who", "cdc", "vaccine", "pandemic", "flu"],
    custom: (normalized) =>
      hasWord(normalized, "virus") && hasAnyWord(normalized, ["flu", "outbreak", "pandemic", "vaccine"]),
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase)}([^a-z0-9]|$)`, "i");
  return pattern.test(text);
}

function hasWord(text: string, word: string): boolean {
  return hasPhrase(text, word);
}

function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((word) => hasWord(text, word));
}

function extractHashtags(text: string): Set<string> {
  return new Set(text.match(/#[a-z0-9_]+/gi)?.map((tag) => tag.toLowerCase()) ?? []);
}

export function classifyTrend(trendName: string): TrendCategory | null {
  const normalized = trendName.toLowerCase();
  const hashtags = extractHashtags(trendName);

  for (const rule of CATEGORY_RULES) {
    if (rule.hashtags?.some((tag) => hashtags.has(tag))) {
      return rule.category;
    }
    if (rule.phrases?.some((phrase) => hasPhrase(normalized, phrase))) {
      return rule.category;
    }
    if (rule.anyWords?.some((word) => hasWord(normalized, word))) {
      return rule.category;
    }
    if (rule.allWords && rule.allWords.every((word) => hasWord(normalized, word))) {
      return rule.category;
    }
    if (rule.custom?.(normalized, hashtags)) {
      return rule.category;
    }
  }

  return null;
}

export const CATEGORY_COLORS: Record<TrendCategory | "Untagged", string> = {
  Tech: "#A78BFA",
  Politics: "#FB923C",
  Sports: "#34D399",
  Crypto: "#FBBF24",
  Culture: "#F472B6",
  Finance: "#60A5FA",
  News: "#EF4444",
  Entertainment: "#EC4899",
  Science: "#22D3EE",
  Games: "#A3E635",
  Health: "#6EE7B7",
  Untagged: "#9CA3AF",
};
