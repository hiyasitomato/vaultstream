import type { CustomGenreDef, VaultVideoItem, VideoUserMeta } from "./types";

export interface GenreRule {
  name: string;
  group: string;
  color: string;
  keywords: string[];
}

export const CATEGORY_TAG_SET = new Set(["現実", "アニメ", "漫画"]);

export interface GenreColorOption {
  id: string;
  label: string;
  classes: string;
  dot: string;
}

export const GENRE_COLOR_OPTIONS: GenreColorOption[] = [
  { id: "sky_deep", label: "スカイブルー", classes: "bg-sky-950/70 text-sky-200 border-sky-800/70 hover:bg-sky-900/70 hover:border-sky-700", dot: "bg-sky-400" },
  { id: "blue_deep", label: "ブルー", classes: "bg-blue-950/70 text-blue-200 border-blue-800/70 hover:bg-blue-900/70 hover:border-blue-700", dot: "bg-blue-400" },
  { id: "cobalt_deep", label: "コバルト", classes: "bg-blue-900/50 text-blue-100 border-blue-700/60 hover:bg-blue-900/75 hover:border-blue-600", dot: "bg-blue-500" },
  { id: "cyan_deep", label: "シアン", classes: "bg-cyan-950/70 text-cyan-200 border-cyan-800/70 hover:bg-cyan-900/70 hover:border-cyan-700", dot: "bg-cyan-400" },
  { id: "steel_deep", label: "スチールブルー", classes: "bg-slate-800/80 text-sky-200 border-slate-700 hover:bg-slate-800 hover:border-sky-700/70", dot: "bg-sky-300" },
  { id: "cerulean_deep", label: "セルリアン", classes: "bg-sky-900/45 text-cyan-100 border-sky-700/55 hover:bg-sky-900/70 hover:border-sky-600", dot: "bg-cyan-300" },
  { id: "indigo_deep", label: "インディゴ", classes: "bg-indigo-950/70 text-indigo-200 border-indigo-800/70 hover:bg-indigo-900/70 hover:border-indigo-700", dot: "bg-indigo-400" },
  { id: "royal_deep", label: "ロイヤルブルー", classes: "bg-indigo-900/45 text-indigo-100 border-indigo-700/60 hover:bg-indigo-900/70 hover:border-indigo-600", dot: "bg-indigo-300" },
  { id: "violet_deep", label: "バイオレット", classes: "bg-violet-950/70 text-violet-200 border-violet-800/70 hover:bg-violet-900/70 hover:border-violet-700", dot: "bg-violet-400" },
  { id: "purple_deep", label: "パープル", classes: "bg-purple-950/70 text-purple-200 border-purple-800/70 hover:bg-purple-900/70 hover:border-purple-700", dot: "bg-purple-400" },
  { id: "plum_deep", label: "プラム", classes: "bg-fuchsia-950/60 text-fuchsia-200 border-fuchsia-800/60 hover:bg-fuchsia-900/60 hover:border-fuchsia-700", dot: "bg-fuchsia-400" },
  { id: "teal_deep", label: "ティール", classes: "bg-teal-950/70 text-teal-200 border-teal-800/70 hover:bg-teal-900/70 hover:border-teal-700", dot: "bg-teal-400" },
  { id: "emerald_deep", label: "エメラルド", classes: "bg-emerald-950/70 text-emerald-200 border-emerald-800/70 hover:bg-emerald-900/70 hover:border-emerald-700", dot: "bg-emerald-400" },
  { id: "forest_deep", label: "フォレスト", classes: "bg-green-950/70 text-green-200 border-green-800/70 hover:bg-green-900/70 hover:border-green-700", dot: "bg-green-400" },
  { id: "olive_deep", label: "オリーブ", classes: "bg-lime-950/60 text-lime-200 border-lime-800/60 hover:bg-lime-900/60 hover:border-lime-700", dot: "bg-lime-400" },
  { id: "amber_deep", label: "アンバー", classes: "bg-amber-950/70 text-amber-200 border-amber-800/70 hover:bg-amber-900/70 hover:border-amber-700", dot: "bg-amber-400" },
  { id: "gold_deep", label: "ゴールド", classes: "bg-yellow-950/65 text-yellow-200 border-yellow-800/65 hover:bg-yellow-900/65 hover:border-yellow-700", dot: "bg-yellow-400" },
  { id: "copper_deep", label: "コッパー", classes: "bg-orange-950/70 text-orange-200 border-orange-800/70 hover:bg-orange-900/70 hover:border-orange-700", dot: "bg-orange-400" },
  { id: "bronze_deep", label: "ブロンズ", classes: "bg-stone-800/80 text-amber-200 border-stone-700 hover:bg-stone-800 hover:border-amber-700/70", dot: "bg-amber-300" },
  { id: "rose_deep", label: "ローズ", classes: "bg-rose-950/70 text-rose-200 border-rose-800/70 hover:bg-rose-900/70 hover:border-rose-700", dot: "bg-rose-400" },
  { id: "pink_deep", label: "モーヴピンク", classes: "bg-pink-950/65 text-pink-200 border-pink-800/65 hover:bg-pink-900/65 hover:border-pink-700", dot: "bg-pink-400" },
  { id: "crimson_deep", label: "クリムゾン", classes: "bg-red-950/70 text-red-200 border-red-800/70 hover:bg-red-900/70 hover:border-red-700", dot: "bg-red-400" },
  { id: "wine_deep", label: "ワイン", classes: "bg-rose-900/45 text-rose-100 border-rose-700/55 hover:bg-rose-900/70 hover:border-rose-600", dot: "bg-rose-300" },
  { id: "zinc_neutral", label: "モノクロ", classes: "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-700", dot: "bg-zinc-400" },
];

