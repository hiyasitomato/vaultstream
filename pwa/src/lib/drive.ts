import {
  base64ToUint8Array,
  decryptAesGcmBytes,
  decryptAesGcmText,
  encryptAesGcmBytes,
  encryptAesGcmText,
} from "./crypto";
import {
  clearAllThumbDbCache,
  getCachedThumbBytes,
  putCachedThumbBytes,
} from "./thumbDb";
import type {
  DriveFileEntry,
  SyncedVaultUserData,
  VaultConfig,
  VaultManifest,
  VaultVideoItem,
} from "./types";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const SYNC_FILE_NAME = "user_meta.enc";
const LIBRARY_INDEX_FILE_NAME = "library_index.enc";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

export function isValidClientId(clientId: string): boolean {
  const trimmed = clientId.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes("<") &&
    !trimmed.includes(">") &&
    !trimmed.includes("ここに") &&
    trimmed.includes(".apps.googleusercontent.com")
  );
}

let gisLoadPromise: Promise<void> | null = null;

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Browser environment required"));
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (gisLoadPromise) {
    return gisLoadPromise;
  }

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Identity Services の読み込みに失敗しました")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Google Identity Services の読み込みに失敗しました"));
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

export async function requestGoogleAccessToken(
  clientId: string,
  prompt: "" | "consent" | "select_account" = "select_account"
): Promise<{ accessToken: string; expiresAt: number }> {
  await loadGoogleIdentityScript();

  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) {
      reject(new Error("Google OAuth2 クライアントの初期化に失敗しました"));
      return;
    }

    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response: TokenResponse) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google ログインがキャンセルされました"
            )
          );
          return;
        }
        const expiresInSec = response.expires_in ?? 3500;
        resolve({
          accessToken: response.access_token,
          expiresAt: Date.now() + expiresInSec * 1000,
        });
      },
    });

    client.requestAccessToken({ prompt });
  });
}

export function revokeGoogleAccessToken(accessToken: string): void {
  try {
    window.google?.accounts?.oauth2?.revoke(accessToken);
  } catch {
    // Ignore revoke errors
  }
}

