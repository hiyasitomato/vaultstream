"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Camera,
  Check,
  FastForward,
  Film,
  Heart,
  ListChecks,
  ListMusic,
  ListPlus,
  Loader2,
  Lock,
  Maximize,
  Maximize2,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Rewind,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Tag,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  buildRewrittenHlsPlaylist,
  driveFetchBlobUrl,
  driveFetchCachedThumbnailUrl,
  formatBytes,
  formatDuration,
  getSegmentUrlForTime,
  prefetchHlsPlaylist,
  updateThumbnailInDrive,
  type SegmentTimelineEntry,
} from "@/lib/drive";
import { getGenreStyle } from "@/lib/genres";
import {
  abortLowPriorityPrefetches,
  createCachedDriveFragmentLoader,
  hasSegmentCache,
  prefetchSegmentUrl,
} from "@/lib/segmentCache";
import { saveVideoProgress } from "@/lib/storage";
import type {
  CustomGenreDef,
  PlaybackProgress,
  VaultVideoItem,
  VideoUserMeta,
} from "@/lib/types";
import VideoCard from "./VideoCard";

interface VideoPlayerModalProps {
  video: VaultVideoItem;
  allVideos: VaultVideoItem[];
  accessToken: string;
  masterKey: CryptoKey | null;
  genres: string[];
  customGenres: CustomGenreDef[];
  videoGenresMap: Record<string, string[]>;
  userMetaMap: Record<string, VideoUserMeta>;
  progressMap: Record<string, PlaybackProgress>;
  thumbVersions: Record<string, number>;
  isFavorite: boolean;
  relatedVideos: VaultVideoItem[];
  queue: VaultVideoItem[];
  queueIndex: number;
  initialProgress?: PlaybackProgress;
  initialStartTimeSec?: number | null;
  initialStartNonce?: number;
  thumbnailTimeSec?: number;
  onClose: () => void;
  onSelectVideo: (video: VaultVideoItem, startTimeSec?: number) => void;
  onSelectQueueIndex: (index: number) => void;
  onAddToQueue: (video: VaultVideoItem) => void;
  onRemoveFromQueue: (index: number) => void;
  onMoveQueueItem: (fromIndex: number, toIndex: number) => void;
  onClearQueue: () => void;
  onShuffleQueue: () => void;
  onToggleFavorite: (videoId: string) => void;
  onEditTags: (video: VaultVideoItem) => void;
  onClickGenre: (genre: string) => void;
  onProgressUpdated: (videoId: string, progress: PlaybackProgress) => void;
  onThumbnailUpdated: (videoId: string, capturedTimeSec: number) => void;
  onAuthExpired: () => void;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

interface WebKitVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitEnterFullscreen?: () => void;
}

function SmallThumb({
  video,
  accessToken,
  masterKey,
  thumbVersion = 0,
}: {
  video: VaultVideoItem;
  accessToken: string;
  masterKey: CryptoKey | null;
  thumbVersion?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!video.thumbnailFileId) {
      setUrl(null);
      return;
    }
    driveFetchCachedThumbnailUrl(
      video.thumbnailFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey
    )
      .then((u) => {
        if (active) setUrl(u);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [video.thumbnailFileId, video.encrypted, accessToken, masterKey, thumbVersion]);

  return (
    <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={video.title} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-700">
          <Film className="h-4 w-4" />
        </div>
      )}
      {video.duration > 0 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 font-mono text-[9px] font-semibold text-white">
          {formatDuration(video.duration)}
        </span>
      )}
    </div>
  );
}