/**
 * 初期ジャンルは空（利用者が自分のライブラリに合わせて自由に作成）
 */
export const DEFAULT_CUSTOM_GENRES: CustomGenreDef[] = [];

export const GENRE_RULES: GenreRule[] = [];

export const DEFAULT_GENRE_STYLE =
  "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-700";

const EXPLICIT_COLOR_MAP = new Map<string, string>(
  GENRE_COLOR_OPTIONS.map((c) => [c.id, c.classes])
);

const STUDIO_BLUE_PALETTE = [
  "bg-[#0a2540]/85 text-[#7dd3fc] border-[#0369a1]/70 hover:bg-[#0c2d48]",
  "bg-[#0d2149]/85 text-[#93c5fd] border-[#1d4ed8]/65 hover:bg-[#10295a]",
  "bg-[#082f49]/85 text-[#bae6fd] border-[#0284c7]/70 hover:bg-[#0c3a59]",
  "bg-[#083344]/85 text-[#67e8f9] border-[#0891b2]/70 hover:bg-[#0b4257]",
  "bg-[#112240]/85 text-[#a5f3fc] border-[#2563eb]/60 hover:bg-[#172c52]",
  "bg-[#0f293a]/85 text-[#38bdf8] border-[#0e7490]/70 hover:bg-[#13344a]",
  "bg-[#172554]/85 text-[#60a5fa] border-[#3b82f6]/60 hover:bg-[#1e316b]",
  "bg-[#0c3547]/85 text-[#5eead4] border-[#0f766e]/65 hover:bg-[#10445b]",
  "bg-[#132a46]/85 text-[#bfdbfe] border-[#1e40af]/70 hover:bg-[#19375c]",
  "bg-[#092b3b]/85 text-[#22d3ee] border-[#155e75]/75 hover:bg-[#0d394e]",
  "bg-[#162742]/85 text-[#818cf8] border-[#3730a3]/65 hover:bg-[#1d3458]",
  "bg-[#0b2736]/85 text-[#99f6e4] border-[#115e59]/70 hover:bg-[#0f3447]",
  "bg-[#10203a]/85 text-[#7cc4fa] border-[#1d4ed8]/55 hover:bg-[#152b4d]",
  "bg-[#0a3642]/85 text-[#64dfdf] border-[#0d9488]/65 hover:bg-[#0e4656]",
  "bg-[#15243b]/85 text-[#90cdf4] border-[#2b6cb0]/70 hover:bg-[#1c304f]",
  "bg-[#0c2940]/85 text-[#a5b4fc] border-[#2563eb]/55 hover:bg-[#103654]",
];

