"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Camera, Check, Film, Heart, ListChecks, ListPlus, Play, Plus, Tag } from "lucide-react";
import {
  driveFetchCachedThumbnailUrl,
  formatBytes,
  formatDuration,
  getSyncCachedThumbnailUrl,
  prewarmVideoForInstantPlay,
} from "@/lib/drive";
import { getContentGenresOnly, getGenreStyle } from "@/lib/genres";
import type { CustomGenreDef, PlaybackProgress, VaultVideoItem } from "@/lib/types";

const ROW_DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

interface VideoListRowProps {
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

function VideoListRow({
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
}: VideoListRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      setIsVisibleNow(true);
      return;
    }
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          preloadObserver.disconnect();
        }
      },
      { rootMargin: "1400px 200px" }
    );
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

  const createdLabel = (() => {
    try {
      const d = new Date(video.createdAt);
      return Number.isNaN(d.getTime()) ? "" : ROW_DATE_FORMATTER.format(d);
    } catch {
      return "";
    }
  })();

  const effectiveThumbTimeSec =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec)
      ? thumbnailTimeSec
      : video.duration > 2
        ? Math.min(Math.max(video.duration * 0.1, 1), 15)
        : 0;
  const isCustomThumbTime =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec);

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

  const needsAmbientBlur =
    video.kind === "manga" ||
    (Boolean(video.width && video.height) &&
      Math.abs((video.width ?? 16) / Math.max(1, video.height ?? 9) - 16 / 9) > 0.22);

  return (
    <div
      ref={rowRef}
      className={`cv-row group flex flex-col gap-3 rounded-xl border p-2.5 transition sm:flex-row sm:items-center sm:gap-4 sm:px-3.5 ${
        selectionMode && isSelected
          ? "border-rose-500/70 bg-rose-950/20"
          : "border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/90"
      }`}
    >
      {selectionMode && (
        <button
          type="button"
          onClick={() => onToggleSelect?.(video.id)}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
            isSelected
              ? "border-rose-500 bg-rose-500 text-white"
              : "border-zinc-600 bg-zinc-900 text-transparent"
          }`}
          aria-label="選択"
        >
          <Check className="h-3 w-3 stroke-[3]" />
        </button>
      )}

      {/* Compact thumbnail (Apple Liquid Glass margins) */}
      <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-[#060609] ring-1 ring-white/15 sm:w-36">
        <button
          type="button"
          onClick={handlePrimaryClick}
          onPointerDown={() => {
            if (!selectionMode) {
              prewarmVideoForInstantPlay(video, accessToken, masterKey, getResumeSec(), "high");
            }
            if (video.kind !== "manga" && video.spriteFileId) {
              driveFetchCachedThumbnailUrl(
                video.spriteFileId,
                accessToken,
                Boolean(video.encrypted),
                masterKey,
                undefined,
                "high"
              ).catch(() => undefined);
            }
          }}
          className="absolute inset-0 block h-full w-full"
        >
          {thumbUrl ? (
            <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-zinc-900 to-[#060609]">
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
                        "radial-gradient(ellipse 75% 60% at 15% 12%, rgba(255,255,255,0.16), transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(8,8,14,0.48) 55%, rgba(255,255,255,0.05) 100%)",
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
                className="absolute inset-0 z-10 h-full w-full select-none object-contain transition-transform duration-200 group-hover:scale-105"
              />
              <div className="pointer-events-none absolute inset-0 z-20 rounded-lg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-700">
              <Film className="h-6 w-6" />
            </div>
          )}
          {!selectionMode && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35">
              <Play className="h-6 w-6 fill-current text-white opacity-0 transition group-hover:opacity-100" />
            </div>
          )}
        </button>
        {video.kind !== "manga" && !selectionMode && video.duration > 0 && (
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
            className={`absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[9px] font-semibold backdrop-blur-sm transition ${
              isCustomThumbTime
                ? "bg-emerald-950/90 text-emerald-200 ring-1 ring-emerald-500/40 hover:bg-emerald-900"
                : "bg-black/80 text-zinc-300 hover:bg-black hover:text-white"
            }`}
            title={`サムネイルの位置 (${formatDuration(effectiveThumbTimeSec)}) から再生`}
          >
            <Camera className="h-2.5 w-2.5" />
            <span>{formatDuration(effectiveThumbTimeSec)}</span>
          </button>
        )}
        {video.kind === "manga" ? (
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
            {video.pageCount ?? video.manifest?.pages?.length ?? 0} P
          </span>
        ) : video.duration > 0 ? (
          <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 font-mono text-[10px] font-semibold text-white">
            {formatDuration(video.duration)}
          </span>
        ) : null}
        {progressRatio > 1 && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
            <div className="h-full bg-rose-500" style={{ width: `${progressRatio}%` }} />
          </div>
        )}
      </div>

      {/* File info & genres */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onPointerDown={() => {
            if (!selectionMode) {
              prewarmVideoForInstantPlay(video, accessToken, masterKey, getResumeSec(), "high");
            }
          }}
          onClick={handlePrimaryClick}
          className="line-clamp-1 text-left text-sm font-semibold text-zinc-100 hover:text-white"
        >
          {video.title}
        </button>
        {video.sourceFileName && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
            {video.sourceFileName}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {!selectionMode && linkedItems && linkedItems.length > 0 && onOpenCrossMediaSet && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const companion = linkedItems[0];
                if (video.kind === "manga") {
                  onOpenCrossMediaSet(video, companion);
                } else {
                  onOpenCrossMediaSet(companion, video);
                }
              }}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            >
              <Film className="h-2.5 w-2.5 text-zinc-400" />
              <span>
                {video.kind === "manga"
                  ? `アニメあり (${linkedItems.length}本)`
                  : `原作漫画あり`}
              </span>
            </button>
          )}
          {getContentGenresOnly(genres).map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => onClickGenre(genre)}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${getGenreStyle(
                genre,
                customGenres
              )}`}
            >
              {genre}
            </button>
          ))}
          {!selectionMode && (
            <button
              type="button"
              onClick={() => onEditTags(video)}
              className="inline-flex items-center gap-0.5 rounded border border-dashed border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              <Plus className="h-2.5 w-2.5" />
              {getContentGenresOnly(genres).length === 0 ? "ジャンル設定" : ""}
            </button>
          )}
        </div>
      </div>

      {/* File-explorer columns */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs text-zinc-400 sm:justify-end sm:gap-5">
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="w-14 text-right text-zinc-300">
            {video.kind === "manga"
              ? `${video.pageCount ?? video.manifest?.pages?.length ?? 0}P`
              : video.height
                ? `${video.height}p`
                : "--"}
          </span>
          <span className="w-16 text-right">
            {video.sizeBytes ? formatBytes(video.sizeBytes) : "--"}
          </span>
          <span className="hidden w-20 text-right md:inline">{createdLabel}</span>
        </div>

        {!selectionMode && (
          <div className="flex items-center gap-1.5">
            {video.kind !== "manga" && (
              <button
                type="button"
                onClick={() => onAddToQueue(video)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                  isInQueue
                    ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300"
                    : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                }`}
                title={isInQueue ? "キューに追加済み" : "再生キューに追加"}
              >
                {isInQueue ? (
                  <ListChecks className="h-3.5 w-3.5" />
                ) : (
                  <ListPlus className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => onToggleFavorite(video.id)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                isFavorite
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-400"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
              }`}
              title="お気に入り"
            >
              <Heart className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => onEditTags(video)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:text-zinc-100"
              title="ジャンル編集"
            >
              <Tag className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(VideoListRow);
