export interface ExtractedStream {
  url: string;
  quality: string;
  format: "mp4" | "hls" | "webm";
  sizeHint?: number;
}

export type ExtractBackend = "local_ytdlp" | "edge_proxy" | "client_fallback";

export interface ExtractedVideoInfo {
  sourceUrl: string;
  site: string;
  title: string;
  thumbnailUrl?: string;
  duration?: number;
  embedUrl?: string;
  refererOrigin?: string;
  streams: ExtractedStream[];
  note?: string;
  backend: ExtractBackend;
  proxyOrigin?: string;
}

export interface ExternalDownloadProgress {
  phase: "resolving" | "downloading" | "merging";
  percent: number;
  loadedBytes: number;
  totalBytes?: number;
  detail: string;
}

export interface RecentExternalItem {
  url: string;
  title: string;
  site: string;
  thumbnailUrl?: string;
  addedAt: number;
}

const LOCAL_COMPANION_BASE = "http://127.0.0.1:8787";
const RECENT_EXTERNAL_KEY = "vaultstream_recent_external_urls_v1";

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLikelyExternalUrlInput(raw: string): boolean {
  const t = raw.trim();
  return /^https?:\/\/\S+/i.test(t) && isHttpUrl(t);
}

export function sanitizeFilenameBase(raw: string): string {
  const clean = raw
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return clean || "video";
}