const BRAND_INDIGO_PALETTE = [
  "bg-[#1e1b4b]/85 text-[#a5b4fc] border-[#4338ca]/70 hover:bg-[#26225e]",
  "bg-[#221a4d]/85 text-[#c4b5fd] border-[#5b21b6]/70 hover:bg-[#2b2161]",
  "bg-[#1a1f4c]/85 text-[#93c5fd] border-[#3730a3]/70 hover:bg-[#222861]",
  "bg-[#271b4a]/85 text-[#d8b4fe] border-[#6d28d9]/65 hover:bg-[#32235e]",
  "bg-[#192349]/85 text-[#818cf8] border-[#312e81]/75 hover:bg-[#212e5e]",
  "bg-[#2a1947]/85 text-[#e9d5ff] border-[#7e22ce]/60 hover:bg-[#36205b]",
  "bg-[#1d2647]/85 text-[#c7d2fe] border-[#4f46e5]/65 hover:bg-[#25315c]",
  "bg-[#251f42]/85 text-[#ddd6fe] border-[#6366f1]/60 hover:bg-[#302854]",
  "bg-[#171d42]/85 text-[#b4c6fc] border-[#3f3cbb]/70 hover:bg-[#1f2757]",
  "bg-[#2d1a4f]/85 text-[#c084fc] border-[#7c3aed]/65 hover:bg-[#3a2266]",
  "bg-[#1c213f]/85 text-[#9fa8da] border-[#3949ab]/70 hover:bg-[#252b52]",
  "bg-[#241845]/85 text-[#b39ddb] border-[#5e35b1]/70 hover:bg-[#2f1f59]",
  "bg-[#1b244d]/85 text-[#a3bffa] border-[#4c51bf]/70 hover:bg-[#232f63]",
  "bg-[#2b1d45]/85 text-[#d1c4e9] border-[#673ab7]/65 hover:bg-[#372559]",
];

const CREATOR_GOLD_PALETTE = [
  "bg-[#422006]/85 text-[#fcd34d] border-[#b45309]/70 hover:bg-[#542908]",
  "bg-[#3b2506]/85 text-[#fde047] border-[#a16207]/70 hover:bg-[#4d3008]",
  "bg-[#431407]/85 text-[#fdba74] border-[#c2410c]/70 hover:bg-[#571a09]",
  "bg-[#36260b]/85 text-[#fde68a] border-[#92400e]/70 hover:bg-[#47320f]",
  "bg-[#3d2108]/85 text-[#fbbf24] border-[#d97706]/65 hover:bg-[#4f2b0b]",
  "bg-[#381d0a]/85 text-[#fed7aa] border-[#9a3412]/70 hover:bg-[#4a260d]",
  "bg-[#332708]/85 text-[#fef08a] border-[#854d0e]/70 hover:bg-[#42330b]",
  "bg-[#451a03]/85 text-[#f59e0b] border-[#b45309]/65 hover:bg-[#592204]",
  "bg-[#35200d]/85 text-[#f6ad55] border-[#9c4221]/70 hover:bg-[#462a11]",
  "bg-[#2f240a]/85 text-[#facc15] border-[#a16207]/65 hover:bg-[#3e300d]",
  "bg-[#3f1c06]/85 text-[#fb923c] border-[#c2410c]/65 hover:bg-[#522408]",
  "bg-[#33210b]/85 text-[#ecc94b] border-[#975a16]/70 hover:bg-[#432c0f]",
  "bg-[#3a1e09]/85 text-[#fbd38d] border-[#b7791f]/70 hover:bg-[#4c270c]",
  "bg-[#2d230b]/85 text-[#fefcbf] border-[#744210]/75 hover:bg-[#3c2f0f]",
];