async function driveFetchJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Drive API error (${response.status}): ${body.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export async function driveFetchBytes(
  fileId: string,
  accessToken: string
): Promise<Uint8Array> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!response.ok) {
    throw new Error(`ファイルの取得に失敗しました (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function driveFetchText(
  fileId: string,
  accessToken: string
): Promise<string> {
  const bytes = await driveFetchBytes(fileId, accessToken);
  return new TextDecoder("utf-8").decode(bytes);
}

// Concurrency limiter for thumbnail network fetches to prevent browser connection congestion
let activeThumbFetches = 0;
const MAX_CONCURRENT_THUMB_FETCHES = 6;
const thumbFetchWaiters: Array<() => void> = [];

function acquireThumbSlot(): Promise<void> {
  if (activeThumbFetches < MAX_CONCURRENT_THUMB_FETCHES) {
    activeThumbFetches += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    thumbFetchWaiters.push(() => {
      activeThumbFetches += 1;
      resolve();
    });
  });
}

function releaseThumbSlot(): void {
  activeThumbFetches = Math.max(0, activeThumbFetches - 1);
  const next = thumbFetchWaiters.shift();
  if (next) next();
}

const thumbCache = new Map<string, Promise<string>>();

export function clearThumbnailCache(clearDisk = false): void {
  for (const promise of thumbCache.values()) {
    promise.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  thumbCache.clear();
  if (clearDisk) {
    clearAllThumbDbCache().catch(() => undefined);
  }
}

export function driveFetchCachedThumbnailUrl(
  fileId: string,
  accessToken: string,
  encrypted = false,
  masterKey: CryptoKey | null = null,
  modifiedTime?: string
): Promise<string> {
  const key = `${fileId}:${encrypted ? "enc" : "raw"}`;
  const existing = thumbCache.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    // L2: Fast local IndexedDB encrypted-bytes cache (zero network!)
    let bytes = await getCachedThumbBytes(fileId, modifiedTime);

    if (!bytes) {
      await acquireThumbSlot();
      try {
        bytes = await driveFetchBytes(fileId, accessToken);
      } finally {
        releaseThumbSlot();
      }
      // Persist raw (encrypted) bytes to IndexedDB for instant future loads
      putCachedThumbBytes(fileId, bytes, modifiedTime ?? "").catch(() => undefined);
    }

    if (encrypted) {
      if (!masterKey) {
        throw new Error("暗号化サムネイルの復号鍵がありません");
      }
      const plain = await decryptAesGcmBytes(bytes, masterKey);
      const buffer = plain.buffer.slice(
        plain.byteOffset,
        plain.byteOffset + plain.byteLength
      ) as ArrayBuffer;
      return URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
    }

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
  })().catch((err) => {
    thumbCache.delete(key);
    throw err;
  });

  thumbCache.set(key, promise);
  return promise;
}

export async function updateThumbnailInDrive(
  thumbnailFileId: string,
  jpegBytes: Uint8Array,
  accessToken: string,
  encrypted: boolean,
  masterKey: CryptoKey | null
): Promise<string> {
  let uploadBytes: Uint8Array = jpegBytes;
  if (encrypted) {
    if (!masterKey) {
      throw new Error("暗号化鍵がありません");
    }
    uploadBytes = await encryptAesGcmBytes(jpegBytes, masterKey);
  }

  const uploadBuffer = uploadBytes.buffer.slice(
    uploadBytes.byteOffset,
    uploadBytes.byteOffset + uploadBytes.byteLength
  ) as ArrayBuffer;

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(thumbnailFileId)}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": encrypted ? "application/octet-stream" : "image/jpeg",
      },
      body: uploadBuffer,
    }
  );

  if (response.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!response.ok) {
    throw new Error(`サムネイルの保存に失敗しました (${response.status})`);
  }

  // Update both IndexedDB and in-memory cache immediately
  await putCachedThumbBytes(thumbnailFileId, uploadBytes, new Date().toISOString());

  const key = `${thumbnailFileId}:${encrypted ? "enc" : "raw"}`;
  const oldPromise = thumbCache.get(key);
  if (oldPromise) {
    oldPromise.then((oldUrl) => URL.revokeObjectURL(oldUrl)).catch(() => undefined);
  }
  const jpegBuffer = jpegBytes.buffer.slice(
    jpegBytes.byteOffset,
    jpegBytes.byteOffset + jpegBytes.byteLength
  ) as ArrayBuffer;
  const freshUrl = URL.createObjectURL(new Blob([jpegBuffer], { type: "image/jpeg" }));
  thumbCache.set(key, Promise.resolve(freshUrl));
  return freshUrl;
}

export async function driveFetchBlobUrl(
  fileId: string,
  accessToken: string
): Promise<string> {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!response.ok) {
    throw new Error(`メディアの取得に失敗しました (${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

async function listFolderChildren(
  folderId: string,
  accessToken: string
): Promise<DriveFileEntry[]> {
  const entries: DriveFileEntry[] = [];
  let pageToken: string | undefined;

  do {
    const query = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q: query,
      fields: "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)",
      pageSize: "200",
      orderBy: "createdTime desc",
    });
    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const data = await driveFetchJson<{
      files?: DriveFileEntry[];
      nextPageToken?: string;
    }>(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken);

    if (data.files) {
      entries.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return entries;
}

async function uploadOrUpdateBinaryFile(
  rootFolderId: string,
  fileName: string,
  payloadBytes: Uint8Array,
  accessToken: string,
  existingFileId: string | null
): Promise<string> {
  const payloadBuffer = payloadBytes.buffer.slice(
    payloadBytes.byteOffset,
    payloadBytes.byteOffset + payloadBytes.byteLength
  ) as ArrayBuffer;

  if (existingFileId) {
    const response = await fetch(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFileId)}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: payloadBuffer,
      }
    );
    if (response.status === 401) throw new Error("AUTH_EXPIRED");
    if (!response.ok) {
      throw new Error(`同期保存に失敗しました (${response.status})`);
    }
    return existingFileId;
  }

  const boundary = "vaultstream_boundary_" + Date.now();
  const metadataPart = JSON.stringify({
    name: fileName,
    parents: [rootFolderId],
    mimeType: "application/octet-stream",
  });

  const enc = new TextEncoder();
  const preamble = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`
  );
  const epilogue = enc.encode(`\r\n--${boundary}--`);
  const bodyBlob = new Blob([preamble, payloadBuffer, epilogue]);

  const response = await fetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: bodyBlob,
  });
  if (response.status === 401) throw new Error("AUTH_EXPIRED");
  if (!response.ok) {
    throw new Error(`同期ファイルの作成に失敗しました (${response.status})`);
  }
  const created = (await response.json()) as { id: string };
  return created.id;
}

export interface RootFolderSnapshot {
  entries: DriveFileEntry[];
  vaultConfig: VaultConfig | null;
  syncFileId: string | null;
  libraryIndexFileId: string | null;
}

export async function inspectVaultRoot(
  rootFolderId: string,
  accessToken: string
): Promise<RootFolderSnapshot> {
  const entries = await listFolderChildren(rootFolderId, accessToken);
  const configFile = entries.find((f) => f.name === "vault.json");
  const syncFile = entries.find((f) => f.name === SYNC_FILE_NAME);
  const indexFile = entries.find((f) => f.name === LIBRARY_INDEX_FILE_NAME);

  let vaultConfig: VaultConfig | null = null;
  if (configFile) {
    const raw = await driveFetchText(configFile.id, accessToken);
    vaultConfig = JSON.parse(raw) as VaultConfig;
  }

  return {
    entries,
    vaultConfig,
    syncFileId: syncFile?.id ?? null,
    libraryIndexFileId: indexFile?.id ?? null,
  };
}

export async function loadSyncedUserDataFromDrive(
  syncFileId: string | null,
  accessToken: string,
  masterKey: CryptoKey | null
): Promise<SyncedVaultUserData | null> {
  if (!syncFileId) return null;
  try {
    const rawBytes = await driveFetchBytes(syncFileId, accessToken);
    const jsonText = masterKey
      ? await decryptAesGcmText(rawBytes, masterKey)
      : new TextDecoder("utf-8").decode(rawBytes);
    return JSON.parse(jsonText) as SyncedVaultUserData;
  } catch (err) {
    if (err instanceof Error && err.message === "AUTH_EXPIRED") {
      throw err;
    }
    return null;
  }
}

export async function saveSyncedUserDataToDrive(
  rootFolderId: string,
  accessToken: string,
  masterKey: CryptoKey | null,
  data: SyncedVaultUserData,
  existingFileId: string | null
): Promise<string> {
  const jsonText = JSON.stringify(data);
  const payloadBytes = masterKey
    ? await encryptAesGcmText(jsonText, masterKey)
    : new TextEncoder().encode(jsonText);
  return uploadOrUpdateBinaryFile(
    rootFolderId,
    SYNC_FILE_NAME,
    payloadBytes,
    accessToken,
    existingFileId
  );
}

interface EncryptedLibraryIndex {
  version: number;
  updatedAt: number;
  items: VaultVideoItem[];
}

async function readLibraryIndex(
  indexFileId: string,
  accessToken: string,
  masterKey: CryptoKey | null
): Promise<VaultVideoItem[] | null> {
  try {
    const rawBytes = await driveFetchBytes(indexFileId, accessToken);
    const jsonText = masterKey
      ? await decryptAesGcmText(rawBytes, masterKey)
      : new TextDecoder("utf-8").decode(rawBytes);
    const parsed = JSON.parse(jsonText) as EncryptedLibraryIndex;
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

async function writeLibraryIndex(
  rootFolderId: string,
  items: VaultVideoItem[],
  accessToken: string,
  masterKey: CryptoKey | null,
  existingIndexFileId: string | null
): Promise<void> {
  try {
    const payload: EncryptedLibraryIndex = {
      version: 1,
      updatedAt: Date.now(),
      items,
    };
    const jsonText = JSON.stringify(payload);
    const bytes = masterKey
      ? await encryptAesGcmText(jsonText, masterKey)
      : new TextEncoder().encode(jsonText);
    await uploadOrUpdateBinaryFile(
      rootFolderId,
      LIBRARY_INDEX_FILE_NAME,
      bytes,
      accessToken,
      existingIndexFileId
    );
  } catch {
    // Index caching is a best-effort speed optimization; ignore write failures
  }
}

export async function fetchVaultVideosFast(
  rootFolderId: string,
  rootSnapshot: RootFolderSnapshot,
  accessToken: string,
  masterKey: CryptoKey | null = null,
  forceFullScan = false
): Promise<VaultVideoItem[]> {
  const folders = rootSnapshot.entries.filter(
    (entry) => entry.mimeType === "application/vnd.google-apps.folder"
  );
  const directVideos = rootSnapshot.entries.filter((entry) =>
    entry.mimeType.startsWith("video/")
  );

  // Step 1: Load single-file encrypted library index if available (saves ~80+ API calls!)
  const indexedByFolderId = new Map<string, VaultVideoItem>();
  if (!forceFullScan && rootSnapshot.libraryIndexFileId) {
    const indexedItems = await readLibraryIndex(
      rootSnapshot.libraryIndexFileId,
      accessToken,
      masterKey
    );
    if (indexedItems) {
      for (const item of indexedItems) {
        if (item.folderId && item.kind === "hls") {
          indexedByFolderId.set(item.folderId, item);
        }
      }
    }
  }

  // Step 2: Only fetch folders that are NOT yet in the encrypted index!
  const missingFolders = folders.filter((f) => !indexedByFolderId.has(f.id));
  const fetchedNewItems: VaultVideoItem[] = [];

  const CONCURRENCY = 10;
  for (let i = 0; i < missingFolders.length; i += CONCURRENCY) {
    const batch = missingFolders.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (folder): Promise<VaultVideoItem | null> => {
        try {
          const files = await listFolderChildren(folder.id, accessToken);
          const encManifestFile = files.find((f) => f.name === "m.enc");
          const plainManifestFile = files.find((f) => f.name === "manifest.json");

          let manifest: VaultManifest | null = null;
          let isEncrypted = false;

          if (encManifestFile && masterKey) {
            const rawBytes = await driveFetchBytes(encManifestFile.id, accessToken);
            const jsonText = await decryptAesGcmText(rawBytes, masterKey);
            manifest = JSON.parse(jsonText) as VaultManifest;
            isEncrypted = true;
          } else if (plainManifestFile) {
            const raw = await driveFetchText(plainManifestFile.id, accessToken);
            manifest = JSON.parse(raw) as VaultManifest;
            isEncrypted = Boolean(manifest.encrypted);
          } else {
            return null;
          }

          if (!manifest?.playlistFileId) {
            return null;
          }

          const segments: Record<string, string> = { ...(manifest.segments ?? {}) };
          for (const f of files) {
            if (
              (f.name.endsWith(".ts") ||
                f.name.endsWith(".m4s") ||
                /^\d{4}\.enc$/.test(f.name)) &&
              !segments[f.name]
            ) {
              segments[f.name] = f.id;
            }
          }

          const thumbEntry = files.find((f) =>
            isEncrypted
              ? f.name === "t.enc"
              : f.name === "thumbnail.jpg" || f.name === "thumb.jpg"
          );
          const thumbFileId = manifest.thumbnailFileId || thumbEntry?.id;
          const spriteEntry = files.find((f) =>
            isEncrypted ? f.name === "s.enc" : f.name === "sprite.jpg"
          );

          return {
            id: manifest.id || folder.id,
            folderId: folder.id,
            title: manifest.title || folder.name,
            createdAt: manifest.createdAt || folder.createdTime || new Date().toISOString(),
            duration: manifest.duration ?? 0,
            width: manifest.width,
            height: manifest.height,
            sizeBytes: manifest.sizeBytes,
            kind: "hls",
            encrypted: isEncrypted,
            manifest: {
              ...manifest,
              encrypted: isEncrypted,
              segments,
              thumbnailFileId: thumbFileId,
            },
            thumbnailFileId: thumbFileId,
            thumbnailModifiedTime: thumbEntry?.modifiedTime,
            spriteFileId: spriteEntry?.id,
            sourceFileName: manifest.sourceFileName || folder.name,
          };
        } catch (error) {
          if (error instanceof Error && error.message === "AUTH_EXPIRED") {
            throw error;
          }
          return null;
        }
      })
    );
    for (const item of batchResults) {
      if (item) fetchedNewItems.push(item);
    }
  }

  const activeFolderIds = new Set(folders.map((f) => f.id));
  const keptIndexedItems = Array.from(indexedByFolderId.values()).filter((item) =>
    activeFolderIds.has(item.folderId)
  );
  const allPackagedItems = [...keptIndexedItems, ...fetchedNewItems];

  // Step 3: If anything changed (new/deleted folders or first build), update library_index.enc in background
  const indexChanged =
    forceFullScan ||
    !rootSnapshot.libraryIndexFileId ||
    missingFolders.length > 0 ||
    keptIndexedItems.length !== indexedByFolderId.size;

  if (indexChanged && allPackagedItems.length > 0) {
    writeLibraryIndex(
      rootFolderId,
      allPackagedItems,
      accessToken,
      masterKey,
      rootSnapshot.libraryIndexFileId
    ).catch(() => undefined);
  }

  const directItems: VaultVideoItem[] = directVideos.map((file) => ({
    id: file.id,
    folderId: rootFolderId,
    title: file.name.replace(/\.[^.]+$/, ""),
    createdAt: file.createdTime || new Date().toISOString(),
    duration: 0,
    sizeBytes: file.size ? Number(file.size) : undefined,
    kind: "direct",
    encrypted: false,
    directFileId: file.id,
    mimeType: file.mimeType,
    sourceFileName: file.name,
  }));

  return [...allPackagedItems, ...directItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function buildDriveMediaUrl(fileId: string): string {
  return `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;
}

export function getSegmentUrlForTime(
  manifest: VaultManifest | undefined,
  durationSec: number,
  targetTimeSec = 0
): string | null {
  if (!manifest) return null;
  // Prefer lightweight variant segment for fastest hover prefetch when available
  const segMap =
    manifest.variants && manifest.variants.length > 0
      ? manifest.variants[0].segments
      : manifest.segments;
  if (!segMap) return null;
  const names = Object.keys(segMap).sort();
  if (names.length === 0) return null;

  let index = 0;
  if (targetTimeSec > 0 && durationSec > 0) {
    const ratio = Math.min(0.999, Math.max(0, targetTimeSec / durationSec));
    index = Math.min(names.length - 1, Math.floor(ratio * names.length));
  }
  const fileId = segMap[names[index]];
  return fileId ? buildDriveMediaUrl(fileId) : null;
}

// In-memory decrypted playlist text cache for instant replay / next-video prefetch
const playlistTextCache = new Map<string, Promise<string>>();

export function prefetchHlsPlaylist(
  manifest: VaultManifest,
  accessToken: string,
  masterKey: CryptoKey | null = null
): void {
  const key = manifest.playlistFileId;
  if (playlistTextCache.has(key)) return;
  const promise = (async () => {
    if (manifest.encrypted) {
      if (!masterKey) throw new Error("NO_KEY");
      const encBytes = await driveFetchBytes(manifest.playlistFileId, accessToken);
      return decryptAesGcmText(encBytes, masterKey);
    }
    return driveFetchText(manifest.playlistFileId, accessToken);
  })().catch((err) => {
    playlistTextCache.delete(key);
    throw err;
  });
  playlistTextCache.set(key, promise);
}

export interface SegmentTimelineEntry {
  index: number;
  startSec: number;
  endSec: number;
  url: string;
}

export interface BuiltHlsSource {
  playlistUrl: string;
  objectUrlsToRevoke: string[];
  timeline: SegmentTimelineEntry[];
  renditionTimelines: SegmentTimelineEntry[][];
  qualityLabels: string[];
}

async function fetchDecryptedPlaylistText(
  playlistFileId: string,
  encrypted: boolean,
  accessToken: string,
  masterKey: CryptoKey | null
): Promise<string> {
  const existing = playlistTextCache.get(playlistFileId);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    if (encrypted) {
      if (!masterKey) throw new Error("Vault のロックを解除してください");
      const encBytes = await driveFetchBytes(playlistFileId, accessToken);
      return decryptAesGcmText(encBytes, masterKey);
    }
    return driveFetchText(playlistFileId, accessToken);
  })().catch((err) => {
    playlistTextCache.delete(playlistFileId);
    throw err;
  });
  playlistTextCache.set(playlistFileId, promise);
  return promise;
}

