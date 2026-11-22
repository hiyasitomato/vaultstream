import type { CustomGenreDef, VaultVideoItem, VideoUserMeta } from "./types";

export interface GenreRule {
  name: string;
  group: string;
  color: string;
  keywords: string[];
}

export const CATEGORY_TAG_SET = new Set(["現実", "アニメ", "漫画"]);

export const GENRE_COLOR_OPTIONS: Array<{
  id: string;
  label: string;
  classes: string;
  dot: string;
}> = [
  { id: "rose", label: "ローズ", classes: "bg-rose-500/15 text-rose-300 border-rose-500/35", dot: "bg-rose-500" },
  { id: "pink", label: "ピンク", classes: "bg-pink-500/15 text-pink-300 border-pink-500/35", dot: "bg-pink-500" },
  { id: "fuchsia", label: "フューシャ", classes: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/35", dot: "bg-fuchsia-500" },
  { id: "purple", label: "パープル", classes: "bg-purple-500/15 text-purple-300 border-purple-500/35", dot: "bg-purple-500" },
  { id: "indigo", label: "インディゴ", classes: "bg-indigo-500/15 text-indigo-300 border-indigo-500/35", dot: "bg-indigo-500" },
  { id: "sky", label: "スカイ", classes: "bg-sky-500/15 text-sky-300 border-sky-500/35", dot: "bg-sky-500" },
  { id: "cyan", label: "シアン", classes: "bg-cyan-500/15 text-cyan-300 border-cyan-500/35", dot: "bg-cyan-500" },
  { id: "emerald", label: "エメラルド", classes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/35", dot: "bg-emerald-500" },
  { id: "amber", label: "アンバー", classes: "bg-amber-500/15 text-amber-300 border-amber-500/35", dot: "bg-amber-500" },
  { id: "orange", label: "オレンジ", classes: "bg-orange-500/15 text-orange-300 border-orange-500/35", dot: "bg-orange-500" },
  { id: "red", label: "レッド", classes: "bg-red-500/15 text-red-300 border-red-500/35", dot: "bg-red-500" },
];

/**
 * 初期ジャンルは空（利用者が自分のライブラリに合わせて自由に作成）
 */
export const DEFAULT_CUSTOM_GENRES: CustomGenreDef[] = [];

export const GENRE_RULES: GenreRule[] = [];

export const DEFAULT_GENRE_STYLE =
  "bg-zinc-800/90 text-zinc-200 border-zinc-700/80";

export function getGenreStyle(
  genreName: string,
  customGenres: CustomGenreDef[] = []
): string {
  const custom = customGenres.find((g) => g.name === genreName);
  if (custom) {
    const colorObj = GENRE_COLOR_OPTIONS.find((c) => c.id === custom.color);
    if (colorObj) return colorObj.classes;
  }
  const found = GENRE_RULES.find((r) => r.name === genreName);
  return found?.color ?? DEFAULT_GENRE_STYLE;
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

export function extractSeriesBadge(title: string): string | null {
  const bracketMatch = title.match(/^[【\[『「]([^】\]』」]{2,18})[】\]』」]/);
  return bracketMatch ? bracketMatch[1].trim() : null;
}
