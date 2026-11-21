import Hls, {
  type FragmentLoaderConstructor,
  type FragmentLoaderContext,
  type HlsConfig,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
  type LoaderStats,
} from "hls.js";

const MAX_CACHED_SEGMENTS = 240;
const MAX_CACHE_BYTES = 512 * 1024 * 1024; // 512 MB LRU cache (fits an entire HD video in memory)

interface CachedSegmentEntry {
  data: ArrayBuffer;
  size: number;
}

interface InFlightEntry {
  promise: Promise<ArrayBuffer>;
  controller: AbortController;
  priority: "low" | "high";
}

const segmentLruCache = new Map<string, CachedSegmentEntry>();
const inFlightPrefetches = new Map<string, InFlightEntry>();
let totalCachedBytes = 0;
let activeMainLoads = 0;

export function isMainSegmentLoading(): boolean {
  return activeMainLoads > 0;
}

export function hasSegmentCache(url: string): boolean {
  return segmentLruCache.has(url);
}

function evictIfNeeded(): void {
  while (
    segmentLruCache.size > MAX_CACHED_SEGMENTS ||
    totalCachedBytes > MAX_CACHE_BYTES
  ) {
    const oldestKey = segmentLruCache.keys().next().value;
    if (!oldestKey) break;
    const entry = segmentLruCache.get(oldestKey);
    if (entry) {
      totalCachedBytes -= entry.size;
      segmentLruCache.delete(oldestKey);
    }
  }
}

export function putSegmentCache(url: string, data: ArrayBuffer): void {
  if (!url.startsWith("https://www.googleapis.com/")) return;
  if (data.byteLength <= 0 || data.byteLength > 35 * 1024 * 1024) return;

  const existing = segmentLruCache.get(url);
  if (existing) {
    totalCachedBytes -= existing.size;
    segmentLruCache.delete(url);
  }
  segmentLruCache.set(url, { data, size: data.byteLength });
  totalCachedBytes += data.byteLength;
  evictIfNeeded();
}

export function getSegmentCache(url: string): ArrayBuffer | null {
  const entry = segmentLruCache.get(url);
  if (!entry) return null;
  segmentLruCache.delete(url);
  segmentLruCache.set(url, entry);
  return entry.data;
}

export function abortLowPriorityPrefetches(keepUrl?: string): void {
  for (const [url, entry] of inFlightPrefetches.entries()) {
    if (entry.priority === "low" && url !== keepUrl) {
      entry.controller.abort();
      inFlightPrefetches.delete(url);
    }
  }
}

export function clearSegmentCache(): void {
  for (const entry of inFlightPrefetches.values()) {
    entry.controller.abort();
  }
  segmentLruCache.clear();
  inFlightPrefetches.clear();
  totalCachedBytes = 0;
}

export function prefetchSegmentUrl(
  url: string,
  accessToken: string,
  priority: "low" | "high" = "low"
): Promise<ArrayBuffer> | null {
  if (!url || !accessToken) return null;
  const cached = getSegmentCache(url);
  if (cached) return Promise.resolve(cached);

  const existing = inFlightPrefetches.get(url);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: controller.signal,
    priority,
  } as RequestInit)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(`Prefetch HTTP ${res.status}`);
      }
      const buf = await res.arrayBuffer();
      putSegmentCache(url, buf);
      return buf;
    })
    .finally(() => {
      const cur = inFlightPrefetches.get(url);
      if (cur && cur.controller === controller) {
        inFlightPrefetches.delete(url);
      }
    });

  promise.catch(() => undefined);
  inFlightPrefetches.set(url, { promise, controller, priority });
  return promise;
}

/**
 * Fast LRU-Cached Fragment Loader for hls.js using hardware WebCrypto AES-128 decryption.
 * - Uses native XHR/Fetch whole-segment delivery so hls.js stays on hardware WebCrypto AES
 *   (avoids slow JS SoftwareAES!).
 * - Aborts unrelated low-priority prefetches so the active seek/play segment gets 100% bandwidth.
 */
export function createCachedDriveFragmentLoader(
  accessToken: string
): FragmentLoaderConstructor {
  const BaseLoader = Hls.DefaultConfig.loader;

  class CachedDriveFragmentLoader extends BaseLoader {
    private isAborted = false;

    constructor(config: HlsConfig) {
      super(config);
    }

    override abort(): void {
      this.isAborted = true;
      super.abort();
    }

    override load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>
    ): void {
      this.isAborted = false;
      const url = context.url;

      if (!url.startsWith("https://www.googleapis.com/")) {
        super.load(
          context,
          config,
          callbacks as unknown as LoaderCallbacks<LoaderContext>
        );
        return;
      }

      const deliverBuffer = (buffer: ArrayBuffer) => {
        if (this.isAborted) return;
        const now = performance.now();
        const stats: LoaderStats = {
          aborted: false,
          loaded: buffer.byteLength,
          retry: 0,
          total: buffer.byteLength,
          chunkCount: 1,
          bwEstimate: 30_000_000,
          loading: { start: now, first: now, end: now + 1 },
          parsing: { start: 0, end: 0 },
          buffering: { start: 0, first: 0, end: 0 },
        };
        callbacks.onSuccess(
          { url, data: buffer.slice(0) },
          stats,
          context,
          null
        );
      };

      // 1. Instant 0ms hit from LRU cache
      const cached = getSegmentCache(url);
      if (cached) {
        queueMicrotask(() => deliverBuffer(cached));
        return;
      }

      // 2. Join already-running prefetch (zero duplicate download)
      const inFlight = inFlightPrefetches.get(url);
      if (inFlight) {
        inFlight.priority = "high";
        inFlight.promise
          .then((buf) => deliverBuffer(buf))
          .catch(() => {
            if (!this.isAborted) {
              this.loadWithCacheHook(context, config, callbacks);
            }
          });
        return;
      }

      // 3. Free all bandwidth for this active segment
      abortLowPriorityPrefetches(url);
      this.loadWithCacheHook(context, config, callbacks);
    }

    private loadWithCacheHook(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>
    ): void {
      activeMainLoads += 1;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          activeMainLoads = Math.max(0, activeMainLoads - 1);
        }
      };

      const wrappedCallbacks: LoaderCallbacks<FragmentLoaderContext> = {
        ...callbacks,
        onSuccess: (response, stats, ctx, networkDetails) => {
          release();
          if (response.data instanceof ArrayBuffer) {
            putSegmentCache(ctx.url, response.data.slice(0));
          }
          callbacks.onSuccess(response, stats, ctx, networkDetails);
        },
        onError: (response, ctx, networkDetails, stats) => {
          release();
          callbacks.onError(response, ctx, networkDetails, stats);
        },
        onTimeout: (stats, ctx, networkDetails) => {
          release();
          callbacks.onTimeout(stats, ctx, networkDetails);
        },
        onAbort: (stats, ctx, networkDetails) => {
          release();
          if (callbacks.onAbort) {
            callbacks.onAbort(stats, ctx, networkDetails);
          }
        },
      };
      void accessToken;
      super.load(
        context,
        config,
        wrappedCallbacks as unknown as LoaderCallbacks<LoaderContext>
      );
    }
  }

  return CachedDriveFragmentLoader as unknown as FragmentLoaderConstructor;
}