export default function VideoPlayerModal({
  video,
  allVideos,
  accessToken,
  masterKey,
  genres,
  customGenres,
  videoGenresMap,
  userMetaMap,
  progressMap,
  thumbVersions,
  isFavorite,
  relatedVideos,
  queue,
  queueIndex,
  initialProgress,
  initialStartTimeSec = null,
  initialStartNonce = 0,
  thumbnailTimeSec,
  onClose,
  onSelectVideo,
  onSelectQueueIndex,
  onAddToQueue,
  onRemoveFromQueue,
  onMoveQueueItem,
  onClearQueue,
  onShuffleQueue,
  onToggleFavorite,
  onEditTags,
  onClickGenre,
  onProgressUpdated,
  onThumbnailUpdated,
  onAuthExpired,
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const initialProgressRef = useRef<PlaybackProgress | undefined>(initialProgress);
  const initialStartTimeSecRef = useRef<number | null>(initialStartTimeSec);
  const onAuthExpiredRef = useRef(onAuthExpired);
  const onProgressUpdatedRef = useRef(onProgressUpdated);
  const lastProgressSavedAtRef = useRef<number>(0);
  const countedPlayRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [qualityLabels, setQualityLabels] = useState<string[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1); // -1 = Auto ABR
  const [currentLevel, setCurrentLevel] = useState<number>(0);
  const [cacheProgress, setCacheProgress] = useState<{ cached: number; total: number }>({
    cached: 0,
    total: 0,
  });
  const [renditionTimelinesState, setRenditionTimelinesState] = useState<
    SegmentTimelineEntry[][]
  >([]);
  const hlsRef = useRef<Hls | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [durationSec, setDurationSec] = useState(video.duration || 0);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Storyboard sprite sheet (6x6) + instant poster for zero-black-screen TTFF
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [hoverSeekRatio, setHoverSeekRatio] = useState<number | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const seekPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<SegmentTimelineEntry[]>([]);
  const isDraggingSeekRef = useRef(false);

  const [thumbSaving, setThumbSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Native OS PiP + fallback mini player
  const [nativePipSupported, setNativePipSupported] = useState(false);
  const [isNativePipActive, setIsNativePipActive] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(false);

  // Below-player YouTube discovery feed state (progressive render for fast modal mount)
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseGenre, setBrowseGenre] = useState<string>("");
  const [visibleBrowseCount, setVisibleBrowseCount] = useState(12);

  const hasPrev = queue.length > 1 && queueIndex > 0;
  const hasNext = queue.length > 1 && queueIndex >= 0 && queueIndex < queue.length - 1;
  const queueIdSet = useMemo(() => new Set(queue.map((v) => v.id)), [queue]);

  const showToast = useCallback((msg: string, ms = 2600) => {
    setNotice(msg);
    setTimeout(() => {
      setNotice((cur) => (cur === msg ? null : cur));
    }, ms);
  }, []);

  useEffect(() => {
    initialProgressRef.current = initialProgress;
  }, [video.id]); // eslint-disable-line react-hooks/exhaustive-deps

  initialStartTimeSecRef.current = initialStartTimeSec;

  // If the user clicks a thumbnail timestamp badge while this same video is already loaded (e.g. mini-mode), jump immediately
  useEffect(() => {
    if (!initialStartNonce) return;
    setIsMiniMode(false);
    if (
      typeof initialStartTimeSec === "number" &&
      Number.isFinite(initialStartTimeSec) &&
      initialStartTimeSec >= 0
    ) {
      const el = videoRef.current;
      if (el && el.readyState >= 1) {
        el.currentTime = initialStartTimeSec;
        setCurrentTimeSec(initialStartTimeSec);
        el.play().catch(() => undefined);
      }
    }
  }, [initialStartNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onAuthExpiredRef.current = onAuthExpired;
  }, [onAuthExpired]);

  useEffect(() => {
    onProgressUpdatedRef.current = onProgressUpdated;
  }, [onProgressUpdated]);

  const checkNativePipSupport = useCallback(() => {
    const el = videoRef.current as WebKitVideoElement | null;
    if (!el) return;
    const standardSupported =
      typeof document !== "undefined" &&
      Boolean(document.pictureInPictureEnabled) &&
      typeof el.requestPictureInPicture === "function";
    const webkitSupported =
      typeof el.webkitSupportsPresentationMode === "function" &&
      el.webkitSupportsPresentationMode("picture-in-picture");
    setNativePipSupported(standardSupported || webkitSupported);
  }, []);

  useEffect(() => {
    let active = true;
    let hls: Hls | null = null;
    let urlsToRevoke: string[] = [];

    const videoEl = videoRef.current;
    if (!videoEl) return;

    const saved = initialProgressRef.current;
    const explicitStart = initialStartTimeSecRef.current;
    const hasExplicitStart =
      typeof explicitStart === "number" &&
      Number.isFinite(explicitStart) &&
      explicitStart >= 0;
    const resumePosition = hasExplicitStart
      ? explicitStart
      : saved &&
          saved.currentTime > 3 &&
          (saved.duration <= 0 || saved.currentTime < saved.duration - 5)
        ? saved.currentTime
        : 0;

    async function setupPlayback() {
      setLoading(true);
      setError(null);
      setSelectedLevel(-1);
      setCurrentLevel(0);

      try {
        if (video.kind === "hls" && video.manifest) {
          const built = await buildRewrittenHlsPlaylist(
            video.manifest,
            accessToken,
            masterKey
          );
          if (!active) {
            for (const u of built.objectUrlsToRevoke) URL.revokeObjectURL(u);
            return;
          }
          timelineRef.current = built.timeline;
          setRenditionTimelinesState(built.renditionTimelines);
          urlsToRevoke = built.objectUrlsToRevoke;
          setQualityLabels(built.qualityLabels);

          if (Hls.isSupported() && videoEl) {
            hls = new Hls({
              enableWorker: true,
              progressive: false,
              enableSoftwareAES: false,
              lowLatencyMode: false,
              autoStartLoad: true,
              startLevel: 0,
              startPosition: resumePosition > 0 ? resumePosition : -1,
              startFragPrefetch: true,
              maxBufferLength: 180,
              maxMaxBufferLength: 600,
              backBufferLength: 120,
              abrEwmaDefaultEstimate: 5_000_000,
              fLoader: createCachedDriveFragmentLoader(accessToken),
              xhrSetup: (xhr, url) => {
                if (url.startsWith("https://www.googleapis.com/")) {
                  xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
                }
              },
            });
            hlsRef.current = hls;

            hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
              if (active) setCurrentLevel(data.level);
            });

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!active || !videoEl) return;
              videoEl.playbackRate = playbackRate;
              setLoading(false);
              checkNativePipSupport();
              if (countedPlayRef.current !== video.id) {
                countedPlayRef.current = video.id;
                const updated = saveVideoProgress(
                  video.id,
                  resumePosition,
                  video.duration,
                  true
                );
                onProgressUpdatedRef.current(video.id, updated);
              }
              videoEl.play().catch(() => undefined);
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (!active) return;
              if (data.response?.code === 401) {
                onAuthExpiredRef.current();
                return;
              }
              if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  hls?.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  hls?.recoverMediaError();
                } else {
                  setError(`再生エラーが発生しました (${data.details})`);
                  setLoading(false);
                }
              }
            });

            hls.loadSource(built.playlistUrl);
            hls.attachMedia(videoEl);
          } else if (videoEl) {
            setError(
              "このブラウザでは hls.js がサポートされていません。Chrome / Edge / Safari 17+ をお試しください。"
            );
            setLoading(false);
          }
        } else if (video.directFileId && videoEl) {
          const blobUrl = await driveFetchBlobUrl(
            video.directFileId,
            accessToken,
            Boolean(video.encrypted),
            masterKey,
            video.mimeType || "video/mp4"
          );
          if (!active) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          urlsToRevoke = [blobUrl];
          setQualityLabels(["オリジナル"]);
          videoEl.src = blobUrl;
          videoEl.onloadedmetadata = () => {
            if (!active) return;
            if (resumePosition > 0) {
              videoEl.currentTime = resumePosition;
            }
            videoEl.playbackRate = playbackRate;
            setLoading(false);
            checkNativePipSupport();
            if (countedPlayRef.current !== video.id) {
              countedPlayRef.current = video.id;
              const updated = saveVideoProgress(
                video.id,
                resumePosition,
                videoEl.duration || video.duration,
                true
              );
              onProgressUpdatedRef.current(video.id, updated);
            }
            videoEl.play().catch(() => undefined);
          };
        } else {
          setError("再生可能な動画データが見つかりませんでした。");
          setLoading(false);
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof Error && err.message === "AUTH_EXPIRED") {
          onAuthExpiredRef.current();
          return;
        }
        setError(
          err instanceof Error ? err.message : "動画の読み込みに失敗しました"
        );
        setLoading(false);
      }
    }

    setupPlayback();

    return () => {
      active = false;
      hlsRef.current = null;
      if (hls) {
        hls.destroy();
      }
      for (const u of urlsToRevoke) {
        URL.revokeObjectURL(u);
      }
    };
  }, [video, accessToken, masterKey, checkNativePipSupport]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load cached poster immediately & encrypted 6x6 storyboard sprite sheet
  useEffect(() => {
    let active = true;
    setCurrentTimeSec(0);
    setDurationSec(video.duration || 0);
    setHoverSeekRatio(null);
    setVisibleBrowseCount(12);

    if (video.thumbnailFileId) {
      driveFetchCachedThumbnailUrl(
        video.thumbnailFileId,
        accessToken,
        Boolean(video.encrypted),
        masterKey,
        video.thumbnailModifiedTime
      )
        .then((url) => {
          if (active) setPosterUrl(url);
        })
        .catch(() => {
          if (active) setPosterUrl(null);
        });
    } else {
      setPosterUrl(null);
    }

    if (!video.spriteFileId) {
      setSpriteUrl(null);
      return;
    }

    driveFetchCachedThumbnailUrl(
      video.spriteFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey
    )
      .then((url) => {
        if (active) setSpriteUrl(url);
      })
      .catch(() => {
        if (active) setSpriteUrl(null);
      });

    return () => {
      active = false;
    };
  }, [
    video.id,
    video.thumbnailFileId,
    video.thumbnailModifiedTime,
    video.spriteFileId,
    video.encrypted,
    video.duration,
    accessToken,
    masterKey,
  ]);

  // Prefetch next queue video's playlist AND first segment for near-0ms transitions
  useEffect(() => {
    if (!hasNext) return;
    const nextVideo = queue[queueIndex + 1];
    if (!nextVideo?.manifest) return;
    prefetchHlsPlaylist(nextVideo.manifest, accessToken, masterKey);
    const timer = setTimeout(() => {
      const seg0Url = getSegmentUrlForTime(nextVideo.manifest, nextVideo.duration, 0);
      if (seg0Url) {
        prefetchSegmentUrl(seg0Url, accessToken);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [hasNext, queue, queueIndex, accessToken, masterKey]);

  const resolveExactSegmentUrl = useCallback(
    (targetSec: number): string | null => {
      const tl = timelineRef.current;
      if (tl.length > 0) {
        const hit =
          tl.find((seg) => targetSec >= seg.startSec && targetSec < seg.endSec) ??
          tl[tl.length - 1];
        return hit?.url ?? null;
      }
      return getSegmentUrlForTime(video.manifest, durationSec, targetSec);
    },
    [video.manifest, durationSec]
  );

  // Speculative seek-target segment prefetch when hovering over the seek bar (180ms intent)
  useEffect(() => {
    if (seekPrefetchTimerRef.current) {
      clearTimeout(seekPrefetchTimerRef.current);
      seekPrefetchTimerRef.current = null;
    }
    if (hoverSeekRatio === null || durationSec <= 0) return;

    seekPrefetchTimerRef.current = setTimeout(() => {
      const targetSec = hoverSeekRatio * durationSec;
      const segUrl = resolveExactSegmentUrl(targetSec);
      if (segUrl) {
        abortLowPriorityPrefetches(segUrl);
        prefetchSegmentUrl(segUrl, accessToken, "low");
      }
    }, 180);

    return () => {
      if (seekPrefetchTimerRef.current) {
        clearTimeout(seekPrefetchTimerRef.current);
      }
    };
  }, [hoverSeekRatio, durationSec, accessToken, resolveExactSegmentUrl]);

  // High-speed 6-parallel background full-video downloader while watching:
  // Saturates HTTP/2 multiplexing to pull the entire video into the 512MB LRU cache ASAP.
  // Because our custom hls.js loader joins in-flight prefetches seamlessly (zero duplicate bytes),
  // we don't stall behind normal playback — we race ahead so hls.js hits 0ms memory cache!
  useEffect(() => {
    if (loading || renditionTimelinesState.length === 0) {
      setCacheProgress({ cached: 0, total: 0 });
      return;
    }

    const targetLevelIdx =
      selectedLevel >= 0
        ? Math.min(selectedLevel, renditionTimelinesState.length - 1)
        : renditionTimelinesState.length - 1;
    const timeline = renditionTimelinesState[targetLevelIdx] ?? [];
    if (timeline.length === 0) {
      setCacheProgress({ cached: 0, total: 0 });
      return;
    }

    timelineRef.current = timeline;

    let cancelled = false;
    const updateStats = () => {
      if (cancelled) return;
      let count = 0;
      for (const seg of timeline) {
        if (hasSegmentCache(seg.url)) count += 1;
      }
      setCacheProgress({ cached: count, total: timeline.length });
    };
    updateStats();

    // Keep progress % live even as hls.js itself caches segments
    const statsInterval = setInterval(updateStats, 800);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const runFullDownload = async () => {
      await sleep(200);
      if (cancelled) return;

      const curPos = videoRef.current?.currentTime ?? 0;
      const startIdx = Math.max(
        0,
        timeline.findIndex((s) => curPos >= s.startSec && curPos < s.endSec)
      );

      // Build queue: current -> end, then 0 -> startIdx - 1
      const pendingUrls: string[] = [];
      for (let i = startIdx; i < timeline.length; i += 1) {
        pendingUrls.push(timeline[i].url);
      }
      for (let i = 0; i < startIdx; i += 1) {
        pendingUrls.push(timeline[i].url);
      }

      const retryCounts = new Map<string, number>();

      const worker = async () => {
        while (!cancelled) {
          let nextUrl: string | undefined;
          while (pendingUrls.length > 0) {
            const candidate = pendingUrls.shift();
            if (candidate && !hasSegmentCache(candidate)) {
              nextUrl = candidate;
              break;
            }
          }
          if (!nextUrl) return;

          try {
            const p = prefetchSegmentUrl(nextUrl, accessToken, "low");
            if (p) await p;
          } catch {
            // Re-queue if aborted by a user seek (up to 3 retries)
            const tries = (retryCounts.get(nextUrl) ?? 0) + 1;
            if (tries <= 3 && !cancelled) {
              retryCounts.set(nextUrl, tries);
              await sleep(250);
              pendingUrls.push(nextUrl);
            }
          }
          updateStats();
        }
      };

      // 6 parallel HTTP/2 streams for maximum Drive download throughput
      await Promise.all(Array.from({ length: 6 }, () => worker()));
      updateStats();
    };

    runFullDownload();

    return () => {
      cancelled = true;
      clearInterval(statsInterval);
    };
  }, [loading, renditionTimelinesState, selectedLevel, accessToken, video.id]);

  const handleSelectQualityLevel = (levelIndex: number) => {
    setSelectedLevel(levelIndex);
    setQualityMenuOpen(false);
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = levelIndex; // -1 = Auto ABR, 0 = fast low-res, 1 = high-res
    showToast(
      levelIndex === -1
        ? "画質: 自動（高速スタート → 高画質）"
        : `画質: ${qualityLabels[levelIndex] ?? ""}`
    );
  };

  useEffect(() => {
    const el = videoRef.current as WebKitVideoElement | null;
    if (!el) return;

    checkNativePipSupport();

    const onEnterPip = () => setIsNativePipActive(true);
    const onLeavePip = () => setIsNativePipActive(false);
    const onWebkitModeChange = () => {
      const active = el.webkitPresentationMode === "picture-in-picture";
      setIsNativePipActive(active);
    };
    const onPlayState = () => setIsPaused(el.paused);

    el.addEventListener("loadedmetadata", checkNativePipSupport);
    el.addEventListener("canplay", checkNativePipSupport);
    el.addEventListener("enterpictureinpicture", onEnterPip);
    el.addEventListener("leavepictureinpicture", onLeavePip);
    el.addEventListener("webkitpresentationmodechanged", onWebkitModeChange);
    el.addEventListener("play", onPlayState);
    el.addEventListener("pause", onPlayState);

    return () => {
      el.removeEventListener("loadedmetadata", checkNativePipSupport);
      el.removeEventListener("canplay", checkNativePipSupport);
      el.removeEventListener("enterpictureinpicture", onEnterPip);
      el.removeEventListener("leavepictureinpicture", onLeavePip);
      el.removeEventListener("webkitpresentationmodechanged", onWebkitModeChange);
      el.removeEventListener("play", onPlayState);
      el.removeEventListener("pause", onPlayState);
    };
  }, [video.id, checkNativePipSupport]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: video.title,
        artist: "VaultStream",
      });
      navigator.mediaSession.setActionHandler(
        "previoustrack",
        hasPrev ? () => onSelectQueueIndex(queueIndex - 1) : null
      );
      navigator.mediaSession.setActionHandler(
        "nexttrack",
        hasNext ? () => onSelectQueueIndex(queueIndex + 1) : null
      );
    } catch {
      // Ignore
    }
  }, [video.title, hasPrev, hasNext, queueIndex, onSelectQueueIndex]);

  const handleToggleNativePip = async () => {
    const el = videoRef.current as WebKitVideoElement | null;
    if (!el) return;

    try {
      // iOS / iPadOS Safari WebKit PiP
      if (
        typeof el.webkitSupportsPresentationMode === "function" &&
        typeof el.webkitSetPresentationMode === "function" &&
        el.webkitSupportsPresentationMode("picture-in-picture")
      ) {
        const nextMode =
          el.webkitPresentationMode === "picture-in-picture"
            ? "inline"
            : "picture-in-picture";
        el.webkitSetPresentationMode(nextMode);
        return;
      }

      // Standard PiP API (PC Chrome / Edge / Safari / Android Chrome)
      if (
        typeof document !== "undefined" &&
        document.pictureInPictureEnabled &&
        typeof el.requestPictureInPicture === "function"
      ) {
        if (document.pictureInPictureElement === el) {
          await document.exitPictureInPicture();
        } else {
          if (el.readyState < 1) {
            await el.play().catch(() => undefined);
          }
          await el.requestPictureInPicture();
        }
        return;
      }

      // Fallback on browsers without native OS PiP
      setIsMiniMode(true);
    } catch {
      setIsMiniMode(true);
    }
  };

  const bumpControlsVisibility = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (
        videoRef.current &&
        !videoRef.current.paused &&
        !isDraggingSeekRef.current
      ) {
        setControlsVisible(false);
        setSpeedMenuOpen(false);
      }
    }, 2600);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const container = playerContainerRef.current;
    const videoEl = videoRef.current as WebKitVideoElement | null;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (container && typeof container.requestFullscreen === "function") {
        await container.requestFullscreen();
        return;
      }
      if (videoEl && typeof videoEl.webkitEnterFullscreen === "function") {
        videoEl.webkitEnterFullscreen();
      }
    } catch {
      if (videoEl && typeof videoEl.webkitEnterFullscreen === "function") {
        try {
          videoEl.webkitEnterFullscreen();
        } catch {
          // Ignore
        }
      }
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setIsMuted(el.muted);
  }, []);

  const handleVolumeChange = useCallback((nextVol: number) => {
    const clamped = Math.min(1, Math.max(0, nextVol));
    setVolume(clamped);
    const el = videoRef.current;
    if (!el) return;
    el.volume = clamped;
    if (clamped === 0) {
      el.muted = true;
      setIsMuted(true);
    } else if (el.muted) {
      el.muted = false;
      setIsMuted(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMiniMode) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const videoEl = videoRef.current;
      if (event.key === "Escape" && !document.fullscreenElement) {
        setIsMiniMode(true);
        return;
      }
      if (!videoEl) return;
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
        videoEl.currentTime = Math.min(
          videoEl.duration || Infinity,
          videoEl.currentTime + 10
        );
        bumpControlsVisibility();
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
        bumpControlsVisibility();
      } else if (event.key === " " || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (videoEl.paused) {
          videoEl.play().catch(() => undefined);
        } else {
          videoEl.pause();
        }
        bumpControlsVisibility();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        handleToggleFullscreen();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        handleToggleMute();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        handleVolumeChange((videoEl.muted ? 0 : videoEl.volume) + 0.1);
        bumpControlsVisibility();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        handleVolumeChange((videoEl.muted ? 0 : videoEl.volume) - 0.1);
        bumpControlsVisibility();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isMiniMode,
    onClose,
    bumpControlsVisibility,
    handleToggleFullscreen,
    handleToggleMute,
    handleVolumeChange,
  ]);

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.currentTime)) return;
    setCurrentTimeSec(el.currentTime);
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : video.duration;
    if (dur > 0) {
      setDurationSec(dur);
      if (el.buffered.length > 0) {
        const bufEnd = el.buffered.end(el.buffered.length - 1);
        setBufferedPercent(Math.min(100, Math.max(0, (bufEnd / dur) * 100)));
      }
    }
    const now = Date.now();
    if (now - lastProgressSavedAtRef.current < 2000) return;
    lastProgressSavedAtRef.current = now;
    const updated = saveVideoProgress(video.id, el.currentTime, dur, false);
    onProgressUpdated(video.id, updated);
  };

  const getSeekRatioFromClientX = (clientX: number): number => {
    const bar = seekBarRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handleSeekToClientX = (clientX: number) => {
    const el = videoRef.current;
    if (!el || durationSec <= 0) return;
    const ratio = getSeekRatioFromClientX(clientX);
    const targetTime = ratio * durationSec;
    const targetSegUrl = resolveExactSegmentUrl(targetTime);
    abortLowPriorityPrefetches(targetSegUrl ?? undefined);
    // In Auto ABR mode with multiple qualities, grab lightweight 360p chunk first on seek for instant playback
    if (hlsRef.current && selectedLevel === -1 && qualityLabels.length > 1) {
      hlsRef.current.nextLoadLevel = 0;
    }
    el.currentTime = targetTime;
    setCurrentTimeSec(targetTime);
  };

  const seekHoverFrameIdx =
    hoverSeekRatio !== null
      ? Math.min(35, Math.max(0, Math.floor(hoverSeekRatio * 36)))
      : 0;
  const seekHoverCol = seekHoverFrameIdx % 6;
  const seekHoverRow = Math.floor(seekHoverFrameIdx / 6);
  const playedPercent =
    durationSec > 0 ? Math.min(100, Math.max(0, (currentTimeSec / durationSec) * 100)) : 0;

  const effectiveThumbTimeSec =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec)
      ? thumbnailTimeSec
      : (durationSec || video.duration) > 2
        ? Math.min(Math.max((durationSec || video.duration) * 0.1, 1), 15)
        : 0;
  const isCustomThumbTime =
    typeof thumbnailTimeSec === "number" && Number.isFinite(thumbnailTimeSec);
  const thumbMarkerPercent =
    durationSec > 0
      ? Math.min(100, Math.max(0, (effectiveThumbTimeSec / durationSec) * 100))
      : null;

  const handleEnded = () => {
    if (hasNext) {
      onSelectQueueIndex(queueIndex + 1);
    }
  };

  const handleSeekOffset = (deltaSeconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(
      0,
      Math.min(el.duration || Infinity, el.currentTime + deltaSeconds)
    );
  };

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const handleTogglePlayPause = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  };

  const handleCaptureThumbnail = async () => {
    const el = videoRef.current;
    if (!el || !video.thumbnailFileId) return;
    if (el.readyState < 2 || el.videoWidth === 0 || el.videoHeight === 0) {
      showToast("動画フレームの読み込み後に押してください");
      return;
    }

    setThumbSaving(true);
    try {
      const targetWidth = 640;
      const targetHeight = Math.max(
        2,
        Math.round((el.videoHeight / el.videoWidth) * targetWidth)
      );
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas の初期化に失敗しました");
      ctx.drawImage(el, 0, 0, targetWidth, targetHeight);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.86)
      );
      if (!blob) throw new Error("フレーム画像の生成に失敗しました");

      const capturedSec = Math.max(0, Math.round(el.currentTime * 10) / 10);
      const jpegBytes = new Uint8Array(await blob.arrayBuffer());
      await updateThumbnailInDrive(
        video.thumbnailFileId,
        jpegBytes,
        accessToken,
        Boolean(video.encrypted),
        masterKey
      );
      onThumbnailUpdated(video.id, capturedSec);
      showToast(`${formatDuration(capturedSec)} のシーンをサムネイルに保存しました！`);
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_EXPIRED") {
        onAuthExpiredRef.current();
        return;
      }
      showToast(
        err instanceof Error
          ? err.message
          : "サムネイル保存に失敗しました（再ログインをお試しください）",
        4000
      );
    } finally {
      setThumbSaving(false);
    }
  };

  const handleCloseAll = () => {
    if (typeof document !== "undefined" && document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => undefined);
    }
    onClose();
  };

  // All available genres for the below-player YouTube discovery feed
  const browseGenreList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of allVideos) {
      for (const g of videoGenresMap[v.id] ?? []) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [allVideos, videoGenresMap]);

  // Videos shown below the player (YouTube watch-page feed)
  const browseVideos = useMemo(() => {
    let list = allVideos.filter((v) => v.id !== video.id);
    if (browseGenre) {
      list = list.filter((v) => (videoGenresMap[v.id] ?? []).includes(browseGenre));
    }
    const tokens = browseQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      list = list.filter((v) => {
        const hay = [v.title, v.sourceFileName ?? "", ...(videoGenresMap[v.id] ?? [])]
          .join(" ")
          .toLowerCase();
        return tokens.every((t) =>
          t.startsWith("-") && t.length > 1 ? !hay.includes(t.slice(1)) : hay.includes(t)
        );
      });
    }
    return list;
  }, [allVideos, video.id, browseGenre, browseQuery, videoGenresMap]);

  return (
    <div
      className={
        isMiniMode
          ? "fixed bottom-16 right-3 z-50 w-[290px] overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl shadow-black/90 sm:w-[340px] md:bottom-5 md:right-5"
          : "fixed inset-0 z-50 flex flex-col bg-[#0b0b0e]"
      }
      role="dialog"
      aria-modal={!isMiniMode}
      aria-label={video.title}
    >
      {/* YouTube Watch-Page Top Navigation Bar */}
      {!isMiniMode && (
        <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800/80 bg-[#0b0b0e]/95 px-3 py-2.5 backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setIsMiniMode(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
              title="再生を続けたままホームへ戻る"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>ホームへ戻る</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-zinc-400 sm:inline">
              キュー {queueIndex + 1} / {queue.length}
            </span>
            <button
              type="button"
              onClick={handleCloseAll}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-rose-500/40 hover:bg-rose-950/30 hover:text-rose-200"
              aria-label="再生を終了して閉じる"
            >
              <X className="h-3.5 w-3.5" />
              <span>閉じる</span>
            </button>
          </div>
        </header>
      )}

      {/* Main Scrollable YouTube Watch Layout */}
      <div
        className={
          isMiniMode
            ? "flex flex-col"
            : "flex-1 overflow-y-auto"
        }
      >
        <div
          className={
            isMiniMode
              ? "flex flex-col"
              : "mx-auto flex max-w-[1600px] flex-col gap-6 px-3 py-4 sm:px-5 lg:flex-row lg:items-start"
          }
        >
          {/* LEFT MAIN COLUMN: Video + Meta/Controls + Below-Video Search & Browse Feed */}
          <div className={isMiniMode ? "w-full" : "min-w-0 flex-1"}>
            {/* Custom Unified YouTube-style Video Player Container */}
            <div
              ref={playerContainerRef}
              onMouseMove={bumpControlsVisibility}
              onMouseLeave={() => {
                if (!isPaused && !isDraggingSeekRef.current) {
                  setControlsVisible(false);
                  setSpeedMenuOpen(false);
                }
              }}
              className={
                isMiniMode
                  ? "relative aspect-video w-full bg-black"
                  : isFullscreen
                    ? "relative flex h-screen w-screen items-center justify-center bg-black"
                    : "relative aspect-video max-h-[72vh] w-full overflow-hidden rounded-2xl bg-black ring-1 ring-zinc-800/80"
              }
            >
              <video
                ref={videoRef}
                controls={false}
                playsInline
                preload="auto"
                poster={posterUrl ?? undefined}
                onClick={() => {
                  if (!isMiniMode) {
                    handleTogglePlayPause();
                    bumpControlsVisibility();
                  }
                }}
                onDoubleClick={() => {
                  if (!isMiniMode) handleToggleFullscreen();
                }}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                className="h-full w-full cursor-pointer object-contain"
              />

              {loading && !error && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                  <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
                  {!isMiniMode && (
                    <p className="text-sm text-zinc-200">Google Drive から読み込み中...</p>
                  )}
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-950/95 p-4 text-center">
                  <AlertCircle className="h-7 w-7 text-rose-400" />
                  <p className="max-w-md text-xs text-zinc-200 sm:text-sm">{error}</p>
                </div>
              )}

              {/* Center Play Badge when paused */}
              {!isMiniMode && !loading && !error && isPaused && (
                <button
                  type="button"
                  onClick={() => {
                    handleTogglePlayPause();
                    bumpControlsVisibility();
                  }}
                  className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-2xl ring-1 ring-white/25 backdrop-blur-md transition hover:scale-105 hover:bg-rose-600/90"
                  aria-label="再生"
                >
                  <Play className="ml-1 h-8 w-8 fill-current" />
                </button>
              )}

              {/* Documents-style top-right PiP button overlaid directly on the video */}
              {!isMiniMode && !loading && !error && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleNativePip();
                  }}
                  className={`absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-opacity duration-200 ${
                    controlsVisible || isPaused || isNativePipActive
                      ? "opacity-100"
                      : "pointer-events-none opacity-0"
                  } ${
                    isNativePipActive
                      ? "border-rose-400/70 bg-rose-600/90 text-white shadow-lg"
                      : "border-white/20 bg-black/55 text-white/90 hover:bg-black/80 hover:text-white"
                  }`}
                  title={isNativePipActive ? "ピクチャーインピクチャーを終了" : "ピクチャーインピクチャー"}
                  aria-label="ピクチャーインピクチャー"
                >
                  <PictureInPicture2 className="h-5 w-5" />
                </button>
              )}

              {/* Unified YouTube-style Bottom Overlay Controls (Single Bar with Preview Seek!) */}
              {!isMiniMode && !error && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-200 sm:px-4 ${
                    controlsVisible || isPaused || hoverSeekRatio !== null || speedMenuOpen || qualityMenuOpen
                      ? "opacity-100"
                      : "pointer-events-none opacity-0"
                  }`}
                >
                  {/* Integrated Seek Bar with Hover Storyboard Preview */}
                  <div
                    ref={seekBarRef}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      isDraggingSeekRef.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setHoverSeekRatio(getSeekRatioFromClientX(e.clientX));
                      handleSeekToClientX(e.clientX);
                      bumpControlsVisibility();
                    }}
                    onPointerMove={(e) => {
                      const ratio = getSeekRatioFromClientX(e.clientX);
                      setHoverSeekRatio(ratio);
                      if (isDraggingSeekRef.current) {
                        handleSeekToClientX(e.clientX);
                      }
                    }}
                    onPointerUp={(e) => {
                      if (isDraggingSeekRef.current) {
                        isDraggingSeekRef.current = false;
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          // Ignore
                        }
                      }
                    }}
                    onPointerLeave={() => {
                      if (!isDraggingSeekRef.current) {
                        setHoverSeekRatio(null);
                      }
                    }}
                    className="group/seek relative mb-2 flex h-5 w-full cursor-pointer touch-none items-center select-none"
                    role="slider"
                    aria-label="シークバー"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(durationSec)}
                    aria-valuenow={Math.round(currentTimeSec)}
                  >
                    {/* Floating Thumbnail Preview Popup on Hover */}
                    {hoverSeekRatio !== null && durationSec > 0 && (
                      <div
                        className="pointer-events-none absolute bottom-7 z-30 -translate-x-1/2 overflow-hidden rounded-xl border border-white/20 bg-zinc-950 shadow-2xl shadow-black"
                        style={{
                          left: `${Math.min(88, Math.max(12, hoverSeekRatio * 100))}%`,
                        }}
                      >
                        {spriteUrl && (
                          <div
                            className="h-[108px] w-[192px] bg-black bg-no-repeat"
                            style={{
                              backgroundImage: `url(${spriteUrl})`,
                              backgroundSize: "600% 600%",
                              backgroundPosition: `${(seekHoverCol / 5) * 100}% ${(seekHoverRow / 5) * 100}%`,
                            }}
                          />
                        )}
                        <div className="bg-black/90 px-2.5 py-1 text-center font-mono text-xs font-bold text-white">
                          {formatDuration(hoverSeekRatio * durationSec)}
                        </div>
                      </div>
                    )}

                    {/* Track: full-cache + buffered + hover + played */}
                    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/seek:h-1.5">
                      {cacheProgress.total > 0 && (
                        <div
                          className="absolute inset-y-0 left-0 bg-emerald-400/30 transition-all duration-300"
                          style={{
                            width: `${Math.min(
                              100,
                              (cacheProgress.cached / cacheProgress.total) * 100
                            )}%`,
                          }}
                        />
                      )}
                      <div
                        className="absolute inset-y-0 left-0 bg-white/45"
                        style={{ width: `${bufferedPercent}%` }}
                      />
                      {hoverSeekRatio !== null && (
                        <div
                          className="absolute inset-y-0 left-0 bg-white/55"
                          style={{ width: `${hoverSeekRatio * 100}%` }}
                        />
                      )}
                      <div
                        className="absolute inset-y-0 left-0 bg-rose-500"
                        style={{ width: `${playedPercent}%` }}
                      />
                    </div>

                    {/* Thumbnail scene timestamp tick marker on seek bar */}
                    {thumbMarkerPercent !== null && (
                      <div
                        className={`pointer-events-none absolute top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                          isCustomThumbTime
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                            : "bg-emerald-300/70"
                        }`}
                        style={{ left: `${thumbMarkerPercent}%` }}
                        title={`サムネイルの位置: ${formatDuration(effectiveThumbTimeSec)}`}
                      />
                    )}

                    {/* Playhead dot */}
                    <div
                      className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-rose-500 shadow ring-2 ring-white transition-transform group-hover/seek:scale-100"
                      style={{ left: `${playedPercent}%` }}
                    />
                  </div>

                  {/* Bottom Buttons Row */}
                  <div className="flex items-center justify-between gap-2 text-white">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          handleTogglePlayPause();
                          bumpControlsVisibility();
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/15"
                        title={isPaused ? "再生 (Space)" : "一時停止 (Space)"}
                      >
                        {isPaused ? (
                          <Play className="h-4 w-4 fill-current" />
                        ) : (
                          <Pause className="h-4 w-4 fill-current" />
                        )}
                      </button>

                      {hasPrev && (
                        <button
                          type="button"
                          onClick={() => onSelectQueueIndex(queueIndex - 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/15"
                          title="前の動画"
                        >
                          <SkipBack className="h-4 w-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          handleSeekOffset(-10);
                          bumpControlsVisibility();
                        }}
                        className="flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium transition hover:bg-white/15"
                        title="10秒戻す (←)"
                      >
                        <Rewind className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">10</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          handleSeekOffset(10);
                          bumpControlsVisibility();
                        }}
                        className="flex h-8 items-center gap-0.5 rounded-lg px-1.5 text-[11px] font-medium transition hover:bg-white/15"
                        title="10秒進む (→)"
                      >
                        <FastForward className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">10</span>
                      </button>

                      {hasNext && (
                        <button
                          type="button"
                          onClick={() => onSelectQueueIndex(queueIndex + 1)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/15"
                          title="次の動画"
                        >
                          <SkipForward className="h-4 w-4" />
                        </button>
                      )}

                      {/* Volume */}
                      <div className="hidden items-center gap-1 sm:flex">
                        <button
                          type="button"
                          onClick={handleToggleMute}
                          className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/15"
                          title="ミュート (M)"
                        >
                          {isMuted || volume === 0 ? (
                            <VolumeX className="h-4 w-4" />
                          ) : (
                            <Volume2 className="h-4 w-4" />
                          )}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={(e) => handleVolumeChange(Number(e.target.value))}
                          className="h-1 w-16 cursor-pointer accent-rose-500"
                          aria-label="音量"
                        />
                      </div>

                      <span className="ml-1 font-mono text-[11px] text-zinc-200 sm:text-xs">
                        {formatDuration(currentTimeSec)}{" "}
                        <span className="text-zinc-400">/ {formatDuration(durationSec)}</span>
                      </span>
                    </div>

                    <div className="relative flex items-center gap-1 sm:gap-1.5">
                      {video.thumbnailFileId && (
                        <button
                          type="button"
                          onClick={handleCaptureThumbnail}
                          disabled={thumbSaving || loading}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-emerald-300 transition hover:bg-white/15 disabled:opacity-40"
                          title="いま表示中のシーンをサムネイルに設定"
                        >
                          {thumbSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : notice?.includes("サムネイルに保存") ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Camera className="h-4 w-4" />
                          )}
                          <span className="hidden md:inline">サムネ</span>
                        </button>
                      )}

                      {/* Quality selector (Auto ABR / 360p fast / HD) */}
                      {qualityLabels.length > 1 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setQualityMenuOpen((prev) => !prev);
                              setSpeedMenuOpen(false);
                            }}
                            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-sky-300 transition hover:bg-white/15"
                            title="画質を切り替え"
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                            <span>
                              {selectedLevel === -1
                                ? `自動(${(qualityLabels[currentLevel] ?? "").split(" ")[0]})`
                                : (qualityLabels[selectedLevel] ?? "").split(" ")[0]}
                            </span>
                          </button>
                          {qualityMenuOpen && (
                            <div className="absolute bottom-10 right-0 z-30 flex min-w-[155px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 py-1 shadow-2xl backdrop-blur-md">
                              <button
                                type="button"
                                onClick={() => handleSelectQualityLevel(-1)}
                                className={`px-3.5 py-1.5 text-left text-xs transition ${
                                  selectedLevel === -1
                                    ? "bg-rose-600 font-bold text-white"
                                    : "text-zinc-200 hover:bg-zinc-800"
                                }`}
                              >
                                自動 (高速スタート)
                              </button>
                              {qualityLabels.map((label, idx) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => handleSelectQualityLevel(idx)}
                                  className={`px-3.5 py-1.5 text-left text-xs transition ${
                                    selectedLevel === idx
                                      ? "bg-rose-600 font-bold text-white"
                                      : "text-zinc-200 hover:bg-zinc-800"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Playback speed selector */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setSpeedMenuOpen((prev) => !prev);
                            setQualityMenuOpen(false);
                          }}
                          className="flex h-8 items-center rounded-lg px-2 font-mono text-xs font-semibold transition hover:bg-white/15"
                          title="再生速度"
                        >
                          {playbackRate}x
                        </button>
                        {speedMenuOpen && (
                          <div className="absolute bottom-10 right-0 z-30 flex flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 py-1 shadow-2xl backdrop-blur-md">
                            {PLAYBACK_RATES.map((rate) => (
                              <button
                                key={rate}
                                type="button"
                                onClick={() => {
                                  handleRateChange(rate);
                                  setSpeedMenuOpen(false);
                                }}
                                className={`px-4 py-1.5 text-left font-mono text-xs transition ${
                                  playbackRate === rate
                                    ? "bg-rose-600 font-bold text-white"
                                    : "text-zinc-200 hover:bg-zinc-800"
                                }`}
                              >
                                {rate}x
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleToggleFullscreen}
                        className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/15"
                        title={isFullscreen ? "フルスクリーン終了 (F)" : "フルスクリーン (F)"}
                      >
                        {isFullscreen ? (
                          <Minimize className="h-4 w-4" />
                        ) : (
                          <Maximize className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Mini-mode top overlay */}
              {isMiniMode && (
                <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-2">
                  <button
                    type="button"
                    onClick={() => setIsMiniMode(false)}
                    className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm hover:bg-black"
                  >
                    <Maximize2 className="h-3 w-3" />
                    拡大
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseAll}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-zinc-200 backdrop-blur-sm hover:bg-black hover:text-white"
                    aria-label="閉じる"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Mini-mode bottom bar OR Full-mode YouTube Info + Controls + Below-Video Discovery */}
            {isMiniMode ? (
              <div className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setIsMiniMode(false)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-semibold text-zinc-100">
                    {video.title}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    {queue.length > 1
                      ? `キュー ${queueIndex + 1} / ${queue.length}`
                      : "ミニプレイヤー再生中"}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {hasPrev && (
                    <button
                      type="button"
                      onClick={() => onSelectQueueIndex(queueIndex - 1)}
                      className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    >
                      <SkipBack className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleTogglePlayPause}
                    className="rounded-lg bg-zinc-800 p-1.5 text-white hover:bg-zinc-700"
                  >
                    {isPaused ? (
                      <Play className="h-4 w-4 fill-current" />
                    ) : (
                      <Pause className="h-4 w-4 fill-current" />
                    )}
                  </button>
                  {hasNext && (
                    <button
                      type="button"
                      onClick={() => onSelectQueueIndex(queueIndex + 1)}
                      className="rounded-lg p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    >
                      <SkipForward className="h-4 w-4" />
                    </button>
                  )}
                  {nativePipSupported && (
                    <button
                      type="button"
                      onClick={handleToggleNativePip}
                      className={`rounded-lg p-1.5 transition ${
                        isNativePipActive
                          ? "bg-rose-600 text-white"
                          : "text-indigo-300 hover:bg-zinc-800"
                      }`}
                    >
                      <PictureInPicture2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Title, meta, and YouTube action bar (clean — all playback controls are inside the video HUD!) */}
                <div className="mt-3.5 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h1 className="text-base font-bold leading-snug text-white sm:text-xl">
                        {video.title}
                      </h1>
                      <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-zinc-400">
                        {video.encrypted && (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <Lock className="h-2.5 w-2.5" />
                            E2EE 暗号化
                          </span>
                        )}
                        {video.duration > 0 && <span>{formatDuration(video.duration)}</span>}
                        {video.width && video.height && (
                          <span>
                            {video.width}×{video.height}
                          </span>
                        )}
                        {video.sizeBytes ? <span>{formatBytes(video.sizeBytes)}</span> : null}
                        {(durationSec || video.duration) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const el = videoRef.current;
                              if (!el) return;
                              el.currentTime = effectiveThumbTimeSec;
                              setCurrentTimeSec(effectiveThumbTimeSec);
                              showToast(
                                `サムネイルの位置 (${formatDuration(effectiveThumbTimeSec)}) へ移動しました`
                              );
                            }}
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
                              isCustomThumbTime
                                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                            }`}
                            title="クリックでサムネイルのシーンへジャンプ"
                          >
                            <Camera className="h-2.5 w-2.5" />
                            <span>サムネ {formatDuration(effectiveThumbTimeSec)}</span>
                          </button>
                        )}
                        {cacheProgress.total > 0 && (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                              cacheProgress.cached >= cacheProgress.total
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-zinc-800 text-zinc-300"
                            }`}
                          >
                            {cacheProgress.cached >= cacheProgress.total
                              ? "全編読込済 100%"
                              : `全編読込中 ${Math.round(
                                  (cacheProgress.cached / cacheProgress.total) * 100
                                )}%`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(video.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                          isFavorite
                            ? "border-rose-500/50 bg-rose-500/20 text-rose-300"
                            : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                        }`}
                      >
                        <Heart className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
                        <span>{isFavorite ? "お気に入り済" : "お気に入り"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditTags(video)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                      >
                        <Tag className="h-3.5 w-3.5" />
                        <span>ジャンル編集</span>
                      </button>
                    </div>
                  </div>

                  {notice && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-2 text-xs text-emerald-200">
                      {notice}
                    </div>
                  )}

                  {genres.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {genres.map((genre) => (
                        <button
                          key={genre}
                          type="button"
                          onClick={() => setBrowseGenre(genre)}
                          className={`rounded-md border px-2 py-0.5 text-xs font-medium transition hover:brightness-125 ${getGenreStyle(
                            genre,
                            customGenres
                          )}`}
                        >
                          #{genre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* BELOW-PLAYER YOUTUBE DISCOVERY & SEARCH FEED */}
                <section className="mt-7 border-t border-zinc-800/80 pt-5">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-sm font-bold text-white">
                      再生しながら他の動画を探す ({browseVideos.length} 件)
                    </h2>
                    <div className="relative w-full sm:max-w-xs">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="text"
                        value={browseQuery}
                        onChange={(e) => setBrowseQuery(e.target.value)}
                        placeholder="動画・ジャンルを検索..."
                        className="w-full rounded-full border border-zinc-800 bg-zinc-900 py-1.5 pl-8 pr-8 text-xs text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
                      />
                      {browseQuery && (
                        <button
                          type="button"
                          onClick={() => setBrowseQuery("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Genre chips below player */}
                  {browseGenreList.length > 0 && (
                    <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                      <button
                        type="button"
                        onClick={() => setBrowseGenre("")}
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          !browseGenre
                            ? "bg-white text-zinc-950"
                            : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                        }`}
                      >
                        すべて
                      </button>
                      {browseGenreList.map(([g, count]) => (
                        <button
                          key={`br-${g}`}
                          type="button"
                          onClick={() => setBrowseGenre(browseGenre === g ? "" : g)}
                          className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                            browseGenre === g
                              ? "border-rose-500 bg-rose-600 text-white"
                              : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          #{g} <span className="opacity-70">{count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Video cards grid right below the playing video */}
                  {browseVideos.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                      一致する動画がありません
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
                        {browseVideos.slice(0, visibleBrowseCount).map((item) => (
                          <VideoCard
                            key={`below-${item.id}`}
                            video={item}
                            accessToken={accessToken}
                            masterKey={masterKey}
                            genres={videoGenresMap[item.id] ?? []}
                            customGenres={customGenres}
                            isFavorite={Boolean(userMetaMap[item.id]?.favorite)}
                            isInQueue={queueIdSet.has(item.id)}
                            progress={progressMap[item.id]}
                            thumbnailTimeSec={userMetaMap[item.id]?.thumbnailTimeSec}
                            thumbVersion={thumbVersions[item.id] ?? 0}
                            onSelect={onSelectVideo}
                            onAddToQueue={onAddToQueue}
                            onToggleFavorite={onToggleFavorite}
                            onEditTags={onEditTags}
                            onClickGenre={(g) => setBrowseGenre(g)}
                          />
                        ))}
                      </div>
                      {browseVideos.length > visibleBrowseCount && (
                        <div className="mt-5 flex justify-center">
                          <button
                            type="button"
                            onClick={() => setVisibleBrowseCount((c) => c + 12)}
                            className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-2.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                          >
                            さらに表示（残り {browseVideos.length - visibleBrowseCount} 件）
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </section>
              </>
            )}
          </div>

          {/* RIGHT SIDEBAR (YouTube Watch-Page Queue + Up Next) */}
          {!isMiniMode && (
            <aside className="flex w-full shrink-0 flex-col gap-5 lg:sticky lg:top-4 lg:w-[360px] xl:w-[400px]">
              {/* Queue Box */}
              <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ListMusic className="h-4 w-4 text-rose-400" />
                    <span className="text-sm font-bold text-white">再生キュー</span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
                      {queueIndex + 1} / {queue.length}
                    </span>
                  </div>
                  {queue.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={onShuffleQueue}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                        title="キューをシャッフル"
                      >
                        <Shuffle className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={onClearQueue}
                        className="rounded-lg p-1.5 text-zinc-400 hover:bg-rose-950/60 hover:text-rose-300"
                        title="再生中以外をクリア"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="max-h-[340px] space-y-1.5 overflow-y-auto p-2.5">
                  {queue.map((item, idx) => {
                    const isCurrent = idx === queueIndex;
                    return (
                      <div
                        key={`${item.id}-${idx}`}
                        className={`group flex items-center gap-2 rounded-xl border p-2 transition ${
                          isCurrent
                            ? "border-rose-500/50 bg-rose-500/10"
                            : "border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectQueueIndex(idx)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${
                              isCurrent
                                ? "bg-rose-600 text-white"
                                : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {isCurrent ? (
                              <Play className="h-2.5 w-2.5 fill-current" />
                            ) : (
                              idx + 1
                            )}
                          </span>
                          <SmallThumb
                            video={item}
                            accessToken={accessToken}
                            masterKey={masterKey}
                            thumbVersion={thumbVersions[item.id] ?? 0}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`line-clamp-2 text-xs font-semibold leading-snug ${
                                isCurrent ? "text-white" : "text-zinc-200"
                              }`}
                            >
                              {item.title}
                            </p>
                          </div>
                        </button>

                        <div className="flex shrink-0 flex-col gap-0.5">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveQueueItem(idx, idx - 1)}
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                            title="上へ"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === queue.length - 1}
                            onClick={() => onMoveQueueItem(idx, idx + 1)}
                            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-25"
                            title="下へ"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => onRemoveFromQueue(idx)}
                              className="rounded p-1 text-zinc-400 hover:bg-rose-950/60 hover:text-rose-300"
                              title="削除"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Up Next / Related Videos (YouTube Right Column) */}
              {relatedVideos.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
                    次の動画・おすすめ
                  </h3>
                  <div className="space-y-2">
                    {relatedVideos.map((rel) => {
                      const inQ = queueIdSet.has(rel.id);
                      return (
                        <div
                          key={`rel-${rel.id}`}
                          className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-2 transition hover:border-zinc-700 hover:bg-zinc-900"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectVideo(rel)}
                            className="flex w-full items-start gap-2.5 text-left"
                          >
                            <SmallThumb
                              video={rel}
                              accessToken={accessToken}
                              masterKey={masterKey}
                              thumbVersion={thumbVersions[rel.id] ?? 0}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-xs font-semibold leading-snug text-zinc-100">
                                {rel.title}
                              </p>
                              <p className="mt-1 text-[10px] text-zinc-500">
                                {rel.height ? `${rel.height}p` : ""}
                                {rel.sizeBytes ? ` • ${formatBytes(rel.sizeBytes)}` : ""}
                              </p>
                            </div>
                          </button>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => onAddToQueue(rel)}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                                inQ
                                  ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-indigo-500/50 hover:text-indigo-200"
                              }`}
                            >
                              {inQ ? (
                                <>
                                  <ListChecks className="h-3 w-3" />
                                  キュー追加済み
                                </>
                              ) : (
                                <>
                                  <ListPlus className="h-3 w-3" />
                                  キューに追加
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