const GENERAL_GENRE_PALETTE = [
  "bg-[#4c0519]/85 text-[#fda4af] border-[#be123c]/70 hover:bg-[#610720]",
  "bg-[#2e1065]/85 text-[#c4b5fd] border-[#6d28d9]/70 hover:bg-[#3b1482]",
  "bg-[#022c22]/85 text-[#6ee7b7] border-[#047857]/70 hover:bg-[#033b2d]",
  "bg-[#500724]/85 text-[#f9a8d4] border-[#be185d]/70 hover:bg-[#66092e]",
  "bg-[#042f2e]/85 text-[#5eead4] border-[#0f766e]/70 hover:bg-[#053d3c]",
  "bg-[#431407]/85 text-[#fb923c] border-[#ea580c]/65 hover:bg-[#571a09]",
  "bg-[#450a0a]/85 text-[#fca5a5] border-[#b91c1c]/70 hover:bg-[#590d0d]",
  "bg-[#3b0764]/85 text-[#d8b4fe] border-[#7e22ce]/70 hover:bg-[#4b0980]",
  "bg-[#052e16]/85 text-[#86efac] border-[#15803d]/70 hover:bg-[#073d1d]",
  "bg-[#4a044e]/85 text-[#f0abfc] border-[#a21caf]/70 hover:bg-[#5e0563]",
  "bg-[#1a2e05]/85 text-[#bef264] border-[#4d7c0f]/70 hover:bg-[#223d07]",
  "bg-[#460a1e]/85 text-[#fb7185] border-[#e11d48]/65 hover:bg-[#5a0d27]",
  "bg-[#073634]/85 text-[#2dd4bf] border-[#0d9488]/65 hover:bg-[#094643]",
  "bg-[#311052]/85 text-[#e9d5ff] border-[#9333ea]/65 hover:bg-[#3f1469]",
  "bg-[#063327]/85 text-[#34d399] border-[#059669]/65 hover:bg-[#084233]",
  "bg-[#4a0b28]/85 text-[#f472b6] border-[#db2777]/65 hover:bg-[#5e0e33]",
  "bg-[#0a363c]/85 text-[#67e8f9] border-[#0e7490]/70 hover:bg-[#0d464e]",
  "bg-[#3b1a09]/85 text-[#fdba74] border-[#c2410c]/70 hover:bg-[#4d220c]",
  "bg-[#2a0e4a]/85 text-[#a78bfa] border-[#5b21b6]/75 hover:bg-[#371261]",
  "bg-[#0a331a]/85 text-[#4ade80] border-[#16a34a]/65 hover:bg-[#0d4222]",
  "bg-[#440c11]/85 text-[#f87171] border-[#dc2626]/65 hover:bg-[#571016]",
  "bg-[#3f092d]/85 text-[#f5d0fe] border-[#9d174d]/70 hover:bg-[#520c3a]",
  "bg-[#223308]/85 text-[#a3e635] border-[#65a30d]/65 hover:bg-[#2c420a]",
  "bg-[#360b47]/85 text-[#f0abfc] border-[#a21caf]/65 hover:bg-[#460e5c]",
  "bg-[#082f2b]/85 text-[#99f6e4] border-[#115e59]/75 hover:bg-[#0b3e39]",
  "bg-[#4c1018]/85 text-[#fecdd3] border-[#9f1239]/70 hover:bg-[#61141f]",
  "bg-[#26114d]/85 text-[#ddd6fe] border-[#7c3aed]/65 hover:bg-[#321663]",
  "bg-[#08302b]/85 text-[#a7f3d0] border-[#065f46]/75 hover:bg-[#0b3f38]",
  "bg-[#470d21]/85 text-[#fbcfe8] border-[#831843]/75 hover:bg-[#5c112b]",
  "bg-[#361c0a]/85 text-[#fed7aa] border-[#9a3412]/70 hover:bg-[#47250d]",
  "bg-[#0d3338]/85 text-[#81e6d9] border-[#285e61]/75 hover:bg-[#114248]",
  "bg-[#420d0d]/85 text-[#fecaca] border-[#991b1b]/70 hover:bg-[#541111]",
];

