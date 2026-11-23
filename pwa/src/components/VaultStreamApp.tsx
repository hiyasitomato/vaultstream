"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HorizontalShelf } from "./HorizontalShelf";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckSquare,
  Clock,
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  FolderPlus,
  Globe,
  Grid,
  HardDrive,
  Hash,
  Heart,
  History,
  Home,
  KeyRound,
  Link2,
  List,
  ListMusic,
  ListPlus,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  Unlock,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  buildCrossMediaIndex,
  findRelatedWorks,
  findSeriesAndRelatedVideos,
  findSeriesManga,
  normalizeCrossMediaTitle,
} from "@/lib/crossMedia";
import { unlockVaultWithPassphrase } from "@/lib/crypto";
import {
  buildDriveMediaUrl,
  clearMangaPageCache,
  clearThumbnailCache,
  driveFetchCachedThumbnailUrl,
  EMPTY_STRING_ARRAY,
  fetchVaultVideosFast,
  findOrCreateRootVaultFolder,
  formatBytes,
  getCacheSegmentUrls,
  getSyncCachedThumbnailUrl,
  inspectVaultRoot,
  isValidClientId,
  listUserMetaRevisions,
  loadSyncedUserDataFromDrive,
  loadUserMetaRevisionFromDrive,
  prewarmVideoForInstantPlay,
  requestGoogleAccessToken,
  revokeGoogleAccessToken,
  saveSyncedUserDataToDrive,
  trashVaultItemsInDrive,
} from "@/lib/drive";
import {
  CATEGORY_TAG_SET,
  DEFAULT_CUSTOM_GENRES,
  extractAutoGenres,
  GENRE_GROUP_TABS,
  type GenreGroupId,
  getContentGenresOnly,
  getEffectiveGenres,
  getGenreStyle,
  isCreatorOrStudioGenre,
  matchesGenreGroup,
} from "@/lib/genres";
import { clearSegmentCache, isMainSegmentLoading } from "@/lib/segmentCache";
import {
  clearAllThumbDbCache,
  DISK_CACHE_PRESETS_MB,
  getAllCachedKeys,
  getDiskCacheLimitBytes,
  getDiskCacheLimitMb,
  getDiskCacheStats,
  putCachedPlaylistBytes,
  putCachedSegmentBytes,
  putCachedThumbBytes,
  requestPersistentStorage,
  setDiskCacheLimitMb,
  trimDiskCacheToLimit,
  type DiskCacheStats,
} from "@/lib/thumbDb";
import {
  clearAuthSession,
  clearCachedVaultConfig,
  clearCachedVideoList,
  clearSavedPassphrase,
  createDefaultUserData,
  getSavedClientIdOverride,
  getSavedFolderIdOverride,
  loadAllProgress,
  loadAuthSession,
  loadCachedVaultConfig,
  loadCachedVideoListAsync,
  loadLocalUserData,
  loadSavedPassphrase,
  mergeProgressMaps,
  mergeSyncedUserData,
  saveAllProgress,
  saveAuthSession,
  saveCachedVaultConfig,
  saveCachedVideoList,
  saveLocalUserData,
  savePassphrase,
  setSavedClientIdOverride,
  setSavedFolderIdOverride,
} from "@/lib/storage";
import type {
  CustomGenreDef,
  NavSection,
  PlaybackProgress,
  SortMode,
  SyncedVaultUserData,
  VaultConfig,
  VaultVideoItem,
  VideoUserMeta,
  ViewMode,
} from "@/lib/types";
import { isLikelyExternalUrlInput } from "@/lib/externalVideo";
import ExternalUrlModal from "./ExternalUrlModal";
import MangaReaderModal from "./MangaReaderModal";
import TagEditorModal from "./TagEditorModal";
import UploadVideoModal from "./UploadVideoModal";
import VideoCard from "./VideoCard";
import VideoListRow from "./VideoListRow";
import VideoPlayerModal from "./VideoPlayerModal";

const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const ENV_FOLDER_ID = process.env.NEXT_PUBLIC_VAULT_FOLDER_ID ?? "";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function extractFolderIdFromInput(raw: string): string {
  const trimmed = raw.trim();
  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idMatch) return idMatch[1];
  return trimmed;
}

interface ParsedAutoSetup {
  clientId?: string;
  folderId?: string;
  origins?: string[];
}

function parseAutoSetupPayload(raw: string): ParsedAutoSetup {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const out: ParsedAutoSetup = {};
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const webBlock =
      (parsed.web as Record<string, unknown> | undefined) ??
      (parsed.installed as Record<string, unknown> | undefined);
    if (webBlock && typeof webBlock.client_id === "string") {
      out.clientId = webBlock.client_id.trim();
    }
    if (webBlock && Array.isArray(webBlock.javascript_origins)) {
      out.origins = webBlock.javascript_origins.filter(
        (x): x is string => typeof x === "string"
      );
    }
    const directClient = parsed.c ?? parsed.clientId ?? parsed.client_id;
    if (!out.clientId && typeof directClient === "string") {
      out.clientId = directClient.trim();
    }
    const directFolder = parsed.f ?? parsed.folderId ?? parsed.folder_id;
    if (typeof directFolder === "string" && directFolder.trim()) {
      out.folderId = extractFolderIdFromInput(directFolder);
    }
  } catch {
    // Plain text / pasted URL fallback
  }

  if (!out.clientId) {
    const cidMatch = trimmed.match(/(\d{6,}-[a-z0-9_.-]+\.apps\.googleusercontent\.com)/i);
    if (cidMatch) {
      out.clientId = cidMatch[1];
    }
  }
  if (!out.folderId) {
    const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
    const qMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    if (folderMatch) out.folderId = folderMatch[1];
    else if (qMatch) out.folderId = qMatch[1];
  }
  return out;
}

function encodeAutoConfigPayload(clientId: string, folderId: string): string {
  const payload: Record<string, string> = {};
  if (clientId.trim()) payload.c = clientId.trim();
  if (folderId.trim()) payload.f = folderId.trim();
  return btoa(JSON.stringify(payload));
}

function decodeAutoConfigHash(encoded: string): ParsedAutoSetup {
  try {
    const normalized = decodeURIComponent(encoded.trim())
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const decoded = atob(normalized);
    return parseAutoSetupPayload(decoded);
  } catch {
    return {};
  }
}

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

