"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Camera,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  EyeOff,
  Film,
  Heart,
  Layers,
  ListMusic,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Rows3,
  Search,
  SkipForward,
  Sparkles,
  Square,
  Tag,
  Timer,
  X,
} from "lucide-react";
import {
  driveFetchCachedThumbnailUrl,
  driveFetchMangaPageUrl,
  formatDuration,
  getSyncCachedThumbnailUrl,
  hasMangaPageCached,
  prewarmVideoForInstantPlay,
  updateThumbnailInDrive,
} from "@/lib/drive";
import type { RelatedWorkRecommendation } from "@/lib/crossMedia";
import { saveVideoProgress } from "@/lib/storage";
import type { PlaybackProgress, VaultVideoItem } from "@/lib/types";

interface MangaReaderModalProps {
  manga: VaultVideoItem;
  allVideos: VaultVideoItem[];
  linkedVideos?: VaultVideoItem[];
  seriesManga?: VaultVideoItem[];
  relatedWorks?: RelatedWorkRecommendation[];
  onSelectManga?: (manga: VaultVideoItem) => void;
  queue?: VaultVideoItem[];
  queueIndex?: number;
  onSelectQueueIndex?: (idx: number) => void;
  onRemoveFromQueue?: (idx: number) => void;
  onClearQueue?: () => void;
  accessToken: string;
  masterKey: CryptoKey | null;
  isFavorite: boolean;
  initialProgress?: PlaybackProgress;
  hasActiveVideo: boolean;
  activeVideoTitle?: string;
  splitWithVideo: boolean;
  onToggleSplitWithVideo: () => void;
  onEnableSplitWithVideo: () => void;
  onSelectVideo: (video: VaultVideoItem) => void;
  onToggleFavorite: (id: string) => void;
  onEditTags: (item: VaultVideoItem) => void;
  onProgressUpdated: (id: string, progress: PlaybackProgress) => void;
  onThumbnailUpdated?: (id: string, capturedPage: number, updatedAtIso?: string) => void;
  thumbVersions?: Record<string, number>;
  onAuthExpired: () => void;
  onClose: () => void;
}

const PickerThumb = memo(function PickerThumb({
  item,
  accessToken,
  masterKey,
  thumbVersion = 0,
}: {
  item: VaultVideoItem;
  accessToken: string;
  masterKey: CryptoKey | null;
  thumbVersion?: number;
}) {
  const [url, setUrl] = useState<string | null>(() =>
    getSyncCachedThumbnailUrl(
      item.thumbnailFileId,
      Boolean(item.encrypted),
      item.thumbnailModifiedTime
    )
  );
  useEffect(() => {
    let active = true;
    if (!item.thumbnailFileId) return;
    const sync = getSyncCachedThumbnailUrl(
      item.thumbnailFileId,
      Boolean(item.encrypted),
      item.thumbnailModifiedTime
    );
    if (sync) {
      setUrl(sync);
      return;
    }
    driveFetchCachedThumbnailUrl(
      item.thumbnailFileId,
      accessToken,
      Boolean(item.encrypted),
      masterKey,
      item.thumbnailModifiedTime,
      "normal"
    )
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    item.thumbnailFileId,
    item.thumbnailModifiedTime,
    item.encrypted,
    accessToken,
    masterKey,
    thumbVersion,
  ]);

  return (
    <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-[#060609] ring-1 ring-white/15">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={item.title} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600">
          <Film className="h-4 w-4" />
        </div>
      )}
    </div>
  );
});

type ReadingMode = "rtl" | "ltr" | "vertical";
type SpreadMode = "single" | "double";

const SLIDE_INTERVAL_PRESETS = [2, 3, 5, 8, 12, 15];

