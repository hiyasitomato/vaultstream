"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, Film, Heart, ListChecks, ListPlus, Play, Plus, Tag } from "lucide-react";
import {
  driveFetchCachedThumbnailUrl,
  formatBytes,
  formatDuration,
  getSegmentUrlForTime,
  prefetchHlsPlaylist,
} from "@/lib/drive";
import { extractSeriesBadge, getGenreStyle } from "@/lib/genres";
import { prefetchSegmentUrl } from "@/lib/segmentCache";
import type { CustomGenreDef, PlaybackProgress, VaultVideoItem } from "@/lib/types";

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
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (videoId: string) => void;
  onSelect: (video: VaultVideoItem, startTimeSec?: number) => void;
  onAddToQueue: (video: VaultVideoItem) => void;
  onToggleFavorite: (videoId: string) => void;
  onEditTags: (video: VaultVideoItem) => void;
  onClickGenre: (genre: string) => void;
}

export default function VideoCard({
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
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onSelect,
  onAddToQueue,
  onToggleFavorite,
  onEditTags,
  onClickGenre,
}: VideoCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hoverPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inView, setInView] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "350px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    if (!inView || !video.thumbnailFileId) {
      if (!video.thumbnailFileId) setThumbUrl(null);
      return;
    }

    driveFetchCachedThumbnailUrl(
      video.thumbnailFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey,
      video.thumbnailModifiedTime
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
      return new Intl.DateTimeFormat("ja-JP", {
        month: "short",
        day: "numeric",
      }).format(new Date(video.createdAt));
    } catch {
      return "";
    }
  })();

  const handlePrimaryClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(video.id);
    } else {
      onSelect(video);
    }
  };

  const ensureSpriteLoaded = () => {
    if (!video.spriteFileId || spriteUrl) return;
    driveFetchCachedThumbnailUrl(
      video.spriteFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey
    )
      .then((url) => setSpriteUrl(url))
      .catch(() => undefined);
  };

  const handleThumbMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (selectionMode || !video.spriteFileId) return;
    ensureSpriteLoaded();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(0.999, Math.max(0, (e.clientX - rect.left) / rect.width));
    setScrubRatio(ratio);
  };

  const spriteFrameIndex =
    scrubRatio !== null ? Math.min(35, Math.max(0, Math.floor(scrubRatio * 36))) : -1;
  const spriteCol = spriteFrameIndex >= 0 ? spriteFrameIndex % 6 : 0;
  const spriteRow = spriteFrameIndex >= 0 ? Math.floor(spriteFrameIndex / 6) : 0;
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
      onMouseEnter={() => {
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
      onMouseLeave={() => {
        setScrubRatio(null);
        if (hoverPrefetchTimerRef.current) {
          clearTimeout(hoverPrefetchTimerRef.current);
          hoverPrefetchTimerRef.current = null;
        }
      }}
      className={`group flex flex-col overflow-hidden rounded-xl transition ${
        compact ? "w-64 shrink-0 sm:w-72" : "w-full"
      } ${selectionMode && isSelected ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-[#0b0b0e]" : ""}`}
    >
      {/* YouTube-style 16:9 Thumbnail with Hover Scrub Sprite Preview */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-zinc-800/80 transition group-hover:ring-zinc-700">
        <button
          type="button"
          onClick={handlePrimaryClick}
          onMouseMove={handleThumbMouseMove}
          onMouseLeave={() => setScrubRatio(null)}
          className="block h-full w-full text-left focus:outline-none"
          aria-label={selectionMode ? `${video.title} を選択` : `${video.title} を再生`}
        >
          {showingScrubSprite && spriteUrl ? (
            <div
              className="h-full w-full bg-black bg-no-repeat"
              style={{
                backgroundImage: `url(${spriteUrl})`,
                backgroundSize: "600% 600%",
                backgroundPosition: `${(spriteCol / 5) * 100}% ${(spriteRow / 5) * 100}%`,
              }}
            />
          ) : thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl}
              alt={video.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 to-zinc-950 text-zinc-700">
              <Film className="h-9 w-9" />
            </div>
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

        {/* Top-left quality / series badge */}
        {!selectionMode && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1">
            {qualityBadge && (
              <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-zinc-100 backdrop-blur-sm">
                {qualityBadge}
              </span>
            )}
            {seriesBadge && !compact && (
              <span className="max-w-[130px] truncate rounded bg-rose-600/85 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
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
        {!showingScrubSprite && !selectionMode && video.duration > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(video, effectiveThumbTimeSec);
            }}
            className={`absolute bottom-2 left-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold backdrop-blur-sm transition ${
              isCustomThumbTime
                ? "bg-emerald-950/85 text-emerald-200 ring-1 ring-emerald-500/40 hover:bg-emerald-900"
                : "bg-black/75 text-zinc-300 hover:bg-black/95 hover:text-white"
            }`}
            title={`サムネイルの位置 (${formatDuration(effectiveThumbTimeSec)}) から再生`}
          >
            <Camera className="h-2.5 w-2.5" />
            <span>{formatDuration(effectiveThumbTimeSec)}</span>
          </button>
        )}

        {/* Bottom-right duration badge */}
        {video.duration > 0 && (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white">
            {formatDuration(video.duration)}
          </div>
        )}

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

        {/* Genre pills + quick "+ ジャンル" button */}
        {!compact && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {genres.slice(0, 4).map((genre) => (
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
            {genres.length > 4 && (
              <button
                type="button"
                onClick={() => onEditTags(video)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                +{genres.length - 4}
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
                title="ジャンルを設定"
              >
                <Plus className="h-2.5 w-2.5" />
                {genres.length === 0 ? "ジャンル設定" : ""}
              </button>
            )}
          </div>
        )}

        {/* Always-visible Queue & Favorite action row below video */}
        {!selectionMode && (
          <div className="mt-2 flex items-center gap-1.5 pt-0.5">
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