function rewriteSingleMediaPlaylist(
  playlistText: string,
  segments: Record<string, string>,
  hlsKeyBase64: string | undefined,
  objectUrlsToRevoke: string[]
): { mediaPlaylistUrl: string; timeline: SegmentTimelineEntry[] } {
  let keyUrl: string | undefined;
  if (hlsKeyBase64) {
    const keyBytes = base64ToUint8Array(hlsKeyBase64);
    const keyBuffer = keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength
    ) as ArrayBuffer;
    keyUrl = URL.createObjectURL(
      new Blob([keyBuffer], { type: "application/octet-stream" })
    );
    objectUrlsToRevoke.push(keyUrl);
  }

  const timeline: SegmentTimelineEntry[] = [];
  let cursorSec = 0;
  let pendingDuration = 0;

  const rewrittenLines = playlistText.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#EXT-X-KEY:") && keyUrl) {
      return line.replace(/URI="[^"]*"/, `URI="${keyUrl}"`);
    }
    if (trimmed.startsWith("#EXTINF:")) {
      const match = trimmed.match(/^#EXTINF:([0-9.]+)/);
      if (match) {
        pendingDuration = Number(match[1]) || 0;
      }
      return line;
    }
    if (trimmed.startsWith("#")) {
      return line;
    }
    const cleanName = trimmed.split("?")[0].split("/").pop() ?? trimmed;
    const segmentFileId = segments[trimmed] ?? segments[cleanName];
    if (!segmentFileId) {
      return line;
    }
    const segUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(segmentFileId)}?alt=media`;
    const dur = pendingDuration > 0 ? pendingDuration : 10;
    timeline.push({
      index: timeline.length,
      startSec: cursorSec,
      endSec: cursorSec + dur,
      url: segUrl,
    });
    cursorSec += dur;
    pendingDuration = 0;
    return segUrl;
  });

  const mediaPlaylistUrl = URL.createObjectURL(
    new Blob([rewrittenLines.join("\n")], {
      type: "application/vnd.apple.mpegurl",
    })
  );
  objectUrlsToRevoke.push(mediaPlaylistUrl);
  return { mediaPlaylistUrl, timeline };
}

export async function buildRewrittenHlsPlaylist(
  manifest: VaultManifest,
  accessToken: string,
  masterKey: CryptoKey | null = null
): Promise<BuiltHlsSource> {
  const objectUrlsToRevoke: string[] = [];
  const encrypted = Boolean(manifest.encrypted);

  // Multi-bitrate ABR mode (e.g., 360p fast-start + original 1080p/720p)
  if (manifest.variants && manifest.variants.length > 0) {
    const origHeight = manifest.height || 1080;
    const origWidth = manifest.width || 1920;
    const origBandwidth =
      manifest.sizeBytes && manifest.duration > 0
        ? Math.max(1_500_000, Math.round((manifest.sizeBytes * 8) / manifest.duration))
        : 4_500_000;

    const allRenditions = [
      ...manifest.variants.map((v) => ({
        label: v.label,
        width: v.width,
        height: v.height,
        bandwidth: v.bandwidth,
        playlistFileId: v.playlistFileId,
        hlsKeyBase64: v.hlsKeyBase64,
        segments: v.segments,
      })),
      {
        label: `${origHeight}p (高画質)`,
        width: origWidth,
        height: origHeight,
        bandwidth: origBandwidth,
        playlistFileId: manifest.playlistFileId,
        hlsKeyBase64: manifest.hlsKeyBase64,
        segments: manifest.segments,
      },
    ].sort((a, b) => a.bandwidth - b.bandwidth);

    const texts = await Promise.all(
      allRenditions.map((r) =>
        fetchDecryptedPlaylistText(r.playlistFileId, encrypted, accessToken, masterKey)
      )
    );

    const masterLines: string[] = ["#EXTM3U", "#EXT-X-VERSION:3"];
    const renditionTimelines: SegmentTimelineEntry[][] = [];

    allRenditions.forEach((rendition, idx) => {
      const { mediaPlaylistUrl, timeline } = rewriteSingleMediaPlaylist(
        texts[idx],
        rendition.segments,
        rendition.hlsKeyBase64,
        objectUrlsToRevoke
      );
      renditionTimelines.push(timeline);
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.width}x${rendition.height}`
      );
      masterLines.push(mediaPlaylistUrl);
    });

    const masterUrl = URL.createObjectURL(
      new Blob([masterLines.join("\n")], {
        type: "application/vnd.apple.mpegurl",
      })
    );
    objectUrlsToRevoke.push(masterUrl);

    return {
      playlistUrl: masterUrl,
      objectUrlsToRevoke,
      timeline: renditionTimelines[renditionTimelines.length - 1] ?? [],
      renditionTimelines,
      qualityLabels: allRenditions.map((r) => r.label),
    };
  }

  // Single-rendition mode
  const playlistText = await fetchDecryptedPlaylistText(
    manifest.playlistFileId,
    encrypted,
    accessToken,
    masterKey
  );
  const { mediaPlaylistUrl, timeline } = rewriteSingleMediaPlaylist(
    playlistText,
    manifest.segments,
    manifest.hlsKeyBase64,
    objectUrlsToRevoke
  );

  return {
    playlistUrl: mediaPlaylistUrl,
    objectUrlsToRevoke,
    timeline,
    renditionTimelines: [timeline],
    qualityLabels: [manifest.height ? `${manifest.height}p` : "オリジナル"],
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--:--";
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