function LazyVerticalMangaPage({
  fileId,
  mimeType,
  pageNumber,
  accessToken,
  encrypted,
  masterKey,
  onVisible,
  onAuthExpired,
}: {
  fileId: string;
  mimeType?: string;
  pageNumber: number;
  accessToken: string;
  encrypted: boolean;
  masterKey: CryptoKey | null;
  onVisible: (idx: number) => void;
  onAuthExpired: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            if (e.intersectionRatio > 0.25) {
              onVisible(pageNumber - 1);
            }
          }
        }
      },
      { rootMargin: "900px 0px", threshold: [0.01, 0.3] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!inView) return;
    let active = true;
    driveFetchMangaPageUrl(fileId, accessToken, encrypted, masterKey, mimeType)
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch((err) => {
        if (err instanceof Error && err.message === "AUTH_EXPIRED") {
          onAuthExpired();
        }
      });
    return () => {
      active = false;
    };
  }, [inView, fileId, accessToken, encrypted, masterKey, mimeType, onAuthExpired]);

  return (
    <div
      ref={ref}
      className={`relative flex w-full max-w-4xl items-center justify-center ${
        url ? "min-h-0 bg-transparent" : "min-h-[320px] bg-black/40"
      }`}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Page ${pageNumber}`}
          className="h-auto w-full select-none object-contain drop-shadow-[0_18px_45px_rgba(0,0,0,0.8)]"
          draggable={false}
        />
      ) : (
        <div className="flex flex-col items-center gap-2 py-24 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
          <span className="font-mono text-xs">{pageNumber} P 読み込み中...</span>
        </div>
      )}
    </div>
  );
}

export default function MangaReaderModal({
  manga,
  allVideos,
  linkedVideos = [],
  seriesManga = [],
  relatedWorks = [],
  onSelectManga,
  queue = [],
  queueIndex = -1,
  onSelectQueueIndex,
  onRemoveFromQueue,
  onClearQueue,
  accessToken,
  masterKey,
  isFavorite,
  initialProgress,
  hasActiveVideo,
  activeVideoTitle,
  splitWithVideo,
  onToggleSplitWithVideo,
  onEnableSplitWithVideo,
  onSelectVideo,
  onToggleFavorite,
  onEditTags,
  onProgressUpdated,
  onThumbnailUpdated,
  thumbVersions = {},
  onAuthExpired,
  onClose,
}: MangaReaderModalProps) {
  const pages = useMemo(() => manga.manifest?.pages ?? [], [manga.manifest]);
  const totalPages = pages.length;

  const initialProgressRef = useRef(initialProgress);
  initialProgressRef.current = initialProgress;

  const computeStartIdx = useCallback(
    (prog?: PlaybackProgress) => {
      if (prog && prog.currentTime >= 1 && prog.currentTime < totalPages) {
        return Math.min(totalPages - 1, Math.max(0, Math.floor(prog.currentTime) - 1));
      }
      return 0;
    },
    [totalPages]
  );

  const [pageIdx, setPageIdx] = useState<number>(() => computeStartIdx(initialProgress));
  const lastMangaIdRef = useRef<string>(manga.id);
  const [readingMode, setReadingMode] = useState<ReadingMode>("rtl");
  const [spreadMode, setSpreadMode] = useState<SpreadMode>("single");
  const [hudVisible, setHudVisible] = useState(true);

  // Auto-Slide state
  const [autoSlide, setAutoSlide] = useState(false);
  const [slideSec, setSlideSec] = useState<number>(5);
  const [loopSlide, setLoopSlide] = useState<boolean>(true);
  const [speedPanelOpen, setSpeedPanelOpen] = useState(false);

  // In-reader Video Picker for 1-tap Simultaneous Video + Manga Split Mode
  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  const [videoPickerQuery, setVideoPickerQuery] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const pullGestureRef = useRef<{
    x: number;
    y: number;
    t: number;
    axis: "x" | "y" | null;
  } | null>(null);
  const [seriesPickerOpen, setSeriesPickerOpen] = useState(false);
  const [queuePickerOpen, setQueuePickerOpen] = useState(false);

  useEffect(() => {
    setMinimized(false);
    setDragOffsetY(0);
    setSeriesPickerOpen(false);
    setQueuePickerOpen(false);
  }, [manga.id]);

  const currentQueueIdx = useMemo(
    () => queue.findIndex((q) => q.id === manga.id),
    [queue, manga.id]
  );
  const nextQueueItem =
    currentQueueIdx >= 0 && currentQueueIdx + 1 < queue.length
      ? queue[currentQueueIdx + 1]
      : queueIndex >= 0 && queueIndex + 1 < queue.length
        ? queue[queueIndex + 1]
        : null;
  const nextQueueTargetIdx =
    currentQueueIdx >= 0 && currentQueueIdx + 1 < queue.length
      ? currentQueueIdx + 1
      : queueIndex >= 0 && queueIndex + 1 < queue.length
        ? queueIndex + 1
        : -1;
  const prevQueueTargetIdx =
    currentQueueIdx > 0
      ? currentQueueIdx - 1
      : queueIndex > 0 && queueIndex < queue.length
        ? queueIndex - 1
        : -1;
  const prevQueueItem =
    prevQueueTargetIdx >= 0 && prevQueueTargetIdx < queue.length
      ? queue[prevQueueTargetIdx]
      : null;

  const currentSeriesIdx = useMemo(
    () => seriesManga.findIndex((m) => m.id === manga.id),
    [seriesManga, manga.id]
  );
  const nextManga =
    currentSeriesIdx >= 0 && currentSeriesIdx + 1 < seriesManga.length
      ? seriesManga[currentSeriesIdx + 1]
      : null;
  const prevManga =
    currentSeriesIdx > 0 ? seriesManga[currentSeriesIdx - 1] : null;

  // Prewarm next volume / next queue item in background when nearing the end of the current manga
  useEffect(() => {
    const target = nextQueueItem ?? nextManga;
    if (!target || totalPages === 0 || pageIdx < Math.max(0, totalPages - 5)) return;
    prewarmVideoForInstantPlay(target, accessToken, masterKey, 0, "low");
  }, [nextQueueItem, nextManga, totalPages, pageIdx, accessToken, masterKey]);

  const pickableVideos = useMemo(() => {
    const q = videoPickerQuery.trim().toLowerCase();
    return allVideos
      .filter((v) => v.kind !== "manga")
      .filter((v) => (!q ? true : v.title.toLowerCase().includes(q)))
      .slice(0, 60);
  }, [allVideos, videoPickerQuery]);

  // Loaded page URLs map (pageIndex -> objectURL) + full-manga background cache progress
  const [pageUrls, setPageUrls] = useState<Record<number, string>>({});
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [cachedCount, setCachedCount] = useState(0);

  // Scrubber hover/drag thumbnail preview state (YouTube / VideoPlayerModal style)
  const [hoverScrub, setHoverScrub] = useState<{ idx: number; visualRatio: number } | null>(null);
  const [isDraggingScrub, setIsDraggingScrub] = useState(false);

  // Set current manga page as cover thumbnail state
  const [thumbSaving, setThumbSaving] = useState(false);
  const [thumbNotice, setThumbNotice] = useState<string | null>(null);

  const verticalScrollRef = useRef<HTMLDivElement | null>(null);
  const scrubBarRef = useRef<HTMLDivElement | null>(null);
  const isDraggingScrubRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const onProgressUpdatedRef = useRef(onProgressUpdated);
  const onAuthExpiredRef = useRef(onAuthExpired);

  useEffect(() => {
    onProgressUpdatedRef.current = onProgressUpdated;
  }, [onProgressUpdated]);

  useEffect(() => {
    onAuthExpiredRef.current = onAuthExpired;
  }, [onAuthExpired]);

  // Reset ONLY when actually switching to a different manga (NEVER when our own progress saves!)
  useEffect(() => {
    if (lastMangaIdRef.current === manga.id) return;
    lastMangaIdRef.current = manga.id;
    setPageIdx(computeStartIdx(initialProgressRef.current));
    setPageUrls({});
    setAutoSlide(false);
    setHoverScrub(null);
    setIsDraggingScrub(false);
    isDraggingScrubRef.current = false;
  }, [manga.id, computeStartIdx]);

  const stepSize = spreadMode === "double" && readingMode !== "vertical" ? 2 : 1;

  // Save reading progress whenever page changes
  useEffect(() => {
    if (totalPages <= 0) return;
    const saved = saveVideoProgress(manga.id, pageIdx + 1, totalPages, pageIdx === 0);
    onProgressUpdatedRef.current(manga.id, saved);
  }, [manga.id, pageIdx, totalPages]);

  // High-priority immediate loader for current page (+ spread & next 4 pages)
  useEffect(() => {
    if (totalPages === 0 || readingMode === "vertical") return;
    let active = true;

    const currentMissing = !pageUrls[pageIdx];
    setLoadingCurrent(currentMissing);

    const priorityIndices: number[] = [pageIdx];
    if (pageIdx + 1 < totalPages) priorityIndices.push(pageIdx + 1);
    for (let offset = 2; offset <= 5; offset += 1) {
      if (pageIdx + offset < totalPages) priorityIndices.push(pageIdx + offset);
    }
    if (pageIdx - 1 >= 0) priorityIndices.push(pageIdx - 1);

    priorityIndices.forEach((idx, rank) => {
      const page = pages[idx];
      if (!page) return;
      driveFetchMangaPageUrl(
        page.fileId,
        accessToken,
        Boolean(manga.encrypted),
        masterKey,
        page.mimeType || "image/jpeg",
        rank <= 2 ? "high" : "low"
      )
        .then((url) => {
          if (!active) return;
          setPageUrls((prev) => (prev[idx] === url ? prev : { ...prev, [idx]: url }));
          if (idx === pageIdx) setLoadingCurrent(false);
        })
        .catch((err) => {
          if (!active) return;
          if (err instanceof Error && err.message === "AUTH_EXPIRED") {
            onAuthExpiredRef.current();
          }
          if (idx === pageIdx) setLoadingCurrent(false);
        });
    });

    return () => {
      active = false;
    };
  }, [pageIdx, pages, totalPages, accessToken, manga.encrypted, masterKey, readingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // High-speed 6-parallel background full-manga preloader (pulls entire book into RAM + IndexedDB!)
  useEffect(() => {
    if (totalPages === 0) {
      setCachedCount(0);
      return;
    }
    let cancelled = false;
    const isEnc = Boolean(manga.encrypted);

    const recount = () => {
      if (cancelled) return;
      let count = 0;
      for (const p of pages) {
        if (hasMangaPageCached(p.fileId, isEnc)) count += 1;
      }
      setCachedCount(count);
    };
    recount();

    const startIdx = computeStartIdx(initialProgressRef.current);
    const queuedSet = new Set<number>();
    const queueOrder: number[] = [];
    const pushIdx = (idx: number) => {
      if (idx >= 0 && idx < totalPages && !queuedSet.has(idx)) {
        queuedSet.add(idx);
        queueOrder.push(idx);
      }
    };

    // 1. Immediate next 10 pages from current position for zero-wait turning
    for (let i = 0; i < Math.min(totalPages, 10); i += 1) {
      pushIdx((startIdx + i) % totalPages);
    }
    // 2. Evenly-spaced keyframe pages across the entire manga for instant scrubber previews
    if (totalPages > 16) {
      const sampleCount = 16;
      for (let s = 0; s < sampleCount; s += 1) {
        pushIdx(Math.round((s / (sampleCount - 1)) * (totalPages - 1)));
      }
    }
    // 3. Remaining pages up to 280 pages around current position (memory-safe for huge omnibuses)
    const maxPreload = Math.min(totalPages, 280);
    for (let i = 0; i < maxPreload; i += 1) {
      pushIdx((startIdx + i) % totalPages);
    }

    const worker = async () => {
      while (!cancelled && queueOrder.length > 0) {
        const idx = queueOrder.shift();
        if (idx === undefined) break;
        const page = pages[idx];
        if (!page) continue;
        try {
          const url = await driveFetchMangaPageUrl(
            page.fileId,
            accessToken,
            isEnc,
            masterKey,
            page.mimeType || "image/jpeg",
            "low"
          );
          if (!cancelled) {
            setPageUrls((prev) => (prev[idx] === url ? prev : { ...prev, [idx]: url }));
            recount();
          }
        } catch {
          // Ignore individual background prefetch failure
        }
      }
    };

    const timer = setTimeout(() => {
      if (!cancelled) {
        Promise.all(Array.from({ length: 6 }, () => worker())).catch(() => undefined);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [manga.id, pages, totalPages, accessToken, manga.encrypted, masterKey, computeStartIdx]);

  const goNext = useCallback(() => {
    if (pageIdx + stepSize < totalPages) {
      setPageIdx(pageIdx + stepSize);
      return;
    }
    if (nextQueueItem && onSelectQueueIndex && nextQueueTargetIdx >= 0) {
      onSelectQueueIndex(nextQueueTargetIdx);
      return;
    }
    if (nextManga && onSelectManga) {
      onSelectManga(nextManga);
      return;
    }
    if (loopSlide) {
      setPageIdx(0);
      return;
    }
    setAutoSlide(false);
  }, [
    pageIdx,
    stepSize,
    totalPages,
    loopSlide,
    nextQueueItem,
    nextQueueTargetIdx,
    onSelectQueueIndex,
    nextManga,
    onSelectManga,
  ]);

  const goPrev = useCallback(() => {
    if (pageIdx > 0) {
      setPageIdx(Math.max(0, pageIdx - stepSize));
      return;
    }
    if (prevQueueItem && onSelectQueueIndex && prevQueueTargetIdx >= 0) {
      onSelectQueueIndex(prevQueueTargetIdx);
      return;
    }
    if (prevManga && onSelectManga) {
      onSelectManga(prevManga);
    }
  }, [
    pageIdx,
    stepSize,
    prevQueueItem,
    prevQueueTargetIdx,
    onSelectQueueIndex,
    prevManga,
    onSelectManga,
  ]);

  const currentPageReady = Boolean(pageUrls[pageIdx]) && !loadingCurrent;

  // Auto-Slide timer (zero 20Hz React re-renders: single setTimeout + CSS compositor animation!)
  useEffect(() => {
    if (!autoSlide || totalPages === 0) {
      return;
    }

    if (readingMode === "vertical") {
      // Smooth vertical auto-scroll proportional to slideSec (faster slideSec = faster scroll)
      const pxPerTick = Math.max(1.5, Math.round((420 / Math.max(1, slideSec)) / 20));
      const timer = setInterval(() => {
        const scroller = verticalScrollRef.current;
        if (!scroller) return;
        const atBottom =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
        if (atBottom) {
          if (loopSlide) {
            scroller.scrollTo({ top: 0 });
          } else {
            setAutoSlide(false);
          }
        } else {
          scroller.scrollTop += pxPerTick;
        }
      }, 50);
      return () => clearInterval(timer);
    }

    // Wait until current page is decrypted/loaded before starting countdown
    if (!currentPageReady) return;

    const totalMs = Math.max(1000, slideSec * 1000);
    const timer = setTimeout(() => {
      goNext();
    }, totalMs);

    return () => clearTimeout(timer);
  }, [autoSlide, slideSec, loopSlide, readingMode, currentPageReady, pageIdx, totalPages, goNext]);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.key === "Escape") {
        if (videoPickerOpen) {
          setVideoPickerOpen(false);
          return;
        }
        if (seriesPickerOpen) {
          setSeriesPickerOpen(false);
          return;
        }
        if (!minimized) {
          setMinimized(true);
        }
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setAutoSlide((prev) => !prev);
        return;
      }
      if (readingMode === "vertical") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (readingMode === "rtl") goNext();
        else goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (readingMode === "rtl") goPrev();
        else goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readingMode, goNext, goPrev, minimized, videoPickerOpen, seriesPickerOpen]);

  const hoverIdx = hoverScrub?.idx ?? null;
  const hoverPreviewUrl = hoverIdx !== null ? pageUrls[hoverIdx] : undefined;

  // Debounced high-priority fetch for scrub-bar thumbnail preview if not cached yet
  useEffect(() => {
    if (hoverIdx === null || hoverPreviewUrl) return;
    const page = pages[hoverIdx];
    if (!page) return;

    let active = true;
    const timer = setTimeout(() => {
      driveFetchMangaPageUrl(
        page.fileId,
        accessToken,
        Boolean(manga.encrypted),
        masterKey,
        page.mimeType || "image/jpeg",
        "high"
      )
        .then((url) => {
          if (!active) return;
          setPageUrls((prev) => (prev[hoverIdx] === url ? prev : { ...prev, [hoverIdx]: url }));
        })
        .catch(() => undefined);
    }, 70);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [hoverIdx, hoverPreviewUrl, pages, accessToken, manga.encrypted, masterKey]);

  const getScrubInfoFromClientX = (clientX: number) => {
    const el = scrubBarRef.current;
    if (!el || totalPages <= 1) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const visualRatio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const pageRatio = readingMode === "rtl" ? 1 - visualRatio : visualRatio;
    const idx = Math.min(totalPages - 1, Math.max(0, Math.round(pageRatio * (totalPages - 1))));
    return { idx, visualRatio };
  };

  const handleTapZone = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    if (ratio < 0.25) {
      // Left 25% edge
      if (readingMode === "rtl") goNext();
      else goPrev();
    } else if (ratio > 0.75) {
      // Right 25% edge
      if (readingMode === "rtl") goPrev();
      else goNext();
    } else {
      // Center 50% -> always advance to the NEXT page!
      goNext();
    }
  };

  const handleVerticalPageVisible = useCallback((idx: number) => {
    setPageIdx(idx);
  }, []);

  const primaryUrl = pageUrls[pageIdx];
  const secondaryIdx = spreadMode === "double" && pageIdx + 1 < totalPages ? pageIdx + 1 : null;
  const secondaryUrl = secondaryIdx !== null ? pageUrls[secondaryIdx] : null;

  const canSaveCoverThumb = Boolean(
    manga.thumbnailFileId &&
      !pages.some((p) => p.fileId === manga.thumbnailFileId) &&
      (primaryUrl || pages[pageIdx])
  );

  const showThumbToast = (msg: string) => {
    setThumbNotice(msg);
    setTimeout(() => {
      setThumbNotice((cur) => (cur === msg ? null : cur));
    }, 2800);
  };

  const handleSetCurrentPageAsThumbnail = async () => {
    if (!manga.thumbnailFileId || thumbSaving) return;
    if (pages.some((p) => p.fileId === manga.thumbnailFileId)) {
      showThumbToast("この漫画は専用サムネイルファイルが無いため変更できません");
      return;
    }

    setThumbSaving(true);
    try {
      let srcUrl = primaryUrl;
      if (!srcUrl && pages[pageIdx]) {
        const p = pages[pageIdx];
        srcUrl = await driveFetchMangaPageUrl(
          p.fileId,
          accessToken,
          Boolean(manga.encrypted),
          masterKey,
          p.mimeType || "image/jpeg",
          "high"
        );
      }
      if (!srcUrl) {
        showThumbToast("ページの読み込み完了後にもう一度お試しください");
        return;
      }

      const img = new Image();
      img.src = srcUrl;
      await new Promise<void>((resolve, reject) => {
        if (img.complete && img.naturalWidth > 0) {
          resolve();
          return;
        }
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("ページ画像のデコードに失敗しました"));
      });

      const targetWidth = Math.min(480, img.naturalWidth || 480);
      const targetHeight = Math.max(
        1,
        Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * targetWidth)
      );
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas の初期化に失敗しました");
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.86)
      );
      if (!blob) throw new Error("JPEG 変換に失敗しました");

      const jpegBytes = new Uint8Array(await blob.arrayBuffer());
      const { updatedAt } = await updateThumbnailInDrive(
        manga.thumbnailFileId,
        jpegBytes,
        accessToken,
        Boolean(manga.encrypted),
        masterKey
      );
      onThumbnailUpdated?.(manga.id, pageIdx + 1, updatedAt);
      showThumbToast(`P.${pageIdx + 1} を表紙サムネイルに設定しました！`);
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_EXPIRED") {
        onAuthExpiredRef.current();
        return;
      }
      showThumbToast(
        err instanceof Error ? err.message : "表紙サムネイルの保存に失敗しました"
      );
    } finally {
      setThumbSaving(false);
    }
  };

  const containerPositionClass =
    hasActiveVideo && splitWithVideo
      ? "fixed inset-x-0 bottom-0 top-[34dvh] z-40 flex flex-col overflow-hidden bg-[#08080b] lg:inset-y-0 lg:left-[42vw] lg:right-0 lg:top-0 lg:h-[100dvh]"
      : "fixed inset-0 z-40 flex h-[100dvh] flex-col overflow-hidden bg-[#08080b]";

  if (minimized) {
    return (
      <div
        className={`fixed right-3 z-[75] flex w-[280px] max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-2xl border border-white/15 bg-zinc-950/92 p-2 shadow-2xl shadow-black/70 backdrop-blur-2xl sm:right-4 sm:w-[310px] ${
          hasActiveVideo ? "bottom-36 md:bottom-24" : "bottom-20 md:bottom-4"
        }`}
        role="region"
        aria-label={`ミニ漫画リーダー: ${manga.title}`}
      >
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition hover:opacity-90"
          title="タップして漫画リーダーに戻る"
        >
          <PickerThumb
            item={manga}
            accessToken={accessToken}
            masterKey={masterKey}
            thumbVersion={thumbVersions[manga.id] ?? 0}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-300">
              <BookOpen className="h-3 w-3 shrink-0" />
              <span>読書中</span>
              {seriesManga.length > 1 && currentSeriesIdx >= 0 && (
                <span className="text-zinc-400">
                  ({currentSeriesIdx + 1}/{seriesManga.length})
                </span>
              )}
            </div>
            <p className="truncate text-xs font-bold text-white">{manga.title}</p>
            <p className="font-mono text-[10px] text-zinc-400">
              P.{pageIdx + 1} / {totalPages}
            </p>
          </div>
          <Maximize2 className="h-4 w-4 shrink-0 text-zinc-400" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition hover:bg-rose-500/30 hover:text-white"
          title="漫画リーダーを閉じる"
          aria-label="漫画リーダーを閉じる"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const handlePullTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (splitWithVideo || e.touches.length !== 1) return;
      const t = e.touches[0];
      pullGestureRef.current = {
        x: t.clientX,
        y: t.clientY,
        t: performance.now(),
        axis: null,
      };
    },
    [splitWithVideo]
  );

  const handlePullTouchMove = useCallback(
    (e: React.TouchEvent, allowHorizontalFlip: boolean) => {
      const g = pullGestureRef.current;
      if (!g || splitWithVideo || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x;
      const dy = t.clientY - g.y;

      if (!g.axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (dy > 10 && Math.abs(dy) > Math.abs(dx) * 1.15) {
          g.axis = "y";
        } else if (allowHorizontalFlip && Math.abs(dx) >= Math.abs(dy)) {
          g.axis = "x";
        } else {
          pullGestureRef.current = null;
          return;
        }
      }

      if (g.axis === "y") {
        setDragOffsetY(Math.max(0, dy));
      }
    },
    [splitWithVideo]
  );

  const handlePullTouchEnd = useCallback(
    (e: React.TouchEvent, allowHorizontalFlip: boolean) => {
      const g = pullGestureRef.current;
      pullGestureRef.current = null;
      if (!g) return;
      const t = e.changedTouches[0];
      const dx = (t?.clientX ?? g.x) - g.x;
      const dy = (t?.clientY ?? g.y) - g.y;
      const dt = Math.max(1, performance.now() - g.t);
      const vy = dy / dt;

      if (g.axis === "y") {
        setDragOffsetY(0);
        if (dy > 95 || (dy > 45 && vy > 0.45)) {
          setMinimized(true);
        }
        return;
      }

      if (allowHorizontalFlip && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) {
          if (readingMode === "rtl") goNext();
          else goPrev();
        } else {
          if (readingMode === "rtl") goPrev();
          else goNext();
        }
      }
    },
    [readingMode, goNext, goPrev]
  );

  return (
    <div
      className={`${containerPositionClass} ios-no-callout`}
      style={{
        transform:
          dragOffsetY > 0
            ? `translate3d(0, ${dragOffsetY}px, 0) scale(${1 - Math.min(0.12, dragOffsetY / 1600)})`
            : "translate3d(0, 0, 0) scale(1)",
        borderRadius: dragOffsetY > 0 ? "24px" : "0px",
        opacity: dragOffsetY > 0 ? Math.max(0.55, 1 - dragOffsetY / 700) : 1,
        transition:
          dragOffsetY > 0
            ? "none"
            : "transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease, border-radius 200ms ease",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={manga.title}
    >
      {/* Smooth Pull-Down-to-Minimize Floating Pill */}
      {dragOffsetY > 24 && (
        <div className="pointer-events-none absolute left-1/2 top-5 z-40 -translate-x-1/2 rounded-full border border-white/20 bg-black/85 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xl">
          {dragOffsetY > 95 ? "↓ 離すとミニ窓でホームへ" : "↓ 下に引いてホームへ"}
        </div>
      )}
      {/* Auto-Slide Countdown Progress Hairline (GPU compositor animation) */}
      {autoSlide && readingMode !== "vertical" && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 h-1 bg-zinc-900">
          {currentPageReady && (
            <div
              key={`${pageIdx}-${slideSec}-${currentPageReady}`}
              className="h-full origin-left bg-gradient-to-r from-rose-500 to-fuchsia-400"
              style={{
                animation: `mangaSlideBar ${Math.max(1, slideSec)}s linear forwards`,
              }}
            />
          )}
        </div>
      )}

      {/* Top HUD Header (Apple Liquid Glass) */}
      <header
        onTouchStart={handlePullTouchStart}
        onTouchMove={(e) => handlePullTouchMove(e, false)}
        onTouchEnd={(e) => handlePullTouchEnd(e, false)}
        className={`z-20 flex shrink-0 items-center justify-between gap-2 border-b border-white/15 bg-black/45 px-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-opacity duration-200 sm:px-4 ${
          hudVisible
            ? "pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] opacity-100"
            : "pointer-events-none h-0 overflow-hidden border-0 py-0 opacity-0"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
            title="ホームに戻る（右下に小さく残す）"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">ホーム</span>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-xs font-bold text-white sm:text-sm">{manga.title}</h2>
            <p className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
              <span>
                {pageIdx + 1}
                {secondaryIdx !== null ? `–${secondaryIdx + 1}` : ""} / {totalPages} ページ
              </span>
              {totalPages > 0 && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                    cachedCount >= Math.min(totalPages, 280)
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {cachedCount >= Math.min(totalPages, 280)
                    ? "全ページ読込済"
                    : `先読み ${Math.round((cachedCount / Math.min(totalPages, 280)) * 100)}%`}
                </span>
              )}
              {autoSlide && <span>• 自動スライド ({slideSec}秒)</span>}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {queue.length > 0 && onSelectQueueIndex && (
            <button
              type="button"
              onClick={() => setQueuePickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25"
              title="再生キューを表示"
            >
              <ListMusic className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">キュー ({queue.length})</span>
              <span className="sm:hidden">{queue.length}</span>
            </button>
          )}
          {(seriesManga.length > 1 || relatedWorks.length > 0) && onSelectManga && (
            <button
              type="button"
              onClick={() => setSeriesPickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25"
              title="シリーズ・同じ制作/作者の関連作品"
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {seriesManga.length > 1
                  ? `シリーズ (${currentSeriesIdx + 1}/${seriesManga.length})`
                  : `関連 (${relatedWorks.length})`}
              </span>
              <span className="sm:hidden">
                {seriesManga.length > 1
                  ? `${currentSeriesIdx + 1}/${seriesManga.length}`
                  : `関連${relatedWorks.length}`}
              </span>
            </button>
          )}
          {/* Simultaneous Video + Manga Split Controls (Works on Mobile & PC!) */}
          {hasActiveVideo ? (
            <>
              <button
                type="button"
                onClick={onToggleSplitWithVideo}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition ${
                  splitWithVideo
                    ? "border-sky-400/70 bg-sky-500/25 text-sky-100 shadow-sm shadow-sky-500/20"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
                title="動画と漫画を分割表示（スマホは上下、PCは左右）"
              >
                <Film className="h-3.5 w-3.5" />
                <span>{splitWithVideo ? "分割 ON" : "動画と並べる"}</span>
              </button>
              <button
                type="button"
                onClick={() => setVideoPickerOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                title={activeVideoTitle ? `再生中: ${activeVideoTitle}（タップで別の動画へ変更）` : "別の動画を選ぶ"}
              >
                <span className="hidden sm:inline">動画変更</span>
                <span className="sm:hidden">変更</span>
              </button>
            </>
          ) : linkedVideos.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (linkedVideos.length === 1) {
                  onEnableSplitWithVideo();
                  onSelectVideo(linkedVideos[0]);
                } else {
                  setVideoPickerOpen(true);
                }
              }}
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-gradient-to-r from-amber-500/25 via-rose-500/20 to-sky-500/25 px-2.5 py-1.5 text-xs font-bold text-amber-100 shadow-sm shadow-amber-500/20 transition hover:brightness-125"
              title={`この作品のアニメ（${linkedVideos.length}本）を漫画と同時に再生`}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>アニメ同時 ({linkedVideos.length})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setVideoPickerOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-sky-500/50 bg-sky-500/15 px-2.5 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/25"
              title="動画を選んで漫画と同時に再生"
            >
              <Film className="h-3.5 w-3.5" />
              <span>動画同時</span>
            </button>
          )}

          {/* Auto-Slide Quick Toggle */}
          <button
            type="button"
            onClick={() => setAutoSlide((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              autoSlide
                ? "border-rose-500 bg-rose-600 text-white shadow-sm shadow-rose-600/40"
                : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-rose-500/50 hover:bg-zinc-800"
            }`}
            title="自動スライド切替 (Space)"
          >
            {autoSlide ? (
              <>
                <Pause className="h-3.5 w-3.5 fill-current" />
                <span>停止</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>自動スライド</span>
              </>
            )}
          </button>

          {/* Auto-Slide Speed Settings Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSpeedPanelOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 font-mono text-xs font-semibold transition ${
                speedPanelOpen
                  ? "border-rose-500/60 bg-rose-500/15 text-rose-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
              }`}
              title="自動スライドの秒数設定"
            >
              <Timer className="h-3.5 w-3.5" />
              <span>{slideSec}秒</span>
            </button>

            {speedPanelOpen && (
              <div className="absolute right-0 top-10 z-40 w-64 rounded-2xl border border-zinc-700 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur-xl">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-bold text-white">スライド間隔</span>
                  <span className="font-mono font-bold text-rose-400">{slideSec} 秒 / ページ</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.5}
                  value={slideSec}
                  onChange={(e) => setSlideSec(Number(e.target.value))}
                  className="mb-3 h-1.5 w-full cursor-pointer accent-rose-500"
                />
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {SLIDE_INTERVAL_PRESETS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setSlideSec(sec)}
                      className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition ${
                        slideSec === sec
                          ? "bg-rose-600 text-white"
                          : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      {sec}秒
                    </button>
                  ))}
                </div>
                <label className="flex cursor-pointer items-center justify-between border-t border-zinc-800 pt-2.5 text-xs text-zinc-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5 text-emerald-400" />
                    最後まで行ったらループ
                  </span>
                  <input
                    type="checkbox"
                    checked={loopSlide}
                    onChange={(e) => setLoopSlide(e.target.checked)}
                    className="accent-rose-500"
                  />
                </label>
              </div>
            )}
          </div>

          {canSaveCoverThumb && (
            <button
              type="button"
              onClick={handleSetCurrentPageAsThumbnail}
              disabled={thumbSaving}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 transition hover:border-emerald-500/50 hover:bg-emerald-950/50 hover:text-emerald-200 disabled:opacity-50"
              title={`現在のページ (P.${pageIdx + 1}) を表紙サムネイルに設定`}
              aria-label="このページを表紙サムネイルに設定"
            >
              {thumbSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => onToggleFavorite(manga.id)}
            className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
              isFavorite
                ? "border-rose-500/40 bg-rose-500/20 text-rose-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
            }`}
            title="お気に入り"
          >
            <Heart className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
          </button>

          <button
            type="button"
            onClick={() => onEditTags(manga)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
            title="ジャンル編集"
          >
            <Tag className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setHudVisible(false);
              setSpeedPanelOpen(false);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            title="メニューを隠して画面を広く見る"
            aria-label="メニュー非表示"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Toast notice when setting manga cover thumbnail */}
      {thumbNotice && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-50 -translate-x-1/2 rounded-full border border-emerald-400/40 bg-black/80 px-4 py-1.5 text-xs font-semibold text-emerald-200 shadow-2xl backdrop-blur-xl">
          {thumbNotice}
        </div>
      )}

      {/* Floating Show-HUD Liquid Glass pill when HUD is hidden */}
      {!hudVisible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHudVisible(true);
          }}
          className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/[0.08] px-3 py-1.5 text-[11px] font-semibold text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition hover:bg-white/[0.16] hover:text-white"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>メニュー</span>
        </button>
      )}

      {/* Main Manga Canvas */}
      {totalPages === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-zinc-400">
          <BookOpen className="h-8 w-8 text-zinc-600" />
          <p className="text-sm">表示できるページが見つかりませんでした</p>
        </div>
      ) : readingMode === "vertical" ? (
        <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#060609]">
          {/* Apple Liquid Glass Ambient Backdrop behind vertical margins */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {primaryUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryUrl}
                alt=""
                aria-hidden="true"
                className="h-full w-full scale-[1.28] object-cover opacity-80 blur-[52px] saturate-[1.85] brightness-[0.34] contrast-[1.1] transition-opacity duration-500"
                draggable={false}
              />
            )}
            <div
              className="absolute inset-0 backdrop-blur-3xl"
              style={{
                background:
                  "radial-gradient(ellipse 70% 55% at 15% 15%, rgba(255,255,255,0.12), transparent 60%), radial-gradient(ellipse 65% 55% at 88% 85%, rgba(255,255,255,0.09), transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(10,10,16,0.48) 48%, rgba(255,255,255,0.04) 100%)",
              }}
            />
            <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_0_90px_rgba(0,0,0,0.55)]" />
          </div>

          <div
            ref={verticalScrollRef}
            className="relative z-10 flex flex-1 flex-col items-center gap-0 overflow-y-auto bg-transparent p-0"
          >
            {pages.map((p, idx) => (
              <LazyVerticalMangaPage
                key={`${manga.id}-p-${idx}`}
                fileId={p.fileId}
                mimeType={p.mimeType}
                pageNumber={idx + 1}
                accessToken={accessToken}
                encrypted={Boolean(manga.encrypted)}
                masterKey={masterKey}
                onVisible={handleVerticalPageVisible}
                onAuthExpired={onAuthExpired}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          className="relative flex min-h-0 min-w-0 flex-1 cursor-pointer select-none items-center justify-center overflow-hidden bg-[#060609] p-0"
          onClick={(e) => handleTapZone(e.clientX, e.currentTarget.getBoundingClientRect())}
          onTouchStart={handlePullTouchStart}
          onTouchMove={(e) => handlePullTouchMove(e, true)}
          onTouchEnd={(e) => handlePullTouchEnd(e, true)}
          onTouchCancel={() => {
            pullGestureRef.current = null;
            setDragOffsetY(0);
          }}
        >
          {/* Apple Liquid Glass Ambient Backdrop for Empty Margins */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {primaryUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={primaryUrl}
                alt=""
                aria-hidden="true"
                className="h-full w-full scale-[1.28] object-cover opacity-80 blur-[52px] saturate-[1.85] brightness-[0.34] contrast-[1.1] transition-opacity duration-500"
                draggable={false}
              />
            )}
            <div
              className="absolute inset-0 backdrop-blur-3xl"
              style={{
                background:
                  "radial-gradient(ellipse 70% 55% at 15% 15%, rgba(255,255,255,0.12), transparent 60%), radial-gradient(ellipse 65% 55% at 88% 85%, rgba(255,255,255,0.09), transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(10,10,16,0.48) 48%, rgba(255,255,255,0.04) 100%)",
              }}
            />
            <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_0_90px_rgba(0,0,0,0.55)]" />
          </div>

          {loadingCurrent && !primaryUrl ? (
            <div className="relative z-10 flex flex-col items-center gap-2 text-zinc-300">
              <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
              <span className="font-mono text-xs">{pageIdx + 1} ページを復号中...</span>
            </div>
          ) : (
            <div
              className={`relative z-10 flex h-full min-h-0 w-full min-w-0 items-center justify-center gap-0 p-0 ${
                readingMode === "rtl" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {primaryUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={primaryUrl}
                  alt={`Page ${pageIdx + 1}`}
                  className={`max-h-full select-none object-contain drop-shadow-[0_18px_48px_rgba(0,0,0,0.85)] ${
                    secondaryUrl ? "h-full max-w-[50%]" : "h-full w-full max-w-full"
                  }`}
                  draggable={false}
                />
              )}
              {secondaryUrl && secondaryIdx !== null && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={secondaryUrl}
                  alt={`Page ${secondaryIdx + 1}`}
                  className="h-full max-h-full max-w-[50%] select-none object-contain drop-shadow-[0_18px_48px_rgba(0,0,0,0.85)]"
                  draggable={false}
                />
              )}
            </div>
          )}

          {/* Liquid Glass Left/Right Navigation Arrows when HUD visible */}
          {hudVisible && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (readingMode === "rtl") goNext();
                  else goPrev();
                }}
                className="absolute left-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition hover:bg-white/[0.16] hover:text-white sm:flex"
                title={readingMode === "rtl" ? "次のページ (←)" : "前のページ (←)"}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (readingMode === "rtl") goPrev();
                  else goNext();
                }}
                className="absolute right-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/[0.08] text-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition hover:bg-white/[0.16] hover:text-white sm:flex"
                title={readingMode === "rtl" ? "前のページ (→)" : "次のページ (→)"}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Bottom HUD Controls (Apple Liquid Glass) */}
      <footer
        className={`z-20 shrink-0 border-t border-white/15 bg-black/45 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl transition-opacity duration-200 sm:px-5 ${
          hudVisible ? "opacity-100" : "pointer-events-none h-0 overflow-hidden border-0 py-0 opacity-0"
        }`}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          {/* Page Scrubber with Video-Player-Style Floating Thumbnail Preview */}
          {readingMode !== "vertical" && totalPages > 1 && (() => {
            const displayIdx = isDraggingScrub && hoverScrub ? hoverScrub.idx : pageIdx;
            const activePct = (displayIdx / Math.max(1, totalPages - 1)) * 100;
            const hoverPct = hoverScrub
              ? (hoverScrub.idx / Math.max(1, totalPages - 1)) * 100
              : null;
            const thumbLeftPct = readingMode === "rtl" ? 100 - activePct : activePct;
            const cachePct = Math.min(100, (cachedCount / Math.max(1, totalPages)) * 100);
            const isRtl = readingMode === "rtl";

            return (
              <div className="flex items-center gap-3">
                <span
                  className={`w-12 text-right font-mono text-xs ${
                    isRtl ? "text-zinc-500" : "font-semibold text-zinc-200"
                  }`}
                >
                  {isRtl ? `${totalPages} P` : `${displayIdx + 1} P`}
                </span>

                <div
                  ref={scrubBarRef}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    isDraggingScrubRef.current = true;
                    setIsDraggingScrub(true);
                    try {
                      e.currentTarget.setPointerCapture(e.pointerId);
                    } catch {
                      // Ignore
                    }
                    const info = getScrubInfoFromClientX(e.clientX);
                    if (info) {
                      setHoverScrub(info);
                      setPageIdx(info.idx);
                    }
                  }}
                  onPointerMove={(e) => {
                    const info = getScrubInfoFromClientX(e.clientX);
                    if (info) {
                      setHoverScrub(info);
                      if (isDraggingScrubRef.current) {
                        setPageIdx(info.idx);
                      }
                    }
                  }}
                  onPointerUp={(e) => {
                    if (isDraggingScrubRef.current) {
                      isDraggingScrubRef.current = false;
                      setIsDraggingScrub(false);
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        // Ignore
                      }
                      const info = getScrubInfoFromClientX(e.clientX) ?? hoverScrub;
                      if (info) {
                        setPageIdx(info.idx);
                      }
                      if (e.pointerType !== "mouse") {
                        setHoverScrub(null);
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    isDraggingScrubRef.current = false;
                    setIsDraggingScrub(false);
                    setHoverScrub(null);
                  }}
                  onPointerLeave={() => {
                    if (!isDraggingScrubRef.current) {
                      setHoverScrub(null);
                    }
                  }}
                  className="group/seek relative flex h-6 flex-1 cursor-pointer touch-none items-center select-none"
                  role="slider"
                  aria-label="ページ移動"
                  aria-valuemin={1}
                  aria-valuemax={totalPages}
                  aria-valuenow={displayIdx + 1}
                >
                  {/* Floating Page Thumbnail Preview Popup (Apple Liquid Glass) */}
                  {hoverScrub && (
                    <div
                      className="pointer-events-none absolute bottom-8 z-30 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/20 bg-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_18px_48px_rgba(0,0,0,0.75)] backdrop-blur-2xl"
                      style={{
                        left: `${Math.min(88, Math.max(12, hoverScrub.visualRatio * 100))}%`,
                      }}
                    >
                      <div className="relative flex h-[164px] w-[118px] items-center justify-center overflow-hidden bg-[#060609] sm:h-[192px] sm:w-[138px]">
                        {hoverPreviewUrl ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={hoverPreviewUrl}
                              alt=""
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-80 blur-2xl saturate-[1.8] brightness-[0.34]"
                              draggable={false}
                            />
                            <div
                              className="pointer-events-none absolute inset-0 backdrop-blur-xl"
                              style={{
                                background:
                                  "radial-gradient(ellipse 75% 60% at 15% 15%, rgba(255,255,255,0.16), transparent 60%), linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(8,8,14,0.45) 55%, rgba(255,255,255,0.05) 100%)",
                              }}
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={hoverPreviewUrl}
                              alt={`Preview Page ${hoverScrub.idx + 1}`}
                              className="relative z-10 h-full w-full select-none object-contain drop-shadow-[0_6px_16px_rgba(0,0,0,0.85)]"
                              draggable={false}
                            />
                          </>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-zinc-300">
                            <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
                            <span className="font-mono text-[10px]">読込中...</span>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-white/10 bg-black/55 px-2.5 py-1 text-center font-mono text-xs font-bold text-white backdrop-blur-xl">
                        {hoverScrub.idx + 1} / {totalPages} P
                      </div>
                    </div>
                  )}

                  {/* Scrubber Rail */}
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/seek:h-2">
                    {/* Preloaded indicator */}
                    <div
                      className={`absolute inset-y-0 bg-emerald-400/25 transition-all duration-300 ${
                        isRtl ? "right-0" : "left-0"
                      }`}
                      style={{ width: `${cachePct}%` }}
                    />
                    {/* Hover target fill */}
                    {hoverPct !== null && (
                      <div
                        className={`absolute inset-y-0 bg-white/45 ${isRtl ? "right-0" : "left-0"}`}
                        style={{ width: `${hoverPct}%` }}
                      />
                    )}
                    {/* Active page fill */}
                    <div
                      className={`absolute inset-y-0 bg-rose-500 ${isRtl ? "right-0" : "left-0"}`}
                      style={{ width: `${activePct}%` }}
                    />
                  </div>

                  {/* Thumb Knob */}
                  <div
                    className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500 shadow-md ring-2 ring-white transition-transform ${
                      isDraggingScrub
                        ? "h-4 w-4 scale-110"
                        : "h-3.5 w-3.5 group-hover/seek:scale-110"
                    }`}
                    style={{ left: `${thumbLeftPct}%` }}
                  />
                </div>

                <span
                  className={`w-12 font-mono text-xs ${
                    isRtl ? "font-semibold text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  {isRtl ? `${displayIdx + 1} P` : `${totalPages} P`}
                </span>
              </div>
            );
          })()}

          {/* Reading Mode Switchers */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "rtl", label: "右開き(←次)" },
                  { id: "ltr", label: "左開き(次→)" },
                  { id: "vertical", label: "縦スクロール" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setReadingMode(m.id)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    readingMode === m.id
                      ? "border-rose-500 bg-rose-600 text-white"
                      : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {m.id === "vertical" && <Rows3 className="h-3 w-3" />}
                  {m.label}
                </button>
              ))}

              {readingMode !== "vertical" && (
                <button
                  type="button"
                  onClick={() =>
                    setSpreadMode((prev) => (prev === "single" ? "double" : "single"))
                  }
                  className={`ml-1 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    spreadMode === "double"
                      ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                      : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                  title="1ページ表示 / 見開き2ページ表示を切り替え"
                >
                  {spreadMode === "double" ? (
                    <>
                      <Columns2 className="h-3 w-3" />
                      見開き
                    </>
                  ) : (
                    <>
                      <Square className="h-3 w-3" />
                      単ページ
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPageIdx(0);
                  if (verticalScrollRef.current) {
                    verticalScrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-white"
                title="1ページ目へ戻る"
              >
                <RotateCcw className="h-3 w-3" />
                最初から
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* Sequel / Next Queue Item Floating Prompt when at the end of a manga */}
      {(nextManga || (nextQueueItem && onSelectQueueIndex && nextQueueTargetIdx >= 0)) &&
        totalPages > 0 &&
        (pageIdx >= totalPages - 1 || secondaryIdx === totalPages - 1) && (
          <div className="pointer-events-auto absolute bottom-20 left-1/2 z-30 w-[min(92vw,440px)] -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-2xl border border-amber-400/45 bg-zinc-950/92 p-2.5 shadow-2xl backdrop-blur-2xl">
              <PickerThumb
                item={(nextQueueItem ?? nextManga)!}
                accessToken={accessToken}
                masterKey={masterKey}
                thumbVersion={thumbVersions[(nextQueueItem ?? nextManga)!.id] ?? 0}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-amber-300">
                  {nextQueueItem ? "次のキュー作品" : "シリーズの続編"}
                </p>
                <p className="truncate text-xs font-semibold text-white">
                  {(nextQueueItem ?? nextManga)!.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (nextQueueItem && onSelectQueueIndex && nextQueueTargetIdx >= 0) {
                    onSelectQueueIndex(nextQueueTargetIdx);
                  } else if (nextManga && onSelectManga) {
                    onSelectManga(nextManga);
                  }
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-zinc-950 transition hover:bg-amber-300"
              >
                <span>{nextQueueItem ? "次へ" : "次の巻へ"}</span>
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

      {/* Queue Picker Modal */}
      {queuePickerOpen && queue.length > 0 && onSelectQueueIndex && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setQueuePickerOpen(false)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <ListMusic className="h-4 w-4 text-indigo-300" />
                <h3 className="text-sm font-bold text-white">
                  再生キュー（{queue.length} 件）
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                {onClearQueue && (
                  <button
                    type="button"
                    onClick={() => {
                      onClearQueue();
                      setQueuePickerOpen(false);
                    }}
                    className="rounded-lg border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  >
                    空にする
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setQueuePickerOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:bg-white/20 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {queue.map((item, idx) => {
                const isCurrent = item.id === manga.id;
                return (
                  <div
                    key={`${item.id}-${idx}`}
                    className={`flex items-center gap-2.5 rounded-xl border p-2 transition ${
                      isCurrent
                        ? "border-indigo-400/70 bg-indigo-500/15"
                        : "border-white/5 bg-white/[0.03] hover:border-indigo-400/40 hover:bg-white/[0.08]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectQueueIndex(idx);
                        setQueuePickerOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <PickerThumb
                        item={item}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        thumbVersion={thumbVersions[item.id] ?? 0}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            {idx + 1}
                          </span>
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                            {item.kind === "manga" ? "漫画" : "動画"}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-indigo-400/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                              現在
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-white">
                          {item.title}
                        </p>
                      </div>
                    </button>
                    {onRemoveFromQueue && (
                      <button
                        type="button"
                        onClick={() => onRemoveFromQueue(idx)}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                        title="キューから削除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Series & Related Works Picker Modal */}
      {seriesPickerOpen && (seriesManga.length > 1 || relatedWorks.length > 0) && onSelectManga && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={() => setSeriesPickerOpen(false)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-amber-300" />
                <h3 className="text-sm font-bold text-white">
                  {seriesManga.length > 1
                    ? `シリーズ（${seriesManga.length}巻）・関連作品`
                    : `同じ作者・制作・関連作品（${relatedWorks.length}件）`}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSeriesPickerOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {seriesManga.length > 1 &&
                seriesManga.map((vol, idx) => {
                  const isCurrent = vol.id === manga.id;
                  return (
                    <button
                      key={vol.id}
                      type="button"
                      onClick={() => {
                        onSelectManga(vol);
                        setSeriesPickerOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left transition ${
                        isCurrent
                          ? "border-amber-400/70 bg-amber-500/15"
                          : "border-white/5 bg-white/[0.03] hover:border-amber-400/40 hover:bg-white/[0.08]"
                      }`}
                    >
                      <PickerThumb
                        item={vol}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        thumbVersion={thumbVersions[vol.id] ?? 0}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                            #{idx + 1}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              読書中
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-white">
                          {vol.title}
                        </p>
                        {vol.pageCount ? (
                          <p className="font-mono text-[10px] text-zinc-400">{vol.pageCount} ページ</p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}

              {relatedWorks.length > 0 && (
                <div className={seriesManga.length > 1 ? "pt-3" : ""}>
                  <p className="mb-1.5 px-1 text-[11px] font-bold text-sky-300">
                    同じ制作会社・作者・関連作品
                  </p>
                  <div className="space-y-1.5">
                    {relatedWorks.map(({ item, sharedCredits }) => (
                      <button
                        key={`rel-${item.id}`}
                        type="button"
                        onClick={() => {
                          if (item.kind === "manga") {
                            onSelectManga(item);
                          } else {
                            onSelectVideo(item);
                          }
                          setSeriesPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-left transition hover:border-sky-400/40 hover:bg-white/[0.08]"
                      >
                        <PickerThumb
                          item={item}
                          accessToken={accessToken}
                          masterKey={masterKey}
                          thumbVersion={thumbVersions[item.id] ?? 0}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                              {item.kind === "manga" ? "漫画" : "動画"}
                            </span>
                            {sharedCredits.slice(0, 2).map((c) => (
                              <span
                                key={c}
                                className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-white">
                            {item.title}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* In-Reader Liquid Glass Video Picker for Simultaneous Video + Manga Mode */}
      {videoPickerOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 backdrop-blur-md sm:items-center"
          onClick={() => setVideoPickerOpen(false)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/90 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white">漫画と同時に再生する動画を選択</h3>
              </div>
              <button
                type="button"
                onClick={() => setVideoPickerOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-zinc-300 hover:bg-white/20 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-white/10 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={videoPickerQuery}
                  onChange={(e) => setVideoPickerQuery(e.target.value)}
                  placeholder="動画タイトルで絞り込み..."
                  className="w-full rounded-xl border border-white/10 bg-black/50 py-2 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-sky-400/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {linkedVideos.length > 0 && !videoPickerQuery.trim() && (
                <div className="mb-3 space-y-1.5 rounded-2xl border border-amber-400/30 bg-amber-500/[0.07] p-2.5">
                  <div className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-amber-200">
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    <span>この作品のアニメ（セット {linkedVideos.length}本）</span>
                  </div>
                  {linkedVideos.map((v) => (
                    <button
                      key={`linked-${v.id}`}
                      type="button"
                      onClick={() => {
                        onEnableSplitWithVideo();
                        onSelectVideo(v);
                        setVideoPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-amber-400/25 bg-black/45 p-2 text-left transition hover:border-amber-300/60 hover:bg-black/65"
                    >
                      <PickerThumb
                        item={v}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        thumbVersion={thumbVersions[v.id] ?? 0}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs font-semibold text-white">{v.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-amber-200/80">
                          {v.duration > 0 ? formatDuration(v.duration) : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {pickableVideos.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">一致する動画がありません</p>
              ) : (
                pickableVideos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      onEnableSplitWithVideo();
                      onSelectVideo(v);
                      setVideoPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-left transition hover:border-sky-400/40 hover:bg-white/[0.08]"
                  >
                    <PickerThumb
                      item={v}
                      accessToken={accessToken}
                      masterKey={masterKey}
                      thumbVersion={thumbVersions[v.id] ?? 0}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs font-semibold text-zinc-100">{v.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                        {v.duration > 0 ? formatDuration(v.duration) : ""}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
