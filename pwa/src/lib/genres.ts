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
 * 汎用動画ライブラリ向けプリセット自動分類ルール
 * 自分のコレクションに合わせてキーワードを自由にカスタマイズできます。
 */
export const GENRE_RULES: GenreRule[] = [
  {
    name: "Vlog・日常",
    group: "ライフスタイル",
    color: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    keywords: ["vlog", "日常", "ルーティン", "diary", "日記", "ライフ"],
  },
  {
    name: "旅行・お出かけ",
    group: "ライフスタイル",
    color: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    keywords: ["旅行", "旅", "trip", "travel", "ドライブ", "キャンプ", "観光", "温泉"],
  },
  {
    name: "家族・イベント",
    group: "ライフスタイル",
    color: "bg-pink-500/15 text-pink-300 border-pink-500/30",
    keywords: ["家族", "運動会", "誕生日", "結婚式", "記念", "ホームビデオ", "family"],
  },
  {
    name: "ペット・動物",
    group: "ライフスタイル",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    keywords: ["猫", "犬", "ペット", "動物", "cat", "dog", "pet"],
  },
  {
    name: "学習・チュートリアル",
    group: "知識・仕事",
    color: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    keywords: ["講座", "解説", "チュートリアル", "勉強", "授業", "セミナー", "tutorial", "course", "講義"],
  },
  {
    name: "会議・アーカイブ",
    group: "知識・仕事",
    color: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    keywords: ["会議", "ミーティング", "録画", "アーカイブ", "zoom", "archive", "record"],
  },
  {
    name: "音楽・ライブ",
    group: "エンタメ",
    color: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    keywords: ["live", "ライブ", "音楽", "演奏", "mv", "コンサート", "piano", "guitar"],
  },
  {
    name: "ゲーム・配信",
    group: "エンタメ",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    keywords: ["ゲーム", "実況", "配信", "プレイ", "game", "stream", "play"],
  },
  {
    name: "撮影素材・B-Roll",
    group: "クリエイティブ",
    color: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    keywords: ["素材", "b-roll", "broll", "drone", "ドローン", "raw", "timelapse", "タイムラプス"],
  },
  {
    name: "高画質 (Full HD+)",
    group: "スペック",
    color: "bg-teal-500/15 text-teal-300 border-teal-500/30",
    keywords: ["高画質", "4k", "1080p", "fullhd", "fhd", "uhd"],
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
  if (video.duration >= 1200) {
    matched.add("長編 (20分+)");
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
