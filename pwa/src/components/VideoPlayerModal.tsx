"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  FastForward,
  Film,
  Heart,
  Home,
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
  Sparkles,
  Tag,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Zap,
  ZoomIn,
} from "lucide-react";
import {
  buildRewrittenHlsPlaylist,
  driveFetchBlobUrl,
  driveFetchCachedThumbnailUrl,
  EMPTY_STRING_ARRAY,
  formatBytes,
  formatDuration,
  getCachedSpriteGrid,
  getCacheSegmentUrls,
  getSegmentUrlForTime,
  getSyncCachedThumbnailUrl,
  prefetchHlsPlaylist,
  prewarmVideoForInstantPlay,
  setCachedSpriteGrid,
  updateThumbnailInDrive,
  type SegmentTimelineEntry,
} from "@/lib/drive";
import { CATEGORY_TAG_SET, getContentGenresOnly, getGenreStyle } from "@/lib/genres";
import {
  abortLowPriorityPrefetches,
  createCachedDriveFragmentLoader,
  hasSegmentCache,
  prefetchSegmentUrl,
} from "@/lib/segmentCache";
import { getAllCachedKeys } from "@/lib/thumbDb";
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
  seriesVideos?: VaultVideoItem[];
  relatedVideos: VaultVideoItem[];
  queue: VaultVideoItem[];
  queueIndex: number;
  initialProgress?: PlaybackProgress;
  initialStartTimeSec?: number | null;
  initialStartNonce?: number;
  thumbnailTimeSec?: number;
  hasActiveManga?: boolean;
  linkedManga?: VaultVideoItem[];
  splitWithManga?: boolean;
  onToggleSplitWithManga?: () => void;
  onEnableSplitWithManga?: () => void;
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
  onThumbnailUpdated: (videoId: string, capturedTimeSec: number, updatedAtIso?: string) => void;
  onAuthExpired: () => void;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2];

function seededOrderHash(id: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
}