export function buildProxiedStreamUrl(
  streamUrl: string,
  info: Pick<ExtractedVideoInfo, "proxyOrigin" | "refererOrigin">,
  options?: { downloadFilename?: string }
): string {
  if (!info.proxyOrigin) {
    return streamUrl;
  }
  const params = new URLSearchParams({ url: streamUrl });
  if (info.refererOrigin) {
    params.set("referer", info.refererOrigin);
  }
  if (options?.downloadFilename) {
    params.set("dl", "1");
    params.set("filename", options.downloadFilename);
  }
  return `${info.proxyOrigin}/api/proxy?${params.toString()}`;
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildClientSideEmbedAndHint(url: URL): { site: string; embedUrl?: string } {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === "youtu.be" || host.includes("youtube.com") || host.includes("youtube-nocookie.com")) {
    let id = url.searchParams.get("v");
    if (!id && host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (!id) {
      const parts = path.split("/").filter(Boolean);
      if (parts.length >= 2 && ["shorts", "embed", "live", "v"].includes(parts[0])) {
        id = parts[1];
      }
    }
    return {
      site: "YouTube",
      embedUrl: id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0` : undefined,
    };
  }
  if (host.includes("nicovideo.jp") || host.includes("nico.ms")) {
    const m = url.href.match(/(sm\d+|so\d+|nm\d+)/);
    return {
      site: "ニコニコ動画",
      embedUrl: m ? `https://embed.nicovideo.jp/watch/${m[1]}?autoplay=1` : undefined,
    };
  }
  if (host.includes("vimeo.com")) {
    const m = path.match(/\/(\d{5,})/);
    return {
      site: "Vimeo",
      embedUrl: m ? `https://player.vimeo.com/video/${m[1]}?autoplay=1` : undefined,
    };
  }
  if (host.includes("dailymotion.com") || host.includes("dai.ly")) {
    const m =
      path.match(/\/video\/([A-Za-z0-9]+)/) ??
      (host.includes("dai.ly") ? path.match(/\/([A-Za-z0-9]+)/) : null);
    return {
      site: "Dailymotion",
      embedUrl: m ? `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1` : undefined,
    };
  }
  if (host.includes("xvideos")) {
    const m = path.match(/video\.([a-z0-9]+)/i) ?? path.match(/video(\d+)/i);
    return {
      site: "XVideos",
      embedUrl: m ? `https://www.xvideos.com/embedframe/${m[1]}` : undefined,
    };
  }
  if (host.includes("pornhub")) {
    const vk = url.searchParams.get("viewkey");
    return {
      site: "Pornhub",
      embedUrl: vk ? `https://www.pornhub.com/embed/${vk}` : undefined,
    };
  }
  if (host.includes("spankbang")) {
    const m = path.match(/^\/([a-z0-9]+)\//i);
    return {
      site: "SpankBang",
      embedUrl: m ? `https://spankbang.com/${m[1]}/embed/` : undefined,
    };
  }
  if (host.includes("xhamster")) {
    const m = path.match(/-(\d+)$/) ?? path.match(/\/videos\/[^/]+-xh([a-z0-9]+)/i);
    return {
      site: "xHamster",
      embedUrl: m ? `https://xhamster.com/xembed.php?video=${m[1]}` : undefined,
    };
  }
  if (host.includes("bilibili.com")) {
    const bv = path.match(/\/(BV[0-9A-Za-z]+)/);
    return {
      site: "Bilibili",
      embedUrl: bv ? `https://player.bilibili.com/player.html?bvid=${bv[1]}&autoplay=1` : undefined,
    };
  }
  return { site: host.replace(/^www\./, "") };
}

async function resolveClientFallback(url: URL): Promise<ExtractedVideoInfo> {
  const streams: ExtractedStream[] = [];
  const host = url.hostname.toLowerCase();
  const known = buildClientSideEmbedAndHint(url);
  let title = known.site;
  let thumbnailUrl: string | undefined;
  let duration: number | undefined;

  if (/\.(?:mp4|m3u8|webm|mov)(?:$|[?#])/i.test(url.pathname)) {
    const fmt = /\.m3u8/i.test(url.pathname)
      ? "hls"
      : /\.webm/i.test(url.pathname)
        ? "webm"
        : "mp4";
    const fileName = decodeURIComponent(url.pathname.split("/").pop() || "Video");
    return {
      sourceUrl: url.toString(),
      site: known.site,
      title: fileName.replace(/\.[^.]+$/, "") || "External Video",
      streams: [{ url: url.toString(), quality: "Direct", format: fmt }],
      backend: "client_fallback",
    };
  }

  // CORS-friendly client fallbacks (for GitHub Pages static deployment)
  if (host.includes("x.com") || host.includes("twitter.com")) {
    const m = url.pathname.match(/\/status\/(\d+)/);
    if (m) {
      const fx = await fetchJsonWithTimeout<{
        tweet?: {
          text?: string;
          author?: { name?: string };
          media?: { videos?: Array<{ url?: string; thumbnail_url?: string; duration?: number }> };
        };
      }>(`https://api.fxtwitter.com/status/${m[1]}`, 5000);
      const v = fx?.tweet?.media?.videos?.[0];
      if (v?.url) {
        streams.push({ url: v.url, quality: "Best MP4", format: "mp4" });
        title = fx?.tweet?.text?.slice(0, 70) || fx?.tweet?.author?.name || title;
        thumbnailUrl = v.thumbnail_url;
        duration = v.duration;
      }
    }
  } else if (host.includes("tiktok.com")) {
    const tt = await fetchJsonWithTimeout<{
      code?: number;
      data?: { title?: string; cover?: string; duration?: number; hdplay?: string; play?: string };
    }>(`https://www.tikwm.com/api/?url=${encodeURIComponent(url.toString())}&hd=1`, 5500);
    if (tt?.code === 0 && tt.data) {
      if (tt.data.hdplay) streams.push({ url: tt.data.hdplay, quality: "HD MP4", format: "mp4" });
      if (tt.data.play) streams.push({ url: tt.data.play, quality: "SD MP4", format: "mp4" });
      if (tt.data.title) title = tt.data.title;
      thumbnailUrl = tt.data.cover;
      duration = tt.data.duration;
    }
  } else if (known.site === "YouTube") {
    const idMatch = known.embedUrl?.match(/\/embed\/([^?]+)/);
    const ytId = idMatch?.[1];
    if (ytId) {
      title = `YouTube (${ytId})`;
      thumbnailUrl = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
      const oembed = await fetchJsonWithTimeout<{ title?: string }>(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`,
        3500
      );
      if (oembed?.title) title = oembed.title;
    }
  }

  return {
    sourceUrl: url.toString(),
    site: known.site,
    title,
    thumbnailUrl,
    duration,
    embedUrl: known.embedUrl,
    streams,
    backend: "client_fallback",
    note:
      streams.length === 0 && !known.embedUrl
        ? "この環境ではサーバープロキシが利用できないため直接抽出が制限されました。Cloudflare Pages 版または PC の url_server.py (yt-dlp) を併用してください。"
        : undefined,
  };
}

export async function resolveExternalVideoUrl(rawUrl: string): Promise<ExtractedVideoInfo> {
  const trimmed = rawUrl.trim();
  if (!isHttpUrl(trimmed)) {
    throw new Error("有効な http:// または https:// URL を入力してください。");
  }
  const parsedUrl = new URL(trimmed);

  // 1. Optional Local PC yt-dlp companion server (supports 1,800+ sites at full HD/4K!)
  const localData = await fetchJsonWithTimeout<Omit<ExtractedVideoInfo, "backend" | "proxyOrigin"> & { error?: string }>(
    `${LOCAL_COMPANION_BASE}/api/extract?url=${encodeURIComponent(trimmed)}`,
    1200
  );
  if (localData && !localData.error && (localData.streams?.length || localData.embedUrl)) {
    return {
      ...localData,
      streams: localData.streams ?? [],
      backend: "local_ytdlp",
      proxyOrigin: LOCAL_COMPANION_BASE,
    };
  }

  // 2. Built-in Cloudflare Pages Edge Extractor (/api/extract)
  if (typeof window !== "undefined") {
    const edgeOrigin = window.location.origin;
    const edgeData = await fetchJsonWithTimeout<Omit<ExtractedVideoInfo, "backend" | "proxyOrigin"> & { error?: string }>(
      `${edgeOrigin}/api/extract?url=${encodeURIComponent(trimmed)}`,
      9000
    );
    if (edgeData && !edgeData.error) {
      return {
        ...edgeData,
        streams: edgeData.streams ?? [],
        backend: "edge_proxy",
        proxyOrigin: edgeOrigin,
      };
    }
  }

  // 3. Pure Browser Fallback (works on static GitHub Pages)
  return resolveClientFallback(parsedUrl);
}

function parseHlsAttr(line: string, key: string): string | null {
  const quoted = line.match(new RegExp(`${key}="([^"]+)"`, "i"));
  if (quoted?.[1]) return quoted[1];
  const bare = line.match(new RegExp(`${key}=([^,\\s]+)`, "i"));
  return bare?.[1] ?? null;
}

function parseHexIv(ivStr: string | null, seqIndex: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(16);
  const out = new Uint8Array(buf);
  if (ivStr) {
    const hex = ivStr.replace(/^0x/i, "").padStart(32, "0").slice(-32);
    for (let i = 0; i < 16; i += 1) {
      out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return out;
  }
  const view = new DataView(buf);
  view.setUint32(12, seqIndex >>> 0, false);
  return out;
}

async function fetchTextDirectOrProxied(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`プレイリスト取得に失敗しました (HTTP ${res.status})`);
  }
  return res.text();
}

async function downloadHlsToBlob(
  playlistFetchUrl: string,
  title: string,
  onProgress: (p: ExternalDownloadProgress) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  onProgress({
    phase: "resolving",
    percent: 2,
    loadedBytes: 0,
    detail: "HLS プレイリストを解析中...",
  });

  let currentUrl = playlistFetchUrl;
  let playlistText = await fetchTextDirectOrProxied(currentUrl, signal);

  // Follow master playlist to highest bandwidth variant
  if (playlistText.includes("#EXT-X-STREAM-INF")) {
    const lines = playlistText.split(/\r?\n/);
    let bestBw = -1;
    let bestUri = "";
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF")) {
        const bw = Number(parseHlsAttr(line, "BANDWIDTH") ?? "0");
        const nextUri = (lines[i + 1] ?? "").trim();
        if (nextUri && !nextUri.startsWith("#") && bw >= bestBw) {
          bestBw = bw;
          bestUri = nextUri;
        }
      }
    }
    if (bestUri) {
      currentUrl = new URL(bestUri, currentUrl).toString();
      playlistText = await fetchTextDirectOrProxied(currentUrl, signal);
    }
  }

  const lines = playlistText.split(/\r?\n/);
  let mediaSequence = 0;
  let initUri: string | null = null;
  let activeKeyUri: string | null = null;
  let activeKeyMethod = "NONE";
  let activeIv: string | null = null;
  const keyCache = new Map<string, CryptoKey>();

  interface SegmentJob {
    index: number;
    url: string;
    keyUri: string | null;
    keyMethod: string;
    ivStr: string | null;
  }

  const segments: SegmentJob[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = Number(line.split(":")[1]) || 0;
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const uri = parseHlsAttr(line, "URI");
      if (uri) initUri = new URL(uri, currentUrl).toString();
    } else if (line.startsWith("#EXT-X-KEY:")) {
      activeKeyMethod = (parseHlsAttr(line, "METHOD") ?? "NONE").toUpperCase();
      const uri = parseHlsAttr(line, "URI");
      activeKeyUri = uri ? new URL(uri, currentUrl).toString() : null;
      activeIv = parseHlsAttr(line, "IV");
    } else if (!line.startsWith("#")) {
      segments.push({
        index: mediaSequence + segments.length,
        url: new URL(line, currentUrl).toString(),
        keyUri: activeKeyUri,
        keyMethod: activeKeyMethod,
        ivStr: activeIv,
      });
    }
  }

  if (segments.length === 0) {
    throw new Error("HLS セグメントが見つかりませんでした。");
  }

  const parts: Array<ArrayBuffer | null> = new Array(segments.length).fill(null);
  let initBuffer: ArrayBuffer | null = null;
  if (initUri) {
    const initRes = await fetch(initUri, { signal });
    if (initRes.ok) initBuffer = await initRes.arrayBuffer();
  }

  let completed = 0;
  let totalBytes = initBuffer ? initBuffer.byteLength : 0;
  let cursor = 0;
  const workers = Math.min(4, segments.length);

  const getAesKey = async (keyUrl: string): Promise<CryptoKey> => {
    const hit = keyCache.get(keyUrl);
    if (hit) return hit;
    const kr = await fetch(keyUrl, { signal });
    if (!kr.ok) throw new Error("HLS 復号鍵の取得に失敗しました");
    const raw = await kr.arrayBuffer();
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    keyCache.set(keyUrl, cryptoKey);
    return cryptoKey;
  };

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const myIdx = cursor;
        cursor += 1;
        if (myIdx >= segments.length) break;

        const job = segments[myIdx];
        const res = await fetch(job.url, { signal });
        if (!res.ok) {
          throw new Error(`セグメント ${myIdx + 1} の取得に失敗 (HTTP ${res.status})`);
        }
        let buf = await res.arrayBuffer();
        if (job.keyMethod === "AES-128" && job.keyUri) {
          const aesKey = await getAesKey(job.keyUri);
          const iv = parseHexIv(job.ivStr, job.index);
          buf = await window.crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, buf);
        }
        parts[myIdx] = buf;
        completed += 1;
        totalBytes += buf.byteLength;
        onProgress({
          phase: "downloading",
          percent: Math.min(97, Math.max(3, Math.round((completed / segments.length) * 95))),
          loadedBytes: totalBytes,
          detail: `HLS セグメント取得中 (${completed} / ${segments.length})`,
        });
      }
    })
  );

  onProgress({
    phase: "merging",
    percent: 98,
    loadedBytes: totalBytes,
    detail: "動画ファイルを結合中...",
  });

  const blobParts: BlobPart[] = [];
  if (initBuffer) blobParts.push(initBuffer);
  for (const p of parts) {
    if (p) blobParts.push(p);
  }

  const isFmp4 = Boolean(initBuffer);
  const mimeType = isFmp4 ? "video/mp4" : "video/mp2t";
  const ext = isFmp4 ? "mp4" : "ts";
  const blob = new Blob(blobParts, { type: mimeType });
  return {
    blob,
    filename: `${sanitizeFilenameBase(title)}.${ext}`,
    mimeType,
  };
}