const CrossMediaMiniThumb = memo(function CrossMediaMiniThumb({
  item,
  accessToken,
  masterKey,
  label,
  thumbVersion = 0,
}: {
  item: VaultVideoItem;
  accessToken: string;
  masterKey: CryptoKey | null;
  label: string;
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

  const needsAmbientBlur = item.kind === "manga";

  return (
    <div className="relative h-24 flex-1 overflow-hidden rounded-lg bg-[#060609] ring-1 ring-white/15">
      {url ? (
        <>
          {needsAmbientBlur && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-75 blur-xl saturate-[1.8] brightness-[0.34]"
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={item.title}
            className="absolute inset-0 z-10 h-full w-full object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.85)]"
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-700">
          {item.kind === "manga" ? <BookOpen className="h-5 w-5" /> : <Film className="h-5 w-5" />}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1 left-1 z-20 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
        {label}
      </span>
    </div>
  );
});

export default function VaultStreamApp() {
  const [clientId, setClientId] = useState(ENV_CLIENT_ID);
  const [folderId, setFolderId] = useState(ENV_FOLDER_ID);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [rememberPassphrase, setRememberPassphrase] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [videos, setVideos] = useState<VaultVideoItem[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, PlaybackProgress>>({});
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});

  // User-managed genres, favorites & sync state
  const [userData, setUserData] = useState<SyncedVaultUserData>(() => createDefaultUserData());
  const syncFileIdRef = useRef<string | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncDataRef = useRef<SyncedVaultUserData | null>(null);
  const syncTimerIsUrgentRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const syncAuthCtxRef = useRef<{
    token: string | null;
    key: CryptoKey | null;
    folder: string;
  }>({ token: null, key: null, folder: "" });
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [restoringHistory, setRestoringHistory] = useState(false);

  // On-device persistent encrypted cache manager (iPad / iPhone / PC instant start!)
  const [cacheModalOpen, setCacheModalOpen] = useState(false);
  const [cacheLimitMb, setCacheLimitMb] = useState<number>(() => getDiskCacheLimitMb());
  const [diskCacheStats, setDiskCacheStats] = useState<DiskCacheStats>({
    thumbCount: 0,
    playlistCount: 0,
    segmentCount: 0,
    segmentBytes: 0,
    totalBytes: 0,
    limitBytes: getDiskCacheLimitBytes(),
    quotaBytes: null,
  });
  const [cacheBuildState, setCacheBuildState] = useState<{
    running: boolean;
    label: string;
    done: number;
    total: number;
    skipped: number;
    downloadedBytes: number;
    speedBps: number;
  }>({
    running: false,
    label: "",
    done: 0,
    total: 0,
    skipped: 0,
    downloadedBytes: 0,
    speedBps: 0,
  });
  const cacheBuildAbortRef = useRef(false);
  const cacheBuildControllerRef = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Navigation & view state
  const [navSection, setNavSection] = useState<NavSection>("home");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Search, category tabs, and multi-genre state
  const [categoryTab, setCategoryTab] = useState<"all" | "現実" | "アニメ" | "漫画">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [genreMatchMode, setGenreMatchMode] = useState<"AND" | "OR">("AND");
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [visibleHomeCount, setVisibleHomeCount] = useState(36);
  const homeLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [homeShuffleSeed, setHomeShuffleSeed] = useState<number>(() =>
    Math.floor(Math.random() * 0x7fffffff)
  );
  const reshuffleHome = useCallback(() => {
    setHomeShuffleSeed(Math.floor(Math.random() * 0x7fffffff));
  }, []);
  const [recProgressSnapshot, setRecProgressSnapshot] = useState<Record<string, PlaybackProgress>>({});

  // Bulk genre assignment mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [bulkNewGenreName, setBulkNewGenreName] = useState("");
  const [bulkGenreGroup, setBulkGenreGroup] = useState<GenreGroupId>("main");
  const [bulkGenreSearch, setBulkGenreSearch] = useState("");

  // Tag UI organization state (grouped pills, quick search & collapse)
  const [homeGenreGroup, setHomeGenreGroup] = useState<GenreGroupId>("main");
  const [homeGenreExpanded, setHomeGenreExpanded] = useState(false);
  const [sidebarGenreMode, setSidebarGenreMode] = useState<"main" | "credits">("main");
  const [sidebarGenreSearch, setSidebarGenreSearch] = useState("");
  const [manageGenreGroup, setManageGenreGroup] = useState<GenreGroupId>("main");
  const [manageGenreSearch, setManageGenreSearch] = useState("");
  const [hideZeroGenres, setHideZeroGenres] = useState(false);

  // Genre management page form state
  const [newGenreName, setNewGenreName] = useState("");
  const [renamingGenre, setRenamingGenre] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // Modals & YouTube-style Playback Queue + Independent Manga Reader
  const [queue, setQueue] = useState<VaultVideoItem[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const [startTimeOverride, setStartTimeOverride] = useState<number | null>(null);
  const [startTimeNonce, setStartTimeNonce] = useState<number>(0);
  const [activeManga, setActiveManga] = useState<VaultVideoItem | null>(null);
  const [mangaSplitMode, setMangaSplitMode] = useState<boolean>(true);
  const [queueToast, setQueueToast] = useState<string | null>(null);
  const [editingTagsVideo, setEditingTagsVideo] = useState<VaultVideoItem | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [externalUrlModalOpen, setExternalUrlModalOpen] = useState(false);
  const [initialExternalUrl, setInitialExternalUrl] = useState("");
  const openExternalUrlModal = useCallback((url = "") => {
    setInitialExternalUrl(url);
    setExternalUrlModalOpen(true);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftClientId, setDraftClientId] = useState("");
  const [draftFolderId, setDraftFolderId] = useState("");
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);
  const [setupWizardNotice, setSetupWizardNotice] = useState<string | null>(null);
  const [autoSetupBusy, setAutoSetupBusy] = useState(false);
  const oauthJsonInputRef = useRef<HTMLInputElement | null>(null);

  const currentQueueItem =
    queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
  const activeVideo =
    currentQueueItem && currentQueueItem.kind !== "manga" ? currentQueueItem : null;

  const queueIdSet = useMemo(() => new Set(queue.map((v) => v.id)), [queue]);

  // Freeze recommendation progress snapshot while a video/manga modal is open so 5s ticks never re-sort the grid mid-playback
  useEffect(() => {
    if (!activeVideo && !activeManga) {
      setRecProgressSnapshot(progressMap);
    }
  }, [activeVideo, activeManga, progressMap]);

  const showQueueToast = useCallback((message: string) => {
    setQueueToast(message);
    setTimeout(() => {
      setQueueToast((cur) => (cur === message ? null : cur));
    }, 2400);
  }, []);

  const handlePlayVideo = useCallback(
    (video: VaultVideoItem, startTimeSec?: number) => {
      // Manga opens in its dedicated reader WITHOUT stopping any playing video!
      if (video.kind === "manga") {
        setActiveManga(video);
        return;
      }
      if (typeof startTimeSec === "number" && Number.isFinite(startTimeSec)) {
        setStartTimeOverride(Math.max(0, startTimeSec));
      } else {
        setStartTimeOverride(null);
      }
      setStartTimeNonce((n) => n + 1);
      setQueue((prev) => {
        const existingIdx = prev.findIndex((item) => item.id === video.id);
        if (existingIdx >= 0) {
          setQueueIndex(existingIdx);
          return prev;
        }
        if (prev.length === 0) {
          setQueueIndex(0);
          return [video];
        }
        const next = [...prev, video];
        setQueueIndex(next.length - 1);
        return next;
      });
    },
    []
  );

  const handleOpenCrossMediaSet = useCallback(
    (mangaItem: VaultVideoItem, videoItem: VaultVideoItem) => {
      setMangaSplitMode(true);
      setActiveManga(mangaItem);
      handlePlayVideo(videoItem);
    },
    [handlePlayVideo]
  );

  const handleSelectQueueIndex = useCallback(
    (idx: number) => {
      setStartTimeOverride(null);
      setQueueIndex(idx);
      const target = queue[idx];
      if (target?.kind === "manga") {
        setActiveManga(target);
      } else if (target) {
        setActiveManga(null);
      }
    },
    [queue]
  );

  const handleAddToQueue = useCallback(
    (video: VaultVideoItem) => {
      setQueue((prev) => {
        if (prev.some((item) => item.id === video.id)) {
          showQueueToast("すでに再生キューに入っています");
          return prev;
        }
        const next = [...prev, video];
        if (prev.length === 0) {
          setQueueIndex(0);
          if (video.kind === "manga") {
            setActiveManga(video);
          }
        }
        showQueueToast(`キューに追加しました（計 ${next.length} 件）`);
        return next;
      });
    },
    [showQueueToast]
  );

  const handlePlayAllFiltered = useCallback(
    (items: VaultVideoItem[]) => {
      if (items.length === 0) return;
      setStartTimeOverride(null);
      setQueue(items);
      setQueueIndex(0);
      if (items[0].kind === "manga") {
        setActiveManga(items[0]);
      }
      showQueueToast(`${items.length} 件をキューで連続再生します`);
    },
    [showQueueToast]
  );

  const handleBulkAddToQueue = useCallback(() => {
    const picked = videos.filter((v) => selectedVideoIds.has(v.id));
    if (picked.length === 0) return;
    setQueue((prev) => {
      const existingIds = new Set(prev.map((v) => v.id));
      const additions = picked.filter((v) => !existingIds.has(v.id));
      const next = [...prev, ...additions];
      if (prev.length === 0 && next.length > 0) {
        setQueueIndex(0);
      }
      showQueueToast(`${additions.length} 本をキューに追加しました（計 ${next.length} 本）`);
      return next;
    });
  }, [videos, selectedVideoIds, showQueueToast]);

  const [deletingItems, setDeletingItems] = useState(false);

  const handleRemoveFromQueue = useCallback((indexToRemove: number) => {
    setQueue((prev) => {
      if (indexToRemove < 0 || indexToRemove >= prev.length) return prev;
      const next = prev.filter((_, idx) => idx !== indexToRemove);
      setQueueIndex((curIdx) => {
        if (next.length === 0) return -1;
        if (indexToRemove < curIdx) return curIdx - 1;
        if (indexToRemove === curIdx) return Math.min(curIdx, next.length - 1);
        return curIdx;
      });
      return next;
    });
  }, []);

  const handleMoveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      setQueueIndex((curIdx) => {
        if (curIdx === fromIndex) return toIndex;
        if (fromIndex < curIdx && toIndex >= curIdx) return curIdx - 1;
        if (fromIndex > curIdx && toIndex <= curIdx) return curIdx + 1;
        return curIdx;
      });
      return next;
    });
  }, []);

  const handleClearQueue = useCallback(() => {
    setQueue((prev) => {
      if (queueIndex >= 0 && queueIndex < prev.length) {
        const current = prev[queueIndex];
        setQueueIndex(0);
        return [current];
      }
      setQueueIndex(-1);
      return [];
    });
  }, [queueIndex]);

  const handleShuffleQueue = useCallback(() => {
    setQueue((prev) => {
      if (prev.length <= 1) return prev;
      const current = queueIndex >= 0 && queueIndex < prev.length ? prev[queueIndex] : null;
      const rest = prev.filter((_, idx) => idx !== queueIndex);
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      if (current) {
        setQueueIndex(0);
        return [current, ...rest];
      }
      return rest;
    });
  }, [queueIndex]);

  const handleClosePlayer = useCallback(() => {
    setStartTimeOverride(null);
    setQueue([]);
    setQueueIndex(-1);
  }, []);

  const { customGenres, videoMeta: userMetaMap, useAutoGenres } = userData;

  const flushCloudSync = useCallback(
    async (token: string | null, key: CryptoKey | null, targetFolder: string) => {
      const payload = pendingSyncDataRef.current;
      const cleanFolder = targetFolder.trim();
      if (!payload || !token || !cleanFolder) return;

      if (syncInFlightRef.current) {
        // Another save is currently uploading; retry shortly with the latest pending payload
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        syncTimerIsUrgentRef.current = true;
        syncTimerRef.current = setTimeout(() => {
          syncTimerRef.current = null;
          syncTimerIsUrgentRef.current = false;
          flushCloudSync(token, key, cleanFolder);
        }, 350);
        return;
      }

      pendingSyncDataRef.current = null;
      syncInFlightRef.current = true;
      setSyncStatus("saving");

      try {
        // Atomic Read-Merge-Write: ALWAYS fetch & merge latest remote user_meta.enc before writing.
        // If an existing remote syncFileId cannot be read (transient network error), ABORT write and retry
        // instead of blindly overwriting remote data!
        let toSave = payload;
        if (syncFileIdRef.current) {
          const latestRemote = await loadSyncedUserDataFromDrive(
            syncFileIdRef.current,
            token,
            key
          );
          if (!latestRemote) {
            throw new Error("REMOTE_META_READ_FAILED");
          }
          toSave = {
            ...mergeSyncedUserData(payload, latestRemote),
            updatedAt: Math.max(payload.updatedAt, latestRemote.updatedAt, Date.now()),
          };
        }

        const fileId = await saveSyncedUserDataToDrive(
          cleanFolder,
          token,
          key,
          toSave,
          syncFileIdRef.current
        );
        syncFileIdRef.current = fileId;
        saveLocalUserData(toSave);
        setUserData((cur) => mergeSyncedUserData(cur, toSave));
        setSyncStatus("saved");
      } catch {
        // Keep payload queued so next edit or flush retries cleanly
        if (!pendingSyncDataRef.current) {
          pendingSyncDataRef.current = payload;
        }
        setSyncStatus("error");
      } finally {
        syncInFlightRef.current = false;
        if (pendingSyncDataRef.current) {
          if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
          syncTimerIsUrgentRef.current = true;
          syncTimerRef.current = setTimeout(() => {
            syncTimerRef.current = null;
            syncTimerIsUrgentRef.current = false;
            const ctx = syncAuthCtxRef.current;
            flushCloudSync(ctx.token ?? token, ctx.key ?? key, ctx.folder || cleanFolder);
          }, 250);
        }
      }
    },
    []
  );

  const scheduleCloudSync = useCallback(
    (
      nextData: SyncedVaultUserData,
      token: string | null,
      key: CryptoKey | null,
      targetFolder: string,
      delayMs = 250,
      urgent = true
    ) => {
      if (!token || !targetFolder.trim()) return;
      syncAuthCtxRef.current = { token, key, folder: targetFolder.trim() };
      pendingSyncDataRef.current = nextData;

      // CRITICAL: Never let slow non-urgent playback progress updates cancel an already-scheduled
      // urgent genre/favorite save timer!
      if (!urgent && syncTimerRef.current && syncTimerIsUrgentRef.current) {
        return;
      }
      if (!urgent && syncTimerRef.current) {
        return;
      }

      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
      syncTimerIsUrgentRef.current = urgent;
      setSyncStatus("saving");
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        syncTimerIsUrgentRef.current = false;
        flushCloudSync(token, key, targetFolder);
      }, delayMs);
    },
    [flushCloudSync]
  );

  // Flush any pending genre/favorite changes immediately when user refreshes or switches tabs/apps
  useEffect(() => {
    syncAuthCtxRef.current = { token: accessToken, key: masterKey, folder: folderId.trim() };
  }, [accessToken, masterKey, folderId]);

  useEffect(() => {
    const flushNow = () => {
      if (!pendingSyncDataRef.current) return;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        syncTimerIsUrgentRef.current = false;
      }
      const ctx = syncAuthCtxRef.current;
      flushCloudSync(ctx.token, ctx.key, ctx.folder);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushCloudSync]);

  const updateUserData = useCallback(
    (
      updater: (prev: SyncedVaultUserData) => SyncedVaultUserData,
      delayMs = 250,
      urgent = true
    ) => {
      setUserData((prev) => {
        const next: SyncedVaultUserData = {
          ...updater(prev),
          version: 1,
          updatedAt: Date.now(),
        };
        saveLocalUserData(next);
        scheduleCloudSync(next, accessToken, masterKey, folderId, delayMs, urgent);
        return next;
      });
    },
    [accessToken, masterKey, folderId, scheduleCloudSync]
  );

  const loadLibrary = useCallback(
    async (
      token: string,
      targetFolderId: string,
      existingKey: CryptoKey | null = null,
      forceFullScan = false
    ) => {
      const cleanFolderId = targetFolderId.trim();
      if (!cleanFolderId) {
        setError("Google Drive フォルダ ID が設定されていません。");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let keyToUse = existingKey;

        // 0.1s Instant Boot: restore VaultConfig + IndexedDB library BEFORE hitting network!
        if (!forceFullScan) {
          const [cachedCfg, cachedItems] = await Promise.all([
            Promise.resolve(loadCachedVaultConfig(cleanFolderId)),
            loadCachedVideoListAsync<VaultVideoItem>(cleanFolderId),
          ]);
          if (cachedCfg && !keyToUse) {
            const savedPass = loadSavedPassphrase();
            if (savedPass) {
              try {
                keyToUse = await unlockVaultWithPassphrase(savedPass, cachedCfg);
                setVaultConfig(cachedCfg);
                setMasterKey(keyToUse);
              } catch {
                // Fall back to fresh inspectVaultRoot below if vault.json changed
                keyToUse = null;
              }
            }
          } else if (cachedCfg) {
            setVaultConfig((prev) => prev ?? cachedCfg);
          }
          if (cachedItems && cachedItems.length > 0 && (!cachedCfg || keyToUse)) {
            setVideos((prev) => (prev.length === 0 ? cachedItems : prev));
            setLoading(false);
          }
        }

        // Single root inspection call (replaces 3 separate root listings!)
        const snapshot = await inspectVaultRoot(cleanFolderId, token);
        const cfg = snapshot.vaultConfig;
        setVaultConfig(cfg);
        saveCachedVaultConfig(cleanFolderId, cfg);

        if (cfg && !keyToUse) {
          const savedPass = loadSavedPassphrase();
          if (savedPass) {
            try {
              keyToUse = await unlockVaultWithPassphrase(savedPass, cfg);
              setMasterKey(keyToUse);
            } catch {
              clearSavedPassphrase();
              setMasterKey(null);
              setVideos([]);
              setLoading(false);
              return;
            }
          } else {
            setVideos([]);
            setLoading(false);
            return;
          }
        }

        if (snapshot.syncFileId) {
          syncFileIdRef.current = snapshot.syncFileId;
        }

        const [items, remoteUserData] = await Promise.all([
          fetchVaultVideosFast(
            cleanFolderId,
            snapshot,
            token,
            keyToUse,
            forceFullScan
          ),
          loadSyncedUserDataFromDrive(snapshot.syncFileId, token, keyToUse).catch(
            () => null
          ),
        ]);

        setVideos(items);
        saveCachedVideoList(cleanFolderId, items);

        const localProgress = loadAllProgress();
        if (remoteUserData) {
          const localRaw = loadLocalUserData();
          const localWithProgress: SyncedVaultUserData = {
            ...localRaw,
            progress: mergeProgressMaps(localProgress, localRaw.progress),
          };
          const mergedBase = mergeSyncedUserData(localWithProgress, remoteUserData);
          const mergedProgress = mergedBase.progress ?? localProgress;
          saveAllProgress(mergedProgress);
          setProgressMap(mergedProgress);

          const seededGenres =
            mergedBase.customGenres && mergedBase.customGenres.length > 0
              ? mergedBase.customGenres
              : DEFAULT_CUSTOM_GENRES.map((g) => ({ ...g }));
          const mergedUserData: SyncedVaultUserData = {
            ...mergedBase,
            customGenres: seededGenres,
            progress: mergedProgress,
          };
          setUserData(mergedUserData);
          saveLocalUserData(mergedUserData);

          const remoteMetaJson = JSON.stringify(remoteUserData.videoMeta ?? {});
          const mergedMetaJson = JSON.stringify(mergedUserData.videoMeta ?? {});
          const remoteGenresJson = JSON.stringify(remoteUserData.customGenres ?? []);
          const mergedGenresJson = JSON.stringify(mergedUserData.customGenres ?? []);
          const remoteProgJson = JSON.stringify(remoteUserData.progress ?? {});
          const mergedProgJson = JSON.stringify(mergedProgress);
          if (
            remoteMetaJson !== mergedMetaJson ||
            remoteGenresJson !== mergedGenresJson ||
            remoteProgJson !== mergedProgJson
          ) {
            scheduleCloudSync(
              { ...mergedUserData, updatedAt: Date.now() },
              token,
              keyToUse,
              cleanFolderId,
              300,
              true
            );
          } else {
            setSyncStatus("saved");
          }
        } else if (!snapshot.syncFileId && Object.keys(localProgress).length > 0) {
          // Only initialize a brand-new user_meta.enc when Drive truly has NO sync file yet.
          // Never overwrite an existing remote syncFileId if reading it failed transiently!
          const local = loadLocalUserData();
          const withProgress: SyncedVaultUserData = {
            ...local,
            progress: localProgress,
            updatedAt: Date.now(),
          };
          setUserData(withProgress);
          saveLocalUserData(withProgress);
          scheduleCloudSync(withProgress, token, keyToUse, cleanFolderId);
        }
      } catch (err) {
        if (err instanceof Error && err.message === "AUTH_EXPIRED") {
          clearAuthSession();
          setAccessToken(null);
          setError("セッションの有効期限が切れました。再度 Google でログインしてください。");
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "動画ライブラリの取得に失敗しました。"
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [scheduleCloudSync]
  );

  // Restore local state, URL #autoconfig= auto-provisioning & saved OAuth session on mount
  useEffect(() => {
    setProgressMap(loadAllProgress());
    setUserData(loadLocalUserData());

    let resolvedClient = getSavedClientIdOverride() || ENV_CLIENT_ID;
    let resolvedFolder = getSavedFolderIdOverride() || ENV_FOLDER_ID;
    let autoConfiguredFromUrl = false;

    const rawHash = window.location.hash || "";
    const autoMatch = rawHash.match(/#autoconfig=([^&]+)/);
    const searchParams = new URLSearchParams(window.location.search);
    const urlAuto = autoMatch ? decodeAutoConfigHash(autoMatch[1]) : {};
    const queryClient = searchParams.get("client_id");
    const queryFolder = searchParams.get("folder_id");

    const incomingClient = urlAuto.clientId || queryClient?.trim() || "";
    const incomingFolder = urlAuto.folderId || (queryFolder ? extractFolderIdFromInput(queryFolder) : "");

    if (incomingClient && isValidClientId(incomingClient)) {
      setSavedClientIdOverride(incomingClient);
      resolvedClient = incomingClient;
      setDraftClientId(incomingClient);
      autoConfiguredFromUrl = true;
    }
    if (incomingFolder) {
      setSavedFolderIdOverride(incomingFolder);
      resolvedFolder = incomingFolder;
      setDraftFolderId(incomingFolder);
      autoConfiguredFromUrl = true;
    }
    if (autoMatch) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    setClientId(resolvedClient);
    setFolderId(resolvedFolder);
    if (!isValidClientId(resolvedClient)) {
      setAutoSetupOpen(true);
    }
    if (autoConfiguredFromUrl) {
      setSetupWizardNotice("URL から接続設定を自動取り込みしました！下のログインボタンから開始できます。");
      showQueueToast("URL から接続設定を自動設定しました！");
    }

    const savedAuth = loadAuthSession();
    if (savedAuth) {
      setAccessToken(savedAuth.accessToken);
      if (resolvedFolder) {
        loadLibrary(savedAuth.accessToken, resolvedFolder);
      } else {
        findOrCreateRootVaultFolder(savedAuth.accessToken)
          .then((ensured) => {
            setSavedFolderIdOverride(ensured.id);
            setFolderId(ensured.id);
            setDraftFolderId(ensured.id);
            return loadLibrary(savedAuth.accessToken, ensured.id);
          })
          .catch(() => undefined);
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => undefined);
    }
    requestPersistentStorage().catch(() => undefined);
  }, [loadLibrary, showQueueToast]);

  const effectiveClientIdValid = isValidClientId(clientId);
  const effectiveFolderIdValid = folderId.trim().length > 0;

  const handleSignIn = async () => {
    if (!effectiveClientIdValid) {
      setDraftClientId(isValidClientId(clientId) ? clientId : "");
      setDraftFolderId(folderId);
      setAutoSetupOpen(true);
      setSettingsOpen(true);
      return;
    }

    setAuthLoading(true);
    setError(null);
    try {
      const { accessToken: token, expiresAt } = await requestGoogleAccessToken(
        clientId.trim(),
        "select_account"
      );
      saveAuthSession(token, expiresAt);
      setAccessToken(token);
      let targetFolder = folderId.trim();
      if (!targetFolder) {
        const ensured = await findOrCreateRootVaultFolder(token);
        targetFolder = ensured.id;
        setSavedFolderIdOverride(targetFolder);
        setFolderId(targetFolder);
        setDraftFolderId(targetFolder);
        showQueueToast(
          ensured.created
            ? `Google Drive に専用フォルダ「${ensured.name}」を自動作成しました！`
            : `既存の Vault フォルダ「${ensured.name}」を自動検出しました！`
        );
      }
      await loadLibrary(token, targetFolder, masterKey);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Google ログインに失敗しました。"
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = () => {
    if (accessToken) {
      revokeGoogleAccessToken(accessToken);
    }
    clearAuthSession();
    clearSavedPassphrase();
    clearThumbnailCache(true);
    clearMangaPageCache();
    clearSegmentCache();
    clearCachedVideoList(folderId);
    clearCachedVaultConfig(folderId);
    syncFileIdRef.current = null;
    setAccessToken(null);
    setVaultConfig(null);
    setMasterKey(null);
    setVideos([]);
    setQueue([]);
    setQueueIndex(-1);
    setActiveManga(null);
    setError(null);
  };

  const handleUnlockVault = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vaultConfig || !accessToken) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const derived = await unlockVaultWithPassphrase(passphraseInput, vaultConfig);
      if (rememberPassphrase) {
        savePassphrase(passphraseInput);
      } else {
        clearSavedPassphrase();
      }
      setMasterKey(derived);
      setPassphraseInput("");
      await loadLibrary(accessToken, folderId, derived);
    } catch (err) {
      setUnlockError(
        err instanceof Error ? err.message : "ロック解除に失敗しました。"
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handleLockVault = () => {
    clearSavedPassphrase();
    clearThumbnailCache(false);
    clearMangaPageCache();
    clearSegmentCache();
    clearCachedVideoList(folderId);
    clearCachedVaultConfig(folderId);
    setMasterKey(null);
    setVideos([]);
    setQueue([]);
    setQueueIndex(-1);
    setActiveManga(null);
    setPassphraseInput("");
  };

  const handleAuthExpired = useCallback(() => {
    clearAuthSession();
    setQueue([]);
    setQueueIndex(-1);
    setAccessToken(null);
    setError("アクセストークンの有効期限が切れました。再度ログインしてください。");
  }, []);

  const handleOpenSettings = () => {
    setDraftClientId(isValidClientId(clientId) ? clientId : "");
    setDraftFolderId(folderId);
    setSettingsOpen(true);
  };

  const handleSaveSettings = (event: React.FormEvent) => {
    event.preventDefault();
    const nextClient = draftClientId.trim();
    const nextFolder = extractFolderIdFromInput(draftFolderId);
    setSavedClientIdOverride(nextClient);
    setSavedFolderIdOverride(nextFolder);
    setClientId(nextClient || ENV_CLIENT_ID);
    setFolderId(nextFolder || ENV_FOLDER_ID);
    setSettingsOpen(false);
    setError(null);
  };

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const currentAppUrl =
    typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}` : "";

  const applyAutoSetupText = useCallback(
    (raw: string, sourceLabel: string): boolean => {
      const parsed = parseAutoSetupPayload(raw);
      let applied = false;
      const notices: string[] = [];

      if (parsed.clientId && isValidClientId(parsed.clientId)) {
        setSavedClientIdOverride(parsed.clientId);
        setClientId(parsed.clientId);
        setDraftClientId(parsed.clientId);
        setError(null);
        applied = true;
        if (
          parsed.origins &&
          parsed.origins.length > 0 &&
          typeof window !== "undefined" &&
          !parsed.origins.includes(window.location.origin)
        ) {
          notices.push(
            `クライアント ID を${sourceLabel}から自動設定しました（※ Google Cloud の「承認済みの JavaScript 生成元」に ${window.location.origin} も登録されているか確認してください）。`
          );
        } else {
          notices.push(`クライアント ID を${sourceLabel}から自動設定しました！`);
        }
      }

      if (parsed.folderId) {
        setSavedFolderIdOverride(parsed.folderId);
        setFolderId(parsed.folderId);
        setDraftFolderId(parsed.folderId);
        applied = true;
        notices.push(`Google Drive フォルダ ID を${sourceLabel}から設定しました！`);
      }

      if (applied) {
        const msg = notices.join(" ");
        setSetupWizardNotice(msg);
        showQueueToast(msg);
      }
      return applied;
    },
    [showQueueToast]
  );

  const handleOAuthJsonUpload = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const ok = applyAutoSetupText(text, `ファイル「${file.name}」`);
        if (!ok) {
          setSetupWizardNotice(
            "選択された JSON から OAuth クライアント ID が見つかりませんでした。Google Cloud で「ウェブ アプリケーション」用の JSON をダウンロードしているか確認してください。"
          );
        }
      } catch {
        setSetupWizardNotice("JSON ファイルの読み込みに失敗しました。");
      }
    },
    [applyAutoSetupText]
  );

  const handleReadClipboardSetup = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!applyAutoSetupText(text, "クリップボード")) {
        setSetupWizardNotice(
          "クリップボードから *.apps.googleusercontent.com や JSON が見つかりませんでした。コピーしてからもう一度押してください。"
        );
      }
    } catch {
      setSetupWizardNotice(
        "ブラウザのクリップボード許可が必要です。このまま画面上で Ctrl+V（または Cmd+V）で貼り付けると自動で読み取ります。"
      );
    }
  }, [applyAutoSetupText]);

  const handleCopyCurrentOrigin = useCallback(async () => {
    if (!currentOrigin) return;
    try {
      await navigator.clipboard.writeText(currentOrigin);
      showQueueToast(`生成元 URL（${currentOrigin}）をコピーしました！`);
    } catch {
      // ignore clipboard errors
    }
  }, [currentOrigin, showQueueToast]);

  const cloudShellCommand = useMemo(() => {
    const origin = currentOrigin || "https://hiyasitomato.github.io";
    const appUrl = currentAppUrl || "https://hiyasitomato.github.io/vaultstream/";
    return [
      "ACCT=$(gcloud config get-value account 2>/dev/null)",
      'PID=$(gcloud projects list --filter="projectId:vaultstream-*" --format="value(projectId)" --limit=1)',
      '{ [ -n "$PID" ] || { PID="vaultstream-$(date +%s | tail -c 6)" && gcloud projects create "$PID" --name="VaultStream"; }; } && gcloud config set project "$PID" && gcloud services enable drive.googleapis.com && echo "" && echo "✅ 準備完了 (Project: $PID / Account: $ACCT)" && echo "1. テストユーザーに [$ACCT] を追加: https://console.cloud.google.com/auth/audience?project=$PID" && echo "2. 承認済みJS生成元に [' +
        origin +
        '] を入力してWebクライアント作成: https://console.cloud.google.com/auth/clients/create?project=$PID" && read -rp "3. 作成したクライアントIDを貼り付けてEnter: " CID && CID=$(echo "$CID" | xargs) && B64=$(printf \'{"c":"%s"}\' "$CID" | base64 | tr -d \'\\n\') && echo "🎉 このリンクを開くと自動設定されます: ' +
        appUrl +
        '#autoconfig=$B64"',
    ].join("; ");
  }, [currentAppUrl, currentOrigin]);

  const handleCopyCloudShellCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cloudShellCommand);
      setSetupWizardNotice(
        "Cloud Shell 自動セットアップコマンドをコピーしました！開いたターミナルに貼り付けて Enter を押すだけでプロジェクト作成＆Drive API有効化＆自動設定リンク生成まで一括で進みます。"
      );
      showQueueToast("Cloud Shell コマンドをコピーしました！");
    } catch {
      setSetupWizardNotice(
        "Cloud Shell を開きました。下の自動構築コマンドをコピーして貼り付け、Enter を押してください。"
      );
    }
    window.open("https://shell.cloud.google.com/?show=terminal", "_blank", "noopener,noreferrer");
  }, [cloudShellCommand, showQueueToast]);

  const copyAutoConfigLink = useCallback(
    async (rawClientId: string, rawFolderId: string) => {
      const cid = rawClientId.trim();
      const fid = extractFolderIdFromInput(rawFolderId);
      if (!currentAppUrl || !isValidClientId(cid)) {
        showQueueToast("先に OAuth クライアント ID を設定してください");
        return;
      }
      const url = `${currentAppUrl}#autoconfig=${encodeURIComponent(
        encodeAutoConfigPayload(cid, fid)
      )}`;
      try {
        await navigator.clipboard.writeText(url);
        showQueueToast("他端末（iPhone・iPad 等）用の 1タップ自動設定リンクをコピーしました！");
      } catch {
        showQueueToast("リンクのコピーに失敗しました");
      }
    },
    [currentAppUrl, showQueueToast]
  );

  const handleAutoSetupDriveFolder = useCallback(async () => {
    if (!accessToken && !isValidClientId(clientId)) {
      setSetupWizardNotice("先に Web 用 OAuth クライアント ID を設定してください。");
      return;
    }
    setAutoSetupBusy(true);
    try {
      let token = accessToken;
      if (!token) {
        const res = await requestGoogleAccessToken(clientId.trim(), "select_account");
        token = res.accessToken;
        saveAuthSession(res.accessToken, res.expiresAt);
        setAccessToken(res.accessToken);
      }
      const ensured = await findOrCreateRootVaultFolder(token);
      setSavedFolderIdOverride(ensured.id);
      setFolderId(ensured.id);
      setDraftFolderId(ensured.id);
      const msg = ensured.created
        ? `Google Drive に「${ensured.name}」フォルダを自動作成しました！`
        : `Google Drive の既存フォルダ「${ensured.name}」を自動検出しました！`;
      setSetupWizardNotice(msg);
      showQueueToast(msg);
      await loadLibrary(token, ensured.id, masterKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "フォルダの自動作成・検出に失敗しました。";
      setSetupWizardNotice(msg);
    } finally {
      setAutoSetupBusy(false);
    }
  }, [accessToken, clientId, loadLibrary, masterKey, showQueueToast]);

  // Global paste detector during onboarding / settings so pasted OAuth Client ID, JSON, or Drive URLs apply automatically
  useEffect(() => {
    if (accessToken && !settingsOpen) return;
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text");
      if (!text) return;
      if (
        text.includes(".apps.googleusercontent.com") ||
        text.includes('"client_id"') ||
        text.includes("drive.google.com/drive/folders/")
      ) {
        applyAutoSetupText(text, "貼り付けデータ");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accessToken, settingsOpen, applyAutoSetupText]);

  const handleVideosUploaded = useCallback(
    (newItems: VaultVideoItem[]) => {
      if (newItems.length === 0) return;
      setVideos((prev) => {
        const next = [...newItems, ...prev];
        saveCachedVideoList(folderId.trim(), next);
        return next;
      });
      showQueueToast(`${newItems.length} 本の動画を暗号化アップロードしました！`);
      if (accessToken && folderId.trim()) {
        loadLibrary(accessToken, folderId, masterKey, true);
      }
    },
    [accessToken, folderId, masterKey, loadLibrary, showQueueToast]
  );

  const handleProgressUpdated = useCallback(
    (videoId: string, progress: PlaybackProgress) => {
      setProgressMap((prev) => ({
        ...prev,
        [videoId]: progress,
      }));
      updateUserData(
        (prev) => ({
          ...prev,
          progress: {
            ...(prev.progress ?? {}),
            [videoId]: progress,
          },
        }),
        8000,
        false
      );
    },
    [updateUserData]
  );

  const handleThumbnailUpdated = useCallback(
    (videoId: string, capturedTimeSec: number, updatedAtIso?: string) => {
      const stamp = updatedAtIso || new Date().toISOString();
      setVideos((prev) =>
        prev.map((v) => (v.id === videoId ? { ...v, thumbnailModifiedTime: stamp } : v))
      );
      setThumbVersions((prev) => ({
        ...prev,
        [videoId]: (prev[videoId] ?? 0) + 1,
      }));
      updateUserData((prev) => {
        const cur = prev.videoMeta[videoId] ?? {};
        return {
          ...prev,
          videoMeta: {
            ...prev.videoMeta,
            [videoId]: {
              ...cur,
              thumbnailTimeSec: capturedTimeSec,
              thumbnailUpdatedAt: stamp,
              updatedAt: Date.now(),
            },
          },
        };
      });
    },
    [updateUserData]
  );

  // Sync user-chosen custom thumbnail stamps from user_meta.enc onto all loaded videos
  // so every device (PC, iPhone, iPad) immediately invalidates stale IndexedDB thumbnails!
  useEffect(() => {
    const metaMap = userData.videoMeta;
    setVideos((prev) => {
      let changed = false;
      const next = prev.map((v) => {
        const meta = metaMap[v.id];
        const effectiveStamp =
          meta?.thumbnailUpdatedAt ??
          (typeof meta?.thumbnailTimeSec === "number"
            ? `custom-${Math.round(meta.thumbnailTimeSec * 10)}`
            : undefined);
        if (effectiveStamp && v.thumbnailModifiedTime !== effectiveStamp) {
          changed = true;
          return { ...v, thumbnailModifiedTime: effectiveStamp };
        }
        return v;
      });
      return changed ? next : prev;
    });
  }, [userData.videoMeta, videos.length]);

  const handleToggleFavorite = useCallback(
    (videoId: string) => {
      updateUserData((prev) => {
        const cur = prev.videoMeta[videoId] ?? {};
        return {
          ...prev,
          videoMeta: {
            ...prev.videoMeta,
            [videoId]: { ...cur, favorite: !cur.favorite, updatedAt: Date.now() },
          },
        };
      });
    },
    [updateUserData]
  );

  const videoGenresMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const v of videos) {
      map[v.id] = getEffectiveGenres(v, userMetaMap[v.id], useAutoGenres, customGenres);
    }
    return map;
  }, [videos, userMetaMap, useAutoGenres, customGenres]);

  const handleCreateCustomGenre = useCallback(
    (name: string, color: string) => {
      const cleaned = name.trim().replace(/^#/, "");
      if (!cleaned) return;
      updateUserData((prev) => {
        if (prev.customGenres.some((g) => g.name === cleaned)) {
          return prev;
        }
        return {
          ...prev,
          customGenresUpdatedAt: Date.now(),
          customGenres: [{ name: cleaned, color }, ...prev.customGenres],
        };
      });
    },
    [updateUserData]
  );

  // 1-Tap "Expand Anime Genres & Auto-Classify":
  // 1. Seeds all rich anime sub-genres into customGenres
  // 2. Inherits existing series genres across episodes of the same anime series
  // 3. Applies keyword matching (title + filename) onto all anime videos and syncs to Drive
  const handleAutoEnrichAnimeGenres = useCallback(() => {
    let newGenreCount = 0;
    let updatedVideoCount = 0;
    let totalAddedTags = 0;

    updateUserData((prev) => {
      const now = Date.now();
      const existingNames = new Set(prev.customGenres.map((g) => g.name));
      const genreAdditions = DEFAULT_CUSTOM_GENRES.filter((g) => !existingNames.has(g.name));
      newGenreCount = genreAdditions.length;
      const mergedCustom = [...prev.customGenres, ...genreAdditions];
      const allowedSet = new Set(mergedCustom.map((g) => g.name));

      const isAnimeItem = (v: VaultVideoItem): boolean => {
        if (v.kind === "manga") return false;
        const m = prev.videoMeta[v.id];
        const added = new Set(m?.addedGenres ?? []);
        return !added.has("現実");
      };

      // Build series-level inheritance map from already-tagged episodes
      const seriesTags = new Map<string, Set<string>>();
      for (const v of videos) {
        if (!isAnimeItem(v)) continue;
        const normKey = normalizeCrossMediaTitle(v.title);
        if (normKey.length < 3) continue;
        const m = prev.videoMeta[v.id];
        for (const g of m?.addedGenres ?? []) {
          const clean = g.trim();
          if (clean && !CATEGORY_TAG_SET.has(clean) && clean !== "神回・お気に入り") {
            let set = seriesTags.get(normKey);
            if (!set) {
              set = new Set<string>();
              seriesTags.set(normKey, set);
            }
            set.add(clean);
          }
        }
      }

      const nextMeta: Record<string, VideoUserMeta> = { ...prev.videoMeta };
      for (const v of videos) {
        const isManga = v.kind === "manga";
        if (!isManga && !isAnimeItem(v)) continue;
        const cur = nextMeta[v.id] ?? {};
        const added = new Set(cur.addedGenres ?? []);
        const removed = new Set(cur.removedGenres ?? []);
        let addedForVideo = 0;

        const primaryCat = isManga ? "漫画" : "アニメ";
        if (!added.has(primaryCat) && !removed.has(primaryCat)) {
          added.add(primaryCat);
          addedForVideo += 1;
        }

        if (!isManga) {
          const normKey = normalizeCrossMediaTitle(v.title);
          if (normKey.length >= 3) {
            const inherited = seriesTags.get(normKey);
            if (inherited) {
              for (const g of inherited) {
                if (!added.has(g) && !removed.has(g)) {
                  added.add(g);
                  addedForVideo += 1;
                }
              }
            }
          }
        }

        for (const g of extractAutoGenres(v, allowedSet)) {
          if (!added.has(g) && !removed.has(g) && !CATEGORY_TAG_SET.has(g)) {
            added.add(g);
            addedForVideo += 1;
          }
        }

        if (addedForVideo > 0) {
          updatedVideoCount += 1;
          totalAddedTags += addedForVideo;
          nextMeta[v.id] = {
            ...cur,
            addedGenres: Array.from(added),
            updatedAt: now,
          };
        }
      }

      if (newGenreCount === 0 && updatedVideoCount === 0) {
        return prev;
      }

      return {
        ...prev,
        customGenresUpdatedAt: newGenreCount > 0 ? now : prev.customGenresUpdatedAt,
        customGenres: mergedCustom,
        videoMeta: nextMeta,
      };
    });

    if (newGenreCount === 0 && updatedVideoCount === 0) {
      showQueueToast("アニメジャンルと自動振り分けはすでに最新です");
    } else {
      showQueueToast(
        `新ジャンル +${newGenreCount} 件 / アニメ ${updatedVideoCount} 本に計 ${totalAddedTags} 件を自動付与しました！`
      );
    }
  }, [videos, updateUserData, showQueueToast]);

  // 1-click lossless recovery from Google Drive's encrypted user_meta.enc revision history!
  const handleRestoreGenresFromHistory = useCallback(async () => {
    if (!accessToken || !syncFileIdRef.current || restoringHistory) return;
    setRestoringHistory(true);
    try {
      const fileId = syncFileIdRef.current;
      const revisions = await listUserMetaRevisions(fileId, accessToken);
      if (revisions.length === 0) {
        showQueueToast("Drive に過去の履歴が見つかりませんでした");
        return;
      }

      // Pick the top 4 largest past revisions (captures the peak snapshot before any overwrite!)
      const sortedBySize = [...revisions]
        .filter((r) => Number(r.size || 0) > 0)
        .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
      const topRevs = sortedBySize.slice(0, 4);

      const snapshots = (
        await Promise.all(
          topRevs.map((r) =>
            loadUserMetaRevisionFromDrive(fileId, r.id, accessToken, masterKey)
          )
        )
      ).filter((s): s is SyncedVaultUserData => Boolean(s && s.videoMeta));

      if (snapshots.length === 0) {
        showQueueToast("過去の履歴を復号できませんでした");
        return;
      }

      const latestRemote = await loadSyncedUserDataFromDrive(
        fileId,
        accessToken,
        masterKey
      ).catch(() => null);
      const baseCur = latestRemote
        ? mergeSyncedUserData(userData, latestRemote)
        : userData;

      const now = Date.now();
      const customByName = new Map<string, CustomGenreDef>();
      for (const cg of baseCur.customGenres ?? []) {
        if (cg.name) customByName.set(cg.name, cg);
      }
      for (const snap of snapshots) {
        for (const cg of snap.customGenres ?? []) {
          if (cg.name && !customByName.has(cg.name)) {
            customByName.set(cg.name, cg);
          }
        }
      }

      const restoredMeta: Record<string, VideoUserMeta> = {};
      const allVids = new Set<string>(Object.keys(baseCur.videoMeta ?? {}));
      for (const snap of snapshots) {
        for (const vid of Object.keys(snap.videoMeta ?? {})) {
          allVids.add(vid);
        }
      }

      let recoveredVideoCount = 0;
      let recoveredTagCount = 0;
      let mergedProgress = baseCur.progress ?? {};

      for (const snap of snapshots) {
        mergedProgress = mergeProgressMaps(mergedProgress, snap.progress);
      }

      for (const vid of allVids) {
        const curM = baseCur.videoMeta?.[vid];
        const curAdded = new Set<string>(curM?.addedGenres ?? []);
        const unionAdded = new Set<string>(curAdded);
        let fav = Boolean(curM?.favorite);
        let thumbSec = curM?.thumbnailTimeSec;
        let thumbStamp = curM?.thumbnailUpdatedAt;

        for (const snap of snapshots) {
          const oldM = snap.videoMeta?.[vid];
          if (!oldM) continue;
          for (const g of oldM.addedGenres ?? []) {
            if (g && g.trim()) unionAdded.add(g.trim());
          }
          if (oldM.favorite) fav = true;
          if (thumbSec === undefined && oldM.thumbnailTimeSec !== undefined) {
            thumbSec = oldM.thumbnailTimeSec;
          }
          if (!thumbStamp && oldM.thumbnailUpdatedAt) {
            thumbStamp = oldM.thumbnailUpdatedAt;
          }
        }

        const addedDelta = unionAdded.size - curAdded.size;
        const favRestored = fav && !curM?.favorite;
        if (addedDelta > 0 || favRestored) {
          recoveredVideoCount += 1;
          recoveredTagCount += Math.max(0, addedDelta);
        }

        const keptRemoved = (curM?.removedGenres ?? []).filter((g) => !unionAdded.has(g));
        restoredMeta[vid] = {
          ...(curM ?? {}),
          favorite: fav || undefined,
          addedGenres: Array.from(unionAdded),
          removedGenres: keptRemoved,
          thumbnailTimeSec: thumbSec,
          thumbnailUpdatedAt: thumbStamp,
          updatedAt: addedDelta > 0 || favRestored ? now : (curM?.updatedAt ?? now),
        };
      }

      const finalRestored: SyncedVaultUserData = {
        version: 1,
        updatedAt: now,
        customGenresUpdatedAt: now,
        useAutoGenres: baseCur.useAutoGenres,
        customGenres: Array.from(customByName.values()),
        videoMeta: restoredMeta,
        progress: mergedProgress,
      };

      setUserData(finalRestored);
      saveLocalUserData(finalRestored);
      setProgressMap(mergedProgress);
      saveAllProgress(mergedProgress);

      const savedId = await saveSyncedUserDataToDrive(
        folderId.trim(),
        accessToken,
        masterKey,
        finalRestored,
        fileId
      );
      syncFileIdRef.current = savedId;
      setSyncStatus("saved");

      if (recoveredVideoCount > 0) {
        showQueueToast(
          `履歴から復元しました！（${recoveredVideoCount}本の動画・計${recoveredTagCount}件のジャンルを復旧）`
        );
      } else {
        showQueueToast("最新の履歴と照合済みです（不足しているジャンルはありませんでした）");
      }
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_EXPIRED") {
        handleAuthExpired();
        return;
      }
      showQueueToast("履歴からの復元に失敗しました（もう一度お試しください）");
    } finally {
      setRestoringHistory(false);
    }
  }, [accessToken, masterKey, folderId, userData, restoringHistory, showQueueToast, handleAuthExpired]);

  const handleRenameCustomGenre = useCallback(
    (oldName: string, newNameRaw: string) => {
      const newName = newNameRaw.trim().replace(/^#/, "");
      if (!newName || newName === oldName) {
        setRenamingGenre(null);
        return;
      }
      updateUserData((prev) => {
        const now = Date.now();
        const updatedGenres = prev.customGenres.map((g) =>
          g.name === oldName ? { ...g, name: newName } : g
        );
        const updatedMeta: Record<string, VideoUserMeta> = {};
        for (const [vid, meta] of Object.entries(prev.videoMeta)) {
          const hadOld =
            meta.addedGenres?.includes(oldName) || meta.removedGenres?.includes(oldName);
          updatedMeta[vid] = hadOld
            ? {
                ...meta,
                addedGenres: meta.addedGenres?.map((g) => (g === oldName ? newName : g)),
                removedGenres: meta.removedGenres?.map((g) => (g === oldName ? newName : g)),
                updatedAt: now,
              }
            : meta;
        }
        return {
          ...prev,
          customGenresUpdatedAt: now,
          customGenres: updatedGenres,
          videoMeta: updatedMeta,
        };
      });
      setSelectedGenres((prev) => prev.map((g) => (g === oldName ? newName : g)));
      setRenamingGenre(null);
    },
    [updateUserData]
  );

  const handleDeleteCustomGenre = useCallback(
    (genreName: string) => {
      updateUserData((prev) => {
        const now = Date.now();
        const updatedGenres = prev.customGenres.filter((g) => g.name !== genreName);
        const updatedMeta: Record<string, VideoUserMeta> = {};
        for (const [vid, meta] of Object.entries(prev.videoMeta)) {
          const had = meta.addedGenres?.includes(genreName);
          updatedMeta[vid] = had
            ? {
                ...meta,
                addedGenres: meta.addedGenres?.filter((g) => g !== genreName),
                updatedAt: now,
              }
            : meta;
        }
        return {
          ...prev,
          customGenresUpdatedAt: now,
          customGenres: updatedGenres,
          videoMeta: updatedMeta,
        };
      });
      setSelectedGenres((prev) => prev.filter((g) => g !== genreName));
    },
    [updateUserData]
  );

  const handleDeleteVaultItems = useCallback(
    async (itemsToDelete: VaultVideoItem[]) => {
      if (itemsToDelete.length === 0 || deletingItems) return;
      if (!accessToken || !folderId.trim()) {
        showQueueToast("Googleドライブにログインしてから削除してください");
        return;
      }
      const confirmMsg =
        itemsToDelete.length === 1
          ? `「${itemsToDelete[0].title}」をGoogleドライブのゴミ箱へ移動しますか？`
          : `選択した ${itemsToDelete.length} 件をGoogleドライブのゴミ箱へ移動しますか？`;
      if (!window.confirm(confirmMsg)) return;

      setDeletingItems(true);
      try {
        await trashVaultItemsInDrive(folderId.trim(), itemsToDelete, accessToken, masterKey);
        const deletedIdSet = new Set(itemsToDelete.map((v) => v.id));
        setVideos((prev) => prev.filter((v) => !deletedIdSet.has(v.id)));
        setSelectedVideoIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedIdSet) next.delete(id);
          return next;
        });
        updateUserData((prev) => {
          const nextMeta = { ...prev.videoMeta };
          for (const id of deletedIdSet) delete nextMeta[id];
          return {
            ...prev,
            videoMeta: nextMeta,
            updatedAt: Date.now(),
          };
        });
        if (activeVideo && deletedIdSet.has(activeVideo.id)) {
          handleClosePlayer();
        }
        setActiveManga((prev) => (prev && deletedIdSet.has(prev.id) ? null : prev));
        setEditingTagsVideo((prev) => (prev && deletedIdSet.has(prev.id) ? null : prev));
        setQueue((prev) => prev.filter((v) => !deletedIdSet.has(v.id)));
        showQueueToast(`${itemsToDelete.length} 件をGoogleドライブのゴミ箱へ移動しました`);
      } catch (err) {
        if (err instanceof Error && err.message === "AUTH_EXPIRED") {
          handleAuthExpired();
        } else {
          showQueueToast(err instanceof Error ? err.message : "削除に失敗しました");
        }
      } finally {
        setDeletingItems(false);
      }
    },
    [
      accessToken,
      folderId,
      masterKey,
      deletingItems,
      activeVideo,
      handleClosePlayer,
      updateUserData,
      showQueueToast,
      handleAuthExpired,
    ]
  );

  const handleToggleVideoGenre = useCallback(
    (videoId: string, genre: string) => {
      const video = videos.find((v) => v.id === videoId);
      if (!video) return;

      updateUserData((prev) => {
        const now = Date.now();
        const cur = prev.videoMeta[videoId] ?? {};
        const effective = getEffectiveGenres(video, cur, prev.useAutoGenres, prev.customGenres);
        const currentlyHas = effective.includes(genre);

        const added = new Set(cur.addedGenres ?? []);
        const removed = new Set(cur.removedGenres ?? []);

        if (currentlyHas) {
          added.delete(genre);
          removed.add(genre);
        } else {
          removed.delete(genre);
          added.add(genre);
          // Keep 現実 and アニメ mutually exclusive when switching categories
          if (genre === "現実") {
            added.delete("アニメ");
            removed.add("アニメ");
          } else if (genre === "アニメ") {
            added.delete("現実");
            removed.add("現実");
          }
        }

        const hasInCustom = prev.customGenres.some((g) => g.name === genre);
        const shouldAddCustom = !currentlyHas && !hasInCustom && !CATEGORY_TAG_SET.has(genre);
        const nextCustomGenres = shouldAddCustom
          ? [{ name: genre, color: "rose" }, ...prev.customGenres]
          : prev.customGenres;

        return {
          ...prev,
          customGenresUpdatedAt: shouldAddCustom ? now : prev.customGenresUpdatedAt,
          customGenres: nextCustomGenres,
          videoMeta: {
            ...prev.videoMeta,
            [videoId]: {
              ...cur,
              addedGenres: Array.from(added),
              removedGenres: Array.from(removed),
              updatedAt: now,
            },
          },
        };
      });
    },
    [videos, updateUserData]
  );

  const handleAddCustomGenreToVideo = useCallback(
    (videoId: string, genre: string, color: string) => {
      const cleaned = genre.trim().replace(/^#/, "");
      if (!cleaned) return;
      updateUserData((prev) => {
        const now = Date.now();
        const exists = prev.customGenres.some((g) => g.name === cleaned);
        const nextCustom = exists
          ? prev.customGenres
          : [{ name: cleaned, color }, ...prev.customGenres];
        const cur = prev.videoMeta[videoId] ?? {};
        const added = new Set(cur.addedGenres ?? []);
        const removed = new Set(cur.removedGenres ?? []);
        added.add(cleaned);
        removed.delete(cleaned);
        return {
          ...prev,
          customGenresUpdatedAt: exists ? prev.customGenresUpdatedAt : now,
          customGenres: nextCustom,
          videoMeta: {
            ...prev.videoMeta,
            [videoId]: {
              ...cur,
              addedGenres: Array.from(added),
              removedGenres: Array.from(removed),
              updatedAt: now,
            },
          },
        };
      });
    },
    [updateUserData]
  );

  const handleBulkAssignGenre = useCallback(
    (genreName: string, mode: "add" | "remove", color = "rose") => {
      const cleaned = genreName.trim().replace(/^#/, "");
      if (!cleaned || selectedVideoIds.size === 0) return;

      updateUserData((prev) => {
        const now = Date.now();
        const exists = prev.customGenres.some((g) => g.name === cleaned);
        const addedCustom = mode === "add" && !exists;
        const nextCustom = addedCustom
          ? [{ name: cleaned, color }, ...prev.customGenres]
          : prev.customGenres;

        const nextMeta: Record<string, VideoUserMeta> = { ...prev.videoMeta };
        for (const vid of selectedVideoIds) {
          const cur = nextMeta[vid] ?? {};
          const added = new Set(cur.addedGenres ?? []);
          const removed = new Set(cur.removedGenres ?? []);
          if (mode === "add") {
            added.add(cleaned);
            removed.delete(cleaned);
          } else {
            added.delete(cleaned);
            removed.add(cleaned);
          }
          nextMeta[vid] = {
            ...cur,
            addedGenres: Array.from(added),
            removedGenres: Array.from(removed),
            updatedAt: now,
          };
        }
        return {
          ...prev,
          customGenresUpdatedAt: addedCustom ? now : prev.customGenresUpdatedAt,
          customGenres: nextCustom,
          videoMeta: nextMeta,
        };
      });
    },
    [selectedVideoIds, updateUserData]
  );

  const handleToggleSelectVideo = useCallback((videoId: string) => {
    setSelectedVideoIds((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  }, []);

  // Genre counts scoped to current category tab — unified strictly to user's 作成済みマイジャンル!
  const genreCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cg of customGenres) {
      if (cg.name && !CATEGORY_TAG_SET.has(cg.name)) {
        counts.set(cg.name, 0);
      }
    }
    const scopedVideos = videos.filter((v) => {
      if (categoryTab === "all") return true;
      if (categoryTab === "漫画") {
        return v.kind === "manga" || (videoGenresMap[v.id] ?? []).includes("漫画");
      }
      return v.kind !== "manga" && (videoGenresMap[v.id] ?? []).includes(categoryTab);
    });
    for (const v of scopedVideos) {
      for (const g of getContentGenresOnly(videoGenresMap[v.id] ?? [])) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([genre, count]) => count > 0 || selectedGenres.includes(genre))
      .sort((a, b) => b[1] - a[1]);
  }, [videos, videoGenresMap, customGenres, categoryTab, selectedGenres]);

  const homeGroupCounts = useMemo(() => {
    const map = new Map<GenreGroupId, number>();
    for (const tab of GENRE_GROUP_TABS) map.set(tab.id, 0);
    for (const [genre] of genreCounts) {
      if (CATEGORY_TAG_SET.has(genre)) continue;
      for (const tab of GENRE_GROUP_TABS) {
        if (matchesGenreGroup(genre, tab.id)) {
          map.set(tab.id, (map.get(tab.id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [genreCounts]);

  const homeScopedGenres = useMemo(() => {
    return genreCounts.filter(
      ([genre]) =>
        !CATEGORY_TAG_SET.has(genre) && matchesGenreGroup(genre, homeGenreGroup)
    );
  }, [genreCounts, homeGenreGroup]);

  const visibleHomeGenreChips = useMemo(() => {
    if (homeGenreExpanded || homeScopedGenres.length <= 16) {
      return homeScopedGenres;
    }
    const top16 = homeScopedGenres.slice(0, 16);
    const topSet = new Set(top16.map(([g]) => g));
    const extras = homeScopedGenres.filter(
      ([g]) => !topSet.has(g) && selectedGenres.includes(g)
    );
    return [...top16, ...extras];
  }, [homeGenreExpanded, homeScopedGenres, selectedGenres]);

  const isGroupBrowseMode =
    navSection === "home" &&
    !selectionMode &&
    !searchQuery.trim() &&
    selectedGenres.length === 0 &&
    !onlyUncategorized &&
    homeGenreGroup !== "main" &&
    homeGenreGroup !== "all";

  const sidebarGenreList = useMemo(() => {
    const q = sidebarGenreSearch.trim().toLowerCase();
    return genreCounts.filter(([genre]) => {
      if (CATEGORY_TAG_SET.has(genre)) return false;
      if (q) return genre.toLowerCase().includes(q);
      return sidebarGenreMode === "credits"
        ? isCreatorOrStudioGenre(genre)
        : !isCreatorOrStudioGenre(genre);
    });
  }, [genreCounts, sidebarGenreMode, sidebarGenreSearch]);

  const uncategorizedCount = useMemo(
    () =>
      videos.filter((v) => getContentGenresOnly(videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY).length === 0)
        .length,
    [videos, videoGenresMap]
  );

  // Total counts across ALL categories (O(V) memoized for instant ジャンル tab switching)
  const allGenreCountsMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of videos) {
      for (const g of videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY) {
        counts.set(g, (counts.get(g) ?? 0) + 1);
      }
    }
    return counts;
  }, [videos, videoGenresMap]);

  const manageGroupCounts = useMemo(() => {
    const map = new Map<GenreGroupId, number>();
    for (const tab of GENRE_GROUP_TABS) map.set(tab.id, 0);
    for (const cg of customGenres) {
      if (hideZeroGenres && (allGenreCountsMap.get(cg.name) ?? 0) === 0) continue;
      for (const tab of GENRE_GROUP_TABS) {
        if (matchesGenreGroup(cg.name, tab.id)) {
          map.set(tab.id, (map.get(tab.id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [customGenres, hideZeroGenres, allGenreCountsMap]);

  const filteredManageGenres = useMemo(() => {
    const q = manageGenreSearch.trim().toLowerCase();
    return customGenres.filter((cg) => {
      if (hideZeroGenres && (allGenreCountsMap.get(cg.name) ?? 0) === 0) {
        return false;
      }
      if (q) {
        return cg.name.toLowerCase().includes(q);
      }
      return matchesGenreGroup(cg.name, manageGenreGroup);
    });
  }, [customGenres, hideZeroGenres, allGenreCountsMap, manageGenreSearch, manageGenreGroup]);

  const filteredBulkGenres = useMemo(() => {
    const q = bulkGenreSearch.trim().toLowerCase();
    return customGenres.filter((cg) => {
      if (CATEGORY_TAG_SET.has(cg.name)) return false;
      if (q) {
        return cg.name.toLowerCase().includes(q);
      }
      return matchesGenreGroup(cg.name, bulkGenreGroup);
    });
  }, [customGenres, bulkGenreSearch, bulkGenreGroup]);

  const toggleGenreSelection = useCallback((genre: string) => {
    setOnlyUncategorized(false);
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  }, []);

  const handleClickGenreFromCard = useCallback((genre: string) => {
    setOnlyUncategorized(false);
    setSelectedGenres([genre]);
    setNavSection((prev) => (prev === "genres" ? "home" : prev));
  }, []);

  const resetAllFilters = () => {
    setCategoryTab("all");
    setSearchQuery("");
    setSelectedGenres([]);
    setOnlyUncategorized(false);
    setSortMode("recommended");
    reshuffleHome();
  };

  const realVideoCount = useMemo(
    () => videos.filter((v) => (videoGenresMap[v.id] ?? []).includes("現実")).length,
    [videos, videoGenresMap]
  );

  const animeVideoCount = useMemo(
    () =>
      videos.filter(
        (v) => v.kind !== "manga" && (videoGenresMap[v.id] ?? []).includes("アニメ")
      ).length,
    [videos, videoGenresMap]
  );

  const mangaCount = useMemo(
    () =>
      videos.filter(
        (v) => v.kind === "manga" || (videoGenresMap[v.id] ?? []).includes("漫画")
      ).length,
    [videos, videoGenresMap]
  );

  const activeFilterCount =
    (categoryTab !== "all" ? 1 : 0) +
    selectedGenres.length +
    (onlyUncategorized ? 1 : 0);

  // Automatic local Manga <-> Anime title pairing (zero external API calls)
  const crossMedia = useMemo(() => buildCrossMediaIndex(videos), [videos]);

  // Continue watching rail (YouTube style)
  const continueWatchingVideos = useMemo(() => {
    return videos
      .filter((v) => {
        const p = progressMap[v.id];
        if (!p || p.currentTime <= 5) return false;
        if (p.duration > 0 && p.currentTime >= p.duration - 10) return false;
        return true;
      })
      .sort(
        (a, b) =>
          (progressMap[b.id]?.updatedAt ?? 0) - (progressMap[a.id]?.updatedAt ?? 0)
      )
      .slice(0, 10);
  }, [videos, progressMap]);

  // YouTube-style personalized recommendation ranker (uses recProgressSnapshot so playback doesn't thrash Home)
  const recommendationData = useMemo(() => {
    const rankById = new Map<string, number>();
    const reasonById = new Map<string, string>();
    if (videos.length === 0) {
      return { rankById, reasonById, ranked: [] as VaultVideoItem[] };
    }

    const nowMs = Date.now();
    const totalCount = videos.length;
    const genreDocFreq = new Map<string, number>();
    const tagsById = new Map<string, string[]>();
    const seriesKeyById = new Map<string, string>();

    for (const v of videos) {
      const tags = videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY;
      tagsById.set(v.id, tags);
      for (const g of tags) {
        if (!CATEGORY_TAG_SET.has(g)) {
          genreDocFreq.set(g, (genreDocFreq.get(g) ?? 0) + 1);
        }
      }
      seriesKeyById.set(v.id, normalizeCrossMediaTitle(v.title) || v.id);
    }

    // 1. Build taste affinity profile from favorites, watch completion, recency, repeat plays, custom thumbnails
    const rawGenreAffinity = new Map<string, number>();
    const seriesAffinity = new Map<string, number>();
    const linkedEngagedIds = new Set<string>();
    const catAffinity = { anime: 0, manga: 0, real: 0 };

    for (const v of videos) {
      const meta = userMetaMap[v.id];
      const prog = recProgressSnapshot[v.id];
      const tags = tagsById.get(v.id) ?? EMPTY_STRING_ARRAY;
      const isFav = Boolean(meta?.favorite);
      const isMasterpiece = tags.includes("神回・お気に入り");
      const hasCustomThumb = meta?.thumbnailTimeSec !== undefined;

      const ratio =
        prog && prog.duration > 0
          ? Math.min(1, Math.max(0, prog.currentTime / prog.duration))
          : prog && prog.currentTime > 10
            ? 0.45
            : 0;

      let signal = 0;
      if (isFav) signal += 5.5;
      if (isMasterpiece) signal += 3.5;
      if (hasCustomThumb) signal += 1.2;

      if (prog && (prog.currentTime > 3 || (prog.playCount ?? 0) > 0)) {
        const ageDays = prog.updatedAt
          ? Math.max(0, (nowMs - prog.updatedAt) / 86400000)
          : 30;
        const decay = Math.max(0.25, Math.exp(-ageDays / 21));
        if (ratio >= 0.75) signal += 4.2 * decay;
        else if (ratio >= 0.25) signal += 2.4 * decay;
        else signal += 0.8 * decay;

        const plays = prog.playCount ?? 1;
        if (plays > 1) {
          signal += Math.min(4.0, (plays - 1) * 1.4) * decay;
        }
      }

      if (signal <= 0) continue;

      linkedEngagedIds.add(v.id);
      const sk = seriesKeyById.get(v.id) ?? v.id;
      const prevSeries = seriesAffinity.get(sk) ?? 0;
      if (signal > prevSeries) seriesAffinity.set(sk, signal);

      if (v.kind === "manga" || tags.includes("漫画")) {
        catAffinity.manga += signal;
      } else if (tags.includes("現実")) {
        catAffinity.real += signal;
      } else {
        catAffinity.anime += signal;
      }

      for (const g of tags) {
        if (CATEGORY_TAG_SET.has(g) || g === "神回・お気に入り") continue;
        const creatorMult = isCreatorOrStudioGenre(g) ? 1.4 : 1.0;
        rawGenreAffinity.set(g, (rawGenreAffinity.get(g) ?? 0) + signal * creatorMult);
      }
    }

    // Apply TF-IDF weighting so niche tags, authors, and studios stand out over ultra-common tags
    const idfGenreScore = new Map<string, number>();
    for (const [g, raw] of rawGenreAffinity.entries()) {
      const df = genreDocFreq.get(g) ?? 1;
      const idf = Math.log(1 + totalCount / Math.max(1, df));
      idfGenreScore.set(g, raw * idf);
    }

    let maxRawMatch = 0;
    for (const v of videos) {
      const tags = tagsById.get(v.id) ?? EMPTY_STRING_ARRAY;
      const contributions: number[] = [];
      for (const g of tags) {
        const w = idfGenreScore.get(g);
        if (w) contributions.push(w);
      }
      contributions.sort((a, b) => b - a);
      const topSum = contributions.slice(0, 4).reduce((s, x) => s + x, 0);
      if (topSum > maxRawMatch) maxRawMatch = topSum;
    }

    const maxCatAff = Math.max(catAffinity.anime, catAffinity.manga, catAffinity.real);

    // 2. Score every library item
    const rawScored: Array<{
      item: VaultVideoItem;
      score: number;
      reason: string;
      seriesKey: string;
    }> = [];

    for (const v of videos) {
      const meta = userMetaMap[v.id];
      const prog = recProgressSnapshot[v.id];
      const tags = tagsById.get(v.id) ?? EMPTY_STRING_ARRAY;
      const sk = seriesKeyById.get(v.id) ?? v.id;
      const isFav = Boolean(meta?.favorite);
      const isMasterpiece = tags.includes("神回・お気に入り");
      const hasCustomThumb = meta?.thumbnailTimeSec !== undefined;

      const ratio =
        prog && prog.duration > 0
          ? Math.min(1, Math.max(0, prog.currentTime / prog.duration))
          : prog && prog.currentTime > 10
            ? 0.45
            : 0;
      const isUnwatched = !prog || prog.currentTime <= 3;
      const isFinished =
        ratio >= 0.85 ||
        (prog ? prog.duration > 0 && prog.currentTime >= prog.duration - 10 : false);
      const isInProgress = !isUnwatched && !isFinished;
      const hoursSinceWatch = prog?.updatedAt ? (nowMs - prog.updatedAt) / 3600000 : Infinity;

      let bestCreatorTag: { tag: string; w: number } | null = null;
      let bestNormalTag: { tag: string; w: number } | null = null;
      const contribVals: number[] = [];
      for (const g of tags) {
        const w = idfGenreScore.get(g) ?? 0;
        if (w <= 0) continue;
        contribVals.push(w);
        if (isCreatorOrStudioGenre(g)) {
          if (!bestCreatorTag || w > bestCreatorTag.w) bestCreatorTag = { tag: g, w };
        } else {
          if (!bestNormalTag || w > bestNormalTag.w) bestNormalTag = { tag: g, w };
        }
      }
      contribVals.sort((a, b) => b - a);
      const matchSum = contribVals.slice(0, 4).reduce((s, x) => s + x, 0);
      const tastePts = maxRawMatch > 0 ? (matchSum / maxRawMatch) * 48 : 0;

      const seriesBest = seriesAffinity.get(sk) ?? 0;
      const linkedList = crossMedia.linkedById[v.id];
      const hasLinkedEngaged = linkedList
        ? linkedList.some((li) => linkedEngagedIds.has(li.id))
        : false;
      let seriesPts = 0;
      if (!isFinished && seriesBest >= 2.2) seriesPts = 18;
      else if (!isFinished && hasLinkedEngaged) seriesPts = 14;

      let catPts = 0;
      if (maxCatAff > 0) {
        const cVal =
          v.kind === "manga" || tags.includes("漫画")
            ? catAffinity.manga
            : tags.includes("現実")
              ? catAffinity.real
              : catAffinity.anime;
        catPts = (cVal / maxCatAff) * 5;
      }

      let watchStatePts = 0;
      if (isUnwatched) {
        watchStatePts = 14;
      } else if (isInProgress) {
        watchStatePts = 8;
      } else if (isFinished) {
        if (hoursSinceWatch < 24 && !isFav) watchStatePts = -28;
        else if (hoursSinceWatch < 336 && !isFav) watchStatePts = -14;
        else if (isFav || isMasterpiece) watchStatePts = hoursSinceWatch < 12 ? -8 : 11;
        else watchStatePts = -6;
      }

      let qualityPts = 0;
      if (isFav && hoursSinceWatch >= 12) qualityPts += 8;
      if (isMasterpiece && hoursSinceWatch >= 12) qualityPts += 7;
      if (hasCustomThumb) qualityPts += 2.5;
      if (getContentGenresOnly(tags).length >= 2) qualityPts += 3;

      const createdMs = new Date(v.createdAt).getTime();
      const ageCreatedDays = Number.isFinite(createdMs)
        ? Math.max(0, (nowMs - createdMs) / 86400000)
        : 999;
      const freshnessPts =
        ageCreatedDays <= 7
          ? 10 * (1 - ageCreatedDays / 7)
          : ageCreatedDays <= 30
            ? 4 * (1 - (ageCreatedDays - 7) / 23)
            : 0;

      const jitterPts = ((seededOrderHash(v.id, homeShuffleSeed) % 1000) / 1000) * 11;

      const totalScore =
        tastePts + seriesPts + catPts + watchStatePts + qualityPts + freshnessPts + jitterPts;

      let reason = "おすすめピックアップ";
      if (seriesPts >= 18) {
        reason = "シリーズ続編・関連";
      } else if (seriesPts >= 14) {
        reason = v.kind === "manga" ? "視聴アニメの原作" : "漫画のアニメ版";
      } else if (bestCreatorTag && tastePts >= 12) {
        const shortCreator = bestCreatorTag.tag.replace(/^(制作|作者|ブランド|サークル):/, "");
        reason = `注目: ${shortCreator}`;
      } else if (bestNormalTag && tastePts >= 10) {
        reason = `好み: #${bestNormalTag.tag}`;
      } else if ((isFav || isMasterpiece) && hoursSinceWatch >= 12) {
        reason = isMasterpiece ? "神回・お気に入り" : "お気に入り再注目";
      } else if (ageCreatedDays <= 7) {
        reason = "新着おすすめ";
      } else if (isUnwatched) {
        reason = "未視聴の発掘";
      }

      rawScored.push({ item: v, score: totalScore, reason, seriesKey: sk });
    }

    rawScored.sort((a, b) => b.score - a.score);

    // 3. Apply greedy series-diversity spacing to top 120 so multiple episodes of one series never clump
    const topPoolSize = Math.min(120, rawScored.length);
    const pool = rawScored.slice(0, topPoolSize);
    const remaining = rawScored.slice(topPoolSize);
    const used = new Array<boolean>(topPoolSize).fill(false);
    const placedSeriesCounts = new Map<string, number>();
    const ranked: VaultVideoItem[] = [];

    for (let step = 0; step < topPoolSize; step += 1) {
      let bestIdx = -1;
      let bestAdjusted = -Infinity;
      for (let i = 0; i < topPoolSize; i += 1) {
        if (used[i]) continue;
        const cand = pool[i];
        const priorCount = placedSeriesCounts.get(cand.seriesKey) ?? 0;
        const adj = cand.score - priorCount * 16;
        if (adj > bestAdjusted) {
          bestAdjusted = adj;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      used[bestIdx] = true;
      const picked = pool[bestIdx];
      placedSeriesCounts.set(picked.seriesKey, (placedSeriesCounts.get(picked.seriesKey) ?? 0) + 1);
      rankById.set(picked.item.id, ranked.length);
      reasonById.set(picked.item.id, picked.reason);
      ranked.push(picked.item);
    }

    for (const tail of remaining) {
      rankById.set(tail.item.id, ranked.length);
      reasonById.set(tail.item.id, tail.reason);
      ranked.push(tail.item);
    }

    return { rankById, reasonById, ranked };
  }, [
    videos,
    videoGenresMap,
    userMetaMap,
    recProgressSnapshot,
    crossMedia,
    homeShuffleSeed,
  ]);

  const recommendedShelfItems = useMemo(() => {
    if (recommendationData.ranked.length === 0) return [];
    const cwIds = new Set(continueWatchingVideos.map((v) => v.id));
    const matchesCategory = (v: VaultVideoItem) => {
      if (categoryTab === "all") return true;
      const tags = videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY;
      if (categoryTab === "漫画") return v.kind === "manga" || tags.includes("漫画");
      return v.kind !== "manga" && tags.includes(categoryTab);
    };
    const scoped = recommendationData.ranked.filter(matchesCategory);
    const withoutCw = scoped.filter((v) => !cwIds.has(v.id));
    return (withoutCw.length >= 6 ? withoutCw : scoped).slice(0, 12);
  }, [recommendationData.ranked, continueWatchingVideos, categoryTab, videoGenresMap]);

  // Only recompute filteredVideos on progress updates when the current view/sort depends on progress
  const progressForFilter =
    navSection === "history" || sortMode === "recent_played"
      ? progressMap
      : null;

  // Main filtered + sorted video list
  const filteredVideos = useMemo(() => {
    let list = [...videos];

    if (navSection === "favorites") {
      list = list.filter((v) => Boolean(userMetaMap[v.id]?.favorite));
    } else if (navSection === "history") {
      list = list.filter((v) => Boolean(progressForFilter?.[v.id]?.updatedAt));
    }

    if (categoryTab === "漫画") {
      list = list.filter(
        (v) => v.kind === "manga" || (videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY).includes("漫画")
      );
    } else if (categoryTab !== "all") {
      list = list.filter(
        (v) => v.kind !== "manga" && (videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY).includes(categoryTab)
      );
    }

    const rawTokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (rawTokens.length > 0) {
      list = list.filter((v) => {
        const haystack = [
          v.title,
          v.sourceFileName ?? "",
          ...(videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY),
        ]
          .join(" ")
          .toLowerCase();

        return rawTokens.every((token) => {
          if (token.startsWith("-") && token.length > 1) {
            return !haystack.includes(token.slice(1));
          }
          return haystack.includes(token);
        });
      });
    }

    if (onlyUncategorized) {
      list = list.filter(
        (v) => getContentGenresOnly(videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY).length === 0
      );
    } else if (selectedGenres.length > 0) {
      list = list.filter((v) => {
        const gList = videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY;
        if (genreMatchMode === "AND") {
          return selectedGenres.every((sel) => gList.includes(sel));
        }
        return selectedGenres.some((sel) => gList.includes(sel));
      });
    }

    const effectiveSort: SortMode =
      navSection === "history" &&
      (sortMode === "recommended" || sortMode === "newest" || sortMode === "random")
        ? "recent_played"
        : sortMode;

    list.sort((a, b) => {
      switch (effectiveSort) {
        case "recommended":
          return (
            (recommendationData.rankById.get(a.id) ?? 999999) -
            (recommendationData.rankById.get(b.id) ?? 999999)
          );
        case "random":
          return seededOrderHash(a.id, homeShuffleSeed) - seededOrderHash(b.id, homeShuffleSeed);
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "title_asc":
          return a.title.localeCompare(b.title, "ja");
        case "title_desc":
          return b.title.localeCompare(a.title, "ja");
        case "duration_desc":
          return (b.duration ?? 0) - (a.duration ?? 0);
        case "duration_asc":
          return (a.duration ?? 0) - (b.duration ?? 0);
        case "size_desc":
          return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
        case "recent_played":
          return (
            (progressForFilter?.[b.id]?.updatedAt ?? 0) -
            (progressForFilter?.[a.id]?.updatedAt ?? 0)
          );
        case "newest":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return list;
  }, [
    videos,
    navSection,
    categoryTab,
    userMetaMap,
    progressForFilter,
    searchQuery,
    videoGenresMap,
    onlyUncategorized,
    selectedGenres,
    genreMatchMode,
    sortMode,
    homeShuffleSeed,
    recommendationData.rankById,
  ]);

  const totalLibraryBytes = useMemo(
    () => videos.reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0),
    [videos]
  );

  // Gentle background low-priority thumbnail pre-warmer (capped to 40 next items / 2 streams to keep iPad 60fps!)
  useEffect(() => {
    if (!accessToken || filteredVideos.length === 0) return;
    if (activeVideo || activeManga) return;

    const needsWarm = filteredVideos
      .slice(0, Math.min(filteredVideos.length, Math.max(40, visibleHomeCount + 12)))
      .filter(
        (v) =>
          v.thumbnailFileId &&
          (!v.encrypted || masterKey) &&
          !getSyncCachedThumbnailUrl(
            v.thumbnailFileId,
            Boolean(v.encrypted),
            v.thumbnailModifiedTime
          )
      )
      .slice(0, 40);
    if (needsWarm.length === 0) return;

    let cancelled = false;
    let cursor = 0;

    const worker = async () => {
      while (!cancelled) {
        const idx = cursor;
        cursor += 1;
        if (idx >= needsWarm.length) break;
        const v = needsWarm[idx];
        if (!v.thumbnailFileId) continue;
        try {
          await driveFetchCachedThumbnailUrl(
            v.thumbnailFileId,
            accessToken,
            Boolean(v.encrypted),
            masterKey,
            v.thumbnailModifiedTime,
            "low"
          );
        } catch {
          // Ignore individual background warm-up errors
        }
      }
    };

    const timer = setTimeout(() => {
      if (!cancelled) {
        Promise.all(Array.from({ length: 2 }, () => worker())).catch(() => undefined);
      }
    }, 1100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, masterKey, filteredVideos, visibleHomeCount, activeVideo, activeManga]);

  // Reset progressive render count whenever filters/tabs/search change
  useEffect(() => {
    setVisibleHomeCount(36);
  }, [
    navSection,
    categoryTab,
    searchQuery,
    selectedGenres,
    onlyUncategorized,
    sortMode,
    homeShuffleSeed,
  ]);

  // Seamless infinite-scroll sentinel for Home Grid & List (avoids mounting 300+ cards at once!)
  useEffect(() => {
    const sentinel = homeLoadMoreRef.current;
    if (!sentinel || visibleHomeCount >= filteredVideos.length) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleHomeCount((prev) => Math.min(filteredVideos.length, prev + 36));
        }
      },
      { rootMargin: "900px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleHomeCount, filteredVideos.length, navSection, viewMode]);

  const displayedVideos = useMemo(
    () => filteredVideos.slice(0, visibleHomeCount),
    [filteredVideos, visibleHomeCount]
  );

  const groupedSectionList = useMemo(() => {
    if (!isGroupBrowseMode) return [];
    const scopedSet = new Set(homeScopedGenres.map(([g]) => g));
    const byGenre = new Map<string, VaultVideoItem[]>();
    for (const v of filteredVideos) {
      const gList = videoGenresMap[v.id] ?? EMPTY_STRING_ARRAY;
      for (const g of gList) {
        if (!scopedSet.has(g)) continue;
        let arr = byGenre.get(g);
        if (!arr) {
          arr = [];
          byGenre.set(g, arr);
        }
        arr.push(v);
      }
    }
    return homeScopedGenres
      .map(([genre]) => ({
        genre,
        items: byGenre.get(genre) ?? [],
      }))
      .filter((sec) => sec.items.length > 0);
  }, [isGroupBrowseMode, homeScopedGenres, filteredVideos, videoGenresMap]);

  // Automatic background "Zero-Wait Pre-Warmer": pre-buffers Continue Watching & visible top cards (~0.05s start!)
  useEffect(() => {
    if (!accessToken || (vaultConfig && !masterKey)) return;
    if (activeVideo || activeManga || cacheBuildState.running) return;
    if (continueWatchingVideos.length === 0 && displayedVideos.length === 0) return;

    const seen = new Set<string>();
    const targets: Array<{ item: VaultVideoItem; resumeSec: number }> = [];

    const pushTarget = (item: VaultVideoItem): boolean => {
      if (seen.has(item.id)) return false;
      if (item.kind !== "hls" && item.kind !== "manga") return false;
      if (item.encrypted && !masterKey) return false;
      seen.add(item.id);
      const p = progressMap[item.id];
      const resumeSec =
        p &&
        p.currentTime > 3 &&
        (p.duration <= 0 || p.currentTime < p.duration - 5)
          ? p.currentTime
          : 0;
      targets.push({ item, resumeSec });
      return true;
    };

    for (const v of continueWatchingVideos.slice(0, 4)) {
      pushTarget(v);
    }
    let addedVisible = 0;
    for (const v of displayedVideos) {
      if (addedVisible >= 6 || targets.length >= 10) break;
      if (pushTarget(v)) addedVisible += 1;
    }

    if (targets.length === 0) return;

    let cancelled = false;
    let cursor = 0;

    const worker = async () => {
      while (!cancelled && !isMainSegmentLoading()) {
        const idx = cursor;
        cursor += 1;
        if (idx >= targets.length) break;
        const { item, resumeSec } = targets[idx];
        prewarmVideoForInstantPlay(item, accessToken, masterKey, resumeSec, "low");
        await new Promise((r) => setTimeout(r, 120));
      }
    };

    const timer = setTimeout(() => {
      if (!cancelled && !isMainSegmentLoading()) {
        Promise.all(Array.from({ length: 2 }, () => worker())).catch(() => undefined);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    accessToken,
    vaultConfig,
    masterKey,
    activeVideo,
    activeManga,
    cacheBuildState.running,
    continueWatchingVideos,
    displayedVideos,
    progressMap,
  ]);

  const { seriesVideos, relatedVideos } = useMemo(() => {
    if (!activeVideo) return { seriesVideos: [], relatedVideos: [] };
    return findSeriesAndRelatedVideos(activeVideo, videos, videoGenresMap, 6);
  }, [activeVideo, videos, videoGenresMap]);

  const seriesManga = useMemo(() => {
    if (!activeManga) return [];
    return findSeriesManga(activeManga, videos);
  }, [activeManga, videos]);

  const relatedMangaWorks = useMemo(() => {
    if (!activeManga) return [];
    const exclude = new Set(seriesManga.map((m) => m.id));
    return findRelatedWorks(activeManga, videos, videoGenresMap, 10, exclude);
  }, [activeManga, videos, videoGenresMap, seriesManga]);

  const effectiveViewMode: ViewMode = navSection === "files" ? "list" : viewMode;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: "home", label: "ホーム", icon: Home, badge: videos.length || undefined },
    { id: "genres", label: "ジャンル", icon: Hash, badge: customGenres.length || undefined },
    {
      id: "favorites",
      label: "お気に入り",
      icon: Heart,
      badge: Object.values(userMetaMap).filter((m) => m.favorite).length || undefined,
    },
    { id: "history", label: "履歴", icon: History },
    { id: "files", label: "ファイル", icon: FolderOpen },
  ];

  const refreshDiskCacheStats = useCallback(async () => {
    const stats = await getDiskCacheStats();
    setDiskCacheStats(stats);
  }, []);

  useEffect(() => {
    if (cacheModalOpen) {
      refreshDiskCacheStats().catch(() => undefined);
    }
  }, [cacheModalOpen, refreshDiskCacheStats]);

  const handleStopDeviceCache = useCallback(() => {
    cacheBuildAbortRef.current = true;
    cacheBuildControllerRef.current?.abort();
  }, []);

  const handleClearDeviceCache = useCallback(async () => {
    cacheBuildAbortRef.current = true;
    cacheBuildControllerRef.current?.abort();
    clearThumbnailCache(true);
    clearMangaPageCache();
    clearSegmentCache();
    await clearAllThumbDbCache();
    await refreshDiskCacheStats();
    showQueueToast("この端末のキャッシュをすべて削除しました");
  }, [refreshDiskCacheStats, showQueueToast]);

  const handleChangeCacheLimitMb = useCallback(
    async (limitMb: number) => {
      setCacheLimitMb(limitMb);
      await setDiskCacheLimitMb(limitMb);
      await refreshDiskCacheStats();
      const gb = Math.round((limitMb / 1024) * 10) / 10;
      showQueueToast(`端末キャッシュ上限を ${gb} GB に変更しました`);
    },
    [refreshDiskCacheStats, showQueueToast]
  );

  const handleBuildDeviceCache = useCallback(
    async (mode: "fast_start" | "favorites_deep" | "full_library") => {
      if (!accessToken || (vaultConfig && !masterKey) || cacheBuildState.running) return;
      cacheBuildAbortRef.current = false;
      const controller = new AbortController();
      cacheBuildControllerRef.current = controller;
      await requestPersistentStorage().catch(() => undefined);

      // Prioritize Favorites & Continue Watching first so your most-watched items become 0ms instant immediately
      const favIds = new Set(
        Object.entries(userMetaMap)
          .filter(([, m]) => Boolean(m?.favorite))
          .map(([id]) => id)
      );
      const cwIds = new Set(continueWatchingVideos.map((v) => v.id));

      const orderedVideos = [...videos].sort((a, b) => {
        const score = (v: VaultVideoItem) =>
          (favIds.has(v.id) ? 4 : 0) + (cwIds.has(v.id) ? 2 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      const targets =
        mode === "favorites_deep"
          ? orderedVideos.filter((v) => favIds.has(v.id) || cwIds.has(v.id))
          : orderedVideos;

      if (targets.length === 0) {
        showQueueToast(
          mode === "favorites_deep"
            ? "お気に入り・続きを見るの動画がまだありません"
            : "キャッシュ対象の動画がありません"
        );
        return;
      }

      const label =
        mode === "fast_start"
          ? "高速スタートキャッシュ作成中（8並列・爆速モード）"
          : mode === "favorites_deep"
          ? "お気に入り＆続きを見る 深掘りキャッシュ作成中（8並列）"
          : "大容量まとめてキャッシュ作成中（8並列・上限まで保存）";

      setCacheBuildState({
        running: true,
        label: "既存キャッシュを確認中...",
        done: 0,
        total: 1,
        skipped: 0,
        downloadedBytes: 0,
        speedBps: 0,
      });

      // Upfront <5ms key snapshot: skips EVERY already-cached thumb, playlist, manga page & video segment in 0ms!
      const [initialStats, existingKeys] = await Promise.all([
        getDiskCacheStats().catch(() => null),
        getAllCachedKeys().catch(() => ({
          thumbs: new Set<string>(),
          playlists: new Set<string>(),
          segments: new Set<string>(),
        })),
      ]);

      const limitBytes = getDiskCacheLimitBytes();
      const softStopBytes = Math.floor(limitBytes * 0.96);
      let estimatedSegmentBytes = initialStats?.segmentBytes ?? 0;
      let hitCapacityLimit = false;
      let authExpiredHit = false;

      type CacheTask =
        | { kind: "thumb"; fileId: string; modifiedTime: string; url: string }
        | { kind: "playlist"; fileId: string; url: string }
        | { kind: "segment"; url: string };

      const layer1Meta: CacheTask[] = []; // Thumbnails + HLS playlists (tiny -> completes in seconds!)
      const layer2Media: CacheTask[] = []; // Sprites + Manga pages
      const layer3OpeningSegs: CacheTask[] = []; // Opening instant-start segments across ALL target videos
      const layer4DeepSegs: CacheTask[] = []; // Remaining deeper segments

      const queuedThumbs = new Set<string>();
      const queuedPlaylists = new Set<string>();
      const queuedSegments = new Set<string>();
      let skippedCount = 0;

      const enqueueThumb = (
        bucket: CacheTask[],
        fileId: string | undefined,
        modifiedTime = ""
      ) => {
        if (!fileId || queuedThumbs.has(fileId)) return;
        queuedThumbs.add(fileId);
        if (existingKeys.thumbs.has(fileId)) {
          skippedCount += 1;
          return;
        }
        bucket.push({
          kind: "thumb",
          fileId,
          modifiedTime,
          url: buildDriveMediaUrl(fileId),
        });
      };

      const enqueuePlaylist = (fileId: string | undefined) => {
        if (!fileId || queuedPlaylists.has(fileId)) return;
        queuedPlaylists.add(fileId);
        if (existingKeys.playlists.has(fileId)) {
          skippedCount += 1;
          return;
        }
        layer1Meta.push({
          kind: "playlist",
          fileId,
          url: buildDriveMediaUrl(fileId),
        });
      };

      const enqueueSegment = (bucket: CacheTask[], url: string) => {
        if (!url || queuedSegments.has(url)) return;
        queuedSegments.add(url);
        if (existingKeys.segments.has(url)) {
          skippedCount += 1;
          return;
        }
        bucket.push({ kind: "segment", url });
      };

      const lowSegCount = mode === "fast_start" ? 3 : mode === "favorites_deep" ? 6 : 12;
      const highSegCount = mode === "fast_start" ? 2 : mode === "favorites_deep" ? 24 : 80;
      const mangaPageLimit = mode === "fast_start" ? 20 : mode === "favorites_deep" ? 100 : 200;

      for (const item of targets) {
        enqueueThumb(layer1Meta, item.thumbnailFileId, item.thumbnailModifiedTime ?? "");

        if (item.kind === "manga") {
          const pages = item.manifest?.pages ?? [];
          for (const p of pages.slice(0, mangaPageLimit)) {
            enqueueThumb(layer2Media, p.fileId, "");
          }
        } else {
          enqueueThumb(layer2Media, item.spriteFileId, "");
          if (item.manifest) {
            enqueuePlaylist(item.manifest.playlistFileId);
            for (const vr of item.manifest.variants ?? []) {
              enqueuePlaylist(vr.playlistFileId);
            }
            const resumeSec =
              mode === "fast_start" ? 0 : (progressMap[item.id]?.currentTime ?? 0);
            const segUrls = getCacheSegmentUrls(
              item.manifest,
              item.duration,
              resumeSec,
              lowSegCount,
              highSegCount
            );
            // Layer 3 gets the first 2 instant-start segments of every video first,
            // then Layer 4 fills the deeper playback segments!
            segUrls.forEach((sUrl, sIdx) => {
              enqueueSegment(sIdx < 2 ? layer3OpeningSegs : layer4DeepSegs, sUrl);
            });
          }
        }
      }

      const tasks: CacheTask[] = [
        ...layer1Meta,
        ...layer2Media,
        ...layer3OpeningSegs,
        ...layer4DeepSegs,
      ];

      if (tasks.length === 0) {
        setCacheBuildState({
          running: false,
          label: "",
          done: 0,
          total: 0,
          skipped: skippedCount,
          downloadedBytes: 0,
          speedBps: 0,
        });
        showQueueToast(`すべてキャッシュ済みです！（${skippedCount} ファイル保存済）`);
        return;
      }

      const startedAt = performance.now();
      let completed = 0;
      let cursor = 0;
      let downloadedBytes = 0;
      let addedThumbs = 0;
      let addedPlaylists = 0;
      let addedSegments = 0;
      let addedSegmentBytes = 0;

      setCacheBuildState({
        running: true,
        label,
        done: 0,
        total: tasks.length,
        skipped: skippedCount,
        downloadedBytes: 0,
        speedBps: 0,
      });

      const flushUiProgress = () => {
        const elapsedSec = Math.max(0.25, (performance.now() - startedAt) / 1000);
        setCacheBuildState({
          running: true,
          label,
          done: completed,
          total: tasks.length,
          skipped: skippedCount,
          downloadedBytes,
          speedBps: Math.round(downloadedBytes / elapsedSec),
        });
        if (initialStats) {
          setDiskCacheStats({
            ...initialStats,
            thumbCount: initialStats.thumbCount + addedThumbs,
            playlistCount: initialStats.playlistCount + addedPlaylists,
            segmentCount: initialStats.segmentCount + addedSegments,
            segmentBytes: initialStats.segmentBytes + addedSegmentBytes,
            totalBytes: initialStats.totalBytes + downloadedBytes,
            limitBytes,
          });
        }
      };

      const uiTimer = setInterval(flushUiProgress, 250);

      const fetchRawWithRetry = async (url: string): Promise<ArrayBuffer | null> => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (cacheBuildAbortRef.current) return null;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          });
          if (res.status === 401) {
            authExpiredHit = true;
            cacheBuildAbortRef.current = true;
            controller.abort();
            return null;
          }
          if (res.status === 429 || res.status === 503) {
            await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
            continue;
          }
          if (!res.ok) return null;
          return res.arrayBuffer();
        }
        return null;
      };

      const worker = async () => {
        while (!cacheBuildAbortRef.current) {
          const idx = cursor;
          cursor += 1;
          if (idx >= tasks.length) break;
          const task = tasks[idx];

          if (task.kind === "segment" && estimatedSegmentBytes >= softStopBytes) {
            hitCapacityLimit = true;
            cacheBuildAbortRef.current = true;
            break;
          }

          try {
            // Raw encrypted bytes straight from Google Drive -> IndexedDB (ZERO CPU decryption, ZERO RAM bloat!)
            const buf = await fetchRawWithRetry(task.url);
            if (buf && buf.byteLength > 0) {
              if (task.kind === "thumb") {
                await putCachedThumbBytes(task.fileId, new Uint8Array(buf), task.modifiedTime);
                addedThumbs += 1;
              } else if (task.kind === "playlist") {
                await putCachedPlaylistBytes(task.fileId, new Uint8Array(buf));
                addedPlaylists += 1;
              } else {
                await putCachedSegmentBytes(task.url, buf, true);
                addedSegments += 1;
                addedSegmentBytes += buf.byteLength;
                estimatedSegmentBytes += buf.byteLength;
              }
              downloadedBytes += buf.byteLength;
            }
          } catch {
            // Abort or individual transient error
          }

          completed += 1;
        }
      };

      // 8 parallel HTTP/2 streams saturate Wi-Fi cleanly while keeping iPad memory flat!
      const CONCURRENCY = 8;
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
      clearInterval(uiTimer);
      cacheBuildControllerRef.current = null;

      await trimDiskCacheToLimit().catch(() => undefined);
      await refreshDiskCacheStats();

      const wasAborted = cacheBuildAbortRef.current;
      setCacheBuildState((prev) => ({
        ...prev,
        running: false,
        done: completed,
        downloadedBytes,
      }));

      if (authExpiredHit) {
        handleAuthExpired();
        return;
      }

      showQueueToast(
        hitCapacityLimit
          ? `設定上限（${Math.round((limitBytes / (1024 * 1024 * 1024)) * 10) / 10} GB）まで保存完了！（+${formatBytes(downloadedBytes)}）`
          : wasAborted
          ? `キャッシュ作成を停止しました（+${formatBytes(downloadedBytes)} / ${completed} 件保存済）`
          : `iPad 高速キャッシュ作成完了！（+${formatBytes(downloadedBytes)}・新規 ${completed} 件保存）`
      );
    },
    [
      accessToken,
      vaultConfig,
      masterKey,
      cacheBuildState.running,
      userMetaMap,
      continueWatchingVideos,
      progressMap,
      videos,
      refreshDiskCacheStats,
      showQueueToast,
      handleAuthExpired,
    ]
  );

  const handleSubmitNewGenre = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGenreName.trim()) return;
    handleCreateCustomGenre(newGenreName, "zinc");
    setNewGenreName("");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e] pb-24 text-zinc-100 md:pb-12">
      {/* Top YouTube + File-Explorer Search Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0b0b0e]/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-5">
          {/* Left: Menu & Brand */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {accessToken && (!vaultConfig || masterKey) && (
              <button
                type="button"
                onClick={() => setSidebarExpanded((prev) => !prev)}
                className="hidden h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-zinc-800 md:flex"
                aria-label="サイドバー切替"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setNavSection("home");
                setSelectedGenres([]);
                reshuffleHome();
                setOnlyUncategorized(false);
              }}
              className="flex items-center gap-2.5 text-left"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950">
                <Film className="h-4 w-4" />
              </div>
              <span className="hidden text-base font-bold tracking-tight text-white sm:inline">
                VaultStream
              </span>
            </button>
          </div>

          {/* Center: File-app style search bar */}
          {accessToken && (!vaultConfig || masterKey) ? (
            <div className="flex max-w-2xl flex-1 items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && isLikelyExternalUrlInput(searchQuery)) {
                      e.preventDefault();
                      openExternalUrlModal(searchQuery.trim());
                    }
                  }}
                  placeholder="タイトル・タグ検索、または動画URL (https://...) を貼ってEnter"
                  className="w-full rounded-full border border-zinc-800 bg-zinc-900/90 py-2 pl-10 pr-28 text-xs text-zinc-100 placeholder-zinc-500 transition focus:border-rose-500/70 focus:bg-zinc-900 focus:outline-none sm:text-sm"
                />
                {isLikelyExternalUrlInput(searchQuery) && (
                  <button
                    type="button"
                    onClick={() => openExternalUrlModal(searchQuery.trim())}
                    className="absolute right-9 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-950 hover:bg-white"
                    title="外部URLをプレーヤーで開く"
                  >
                    <Globe className="h-3 w-3" />
                    <span>URL再生</span>
                  </button>
                )}
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                    aria-label="検索をクリア"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Right: Sync indicator, Refresh, Lock, Settings, Auth */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {accessToken && (!vaultConfig || masterKey) && syncStatus !== "idle" && (
              <span
                className={`hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] xl:inline-flex ${
                  syncStatus === "saving"
                    ? "bg-zinc-900 text-zinc-400"
                    : syncStatus === "saved"
                      ? "bg-emerald-950/40 text-emerald-300"
                      : "bg-amber-950/40 text-amber-300"
                }`}
                title={
                  syncStatus === "error"
                    ? "Drive同期エラー（再ログインするとPC/iPad間でジャンル同期できます）"
                    : "ジャンル・お気に入りを暗号化してDriveに同期"
                }
              >
                {syncStatus === "error" ? (
                  <CloudOff className="h-3 w-3" />
                ) : (
                  <Cloud className="h-3 w-3" />
                )}
                {syncStatus === "saving"
                  ? "同期中..."
                  : syncStatus === "saved"
                    ? "Drive同期済"
                    : "ローカル保存"}
              </span>
            )}

            <button
              type="button"
              onClick={() => openExternalUrlModal()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
              title="外部動画サイトの URL を貼って再生・ダウンロード・Drive 保存"
            >
              <Globe className="h-3.5 w-3.5 text-zinc-400" />
              <span className="hidden sm:inline">URL再生・DL</span>
            </button>

            {accessToken && (!vaultConfig || masterKey) && (
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-zinc-100 px-3 text-xs font-semibold text-zinc-950 transition hover:bg-white"
                title="スマホ・ブラウザから動画を暗号化アップロード"
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">アップロード</span>
              </button>
            )}

            {accessToken && (!vaultConfig || masterKey) && (
              <button
                type="button"
                onClick={() => setCacheModalOpen(true)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
                  cacheBuildState.running
                    ? "border-zinc-500 bg-zinc-800 text-white"
                    : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                }`}
                title="iPad / 端末内に暗号化キャッシュを作成して爆速表示"
              >
                <HardDrive className={`h-3.5 w-3.5 ${cacheBuildState.running ? "animate-pulse text-zinc-200" : "text-zinc-400"}`} />
                <span className="hidden sm:inline">
                  {cacheBuildState.running
                    ? `キャッシュ ${Math.round((cacheBuildState.done / Math.max(1, cacheBuildState.total)) * 100)}%`
                    : "キャッシュ"}
                </span>
              </button>
            )}

            {accessToken && (
              <button
                type="button"
                onClick={() => {
                  // Keep persistent IndexedDB cache intact so thumbnails/videos stay instant!
                  loadLibrary(accessToken, folderId, masterKey, false);
                }}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                title="Google Drive から最新一覧を取得"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">更新</span>
              </button>
            )}

            {accessToken && vaultConfig && masterKey && (
              <button
                type="button"
                onClick={handleLockVault}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                title="Vault をロックする"
              >
                <Lock className="h-3.5 w-3.5 text-zinc-400" />
                <span className="hidden lg:inline">ロック</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenSettings}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              title="設定"
              aria-label="設定"
            >
              <Settings className="h-4 w-4" />
            </button>

            {accessToken ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition hover:border-rose-500/40 hover:bg-rose-950/30 hover:text-rose-200"
                title="ログアウト"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">ログアウト</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                disabled={authLoading}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{authLoading ? "接続中..." : "ログイン"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main layout */}
      {!accessToken ? (
        <main className="mx-auto max-w-2xl px-4 py-10">
          {!effectiveClientIdValid && (
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold">Web 用 OAuth クライアント ID が未設定です</p>
                  <p className="mt-1 text-xs text-amber-200/80">
                    下の「Google Cloud ＆ Drive 自動セットアップ」から設定できます（Drive フォルダはログイン時に自動作成・自動検出されます）。
                  </p>
                </div>
              </div>
            </div>
          )}

          {setupWizardNotice && (
            <div className="mb-6 rounded-2xl border border-emerald-500/35 bg-emerald-950/25 px-4 py-3 text-xs leading-relaxed text-emerald-200">
              {setupWizardNotice}
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <section className="rounded-3xl border border-zinc-800/80 bg-zinc-900/50 p-7 text-center shadow-2xl sm:p-8">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-fuchsia-500/20 text-rose-400 ring-1 ring-rose-500/30">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold text-white">VaultStream にログイン</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Google Drive と直接接続し、暗号化されたプライベート動画を自分のジャンル分けでストリーミング再生します。
            </p>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-left text-xs text-zinc-400">
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="shrink-0">Google Drive フォルダ</span>
                <code
                  className={`max-w-[65%] truncate ${
                    effectiveFolderIdValid ? "text-zinc-200" : "text-emerald-400"
                  }`}
                >
                  {effectiveFolderIdValid ? folderId : "ログイン時に自動作成・自動検出"}
                </code>
              </div>
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="shrink-0">OAuth クライアント</span>
                <span className={effectiveClientIdValid ? "text-emerald-400" : "text-amber-400"}>
                  {effectiveClientIdValid ? "設定済み" : "未設定（下で自動設定）"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignIn}
              disabled={authLoading}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {authLoading ? "Google に接続しています..." : "Google アカウントでログイン"}
            </button>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setAutoSetupOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:border-rose-500/40 hover:text-white"
              >
                <Wand2 className="h-3.5 w-3.5 text-rose-400" />
                <span>Google Cloud ＆ Drive 自動セットアップ（初回のみ）</span>
              </button>
              {effectiveClientIdValid && (
                <button
                  type="button"
                  onClick={() => void copyAutoConfigLink(clientId, folderId)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                  title="この設定を他端末へ 1 タップで引き継ぐリンクをコピー"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>他端末用設定リンクをコピー</span>
                </button>
              )}
            </div>

            {autoSetupOpen && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleOAuthJsonUpload(file);
                }}
                className="mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/85 p-5 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-white">
                      <Sparkles className="h-4 w-4 text-rose-400" />
                      サイト内 Google Cloud ＆ Drive 自動設定ウィザード
                    </h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                      Google Cloud のプロジェクト作成・Drive API 有効化・OAuth JSON 自動読込・Drive 専用フォルダ自動作成までこの画面だけで完結します。
                    </p>
                  </div>
                </div>

                {/* Cloud Shell 1-Command Auto Setup */}
                <div className="rounded-xl border border-sky-500/35 bg-sky-950/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-sky-200">
                      Cloud Shell 1コマンド自動セットアップ
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {currentOrigin && (
                        <button
                          type="button"
                          onClick={handleCopyCurrentOrigin}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-[10px] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                          title="承認済みの JavaScript 生成元用 URL をコピー"
                        >
                          <Copy className="h-3 w-3 text-rose-400" />
                          <span>生成元コピー: {currentOrigin}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleCopyCloudShellCommand}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-sky-500"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                        <span>コマンドをコピーして Cloud Shell を開く</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-300">
                    ボタンを押して開いたターミナルへ貼り付け→ <strong className="text-white">Enter</strong> を押すだけで、Gmail アカウント取得・GCP プロジェクト作成・Google Drive API 有効化・専用設定リンク発行まで一気に進みます。
                  </p>
                  <div className="mt-2.5 max-h-20 overflow-y-auto rounded-lg border border-zinc-800/90 bg-zinc-950/90 p-2 font-mono text-[10px] leading-relaxed text-zinc-400 select-all">
                    {cloudShellCommand}
                  </div>
                </div>

                {/* Auto-Import Zone: OAuth JSON Drop / Clipboard Auto-Read */}
                <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-950/10 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => oauthJsonInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rose-500"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>OAuth JSON を選択 / ここにドロップ</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleReadClipboardSetup}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white"
                    >
                      <Copy className="h-3.5 w-3.5 text-emerald-400" />
                      <span>クリップボードから自動読込</span>
                    </button>
                    {effectiveClientIdValid && (
                      <button
                        type="button"
                        onClick={handleAutoSetupDriveFolder}
                        disabled={autoSetupBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-600/35 disabled:opacity-50"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                        <span>{autoSetupBusy ? "作成中..." : "Drive フォルダを自動作成・検出"}</span>
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    ダウンロードした <code className="text-zinc-200">client_secret_*.json</code> をドロップするか、クライアント ID をコピーしてこの画面上で <strong className="text-zinc-200">Ctrl+V（Cmd+V）</strong> するだけで自動入力されます。Google Drive フォルダは空欄のままログインしても自動作成されます。
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-4 border-t border-zinc-800/80 pt-4 text-[11px] text-zinc-500">
              <Link href="/privacy" className="hover:text-zinc-300 hover:underline">
                プライバシーポリシー (Privacy Policy)
              </Link>
              <Link href="/terms" className="hover:text-zinc-300 hover:underline">
                利用規約 (Terms)
              </Link>
            </div>
          </section>
        </main>
      ) : vaultConfig && !masterKey ? (
        <main className="mx-auto max-w-md px-4 py-14">
          <form
            onSubmit={handleUnlockVault}
            className="rounded-3xl border border-zinc-800/80 bg-zinc-900/60 p-8 shadow-2xl"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
              <KeyRound className="h-8 w-8" />
            </div>
            <h2 className="text-center text-xl font-bold text-white">
              暗号化 Vault のロック解除
            </h2>
            <p className="mt-2 text-center text-xs leading-relaxed text-zinc-400">
              Google Drive 上のファイルはすべてエンドツーエンド暗号化（E2EE）されています。
              マスターパスワードを入力してブラウザ内で復号します。
            </p>

            {unlockError && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-200">
                {unlockError}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  マスターパスワード
                </label>
                <input
                  type="password"
                  value={passphraseInput}
                  onChange={(e) => setPassphraseInput(e.target.value)}
                  placeholder="パスワードを入力..."
                  autoFocus
                  required
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-xs text-zinc-400">
                <input
                  type="checkbox"
                  checked={rememberPassphrase}
                  onChange={(e) => setRememberPassphrase(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                />
                <span>この端末にパスワードを記憶する（次回から自動解除）</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={unlocking || !passphraseInput}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" />
              {unlocking ? "復号鍵を生成中..." : "ロックを解除"}
            </button>
          </form>
        </main>
      ) : (
        <div className="flex">
          {/* Desktop YouTube-style Left Sidebar */}
          <aside
            className={`sticky top-[57px] hidden h-[calc(100vh-57px)] shrink-0 flex-col border-r border-zinc-800/70 bg-[#0b0b0e] transition-all md:flex ${
              sidebarExpanded ? "w-56 px-3 py-4" : "w-[72px] items-center px-2 py-4"
            }`}
          >
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = navSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setNavSection(item.id);
                      if (item.id === "home") reshuffleHome();
                    }}
                    className={`flex w-full items-center rounded-xl transition ${
                      sidebarExpanded
                        ? "justify-between px-3 py-2.5 text-sm"
                        : "flex-col justify-center gap-1 px-1 py-2.5 text-[10px]"
                    } ${
                      active
                        ? "bg-zinc-800/90 font-semibold text-white"
                        : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                    }`}
                  >
                    <span className={`flex items-center ${sidebarExpanded ? "gap-3" : "flex-col gap-1"}`}>
                      <Icon className={`h-5 w-5 ${active ? "text-rose-400" : ""}`} />
                      <span>{item.label}</span>
                    </span>
                    {sidebarExpanded && item.badge !== undefined && (
                      <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openExternalUrlModal()}
                className={`flex w-full items-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100 ${
                  sidebarExpanded
                    ? "justify-between px-3 py-2.5 text-sm"
                    : "flex-col justify-center gap-1 px-1 py-2.5 text-[10px]"
                }`}
              >
                <span className={`flex items-center ${sidebarExpanded ? "gap-3" : "flex-col gap-1"}`}>
                  <Globe className="h-5 w-5" />
                  <span>URL再生・DL</span>
                </span>
              </button>
            </nav>

            {/* User's genres quick list in sidebar */}
            {sidebarExpanded && (
              <div className="mt-5 flex flex-1 flex-col overflow-hidden border-t border-zinc-800/70 pt-4">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    マイジャンル ({sidebarGenreList.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setNavSection("genres")}
                    className="text-[11px] text-zinc-400 hover:text-white hover:underline"
                  >
                    +管理
                  </button>
                </div>

                {/* Compact mode switcher & quick filter */}
                <div className="mb-2 space-y-1.5 px-1">
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-900/90 p-0.5 text-[10px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setSidebarGenreMode("main")}
                      className={`rounded-md py-1 transition ${
                        sidebarGenreMode === "main"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      主要
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarGenreMode("credits")}
                      className={`rounded-md py-1 transition ${
                        sidebarGenreMode === "credits"
                          ? "bg-zinc-800 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      制作・作者
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="text"
                      value={sidebarGenreSearch}
                      onChange={(e) => setSidebarGenreSearch(e.target.value)}
                      placeholder="タグ絞り込み..."
                      className="w-full rounded-lg border border-zinc-800/80 bg-zinc-950 py-1 pl-6 pr-6 text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-rose-500/60 focus:outline-none"
                    />
                    {sidebarGenreSearch && (
                      <button
                        type="button"
                        onClick={() => setSidebarGenreSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                        aria-label="サイドバータグ検索をクリア"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {sidebarGenreList.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-zinc-500">
                      該当するタグがありません
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {sidebarGenreList.map(([genre, count]) => {
                        const selected = selectedGenres.includes(genre);
                        return (
                          <button
                            key={genre}
                            type="button"
                            onClick={() => {
                              toggleGenreSelection(genre);
                              if (navSection === "genres") setNavSection("home");
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                              selected
                                ? "bg-zinc-800 font-semibold text-white"
                                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                            }`}
                          >
                            <span className="truncate">{genre}</span>
                            <span className="ml-2 shrink-0 text-[10px] text-zinc-500">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {sidebarExpanded && (
              <div className="mt-3 border-t border-zinc-800/70 px-2 pt-3 text-[11px] text-zinc-500">
                <div>{videos.length} 本の動画</div>
                {totalLibraryBytes > 0 && (
                  <div className="mt-0.5">合計 {formatBytes(totalLibraryBytes)}</div>
                )}
              </div>
            )}
          </aside>

          {/* Main scrollable feed */}
          <main className="min-w-0 flex-1 px-4 py-4 sm:px-6 sm:py-5">
            {error && (
              <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            )}

            {/* Top-level 現実 / アニメ / 漫画 Category Switcher */}
            {navSection !== "genres" && (
              <div className="mb-3.5 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-xl border border-zinc-800 bg-zinc-900/90 p-1">
                  {(
                    [
                      { id: "all", label: "すべて", count: videos.length, activeCls: "bg-zinc-100 text-zinc-950" },
                      { id: "現実", label: "現実", count: realVideoCount, activeCls: "bg-zinc-100 text-zinc-950" },
                      { id: "アニメ", label: "アニメ", count: animeVideoCount, activeCls: "bg-zinc-100 text-zinc-950" },
                      { id: "漫画", label: "漫画", count: mangaCount, activeCls: "bg-zinc-100 text-zinc-950" },
                    ] as const
                  ).map((tab) => {
                    const active = categoryTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                        setCategoryTab(tab.id);
                        if (sortMode === "random") reshuffleHome();
                      }}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                          active
                            ? tab.activeCls
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                            active ? "bg-black/20" : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Grouped & Expandable Home Genre Chip Bar */}
            {navSection !== "genres" && (
              <div className="mb-5 space-y-2">
                {/* Compact group switcher + expand/collapse toggle */}
                <div className="flex items-center justify-between gap-2">
                  <HorizontalShelf className="min-w-0 flex-1 items-center gap-1 pb-0.5">
                    {GENRE_GROUP_TABS.filter(
                      (tab) =>
                        tab.id !== "all" &&
                        (tab.id === "main" ||
                          tab.id === homeGenreGroup ||
                          (homeGroupCounts.get(tab.id) ?? 0) > 0)
                    ).map((tab) => {
                      const active = homeGenreGroup === tab.id;
                      const cnt = homeGroupCounts.get(tab.id) ?? 0;
                      return (
                        <button
                          key={`hg-${tab.id}`}
                          type="button"
                          onClick={() => setHomeGenreGroup(tab.id)}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                            active
                              ? "border-zinc-600 bg-zinc-800 text-white"
                              : "border-zinc-800/80 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                          }`}
                        >
                          <span>{tab.label}</span>
                          <span className="font-mono text-[10px] opacity-70">{cnt}</span>
                        </button>
                      );
                    })}
                  </HorizontalShelf>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {homeScopedGenres.length > 16 && (
                      <button
                        type="button"
                        onClick={() => setHomeGenreExpanded((prev) => !prev)}
                        className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                      >
                        {homeGenreExpanded
                          ? "折りたたむ"
                          : `すべて表示 (${homeScopedGenres.length})`}
                      </button>
                    )}

                    <div className="flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                      <button
                        type="button"
                        onClick={() => setGenreMatchMode("AND")}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                          genreMatchMode === "AND"
                            ? "bg-zinc-100 font-semibold text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="選択したすべてのタグを含む動画を表示"
                      >
                        タグAND
                      </button>
                      <button
                        type="button"
                        onClick={() => setGenreMatchMode("OR")}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                          genreMatchMode === "OR"
                            ? "bg-zinc-100 font-semibold text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                        title="選択したタグのいずれかを含む動画を表示"
                      >
                        タグOR
                      </button>
                    </div>
                  </div>
                </div>

                {/* Chips strip (top 16 in horizontal bar when collapsed, full multi-line wrap when expanded) */}
                <HorizontalShelf wrap={homeGenreExpanded} className="items-center gap-2 pb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGenres([]);
                      setOnlyUncategorized(false);
                    }}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      selectedGenres.length === 0 && !onlyUncategorized
                        ? "bg-white text-zinc-950"
                        : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                    }`}
                  >
                    すべて
                  </button>

                  {uncategorizedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setOnlyUncategorized((prev) => !prev);
                        setSelectedGenres([]);
                      }}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        onlyUncategorized
                          ? "border-zinc-200 bg-zinc-100 font-semibold text-zinc-950"
                          : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
                      }`}
                    >
                      <span>未分類</span>
                      <span className="text-[10px] opacity-75">{uncategorizedCount}</span>
                    </button>
                  )}

                  {visibleHomeGenreChips.map(([genre, count]) => {
                    const selected = selectedGenres.includes(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleGenreSelection(genre)}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                          selected
                            ? "border-zinc-200 bg-zinc-100 font-semibold text-zinc-950"
                            : getGenreStyle(genre, customGenres)
                        }`}
                      >
                        <span>{genre}</span>
                        <span
                          className={`text-[10px] ${
                            selected ? "text-zinc-600" : "text-zinc-500"
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}

                </HorizontalShelf>
              </div>
            )}

            {/* Dedicated Genres Management & Directory Page */}
            {navSection === "genres" ? (
              <section className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                      <Tag className="h-5 w-5 text-zinc-400" />
                      マイジャンル管理＆絞り込み
                    </h2>
                    <p className="mt-1 text-xs text-zinc-400">
                      好きなジャンルを自由に作成・編集できます。変更内容は暗号化されて Google Drive に自動同期されます（PC・iPad 共通）。
                    </p>
                  </div>

                  {/* Auto-genre toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      updateUserData((prev) => ({
                        ...prev,
                        useAutoGenres: !prev.useAutoGenres,
                      }))
                    }
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                      useAutoGenres
                        ? "border-zinc-600 bg-zinc-800 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                    }`}
                  >
                    <span>自動ジャンル分類: {useAutoGenres ? "ON" : "OFF（手動のみ）"}</span>
                  </button>
                </div>

                {/* Create new genre card */}
                <form
                  onSubmit={handleSubmitNewGenre}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5"
                >
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-300">
                    新しいジャンルを作成
                  </h3>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      value={newGenreName}
                      onChange={(e) => setNewGenreName(e.target.value)}
                      placeholder="ジャンル名を入力（例: お気に入り、アニメ、シリーズ...）"
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!newGenreName.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-100 px-5 py-2.5 text-xs font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                      ジャンルを作成
                    </button>
                  </div>
                </form>

                {/* User's custom genres list */}
                <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                      作成済みマイジャンル ({customGenres.length})
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRestoreGenresFromHistory}
                        disabled={restoringHistory}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                        title="Google Drive に保存されている過去リビジョンから消えたジャンル・お気に入りを統合復元します"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 text-zinc-400 ${restoringHistory ? "animate-spin" : ""}`} />
                        {restoringHistory ? "履歴を照合・復元中..." : "Drive 履歴からジャンルを復元"}
                      </button>
                      <button
                        type="button"
                        onClick={handleAutoEnrichAnimeGenres}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                        title="アニメ・漫画向けジャンルを追加し、シリーズ引継ぎ＋タイトル解析で自動振り分けします"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-zinc-400" />
                        アニメ・漫画ジャンル自動振り分け
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNavSection("home");
                          setSelectionMode(true);
                          setSelectedVideoIds(new Set());
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                      >
                        <CheckSquare className="h-3.5 w-3.5 text-zinc-400" />
                        ホームで動画を一括振り分けする
                      </button>
                    </div>
                  </div>

                  {customGenres.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-400">
                      上のフォームから好きなジャンルを作成してください。<br />
                      作成したあとは「ホーム」の **一括ジャンル分け** ボタンで、複数の動画をまとめて一瞬で振り分けられます！
                    </div>
                  ) : (
                    <>
                      {/* Filter bar for 98+ genres: group tabs + search + hide-zero toggle */}
                      <div className="mb-4 space-y-2.5 border-b border-zinc-800/70 pb-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <div className="relative flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                            <input
                              type="text"
                              value={manageGenreSearch}
                              onChange={(e) => setManageGenreSearch(e.target.value)}
                              placeholder="ジャンル・作者・制作会社を検索..."
                              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2 pl-9 pr-8 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
                            />
                            {manageGenreSearch && (
                              <button
                                type="button"
                                onClick={() => setManageGenreSearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                                aria-label="ジャンル検索をクリア"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setHideZeroGenres((prev) => !prev)}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
                              hideZeroGenres
                                ? "border-zinc-600 bg-zinc-800 text-white"
                                : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            }`}
                          >
                            <span>0本のジャンルを隠す</span>
                          </button>
                        </div>

                        {!manageGenreSearch.trim() ? (
                          <HorizontalShelf className="items-center gap-1.5 pb-1">
                            {GENRE_GROUP_TABS.map((tab) => {
                              const active = manageGenreGroup === tab.id;
                              const cnt = manageGroupCounts.get(tab.id) ?? 0;
                              return (
                                <button
                                  key={`mg-${tab.id}`}
                                  type="button"
                                  onClick={() => setManageGenreGroup(tab.id)}
                                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                                    active
                                      ? "border-zinc-600 bg-zinc-800 text-white"
                                      : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                                  }`}
                                >
                                  <span>{tab.label}</span>
                                  <span className="font-mono text-[10px] opacity-70">{cnt}</span>
                                </button>
                              );
                            })}
                          </HorizontalShelf>
                        ) : (
                          <p className="text-xs text-zinc-400">
                            「{manageGenreSearch.trim()}」に一致するジャンル（{filteredManageGenres.length} 件）
                          </p>
                        )}
                      </div>

                      {filteredManageGenres.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-400">
                          条件に一致するジャンルがありません。検索条件や「0本を隠す」設定を見直してください。
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {filteredManageGenres.map((cg) => {
                            const count = allGenreCountsMap.get(cg.name) ?? 0;
                            const isRenaming = renamingGenre === cg.name;
                            const selected = selectedGenres.includes(cg.name);

                            return (
                              <div
                                key={cg.name}
                                className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition ${
                                  selected
                                    ? "border-zinc-400 bg-zinc-800 text-white"
                                    : getGenreStyle(cg.name, customGenres)
                                }`}
                              >
                                {isRenaming ? (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      handleRenameCustomGenre(cg.name, renameDraft);
                                    }}
                                    className="flex flex-1 items-center gap-1.5"
                                  >
                                    <input
                                      type="text"
                                      value={renameDraft}
                                      onChange={(e) => setRenameDraft(e.target.value)}
                                      autoFocus
                                      className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-white focus:border-zinc-500 focus:outline-none"
                                    />
                                    <button
                                      type="submit"
                                      className="rounded-lg bg-zinc-100 p-1.5 text-zinc-950"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRenamingGenre(null)}
                                      className="rounded-lg bg-zinc-800 p-1.5 text-zinc-300"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  </form>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedGenres([cg.name]);
                                        setOnlyUncategorized(false);
                                        setNavSection("home");
                                      }}
                                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    >
                                      <span className="truncate text-sm font-semibold">
                                        {cg.name}
                                      </span>
                                      <span className="rounded-full bg-black/40 px-2 py-0.5 font-mono text-[11px]">
                                        {count}本
                                      </span>
                                    </button>

                                    <div className="flex shrink-0 items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRenamingGenre(cg.name);
                                          setRenameDraft(cg.name);
                                        }}
                                        className="rounded-lg bg-black/30 p-1.5 opacity-75 transition hover:bg-black/60 hover:opacity-100"
                                        title="名前を変更"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteCustomGenre(cg.name)}
                                        className="rounded-lg bg-black/30 p-1.5 opacity-75 transition hover:bg-rose-600/80 hover:text-white hover:opacity-100"
                                        title="ジャンルを削除"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </section>
            ) : isGroupBrowseMode ? (
              <div className="space-y-7">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-white">
                      {GENRE_GROUP_TABS.find((t) => t.id === homeGenreGroup)?.label ?? ""}
                    </h2>
                    <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
                      {groupedSectionList.length} ジャンル
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHomeGenreGroup("main")}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                  >
                    通常のホーム一覧へ戻る
                  </button>
                </div>

                {groupedSectionList.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-xs text-zinc-400">
                    このグループに表示できる動画がありません。
                  </div>
                ) : (
                  groupedSectionList.map(({ genre, items }) => (
                    <section key={`grp-sec-${genre}`} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleGenreSelection(genre)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition ${getGenreStyle(
                              genre,
                              customGenres
                            )}`}
                          >
                            <span>{genre}</span>
                            <span className="font-mono text-[11px] opacity-75">
                              {items.length}
                            </span>
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePlayAllFiltered(items)}
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                          >
                            <Play className="h-3 w-3 fill-current text-zinc-400" />
                            <span>連続再生</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleGenreSelection(genre)}
                            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                          >
                            一覧で見る
                          </button>
                        </div>
                      </div>

                      <HorizontalShelf>
                        {items.slice(0, 16).map((video) => (
                          <VideoCard
                            key={`grp-${genre}-${video.id}`}
                            video={video}
                            accessToken={accessToken}
                            masterKey={masterKey}
                            genres={videoGenresMap[video.id] ?? EMPTY_STRING_ARRAY}
                            customGenres={customGenres}
                            isFavorite={Boolean(userMetaMap[video.id]?.favorite)}
                            isInQueue={queueIdSet.has(video.id)}
                            progress={progressMap[video.id]}
                            thumbnailTimeSec={userMetaMap[video.id]?.thumbnailTimeSec}
                            thumbVersion={thumbVersions[video.id] ?? 0}
                            compact
                            portraitCover={categoryTab === "漫画"}
                            linkedItems={crossMedia.linkedById[video.id]}
                            onOpenCrossMediaSet={handleOpenCrossMediaSet}
                            onSelect={handlePlayVideo}
                            onAddToQueue={handleAddToQueue}
                            onToggleFavorite={handleToggleFavorite}
                            onEditTags={setEditingTagsVideo}
                            onClickGenre={handleClickGenreFromCard}
                          />
                        ))}
                        {items.length > 16 && (
                          <button
                            type="button"
                            onClick={() => toggleGenreSelection(genre)}
                            className="flex w-36 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-4 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
                          >
                            <span className="font-mono text-sm font-bold text-white">
                              +{items.length - 16}
                            </span>
                            <span>すべて表示</span>
                          </button>
                        )}
                      </HorizontalShelf>
                    </section>
                  ))
                )}
              </div>
            ) : (
              <>
                {/* YouTube-style "Continue Watching" horizontal shelf on Home */}
                {navSection === "home" &&
                  !selectionMode &&
                  selectedGenres.length === 0 &&
                  !onlyUncategorized &&
                  !searchQuery &&
                  activeFilterCount === 0 &&
                  continueWatchingVideos.length > 0 && (
                    <section className="mb-7">
                      <div className="mb-3 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-zinc-400" />
                        <h2 className="text-sm font-bold text-white">続きを見る</h2>
                      </div>
                      <HorizontalShelf>
                        {continueWatchingVideos.map((video) => (
                          <VideoCard
                            key={`cw-${video.id}`}
                            video={video}
                            accessToken={accessToken}
                            masterKey={masterKey}
                            genres={videoGenresMap[video.id] ?? EMPTY_STRING_ARRAY}
                            customGenres={customGenres}
                            isFavorite={Boolean(userMetaMap[video.id]?.favorite)}
                            isInQueue={queueIdSet.has(video.id)}
                            progress={progressMap[video.id]}
                            thumbnailTimeSec={userMetaMap[video.id]?.thumbnailTimeSec}
                            thumbVersion={thumbVersions[video.id] ?? 0}
                            compact
                            linkedItems={crossMedia.linkedById[video.id]}
                            onOpenCrossMediaSet={handleOpenCrossMediaSet}
                            onSelect={handlePlayVideo}
                            onAddToQueue={handleAddToQueue}
                            onToggleFavorite={handleToggleFavorite}
                            onEditTags={setEditingTagsVideo}
                            onClickGenre={handleClickGenreFromCard}
                          />
                        ))}
                      </HorizontalShelf>
                    </section>
                  )}

                {/* YouTube-style "Recommended for You" horizontal shelf on Home */}
                {navSection === "home" &&
                  !selectionMode &&
                  selectedGenres.length === 0 &&
                  !onlyUncategorized &&
                  !searchQuery &&
                  recommendedShelfItems.length > 0 && (
                    <section className="mb-7">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-zinc-400" />
                          <h2 className="text-sm font-bold text-white">
                            あなたへのおすすめ
                            {categoryTab !== "all" ? `（${categoryTab}）` : ""}
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={reshuffleHome}
                          className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                          title="おすすめの候補を入れ替える"
                        >
                          <Shuffle className="h-3 w-3 text-zinc-400" />
                          <span>別の候補</span>
                        </button>
                      </div>
                      <HorizontalShelf>
                        {recommendedShelfItems.map((video) => {
                          const reason = recommendationData.reasonById.get(video.id);
                          return (
                            <div key={`rec-${video.id}`} className="flex w-64 shrink-0 flex-col gap-1.5 sm:w-72">
                              {reason && (
                                <div className="flex items-center gap-1 px-0.5">
                                  <span className="inline-flex max-w-full items-center truncate rounded-md border border-zinc-800/80 bg-zinc-900 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                                    <span className="truncate">{reason}</span>
                                  </span>
                                </div>
                              )}
                              <VideoCard
                                video={video}
                                accessToken={accessToken}
                                masterKey={masterKey}
                                genres={videoGenresMap[video.id] ?? EMPTY_STRING_ARRAY}
                                customGenres={customGenres}
                                isFavorite={Boolean(userMetaMap[video.id]?.favorite)}
                                isInQueue={queueIdSet.has(video.id)}
                                progress={progressMap[video.id]}
                                thumbnailTimeSec={userMetaMap[video.id]?.thumbnailTimeSec}
                                thumbVersion={thumbVersions[video.id] ?? 0}
                                compact
                                linkedItems={crossMedia.linkedById[video.id]}
                                onOpenCrossMediaSet={handleOpenCrossMediaSet}
                                onSelect={handlePlayVideo}
                                onAddToQueue={handleAddToQueue}
                                onToggleFavorite={handleToggleFavorite}
                                onEditTags={setEditingTagsVideo}
                                onClickGenre={handleClickGenreFromCard}
                              />
                            </div>
                          );
                        })}
                      </HorizontalShelf>
                    </section>
                  )}

                {/* Manga x Anime Paired Sets Shelf */}
                {navSection === "home" &&
                  (categoryTab === "all" || categoryTab === "漫画" || categoryTab === "アニメ") &&
                  !searchQuery &&
                  selectedGenres.length === 0 &&
                  !onlyUncategorized &&
                  crossMedia.sets.length > 0 && (
                    <section className="mb-7">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <BookOpen className="h-4 w-4 text-zinc-400" />
                          <h2 className="text-sm font-bold text-white">
                            漫画 × アニメ セット（{crossMedia.sets.length} 作品）
                          </h2>
                        </div>
                        <span className="text-[11px] text-zinc-400">
                          同じ作品を 1 タップで同時視聴
                        </span>
                      </div>
                      <HorizontalShelf className="gap-3.5 pb-2">
                        {crossMedia.sets.map((set) => (
                          <div
                            key={`set-${set.manga.id}`}
                            className="flex w-72 shrink-0 flex-col gap-2.5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 sm:w-80"
                          >
                            <div className="flex items-center gap-2">
                              <CrossMediaMiniThumb
                                item={set.manga}
                                accessToken={accessToken}
                                masterKey={masterKey}
                                label={`漫画 ${set.manga.pageCount ?? set.manga.manifest?.pageCount ?? set.manga.manifest?.pages?.length ?? 0}P`}
                                thumbVersion={thumbVersions[set.manga.id] ?? 0}
                              />
                              <CrossMediaMiniThumb
                                item={set.videos[0]}
                                accessToken={accessToken}
                                masterKey={masterKey}
                                label={`アニメ ${set.videos.length}本`}
                                thumbVersion={thumbVersions[set.videos[0].id] ?? 0}
                              />
                            </div>
                            <p className="line-clamp-1 text-xs font-bold text-white">
                              {set.manga.title}
                            </p>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenCrossMediaSet(set.manga, set.videos[0])}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-950 transition hover:bg-white"
                              >
                                <Play className="h-3 w-3 fill-current" />
                                <span>同時に開く</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePlayVideo(set.manga)}
                                className="rounded-xl border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/[0.14]"
                              >
                                漫画
                              </button>
                              <button
                                type="button"
                                onClick={() => handlePlayVideo(set.videos[0])}
                                className="rounded-xl border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 transition hover:bg-white/[0.14]"
                              >
                                アニメ
                              </button>
                            </div>
                          </div>
                        ))}
                      </HorizontalShelf>
                    </section>
                  )}

                {/* Result toolbar */}
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-white">
                      {navSection === "home" && (onlyUncategorized ? "未分類の動画" : "すべての動画")}
                      {navSection === "favorites" && "お気に入り"}
                      {navSection === "history" && "視聴履歴"}
                      {navSection === "files" && "ファイル一覧"}
                    </h2>
                    <span className="rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
                      {filteredVideos.length} / {videos.length} 件
                    </span>

                    {selectedGenres.map((genre) => (
                      <button
                        key={`sel-${genre}`}
                        type="button"
                        onClick={() => toggleGenreSelection(genre)}
                        className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
                      >
                        {genre}
                        <X className="h-3 w-3" />
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Play all filtered videos as queue */}
                    {filteredVideos.length > 0 && !selectionMode && (
                      <button
                        type="button"
                        onClick={() => handlePlayAllFiltered(filteredVideos)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                        title="表示中の動画をすべてキューに入れて連続再生"
                      >
                        <Play className="h-3.5 w-3.5 fill-current text-zinc-400" />
                        <span>すべて連続再生</span>
                      </button>
                    )}

                    {/* Bulk genre assignment toggle */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectionMode((prev) => {
                          const next = !prev;
                          if (!next) setSelectedVideoIds(new Set());
                          return next;
                        });
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        selectionMode
                          ? "border-zinc-200 bg-zinc-100 font-semibold text-zinc-950"
                          : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                      }`}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      <span>{selectionMode ? "選択モード終了" : "一括ジャンル分け"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSortMode("random");
                        reshuffleHome();
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
                      title="並びを新しくシャッフル"
                    >
                      <Shuffle className="h-3.5 w-3.5 text-zinc-400" />
                      <span>シャッフル</span>
                    </button>

                    <select
                      value={sortMode}
                      onChange={(e) => {
                        const next = e.target.value as SortMode;
                        setSortMode(next);
                        if (next === "random") reshuffleHome();
                      }}
                      className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-rose-500 focus:outline-none"
                    >
                      <option value="recommended">おすすめ順</option>
                      <option value="random">ランダム</option>
                      <option value="newest">新しい順</option>
                      <option value="recent_played">最近再生順</option>
                      <option value="title_asc">名前順 (A→Z)</option>
                      <option value="duration_desc">長い順</option>
                      <option value="size_desc">容量順</option>
                    </select>

                    {navSection !== "files" && (
                      <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                        <button
                          type="button"
                          onClick={() => setViewMode("grid")}
                          className={`rounded-md p-1.5 transition ${
                            viewMode === "grid"
                              ? "bg-zinc-800 text-white"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                          title="YouTube グリッド表示"
                        >
                          <Grid className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode("list")}
                          className={`rounded-md p-1.5 transition ${
                            viewMode === "list"
                              ? "bg-zinc-800 text-white"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                          title="ファイルアプリ風リスト表示"
                        >
                          <List className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Video Grid or File-Explorer List */}
                {loading && videos.length === 0 ? (
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="space-y-2.5">
                        <div className="aspect-video animate-pulse rounded-xl bg-zinc-900" />
                        <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-900" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-900/70" />
                      </div>
                    ))}
                  </div>
                ) : filteredVideos.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center">
                    <FolderOpen className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
                    <h3 className="text-base font-semibold text-zinc-200">
                      条件に一致する動画がありません
                    </h3>
                    <p className="mt-2 text-xs text-zinc-400">
                      検索キーワードやジャンルフィルタを変更するか、右上の「アップロード」または「更新」を押してください。
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      {videos.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setUploadModalOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          この端末から最初の動画をアップロード
                        </button>
                      )}
                      {(activeFilterCount > 0 || searchQuery) && (
                        <button
                          type="button"
                          onClick={resetAllFilters}
                          className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-700"
                        >
                          フィルタをリセット
                        </button>
                      )}
                    </div>
                  </div>
                ) : effectiveViewMode === "grid" ? (
                  <div
                    className={
                      categoryTab === "漫画"
                        ? "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                        : "grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    }
                  >
                    {displayedVideos.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        genres={videoGenresMap[video.id] ?? EMPTY_STRING_ARRAY}
                        customGenres={customGenres}
                        isFavorite={Boolean(userMetaMap[video.id]?.favorite)}
                        isInQueue={queueIdSet.has(video.id)}
                        progress={progressMap[video.id]}
                        thumbnailTimeSec={userMetaMap[video.id]?.thumbnailTimeSec}
                        thumbVersion={thumbVersions[video.id] ?? 0}
                        portraitCover={categoryTab === "漫画"}
                        selectionMode={selectionMode}
                        isSelected={selectedVideoIds.has(video.id)}
                        linkedItems={crossMedia.linkedById[video.id]}
                        onOpenCrossMediaSet={handleOpenCrossMediaSet}
                        onToggleSelect={handleToggleSelectVideo}
                        onSelect={handlePlayVideo}
                        onAddToQueue={handleAddToQueue}
                        onToggleFavorite={handleToggleFavorite}
                        onEditTags={setEditingTagsVideo}
                        onClickGenre={handleClickGenreFromCard}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="hidden items-center justify-between px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:flex">
                      <span>動画 / ファイル名 / ジャンル</span>
                      <div className="flex items-center gap-5 pr-20">
                        <span className="w-14 text-right">画質</span>
                        <span className="w-16 text-right">サイズ</span>
                        <span className="hidden w-20 text-right md:inline">追加日</span>
                      </div>
                    </div>
                    {displayedVideos.map((video) => (
                      <VideoListRow
                        key={video.id}
                        video={video}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        genres={videoGenresMap[video.id] ?? EMPTY_STRING_ARRAY}
                        customGenres={customGenres}
                        isFavorite={Boolean(userMetaMap[video.id]?.favorite)}
                        isInQueue={queueIdSet.has(video.id)}
                        progress={progressMap[video.id]}
                        thumbnailTimeSec={userMetaMap[video.id]?.thumbnailTimeSec}
                        thumbVersion={thumbVersions[video.id] ?? 0}
                        selectionMode={selectionMode}
                        isSelected={selectedVideoIds.has(video.id)}
                        linkedItems={crossMedia.linkedById[video.id]}
                        onOpenCrossMediaSet={handleOpenCrossMediaSet}
                        onToggleSelect={handleToggleSelectVideo}
                        onSelect={handlePlayVideo}
                        onAddToQueue={handleAddToQueue}
                        onToggleFavorite={handleToggleFavorite}
                        onEditTags={setEditingTagsVideo}
                        onClickGenre={handleClickGenreFromCard}
                      />
                    ))}
                  </div>
                )}

                {/* Auto-load sentinel + manual fallback for progressive rendering */}
                {filteredVideos.length > visibleHomeCount && (
                  <div
                    ref={homeLoadMoreRef}
                    className="mt-6 flex justify-center py-2"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleHomeCount((prev) =>
                          Math.min(filteredVideos.length, prev + 36)
                        )
                      }
                      className="rounded-full border border-zinc-800 bg-zinc-900 px-5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-800"
                    >
                      さらに表示（残り {filteredVideos.length - visibleHomeCount} 件）
                    </button>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {/* Floating Bulk Genre Assignment Bar */}
      {accessToken && selectionMode && (
        <div className="fixed bottom-16 left-3 right-3 z-40 mx-auto max-w-4xl rounded-2xl border border-zinc-700 bg-zinc-950/95 p-3.5 shadow-2xl shadow-black/80 backdrop-blur-xl md:bottom-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 font-bold text-zinc-950">
                {selectedVideoIds.size} 本選択中
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedVideoIds(new Set(filteredVideos.map((v) => v.id)))
                }
                className="text-zinc-300 underline-offset-2 hover:text-white hover:underline"
              >
                表示中をすべて選択
              </button>
              <button
                type="button"
                onClick={() => setSelectedVideoIds(new Set())}
                className="text-zinc-400 hover:text-white"
              >
                選択解除
              </button>
              <button
                type="button"
                disabled={selectedVideoIds.size === 0}
                onClick={handleBulkAddToQueue}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40"
              >
                <ListPlus className="h-3.5 w-3.5 text-zinc-400" />
                キューに追加
              </button>
              <button
                type="button"
                disabled={selectedVideoIds.size === 0 || deletingItems}
                onClick={() => {
                  const picked = videos.filter((v) => selectedVideoIds.has(v.id));
                  void handleDeleteVaultItems(picked);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deletingItems ? "削除中..." : `削除 (${selectedVideoIds.size})`}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectionMode(false);
                setSelectedVideoIds(new Set());
              }}
              className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              閉じる
            </button>
          </div>

          {/* Group tabs + quick search for bulk assignment */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2 pb-2">
            {!bulkGenreSearch.trim() ? (
              <HorizontalShelf className="min-w-0 flex-1 items-center gap-1">
                {GENRE_GROUP_TABS.map((tab) => {
                  const active = bulkGenreGroup === tab.id;
                  return (
                    <button
                      key={`bg-${tab.id}`}
                      type="button"
                      onClick={() => setBulkGenreGroup(tab.id)}
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition ${
                        active
                          ? "border-zinc-600 bg-zinc-800 text-white"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </HorizontalShelf>
            ) : (
              <span className="flex-1 text-[11px] text-zinc-400">
                「{bulkGenreSearch.trim()}」で絞り込み中 ({filteredBulkGenres.length}件)
              </span>
            )}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={bulkGenreSearch}
                onChange={(e) => setBulkGenreSearch(e.target.value)}
                placeholder="タグ検索..."
                className="w-32 rounded-lg border border-zinc-800 bg-zinc-900 py-1 pl-6 pr-6 text-[11px] text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none sm:w-40"
              />
              {bulkGenreSearch && (
                <button
                  type="button"
                  onClick={() => setBulkGenreSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  aria-label="一括タグ検索をクリア"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto border-t border-zinc-800/80 pt-2">
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <Tag className="h-3 w-3" />
              一括追加:
            </span>
            {filteredBulkGenres.map((cg) => (
              <button
                key={`bulk-${cg.name}`}
                type="button"
                disabled={selectedVideoIds.size === 0}
                onClick={() => handleBulkAssignGenre(cg.name, "add", cg.color)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${getGenreStyle(
                  cg.name,
                  customGenres
                )}`}
              >
                + {cg.name}
              </button>
            ))}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!bulkNewGenreName.trim()) return;
                handleBulkAssignGenre(bulkNewGenreName, "add", "zinc");
                setBulkNewGenreName("");
              }}
              className="ml-auto flex items-center gap-1.5"
            >
              <input
                type="text"
                value={bulkNewGenreName}
                onChange={(e) => setBulkNewGenreName(e.target.value)}
                placeholder="新規ジャンルで追加..."
                className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none sm:w-44"
              />
              <button
                type="submit"
                disabled={!bulkNewGenreName.trim() || selectedVideoIds.size === 0}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-950 hover:bg-white disabled:opacity-40"
              >
                適用
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      {accessToken && (!vaultConfig || masterKey) && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-zinc-800/90 bg-[#0b0b0e]/95 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = navSection === item.id;
            return (
              <button
                key={`mob-${item.id}`}
                type="button"
                onClick={() => {
                  setNavSection(item.id);
                  if (item.id === "home") reshuffleHome();
                }}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-2.5 py-1 text-[10px] transition ${
                  active ? "font-semibold text-rose-400" : "text-zinc-400"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Queue Toast Notification */}
      {queueToast && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-[60] -translate-x-1/2 rounded-full border border-indigo-500/40 bg-zinc-950/95 px-4 py-2 text-xs font-semibold text-indigo-200 shadow-2xl backdrop-blur-xl">
          <span className="inline-flex items-center gap-1.5">
            <ListMusic className="h-3.5 w-3.5 text-indigo-400" />
            {queueToast}
          </span>
        </div>
      )}

      {/* Video Player Modal (YouTube Watch Page + Queue + Universal Mini-Player / PiP) */}
      {activeVideo && accessToken && (
        <VideoPlayerModal
          video={activeVideo}
          allVideos={videos}
          accessToken={accessToken}
          masterKey={masterKey}
          genres={videoGenresMap[activeVideo.id] ?? EMPTY_STRING_ARRAY}
          customGenres={customGenres}
          videoGenresMap={videoGenresMap}
          userMetaMap={userMetaMap}
          progressMap={progressMap}
          thumbVersions={thumbVersions}
          isFavorite={Boolean(userMetaMap[activeVideo.id]?.favorite)}
          seriesVideos={seriesVideos}
          relatedVideos={relatedVideos}
          queue={queue}
          queueIndex={queueIndex}
          initialProgress={progressMap[activeVideo.id]}
          initialStartTimeSec={startTimeOverride}
          initialStartNonce={startTimeNonce}
          thumbnailTimeSec={userMetaMap[activeVideo.id]?.thumbnailTimeSec}
          hasActiveManga={Boolean(activeManga)}
          linkedManga={crossMedia.linkedById[activeVideo.id] ?? []}
          splitWithManga={mangaSplitMode}
          onToggleSplitWithManga={() => setMangaSplitMode((prev) => !prev)}
          onEnableSplitWithManga={() => setMangaSplitMode(true)}
          onClose={handleClosePlayer}
          onSelectVideo={handlePlayVideo}
          onSelectQueueIndex={handleSelectQueueIndex}
          onAddToQueue={handleAddToQueue}
          onRemoveFromQueue={handleRemoveFromQueue}
          onMoveQueueItem={handleMoveQueueItem}
          onClearQueue={handleClearQueue}
          onShuffleQueue={handleShuffleQueue}
          onToggleFavorite={handleToggleFavorite}
          onEditTags={setEditingTagsVideo}
          onClickGenre={handleClickGenreFromCard}
          onProgressUpdated={handleProgressUpdated}
          onThumbnailUpdated={handleThumbnailUpdated}
          onAuthExpired={handleAuthExpired}
        />
      )}

      {/* E2EE Manga Reader (with Auto-Slide & Simultaneous Video Mode!) */}
      {activeManga && accessToken && (
        <MangaReaderModal
          manga={activeManga}
          allVideos={videos}
          linkedVideos={crossMedia.linkedById[activeManga.id] ?? []}
          seriesManga={seriesManga}
          relatedWorks={relatedMangaWorks}
          onSelectManga={(m) => setActiveManga(m)}
          queue={queue}
          queueIndex={queueIndex}
          onSelectQueueIndex={handleSelectQueueIndex}
          onRemoveFromQueue={handleRemoveFromQueue}
          onClearQueue={handleClearQueue}
          accessToken={accessToken}
          masterKey={masterKey}
          isFavorite={Boolean(userMetaMap[activeManga.id]?.favorite)}
          initialProgress={progressMap[activeManga.id]}
          hasActiveVideo={Boolean(activeVideo)}
          activeVideoTitle={activeVideo?.title}
          splitWithVideo={mangaSplitMode}
          onToggleSplitWithVideo={() => setMangaSplitMode((prev) => !prev)}
          onEnableSplitWithVideo={() => setMangaSplitMode(true)}
          onSelectVideo={handlePlayVideo}
          onToggleFavorite={handleToggleFavorite}
          onEditTags={setEditingTagsVideo}
          onProgressUpdated={handleProgressUpdated}
          onThumbnailUpdated={handleThumbnailUpdated}
          thumbVersions={thumbVersions}
          onAuthExpired={handleAuthExpired}
          onClose={() => setActiveManga(null)}
        />
      )}

      {/* Mobile / Browser Direct E2EE Video Upload Modal */}
      {uploadModalOpen && accessToken && (
        <UploadVideoModal
          rootFolderId={folderId.trim()}
          accessToken={accessToken}
          vaultConfig={vaultConfig}
          masterKey={masterKey}
          onVaultInitialized={(cfg, key) => {
            setVaultConfig(cfg);
            setMasterKey(key);
          }}
          onUploaded={handleVideosUploaded}
          onAuthExpired={handleAuthExpired}
          onClose={() => setUploadModalOpen(false)}
        />
      )}

      {/* External Video Site URL Player, Downloader & E2EE Vault Importer */}
      {externalUrlModalOpen && (
        <ExternalUrlModal
          initialUrl={initialExternalUrl}
          accessToken={accessToken}
          rootFolderId={folderId.trim()}
          vaultConfig={vaultConfig}
          masterKey={masterKey}
          onVaultInitialized={(cfg, key) => {
            setVaultConfig(cfg);
            setMasterKey(key);
          }}
          onVideoSavedToVault={(item) => handleVideosUploaded([item])}
          onClose={() => setExternalUrlModalOpen(false)}
        />
      )}

      {/* Genre / Tag Editor Modal */}
      {editingTagsVideo && (
        <TagEditorModal
          video={editingTagsVideo}
          currentGenres={videoGenresMap[editingTagsVideo.id] ?? EMPTY_STRING_ARRAY}
          customGenres={customGenres}
          onToggleGenre={handleToggleVideoGenre}
          onAddCustomGenre={handleAddCustomGenreToVideo}
          onDeleteVideo={(v) => void handleDeleteVaultItems([v])}
          deleting={deletingItems}
          onClose={() => setEditingTagsVideo(null)}
        />
      )}

      {/* On-Device Persistent Cache Modal (iPad / iPhone / PC Instant Playback!) */}
      {cacheModalOpen && (
        <div
          onClick={() => setCacheModalOpen(false)}
          className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="端末高速キャッシュ管理"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">端末高速キャッシュ（iPad 高速化）</h2>
                  <p className="text-[11px] text-zinc-400">
                    すべて暗号化（E2EE）のまま iPad 内に保存し、再読み込み後も爆速再生します
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCacheModalOpen(false)}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Live Storage Stats + Capacity Bar */}
            <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-xs">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <p className="text-[10px] text-zinc-500">サムネ・漫画</p>
                  <p className="font-mono text-sm font-bold text-white">
                    {diskCacheStats.thumbCount} <span className="text-[10px] font-normal text-zinc-400">件</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">プレイリスト</p>
                  <p className="font-mono text-sm font-bold text-white">
                    {diskCacheStats.playlistCount} <span className="text-[10px] font-normal text-zinc-400">件</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">動画データ</p>
                  <p className="font-mono text-sm font-bold text-white">
                    {diskCacheStats.segmentCount} <span className="text-[10px] font-normal text-zinc-400">件</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">使用容量</p>
                  <p className="font-mono text-sm font-bold text-emerald-300">
                    {diskCacheStats.totalBytes > 0 ? formatBytes(diskCacheStats.totalBytes) : "0 B"}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 border-t border-zinc-800/80 pt-2.5">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-zinc-400">
                    動画キャッシュ上限:{" "}
                    <strong className="font-mono text-zinc-100">
                      {Math.round((cacheLimitMb / 1024) * 10) / 10} GB
                    </strong>
                    {diskCacheStats.quotaBytes ? (
                      <span className="ml-1.5 text-[10px] text-zinc-500">
                        （端末割当枠 {formatBytes(diskCacheStats.quotaBytes)}）
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-300">
                    {Math.min(
                      100,
                      Math.round(
                        (diskCacheStats.segmentBytes / Math.max(1, diskCacheStats.limitBytes)) * 100
                      )
                    )}
                    %
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] duration-300"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (diskCacheStats.segmentBytes / Math.max(1, diskCacheStats.limitBytes)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-zinc-400">上限サイズ:</span>
                  {DISK_CACHE_PRESETS_MB.map((presetMb) => {
                    const active = cacheLimitMb === presetMb;
                    const gbLabel = `${Math.round((presetMb / 1024) * 10) / 10} GB`;
                    return (
                      <button
                        key={presetMb}
                        type="button"
                        disabled={cacheBuildState.running}
                        onClick={() => handleChangeCacheLimitMb(presetMb)}
                        className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold transition disabled:opacity-45 ${
                          active
                            ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-200"
                            : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {gbLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Active Build Progress */}
            {cacheBuildState.running && (
              <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/25 p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-semibold text-emerald-200">
                    {cacheBuildState.label}
                  </span>
                  <span className="shrink-0 font-mono font-bold text-emerald-300">
                    {cacheBuildState.done} / {cacheBuildState.total}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-300">
                  <span>
                    +{cacheBuildState.downloadedBytes > 0 ? formatBytes(cacheBuildState.downloadedBytes) : "0 B"}
                    {cacheBuildState.speedBps > 0
                      ? ` (${formatBytes(cacheBuildState.speedBps)}/秒)`
                      : ""}
                  </span>
                  {cacheBuildState.skipped > 0 && (
                    <span className="text-zinc-400">
                      保存済 {cacheBuildState.skipped} 件をスキップ
                    </span>
                  )}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-[width] duration-200"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (cacheBuildState.done / Math.max(1, cacheBuildState.total)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleStopDeviceCache}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800"
                  >
                    ここで停止（作成済み分は保持）
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={cacheBuildState.running}
                onClick={() => handleBuildDeviceCache("fast_start")}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-500/45 bg-emerald-500/15 p-3.5 text-left transition hover:bg-emerald-500/25 disabled:opacity-45"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-200">
                    <Zap className="h-3.5 w-3.5 fill-current" />
                    <span>高速スタートキャッシュを作成（おすすめ）</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-300">
                    全動画のサムネ＋プレビュー＋再生リスト＋冒頭映像（360p＋高画質先頭）＋漫画20Pを保存
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-zinc-950">
                  開始
                </span>
              </button>

              <button
                type="button"
                disabled={cacheBuildState.running}
                onClick={() => handleBuildDeviceCache("favorites_deep")}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-left transition hover:bg-rose-500/20 disabled:opacity-45"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-rose-200">
                    <Heart className="h-3.5 w-3.5 fill-current" />
                    <span>お気に入り＆続きを見るを深掘りキャッシュ</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-300">
                    お気に入り・続き位置の前後約 5 分以上（高画質＋360p）と漫画最大 100P を先読み保存
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white">
                  開始
                </span>
              </button>

              <button
                type="button"
                disabled={cacheBuildState.running}
                onClick={() => handleBuildDeviceCache("full_library")}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3.5 text-left transition hover:bg-cyan-500/20 disabled:opacity-45"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-cyan-200">
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>大容量まとめてキャッシュ（上限 {Math.round((cacheLimitMb / 1024) * 10) / 10} GB まで保存）</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-zinc-300">
                    お気に入り・続き・新着順に上限いっぱいまで高画質映像＆漫画を自動保存（再実行時は済分スキップ）
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-cyan-500 px-2.5 py-1 text-[11px] font-bold text-zinc-950">
                  開始
                </span>
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/80 pt-3">
              <button
                type="button"
                disabled={cacheBuildState.running || diskCacheStats.totalBytes === 0}
                onClick={handleClearDeviceCache}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>端末キャッシュを削除</span>
              </button>
              <button
                type="button"
                onClick={() => setCacheModalOpen(false)}
                className="rounded-xl bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-white"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden OAuth JSON input usable from both Login Wizard and Settings Modal */}
      <input
        ref={oauthJsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleOAuthJsonUpload(file);
          }
          e.target.value = "";
        }}
      />

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="設定"
        >
          <form
            onSubmit={handleSaveSettings}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleOAuthJsonUpload(file);
            }}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">接続設定</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {setupWizardNotice && (
              <div className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-950/25 px-3 py-2 text-[11px] leading-relaxed text-emerald-200">
                {setupWizardNotice}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Web 用 Google OAuth クライアント ID
                </label>
                <input
                  type="text"
                  value={draftClientId}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.trim().startsWith("{")) {
                      const parsed = parseAutoSetupPayload(val);
                      if (parsed.clientId) {
                        setDraftClientId(parsed.clientId);
                        return;
                      }
                    }
                    setDraftClientId(val);
                  }}
                  placeholder="1234567890-xxxx.apps.googleusercontent.com"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => oauthJsonInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-rose-500/50 hover:text-white"
                  >
                    <Upload className="h-3 w-3 text-rose-400" />
                    <span>JSON 読込</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleReadClipboardSetup}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-emerald-500/50 hover:text-white"
                  >
                    <Copy className="h-3 w-3 text-emerald-400" />
                    <span>クリップボード自動読込</span>
                  </button>
                  {currentOrigin && (
                    <button
                      type="button"
                      onClick={handleCopyCurrentOrigin}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-sky-500/50 hover:text-white"
                    >
                      <Copy className="h-3 w-3 text-sky-400" />
                      <span>生成元コピー</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyCloudShellCommand}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition hover:bg-sky-500/20"
                  >
                    <Terminal className="h-3 w-3" />
                    <span>Cloud Shell 自動構築</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Google Drive フォルダ ID（空欄のままログインしても自動作成・検出されます）
                </label>
                <input
                  type="text"
                  value={draftFolderId}
                  onChange={(e) => setDraftFolderId(e.target.value)}
                  placeholder="空欄で OK（ログイン時に「VaultStream-Vault」を自動作成・検出）"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleAutoSetupDriveFolder}
                    disabled={autoSetupBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-600/30 disabled:opacity-50"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>
                      {autoSetupBusy
                        ? "Drive フォルダを検出・作成中..."
                        : "Drive フォルダを自動作成・自動検出"}
                    </span>
                  </button>
                  {isValidClientId(draftClientId || clientId) && (
                    <button
                      type="button"
                      onClick={() =>
                        void copyAutoConfigLink(
                          draftClientId || clientId,
                          draftFolderId || folderId
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-rose-500/40 hover:text-white"
                    >
                      <Link2 className="h-3 w-3 text-rose-400" />
                      <span>他端末用 1タップリンクコピー</span>
                    </button>
                  )}
                </div>
              </div>
              {accessToken && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5">
                  <p className="mb-2 text-xs font-semibold text-emerald-200">
                    ジャンル・お気に入りの履歴復元（Google Drive リビジョン）
                  </p>
                  <button
                    type="button"
                    onClick={handleRestoreGenresFromHistory}
                    disabled={restoringHistory}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-600/40 disabled:opacity-50"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${restoringHistory ? "animate-spin" : ""}`} />
                    {restoringHistory ? "復元中..." : "過去の履歴からジャンルを復元・統合する"}
                  </button>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