interface WebKitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebKitHTMLElement extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const SmallThumb = memo(function SmallThumb({
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
  const [url, setUrl] = useState<string | null>(() =>
    getSyncCachedThumbnailUrl(
      video.thumbnailFileId,
      Boolean(video.encrypted),
      video.thumbnailModifiedTime
    )
  );

  useEffect(() => {
    let active = true;
    if (!video.thumbnailFileId) {
      setUrl(null);
      return;
    }
    const syncHit = getSyncCachedThumbnailUrl(
      video.thumbnailFileId,
      Boolean(video.encrypted),
      video.thumbnailModifiedTime
    );
    if (syncHit) {
      setUrl(syncHit);
      return;
    }
    driveFetchCachedThumbnailUrl(
      video.thumbnailFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey,
      video.thumbnailModifiedTime,
      "normal"
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
  }, [
    video.thumbnailFileId,
    video.thumbnailModifiedTime,
    video.encrypted,
    accessToken,
    masterKey,
    thumbVersion,
  ]);

  return (
    <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-[#060609] ring-1 ring-white/10">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={video.title}
          className="absolute inset-0 h-full w-full object-contain"
        />
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
});

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
  seriesVideos = [],
  relatedVideos,
  queue,
  queueIndex,
  initialProgress,
  initialStartTimeSec = null,
  initialStartNonce = 0,
  thumbnailTimeSec,
  hasActiveManga = false,
  linkedManga = [],
  splitWithManga = false,
  onToggleSplitWithManga,
  onEnableSplitWithManga,
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
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const anyFullscreen = isFullscreen || isPseudoFullscreen;
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [durationSec, setDurationSec] = useState(video.duration || 0);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const watchSheetRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekRippleAccumRef = useRef<{
    side: "left" | "right";
    total: number;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Storyboard sprite sheet (6x6) + instant poster for zero-black-screen TTFF
  const [posterUrl, setPosterUrl] = useState<string | null>(() =>
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
  const [hoverSeekRatio, setHoverSeekRatio] = useState<number | null>(null);
  const [hoverPopupLeftPct, setHoverPopupLeftPct] = useState<number | null>(null);
  const [isDraggingSeekBar, setIsDraggingSeekBar] = useState(false);
  const [previewSyncedSec, setPreviewSyncedSec] = useState<number | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const zoomSeekBarRef = useRef<HTMLDivElement | null>(null);
  const seekPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<SegmentTimelineEntry[]>([]);
  const isDraggingSeekRef = useRef(false);
  const isDraggingZoomSeekRef = useRef(false);
  const pendingDragRatioRef = useRef<number | null>(null);

  // Precision Zoomed Seekbar ("拡大シーク") + YouTube-style pull-up 5x fine scrub!
  const [zoomSeekOpen, setZoomSeekOpen] = useState(false);
  const [zoomHalfWindowSec, setZoomHalfWindowSec] = useState<15 | 30 | 60>(30);
  const [zoomWindowCenterSec, setZoomWindowCenterSec] = useState(0);
  const [fineScrubActive, setFineScrubActive] = useState(false);
  const fineScrubAnchorRef = useRef<{ clientX: number; baseRatio: number } | null>(null);

  // Ultra-fine 1-second exact frame preview engine (visible hardware-accelerated 360p <video> inside popup)
  const previewSourceRef = useRef<{ kind: "hls" | "direct"; url: string } | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewHlsRef = useRef<Hls | null>(null);
  const previewAttachedUrlRef = useRef<string | null>(null);
  const previewSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewSecRef = useRef<number | null>(null);
  const lastNudgedPreviewSecRef = useRef<number | null>(null);

  const [thumbSaving, setThumbSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Native OS PiP + fallback mini player (starts docked when launched alongside manga!)
  const [nativePipSupported, setNativePipSupported] = useState(false);
  const [isNativePipActive, setIsNativePipActive] = useState(false);
  const [isMiniMode, setIsMiniMode] = useState(hasActiveManga);

  // Authentic iOS / iPadOS touch gesture states (swipe-down home/exit, swipe-up fullscreen, horizontal scrub, double-tap +/-10s, long-press 2x)
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [swipeScrubState, setSwipeScrubState] = useState<{
    targetSec: number;
    deltaSec: number;
  } | null>(null);
  const [seekRipple, setSeekRipple] = useState<{
    side: "left" | "right";
    label: string;
    nonce: number;
  } | null>(null);
  const [isLongPress2x, setIsLongPress2x] = useState(false);

  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    startVideoTime: number;
    wasControlsVisible: boolean;
    mode: "pending" | "vertical" | "horizontal" | "longpress";
    lastDy: number;
    lastTargetSec: number;
  } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; zone: "left" | "center" | "right" } | null>(null);
  const lastTouchEndAtRef = useRef<number>(0);
  const wasPlayingBeforeScrubRef = useRef(false);
  const wasPausedBeforeLongPressRef = useRef(false);
  const mouseLongPressActiveRef = useRef(false);
  const suppressNextVideoClickRef = useRef(false);
  const lastLiveScrubAtRef = useRef(0);
  const liveScrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // In-player Manga Picker for 1-tap Simultaneous Video + Manga Split Mode
  const [mangaPickerOpen, setMangaPickerOpen] = useState(false);
  const [mangaPickerQuery, setMangaPickerQuery] = useState("");
  const pickableManga = useMemo(() => {
    const q = mangaPickerQuery.trim().toLowerCase();
    return allVideos
      .filter((v) => v.kind === "manga")
      .filter((v) => (!q ? true : v.title.toLowerCase().includes(q)));
  }, [allVideos, mangaPickerQuery]);

  // Below-player YouTube discovery feed state (progressive render + fresh random order per video!)
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseGenre, setBrowseGenre] = useState<string>("");
  const [visibleBrowseCount, setVisibleBrowseCount] = useState(12);
  const [browseShuffleSeed, setBrowseShuffleSeed] = useState<number>(() =>
    Math.floor(Math.random() * 0x7fffffff)
  );

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

  // Auto-minimize video into mini/split mode when user opens a manga so both stay active simultaneously
  useEffect(() => {
    if (hasActiveManga) {
      setIsPseudoFullscreen(false);
      setIsMiniMode(true);
    }
  }, [hasActiveManga]);

  // If the user clicks a thumbnail timestamp badge while this same video is already loaded (e.g. mini-mode), jump immediately
  useEffect(() => {
    if (!initialStartNonce) return;
    if (!hasActiveManga) {
      setIsMiniMode(false);
    }
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
          // Parallel race: pre-fetch opening/resume video segment & sprites BEFORE awaiting playlist decrypt!
          prewarmVideoForInstantPlay(video, accessToken, masterKey, resumePosition, "high");

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
          previewSourceRef.current = { kind: "hls", url: built.playlistUrl };
          setRenditionTimelinesState(built.renditionTimelines);
          urlsToRevoke = built.objectUrlsToRevoke;
          setQualityLabels(built.qualityLabels);

          const hdSegUrl = getCacheSegmentUrls(
            video.manifest,
            video.duration,
            resumePosition,
            0,
            1
          )[0];
          const hdCachedInRam = Boolean(hdSegUrl && hasSegmentCache(hdSegUrl));

          if (Hls.isSupported() && videoEl) {
            hls = new Hls({
              enableWorker: true,
              progressive: false,
              enableSoftwareAES: false,
              lowLatencyMode: false,
              autoStartLoad: true,
              startLevel: hdCachedInRam
                ? Math.max(0, built.qualityLabels.length - 1)
                : 0,
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
          previewSourceRef.current = { kind: "direct", url: blobUrl };
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

  // Load cached poster immediately & encrypted storyboard sprite sheet
  useEffect(() => {
    let active = true;
    setCurrentTimeSec(0);
    setDurationSec(video.duration || 0);
    setHoverSeekRatio(null);
    setHoverPopupLeftPct(null);
    setIsDraggingSeekBar(false);
    setPreviewSyncedSec(null);
    setZoomWindowCenterSec(0);
    setSpriteGrid({ cols: 6, rows: 6 });
    pendingDragRatioRef.current = null;
    pendingPreviewSecRef.current = null;
    lastNudgedPreviewSecRef.current = null;
    previewSourceRef.current = null;
    previewAttachedUrlRef.current = null;
    if (previewHlsRef.current) {
      previewHlsRef.current.destroy();
      previewHlsRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.removeAttribute("src");
      previewVideoRef.current.load();
    }
    setVisibleBrowseCount(12);
    setBrowseShuffleSeed(Math.floor(Math.random() * 0x7fffffff));

    if (video.thumbnailFileId) {
      const syncPoster = getSyncCachedThumbnailUrl(
        video.thumbnailFileId,
        Boolean(video.encrypted),
        video.thumbnailModifiedTime
      );
      if (syncPoster) setPosterUrl(syncPoster);
      driveFetchCachedThumbnailUrl(
        video.thumbnailFileId,
        accessToken,
        Boolean(video.encrypted),
        masterKey,
        video.thumbnailModifiedTime,
        "high"
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

    const syncSprite = getSyncCachedThumbnailUrl(video.spriteFileId, Boolean(video.encrypted));
    if (syncSprite) setSpriteUrl(syncSprite);

    driveFetchCachedThumbnailUrl(
      video.spriteFileId,
      accessToken,
      Boolean(video.encrypted),
      masterKey,
      undefined,
      "high"
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

  // Auto-detect sprite sheet grid dimensions (supports existing 6x6 [960x540] and new 10x10 [1600x900] sprites!)
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
      if (img.naturalWidth % 160 === 0 && img.naturalHeight % 90 === 0) {
        const cols = Math.round(img.naturalWidth / 160);
        const rows = Math.round(img.naturalHeight / 90);
        if (cols >= 4 && rows >= 4 && cols <= 16 && rows <= 16) {
          const nextGrid = { cols, rows };
          setCachedSpriteGrid(spriteUrl, nextGrid);
          setSpriteGrid(nextGrid);
        }
      }
    };
    img.src = spriteUrl;
    return () => {
      active = false;
    };
  }, [spriteUrl]);

  // Keep zoomed seekbar window gently following playback when user is NOT actively dragging
  useEffect(() => {
    if (!zoomSeekOpen || isDraggingSeekBar || durationSec <= 0) return;
    const half = zoomHalfWindowSec;
    const fullSpan = Math.min(durationSec, half * 2);
    const safeStart = Math.max(0, Math.min(durationSec - fullSpan, zoomWindowCenterSec - half));
    const safeEnd = Math.min(durationSec, safeStart + fullSpan);
    if (currentTimeSec < safeStart || currentTimeSec > safeEnd) {
      setZoomWindowCenterSec(currentTimeSec);
    }
  }, [
    zoomSeekOpen,
    isDraggingSeekBar,
    currentTimeSec,
    durationSec,
    zoomHalfWindowSec,
    zoomWindowCenterSec,
  ]);

  // Cleanup live 1-second preview decoder & interaction/scrub timers on unmount or video switch
  useEffect(() => {
    return () => {
      if (liveScrubTimerRef.current) {
        clearTimeout(liveScrubTimerRef.current);
        liveScrubTimerRef.current = null;
      }
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (seekPrefetchTimerRef.current) {
        clearTimeout(seekPrefetchTimerRef.current);
        seekPrefetchTimerRef.current = null;
      }
      if (seekRippleAccumRef.current?.timer) {
        clearTimeout(seekRippleAccumRef.current.timer);
        seekRippleAccumRef.current = null;
      }
      wasPlayingBeforeScrubRef.current = false;
      wasPausedBeforeLongPressRef.current = false;
      mouseLongPressActiveRef.current = false;
      if (previewSeekTimerRef.current) {
        clearTimeout(previewSeekTimerRef.current);
        previewSeekTimerRef.current = null;
      }
      if (previewHlsRef.current) {
        previewHlsRef.current.destroy();
        previewHlsRef.current = null;
      }
      previewAttachedUrlRef.current = null;
      if (previewVideoRef.current) {
        previewVideoRef.current.removeAttribute("src");
        previewVideoRef.current.load();
      }
    };
  }, [video.id]);

  // Visible Hardware-Accelerated 1-Second Live Frame Preview on Seekbar Hover / Drag (iPadOS Safari & PC)
  useEffect(() => {
    const pVidEl = previewVideoRef.current;
    if (pVidEl) {
      pVidEl.muted = true;
      pVidEl.playsInline = true;
      pVidEl.setAttribute("playsinline", "true");
      pVidEl.setAttribute("webkit-playsinline", "true");
    }
  }, [video.id, isMiniMode]);

  useEffect(() => {
    if (previewSeekTimerRef.current) {
      clearTimeout(previewSeekTimerRef.current);
      previewSeekTimerRef.current = null;
    }
    if (hoverSeekRatio === null || durationSec <= 0 || isMiniMode) {
      pendingPreviewSecRef.current = null;
      if (previewHlsRef.current) {
        previewHlsRef.current.stopLoad();
      }
      return;
    }

    const targetSec = Math.min(
      Math.max(0, Math.round(hoverSeekRatio * durationSec)),
      Math.max(0, Math.floor(durationSec - 0.5))
    );

    const srcInfo = previewSourceRef.current;
    const pVid = previewVideoRef.current;
    if (!srcInfo || !pVid) return;

    pendingPreviewSecRef.current = targetSec;

    const isTimeBuffered = (vid: HTMLVideoElement, sec: number): boolean => {
      try {
        for (let i = 0; i < vid.buffered.length; i += 1) {
          if (vid.buffered.start(i) <= sec + 0.5 && vid.buffered.end(i) >= sec - 0.5) {
            return true;
          }
        }
      } catch {
        // Ignore
      }
      return false;
    };

    const markSyncedIfExact = (vid: HTMLVideoElement) => {
      const expected = pendingPreviewSecRef.current;
      if (expected === null) return;
      if (vid.readyState < 2 || vid.videoWidth <= 0 || vid.seeking) return;
      if (!isTimeBuffered(vid, expected)) return;
      if (Math.abs(vid.currentTime - expected) > 1.0) return;
      setPreviewSyncedSec(vid.currentTime);
      if (previewHlsRef.current) {
        previewHlsRef.current.stopLoad();
      }
    };

    // Instant 0ms hit if the visible preview <video> is already buffered & positioned at targetSec
    if (
      previewAttachedUrlRef.current === srcInfo.url &&
      pVid.readyState >= 2 &&
      !pVid.seeking &&
      isTimeBuffered(pVid, targetSec) &&
      Math.abs(pVid.currentTime - targetSec) <= 0.4
    ) {
      setPreviewSyncedSec(pVid.currentTime);
      return;
    }

    // Also if already buffered at another second inside the same 8s/15s segment, seek IMMEDIATELY (0ms debounce!)
    if (
      previewAttachedUrlRef.current === srcInfo.url &&
      pVid.readyState >= 1 &&
      isTimeBuffered(pVid, targetSec)
    ) {
      pVid.currentTime = targetSec;
      return;
    }

    previewSeekTimerRef.current = setTimeout(() => {
      const wantedSec = pendingPreviewSecRef.current;
      const vid = previewVideoRef.current;
      if (wantedSec === null || !vid) return;

      // Lazily attach muted 360p HLS or direct stream to the VISIBLE <video> inside the popup
      if (previewAttachedUrlRef.current !== srcInfo.url) {
        if (previewHlsRef.current) {
          previewHlsRef.current.destroy();
          previewHlsRef.current = null;
        }
        previewAttachedUrlRef.current = srcInfo.url;
        setPreviewSyncedSec(null);
        vid.muted = true;
        vid.playsInline = true;
        vid.setAttribute("playsinline", "true");
        vid.setAttribute("webkit-playsinline", "true");

        const onReadyFrame = () => {
          const curVid = previewVideoRef.current;
          if (curVid) markSyncedIfExact(curVid);
        };
        vid.onseeked = onReadyFrame;
        vid.onloadeddata = onReadyFrame;
        vid.oncanplay = onReadyFrame;
        vid.onloadedmetadata = () => {
          const s = pendingPreviewSecRef.current;
          const curVid = previewVideoRef.current;
          if (s !== null && curVid && Math.abs(curVid.currentTime - s) > 0.3) {
            curVid.currentTime = s;
          }
        };

        if (srcInfo.kind === "hls" && Hls.isSupported()) {
          const pHls = new Hls({
            enableWorker: true,
            progressive: false,
            enableSoftwareAES: false,
            lowLatencyMode: false,
            autoStartLoad: true,
            startLevel: 0,
            startPosition: wantedSec,
            maxBufferLength: 18,
            maxMaxBufferLength: 32,
            backBufferLength: 30,
            fLoader: createCachedDriveFragmentLoader(accessToken),
            xhrSetup: (xhr, url) => {
              if (url.startsWith("https://www.googleapis.com/")) {
                xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
              }
            },
          });
          pHls.autoLevelCapping = 0;
          pHls.on(Hls.Events.MEDIA_ATTACHED, () => {
            pHls.loadSource(srcInfo.url);
          });
          pHls.on(Hls.Events.MANIFEST_PARSED, () => {
            pHls.currentLevel = 0;
            pHls.autoLevelCapping = 0;
            const s = pendingPreviewSecRef.current;
            const curVid = previewVideoRef.current;
            if (s !== null && curVid) {
              if (curVid.readyState >= 1) {
                curVid.currentTime = s;
              }
              pHls.startLoad(s);
            }
          });
          pHls.on(Hls.Events.FRAG_BUFFERED, () => {
            const s = pendingPreviewSecRef.current;
            const curVid = previewVideoRef.current;
            if (s === null || !curVid) return;
            if (isTimeBuffered(curVid, s)) {
              if (Math.abs(curVid.currentTime - s) > 0.25) {
                curVid.currentTime = s;
              } else if (curVid.readyState >= 2 && !curVid.seeking) {
                markSyncedIfExact(curVid);
              } else if (lastNudgedPreviewSecRef.current !== s) {
                lastNudgedPreviewSecRef.current = s;
                curVid.currentTime = Math.min(durationSec, s + 0.01);
              }
            }
          });
          pHls.on(Hls.Events.ERROR, (_ev, data) => {
            if (!data.fatal) return;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              const s = pendingPreviewSecRef.current;
              if (s !== null) pHls.startLoad(s);
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              pHls.recoverMediaError();
            }
          });
          pHls.attachMedia(vid);
          previewHlsRef.current = pHls;
          return;
        } else if (srcInfo.kind === "direct") {
          vid.src = srcInfo.url;
          return;
        }
      }

      // Already attached: set vid.currentTime FIRST, then call startLoad(wantedSec) so hls.js seeks the right segment!
      if (previewHlsRef.current) {
        previewHlsRef.current.currentLevel = 0;
        if (vid.readyState >= 1 && Math.abs(vid.currentTime - wantedSec) > 0.2) {
          vid.currentTime = wantedSec;
        }
        if (isTimeBuffered(vid, wantedSec)) {
          if (Math.abs(vid.currentTime - wantedSec) <= 0.3 && vid.readyState >= 2 && !vid.seeking) {
            markSyncedIfExact(vid);
          }
        } else {
          previewHlsRef.current.startLoad(wantedSec);
        }
      } else if (vid.readyState >= 1) {
        if (Math.abs(vid.currentTime - wantedSec) <= 0.3 && vid.readyState >= 2 && !vid.seeking) {
          markSyncedIfExact(vid);
        } else {
          vid.currentTime = wantedSec;
        }
      }
    }, 35);

    return () => {
      if (previewSeekTimerRef.current) {
        clearTimeout(previewSeekTimerRef.current);
      }
    };
  }, [hoverSeekRatio, durationSec, isMiniMode, loading, accessToken]);

  // Prefetch next queue video's playlist AND first segment for near-0ms transitions
  useEffect(() => {
    if (!hasNext) return;
    const nextVideo = queue[queueIndex + 1];
    if (!nextVideo?.manifest) return;
    prefetchHlsPlaylist(nextVideo.manifest, accessToken, masterKey);
    if (nextVideo.spriteFileId) {
      driveFetchCachedThumbnailUrl(
        nextVideo.spriteFileId,
        accessToken,
        Boolean(nextVideo.encrypted),
        masterKey,
        undefined,
        "low"
      ).catch(() => undefined);
    }
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

  // Disk-aware gentle lookahead segment prefetcher while watching:
  // Checks L2 IndexedDB once on mount so already-persisted segments aren't re-downloaded,
  // and keeps the next ~5 minutes (20 segments) ahead of the playhead ready for 0ms seeks!
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
    let loopTimer: ReturnType<typeof setTimeout> | null = null;
    let diskSegKeys = new Set<string>();

    const isSegCachedAnywhere = (url: string) =>
      hasSegmentCache(url) || diskSegKeys.has(url);

    const updateStats = () => {
      if (cancelled) return;
      let count = 0;
      for (const seg of timeline) {
        if (isSegCachedAnywhere(seg.url)) count += 1;
      }
      setCacheProgress((prev) =>
        prev.cached === count && prev.total === timeline.length
          ? prev
          : { cached: count, total: timeline.length }
      );
    };

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        loopTimer = setTimeout(() => {
          loopTimer = null;
          resolve();
        }, ms);
      });

    // Gently sync cache stats without hammering React re-renders
    const statsInterval = setInterval(updateStats, 2500);

    const runGentlePrefetch = async () => {
      try {
        const cachedKeys = await getAllCachedKeys();
        if (!cancelled) {
          diskSegKeys = cachedKeys.segments;
        }
      } catch {
        // Ignore IndexedDB key read failure
      }
      updateStats();

      await sleep(800);
      const retryCounts = new Map<string, number>();

      while (!cancelled) {
        const curPos = videoRef.current?.currentTime ?? 0;
        const foundIdx = timeline.findIndex(
          (s) => curPos >= s.startSec && curPos < s.endSec
        );
        const startIdx = Math.max(0, foundIdx);
        const lookAheadEnd = Math.min(timeline.length, startIdx + 20);

        const pendingUrls: string[] = [];
        for (let i = startIdx; i < lookAheadEnd; i += 1) {
          const url = timeline[i].url;
          if (!isSegCachedAnywhere(url)) {
            pendingUrls.push(url);
          }
        }

        if (pendingUrls.length > 0) {
          const worker = async () => {
            while (!cancelled) {
              let nextUrl: string | undefined;
              while (pendingUrls.length > 0) {
                const candidate = pendingUrls.shift();
                if (candidate && !isSegCachedAnywhere(candidate)) {
                  nextUrl = candidate;
                  break;
                }
              }
              if (!nextUrl) return;

              try {
                const p = prefetchSegmentUrl(nextUrl, accessToken, "low");
                if (p) await p;
                diskSegKeys.add(nextUrl);
              } catch {
                const tries = (retryCounts.get(nextUrl) ?? 0) + 1;
                if (tries <= 2 && !cancelled) {
                  retryCounts.set(nextUrl, tries);
                  await sleep(400);
                  pendingUrls.push(nextUrl);
                }
              }
              updateStats();
            }
          };

          // Gentle 2 parallel streams (zero stutter on iPadOS Safari!)
          await Promise.all(Array.from({ length: 2 }, () => worker()));
          updateStats();
        }

        if (cancelled) break;
        // Re-check playhead every 12 seconds to keep the next ~5 minutes continuously preloaded
        await sleep(12000);
      }
    };

    runGentlePrefetch();

    return () => {
      cancelled = true;
      clearInterval(statsInterval);
      if (loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
      }
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
    const onPlayState = () => {
      setIsPaused(el.paused);
      if (el.paused && Number.isFinite(el.currentTime) && el.currentTime > 0) {
        const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : video.duration;
        const updated = saveVideoProgress(video.id, el.currentTime, dur, false);
        onProgressUpdatedRef.current(video.id, updated);
      }
    };

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

  const menusOrZoomOpenRef = useRef(false);
  const controlsVisibleRef = useRef(true);
  const lastUiTimeUpdateRef = useRef(0);
  useEffect(() => {
    menusOrZoomOpenRef.current = speedMenuOpen || qualityMenuOpen || zoomSeekOpen;
  }, [speedMenuOpen, qualityMenuOpen, zoomSeekOpen]);
  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  const bumpControlsVisibility = useCallback(() => {
    if (videoRef.current && Number.isFinite(videoRef.current.currentTime)) {
      setCurrentTimeSec(videoRef.current.currentTime);
    }
    setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = setTimeout(() => {
      if (
        videoRef.current &&
        !videoRef.current.paused &&
        !isDraggingSeekRef.current &&
        !isDraggingZoomSeekRef.current &&
        !menusOrZoomOpenRef.current
      ) {
        setControlsVisible(false);
        setSpeedMenuOpen(false);
        setQualityMenuOpen(false);
      }
    }, 5500);
  }, []);

  // Enforce inline playback on iPadOS/iOS Safari so Apple's native AVPlayer never hijacks our custom UI
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.controls = false;
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
  }, [video.id]);

  useEffect(() => {
    const onFsChange = () => {
      const doc = document as WebKitDocument;
      const fsActive = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
      setIsFullscreen(fsActive);
      if (fsActive) {
        setIsPseudoFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as EventListener);
      if (hideControlsTimerRef.current) {
        clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const doc = document as WebKitDocument;
    const container = playerContainerRef.current as WebKitHTMLElement | null;

    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      return;
    }

    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      try {
        if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === "function") {
          await doc.webkitExitFullscreen();
        }
      } catch {
        setIsFullscreen(false);
      }
      return;
    }

    // Always fullscreen our custom container (never call videoEl.webkitEnterFullscreen which launches iPad's native AVPlayer!)
    if (container) {
      try {
        if (typeof container.requestFullscreen === "function") {
          await container.requestFullscreen();
          return;
        }
        if (typeof container.webkitRequestFullscreen === "function") {
          await container.webkitRequestFullscreen();
          return;
        }
      } catch {
        // Fall back to in-app fullscreen below
      }
    }

    setIsPseudoFullscreen(true);
  }, [isPseudoFullscreen]);

  // Go directly to Home (Mini-Player) even from Fullscreen on iPad/iPhone!
  const handleGoHomeFromPlayer = useCallback(async () => {
    const doc = document as WebKitDocument;
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      try {
        if (doc.fullscreenElement && typeof doc.exitFullscreen === "function") {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === "function") {
          await doc.webkitExitFullscreen();
        }
      } catch {
        // Ignore
      }
    }
    setIsFullscreen(false);
    setIsPseudoFullscreen(false);
    setIsMiniMode(true);
  }, []);

  // Lock background Home page scroll while full Watch view is open (native iPad YouTube feel!)
  useEffect(() => {
    if (isMiniMode || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMiniMode]);

  const triggerSeekRipple = useCallback((side: "left" | "right", deltaSec: number) => {
    const prev = seekRippleAccumRef.current;
    if (prev?.timer) clearTimeout(prev.timer);
    const total = prev && prev.side === side ? prev.total + deltaSec : deltaSec;
    const nonce = Date.now();
    setSeekRipple({
      side,
      label: total > 0 ? `+${total}秒` : `${total}秒`,
      nonce,
    });
    const timer = setTimeout(() => {
      seekRippleAccumRef.current = null;
      setSeekRipple((cur) => (cur && cur.nonce === nonce ? null : cur));
    }, 680);
    seekRippleAccumRef.current = { side, total, timer };
  }, []);

  const startLongPress2x = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    wasPausedBeforeLongPressRef.current = el.paused;
    el.playbackRate = 2;
    if (el.paused) {
      el.play().catch(() => undefined);
    }
    setIsLongPress2x(true);
  }, []);

  const stopLongPress2x = useCallback(() => {
    setIsLongPress2x(false);
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    if (wasPausedBeforeLongPressRef.current) {
      wasPausedBeforeLongPressRef.current = false;
      el.pause();
    }
  }, [playbackRate]);

  const scrubMainVideoLive = useCallback(
    (rawTargetSec: number, immediate = false) => {
      const el = videoRef.current;
      if (!el || durationSec <= 0) return;
      const targetTime = Math.min(durationSec, Math.max(0, rawTargetSec));
      const applyNow = () => {
        const curEl = videoRef.current;
        if (!curEl) return;
        const segUrl = resolveExactSegmentUrl(targetTime);
        abortLowPriorityPrefetches(segUrl ?? undefined);
        if (hlsRef.current && selectedLevel === -1 && qualityLabels.length > 1) {
          hlsRef.current.nextLoadLevel = 0;
        }
        lastLiveScrubAtRef.current = performance.now();
        curEl.currentTime = targetTime;
      };

      const elapsed = performance.now() - lastLiveScrubAtRef.current;
      if (immediate || (!el.seeking && elapsed >= 70)) {
        if (liveScrubTimerRef.current) {
          clearTimeout(liveScrubTimerRef.current);
          liveScrubTimerRef.current = null;
        }
        applyNow();
      } else {
        if (liveScrubTimerRef.current) {
          clearTimeout(liveScrubTimerRef.current);
        }
        liveScrubTimerRef.current = setTimeout(() => {
          liveScrubTimerRef.current = null;
          applyNow();
        }, 85);
      }
    },
    [durationSec, resolveExactSegmentUrl, selectedLevel, qualityLabels.length]
  );

  const beginLiveScrub = useCallback(
    (initialSec: number) => {
      if (liveScrubTimerRef.current) {
        clearTimeout(liveScrubTimerRef.current);
        liveScrubTimerRef.current = null;
      }
      const el = videoRef.current;
      if (el) {
        wasPlayingBeforeScrubRef.current = !el.paused;
        if (!el.paused) {
          el.pause();
        }
      }
      scrubMainVideoLive(initialSec, true);
    },
    [scrubMainVideoLive]
  );

  const finishLiveScrub = useCallback(
    (rawFinalSec: number) => {
      if (liveScrubTimerRef.current) {
        clearTimeout(liveScrubTimerRef.current);
        liveScrubTimerRef.current = null;
      }
      const el = videoRef.current;
      if (el && durationSec > 0) {
        const targetTime = Math.min(durationSec, Math.max(0, rawFinalSec));
        const segUrl = resolveExactSegmentUrl(targetTime);
        abortLowPriorityPrefetches(segUrl ?? undefined);
        if (hlsRef.current && selectedLevel === -1 && qualityLabels.length > 1) {
          hlsRef.current.nextLoadLevel = 0;
        }
        el.currentTime = targetTime;
        setCurrentTimeSec(targetTime);
      }
      if (wasPlayingBeforeScrubRef.current) {
        wasPlayingBeforeScrubRef.current = false;
        videoRef.current?.play().catch(() => undefined);
      }
    },
    [durationSec, resolveExactSegmentUrl, selectedLevel, qualityLabels.length]
  );

  const cancelLiveScrub = useCallback(() => {
    if (liveScrubTimerRef.current) {
      clearTimeout(liveScrubTimerRef.current);
      liveScrubTimerRef.current = null;
    }
    if (wasPlayingBeforeScrubRef.current) {
      wasPlayingBeforeScrubRef.current = false;
      videoRef.current?.play().catch(() => undefined);
    }
  }, []);

  const handleVideoMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (isMiniMode || e.button !== 0) return;
    if (performance.now() - lastTouchEndAtRef.current < 450) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      mouseLongPressActiveRef.current = true;
      suppressNextVideoClickRef.current = true;
      startLongPress2x();
    }, 360);
  };

  const handleVideoMouseEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (mouseLongPressActiveRef.current) {
      mouseLongPressActiveRef.current = false;
      stopLongPress2x();
    }
  };

  const handleVideoTouchStart = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (isMiniMode || e.touches.length !== 1) return;
    const t = e.touches[0];
    const el = videoRef.current;
    const startVideoTime = el && Number.isFinite(el.currentTime) ? el.currentTime : 0;

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    touchGestureRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startVideoTime,
      wasControlsVisible: controlsVisibleRef.current,
      mode: "pending",
      lastDy: 0,
      lastTargetSec: startVideoTime,
    };

    // YouTube iOS signature gesture: hold 360ms for 2.0x live playback (works even when paused!)
    longPressTimerRef.current = setTimeout(() => {
      const g = touchGestureRef.current;
      if (!g || g.mode !== "pending") return;
      g.mode = "longpress";
      startLongPress2x();
    }, 360);
  };

  const handleVideoTouchMove = (e: React.TouchEvent<HTMLVideoElement>) => {
    const g = touchGestureRef.current;
    if (!g || isMiniMode || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.startX;
    const dy = t.clientY - g.startY;

    if (g.mode === "longpress") return;

    if (g.mode === "pending") {
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        g.mode = "vertical";
      } else if (durationSec > 0) {
        g.mode = "horizontal";
        beginLiveScrub(g.startVideoTime);
      } else {
        return;
      }
    }

    if (g.mode === "vertical") {
      g.lastDy = dy;
      const clamped = Math.max(-90, Math.min(220, dy));
      setDragOffsetY(clamped);
    } else if (g.mode === "horizontal" && durationSec > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const spanSec = Math.min(180, Math.max(45, durationSec * 0.35));
      const deltaSec = Math.round((dx / Math.max(240, rect.width)) * spanSec);
      const targetSec = Math.min(durationSec, Math.max(0, g.startVideoTime + deltaSec));
      g.lastTargetSec = targetSec;
      setSwipeScrubState({ targetSec, deltaSec });
      const nextRatio = Math.min(0.999, Math.max(0, targetSec / durationSec));
      setHoverSeekRatio(nextRatio);
      setHoverPopupLeftPct(nextRatio * 100);
      scrubMainVideoLive(targetSec);
    }
  };

  const handleVideoTouchEnd = (e: React.TouchEvent<HTMLVideoElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    const g = touchGestureRef.current;
    touchGestureRef.current = null;
    if (!g || isMiniMode) return;

    lastTouchEndAtRef.current = performance.now();

    if (g.mode === "longpress") {
      stopLongPress2x();
      return;
    }

    if (g.mode === "vertical") {
      const dy = g.lastDy;
      setDragOffsetY(0);
      if (anyFullscreen) {
        if (dy > 145) {
          handleGoHomeFromPlayer();
        } else if (dy > 65) {
          handleToggleFullscreen();
        }
      } else {
        if (dy > 75) {
          handleGoHomeFromPlayer();
        } else if (dy < -65) {
          handleToggleFullscreen();
        }
      }
      return;
    }

    if (g.mode === "horizontal") {
      const targetSec = g.lastTargetSec;
      setSwipeScrubState(null);
      setHoverSeekRatio(null);
      setHoverPopupLeftPct(null);
      finishLiveScrub(targetSec);
      return;
    }

    // Clean touch tap: single tap toggles HUD (iOS YouTube feel), double-tap left/right skips +/-10s, center double-tap toggles fullscreen!
    const touch = e.changedTouches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = touch && rect.width > 0 ? (touch.clientX - rect.left) / rect.width : 0.5;
    const zone: "left" | "center" | "right" =
      ratio < 0.35 ? "left" : ratio > 0.65 ? "right" : "center";

    const now = performance.now();
    const prev = lastTapRef.current;
    // Allow chained YouTube-style cumulative skips (+10s -> +20s -> +30s) when tapping repeatedly!
    const isChainedSkip =
      (zone === "left" || zone === "right") &&
      seekRippleAccumRef.current &&
      seekRippleAccumRef.current.side === zone;
    if ((prev && now - prev.time < 300 && prev.zone === zone) || isChainedSkip) {
      lastTapRef.current = { time: now, zone };
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      const el = videoRef.current;
      if (zone === "left" && el) {
        const nextT = Math.max(0, el.currentTime - 10);
        el.currentTime = nextT;
        setCurrentTimeSec(nextT);
        triggerSeekRipple("left", -10);
      } else if (zone === "right" && el) {
        const nextT = Math.min(el.duration || durationSec || Infinity, el.currentTime + 10);
        el.currentTime = nextT;
        setCurrentTimeSec(nextT);
        triggerSeekRipple("right", 10);
      } else {
        lastTapRef.current = null;
        handleToggleFullscreen();
      }
      return;
    }

    lastTapRef.current = { time: now, zone };
    const nextVisible = !g.wasControlsVisible;
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      if (nextVisible) {
        bumpControlsVisibility();
      } else {
        if (hideControlsTimerRef.current) {
          clearTimeout(hideControlsTimerRef.current);
          hideControlsTimerRef.current = null;
        }
        setControlsVisible(false);
        setSpeedMenuOpen(false);
        setQualityMenuOpen(false);
      }
    }, 190);
  };

  const handleVideoTouchCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (touchGestureRef.current?.mode === "longpress") {
      stopLongPress2x();
    } else if (touchGestureRef.current?.mode === "horizontal") {
      cancelLiveScrub();
    }
    touchGestureRef.current = null;
    setDragOffsetY(0);
    setSwipeScrubState(null);
    setHoverSeekRatio(null);
    setHoverPopupLeftPct(null);
  };

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
      if (event.key === "Escape") {
        if (isPseudoFullscreen) {
          setIsPseudoFullscreen(false);
          return;
        }
        const doc = document as WebKitDocument;
        if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
          setIsMiniMode(true);
          return;
        }
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
    isPseudoFullscreen,
    onClose,
    bumpControlsVisibility,
    handleToggleFullscreen,
    handleToggleMute,
    handleVolumeChange,
  ]);

  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.currentTime)) return;
    const isActivelyScrubbing =
      isDraggingSeekRef.current ||
      isDraggingZoomSeekRef.current ||
      touchGestureRef.current?.mode === "horizontal";

    const now = Date.now();
    const uiIntervalMs =
      controlsVisibleRef.current || isMiniMode || menusOrZoomOpenRef.current ? 250 : 1200;

    if (!isActivelyScrubbing && now - lastUiTimeUpdateRef.current >= uiIntervalMs) {
      lastUiTimeUpdateRef.current = now;
      setCurrentTimeSec(el.currentTime);
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : video.duration;
      if (dur > 0) {
        setDurationSec((prev) => (Math.abs(prev - dur) > 0.25 ? dur : prev));
        if (el.buffered.length > 0) {
          const bufEnd = el.buffered.end(el.buffered.length - 1);
          const nextBuf = Math.round(Math.min(100, Math.max(0, (bufEnd / dur) * 100)));
          setBufferedPercent((prev) => (prev === nextBuf ? prev : nextBuf));
        }
      }
    }

    if (isActivelyScrubbing) return;
    if (now - lastProgressSavedAtRef.current < 8000) return;
    lastProgressSavedAtRef.current = now;
    const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : video.duration;
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

  const seekToTime = useCallback(
    (rawTargetSec: number) => {
      const el = videoRef.current;
      if (!el || durationSec <= 0) return;
      const targetTime = Math.min(durationSec, Math.max(0, rawTargetSec));
      const targetSegUrl = resolveExactSegmentUrl(targetTime);
      abortLowPriorityPrefetches(targetSegUrl ?? undefined);
      if (hlsRef.current && selectedLevel === -1 && qualityLabels.length > 1) {
        hlsRef.current.nextLoadLevel = 0;
      }
      el.currentTime = targetTime;
      setCurrentTimeSec(targetTime);
    },
    [durationSec, resolveExactSegmentUrl, selectedLevel, qualityLabels.length]
  );

  const spriteTotalFrames = spriteGrid.cols * spriteGrid.rows;
  const seekHoverFrameIdx =
    hoverSeekRatio !== null
      ? Math.min(spriteTotalFrames - 1, Math.max(0, Math.round(hoverSeekRatio * spriteTotalFrames)))
      : 0;
  const seekHoverCol = seekHoverFrameIdx % spriteGrid.cols;
  const seekHoverRow = Math.floor(seekHoverFrameIdx / spriteGrid.cols);
  const hoverTargetSec =
    hoverSeekRatio !== null && durationSec > 0 ? Math.round(hoverSeekRatio * durationSec) : null;
  const isLivePreviewSynced =
    hoverTargetSec !== null &&
    previewSyncedSec !== null &&
    Math.abs(previewSyncedSec - hoverTargetSec) <= 1.0;
  const displayTimeSec =
    isDraggingSeekBar && hoverSeekRatio !== null && durationSec > 0
      ? hoverSeekRatio * durationSec
      : currentTimeSec;
  const playedPercent =
    durationSec > 0 ? Math.min(100, Math.max(0, (displayTimeSec / durationSec) * 100)) : 0;

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
      const { url: freshUrl, updatedAt } = await updateThumbnailInDrive(
        video.thumbnailFileId,
        jpegBytes,
        accessToken,
        Boolean(video.encrypted),
        masterKey
      );
      setPosterUrl(freshUrl);
      onThumbnailUpdated(video.id, capturedSec, updatedAt);
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
        if (CATEGORY_TAG_SET.has(g)) continue;
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
    return [...list].sort(
      (a, b) =>
        seededOrderHash(a.id, browseShuffleSeed) - seededOrderHash(b.id, browseShuffleSeed)
    );
  }, [allVideos, video.id, browseGenre, browseQuery, videoGenresMap, browseShuffleSeed]);

  const isSplitDocked = isMiniMode && hasActiveManga && splitWithManga;

  // Memoize the heavy below-player discovery feed so 60fps seekbar scrubbing & time ticks
  // NEVER re-reconcile the card grid below the player!
  const memoizedBrowseSection = useMemo(
    () => (
      <section className="mt-7 border-t border-zinc-800/80 pt-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-white">
            再生しながら他の動画を探す ({browseVideos.length} 件)
          </h2>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() =>
                setBrowseShuffleSeed(Math.floor(Math.random() * 0x7fffffff))
              }
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-rose-500/50 hover:bg-zinc-800 hover:text-white active:scale-95"
              title="下の動画リストをシャッフル"
            >
              <Shuffle className="h-3.5 w-3.5 text-rose-400" />
              <span>シャッフル</span>
            </button>
            <div className="relative flex-1 sm:w-64 sm:flex-initial">
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
        </div>

        {browseGenreList.length > 0 && (
          <div className="no-scrollbar mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setBrowseGenre("")}
              className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition active:scale-95 ${
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
                className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition active:scale-95 ${
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
                  genres={videoGenresMap[item.id] ?? EMPTY_STRING_ARRAY}
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
                  onClickGenre={setBrowseGenre}
                />
              ))}
            </div>
            {browseVideos.length > visibleBrowseCount && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleBrowseCount((c) => c + 12)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-2.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800 active:scale-95"
                >
                  さらに表示（残り {browseVideos.length - visibleBrowseCount} 件）
                </button>
              </div>
            )}
          </>
        )}
      </section>
    ),
    [
      browseVideos,
      browseQuery,
      browseGenreList,
      browseGenre,
      visibleBrowseCount,
      accessToken,
      masterKey,
      videoGenresMap,
      customGenres,
      userMetaMap,
      queueIdSet,
      progressMap,
      thumbVersions,
      onSelectVideo,
      onAddToQueue,
      onToggleFavorite,
      onEditTags,
    ]
  );

  const sheetDragOpacity =
    !isMiniMode && !anyFullscreen && dragOffsetY > 0
      ? Math.max(0.28, 1 - dragOffsetY / 320)
      : 1;

  return (
    <div
      ref={watchSheetRef}
      className={
        isSplitDocked
          ? "fixed inset-x-0 top-0 z-[55] flex h-[34dvh] flex-col overflow-hidden border-b border-white/15 bg-[#060609] shadow-2xl shadow-black/90 lg:inset-y-0 lg:left-0 lg:right-auto lg:h-[100dvh] lg:w-[42vw] lg:justify-center lg:border-b-0 lg:border-r lg:border-white/15"
          : isMiniMode
            ? "fixed bottom-16 right-3 z-[55] w-[290px] overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl shadow-black/90 sm:w-[340px] md:bottom-5 md:right-5"
            : "fixed inset-0 z-[55] flex flex-col bg-[#0b0b0e]"
      }
      style={
        !isMiniMode && !anyFullscreen && dragOffsetY > 0
          ? {
              backgroundColor: `rgba(11, 11, 14, ${sheetDragOpacity.toFixed(2)})`,
              transform: `translate3d(0, ${dragOffsetY}px, 0)`,
              willChange: "transform",
            }
          : undefined
      }
      role="dialog"
      aria-modal={!isMiniMode}
      aria-label={video.title}
    >
      {/* YouTube Watch-Page Top Navigation Bar */}
      {!isMiniMode && !anyFullscreen && (
        <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#0b0b0e]/95 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setIsMiniMode(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
              title="再生を続けたままホームへ戻る"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">ホームへ戻る</span>
              <span className="sm:hidden">戻る</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (hasActiveManga) {
                  onEnableSplitWithManga?.();
                  setIsMiniMode(true);
                } else if (linkedManga.length === 1) {
                  onEnableSplitWithManga?.();
                  setIsMiniMode(true);
                  onSelectVideo(linkedManga[0]);
                } else {
                  setMangaPickerOpen(true);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                linkedManga.length > 0 && !hasActiveManga
                  ? "border-amber-400/70 bg-gradient-to-r from-amber-500/25 via-rose-500/20 to-sky-500/20 text-amber-100 shadow-sm shadow-amber-500/20 hover:brightness-125"
                  : "border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
              }`}
              title="動画を見ながら同時に漫画を開く"
            >
              {linkedManga.length > 0 && !hasActiveManga ? (
                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              ) : (
                <BookOpen className="h-3.5 w-3.5" />
              )}
              <span>
                {hasActiveManga
                  ? "漫画と分割に戻る"
                  : linkedManga.length > 0
                    ? "原作漫画あり・同時"
                    : "漫画と同時"}
              </span>
            </button>
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
          isSplitDocked
            ? "flex min-h-0 flex-1 flex-col lg:flex-initial"
            : isMiniMode
              ? "flex flex-col"
              : "min-h-0 flex-1 overflow-y-auto lg:overflow-hidden"
        }
      >
        <div
          className={
            isSplitDocked
              ? "flex min-h-0 flex-1 flex-col lg:flex-initial"
              : isMiniMode
                ? "flex flex-col"
                : "mx-auto flex max-w-[1600px] flex-col gap-6 px-3 py-4 sm:px-5 lg:h-full lg:flex-row lg:items-stretch"
          }
        >
          {/* LEFT MAIN COLUMN: Video + Meta/Controls + Below-Video Search & Browse Feed */}
          <div
            className={
              isSplitDocked
                ? "flex min-h-0 w-full flex-1 flex-col lg:flex-initial"
                : isMiniMode
                  ? "w-full"
                  : "min-w-0 flex-1 lg:h-full lg:overflow-y-auto lg:pr-1"
            }
          >
            {/* Custom Unified YouTube-style Video Player Container */}
            <div
              ref={playerContainerRef}
              onPointerMove={(e) => {
                // Only show HUD on real desktop mouse movement — NEVER synthetic touch mousemove on iPad/iPhone!
                if (e.pointerType !== "mouse") return;
                bumpControlsVisibility();
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "mouse") return;
                if (
                  !isPaused &&
                  !isDraggingSeekRef.current &&
                  !isDraggingZoomSeekRef.current &&
                  !zoomSeekOpen &&
                  !speedMenuOpen &&
                  !qualityMenuOpen
                ) {
                  setControlsVisible(false);
                  setSpeedMenuOpen(false);
                  setQualityMenuOpen(false);
                }
              }}
              onContextMenu={(e) => e.preventDefault()}
              className={
                isSplitDocked
                  ? "ios-no-callout relative min-h-0 w-full flex-1 bg-black lg:aspect-video lg:flex-initial"
                  : isMiniMode
                    ? "ios-no-callout relative aspect-video w-full bg-black"
                    : isPseudoFullscreen
                      ? "ios-no-callout fixed inset-0 z-[90] flex h-[100dvh] w-screen touch-none items-center justify-center bg-black"
                      : isFullscreen
                        ? "ios-no-callout relative flex h-screen w-screen touch-none items-center justify-center bg-black"
                        : "ios-no-callout relative aspect-video max-h-[72vh] w-full touch-none overflow-hidden rounded-2xl bg-black ring-1 ring-zinc-800/80"
              }
              style={
                !isMiniMode && anyFullscreen && dragOffsetY !== 0
                  ? {
                      transform: `translate3d(0, ${dragOffsetY}px, 0) scale(${(1 - Math.min(0.1, Math.max(0, dragOffsetY) / 1600)).toFixed(4)})`,
                      transition: "none",
                      willChange: "transform",
                    }
                  : !isMiniMode && !anyFullscreen && dragOffsetY < 0
                    ? {
                        transform: `translate3d(0, ${dragOffsetY}px, 0) scale(${(1 + Math.min(0.03, Math.abs(dragOffsetY) / 2400)).toFixed(4)})`,
                        transition: "none",
                        willChange: "transform",
                      }
                    : !isMiniMode
                      ? { transition: "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" }
                      : undefined
              }
            >
              <video
                ref={videoRef}
                controls={false}
                controlsList="nodownload nofullscreen"
                playsInline
                preload="auto"
                poster={posterUrl ?? undefined}
                onMouseDown={handleVideoMouseDown}
                onMouseUp={handleVideoMouseEnd}
                onMouseLeave={handleVideoMouseEnd}
                onTouchStart={handleVideoTouchStart}
                onTouchMove={handleVideoTouchMove}
                onTouchEnd={handleVideoTouchEnd}
                onTouchCancel={handleVideoTouchCancel}
                onClick={() => {
                  // Ignore synthetic mouse click right after touch gesture or mouse long-press
                  if (performance.now() - lastTouchEndAtRef.current < 450) return;
                  if (suppressNextVideoClickRef.current) {
                    suppressNextVideoClickRef.current = false;
                    return;
                  }
                  if (isMiniMode) {
                    setIsMiniMode(false);
                    return;
                  }
                  handleTogglePlayPause();
                  bumpControlsVisibility();
                }}
                onDoubleClick={() => {
                  if (performance.now() - lastTouchEndAtRef.current < 450) return;
                  if (!isMiniMode) handleToggleFullscreen();
                }}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                className="ios-no-callout h-full w-full cursor-pointer select-none object-contain"
              />

              {/* iOS Swipe-Down / Swipe-Up Pull Hint Pill (zero backdrop-blur over video!) */}
              {!isMiniMode && Math.abs(dragOffsetY) > 28 && (
                <div className="pointer-events-none absolute left-1/2 top-5 z-30 -translate-x-1/2 rounded-full border border-white/20 bg-black/80 px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xl">
                  {anyFullscreen
                    ? dragOffsetY > 145
                      ? "↓ 離すとホームへ戻る"
                      : "↓ 離すと全画面終了（さらに引くとホームへ）"
                    : dragOffsetY > 28
                      ? "↓ 離すとミニ窓でホームへ"
                      : "↑ 離すとフルスクリーン"}
                </div>
              )}

              {/* Long-press 2.0x Speed Pill (YouTube iOS gesture + PC Mouse Hold!) */}
              {!isMiniMode && isLongPress2x && (
                <div className="pointer-events-none absolute left-1/2 top-5 z-30 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-400/45 bg-black/85 px-3.5 py-1.5 text-xs font-bold text-amber-200 shadow-2xl">
                  <Zap className="h-3.5 w-3.5 fill-current text-amber-400" />
                  <span>2.0× 再生中（離すと戻る）</span>
                </div>
              )}

              {/* Horizontal Swipe Scrub Floating Pill */}
              {!isMiniMode && swipeScrubState && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl border border-white/20 bg-black/85 px-4 py-2.5 shadow-2xl">
                  <div className="flex items-center gap-2 font-mono text-sm font-bold text-white">
                    <span>{formatDuration(swipeScrubState.targetSec)}</span>
                    <span className="text-xs text-rose-400">
                      ({swipeScrubState.deltaSec >= 0 ? `+${swipeScrubState.deltaSec}` : swipeScrubState.deltaSec}秒)
                    </span>
                  </div>
                </div>
              )}

              {/* YouTube-style Curved Side Double-Tap Skip Ripple (cumulative +10s / +20s / +30s!) */}
              {!isMiniMode && seekRipple && (
                <div
                  key={seekRipple.nonce}
                  className={`pointer-events-none absolute inset-y-0 z-30 flex w-[38%] flex-col items-center justify-center bg-white/[0.14] text-sm font-bold text-white transition-opacity ${
                    seekRipple.side === "left"
                      ? "left-0 rounded-r-full"
                      : "right-0 rounded-l-full"
                  }`}
                >
                  {seekRipple.side === "left" ? (
                    <Rewind className="mb-1 h-6 w-6" />
                  ) : (
                    <FastForward className="mb-1 h-6 w-6" />
                  )}
                  <span className="font-mono drop-shadow">{seekRipple.label}</span>
                </div>
              )}

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

              {/* Center Liquid Glass Play/Pause & Quick Skip (iPad/iOS friendly!) */}
              {!isMiniMode &&
                !loading &&
                !error &&
                (isPaused || controlsVisible) &&
                !swipeScrubState &&
                !isDraggingSeekBar &&
                !isLongPress2x && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-8 sm:gap-12">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = videoRef.current;
                      if (!el) return;
                      const nextT = Math.max(0, el.currentTime - 10);
                      el.currentTime = nextT;
                      setCurrentTimeSec(nextT);
                      triggerSeekRipple("left", -10);
                      bumpControlsVisibility();
                    }}
                    className={`pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl transition active:scale-90 sm:hidden ${
                      controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                    aria-label="10秒戻す"
                  >
                    <Rewind className="h-5 w-5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePlayPause();
                      bumpControlsVisibility();
                    }}
                    className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/65 text-white shadow-2xl transition hover:scale-105 hover:bg-rose-600/90 active:scale-90"
                    aria-label={isPaused ? "再生" : "一時停止"}
                  >
                    {isPaused ? (
                      <Play className="ml-1 h-8 w-8 fill-current" />
                    ) : (
                      <Pause className="h-7 w-7 fill-current" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const el = videoRef.current;
                      if (!el) return;
                      const nextT = Math.min(el.duration || durationSec || Infinity, el.currentTime + 10);
                      el.currentTime = nextT;
                      setCurrentTimeSec(nextT);
                      triggerSeekRipple("right", 10);
                      bumpControlsVisibility();
                    }}
                    className={`pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-black/65 text-white shadow-xl transition active:scale-90 sm:hidden ${
                      controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
                    }`}
                    aria-label="10秒進む"
                  >
                    <FastForward className="h-5 w-5" />
                  </button>
                </div>
              )}

              {/* Fullscreen Top Bar (Direct Home button + Exit Fullscreen + Manga Split + PiP on iPad!) */}
              {!isMiniMode && !loading && !error && anyFullscreen ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={bumpControlsVisibility}
                  className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-3 pb-2 pt-[max(0.625rem,env(safe-area-inset-top))] transition-opacity duration-200 sm:px-5 ${
                    controlsVisible || isPaused
                      ? "opacity-100"
                      : "pointer-events-none opacity-0"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={handleGoHomeFromPlayer}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/25 bg-black/70 px-3.5 py-1.5 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] transition hover:bg-black/85 active:scale-95"
                      title="再生を続けたままホームへ戻る"
                    >
                      <Home className="h-3.5 w-3.5" />
                      <span>ホームへ</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleFullscreen}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-semibold text-zinc-100 transition hover:bg-black/85 active:scale-95"
                      title="全画面を閉じる"
                    >
                      <ChevronDown className="h-4 w-4" />
                      <span className="hidden sm:inline">縮小</span>
                    </button>
                    <p className="hidden truncate text-xs font-semibold text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.85)] md:block">
                      {video.title}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await handleGoHomeFromPlayer();
                        if (hasActiveManga) {
                          onEnableSplitWithManga?.();
                        } else if (linkedManga.length === 1) {
                          onEnableSplitWithManga?.();
                          onSelectVideo(linkedManga[0]);
                        } else {
                          setIsMiniMode(false);
                          setMangaPickerOpen(true);
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-950/75 px-3 py-1.5 text-xs font-semibold text-amber-100 transition hover:bg-amber-900/85 active:scale-95"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">漫画同時</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleNativePip();
                      }}
                      className={`flex h-9 w-9 items-center justify-center rounded-full border transition active:scale-95 ${
                        isNativePipActive
                          ? "border-rose-400/70 bg-rose-600/90 text-white"
                          : "border-white/20 bg-black/65 text-white/90 hover:bg-black/85"
                      }`}
                      title="ピクチャーインピクチャー"
                      aria-label="ピクチャーインピクチャー"
                    >
                      <PictureInPicture2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : !isMiniMode && !loading && !error ? (
                /* Non-fullscreen top-right PiP button */
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleNativePip();
                  }}
                  className={`absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border transition-opacity duration-200 active:scale-95 ${
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
              ) : null}

              {/* Unified YouTube-style Bottom Overlay Controls (Single Bar with Preview Seek + iOS Safe Area!) */}
              {!isMiniMode && !error && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={bumpControlsVisibility}
                  className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pt-10 transition-opacity duration-200 sm:px-4 ${
                    anyFullscreen ? "pb-[max(0.75rem,env(safe-area-inset-bottom))]" : "pb-2.5"
                  } ${
                    controlsVisible ||
                    isPaused ||
                    hoverSeekRatio !== null ||
                    zoomSeekOpen ||
                    speedMenuOpen ||
                    qualityMenuOpen
                      ? "opacity-100"
                      : "pointer-events-none opacity-0"
                  }`}
                >
                  {/* Precision Zoomed Seekbar Panel (+/-15s / +/-30s / +/-60s with 1-second tick marks & locked window!) */}
                  {zoomSeekOpen && durationSec > 0 && (() => {
                    const half = zoomHalfWindowSec;
                    const fullSpan = Math.min(durationSec, half * 2);
                    const safeStart = Math.max(
                      0,
                      Math.min(durationSec - fullSpan, zoomWindowCenterSec - half)
                    );
                    const safeEnd = Math.min(durationSec, safeStart + fullSpan);
                    const span = Math.max(1, safeEnd - safeStart);
                    const activeZoomSec =
                      hoverSeekRatio !== null ? hoverSeekRatio * durationSec : displayTimeSec;
                    const markerPct = Math.min(
                      100,
                      Math.max(0, ((activeZoomSec - safeStart) / span) * 100)
                    );
                    const playedZoomPct = Math.min(
                      100,
                      Math.max(0, ((displayTimeSec - safeStart) / span) * 100)
                    );

                    // Build crisp 1-second tick marks + major labels
                    const majorStep =
                      zoomHalfWindowSec === 15 ? 5 : zoomHalfWindowSec === 30 ? 10 : 20;
                    const ticks: Array<{ sec: number; pct: number; major: boolean }> = [];
                    const firstTick = Math.ceil(safeStart);
                    for (let s = firstTick; s <= Math.floor(safeEnd); s += 1) {
                      if (zoomHalfWindowSec === 60 && s % 2 !== 0) continue;
                      ticks.push({
                        sec: s,
                        pct: ((s - safeStart) / span) * 100,
                        major: s % majorStep === 0,
                      });
                    }

                    const getZoomPositionFromClientX = (clientX: number) => {
                      const bar = zoomSeekBarRef.current;
                      if (!bar) {
                        return {
                          localRatio: 0,
                          sec: displayTimeSec,
                          fullRatio: durationSec > 0 ? displayTimeSec / durationSec : 0,
                        };
                      }
                      const rect = bar.getBoundingClientRect();
                      const localRatio =
                        rect.width > 0
                          ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
                          : 0;
                      const sec = Math.min(durationSec, Math.max(0, safeStart + localRatio * span));
                      const fullRatio = Math.min(0.999, Math.max(0, sec / durationSec));
                      return { localRatio, sec, fullRatio };
                    };

                    return (
                      <div className="mb-2.5 rounded-2xl border border-white/15 bg-zinc-950/90 p-2.5 shadow-2xl">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            <ZoomIn className="h-3.5 w-3.5 text-rose-400" />
                            <span className="font-bold text-white">精密拡大シーク</span>
                            <div className="ml-1 flex items-center gap-1">
                              {([15, 30, 60] as const).map((halfOpt) => (
                                <button
                                  key={halfOpt}
                                  type="button"
                                  onClick={() => setZoomHalfWindowSec(halfOpt)}
                                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold transition ${
                                    zoomHalfWindowSec === halfOpt
                                      ? "bg-rose-600 text-white"
                                      : "bg-white/10 text-zinc-300 hover:bg-white/20"
                                  }`}
                                >
                                  ±{halfOpt}秒
                                </button>
                              ))}
                            </div>
                            <div className="ml-1 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setZoomWindowCenterSec((prev) =>
                                    Math.max(0, prev - zoomHalfWindowSec)
                                  );
                                  bumpControlsVisibility();
                                }}
                                disabled={safeStart <= 0.1}
                                className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-200 transition hover:bg-white/20 disabled:opacity-35"
                                title="表示範囲を前へ移動"
                              >
                                ◀
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setZoomWindowCenterSec((prev) =>
                                    Math.min(durationSec, prev + zoomHalfWindowSec)
                                  );
                                  bumpControlsVisibility();
                                }}
                                disabled={safeEnd >= durationSec - 0.1}
                                className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-200 transition hover:bg-white/20 disabled:opacity-35"
                                title="表示範囲を次へ移動"
                              >
                                ▶
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {[-5, -1, 1, 5].map((delta) => (
                              <button
                                key={delta}
                                type="button"
                                onClick={() => {
                                  const nextSec = Math.min(
                                    durationSec,
                                    Math.max(0, currentTimeSec + delta)
                                  );
                                  seekToTime(nextSec);
                                  bumpControlsVisibility();
                                }}
                                className="rounded-md border border-white/15 bg-white/[0.08] px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-100 transition hover:bg-white/20 active:scale-95"
                              >
                                {delta > 0 ? `+${delta}秒` : `${delta}秒`}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setZoomSeekOpen(false)}
                              className="ml-1 rounded-full p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                              aria-label="拡大シークを閉じる"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Zoomed 1-Second Ruler Scrubber (window locked during drag + live main-screen scrub!) */}
                        <div
                          ref={zoomSeekBarRef}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            isDraggingZoomSeekRef.current = true;
                            setIsDraggingSeekBar(true);
                            e.currentTarget.setPointerCapture(e.pointerId);
                            const pos = getZoomPositionFromClientX(e.clientX);
                            pendingDragRatioRef.current = pos.fullRatio;
                            setHoverSeekRatio(pos.fullRatio);
                            setHoverPopupLeftPct(pos.localRatio * 100);
                            beginLiveScrub(pos.sec);
                            bumpControlsVisibility();
                          }}
                          onPointerMove={(e) => {
                            const pos = getZoomPositionFromClientX(e.clientX);
                            if (isDraggingZoomSeekRef.current) {
                              pendingDragRatioRef.current = pos.fullRatio;
                              scrubMainVideoLive(pos.sec);
                            }
                            setHoverSeekRatio(pos.fullRatio);
                            setHoverPopupLeftPct(pos.localRatio * 100);
                          }}
                          onPointerUp={(e) => {
                            if (isDraggingZoomSeekRef.current) {
                              isDraggingZoomSeekRef.current = false;
                              setIsDraggingSeekBar(false);
                              const finalRatio =
                                pendingDragRatioRef.current ??
                                getZoomPositionFromClientX(e.clientX).fullRatio;
                              pendingDragRatioRef.current = null;
                              finishLiveScrub(finalRatio * durationSec);
                              try {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                              } catch {
                                // Ignore
                              }
                            }
                            if (e.pointerType !== "mouse") {
                              setHoverSeekRatio(null);
                              setHoverPopupLeftPct(null);
                            }
                          }}
                          onPointerCancel={(e) => {
                            if (isDraggingZoomSeekRef.current) {
                              isDraggingZoomSeekRef.current = false;
                              setIsDraggingSeekBar(false);
                              pendingDragRatioRef.current = null;
                              cancelLiveScrub();
                              try {
                                e.currentTarget.releasePointerCapture(e.pointerId);
                              } catch {
                                // Ignore
                              }
                            }
                            setHoverSeekRatio(null);
                            setHoverPopupLeftPct(null);
                          }}
                          onPointerLeave={() => {
                            if (!isDraggingZoomSeekRef.current) {
                              setHoverSeekRatio(null);
                              setHoverPopupLeftPct(null);
                            }
                          }}
                          className="ios-no-callout relative h-11 w-full cursor-pointer touch-none select-none rounded-xl bg-white/[0.06] px-1"
                        >
                          {/* 1-second ruler ticks */}
                          {ticks.map((tk) => (
                            <div
                              key={tk.sec}
                              className="pointer-events-none absolute bottom-0 flex flex-col items-center"
                              style={{ left: `${tk.pct}%`, transform: "translateX(-50%)" }}
                            >
                              {tk.major && (
                                <span className="mb-1 font-mono text-[9px] text-zinc-400">
                                  {formatDuration(tk.sec)}
                                </span>
                              )}
                              <div
                                className={
                                  tk.major ? "h-3 w-0.5 bg-white/50" : "h-1.5 w-px bg-white/25"
                                }
                              />
                            </div>
                          ))}

                          {/* Played progress inside zoomed window */}
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 rounded-l-xl bg-rose-500/20"
                            style={{ width: `${playedZoomPct}%` }}
                          />

                          {/* Crisp red hairline playhead */}
                          <div
                            className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.9)]"
                            style={{ left: `${markerPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Integrated Seek Bar with Live Main-Screen Scrub + Hover Preview + Pull-Up 5x Precision Scrub */}
                  <div
                    ref={seekBarRef}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      isDraggingSeekRef.current = true;
                      setIsDraggingSeekBar(true);
                      fineScrubAnchorRef.current = null;
                      setFineScrubActive(false);
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const ratio = getSeekRatioFromClientX(e.clientX);
                      pendingDragRatioRef.current = ratio;
                      setHoverSeekRatio(ratio);
                      setHoverPopupLeftPct(ratio * 100);
                      beginLiveScrub(ratio * durationSec);
                      bumpControlsVisibility();
                    }}
                    onPointerMove={(e) => {
                      const bar = seekBarRef.current;
                      let ratio = getSeekRatioFromClientX(e.clientX);

                      // YouTube iOS-style pull-up gesture: pulling finger/mouse >32px above the bar engages 5x precision scrub!
                      if (isDraggingSeekRef.current && bar) {
                        const rect = bar.getBoundingClientRect();
                        const pulledUp = rect.top - e.clientY > 32;
                        if (pulledUp) {
                          if (!fineScrubAnchorRef.current) {
                            fineScrubAnchorRef.current = {
                              clientX: e.clientX,
                              baseRatio: pendingDragRatioRef.current ?? hoverSeekRatio ?? ratio,
                            };
                            setFineScrubActive(true);
                          }
                          const dx = e.clientX - fineScrubAnchorRef.current.clientX;
                          const fineDeltaRatio = (dx / Math.max(1, rect.width)) * 0.2; // 5x finer control!
                          ratio = Math.min(
                            0.999,
                            Math.max(0, fineScrubAnchorRef.current.baseRatio + fineDeltaRatio)
                          );
                        } else if (fineScrubAnchorRef.current) {
                          fineScrubAnchorRef.current = null;
                          setFineScrubActive(false);
                        }
                      }

                      if (isDraggingSeekRef.current) {
                        pendingDragRatioRef.current = ratio;
                        scrubMainVideoLive(ratio * durationSec);
                      }
                      setHoverSeekRatio(ratio);
                      setHoverPopupLeftPct(ratio * 100);
                    }}
                    onPointerUp={(e) => {
                      if (isDraggingSeekRef.current) {
                        isDraggingSeekRef.current = false;
                        setIsDraggingSeekBar(false);
                        const finalRatio =
                          pendingDragRatioRef.current ?? getSeekRatioFromClientX(e.clientX);
                        pendingDragRatioRef.current = null;
                        finishLiveScrub(finalRatio * durationSec);
                        fineScrubAnchorRef.current = null;
                        setFineScrubActive(false);
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          // Ignore
                        }
                      }
                      if (e.pointerType !== "mouse") {
                        setHoverSeekRatio(null);
                        setHoverPopupLeftPct(null);
                      }
                    }}
                    onPointerCancel={(e) => {
                      if (isDraggingSeekRef.current) {
                        isDraggingSeekRef.current = false;
                        setIsDraggingSeekBar(false);
                        pendingDragRatioRef.current = null;
                        cancelLiveScrub();
                        fineScrubAnchorRef.current = null;
                        setFineScrubActive(false);
                        try {
                          e.currentTarget.releasePointerCapture(e.pointerId);
                        } catch {
                          // Ignore
                        }
                      }
                      setHoverSeekRatio(null);
                      setHoverPopupLeftPct(null);
                    }}
                    onPointerLeave={() => {
                      if (!isDraggingSeekRef.current) {
                        setHoverSeekRatio(null);
                        setHoverPopupLeftPct(null);
                        setFineScrubActive(false);
                      }
                    }}
                    className="group/seek ios-no-callout relative mb-1.5 flex h-7 w-full cursor-pointer touch-none items-center select-none"
                    role="slider"
                    aria-label="シークバー"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(durationSec)}
                    aria-valuenow={Math.round(displayTimeSec)}
                  >
                    {/* Floating Thumbnail Preview Popup (Persistent Visible 360p <video> + Instant Sprite Backdrop!) */}
                    <div
                      aria-hidden={hoverSeekRatio === null || durationSec <= 0}
                      className={`pointer-events-none absolute z-30 -translate-x-1/2 overflow-hidden rounded-xl border border-white/25 bg-zinc-950 shadow-2xl shadow-black transition-opacity duration-75 ${
                        zoomSeekOpen ? "bottom-36 sm:bottom-32" : "bottom-7"
                      } ${
                        hoverSeekRatio !== null && durationSec > 0 ? "opacity-100" : "opacity-0"
                      }`}
                      style={{
                        left: `clamp(114px, ${(hoverPopupLeftPct ?? (hoverSeekRatio ?? 0) * 100).toFixed(2)}%, calc(100% - 114px))`,
                      }}
                    >
                      <div className="relative h-[126px] w-[224px] overflow-hidden bg-black">
                        {spriteUrl && (
                          <div
                            className="absolute inset-0 z-0 bg-black bg-no-repeat"
                            style={{
                              backgroundImage: `url(${spriteUrl})`,
                              backgroundSize: `${spriteGrid.cols * 100}% ${spriteGrid.rows * 100}%`,
                              backgroundPosition: `${(seekHoverCol / Math.max(1, spriteGrid.cols - 1)) * 100}% ${(seekHoverRow / Math.max(1, spriteGrid.rows - 1)) * 100}%`,
                            }}
                          />
                        )}
                        <video
                          ref={previewVideoRef}
                          muted
                          playsInline
                          preload="auto"
                          aria-hidden="true"
                          tabIndex={-1}
                          className={`absolute inset-0 z-10 h-full w-full bg-black object-contain transition-opacity duration-75 ${
                            isLivePreviewSynced ? "opacity-100" : "opacity-[0.01]"
                          }`}
                        />
                      </div>
                      <div className="flex items-center justify-center gap-1.5 bg-black/90 px-2.5 py-1 font-mono text-xs font-bold text-white">
                        <span>{formatDuration((hoverSeekRatio ?? 0) * durationSec)}</span>
                        {!isLivePreviewSynced && (
                          <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                        )}
                        {fineScrubActive && (
                          <span className="rounded bg-rose-500/30 px-1.5 py-0.5 text-[10px] text-rose-200">
                            5倍精密
                          </span>
                        )}
                      </div>
                    </div>

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
                      className={`pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500 shadow ring-2 ring-white transition-transform ${
                        isDraggingSeekBar ? "scale-100" : "scale-0 group-hover/seek:scale-100"
                      }`}
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
                        {formatDuration(displayTimeSec)}{" "}
                        <span className="text-zinc-400">/ {formatDuration(durationSec)}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          setZoomSeekOpen((prev) => {
                            const next = !prev;
                            if (next) {
                              setZoomWindowCenterSec(currentTimeSec);
                            }
                            return next;
                          });
                          bumpControlsVisibility();
                        }}
                        className={`ml-1 inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition ${
                          zoomSeekOpen
                            ? "border-rose-400/70 bg-rose-600/90 text-white"
                            : "border-white/15 bg-white/[0.08] text-zinc-200 hover:bg-white/20"
                        }`}
                        title="シークバーを拡大して1秒単位で細かく操作"
                      >
                        <ZoomIn className="h-3.5 w-3.5" />
                        <span>拡大シーク</span>
                      </button>
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
                        title={anyFullscreen ? "フルスクリーン終了 (F)" : "フルスクリーン (F)"}
                      >
                        {anyFullscreen ? (
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
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIsMiniMode(false)}
                      className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm hover:bg-black"
                    >
                      <Maximize2 className="h-3 w-3" />
                      拡大
                    </button>
                    {hasActiveManga && onToggleSplitWithManga && (
                      <button
                        type="button"
                        onClick={onToggleSplitWithManga}
                        className="inline-flex items-center gap-1 rounded-full bg-sky-600/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm hover:bg-sky-500"
                      >
                        {splitWithManga ? "ミニ窓へ" : "画面分割"}
                      </button>
                    )}
                  </div>
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
              <div className="border-t border-zinc-800 bg-zinc-950 px-3 py-2">
                {durationSec > 0 && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-400">
                      {formatDuration(currentTimeSec)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, Math.floor(durationSec))}
                      value={Math.min(Math.floor(durationSec), Math.floor(currentTimeSec))}
                      onChange={(e) => {
                        const t = Number(e.target.value);
                        if (videoRef.current) videoRef.current.currentTime = t;
                        setCurrentTimeSec(t);
                      }}
                      className="h-1 flex-1 cursor-pointer accent-rose-500"
                      aria-label="動画シーク"
                    />
                    <span className="font-mono text-[10px] text-zinc-500">
                      {formatDuration(durationSec)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setIsMiniMode(false)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-semibold text-zinc-100">
                    {video.title}
                  </p>
                  <p className="text-[10px] text-zinc-400">
                    {isSplitDocked
                      ? "漫画と同時再生中"
                      : queue.length > 1
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
              </div>
            ) : (
              <>
                {/* Title, meta, and YouTube action bar (clean — all playback controls are inside the video HUD!) */}
                <div className="mt-3.5 space-y-3">
                  {/* Cross-media Guidance Banner when matching Manga exists */}
                  {linkedManga.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/35 bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-sky-500/15 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-xl">
                      <div className="flex min-w-0 items-center gap-3">
                        <SmallThumb
                          video={linkedManga[0]}
                          accessToken={accessToken}
                          masterKey={masterKey}
                          thumbVersion={thumbVersions[linkedManga[0].id] ?? 0}
                        />
                        <div className="min-w-0">
                          <div className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-200">
                            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                            <span>
                              この作品の原作漫画があります（{linkedManga.length}冊）
                            </span>
                          </div>
                          <p className="truncate text-xs font-semibold text-white">
                            {linkedManga[0].title}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (linkedManga.length === 1) {
                            onEnableSplitWithManga?.();
                            setIsMiniMode(true);
                            onSelectVideo(linkedManga[0]);
                          } else {
                            setMangaPickerOpen(true);
                          }
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-zinc-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>動画と同時に読む</span>
                      </button>
                    </div>
                  )}

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

                  {(() => {
                    const contentGenres = getContentGenresOnly(genres);
                    return contentGenres.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {contentGenres.map((genre) => (
                          <button
                            key={genre}
                            type="button"
                            onClick={() => setBrowseGenre(genre)}
                            className={`rounded-md border px-2 py-0.5 text-xs font-medium transition ${getGenreStyle(
                              genre,
                              customGenres
                            )}`}
                          >
                            {genre}
                          </button>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* Mobile / iPad Portrait Series-or-Related Recommendation Strip */}
                  {(seriesVideos.length > 0 || relatedVideos.length > 0) && (
                    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-3 lg:hidden">
                      <div className="mb-2.5 flex items-center justify-between gap-2">
                        <h3 className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                          {seriesVideos.length > 0 ? (
                            <>
                              <Sparkles className="h-3.5 w-3.5 text-rose-400" />
                              <span className="text-rose-200">
                                このシリーズ（他 {seriesVideos.length} 本）
                              </span>
                            </>
                          ) : (
                            <span>関連するおすすめ</span>
                          )}
                        </h3>
                        {seriesVideos.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              for (const sv of seriesVideos) {
                                if (!queueIdSet.has(sv.id)) onAddToQueue(sv);
                              }
                              showToast(`シリーズ ${seriesVideos.length} 本をキューに追加しました`);
                            }}
                            className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-200"
                          >
                            全話をキューへ
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2.5 overflow-x-auto pb-1">
                        {(seriesVideos.length > 0 ? seriesVideos : relatedVideos).map((item) => {
                          const itemGenres = getContentGenresOnly(videoGenresMap[item.id] ?? []);
                          return (
                            <div
                              key={`mob-rec-${item.id}`}
                              className={`flex w-56 shrink-0 flex-col gap-1.5 rounded-xl border p-2 transition ${
                                seriesVideos.length > 0
                                  ? "border-rose-500/30 bg-rose-500/[0.06]"
                                  : "border-zinc-800/70 bg-zinc-900/50"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectVideo(item)}
                                className="flex items-center gap-2 text-left"
                              >
                                <SmallThumb
                                  video={item}
                                  accessToken={accessToken}
                                  masterKey={masterKey}
                                  thumbVersion={thumbVersions[item.id] ?? 0}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-zinc-100">
                                    {item.title}
                                  </p>
                                  {item.duration > 0 && (
                                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                                      {formatDuration(item.duration)}
                                    </p>
                                  )}
                                </div>
                              </button>
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <div className="flex flex-wrap items-center gap-1">
                                  {itemGenres.slice(0, 2).map((g) => (
                                    <span
                                      key={g}
                                      className={`rounded border px-1 py-0.5 text-[9px] font-medium ${getGenreStyle(
                                        g,
                                        customGenres
                                      )}`}
                                    >
                                      {g}
                                    </span>
                                  ))}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => onEditTags(item)}
                                    className="inline-flex items-center gap-0.5 rounded-md border border-zinc-700/80 bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 hover:border-rose-500/50 hover:text-white"
                                  >
                                    <Tag className="h-2.5 w-2.5" />
                                    <span>ジャンル</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onToggleFavorite(item.id)}
                                    className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                                      userMetaMap[item.id]?.favorite
                                        ? "border-rose-500/50 bg-rose-500/20 text-rose-400"
                                        : "border-zinc-700/80 bg-zinc-950/80 text-zinc-400 hover:text-rose-300"
                                    }`}
                                    aria-label="お気に入り"
                                  >
                                    <Heart
                                      className={`h-2.5 w-2.5 ${
                                        userMetaMap[item.id]?.favorite ? "fill-current" : ""
                                      }`}
                                    />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* BELOW-PLAYER YOUTUBE DISCOVERY & SEARCH FEED (memoized for 120fps seekbar!) */}
                {memoizedBrowseSection}
              </>
            )}
          </div>

          {/* RIGHT SIDEBAR (Independent Scroll: Top = Queue Box, Bottom = Series -> Recommendations) */}
          {!isMiniMode && (
            <aside className="flex w-full shrink-0 flex-col gap-4 lg:h-full lg:w-[360px] lg:overflow-hidden xl:w-[400px]">
              {/* Queue Box (Independent Scroll Container) */}
              <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 lg:max-h-[42%] lg:shrink-0">
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

                <div className="max-h-[340px] min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2.5 lg:max-h-none">
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
                            {(() => {
                              const qGenres = getContentGenresOnly(videoGenresMap[item.id] ?? []);
                              return qGenres.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {qGenres.slice(0, 2).map((g) => (
                                    <span
                                      key={g}
                                      className={`rounded border px-1 py-0.5 text-[9px] font-medium ${getGenreStyle(
                                        g,
                                        customGenres
                                      )}`}
                                    >
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </button>

                        <div className="flex shrink-0 flex-col items-center gap-0.5">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => onEditTags(item)}
                              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-300"
                              title="ジャンル・タグを編集"
                            >
                              <Tag className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleFavorite(item.id)}
                              className={`rounded p-1 transition ${
                                userMetaMap[item.id]?.favorite
                                  ? "text-rose-400 hover:bg-rose-950/50"
                                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                              }`}
                              title="お気に入り切替"
                            >
                              <Heart
                                className={`h-3 w-3 ${
                                  userMetaMap[item.id]?.favorite ? "fill-current" : ""
                                }`}
                              />
                            </button>
                          </div>
                          <div className="flex items-center gap-0.5">
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
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Below-Queue Independent Scroll: Series Continuation FIRST, then Related Recommendations */}
              {(seriesVideos.length > 0 || relatedVideos.length > 0) && (
                <div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
              {seriesVideos.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <h3 className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-300">
                      <Sparkles className="h-3.5 w-3.5 text-rose-400" />
                      <span>このシリーズ（他 {seriesVideos.length} 本）</span>
                    </h3>
                    {seriesVideos.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          for (const sv of seriesVideos) {
                            if (!queueIdSet.has(sv.id)) {
                              onAddToQueue(sv);
                            }
                          }
                          showToast(`シリーズ ${seriesVideos.length} 本をキューに追加しました`);
                        }}
                        className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-200 transition hover:bg-rose-500/25"
                      >
                        全話をキューへ
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {seriesVideos.map((sv) => {
                      const inQ = queueIdSet.has(sv.id);
                      return (
                        <div
                          key={`series-${sv.id}`}
                          className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] p-2 transition hover:border-rose-400/50 hover:bg-rose-500/[0.12]"
                        >
                          <button
                            type="button"
                            onClick={() => onSelectVideo(sv)}
                            className="flex w-full items-start gap-2.5 text-left"
                          >
                            <SmallThumb
                              video={sv}
                              accessToken={accessToken}
                              masterKey={masterKey}
                              thumbVersion={thumbVersions[sv.id] ?? 0}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="mb-1 inline-block rounded bg-rose-500/20 px-1.5 py-0.5 text-[9px] font-bold text-rose-200">
                                シリーズ
                              </span>
                              <p className="line-clamp-2 text-xs font-semibold leading-snug text-zinc-100">
                                {sv.title}
                              </p>
                              <p className="mt-1 text-[10px] text-zinc-400">
                                {sv.duration > 0 ? formatDuration(sv.duration) : ""}
                                {sv.height ? ` • ${sv.height}p` : ""}
                              </p>
                              {(() => {
                                const svGenres = getContentGenresOnly(videoGenresMap[sv.id] ?? []);
                                return svGenres.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {svGenres.slice(0, 3).map((g) => (
                                      <span
                                        key={g}
                                        className={`rounded border px-1 py-0.5 text-[9px] font-medium ${getGenreStyle(
                                          g,
                                          customGenres
                                        )}`}
                                      >
                                        {g}
                                      </span>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
                            </div>
                          </button>
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onToggleFavorite(sv.id)}
                              className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition ${
                                userMetaMap[sv.id]?.favorite
                                  ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white"
                              }`}
                              title="お気に入り切替"
                            >
                              <Heart
                                className={`h-3 w-3 ${
                                  userMetaMap[sv.id]?.favorite ? "fill-current" : ""
                                }`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditTags(sv)}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-semibold text-zinc-300 transition hover:border-rose-500/50 hover:text-white"
                              title="ジャンル・タグを編集"
                            >
                              <Tag className="h-3 w-3" />
                              <span>ジャンル</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onAddToQueue(sv)}
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

              {/* Related Recommendations right after Series */}
              {relatedVideos.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-400">
                    次のおすすめ（関連動画）
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
                                  {rel.duration > 0 ? formatDuration(rel.duration) : ""}
                                  {rel.height ? ` • ${rel.height}p` : ""}
                                  {rel.sizeBytes ? ` • ${formatBytes(rel.sizeBytes)}` : ""}
                                </p>
                                {(() => {
                                  const relGenres = getContentGenresOnly(
                                    videoGenresMap[rel.id] ?? []
                                  );
                                  return relGenres.length > 0 ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {relGenres.slice(0, 3).map((g) => (
                                        <span
                                          key={g}
                                          className={`rounded border px-1 py-0.5 text-[9px] font-medium ${getGenreStyle(
                                            g,
                                            customGenres
                                          )}`}
                                        >
                                          {g}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </button>
                            <div className="mt-2 flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onToggleFavorite(rel.id)}
                                className={`inline-flex items-center justify-center rounded-lg border p-1.5 transition ${
                                  userMetaMap[rel.id]?.favorite
                                    ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white"
                                }`}
                                title="お気に入り切替"
                              >
                                <Heart
                                  className={`h-3 w-3 ${
                                    userMetaMap[rel.id]?.favorite ? "fill-current" : ""
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => onEditTags(rel)}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] font-semibold text-zinc-300 transition hover:border-rose-500/50 hover:text-white"
                                title="ジャンル・タグを編集"
                              >
                                <Tag className="h-3 w-3" />
                                <span>ジャンル</span>
                              </button>
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
                      }
                    )}
                  </div>
                </div>
              )}
                </div>
              )}
            </aside>
          )}
        </div>
      </div>

      {/* In-Player Liquid Glass Manga Picker for Simultaneous Video + Manga Split Mode */}
      {mangaPickerOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 backdrop-blur-md sm:items-center"
          onClick={() => setMangaPickerOpen(false)}
        >
          <div
            className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/90 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">動画と同時に読む漫画を選択</h3>
              </div>
              <button
                type="button"
                onClick={() => setMangaPickerOpen(false)}
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
                  value={mangaPickerQuery}
                  onChange={(e) => setMangaPickerQuery(e.target.value)}
                  placeholder="漫画タイトルで絞り込み..."
                  className="w-full rounded-xl border border-white/10 bg-black/50 py-2 pl-8 pr-3 text-xs text-white placeholder-zinc-500 focus:border-amber-400/60 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
              {linkedManga.length > 0 && !mangaPickerQuery.trim() && (
                <div className="mb-3 space-y-1.5 rounded-2xl border border-amber-400/30 bg-amber-500/[0.08] p-2.5">
                  <div className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-amber-200">
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    <span>この作品の漫画（セット {linkedManga.length}冊）</span>
                  </div>
                  {linkedManga.map((m) => (
                    <button
                      key={`linked-manga-${m.id}`}
                      type="button"
                      onClick={() => {
                        onEnableSplitWithManga?.();
                        setIsMiniMode(true);
                        onSelectVideo(m);
                        setMangaPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl border border-amber-400/25 bg-black/45 p-2 text-left transition hover:border-amber-300/60 hover:bg-black/65"
                    >
                      <SmallThumb
                        video={m}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        thumbVersion={thumbVersions[m.id] ?? 0}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-xs font-semibold text-white">{m.title}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-amber-200/90">
                          {m.pageCount ?? m.manifest?.pageCount ?? m.manifest?.pages?.length ?? 0} P
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {pickableManga.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">一致する漫画がありません</p>
              ) : (
                pickableManga.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onEnableSplitWithManga?.();
                      setIsMiniMode(true);
                      onSelectVideo(m);
                      setMangaPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2 text-left transition hover:border-amber-400/40 hover:bg-white/[0.08]"
                  >
                    <SmallThumb video={m} accessToken={accessToken} masterKey={masterKey} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs font-semibold text-zinc-100">{m.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-amber-300/90">
                        {m.pageCount ?? m.manifest?.pageCount ?? m.manifest?.pages?.length ?? 0} P
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
