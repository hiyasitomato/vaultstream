import { DEFAULT_CUSTOM_GENRES } from "./genres";
import {
  clearCachedLibraryFromDb,
  loadCachedLibraryFromDb,
  saveCachedLibraryToDb,
} from "./thumbDb";
import type {
  CustomGenreDef,
  PlaybackProgress,
  SyncedVaultUserData,
  VaultConfig,
  VideoUserMeta,
} from "./types";

const PROGRESS_KEY = "vaultstream:progress:v1";
const USER_DATA_KEY = "vaultstream:user_data:v2";
const LEGACY_USER_META_KEY = "vaultstream:user_meta:v1";
const LEGACY_CUSTOM_GENRES_KEY = "vaultstream:custom_genres:v1";
const AUTH_SESSION_KEY = "vaultstream:auth_session:v2";
const SAVED_PASSPHRASE_KEY = "vaultstream:passphrase:v1";
const VIDEO_LIST_CACHE_PREFIX = "vaultstream:video_list_cache:v1:";
const VAULT_CONFIG_CACHE_PREFIX = "vaultstream:vault_cfg:v1:";
const CLIENT_ID_OVERRIDE_KEY = "vaultstream:client_id_override";
const FOLDER_ID_OVERRIDE_KEY = "vaultstream:folder_id_override";

export function loadCachedVaultConfig(folderId: string): VaultConfig | null {
  if (typeof window === "undefined" || !folderId) return null;
  try {
    const raw = window.localStorage.getItem(`${VAULT_CONFIG_CACHE_PREFIX}${folderId}`);
    if (!raw) return null;
    return JSON.parse(raw) as VaultConfig;
  } catch {
    return null;
  }
}

export function saveCachedVaultConfig(folderId: string, cfg: VaultConfig | null): void {
  if (typeof window === "undefined" || !folderId) return;
  try {
    if (!cfg) {
      window.localStorage.removeItem(`${VAULT_CONFIG_CACHE_PREFIX}${folderId}`);
    } else {
      window.localStorage.setItem(
        `${VAULT_CONFIG_CACHE_PREFIX}${folderId}`,
        JSON.stringify(cfg)
      );
    }
  } catch {
    // Ignore storage quota
  }
}

export function clearCachedVaultConfig(folderId: string): void {
  if (typeof window === "undefined" || !folderId) return;
  try {
    window.localStorage.removeItem(`${VAULT_CONFIG_CACHE_PREFIX}${folderId}`);
  } catch {
    // Ignore
  }
}

function purgeLegacyLocalStorageVideoCaches(): void {
  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(VIDEO_LIST_CACHE_PREFIX)) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // Ignore
  }
}

