"use client";

import { memo, useEffect, useRef, useState } from "react";
import { BookOpen, Camera, Check, Film, Heart, ListChecks, ListPlus, Play, Plus, Sparkles, Tag } from "lucide-react";
import {
  driveFetchCachedThumbnailUrl,
  driveFetchMangaPageUrl,
  formatBytes,
  formatDuration,
  getCachedSpriteGrid,
  getSegmentUrlForTime,
  getSyncCachedThumbnailUrl,
  prefetchHlsPlaylist,
  prewarmVideoForInstantPlay,
  setCachedSpriteGrid,
} from "@/lib/drive";
import { extractSeriesBadge, getGenreStyle, sortGenresForCard } from "@/lib/genres";
import { prefetchSegmentUrl } from "@/lib/segmentCache";
import type { CustomGenreDef, PlaybackProgress, VaultVideoItem } from "@/lib/types";

const CARD_DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  month: "short",
  day: "numeric",
});

interface VideoCardProps {
  video: VaultVideoItem;
  accessToken: string;
  masterKey: CryptoKey | null;
  genres: string[];
  customGenres: CustomGenreDef[];
  isFavorite: boolean;
  isInQueue?: boolean;
  progress?: PlaybackProgress;
  thumbnailTimeSec?: number;
  thumbVersion?: number;
  compact?: boolean;
  portraitCover?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  linkedItems?: VaultVideoItem[];
  onOpenCrossMediaSet?: (manga: VaultVideoItem, video: VaultVideoItem) => void;
  onToggleSelect?: (videoId: string) => void;
  onSelect: (video: VaultVideoItem, startTimeSec?: number) => void;
  onAddToQueue: (video: VaultVideoItem) => void;
  onToggleFavorite: (videoId: string) => void;
  onEditTags: (video: VaultVideoItem) => void;
  onClickGenre: (genre: string) => void;
}