const ALL_UNIQUE_FALLBACK_PALETTE = [
  ...GENERAL_GENRE_PALETTE,
  ...STUDIO_BLUE_PALETTE,
  ...BRAND_INDIGO_PALETTE,
  ...CREATOR_GOLD_PALETTE,
];

function hashGenreIndex(name: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, modulo);
}

function getCategoryPaletteForGenre(genreName: string): string[] {
  if (genreName.startsWith("制作:")) return STUDIO_BLUE_PALETTE;
  if (genreName.startsWith("原作:")) return BRAND_INDIGO_PALETTE;
  if (genreName.startsWith("作者:")) return CREATOR_GOLD_PALETTE;
  return GENERAL_GENRE_PALETTE;
}

function pickUnusedStyle(genreName: string, primaryPalette: string[], used: Set<string>): string {
  const start = hashGenreIndex(genreName, primaryPalette.length);
  for (let step = 0; step < primaryPalette.length; step += 1) {
    const candidate = primaryPalette[(start + step) % primaryPalette.length];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallbackStart = hashGenreIndex(genreName, ALL_UNIQUE_FALLBACK_PALETTE.length);
  for (let step = 0; step < ALL_UNIQUE_FALLBACK_PALETTE.length; step += 1) {
    const candidate = ALL_UNIQUE_FALLBACK_PALETTE[(fallbackStart + step) % ALL_UNIQUE_FALLBACK_PALETTE.length];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = primaryPalette[start];
  used.add(fallback);
  return fallback;
}

const FIXED_SPECIAL_STYLES: Record<string, string> = {
  "現実": "bg-sky-950/85 text-sky-200 border-sky-700/80 hover:bg-sky-900/80",
  "アニメ": "bg-violet-950/85 text-violet-200 border-violet-700/80 hover:bg-violet-900/80",
  "漫画": "bg-amber-950/85 text-amber-200 border-amber-700/80 hover:bg-amber-900/80",
  "神回・お気に入り": "bg-[#4a2b07]/90 text-[#fde047] border-[#eab308]/75 hover:bg-[#5c3609]",
};

interface ResolvedPaletteCache {
  map: Map<string, string>;
  used: Set<string>;
}

const customGenresCache = new WeakMap<CustomGenreDef[], ResolvedPaletteCache>();
const fallbackGlobalMap = new Map<string, string>();
const fallbackGlobalUsed = new Set<string>(Object.values(FIXED_SPECIAL_STYLES));

function getResolvedPaletteCache(customGenres: CustomGenreDef[]): ResolvedPaletteCache {
  const cached = customGenresCache.get(customGenres);
  if (cached) return cached;

  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const [k, v] of Object.entries(FIXED_SPECIAL_STYLES)) {
    map.set(k, v);
    used.add(v);
  }

  for (const g of customGenres) {
    if (map.has(g.name)) continue;
    const explicit = g.color ? EXPLICIT_COLOR_MAP.get(g.color) : undefined;
    if (explicit && !used.has(explicit)) {
      map.set(g.name, explicit);
      used.add(explicit);
      continue;
    }
    const palette = getCategoryPaletteForGenre(g.name);
    map.set(g.name, pickUnusedStyle(g.name, palette, used));
  }

  const entry = { map, used };
  customGenresCache.set(customGenres, entry);
  return entry;
}

export function getGenreStyle(
  genreName: string,
  customGenres: CustomGenreDef[] = []
): string {
  if (FIXED_SPECIAL_STYLES[genreName]) {
    return FIXED_SPECIAL_STYLES[genreName];
  }

  if (customGenres.length > 0) {
    const cache = getResolvedPaletteCache(customGenres);
    const existing = cache.map.get(genreName);
    if (existing) return existing;
    const assigned = pickUnusedStyle(genreName, getCategoryPaletteForGenre(genreName), cache.used);
    cache.map.set(genreName, assigned);
    return assigned;
  }

  const globalExisting = fallbackGlobalMap.get(genreName);
  if (globalExisting) return globalExisting;
  const assigned = pickUnusedStyle(genreName, getCategoryPaletteForGenre(genreName), fallbackGlobalUsed);
  fallbackGlobalMap.set(genreName, assigned);
  return assigned;
}

export function extractAutoGenres(
  video: VaultVideoItem,
  allowedCustomGenres?: Set<string>
): string[] {
  const haystack = `${video.title} ${video.sourceFileName ?? ""}`.toLowerCase();
  const matched = new Set<string>();

  if (video.manifest?.genres) {
    for (const g of video.manifest.genres) {
      const trimmed = g.trim();
      if (
        trimmed &&
        (!allowedCustomGenres ||
          allowedCustomGenres.has(trimmed) ||
          CATEGORY_TAG_SET.has(trimmed))
      ) {
        matched.add(trimmed);
      }
    }
  }

  for (const rule of GENRE_RULES) {
    if (allowedCustomGenres && !allowedCustomGenres.has(rule.name)) {
      continue;
    }
    if (rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
      matched.add(rule.name);
    }
  }

  return Array.from(matched);
}

export function getEffectiveGenres(
  video: VaultVideoItem,
  userMeta: VideoUserMeta | undefined,
  useAutoGenres: boolean,
  customGenres?: CustomGenreDef[]
): string[] {
  const removed = new Set(userMeta?.removedGenres ?? []);
  const allowedSet =
    customGenres && customGenres.length > 0
      ? new Set(customGenres.map((g) => g.name))
      : undefined;
  const result = new Set<string>();

  if (useAutoGenres) {
    for (const g of extractAutoGenres(video, allowedSet)) {
      if (!removed.has(g)) {
        result.add(g);
      }
    }
  }

  for (const g of userMeta?.addedGenres ?? []) {
    const trimmed = g.trim();
    if (trimmed && !removed.has(trimmed)) {
      result.add(trimmed);
    }
  }

  return Array.from(result);
}

export function getContentGenresOnly(genres: string[]): string[] {
  return genres.filter((g) => !CATEGORY_TAG_SET.has(g));
}

export type GenreGroupId = "main" | "studio" | "creator" | "all";

export const GENRE_GROUP_TABS: Array<{ id: GenreGroupId; label: string }> = [
  { id: "main", label: "主要ジャンル" },
  { id: "studio", label: "制作・ブランド" },
  { id: "creator", label: "作者・クリエイター" },
  { id: "all", label: "すべて" },
];

export function isCreatorOrStudioGenre(genre: string): boolean {
  return genre.startsWith("制作:") || genre.startsWith("原作:") || genre.startsWith("作者:");
}

export function getGenreGroup(genre: string): GenreGroupId {
  if (genre.startsWith("制作:") || genre.startsWith("原作:")) return "studio";
  if (genre.startsWith("作者:")) return "creator";
  return "main";
}

export function matchesGenreGroup(genre: string, group: GenreGroupId): boolean {
  if (group === "all") return true;
  if (group === "main") return !isCreatorOrStudioGenre(genre);
  return getGenreGroup(genre) === group;
}

export function sortGenresForCard(genres: string[]): {
  content: string[];
  credits: string[];
} {
  const content: string[] = [];
  const creators: string[] = [];
  const brands: string[] = [];
  const studios: string[] = [];

  for (const g of genres) {
    if (CATEGORY_TAG_SET.has(g)) continue;
    if (g.startsWith("作者:")) {
      creators.push(g);
    } else if (g.startsWith("原作:")) {
      brands.push(g);
    } else if (g.startsWith("制作:")) {
      studios.push(g);
    } else if (g === "神回・お気に入り") {
      content.unshift(g);
    } else {
      content.push(g);
    }
  }

  return {
    content,
    credits: [...creators, ...brands, ...studios],
  };
}

export function extractSeriesBadge(title: string): string | null {
  const bracketMatch = title.match(/^[【\[『「]([^】\]』」]{2,18})[】\]』」]/);
  return bracketMatch ? bracketMatch[1].trim() : null;
}
