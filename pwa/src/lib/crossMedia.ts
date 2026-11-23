import { CATEGORY_TAG_SET, extractSeriesBadge, getContentGenresOnly } from "./genres";
import type { VaultVideoItem } from "./types";

export interface CrossMediaSet {
  manga: VaultVideoItem;
  videos: VaultVideoItem[];
  score: number;
}

export interface CrossMediaIndex {
  linkedById: Record<string, VaultVideoItem[]>;
  sets: CrossMediaSet[];
}

export interface SeriesAndRelatedResult {
  seriesVideos: VaultVideoItem[];
  relatedVideos: VaultVideoItem[];
}

function toHiragana(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60);
    } else {
      out += input[i];
    }
  }
  return out;
}

const GENERIC_NOISE_RE =
  /(the\s*animation|ova|oav|vol\.?\s*\d+|第\s*\d+\s*[話巻部章弾幕回]|#\d+|\b\d+話|\bep\.?\s*\d+|前編|後編|上巻|中巻|下巻|総集編|完全版|無修正|無修整|修正版|特別版|ディレクターズカット|hd|fhd|4k|1080p|720p|480p|libplacebo|anime|comic|manga|アニメ|コミック|漫画|同人誌)/gi;

export function normalizeCrossMediaTitle(title: string): string {
  let s = title.normalize("NFKC").toLowerCase();
  // Strip common file extensions
  s = s.replace(/\.(mp4|mkv|webm|mov|avi|m4v|ts|libplacebo)+$/gi, "");
  // Strip bracketed author/circle/release metadata while preserving main title text
  s = s.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|（[^）]*）/g, " ");
  // Strip generic anime/manga release words so unrelated titles never match on boilerplate
  s = s.replace(GENERIC_NOISE_RE, " ");
  s = toHiragana(s);
  // Strip spaces, digits, and punctuation
  s = s.replace(/[\s\d_\-・〜～!！?？♥♡★☆♪♫.,、。:：;；/／\\~`'"＋+=＝「」『』]+/g, "");
  return s;
}

function longestCommonSubstringLen(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  const n = a.length;
  const m = b.length;
  // Compact 1D DP for O(n*m) time and O(m) memory (titles are short, ~5-40 chars)
  const prev = new Uint16Array(m + 1);
  const curr = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i += 1) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j += 1) {
      if (ca === b.charCodeAt(j - 1)) {
        const val = prev[j - 1] + 1;
        curr[j] = val;
        if (val > best) best = val;
      } else {
        curr[j] = 0;
      }
    }
    prev.set(curr);
  }
  return best;
}

export function computeCrossMediaScore(normA: string, normB: string): number {
  if (!normA || !normB) return 0;
  if (normA === normB && normA.length >= 3) return 100;

  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  if (shorter.length >= 4 && longer.includes(shorter)) {
    return 90;
  }

  const lcs = longestCommonSubstringLen(normA, normB);
  const minLen = shorter.length;
  if (lcs >= 7) {
    return 85;
  }
  if (lcs >= 5 && minLen > 0 && lcs / minLen >= 0.6) {
    return Math.round(60 + (lcs / minLen) * 25);
  }
  return 0;
}

function naturalTitleCompare(a: string, b: string): number {
  return a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" });
}

export function buildCrossMediaIndex(items: VaultVideoItem[]): CrossMediaIndex {
  const mangas = items.filter((it) => it.kind === "manga");
  const videos = items.filter((it) => it.kind !== "manga");

  const linkedById: Record<string, VaultVideoItem[]> = {};
  const sets: CrossMediaSet[] = [];

  if (mangas.length === 0 || videos.length === 0) {
    return { linkedById, sets };
  }

  const normVideos = videos.map((v) => ({
    item: v,
    norm: normalizeCrossMediaTitle(v.title),
  }));

  const videoMatchesMap = new Map<string, Array<{ manga: VaultVideoItem; score: number }>>();

  for (const manga of mangas) {
    const normM = normalizeCrossMediaTitle(manga.title);
    if (normM.length < 3) continue;

    const matchedVideos: Array<{ video: VaultVideoItem; score: number }> = [];
    for (const nv of normVideos) {
      if (nv.norm.length < 3) continue;
      const sc = computeCrossMediaScore(normM, nv.norm);
      if (sc > 0) {
        matchedVideos.push({ video: nv.item, score: sc });
        const list = videoMatchesMap.get(nv.item.id) ?? [];
        list.push({ manga, score: sc });
        videoMatchesMap.set(nv.item.id, list);
      }
    }

    if (matchedVideos.length > 0) {
      matchedVideos.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return naturalTitleCompare(a.video.title, b.video.title);
      });
      // Sort episodes naturally if scores are similar (e.g. Ep 1, Ep 2, Ep 3...)
      const maxScore = matchedVideos[0].score;
      const topVideos = matchedVideos
        .map((m) => m.video)
        .sort((a, b) => naturalTitleCompare(a.title, b.title));
      linkedById[manga.id] = topVideos;
      sets.push({
        manga,
        videos: topVideos,
        score: maxScore,
      });
    }
  }

  for (const [videoId, matches] of videoMatchesMap.entries()) {
    matches.sort((a, b) => b.score - a.score || naturalTitleCompare(a.manga.title, b.manga.title));
    linkedById[videoId] = matches.map((m) => m.manga);
  }

  sets.sort((a, b) => b.score - a.score || naturalTitleCompare(a.manga.title, b.manga.title));
  return { linkedById, sets };
}

function quickStableHash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface RelatedWorkRecommendation {
  item: VaultVideoItem;
  sharedCredits: string[];
}

function scoreRelatedCandidate(
  activeItem: VaultVideoItem,
  cand: VaultVideoItem,
  activeCategories: Set<string>,
  activeContentGenres: Set<string>,
  candGenres: string[]
): { score: number; sharedCredits: string[] } {
  let score = 0;
  const sharedCredits: string[] = [];

  if (candGenres.some((g) => activeCategories.has(g))) {
    score += 10;
  }

  for (const g of getContentGenresOnly(candGenres)) {
    if (!activeContentGenres.has(g)) continue;
    if (g.startsWith("作者:")) {
      score += 45;
      sharedCredits.push(g);
    } else if (g.startsWith("原作:")) {
      score += 35;
      sharedCredits.push(g);
    } else if (g.startsWith("制作:")) {
      score += 30;
      sharedCredits.push(g);
    } else {
      score += 5;
    }
  }

  const tie = (quickStableHash(`${activeItem.id}:${cand.id}`) % 1000) / 10000;
  return { score: score + tie, sharedCredits };
}

export function findSeriesAndRelatedVideos(
  activeVideo: VaultVideoItem,
  allVideos: VaultVideoItem[],
  videoGenresMap: Record<string, string[]>,
  relatedLimit = 12,
  progressMap?: Record<string, { currentTime: number; duration: number; updatedAt: number }>,
  userMetaMap?: Record<string, { favorite?: boolean }>
): SeriesAndRelatedResult {
  const videoCandidates = allVideos.filter(
    (v) => v.id !== activeVideo.id && v.kind !== "manga"
  );
  if (allVideos.length <= 1) {
    return { seriesVideos: [], relatedVideos: [] };
  }

  const normActive = normalizeCrossMediaTitle(activeVideo.title);
  const badgeActive = extractSeriesBadge(activeVideo.title);

  const seriesMatches: VaultVideoItem[] = [];
  const seriesIdSet = new Set<string>();

  for (const cand of videoCandidates) {
    const normCand = normalizeCrossMediaTitle(cand.title);
    const badgeCand = extractSeriesBadge(cand.title);
    const sameBadge = Boolean(
      badgeActive && badgeCand && badgeActive.length >= 3 && badgeActive === badgeCand
    );
    const exactShortSeries = Boolean(
      normActive.length >= 2 && normActive === normCand
    );
    const titleScore =
      normActive.length >= 3 && normCand.length >= 3
        ? computeCrossMediaScore(normActive, normCand)
        : 0;

    if (sameBadge || exactShortSeries || titleScore >= 75) {
      seriesMatches.push(cand);
      seriesIdSet.add(cand.id);
    }
  }

  seriesMatches.sort((a, b) => naturalTitleCompare(a.title, b.title));

  // YouTube Watch-Page Up-Next ranking:
  // Combines studio/brand/creator affinity, multi-tag similarity, unwatched freshness, and favorite affinity.
  const activeAllGenres = videoGenresMap[activeVideo.id] ?? [];
  const activeCategories = new Set(activeAllGenres.filter((g) => CATEGORY_TAG_SET.has(g)));
  const activeContentGenres = new Set(getContentGenresOnly(activeAllGenres));

  // Build user favorite-genre affinity profile (YouTube long-term session affinity)
  const favGenreAffinity = new Set<string>();
  if (userMetaMap) {
    for (const [vidId, meta] of Object.entries(userMetaMap)) {
      if (meta?.favorite) {
        for (const g of getContentGenresOnly(videoGenresMap[vidId] ?? [])) {
          favGenreAffinity.add(g);
        }
      }
    }
  }

  const scoredRelated = allVideos
    .filter((v) => v.id !== activeVideo.id && !seriesIdSet.has(v.id))
    .map((v) => {
      const gAll = videoGenresMap[v.id] ?? [];
      const { score: baseScore, sharedCredits } = scoreRelatedCandidate(
        activeVideo,
        v,
        activeCategories,
        activeContentGenres,
        gAll
      );
      let ytScore = baseScore;

      // Favorite-genre long-term affinity boost
      if (favGenreAffinity.size > 0) {
        let favHits = 0;
        for (const g of getContentGenresOnly(gAll)) {
          if (favGenreAffinity.has(g)) favHits += 1;
        }
        ytScore += Math.min(12, favHits * 3);
      }

      // Freshness / watch-completion adjustment (YouTube avoids already-finished items)
      const prog = progressMap?.[v.id];
      if (!prog || prog.currentTime <= 5) {
        ytScore += 8; // Unwatched discovery boost
      } else if (prog.duration > 0 && prog.currentTime / prog.duration >= 0.9) {
        ytScore -= 12; // Already completed
      }

      // Include manga in video recommendations when they share studio/brand/creator
      const allowed = v.kind !== "manga" || sharedCredits.length > 0;
      return { video: v, score: ytScore, allowed };
    })
    .filter((entry) => entry.allowed)
    .sort((a, b) => b.score - a.score)
    .slice(0, relatedLimit)
    .map((entry) => entry.video);

  return {
    seriesVideos: seriesMatches,
    relatedVideos: scoredRelated,
  };
}

export function findRelatedWorks(
  activeItem: VaultVideoItem,
  allVideos: VaultVideoItem[],
  videoGenresMap: Record<string, string[]>,
  limit = 8,
  excludeIds?: Set<string>
): RelatedWorkRecommendation[] {
  const activeAllGenres = videoGenresMap[activeItem.id] ?? [];
  const activeCategories = new Set(activeAllGenres.filter((g) => CATEGORY_TAG_SET.has(g)));
  const activeContentGenres = new Set(getContentGenresOnly(activeAllGenres));

  return allVideos
    .filter((v) => v.id !== activeItem.id && !excludeIds?.has(v.id))
    .map((v) => {
      const gAll = videoGenresMap[v.id] ?? [];
      const { score, sharedCredits } = scoreRelatedCandidate(
        activeItem,
        v,
        activeCategories,
        activeContentGenres,
        gAll
      );
      return { item: v, sharedCredits, score };
    })
    .filter((entry) => entry.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, sharedCredits }) => ({ item, sharedCredits }));
}

export function findSeriesManga(
  activeManga: VaultVideoItem,
  allVideos: VaultVideoItem[]
): VaultVideoItem[] {
  const candidates = allVideos.filter(
    (v) => v.id !== activeManga.id && v.kind === "manga"
  );
  if (candidates.length === 0) return [activeManga];

  const normActive = normalizeCrossMediaTitle(activeManga.title);
  const badgeActive = extractSeriesBadge(activeManga.title);

  const matches: VaultVideoItem[] = [activeManga];
  for (const cand of candidates) {
    const normCand = normalizeCrossMediaTitle(cand.title);
    const badgeCand = extractSeriesBadge(cand.title);
    const sameBadge = Boolean(
      badgeActive && badgeCand && badgeActive.length >= 3 && badgeActive === badgeCand
    );
    const exactShortSeries = Boolean(
      normActive.length >= 2 && normActive === normCand
    );
    const titleScore =
      normActive.length >= 3 && normCand.length >= 3
        ? computeCrossMediaScore(normActive, normCand)
        : 0;

    if (sameBadge || exactShortSeries || titleScore >= 75) {
      matches.push(cand);
    }
  }

  matches.sort((a, b) => naturalTitleCompare(a.title, b.title));
  return matches;
}