export async function downloadExternalStreamToBlob(
  stream: ExtractedStream,
  info: ExtractedVideoInfo,
  onProgress: (p: ExternalDownloadProgress) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; filename: string; mimeType: string }> {
  const fetchUrl = buildProxiedStreamUrl(stream.url, info);

  if (stream.format === "hls") {
    return downloadHlsToBlob(fetchUrl, info.title, onProgress, signal);
  }

  onProgress({
    phase: "downloading",
    percent: 2,
    loadedBytes: 0,
    detail: "動画データをダウンロード中...",
  });

  const res = await fetch(fetchUrl, { signal });
  if (!res.ok) {
    throw new Error(`ダウンロードに失敗しました (HTTP ${res.status})`);
  }

  const totalHeader = Number(res.headers.get("content-length") ?? "0");
  const totalBytes = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : undefined;
  const contentType = res.headers.get("content-type") || (stream.format === "webm" ? "video/webm" : "video/mp4");
  const ext = stream.format === "webm" || contentType.includes("webm") ? "webm" : "mp4";

  if (!res.body) {
    const ab = await res.arrayBuffer();
    const blob = new Blob([ab], { type: contentType });
    return {
      blob,
      filename: `${sanitizeFilenameBase(info.title)}.${ext}`,
      mimeType: contentType,
    };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loadedBytes = 0;

  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException("Aborted", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
      copy.set(value);
      chunks.push(copy);
      loadedBytes += value.byteLength;
      const pct = totalBytes
        ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100))
        : Math.min(95, 5 + Math.round(loadedBytes / (1024 * 1024)));
      onProgress({
        phase: "downloading",
        percent: pct,
        loadedBytes,
        totalBytes,
        detail: totalBytes
          ? `${(loadedBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
          : `${(loadedBytes / (1024 * 1024)).toFixed(1)} MB 取得済み`,
      });
    }
  }

  const blob = new Blob(chunks, { type: contentType });
  return {
    blob,
    filename: `${sanitizeFilenameBase(info.title)}.${ext}`,
    mimeType: contentType,
  };
}

export function triggerBrowserFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function loadRecentExternalUrls(): RecentExternalItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_EXTERNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentExternalItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function saveRecentExternalUrl(item: RecentExternalItem): RecentExternalItem[] {
  const current = loadRecentExternalUrls().filter((x) => x.url !== item.url);
  const next = [item, ...current].slice(0, 20);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_EXTERNAL_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota
    }
  }
  return next;
}

export function removeRecentExternalUrl(url: string): RecentExternalItem[] {
  const next = loadRecentExternalUrls().filter((x) => x.url !== url);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_EXTERNAL_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}