export function loadCachedVideoList(folderId: string): unknown[] | null {
  if (typeof window === "undefined" || !folderId) return null;
  try {
    const raw = window.localStorage.getItem(`${VIDEO_LIST_CACHE_PREFIX}${folderId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadCachedVideoListAsync<T>(folderId: string): Promise<T[] | null> {
  if (!folderId) return null;
  const fromDb = await loadCachedLibraryFromDb<T>(folderId);
  if (fromDb && fromDb.length > 0) {
    purgeLegacyLocalStorageVideoCaches();
    return fromDb;
  }
  // One-time seamless migration if a legacy localStorage cache exists
  const legacy = loadCachedVideoList(folderId) as T[] | null;
  if (legacy && legacy.length > 0) {
    saveCachedLibraryToDb(folderId, legacy).catch(() => undefined);
    purgeLegacyLocalStorageVideoCaches();
    return legacy;
  }
  purgeLegacyLocalStorageVideoCaches();
  return null;
}

export function saveCachedVideoList(folderId: string, items: unknown[]): void {
  if (!folderId) return;
  purgeLegacyLocalStorageVideoCaches();
  saveCachedLibraryToDb(folderId, items).catch(() => undefined);
}

export function clearCachedVideoList(folderId: string): void {
  if (!folderId) return;
  purgeLegacyLocalStorageVideoCaches();
  clearCachedLibraryFromDb(folderId).catch(() => undefined);
}

export interface SavedAuthSession {
  accessToken: string;
  expiresAt: number;
}

export function loadSavedPassphrase(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SAVED_PASSPHRASE_KEY) ?? "";
}

export function savePassphrase(passphrase: string): void {
  if (typeof window === "undefined") return;
  if (!passphrase) {
    window.localStorage.removeItem(SAVED_PASSPHRASE_KEY);
  } else {
    window.localStorage.setItem(SAVED_PASSPHRASE_KEY, passphrase);
  }
}

export function clearSavedPassphrase(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SAVED_PASSPHRASE_KEY);
}

export function loadAuthSession(): SavedAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedAuthSession;
    if (
      parsed.accessToken &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() + 60_000
    ) {
      return parsed;
    }
    window.localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  } catch {
    return null;
  }
}

export function saveAuthSession(accessToken: string, expiresAt: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({ accessToken, expiresAt })
    );
  } catch {
    // Ignore
  }
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}

export function loadAllProgress(): Record<string, PlaybackProgress> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlaybackProgress>;
  } catch {
    return {};
  }
}

export function saveAllProgress(all: Record<string, PlaybackProgress>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // Ignore
  }
}

export function mergeProgressMaps(
  localMap: Record<string, PlaybackProgress>,
  remoteMap: Record<string, PlaybackProgress> | undefined
): Record<string, PlaybackProgress> {
  if (!remoteMap) return { ...localMap };
  const merged: Record<string, PlaybackProgress> = { ...localMap };
  for (const [vid, remote] of Object.entries(remoteMap)) {
    const local = merged[vid];
    if (!local || (remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
      merged[vid] = {
        ...remote,
        playCount: Math.max(local?.playCount ?? 0, remote.playCount ?? 0),
      };
    } else {
      merged[vid] = {
        ...local,
        playCount: Math.max(local.playCount ?? 0, remote.playCount ?? 0),
      };
    }
  }
  return merged;
}

export function saveVideoProgress(
  videoId: string,
  currentTime: number,
  duration: number,
  incrementPlayCount = false
): PlaybackProgress {
  const all = loadAllProgress();
  const prev = all[videoId];
  const next: PlaybackProgress = {
    currentTime: Number.isFinite(currentTime) ? currentTime : prev?.currentTime ?? 0,
    duration: Number.isFinite(duration) && duration > 0 ? duration : prev?.duration ?? 0,
    updatedAt: Date.now(),
    playCount: (prev?.playCount ?? 0) + (incrementPlayCount ? 1 : 0),
  };
  if (typeof window !== "undefined") {
    try {
      all[videoId] = next;
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
    } catch {
      // Ignore
    }
  }
  return next;
}

export function createDefaultUserData(): SyncedVaultUserData {
  return {
    version: 1,
    updatedAt: 0,
    useAutoGenres: false,
    customGenres: DEFAULT_CUSTOM_GENRES.map((g) => ({ ...g })),
    videoMeta: {},
  };
}

export function loadLocalUserData(): SyncedVaultUserData {
  if (typeof window === "undefined") return createDefaultUserData();
  try {
    const raw = window.localStorage.getItem(USER_DATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncedVaultUserData>;
      return {
        version: 1,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
        customGenresUpdatedAt:
          typeof parsed.customGenresUpdatedAt === "number"
            ? parsed.customGenresUpdatedAt
            : undefined,
        useAutoGenres: Boolean(parsed.useAutoGenres),
        customGenres: Array.isArray(parsed.customGenres) ? parsed.customGenres : [],
        videoMeta: parsed.videoMeta && typeof parsed.videoMeta === "object" ? parsed.videoMeta : {},
        progress: parsed.progress && typeof parsed.progress === "object" ? parsed.progress : undefined,
      };
    }

    // Migrate legacy v1 data if present
    const legacyMetaRaw = window.localStorage.getItem(LEGACY_USER_META_KEY);
    const legacyGenresRaw = window.localStorage.getItem(LEGACY_CUSTOM_GENRES_KEY);
    const videoMeta: Record<string, VideoUserMeta> = legacyMetaRaw
      ? (JSON.parse(legacyMetaRaw) as Record<string, VideoUserMeta>)
      : {};
    const customGenres: CustomGenreDef[] = legacyGenresRaw
      ? (JSON.parse(legacyGenresRaw) as string[])
          .filter((x) => typeof x === "string")
          .map((name) => ({ name, color: "rose" }))
      : [];

    return {
      version: 1,
      updatedAt: legacyMetaRaw || legacyGenresRaw ? Date.now() : 0,
      useAutoGenres: false,
      customGenres,
      videoMeta,
    };
  } catch {
    return createDefaultUserData();
  }
}

export function mergeSyncedUserData(
  local: SyncedVaultUserData,
  remote: SyncedVaultUserData
): SyncedVaultUserData {
  const localGlobalTs = local.updatedAt || 0;
  const remoteGlobalTs = remote.updatedAt || 0;
  const preferRemoteGlobal = remoteGlobalTs >= localGlobalTs;

  // 1. Per-video metadata merge (prevents losing recent tags/favorites on refresh or concurrent upload sync!)
  const mergedVideoMeta: Record<string, VideoUserMeta> = {};
  const allVideoIds = new Set<string>([
    ...Object.keys(local.videoMeta ?? {}),
    ...Object.keys(remote.videoMeta ?? {}),
  ]);

  for (const vid of allVideoIds) {
    const lMeta = local.videoMeta?.[vid];
    const rMeta = remote.videoMeta?.[vid];
    if (lMeta && !rMeta) {
      mergedVideoMeta[vid] = { ...lMeta };
      continue;
    }
    if (rMeta && !lMeta) {
      mergedVideoMeta[vid] = { ...rMeta };
      continue;
    }
    if (!lMeta || !rMeta) continue;

    const lTs = lMeta.updatedAt ?? 0;
    const rTs = rMeta.updatedAt ?? 0;
    const pickLocal =
      lTs > 0 || rTs > 0 ? lTs >= rTs : !preferRemoteGlobal;
    const primary = pickLocal ? lMeta : rMeta;
    const secondary = pickLocal ? rMeta : lMeta;

    mergedVideoMeta[vid] = {
      ...primary,
      thumbnailTimeSec: primary.thumbnailTimeSec ?? secondary.thumbnailTimeSec,
      thumbnailUpdatedAt: primary.thumbnailUpdatedAt ?? secondary.thumbnailUpdatedAt,
      updatedAt: Math.max(lTs, rTs) || undefined,
    };
  }

  // 2. Custom genres merge: respect explicit customGenresUpdatedAt when present, otherwise newest non-empty list
  const lGenresTs = local.customGenresUpdatedAt ?? 0;
  const rGenresTs = remote.customGenresUpdatedAt ?? 0;
  let mergedCustomGenres: CustomGenreDef[];
  if (lGenresTs > 0 || rGenresTs > 0) {
    mergedCustomGenres =
      lGenresTs >= rGenresTs ? [...(local.customGenres ?? [])] : [...(remote.customGenres ?? [])];
  } else {
    const primaryGenres = preferRemoteGlobal
      ? remote.customGenres ?? []
      : local.customGenres ?? [];
    const secondaryGenres = preferRemoteGlobal
      ? local.customGenres ?? []
      : remote.customGenres ?? [];
    mergedCustomGenres =
      primaryGenres.length > 0 ? [...primaryGenres] : [...secondaryGenres];
  }

  // 3. Progress merge (already per-video newest timestamp)
  const mergedProgress = mergeProgressMaps(local.progress ?? {}, remote.progress);

  return {
    version: 1,
    updatedAt: Math.max(localGlobalTs, remoteGlobalTs),
    customGenresUpdatedAt: Math.max(lGenresTs, rGenresTs) || undefined,
    useAutoGenres: preferRemoteGlobal ? remote.useAutoGenres : local.useAutoGenres,
    customGenres: mergedCustomGenres,
    videoMeta: mergedVideoMeta,
    progress: mergedProgress,
  };
}

export function saveLocalUserData(data: SyncedVaultUserData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_DATA_KEY, JSON.stringify(data));
  } catch {
    // Ignore
  }
}

export function getSavedClientIdOverride(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CLIENT_ID_OVERRIDE_KEY) ?? "";
}

export function setSavedClientIdOverride(value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(CLIENT_ID_OVERRIDE_KEY);
  } else {
    window.localStorage.setItem(CLIENT_ID_OVERRIDE_KEY, trimmed);
  }
}

export function getSavedFolderIdOverride(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(FOLDER_ID_OVERRIDE_KEY) ?? "";
}

export function setSavedFolderIdOverride(value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(FOLDER_ID_OVERRIDE_KEY);
  } else {
    window.localStorage.setItem(FOLDER_ID_OVERRIDE_KEY, trimmed);
  }
}
