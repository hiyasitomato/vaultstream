import type { CustomGenreDef, VaultVideoItem, VideoUserMeta } from "./types";

export interface GenreRule {
  name: string;
  group: string;
  color: string;
  keywords: string[];
}

export const CATEGORY_TAG_SET = new Set(["現実", "アニメ", "漫画"]);

const NEUTRAL_TAG_CLASSES =
  "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-700";

export const GENRE_COLOR_OPTIONS: Array<{
  id: string;
  label: string;
  classes: string;
  dot: string;
}> = [
  { id: "zinc", label: "モノクロ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "rose", label: "ローズ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "pink", label: "ピンク", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "fuchsia", label: "フューシャ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "purple", label: "パープル", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "indigo", label: "インディゴ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "sky", label: "スカイ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "cyan", label: "シアン", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "emerald", label: "エメラルド", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "amber", label: "アンバー", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "orange", label: "オレンジ", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
  { id: "red", label: "レッド", classes: NEUTRAL_TAG_CLASSES, dot: "bg-zinc-400" },
];

/**
 * 初期ジャンルは空（利用者が自分のライブラリに合わせて自由に作成）
 */
export const DEFAULT_CUSTOM_GENRES: CustomGenreDef[] = [];

export const GENRE_RULES: GenreRule[] = [];

export const DEFAULT_GENRE_STYLE =
  "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-700";

const CREATOR_GENRE_STYLE =
  "bg-zinc-900/60 text-zinc-400 border-zinc-800/80 hover:bg-zinc-800 hover:text-zinc-200";

export function getGenreStyle(
  genreName: string,
  _customGenres: CustomGenreDef[] = []
): string {
  void _customGenres;
  if (isCreatorOrStudioGenre(genreName)) {
    return CREATOR_GENRE_STYLE;
  }
  return DEFAULT_GENRE_STYLE;
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
