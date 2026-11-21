import type { CustomGenreDef, VaultVideoItem, VideoUserMeta } from "./types";

export interface GenreRule {
  name: string;
  group: string;
  color: string;
  keywords: string[];
}

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
 * 初期マイジャンル一覧（アニメジャンル）
 * ユーザーは画面から自由にリネーム・削除・新規追加できます。
 */
export const DEFAULT_CUSTOM_GENRES: CustomGenreDef[] = [
  { name: "バトル・アクション", color: "red" },
  { name: "異世界・ファンタジー", color: "emerald" },
  { name: "SF・ロボット", color: "cyan" },
  { name: "日常・癒やし", color: "amber" },
  { name: "恋愛・ラブコメ", color: "pink" },
  { name: "学園・青春", color: "sky" },
  { name: "コメディ・ギャグ", color: "orange" },
  { name: "ミステリー・サスペンス", color: "indigo" },
  { name: "ホラー・ダーク", color: "purple" },
  { name: "スポーツ", color: "emerald" },
  { name: "音楽・アイドル", color: "fuchsia" },
  { name: "ドラマ・感動", color: "rose" },
  { name: "歴史・時代劇", color: "amber" },
  { name: "劇場版・映画", color: "rose" },
  { name: "OVA・特別編", color: "indigo" },
  { name: "お気に入り・神回", color: "pink" },
];

/**
 * アニメ向けプリセット分類ルール（自動ジャンル分類ON時 & プリセット選択用）
 */
export const GENRE_RULES: GenreRule[] = [
  {
    name: "バトル・アクション",
    group: "王道・アクション",
    color: "bg-red-500/15 text-red-300 border-red-500/30",
    keywords: ["バトル", "アクション", "戦闘", "格闘", "剣", "冒険", "action", "battle"],
  },
  {
    name: "異世界・ファンタジー",
    group: "王道・アクション",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    keywords: ["異世界", "転生", "ファンタジー", "魔法", "魔王", "勇者", "fantasy", "isekai"],
  },
  {
    name: "SF・ロボット",
    group: "王道・アクション",
    color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    keywords: ["sf", "ロボット", "メカ", "宇宙", "サイバー", "未来", "mecha", "sci-fi"],
  },
  {
    name: "日常・癒やし",
    group: "日常・青春",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    keywords: ["日常", "癒やし", "ほのぼの", "スローライフ", "キャンプ", "slice of life"],
  },
  {
    name: "恋愛・ラブコメ",
    group: "日常・青春",
    color: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    keywords: ["恋愛", "ラブコメ", "恋", "青春", "romance", "romcom"],
  },
  {
    name: "学園・青春",
    group: "日常・青春",
    color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    keywords: ["学園", "学校", "部活", "高校", "青春", "school"],
  },
  {
    name: "コメディ・ギャグ",
    group: "日常・青春",
    color: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    keywords: ["コメディ", "ギャグ", "パロディ", "爆笑", "comedy"],
  },
  {
    name: "ミステリー・サスペンス",
    group: "シリアス・頭脳戦",
    color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    keywords: ["ミステリー", "推理", "探偵", "サスペンス", "心理戦", "謎", "mystery", "thriller"],
  },
  {
    name: "ホラー・ダーク",
    group: "シリアス・頭脳戦",
    color: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    keywords: ["ホラー", "ダーク", "怪異", "妖怪", "オカルト", "horror", "dark"],
  },
  {
    name: "ドラマ・感動",
    group: "シリアス・頭脳戦",
    color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    keywords: ["ドラマ", "感動", "泣ける", "人間ドラマ", "drama"],
  },
  {
    name: "スポーツ",
    group: "テーマ別",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    keywords: ["スポーツ", "野球", "サッカー", "バスケ", "バレー", "テニス", "sports"],
  },
  {
    name: "音楽・アイドル",
    group: "テーマ別",
    color: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    keywords: ["音楽", "バンド", "ライブ", "アイドル", "吹奏楽", "music", "idol"],
  },
  {
    name: "歴史・時代劇",
    group: "テーマ別",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    keywords: ["歴史", "戦国", "幕末", "時代劇", "侍", "和風", "historical"],
  },
  {
    name: "劇場版・映画",
    group: "フォーマット",
    color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    keywords: ["劇場版", "映画", "movie", "film"],
  },
  {
    name: "OVA・特別編",
    group: "フォーマット",
    color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    keywords: ["ova", "oad", "特別編", "総集編", "sp", "special"],
  },
  {
    name: "お気に入り・神回",
    group: "コレクション",
    color: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    keywords: ["神回", "名シーン", "お気に入り", "op", "ed"],
  },
];

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

export function extractAutoGenres(video: VaultVideoItem): string[] {
  const haystack = `${video.title} ${video.sourceFileName ?? ""}`.toLowerCase();
  const matched = new Set<string>();

  if (video.manifest?.genres) {
    for (const g of video.manifest.genres) {
      if (g.trim()) matched.add(g.trim());
    }
  }

  for (const rule of GENRE_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
      matched.add(rule.name);
    }
  }

  if ((video.height ?? 0) >= 1080) {
    matched.add("高画質 (Full HD+)");
  }
  if (video.duration >= 3600) {
    matched.add("劇場版・映画");
  }

  return Array.from(matched);
}

export function getEffectiveGenres(
  video: VaultVideoItem,
  userMeta: VideoUserMeta | undefined,
  useAutoGenres: boolean
): string[] {
  const removed = new Set(userMeta?.removedGenres ?? []);
  const result = new Set<string>();

  if (useAutoGenres) {
    for (const g of extractAutoGenres(video)) {
      if (!removed.has(g)) {
        result.add(g);
      }
    }
  }

  for (const g of userMeta?.addedGenres ?? []) {
    if (g.trim()) {
      result.add(g.trim());
    }
  }

  return Array.from(result);
}

export function extractSeriesBadge(title: string): string | null {
  const bracketMatch = title.match(/^[【\[『「]([^】\]』」]{2,18})[】\]』」]/);
  return bracketMatch ? bracketMatch[1].trim() : null;
}