function VideoCard({
  video,
  accessToken,
  masterKey,
  genres,
  customGenres,
  isFavorite,
  isInQueue = false,
  progress,
  thumbnailTimeSec,
  thumbVersion = 0,
  compact = false,
  portraitCover = false,
  selectionMode = false,
  isSelected = false,
  linkedItems,
  onOpenCrossMediaSet,
  onToggleSelect,
  onSelect,
  onAddToQueue,
  onToggleFavorite,
  onEditTags,
  onClickGenre,
}: VideoCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inView, setInView] = useState(() =>
    Boolean(
      getSyncCachedThumbnailUrl(
        video.thumbnailFileId,
        Boolean(video.encrypted),
        video.thumbnailModifiedTime
      )
    )
  );
  const [isVisibleNow, setIsVisibleNow] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(() =>
    getSyncCachedThumbnailUrl(
      video.thumbnailFileId,
      Boolean(video.encrypted),
      video.thumbnailModifiedTime
    )
  );
  const [spriteUrl, setSpriteUrl] = useState<string | null>(() =>
    getSyncCachedThumbnailUrl(video.spriteFileId, Boolean(video.encrypted))
  );
  const [spriteGrid, setSpriteGrid] = useState<{ cols: number; rows: number }>({
    cols: 6,
    rows: 6,
  });
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  useEffect(() => {
    if (!spriteUrl) return;
    const cachedGrid = getCachedSpriteGrid(spriteUrl);
    if (cachedGrid) {
      setSpriteGrid(cachedGrid);
      return;
    }
    if (typeof Image === "undefined") return;
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (!active || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
      const cols = Math.max(1, Math.round(img.naturalWidth / 160));
      const rows = Math.max(1, Math.round(img.naturalHeight / 90));
      if (cols >= 4 && rows >= 4 && cols <= 16 && rows <= 16) {
        const nextGrid = { cols, rows };
        setCachedSpriteGrid(spriteUrl, nextGrid);
        setSpriteGrid(nextGrid);
      }
    };
    img.src = spriteUrl;
    return () => {
      active = false;
    };
  }, [spriteUrl]);

  useEffect(() => {
    return () => {
      if (hoverPrefetchTimerRef.current) {
        clearTimeout(hoverPrefetchTimerRef.current);
        hoverPrefetchTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      setIsVisibleNow(true);
      return;
    }
    // Wide 1400px swipe-ahead margin so fast mobile/PC swiping hits pre-loaded thumbnails
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          preloadObserver.disconnect();
        }
      },
      { rootMargin: "1400px 400px" }
    );
    // Strict viewport check so currently visible cards jump to HIGH LIFO priority
    const visibleObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisibleNow(true);
          setInView(true);
          visibleObserver.disconnect();
        }
      },
      { rootMargin: "100px" }
    );
    preloadObserver.observe(el);
    visibleObserver.observe(el);
    return () => {
      preloadObserver.disconnect();
      visibleObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!video.thumbnailFileId) {
      setThumbUrl(null);
      return;
    }

    const syncHit = getSyncCachedThumbnailUrl(
      video.thumbnailFileId,
      Boolean(video.encrypted),
      video.thumbnailModifiedTime
    );
    if (syncHit) {
      setThumbUrl(syncHit);
      return;
    }
    if (!inView) return;

    driveFetchCachedThumbnailUrl(
      video.thumbnailFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey,
      video.thumbnailModifiedTime,
      isVisibleNow ? "high" : "normal"
    )
      .then((url) => {
        if (active) setThumbUrl(url);
      })
      .catch(() => {
        if (active) setThumbUrl(null);
      });

    return () => {
      active = false;
    };
  }, [
    inView,
    isVisibleNow,
    video.thumbnailFileId,
    video.thumbnailModifiedTime,
    video.encrypted,
    accessToken,
    masterKey,
    thumbVersion,
  ]);

  const progressRatio =
    progress && progress.duration > 0
      ? Math.min(100, Math.max(0, (progress.currentTime / progress.duration) * 100))
      : 0;

  const isManga = video.kind === "manga";
  const needsAmbientBlur =
    isManga ||
    (Boolean(video.width && video.height) &&
      Math.abs((video.width ?? 16) / Math.max(1, video.height ?? 9) - 16 / 9) > 0.22);
  const pageCount = video.pageCount ?? video.manifest?.pageCount ?? video.manifest?.pages?.length ?? 0;

  const seriesBadge = extractSeriesBadge(video.title);
  const qualityBadge =
    (video.height ?? 0) >= 2160
      ? "4K"
      : (video.height ?? 0) >= 1080
        ? "FHD"
        : (video.height ?? 0) >= 720
          ? "HD"
          : null;

  const createdLabel = (() => {
    try {
      const d = new Date(video.createdAt);
      return Number.isNaN(d.getTime()) ? "" : CARD_DATE_FORMATTER.format(d);
    } catch {
      return "";
    }
  })();

  const getResumeSec = () =>
    progress &&
    progress.currentTime > 3 &&
    (progress.duration <= 0 || progress.currentTime < progress.duration - 5)
      ? progress.currentTime
      : 0;

  const handlePrimaryClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(video.id);
    } else {
      onSelect(video);
    }
  };

  const ensureSpriteLoaded = (priority: "high" | "normal" = "high") => {
    if (!video.spriteFileId || spriteUrl) return;
    const syncHit = getSyncCachedThumbnailUrl(video.spriteFileId, Boolean(video.encrypted));
    if (syncHit) {
      setSpriteUrl(syncHit);
      return;
    }
    driveFetchCachedThumbnailUrl(
      video.spriteFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey,
      undefined,
      priority
    )
      .then((url) => setSpriteUrl(url))
      .catch(() => undefined);
  };

  const handleThumbPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Only scrub storyboard sprite on real desktop mouse hover — never on touch swipes!
    if (e.pointerType !== "mouse" || selectionMode || !video.spriteFileId) return;
    ensureSpriteLoaded();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width));
    setScrubRatio(ratio);
  };

  const spriteTotalFrames = spriteGrid.cols * spriteGrid.rows;
  const spriteFrameIndex =
    scrubRatio !== null
      ? Math.min(spriteTotalFrames - 1, Math.max(0, Math.round(scrubRatio * spriteTotalFrames)))
      : -1;
  const spriteCol = spriteFrameIndex >= 0 ? spriteFrameIndex % spriteGrid.cols : 0;
  const spriteRow = spriteFrameIndex >= 0 ? Math.floor(spriteFrameIndex / spriteGrid.cols) : 0;
  const showingScrubSprite = scrubRatio !== null && Boolean(spriteUrl);

  // Default packer thumbnail timestamp if user hasn't picked a custom frame yet
  const effectiveThumbTimeSec =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec)
      ? thumbnailTimeSec
      : video.duration > 2
        ? Math.min(Math.max(video.duration * 0.1, 1), 15)
        : 0;
  const isCustomThumbTime =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec);

  return (
    <div
      ref={cardRef}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        if (video.kind === "manga") {
          const pages = video.manifest?.pages ?? [];
          if (pages.length > 0) {
            hoverPrefetchTimerRef.current = setTimeout(() => {
              for (const p of pages.slice(0, 3)) {
                driveFetchMangaPageUrl(
                  p.fileId,
                  accessToken,
                  Boolean(video.encrypted),
                  masterKey,
                  p.mimeType || "image/jpeg",
                  "low"
                ).catch(() => undefined);
              }
            }, 150);
          }
          return;
        }
        if (video.manifest) {
          prefetchHlsPlaylist(video.manifest, accessToken, masterKey);
        }
        if (video.spriteFileId) {
          ensureSpriteLoaded();
        }
        // Hover-intent (250ms) speculative first-segment prefetch (Netflix/YouTube technique)
        if (video.manifest && !selectionMode) {
          if (hoverPrefetchTimerRef.current) {
            clearTimeout(hoverPrefetchTimerRef.current);
          }
          hoverPrefetchTimerRef.current = setTimeout(() => {
            const resumeTime =
              progress &&
              progress.currentTime > 3 &&
              (progress.duration <= 0 || progress.currentTime < progress.duration - 5)
                ? progress.currentTime
                : 0;
            const segUrl = getSegmentUrlForTime(
              video.manifest,
              video.duration,
              resumeTime
            );
            if (segUrl) {
              prefetchSegmentUrl(segUrl, accessToken);
            }
          }, 250);
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        setScrubRatio(null);
        if (hoverPrefetchTimerRef.current) {
          clearTimeout(hoverPrefetchTimerRef.current);
          hoverPrefetchTimerRef.current = null;
        }
      }}
      className={`cv-card group flex flex-col overflow-hidden rounded-xl transition ${
        compact ? "w-64 shrink-0 sm:w-72" : "w-full"
      } ${selectionMode && isSelected ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-[#0b0b0e]" : ""}`}
    >
      {/* Thumbnail: Apple Liquid Glass ambient margins + uncropped object-contain for all manga & video ratios */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-[#060609] ring-1 ring-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition group-hover:ring-white/25 ${
          isManga && portraitCover ? "aspect-[3/4]" : "aspect-video"
        }`}
      >
        <button
          type="button"
          onClick={handlePrimaryClick}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse") {
              setScrubRatio(null);
            }
            if (!selectionMode) {
              prewarmVideoForInstantPlay(video, accessToken, masterKey, getResumeSec(), "high");
            }
            if (video.kind !== "manga" && video.spriteFileId) {
              ensureSpriteLoaded("high");
            }
          }}
          onPointerMove={handleThumbPointerMove}
          onPointerLeave={() => setScrubRatio(null)}
          onPointerCancel={() => setScrubRatio(null)}
          className="absolute inset-0 block h-full w-full select-none text-left focus:outline-none"
          aria-label={selectionMode ? `${video.title} を選択` : `${video.title} を開く`}
        >
          {thumbUrl ? (
            <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-zinc-900 to-[#060609]">
              {/* Only render GPU blur ambient backdrop on manga / non-16:9 items that actually have margins! */}
              {needsAmbientBlur && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbUrl}
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                    draggable={false}
                    className="pointer-events-none absolute inset-0 h-full w-full scale-125 select-none object-cover opacity-80 blur-xl saturate-[1.8] brightness-[0.34]"
                  />
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(ellipse 75% 60% at 15% 12%, rgba(255,255,255,0.16), transparent 60%), radial-gradient(ellipse 65% 55% at 88% 88%, rgba(255,255,255,0.09), transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(8,8,14,0.48) 55%, rgba(255,255,255,0.05) 100%)",
                    }}
                  />
                </>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt={video.title}
                decoding="async"
                draggable={false}
                className="absolute inset-0 z-10 h-full w-full select-none object-contain transition-transform duration-300 group-hover:scale-[1.03]"
              />
              {/* Subtle top specular glass edge */}
              <div className="pointer-events-none absolute inset-0 z-20 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-zinc-700">
              {isManga ? <BookOpen className="h-9 w-9" /> : <Film className="h-9 w-9" />}
            </div>
          )}

          {/* Desktop hover-only storyboard scrub overlay (never unmounts base thumbnail!) */}
          {showingScrubSprite && spriteUrl && (
            <div
              className="pointer-events-none absolute inset-0 z-20 bg-black bg-no-repeat"
              style={{
                backgroundImage: `url(${spriteUrl})`,
                backgroundSize: `${spriteGrid.cols * 100}% ${spriteGrid.rows * 100}%`,
                backgroundPosition: `${(spriteCol / Math.max(1, spriteGrid.cols - 1)) * 100}% ${(spriteRow / Math.max(1, spriteGrid.rows - 1)) * 100}%`,
              }}
            />
          )}

          {selectionMode ? (
            <div
              className={`absolute inset-0 transition-colors ${
                isSelected ? "bg-rose-600/25" : "bg-black/15 group-hover:bg-black/30"
              }`}
            >
              <div
                className={`absolute left-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ${
                  isSelected
                    ? "border-rose-500 bg-rose-500 text-white"
                    : "border-white/80 bg-black/50 text-transparent"
                }`}
              >
                <Check className="h-3.5 w-3.5 stroke-[3]" />
              </div>
            </div>
          ) : !showingScrubSprite ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/35">
              <div className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-rose-600/95 text-white opacity-0 shadow-xl transition-all duration-200 group-hover:scale-100 group-hover:opacity-100">
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              </div>
            </div>
          ) : null}
        </button>

        {/* Scrub progress indicator bar & timestamp during hover preview */}
        {showingScrubSprite && scrubRatio !== null && (
          <>
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
              {formatDuration(scrubRatio * (video.duration || 0))}
            </div>
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5 bg-black/70">
              <div
                className="h-full bg-rose-500"
                style={{ width: `${scrubRatio * 100}%` }}
              />
            </div>
          </>
        )}

        {/* Top-left quality / series / manga badge */}
        {!selectionMode && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1">
            {isManga && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-zinc-950 shadow">
                <BookOpen className="h-2.5 w-2.5" />
                漫画
              </span>
            )}
            {!isManga && qualityBadge && (
              <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-zinc-100">
                {qualityBadge}
              </span>
            )}
            {seriesBadge && !compact && (
              <span className="max-w-[130px] truncate rounded bg-rose-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {seriesBadge}
              </span>
            )}
          </div>
        )}

        {/* Top-right queue, favorite & tag actions */}
        {!selectionMode && (
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAddToQueue(video);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${
                isInQueue
                  ? "bg-indigo-600 text-white"
                  : "bg-black/70 text-zinc-200 hover:bg-black/90 hover:text-white"
              }`}
              title={isInQueue ? "キューに追加済み" : "再生キューに追加"}
              aria-label="再生キューに追加"
            >
              {isInQueue ? (
                <ListChecks className="h-3.5 w-3.5" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(video.id);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-md transition ${
                isFavorite
                  ? "bg-rose-600 text-white"
                  : "bg-black/70 text-zinc-200 hover:bg-black/90"
              }`}
              title={isFavorite ? "お気に入り解除" : "お気に入りに追加"}
              aria-label="お気に入り切替"
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEditTags(video);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-zinc-200 backdrop-blur-md transition hover:bg-black/90 hover:text-white"
              title="ジャンル・タグを編集"
              aria-label="ジャンル編集"
            >
              <Tag className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Always-visible tiny heart if favorited */}
        {!selectionMode && isFavorite && (
          <div className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-600/90 text-white shadow sm:group-hover:opacity-0">
            <Heart className="h-3 w-3 fill-current" />
          </div>
        )}

        {/* Bottom-left thumbnail timestamp badge (click to jump straight to that scene!) */}
        {!isManga && !showingScrubSprite && !selectionMode && video.duration > 0 && (
          <button
            type="button"
            onPointerDown={() => {
              prewarmVideoForInstantPlay(
                video,
                accessToken,
                masterKey,
                effectiveThumbTimeSec,
                "high"
              );
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(video, effectiveThumbTimeSec);
            }}
            className={`absolute bottom-2 left-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
              isCustomThumbTime
                ? "bg-emerald-950/90 text-emerald-200 ring-1 ring-emerald-500/40 hover:bg-emerald-900"
                : "bg-black/80 text-zinc-300 hover:bg-black/95 hover:text-white"
            }`}
            title={`サムネイルの位置 (${formatDuration(effectiveThumbTimeSec)}) から再生`}
          >
            <Camera className="h-2.5 w-2.5" />
            <span>{formatDuration(effectiveThumbTimeSec)}</span>
          </button>
        )}

        {/* Bottom-right duration OR manga page count badge */}
        {isManga && pageCount > 0 ? (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
            {pageCount} P
          </div>
        ) : video.duration > 0 ? (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
            {formatDuration(video.duration)}
          </div>
        ) : null}

        {/* Red YouTube-style progress bar */}
        {progressRatio > 1 && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/80">
            <div
              className="h-full bg-rose-500"
              style={{ width: `${progressRatio}%` }}
            />
          </div>
        )}
      </div>

      {/* Meta section */}
      <div className="flex flex-1 flex-col gap-1.5 px-0.5 pt-2.5">
        <button
          type="button"
          onPointerDown={() => {
            if (!selectionMode) {
              prewarmVideoForInstantPlay(video, accessToken, masterKey, getResumeSec(), "high");
            }
          }}
          onClick={handlePrimaryClick}
          className="line-clamp-2 text-left text-sm font-semibold leading-snug text-zinc-100 transition hover:text-white"
        >
          {video.title}
        </button>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
          {video.width && video.height && (
            <span>
              {video.width}×{video.height}
            </span>
          )}
          {video.sizeBytes ? <span>• {formatBytes(video.sizeBytes)}</span> : null}
          {createdLabel && <span>• {createdLabel}</span>}
          {progress?.playCount ? <span>• {progress.playCount}回視聴</span> : null}
        </div>

        {/* Cross-media Manga <-> Anime 1-tap simultaneous set link */}
        {!selectionMode && linkedItems && linkedItems.length > 0 && onOpenCrossMediaSet && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const companion = linkedItems[0];
              if (isManga) {
                onOpenCrossMediaSet(video, companion);
              } else {
                onOpenCrossMediaSet(companion, video);
              }
            }}
            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-lg border border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-rose-500/15 to-sky-500/15 px-2 py-1 text-[10px] font-bold text-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-md transition hover:border-amber-300/70 hover:brightness-125"
            title={
              isManga
                ? `同じ作品のアニメ（${linkedItems.length}本）を漫画と同時に再生`
                : `同じ作品の漫画を動画と同時に開く`
            }
          >
            <Sparkles className="h-3 w-3 shrink-0 text-amber-300" />
            <span>
              {isManga
                ? `アニメあり (${linkedItems.length}本)・同時視聴`
                : `原作漫画あり・同時視聴`}
            </span>
          </button>
        )}

        {/* Genre pills (max 3 content + 1 creator/studio when collapsed, inline expandable) + tag modal trigger */}
        {(() => {
          const { content, credits } = sortGenresForCard(genres);
          const maxContent = compact ? 2 : 3;
          const visibleContent = tagsExpanded ? content : content.slice(0, maxContent);
          const visibleCredits = tagsExpanded ? credits : credits.slice(0, 1);
          const shownTags = [...visibleContent, ...visibleCredits];
          const hiddenCount =
            (content.length - visibleContent.length) +
            (credits.length - visibleCredits.length);
          const hasOverflow = content.length > maxContent || credits.length > 1;
          const totalCount = content.length + credits.length;

          return (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {shownTags.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClickGenre(genre);
                  }}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition hover:brightness-125 ${getGenreStyle(
                    genre,
                    customGenres
                  )}`}
                >
                  #{genre}
                </button>
              ))}
              {!tagsExpanded && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagsExpanded(true);
                  }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:border-zinc-700 hover:text-white"
                  title="残りのタグをその場で展開"
                >
                  +{hiddenCount}
                </button>
              )}
              {tagsExpanded && hasOverflow && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTagsExpanded(false);
                  }}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                >
                  閉じる
                </button>
              )}
              {!selectionMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditTags(video);
                  }}
                  className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-zinc-700/80 px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:border-rose-500/60 hover:text-rose-300"
                  title="タグを追加・編集"
                >
                  <Plus className="h-2.5 w-2.5" />
                  {totalCount === 0 ? "ジャンル設定" : ""}
                </button>
              )}
            </div>
          );
        })()}

        {/* Always-visible Queue (video) / Read (manga) & Favorite action row */}
        {!selectionMode && (
          <div className="mt-2 flex items-center gap-1.5 pt-0.5">
            {isManga ? (
              <button
                type="button"
                onPointerDown={() => {
                  prewarmVideoForInstantPlay(video, accessToken, masterKey, getResumeSec(), "high");
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(video);
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>漫画を読む ({pageCount}P)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToQueue(video);
                }}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                  isInQueue
                    ? "border-indigo-500/50 bg-indigo-500/20 text-indigo-200"
                    : "border-zinc-800 bg-zinc-900/90 text-zinc-200 hover:border-indigo-500/50 hover:bg-indigo-500/15 hover:text-indigo-200"
                }`}
              >
                {isInQueue ? (
                  <>
                    <ListChecks className="h-3.5 w-3.5" />
                    <span>キュー追加済み</span>
                  </>
                ) : (
                  <>
                    <ListPlus className="h-3.5 w-3.5" />
                    <span>キューに追加</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(video.id);
              }}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
                isFavorite
                  ? "border-rose-500/50 bg-rose-500/20 text-rose-300"
                  : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-100"
              }`}
              title={isFavorite ? "お気に入り解除" : "お気に入り"}
              aria-label="お気に入り"
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(VideoCard);
