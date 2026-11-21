const DB_NAME = "vaultstream_enc_cache_v1";
const STORE_NAME = "thumbs";

interface CachedThumbRecord {
  key: string;
  modifiedTime: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
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

export async function getCachedThumbBytes(
  fileId: string,
  expectedModifiedTime?: string
): Promise<Uint8Array | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(fileId);
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

  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: CachedThumbRecord = {
        key: fileId,
        modifiedTime,
        bytes: copy,
        savedAt: Date.now(),
      };
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllThumbDbCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
