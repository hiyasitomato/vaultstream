"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckSquare,
  Clock,
  Cloud,
  CloudOff,
  Film,
  FolderOpen,
  Grid,
  Hash,
  Heart,
  History,
  Home,
  KeyRound,
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
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { buildCrossMediaIndex, findSeriesAndRelatedVideos } from "@/lib/crossMedia";
import { unlockVaultWithPassphrase } from "@/lib/crypto";
import {
  clearMangaPageCache,
  clearThumbnailCache,
  driveFetchCachedThumbnailUrl,
  fetchVaultVideosFast,
  formatBytes,
  getSyncCachedThumbnailUrl,
  inspectVaultRoot,
  isValidClientId,
  listUserMetaRevisions,
  loadSyncedUserDataFromDrive,
  loadUserMetaRevisionFromDrive,
  requestGoogleAccessToken,
  revokeGoogleAccessToken,
  saveSyncedUserDataToDrive,
} from "@/lib/drive";
import {
  CATEGORY_TAG_SET,
  DEFAULT_CUSTOM_GENRES,
  GENRE_COLOR_OPTIONS,
  getContentGenresOnly,
  getEffectiveGenres,
  getGenreStyle,
} from "@/lib/genres";
import { clearSegmentCache } from "@/lib/segmentCache";
import {
  clearAuthSession,
  clearCachedVideoList,
  clearSavedPassphrase,
  createDefaultUserData,
  getSavedClientIdOverride,
  getSavedFolderIdOverride,
  loadAllProgress,
  loadAuthSession,
  loadCachedVideoList,
  loadLocalUserData,
  loadSavedPassphrase,
  mergeProgressMaps,
  mergeSyncedUserData,
  saveAllProgress,
  saveAuthSession,
  saveCachedVideoList,
  saveLocalUserData,
  savePassphrase,
  setSavedClientIdOverride,
  setSavedFolderIdOverride,
} from "@/lib/storage";
import type {
  CustomGenreDef,
  DurationFilter,
  NavSection,
  PlaybackProgress,
  QualityFilter,
  SortMode,
  SyncedVaultUserData,
  VaultConfig,
  VaultVideoItem,
  VideoUserMeta,
  ViewMode,
  WatchFilter,
} from "@/lib/types";
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

