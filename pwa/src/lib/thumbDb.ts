const DB_NAME = "vaultstream_enc_cache_v1";
const DB_VERSION = 3;
const THUMB_STORE = "thumbs";
const THUMB_META_STORE = "thumb_meta";
const PLAYLIST_STORE = "playlists";
const SEGMENT_STORE = "segments";
const SEGMENT_META_STORE = "segment_meta";

const CACHE_LIMIT_STORAGE_KEY = "vaultstream_disk_cache_limit_mb";
export const DISK_CACHE_PRESETS_MB = [3072, 6144, 12288, 24576, 49152, 65536] as const;
const DEFAULT_DISK_CACHE_LIMIT_MB = 12288; // Default 12 GB persistent iPad/browser cache
const MAX_DISK_SEGMENT_COUNT = 120000;

interface CachedThumbRecord {
  key: string;
  modifiedTime: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

interface CachedPlaylistRecord {
  key: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

interface CachedSegmentRecord {
  key: string;
  bytes: ArrayBuffer;
  size: number;
  savedAt: number;
}

interface CachedMetaRecord {
  key: string;
  size: number;
  savedAt: number;
}

export interface DiskCacheStats {
  thumbCount: number;
  playlistCount: number;
  segmentCount: number;
  segmentBytes: number;
  totalBytes: number;
  limitBytes: number;
  quotaBytes: number | null;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let segmentWritesSinceTrim = 0;
let v2MetaBackfilled = false;

export function getDiskCacheLimitMb(): number {
  if (typeof window === "undefined") return DEFAULT_DISK_CACHE_LIMIT_MB;
  try {
    const raw = window.localStorage.getItem(CACHE_LIMIT_STORAGE_KEY);
    if (!raw) return DEFAULT_DISK_CACHE_LIMIT_MB;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 512 && parsed <= 131072) {
      return Math.round(parsed);
    }
  } catch {
    // Ignore storage read errors
  }
  return DEFAULT_DISK_CACHE_LIMIT_MB;
}

export function getDiskCacheLimitBytes(): number {
  return getDiskCacheLimitMb() * 1024 * 1024;
}

export async function setDiskCacheLimitMb(limitMb: number): Promise<void> {
  const clamped = Math.max(512, Math.min(131072, Math.round(limitMb)));
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CACHE_LIMIT_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore storage write errors
    }
  }
  const db = await openDb();
  if (db) {
    await trimSegmentDiskCache(db, clamped * 1024 * 1024).catch(() => undefined);
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(THUMB_STORE)) {
          db.createObjectStore(THUMB_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(THUMB_META_STORE)) {
          db.createObjectStore(THUMB_META_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(PLAYLIST_STORE)) {
          db.createObjectStore(PLAYLIST_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(SEGMENT_STORE)) {
          const segStore = db.createObjectStore(SEGMENT_STORE, { keyPath: "key" });
          segStore.createIndex("savedAt", "savedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(SEGMENT_META_STORE)) {
          const metaStore = db.createObjectStore(SEGMENT_META_STORE, { keyPath: "key" });
          metaStore.createIndex("savedAt", "savedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

async function getBrowserStorageQuota(): Promise<number | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    return typeof est.quota === "number" && est.quota > 0 ? est.quota : null;
  } catch {
    return null;
  }
}

// One-time migration for caches created before DB v3 (populates lightweight meta stores without keeping blobs in RAM)
async function ensureMetaBackfilled(db: IDBDatabase): Promise<void> {
  if (v2MetaBackfilled) return;
  v2MetaBackfilled = true;

  const countStore = (name: string): Promise<number> =>
    new Promise((resolve) => {
      try {
        const tx = db.transaction(name, "readonly");
        const req = tx.objectStore(name).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });

  const [segCount, segMetaCount, thumbCount, thumbMetaCount] = await Promise.all([
    countStore(SEGMENT_STORE),
    countStore(SEGMENT_META_STORE),
    countStore(THUMB_STORE),
    countStore(THUMB_META_STORE),
  ]);

  const backfill = (dataStore: string, metaStore: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        const tx = db.transaction([dataStore, metaStore], "readwrite");
        const src = tx.objectStore(dataStore);
        const dst = tx.objectStore(metaStore);
        const req = src.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as {
              key: string;
              size?: number;
              bytes?: ArrayBuffer;
              savedAt?: number;
            };
            dst.put({
              key: val.key,
              size: val.size ?? val.bytes?.byteLength ?? 0,
              savedAt: val.savedAt ?? Date.now(),
            } satisfies CachedMetaRecord);
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

  if (segCount > 0 && segMetaCount < segCount) {
    await backfill(SEGMENT_STORE, SEGMENT_META_STORE);
  }
  if (thumbCount > 0 && thumbMetaCount < thumbCount) {
    await backfill(THUMB_STORE, THUMB_META_STORE);
  }
}

export async function getCachedThumbBytes(
  fileId: string,
  expectedModifiedTime?: string
): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(THUMB_STORE, "readonly");
      const req = tx.objectStore(THUMB_STORE).get(fileId);
      req.onsuccess = () => {
        const rec = req.result as CachedThumbRecord | undefined;
        if (!rec || !rec.bytes) {
          resolve(null);
          return;
        }
        if (expectedModifiedTime && rec.modifiedTime && rec.modifiedTime !== expectedModifiedTime) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(rec.bytes));
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCachedThumbBytes(
  fileId: string,
  bytes: Uint8Array,
  modifiedTime = ""
): Promise<void> {
  const db = await openDb();
  if (!db) return;

  const copy =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer);
  const now = Date.now();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([THUMB_STORE, THUMB_META_STORE], "readwrite");
      const record: CachedThumbRecord = {
        key: fileId,
        modifiedTime,
        bytes: copy,
        savedAt: now,
      };
      tx.objectStore(THUMB_STORE).put(record);
      tx.objectStore(THUMB_META_STORE).put({
        key: fileId,
        size: copy.byteLength,
        savedAt: now,
      } satisfies CachedMetaRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedPlaylistBytes(fileId: string): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PLAYLIST_STORE, "readonly");
      const req = tx.objectStore(PLAYLIST_STORE).get(fileId);
      req.onsuccess = () => {
        const rec = req.result as CachedPlaylistRecord | undefined;
        if (!rec || !rec.bytes) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(rec.bytes));
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putCachedPlaylistBytes(
  fileId: string,
  bytes: Uint8Array
): Promise<void> {
  const db = await openDb();
  if (!db) return;

  const copy =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PLAYLIST_STORE, "readwrite");
      const record: CachedPlaylistRecord = {
        key: fileId,
        bytes: copy,
        savedAt: Date.now(),
      };
      tx.objectStore(PLAYLIST_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function hasCachedSegmentKey(url: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENT_STORE, "readonly");
      const req = tx.objectStore(SEGMENT_STORE).getKey(url);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getCachedSegmentBytes(url: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(SEGMENT_STORE, "readonly");
      const req = tx.objectStore(SEGMENT_STORE).get(url);
      req.onsuccess = () => {
        const rec = req.result as CachedSegmentRecord | undefined;
        if (!rec || !rec.bytes) {
          resolve(null);
          return;
        }
        resolve(rec.bytes);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Ultra-low-RAM LRU eviction: scans ONLY tiny metadata records (never loads multi-GB blobs into RAM!)
async function trimSegmentDiskCache(
  db: IDBDatabase,
  maxBytesOverride?: number
): Promise<void> {
  await ensureMetaBackfilled(db);
  const maxBytes = maxBytesOverride ?? getDiskCacheLimitBytes();

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([SEGMENT_META_STORE, SEGMENT_STORE], "readwrite");
      const metaStore = tx.objectStore(SEGMENT_META_STORE);
      const segStore = tx.objectStore(SEGMENT_STORE);
      const index = metaStore.index("savedAt");
      const entries: CachedMetaRecord[] = [];

      const cursorReq = index.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const val = cursor.value as CachedMetaRecord;
          entries.push({
            key: val.key,
            size: val.size || 0,
            savedAt: val.savedAt || 0,
          });
          cursor.continue();
        } else {
          // entries are ordered oldest-first by savedAt
          let totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
          let remainingCount = entries.length;
          for (const e of entries) {
            if (totalBytes <= maxBytes && remainingCount <= MAX_DISK_SEGMENT_COUNT) {
              break;
            }
            metaStore.delete(e.key);
            segStore.delete(e.key);
            totalBytes -= e.size;
            remainingCount -= 1;
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function writeSegmentRecord(
  db: IDBDatabase,
  url: string,
  copy: ArrayBuffer
): Promise<{ ok: boolean; quotaExceeded: boolean }> {
  return new Promise((resolve) => {
    let quotaExceeded = false;
    try {
      const now = Date.now();
      const tx = db.transaction([SEGMENT_STORE, SEGMENT_META_STORE], "readwrite");
      const record: CachedSegmentRecord = {
        key: url,
        bytes: copy,
        size: copy.byteLength,
        savedAt: now,
      };
      tx.objectStore(SEGMENT_STORE).put(record);
      tx.objectStore(SEGMENT_META_STORE).put({
        key: url,
        size: copy.byteLength,
        savedAt: now,
      } satisfies CachedMetaRecord);
      tx.oncomplete = () => resolve({ ok: true, quotaExceeded: false });
      tx.onabort = () => {
        if (tx.error?.name === "QuotaExceededError") quotaExceeded = true;
        resolve({ ok: false, quotaExceeded });
      };
      tx.onerror = () => {
        if (tx.error?.name === "QuotaExceededError") quotaExceeded = true;
        resolve({ ok: false, quotaExceeded });
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "QuotaExceededError") {
        quotaExceeded = true;
      }
      resolve({ ok: false, quotaExceeded });
    }
  });
}

export async function getAllCachedKeys(): Promise<{
  thumbs: Set<string>;
  playlists: Set<string>;
  segments: Set<string>;
}> {
  const db = await openDb();
  if (!db) {
    return { thumbs: new Set(), playlists: new Set(), segments: new Set() };
  }

  const readKeys = (storeName: string): Promise<Set<string>> =>
    new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAllKeys();
        req.onsuccess = () => {
          const out = new Set<string>();
          const arr = req.result as unknown[];
          if (Array.isArray(arr)) {
            for (const k of arr) {
              if (typeof k === "string") out.add(k);
            }
          }
          resolve(out);
        };
        req.onerror = () => resolve(new Set());
      } catch {
        resolve(new Set());
      }
    });

  const [thumbs, playlists, segments] = await Promise.all([
    readKeys(THUMB_STORE),
    readKeys(PLAYLIST_STORE),
    readKeys(SEGMENT_STORE),
  ]);
  return { thumbs, playlists, segments };
}

export async function trimDiskCacheToLimit(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await trimSegmentDiskCache(db).catch(() => undefined);
}

export async function putCachedSegmentBytes(
  url: string,
  buffer: ArrayBuffer,
  skipTrim = false
): Promise<void> {
  if (buffer.byteLength <= 0 || buffer.byteLength > 40 * 1024 * 1024) return;
  const db = await openDb();
  if (!db) return;

  const copy = buffer.slice(0);
  const res = await writeSegmentRecord(db, url, copy);
  if (res.quotaExceeded) {
    // Device storage is tight -> evict oldest 25% of current segment cache and retry once cleanly
    const stats = await getDiskCacheStats().catch(() => null);
    const targetBytes = stats
      ? Math.max(256 * 1024 * 1024, Math.floor(stats.segmentBytes * 0.75))
      : Math.floor(getDiskCacheLimitBytes() * 0.75);
    await trimSegmentDiskCache(db, targetBytes).catch(() => undefined);
    await writeSegmentRecord(db, url, copy);
  }

  if (!skipTrim) {
    segmentWritesSinceTrim += 1;
    if (segmentWritesSinceTrim >= 40) {
      segmentWritesSinceTrim = 0;
      trimSegmentDiskCache(db).catch(() => undefined);
    }
  }
}

export async function getDiskCacheStats(): Promise<DiskCacheStats> {
  const limitBytes = getDiskCacheLimitBytes();
  const db = await openDb();
  if (!db) {
    return {
      thumbCount: 0,
      playlistCount: 0,
      segmentCount: 0,
      segmentBytes: 0,
      totalBytes: 0,
      limitBytes,
      quotaBytes: null,
    };
  }

  await ensureMetaBackfilled(db);

  const scanMetaStore = (storeName: string): Promise<{ count: number; bytes: number }> =>
    new Promise((resolve) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        let count = 0;
        let bytes = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            count += 1;
            const val = cursor.value as { size?: number; bytes?: ArrayBuffer };
            bytes += val.size ?? val.bytes?.byteLength ?? 0;
            cursor.continue();
          } else {
            resolve({ count, bytes });
          }
        };
        req.onerror = () => resolve({ count: 0, bytes: 0 });
      } catch {
        resolve({ count: 0, bytes: 0 });
      }
    });

  const [thumbs, playlists, segments, quotaBytes] = await Promise.all([
    scanMetaStore(THUMB_META_STORE),
    scanMetaStore(PLAYLIST_STORE),
    scanMetaStore(SEGMENT_META_STORE),
    getBrowserStorageQuota(),
  ]);

  return {
    thumbCount: thumbs.count,
    playlistCount: playlists.count,
    segmentCount: segments.count,
    segmentBytes: segments.bytes,
    totalBytes: thumbs.bytes + playlists.bytes + segments.bytes,
    limitBytes,
    quotaBytes,
  };
}

export async function clearAllThumbDbCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const stores = [
        THUMB_STORE,
        THUMB_META_STORE,
        PLAYLIST_STORE,
        SEGMENT_STORE,
        SEGMENT_META_STORE,
      ].filter((s) => db.objectStoreNames.contains(s));
      if (stores.length === 0) {
        resolve();
        return;
      }
      const tx = db.transaction(stores, "readwrite");
      for (const s of stores) {
        tx.objectStore(s).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const LIBRARY_CACHE_KEY_PREFIX = "__library_cache_v1__:";

export async function saveCachedLibraryToDb(
  folderId: string,
  items: unknown[]
): Promise<void> {
  if (!folderId || typeof TextEncoder === "undefined") return;
  try {
    const json = JSON.stringify(items);
    const bytes = new TextEncoder().encode(json);
    await putCachedPlaylistBytes(`${LIBRARY_CACHE_KEY_PREFIX}${folderId}`, bytes);
  } catch {
    // Ignore serialization or IndexedDB write error
  }
}

export async function loadCachedLibraryFromDb<T>(folderId: string): Promise<T[] | null> {
  if (!folderId || typeof TextDecoder === "undefined") return null;
  try {
    const bytes = await getCachedPlaylistBytes(`${LIBRARY_CACHE_KEY_PREFIX}${folderId}`);
    if (!bytes) return null;
    const json = new TextDecoder("utf-8").decode(bytes);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export async function clearCachedLibraryFromDb(folderId: string): Promise<void> {
  if (!folderId) return;
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(PLAYLIST_STORE, "readwrite");
      tx.objectStore(PLAYLIST_STORE).delete(`${LIBRARY_CACHE_KEY_PREFIX}${folderId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
