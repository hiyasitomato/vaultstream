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
  "bg-sky-950/70 text-sky-200 border-sky-800/70 hover:bg-sky-900/70 hover:border-sky-700",
  "bg-blue-950/70 text-blue-200 border-blue-800/70 hover:bg-blue-900/70 hover:border-blue-700",
  "bg-blue-900/50 text-blue-100 border-blue-700/60 hover:bg-blue-900/75 hover:border-blue-600",
  "bg-cyan-950/70 text-cyan-200 border-cyan-800/70 hover:bg-cyan-900/70 hover:border-cyan-700",
  "bg-slate-800/80 text-sky-200 border-slate-700 hover:bg-slate-800 hover:border-sky-700/70",
  "bg-sky-900/45 text-cyan-100 border-sky-700/55 hover:bg-sky-900/70 hover:border-sky-600",
];

const BRAND_INDIGO_PALETTE = [
  "bg-indigo-950/70 text-indigo-200 border-indigo-800/70 hover:bg-indigo-900/70 hover:border-indigo-700",
  "bg-indigo-900/45 text-indigo-100 border-indigo-700/60 hover:bg-indigo-900/70 hover:border-indigo-600",
  "bg-blue-950/65 text-indigo-200 border-blue-800/65 hover:bg-blue-900/65 hover:border-blue-700",
  "bg-slate-800/80 text-indigo-200 border-slate-700 hover:bg-slate-800 hover:border-indigo-700/70",
];

const CREATOR_GOLD_PALETTE = [
  "bg-amber-950/70 text-amber-200 border-amber-800/70 hover:bg-amber-900/70 hover:border-amber-700",
  "bg-yellow-950/65 text-yellow-200 border-yellow-800/65 hover:bg-yellow-900/65 hover:border-yellow-700",
  "bg-orange-950/65 text-amber-200 border-orange-800/65 hover:bg-orange-900/65 hover:border-orange-700",
  "bg-stone-800/80 text-amber-200 border-stone-700 hover:bg-stone-800 hover:border-amber-700/70",
];

function hashGenreIndex(name: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % Math.max(1, modulo);
}

export function getGenreStyle(
  genreName: string,
  customGenres: CustomGenreDef[] = []
): string {
  const custom = customGenres.find((g) => g.name === genreName);
  if (custom?.color && EXPLICIT_COLOR_MAP.has(custom.color)) {
    return EXPLICIT_COLOR_MAP.get(custom.color)!;
  }
  if (genreName === "現実") {
    return "bg-sky-950/75 text-sky-200 border-sky-800/75 hover:bg-sky-900/75";
  }
  if (genreName === "アニメ") {
    return "bg-violet-950/75 text-violet-200 border-violet-800/75 hover:bg-violet-900/75";
  }
  if (genreName === "漫画") {
    return "bg-amber-950/75 text-amber-200 border-amber-800/75 hover:bg-amber-900/75";
  }
  if (genreName === "神回・お気に入り") {
    return "bg-amber-950/80 text-amber-200 border-amber-700/70 hover:bg-amber-900/80";
  }
  if (genreName.startsWith("制作:")) {
    return STUDIO_BLUE_PALETTE[hashGenreIndex(genreName, STUDIO_BLUE_PALETTE.length)];
  }
  if (genreName.startsWith("原作:")) {
    return BRAND_INDIGO_PALETTE[hashGenreIndex(genreName, BRAND_INDIGO_PALETTE.length)];
  }
  if (genreName.startsWith("作者:")) {
    return CREATOR_GOLD_PALETTE[hashGenreIndex(genreName, CREATOR_GOLD_PALETTE.length)];
  }
  return GENRE_COLOR_OPTIONS[hashGenreIndex(genreName, GENRE_COLOR_OPTIONS.length - 1)].classes;
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