function CrossMediaMiniThumb({
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

  return (
    <div className="relative h-24 flex-1 overflow-hidden rounded-lg bg-[#060609] ring-1 ring-white/15">
      {url ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-75 blur-xl saturate-[1.8] brightness-[0.34]"
          />
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
}

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

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Navigation & view state
  const [navSection, setNavSection] = useState<NavSection>("home");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Search, file-style filters, and multi-genre state
  const [categoryTab, setCategoryTab] = useState<"all" | "現実" | "アニメ" | "漫画">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [genreMatchMode, setGenreMatchMode] = useState<"AND" | "OR">("AND");
  const [sortMode, setSortMode] = useState<SortMode>("random");
  const [homeShuffleSeed, setHomeShuffleSeed] = useState<number>(() =>
    Math.floor(Math.random() * 0x7fffffff)
  );
  const reshuffleHome = useCallback(() => {
    setHomeShuffleSeed(Math.floor(Math.random() * 0x7fffffff));
  }, []);
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [watchFilter, setWatchFilter] = useState<WatchFilter>("all");

  // Bulk genre assignment mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [bulkNewGenreName, setBulkNewGenreName] = useState("");

  // Genre management page form state
  const [newGenreName, setNewGenreName] = useState("");
  const [newGenreColor, setNewGenreColor] = useState("rose");
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftClientId, setDraftClientId] = useState("");
  const [draftFolderId, setDraftFolderId] = useState("");

  const activeVideo =
    queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;

  const queueIdSet = useMemo(() => new Set(queue.map((v) => v.id)), [queue]);

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

  const handleSelectQueueIndex = useCallback((idx: number) => {
    setStartTimeOverride(null);
    setQueueIndex(idx);
  }, []);

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
        }
        showQueueToast(`キューに追加しました（計 ${next.length} 本）`);
        return next;
      });
    },
    [showQueueToast]
  );

  const handlePlayAllFiltered = useCallback(
    (items: VaultVideoItem[]) => {
      const playable = items.filter((v) => v.kind !== "manga");
      if (playable.length === 0) return;
      setStartTimeOverride(null);
      setQueue(playable);
      setQueueIndex(0);
      showQueueToast(`${playable.length} 本をキューで連続再生します`);
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
        // Single root inspection call (replaces 3 separate root listings!)
        const snapshot = await inspectVaultRoot(cleanFolderId, token);
        const cfg = snapshot.vaultConfig;
        setVaultConfig(cfg);

        let keyToUse = existingKey;
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

        // Instant paint from local cache while refreshing from Drive index
        if (!forceFullScan) {
          const cached = loadCachedVideoList(cleanFolderId) as VaultVideoItem[] | null;
          if (cached && cached.length > 0) {
            setVideos((prev) => (prev.length === 0 ? cached : prev));
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

  // Restore local state & saved OAuth session on mount
  useEffect(() => {
    setProgressMap(loadAllProgress());
    setUserData(loadLocalUserData());

    const savedClient = getSavedClientIdOverride();
    const savedFolder = getSavedFolderIdOverride();
    const resolvedFolder = savedFolder || ENV_FOLDER_ID;
    if (savedClient) setClientId(savedClient);
    if (savedFolder) setFolderId(savedFolder);

    const savedAuth = loadAuthSession();
    if (savedAuth && resolvedFolder) {
      setAccessToken(savedAuth.accessToken);
      loadLibrary(savedAuth.accessToken, resolvedFolder);
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch(() => undefined);
    }
  }, [loadLibrary]);

  const effectiveClientIdValid = isValidClientId(clientId);
  const effectiveFolderIdValid = folderId.trim().length > 0;

  const handleSignIn = async () => {
    if (!effectiveClientIdValid) {
      setDraftClientId(isValidClientId(clientId) ? clientId : "");
      setDraftFolderId(folderId);
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
      await loadLibrary(token, folderId, masterKey);
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

  const handleSeedDefaultGenres = useCallback(() => {
    updateUserData((prev) => {
      const existing = new Set(prev.customGenres.map((g) => g.name));
      const additions = DEFAULT_CUSTOM_GENRES.filter((g) => !existing.has(g.name));
      if (additions.length === 0) return prev;
      return {
        ...prev,
        customGenresUpdatedAt: Date.now(),
        customGenres: [...prev.customGenres, ...additions],
      };
    });
    showQueueToast("定番ジャンル一覧を追加しました！");
  }, [updateUserData, showQueueToast]);

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
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [videos, videoGenresMap, customGenres, categoryTab]);

  const uncategorizedCount = useMemo(
    () =>
      videos.filter((v) => getContentGenresOnly(videoGenresMap[v.id] ?? []).length === 0)
        .length,
    [videos, videoGenresMap]
  );

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
    setDurationFilter("all");
    setQualityFilter("all");
    setWatchFilter("all");
    setSortMode("random");
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
    (onlyUncategorized ? 1 : 0) +
    (durationFilter !== "all" ? 1 : 0) +
    (qualityFilter !== "all" ? 1 : 0) +
    (watchFilter !== "all" ? 1 : 0);

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

  // Main filtered + sorted video list
  const filteredVideos = useMemo(() => {
    let list = [...videos];

    if (navSection === "favorites") {
      list = list.filter((v) => Boolean(userMetaMap[v.id]?.favorite));
    } else if (navSection === "history") {
      list = list.filter((v) => Boolean(progressMap[v.id]?.updatedAt));
    }

    if (categoryTab === "漫画") {
      list = list.filter(
        (v) => v.kind === "manga" || (videoGenresMap[v.id] ?? []).includes("漫画")
      );
    } else if (categoryTab !== "all") {
      list = list.filter(
        (v) => v.kind !== "manga" && (videoGenresMap[v.id] ?? []).includes(categoryTab)
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
          ...(videoGenresMap[v.id] ?? []),
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

    if (onlyUncategorized || watchFilter === "uncategorized") {
      list = list.filter((v) => getContentGenresOnly(videoGenresMap[v.id] ?? []).length === 0);
    } else if (selectedGenres.length > 0) {
      list = list.filter((v) => {
        const gList = videoGenresMap[v.id] ?? [];
        if (genreMatchMode === "AND") {
          return selectedGenres.every((sel) => gList.includes(sel));
        }
        return selectedGenres.some((sel) => gList.includes(sel));
      });
    }

    if (durationFilter === "short") {
      list = list.filter((v) => v.duration > 0 && v.duration < 300);
    } else if (durationFilter === "medium") {
      list = list.filter((v) => v.duration >= 300 && v.duration <= 1200);
    } else if (durationFilter === "long") {
      list = list.filter((v) => v.duration > 1200);
    }

    if (qualityFilter === "hd1080") {
      list = list.filter((v) => (v.height ?? 0) >= 1080);
    } else if (qualityFilter === "hd720") {
      list = list.filter((v) => (v.height ?? 0) >= 720 && (v.height ?? 0) < 1080);
    } else if (qualityFilter === "sd") {
      list = list.filter((v) => (v.height ?? 0) > 0 && (v.height ?? 0) < 720);
    }

    if (watchFilter === "favorites") {
      list = list.filter((v) => Boolean(userMetaMap[v.id]?.favorite));
    } else if (watchFilter === "unwatched") {
      list = list.filter((v) => !(progressMap[v.id]?.currentTime > 3));
    } else if (watchFilter === "in_progress") {
      list = list.filter((v) => {
        const p = progressMap[v.id];
        return p && p.currentTime > 3 && (p.duration <= 0 || p.currentTime < p.duration - 10);
      });
    } else if (watchFilter === "watched") {
      list = list.filter((v) => {
        const p = progressMap[v.id];
        return p && p.duration > 0 && p.currentTime >= p.duration - 10;
      });
    }

    const effectiveSort: SortMode =
      navSection === "history" && (sortMode === "newest" || sortMode === "random")
        ? "recent_played"
        : sortMode;

    list.sort((a, b) => {
      switch (effectiveSort) {
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
            (progressMap[b.id]?.updatedAt ?? 0) - (progressMap[a.id]?.updatedAt ?? 0)
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
    progressMap,
    searchQuery,
    videoGenresMap,
    onlyUncategorized,
    selectedGenres,
    genreMatchMode,
    durationFilter,
    qualityFilter,
    watchFilter,
    sortMode,
    homeShuffleSeed,
  ]);

  const totalLibraryBytes = useMemo(
    () => videos.reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0),
    [videos]
  );

  // Automatic local Manga <-> Anime title pairing (zero external API calls)
  const crossMedia = useMemo(() => buildCrossMediaIndex(videos), [videos]);

  // Gentle background low-priority thumbnail pre-warmer so fast swiping renders in 0ms
  useEffect(() => {
    if (!accessToken || filteredVideos.length === 0) return;
    // Pause background thumb warming while actively watching video or reading manga
    if (activeVideo || activeManga) return;

    const needsWarm = filteredVideos
      .slice(0, 150)
      .filter(
        (v) =>
          v.thumbnailFileId &&
          (!v.encrypted || masterKey) &&
          !getSyncCachedThumbnailUrl(
            v.thumbnailFileId,
            Boolean(v.encrypted),
            v.thumbnailModifiedTime
          )
      );
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
        Promise.all(Array.from({ length: 4 }, () => worker())).catch(() => undefined);
      }
    }, 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accessToken, masterKey, filteredVideos, activeVideo, activeManga]);

  const { seriesVideos, relatedVideos } = useMemo(() => {
    if (!activeVideo) return { seriesVideos: [], relatedVideos: [] };
    return findSeriesAndRelatedVideos(activeVideo, videos, videoGenresMap, 6);
  }, [activeVideo, videos, videoGenresMap]);

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

  const handleSubmitNewGenre = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGenreName.trim()) return;
    handleCreateCustomGenre(newGenreName, newGenreColor);
    setNewGenreName("");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0e] pb-24 text-zinc-100 md:pb-12">
      {/* Top YouTube + File-Explorer Search Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#0b0b0e]/95 backdrop-blur-xl">
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
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white shadow-lg shadow-rose-600/25">
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
                  placeholder="タイトル・ファイル名・ジャンルで検索（例: ワード1 ワード2 -除外）"
                  className="w-full rounded-full border border-zinc-800 bg-zinc-900/90 py-2 pl-10 pr-9 text-xs text-zinc-100 placeholder-zinc-500 transition focus:border-rose-500/70 focus:bg-zinc-900 focus:outline-none sm:text-sm"
                />
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

              <button
                type="button"
                onClick={() => setFiltersOpen((prev) => !prev)}
                className={`relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
                  filtersOpen || activeFilterCount > 0
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                }`}
                title="詳細検索・フィルタ"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">詳細フィルタ</span>
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
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

            {accessToken && (!vaultConfig || masterKey) && (
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-rose-600 px-3 text-xs font-semibold text-white shadow-sm shadow-rose-600/30 transition hover:bg-rose-500"
                title="スマホ・ブラウザから動画を暗号化アップロード"
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">アップロード</span>
              </button>
            )}

            {accessToken && (
              <button
                type="button"
                onClick={() => {
                  clearThumbnailCache(true);
                  loadLibrary(accessToken, folderId, masterKey, false);
                }}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                title="Google Drive から最新一覧を取得"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">更新</span>
              </button>
            )}

            {accessToken && vaultConfig && masterKey && (
              <button
                type="button"
                onClick={handleLockVault}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 text-xs font-medium text-emerald-300 transition hover:border-amber-500/40 hover:bg-amber-950/30 hover:text-amber-200"
                title="Vault をロックする"
              >
                <Lock className="h-3.5 w-3.5" />
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

        {/* Collapsible File-App Advanced Filter Drawer */}
        {accessToken && (!vaultConfig || masterKey) && filtersOpen && (
          <div className="border-t border-zinc-800/80 bg-zinc-950/95 px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">長さ:</span>
                <select
                  value={durationFilter}
                  onChange={(e) => setDurationFilter(e.target.value as DurationFilter)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200 focus:border-rose-500 focus:outline-none"
                >
                  <option value="all">すべて</option>
                  <option value="short">短め (~5分)</option>
                  <option value="medium">標準 (5〜20分)</option>
                  <option value="long">長編 (20分~)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">画質:</span>
                <select
                  value={qualityFilter}
                  onChange={(e) => setQualityFilter(e.target.value as QualityFilter)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200 focus:border-rose-500 focus:outline-none"
                >
                  <option value="all">すべて</option>
                  <option value="hd1080">Full HD (1080p+)</option>
                  <option value="hd720">HD (720p)</option>
                  <option value="sd">SD (~719p)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">状態:</span>
                <select
                  value={watchFilter}
                  onChange={(e) => setWatchFilter(e.target.value as WatchFilter)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200 focus:border-rose-500 focus:outline-none"
                >
                  <option value="all">すべて</option>
                  <option value="uncategorized">未分類のみ</option>
                  <option value="unwatched">未視聴</option>
                  <option value="in_progress">視聴途中</option>
                  <option value="watched">視聴済み</option>
                  <option value="favorites">お気に入りのみ</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-zinc-400">並び替え:</span>
                <select
                  value={sortMode}
                  onChange={(e) => {
                    const next = e.target.value as SortMode;
                    setSortMode(next);
                    if (next === "random") reshuffleHome();
                  }}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-200 focus:border-rose-500 focus:outline-none"
                >
                  <option value="random">ランダム（毎回変わる）</option>
                  <option value="newest">追加が新しい順</option>
                  <option value="oldest">追加が古い順</option>
                  <option value="recent_played">最近再生した順</option>
                  <option value="title_asc">タイトル順 (A→Z)</option>
                  <option value="title_desc">タイトル逆順 (Z→A)</option>
                  <option value="duration_desc">再生時間が長い順</option>
                  <option value="duration_asc">再生時間が短い順</option>
                  <option value="size_desc">容量が大きい順</option>
                </select>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setGenreMatchMode("AND")}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    genreMatchMode === "AND"
                      ? "bg-rose-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  タグAND
                </button>
                <button
                  type="button"
                  onClick={() => setGenreMatchMode("OR")}
                  className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                    genreMatchMode === "OR"
                      ? "bg-rose-600 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  タグOR
                </button>
              </div>

              {(activeFilterCount > 0 || searchQuery) && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
                >
                  <RotateCcw className="h-3 w-3" />
                  リセット
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main layout */}
      {!accessToken ? (
        <main className="mx-auto max-w-xl px-4 py-12">
          {!effectiveClientIdValid && (
            <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4 text-sm text-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold">Web 用 OAuth クライアント ID が未設定です</p>
                  <p className="mt-1 text-xs text-amber-200/80">
                    右上の設定ボタンからクライアント ID を入力してください。
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <section className="rounded-3xl border border-zinc-800/80 bg-zinc-900/50 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500/20 to-fuchsia-500/20 text-rose-400 ring-1 ring-rose-500/30">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h2 className="text-2xl font-bold text-white">VaultStream にログイン</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Google Drive と直接接続し、暗号化されたプライベート動画を自分のジャンル分けでストリーミング再生します。
            </p>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 text-left text-xs text-zinc-400">
              <div className="flex items-center justify-between py-1">
                <span>保存先フォルダ ID</span>
                <code className="max-w-[60%] truncate text-zinc-200">
                  {effectiveFolderIdValid ? folderId : "未設定"}
                </code>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>OAuth クライアント</span>
                <span className={effectiveClientIdValid ? "text-emerald-400" : "text-amber-400"}>
                  {effectiveClientIdValid ? "設定済み" : "未設定"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignIn}
              disabled={authLoading}
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {authLoading ? "Google に接続しています..." : "Google アカウントでログイン"}
            </button>

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
            </nav>

            {/* User's genres quick list in sidebar */}
            {sidebarExpanded && (
              <div className="mt-5 flex-1 overflow-y-auto border-t border-zinc-800/70 pt-4">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    マイジャンル
                  </span>
                  <button
                    type="button"
                    onClick={() => setNavSection("genres")}
                    className="text-[11px] text-rose-400 hover:underline"
                  >
                    +管理
                  </button>
                </div>

                {genreCounts.length === 0 ? (
                  <p className="px-2 text-[11px] text-zinc-500">
                    「ジャンル」から好きなジャンルを作成できます
                  </p>
                ) : (
                  <div className="space-y-0.5">
                    {genreCounts.map(([genre, count]) => {
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
                              ? "bg-rose-500/15 font-semibold text-rose-300"
                              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                          }`}
                        >
                          <span className="truncate">#{genre}</span>
                          <span className="ml-2 shrink-0 text-[10px] text-zinc-500">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
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
                      { id: "all", label: "すべて", count: videos.length, activeCls: "bg-white text-zinc-950" },
                      { id: "現実", label: "現実", count: realVideoCount, activeCls: "bg-sky-500 text-white shadow-sm shadow-sky-500/30" },
                      { id: "アニメ", label: "アニメ", count: animeVideoCount, activeCls: "bg-fuchsia-500 text-white shadow-sm shadow-fuchsia-500/30" },
                      { id: "漫画", label: "漫画", count: mangaCount, activeCls: "bg-amber-500 text-zinc-950 shadow-sm shadow-amber-500/30" },
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

            {/* YouTube-style Horizontal Genre Chip Bar */}
            {navSection !== "genres" && (
              <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
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
                  すべてのジャンル
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
                        ? "border-amber-500 bg-amber-500/20 text-amber-200"
                        : "border-zinc-800 bg-zinc-900/90 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
                    }`}
                  >
                    <span>未分類</span>
                    <span className="text-[10px] opacity-75">{uncategorizedCount}</span>
                  </button>
                )}

                {genreCounts
                  .filter(([genre]) => genre !== "現実" && genre !== "アニメ" && genre !== "漫画")
                  .map(([genre, count]) => {
                  const selected = selectedGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleGenreSelection(genre)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-rose-500 bg-rose-600 text-white shadow-sm shadow-rose-600/30"
                          : "border-zinc-800 bg-zinc-900/90 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
                      }`}
                    >
                      <span>#{genre}</span>
                      <span
                        className={`text-[10px] ${
                          selected ? "text-rose-100" : "text-zinc-500"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setNavSection("genres")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-rose-500/60 hover:text-rose-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  ジャンル作成
                </button>
              </div>
            )}

            {/* Dedicated Genres Management & Directory Page */}
            {navSection === "genres" ? (
              <section className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                      <Sparkles className="h-5 w-5 text-rose-400" />
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
                        ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
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
                      placeholder="ジャンル名を入力（例: お気に入り、コスプレ、素人、アニメ、神回...）"
                      className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!newGenreName.trim()}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                      ジャンルを作成
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">カラー:</span>
                    {GENRE_COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setNewGenreColor(c.id)}
                        className={`flex h-6 w-6 items-center justify-center rounded-full ${c.dot} transition ${
                          newGenreColor === c.id
                            ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
                            : "opacity-60 hover:opacity-100"
                        }`}
                        title={c.label}
                      />
                    ))}
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                        title="Google Drive に保存されている過去リビジョンから消えたジャンル・お気に入りを統合復元します"
                      >
                        <RotateCcw className={`h-3.5 w-3.5 ${restoringHistory ? "animate-spin" : ""}`} />
                        {restoringHistory ? "履歴を照合・復元中..." : "Drive 履歴からジャンルを復元"}
                      </button>
                      {DEFAULT_CUSTOM_GENRES.length > 0 && (
                        <button
                          type="button"
                          onClick={handleSeedDefaultGenres}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-purple-500/50 hover:bg-zinc-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          定番ジャンル一覧を追加
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNavSection("home");
                          setSelectionMode(true);
                          setSelectedVideoIds(new Set());
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25"
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {customGenres.map((cg) => {
                        const count = videos.filter((v) =>
                          (videoGenresMap[v.id] ?? []).includes(cg.name)
                        ).length;
                        const isRenaming = renamingGenre === cg.name;
                        const selected = selectedGenres.includes(cg.name);

                        return (
                          <div
                            key={cg.name}
                            className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition ${
                              selected
                                ? "border-rose-500 bg-rose-500/15"
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
                                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-white focus:border-rose-500 focus:outline-none"
                                />
                                <button
                                  type="submit"
                                  className="rounded-lg bg-rose-600 p-1.5 text-white"
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
                                    #{cg.name}
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
                </div>
              </section>
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
                        <Clock className="h-4 w-4 text-rose-400" />
                        <h2 className="text-sm font-bold text-white">続きを見る</h2>
                      </div>
                      <div className="flex gap-4 overflow-x-auto pb-2">
                        {continueWatchingVideos.map((video) => (
                          <VideoCard
                            key={`cw-${video.id}`}
                            video={video}
                            accessToken={accessToken}
                            masterKey={masterKey}
                            genres={videoGenresMap[video.id] ?? []}
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
                      </div>
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
                          <Sparkles className="h-4 w-4 text-amber-400" />
                          <h2 className="text-sm font-bold text-white">
                            漫画 × アニメ セット（{crossMedia.sets.length} 作品）
                          </h2>
                        </div>
                        <span className="text-[11px] text-zinc-400">
                          同じ作品を 1 タップで同時視聴
                        </span>
                      </div>
                      <div className="flex gap-3.5 overflow-x-auto pb-2">
                        {crossMedia.sets.map((set) => (
                          <div
                            key={`set-${set.manga.id}`}
                            className="flex w-72 shrink-0 flex-col gap-2.5 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/[0.08] via-zinc-900/75 to-sky-500/[0.08] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-xl sm:w-80"
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
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 px-3 py-1.5 text-[11px] font-bold text-zinc-950 shadow-sm transition hover:brightness-110"
                              >
                                <Sparkles className="h-3 w-3" />
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
                      </div>
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
                        className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                      >
                        #{genre}
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25"
                        title="表示中の動画をすべてキューに入れて連続再生"
                      >
                        <Play className="h-3.5 w-3.5 fill-current" />
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
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        selectionMode
                          ? "border-rose-500 bg-rose-600 text-white"
                          : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-rose-500/50 hover:bg-zinc-800"
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
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-rose-500/50 hover:bg-zinc-800 hover:text-white"
                      title="並びを新しくシャッフル"
                    >
                      <Shuffle className="h-3.5 w-3.5 text-rose-400" />
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
                    {filteredVideos.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        genres={videoGenresMap[video.id] ?? []}
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
                    {filteredVideos.map((video) => (
                      <VideoListRow
                        key={video.id}
                        video={video}
                        accessToken={accessToken}
                        masterKey={masterKey}
                        genres={videoGenresMap[video.id] ?? []}
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
              </>
            )}
          </main>
        </div>
      )}

      {/* Floating Bulk Genre Assignment Bar */}
      {accessToken && selectionMode && (
        <div className="fixed bottom-16 left-3 right-3 z-40 mx-auto max-w-4xl rounded-2xl border border-rose-500/40 bg-zinc-950/95 p-3.5 shadow-2xl shadow-black/80 backdrop-blur-xl md:bottom-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full bg-rose-600 px-2.5 py-0.5 font-bold text-white">
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
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-40"
              >
                <ListPlus className="h-3.5 w-3.5" />
                キューに追加
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

          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2.5">
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <Tag className="h-3 w-3" />
              一括追加:
            </span>
            {customGenres.map((cg) => (
              <button
                key={`bulk-${cg.name}`}
                type="button"
                disabled={selectedVideoIds.size === 0}
                onClick={() => handleBulkAssignGenre(cg.name, "add", cg.color)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition hover:brightness-125 disabled:opacity-40 ${getGenreStyle(
                  cg.name,
                  customGenres
                )}`}
              >
                + #{cg.name}
              </button>
            ))}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!bulkNewGenreName.trim()) return;
                handleBulkAssignGenre(bulkNewGenreName, "add", "rose");
                setBulkNewGenreName("");
              }}
              className="ml-auto flex items-center gap-1.5"
            >
              <input
                type="text"
                value={bulkNewGenreName}
                onChange={(e) => setBulkNewGenreName(e.target.value)}
                placeholder="新規ジャンルで追加..."
                className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none sm:w-44"
              />
              <button
                type="submit"
                disabled={!bulkNewGenreName.trim() || selectedVideoIds.size === 0}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
              >
                適用
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation */}
      {accessToken && (!vaultConfig || masterKey) && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-zinc-800/90 bg-[#0b0b0e]/95 px-2 py-1.5 backdrop-blur-xl md:hidden">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = navSection === item.id;
            return (
              <button
                key={`mob-${item.id}`}
                type="button"
                onClick={() => setNavSection(item.id)}
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
          genres={videoGenresMap[activeVideo.id] ?? []}
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

      {/* Genre / Tag Editor Modal */}
      {editingTagsVideo && (
        <TagEditorModal
          video={editingTagsVideo}
          currentGenres={videoGenresMap[editingTagsVideo.id] ?? []}
          customGenres={customGenres}
          onToggleGenre={handleToggleVideoGenre}
          onAddCustomGenre={handleAddCustomGenreToVideo}
          onClose={() => setEditingTagsVideo(null)}
        />
      )}

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
            className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
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

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Web 用 Google OAuth クライアント ID
                </label>
                <input
                  type="text"
                  value={draftClientId}
                  onChange={(e) => setDraftClientId(e.target.value)}
                  placeholder="1234567890-xxxx.apps.googleusercontent.com"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-300">
                  Google Drive フォルダ ID（フォルダ URL をそのまま貼っても OK）
                </label>
                <input
                  type="text"
                  value={draftFolderId}
                  onChange={(e) => setDraftFolderId(e.target.value)}
                  placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz123456"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none"
                />
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
