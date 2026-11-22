export interface ExtractedStream {
  url: string;
  quality: string;
  format: "mp4" | "hls" | "webm";
  sizeHint?: number;
}

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
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return true;
    }
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }
  return false;
}

function parseSafePublicUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (isPrivateOrBlockedHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEscapedUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\\u002[fF]/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/\\u003[dD]/g, "=")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .trim();
}

function inferStreamFormat(url: string): "mp4" | "hls" | "webm" {
  const lower = url.toLowerCase();
  if (/\.m3u8(?:$|[?#&])/.test(lower) || lower.includes("/hls/") || lower.includes("format=m3u8")) {
    return "hls";
  }
  if (/\.webm(?:$|[?#&])/.test(lower)) {
    return "webm";
  }
  return "mp4";
}

function addStream(
  list: ExtractedStream[],
  seen: Set<string>,
  rawUrl: string | undefined,
  quality = "Auto",
  formatHint?: "mp4" | "hls" | "webm"
): void {
  if (!rawUrl) return;
  const cleaned = decodeEscapedUrl(rawUrl);
  const parsed = parseSafePublicUrl(cleaned);
  if (!parsed) return;
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|vtt|srt|css|js)(?:$|[?#])/i.test(parsed.pathname)) {
    return;
  }
  const normalized = parsed.toString();
  if (seen.has(normalized)) return;
  seen.add(normalized);
  list.push({
    url: normalized,
    quality,
    format: formatHint ?? inferStreamFormat(normalized),
  });
}

function sortStreams(streams: ExtractedStream[]): ExtractedStream[] {
  const rank = (s: ExtractedStream): number => {
    const q = s.quality.toLowerCase();
    let score = s.format === "mp4" ? 1000 : s.format === "webm" ? 800 : 500;
    if (/preview|thumb|sprite/i.test(s.url)) score -= 600;
    if (q.includes("2160") || q.includes("4k")) score += 40;
    else if (q.includes("1080")) score += 30;
    else if (q.includes("720")) score += 20;
    else if (q.includes("480")) score += 10;
    else if (q.includes("high") || q.includes("hd")) score += 18;
    return score;
  };
  return [...streams].sort((a, b) => rank(b) - rank(a));
}

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host.endsWith(".youtu.be")) {
    return url.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  if (host.includes("youtube.com") || host.includes("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["shorts", "embed", "live", "v"].includes(parts[0])) {
      return parts[1];
    }
  }
  return null;
}

async function tryExtractYouTube(targetUrl: URL, videoId: string): Promise<ExtractedVideoInfo> {
  const streams: ExtractedStream[] = [];
  const seen = new Set<string>();
  let title = `YouTube (${videoId})`;
  let thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  let duration: number | undefined;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;

  try {
    const oembedRes = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
      {},
      4000
    );
    if (oembedRes.ok) {
      const oembed = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
      if (oembed.title) title = oembed.title;
      if (oembed.thumbnail_url) thumbnailUrl = oembed.thumbnail_url;
    }
  } catch {
    // ignore
  }

  const pipedApis = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
  ];
  for (const apiBase of pipedApis) {
    try {
      const res = await fetchWithTimeout(`${apiBase}/streams/${videoId}`, {}, 4500);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        title?: string;
        duration?: number;
        thumbnailUrl?: string;
        hls?: string;
        videoStreams?: Array<{
          url?: string;
          quality?: string;
          mimeType?: string;
          videoOnly?: boolean;
        }>;
      };
      if (data.title) title = data.title;
      if (data.duration) duration = data.duration;
      if (data.thumbnailUrl) thumbnailUrl = data.thumbnailUrl;
      for (const vs of data.videoStreams ?? []) {
        if (!vs.url || vs.videoOnly) continue;
        const fmt = vs.mimeType?.includes("webm") ? "webm" : "mp4";
        addStream(streams, seen, vs.url, vs.quality || "MP4", fmt);
      }
      if (data.hls) {
        addStream(streams, seen, data.hls, "HLS Auto", "hls");
      }
      if (streams.length > 0) break;
    } catch {
      // try next instance
    }
  }

  return {
    sourceUrl: targetUrl.toString(),
    site: "YouTube",
    title,
    thumbnailUrl,
    duration,
    embedUrl,
    streams: sortStreams(streams),
    note:
      streams.length === 0
        ? "YouTube 埋め込みプレーヤーで再生できます（直接ダウンロードは PC 版の url_server.py (yt-dlp) を併用すると全画質対応します）。"
        : undefined,
  };
}

async function tryExtractTwitter(targetUrl: URL): Promise<ExtractedVideoInfo | null> {
  const match = targetUrl.pathname.match(/\/status\/(\d+)/);
  if (!match) return null;
  const statusId = match[1];

  const endpoints = [
    `https://api.fxtwitter.com/status/${statusId}`,
    `https://api.vxtwitter.com/Twitter/status/${statusId}`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetchWithTimeout(ep, { headers: { "User-Agent": BROWSER_UA } }, 6000);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        tweet?: {
          text?: string;
          author?: { name?: string; screen_name?: string };
          media?: {
            videos?: Array<{
              url?: string;
              thumbnail_url?: string;
              duration?: number;
              formats?: Array<{ url?: string; bitrate?: number; container?: string }>;
            }>;
          };
        };
        text?: string;
        user_name?: string;
        media_extended?: Array<{
          type?: string;
          url?: string;
          thumbnail_url?: string;
          duration_millis?: number;
        }>;
      };

      const streams: ExtractedStream[] = [];
      const seen = new Set<string>();
      let title = `X Post (${statusId})`;
      let thumbnailUrl: string | undefined;
      let duration: number | undefined;

      if (data.tweet) {
        const who = data.tweet.author?.name || data.tweet.author?.screen_name || "X";
        const snippet = (data.tweet.text ?? "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 80);
        title = snippet ? `${who}: ${snippet}` : `${who} (${statusId})`;
        const vid = data.tweet.media?.videos?.[0];
        if (vid) {
          thumbnailUrl = vid.thumbnail_url;
          duration = vid.duration;
          const sortedFmts = [...(vid.formats ?? [])].sort(
            (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)
          );
          for (const f of sortedFmts) {
            if (!f.url) continue;
            const isHls = f.container === "m3u8" || f.url.includes(".m3u8");
            addStream(
              streams,
              seen,
              f.url,
              isHls ? "HLS" : f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps MP4` : "MP4",
              isHls ? "hls" : "mp4"
            );
          }
          addStream(streams, seen, vid.url, "Best MP4", "mp4");
        }
      } else if (data.media_extended) {
        const snippet = (data.text ?? "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 80);
        title = snippet ? `${data.user_name ?? "X"}: ${snippet}` : title;
        for (const m of data.media_extended) {
          if (m.type === "video" || m.type === "gif") {
            thumbnailUrl = thumbnailUrl ?? m.thumbnail_url;
            if (m.duration_millis) duration = m.duration_millis / 1000;
            addStream(streams, seen, m.url, "MP4", "mp4");
          }
        }
      }

      if (streams.length > 0) {
        return {
          sourceUrl: targetUrl.toString(),
          site: "X (Twitter)",
          title,
          thumbnailUrl,
          duration,
          refererOrigin: "https://x.com",
          streams: sortStreams(streams),
        };
      }
    } catch {
      // try next API
    }
  }
  return null;
}

async function tryExtractTikTok(targetUrl: URL): Promise<ExtractedVideoInfo | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.tikwm.com/api/?url=${encodeURIComponent(targetUrl.toString())}&hd=1`,
      { headers: { "User-Agent": BROWSER_UA } },
      7000
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: number;
      data?: {
        title?: string;
        cover?: string;
        duration?: number;
        hdplay?: string;
        play?: string;
        wmplay?: string;
        author?: { nickname?: string };
      };
    };
    if (json.code !== 0 || !json.data) return null;
    const d = json.data;
    const streams: ExtractedStream[] = [];
    const seen = new Set<string>();
    addStream(streams, seen, d.hdplay, "HD (No Watermark)", "mp4");
    addStream(streams, seen, d.play, "SD (No Watermark)", "mp4");
    addStream(streams, seen, d.wmplay, "With Watermark", "mp4");
    if (streams.length === 0) return null;

    return {
      sourceUrl: targetUrl.toString(),
      site: "TikTok",
      title: d.title || d.author?.nickname || "TikTok Video",
      thumbnailUrl: d.cover,
      duration: d.duration,
      refererOrigin: "https://www.tiktok.com",
      streams,
    };
  } catch {
    return null;
  }
}

async function tryExtractReddit(targetUrl: URL): Promise<ExtractedVideoInfo | null> {
  try {
    const cleanUrl = `${targetUrl.origin}${targetUrl.pathname.replace(/\/$/, "")}.json?raw_json=1`;
    const res = await fetchWithTimeout(
      cleanUrl,
      { headers: { "User-Agent": BROWSER_UA } },
      6000
    );
    if (!res.ok) return null;
    const listings = (await res.json()) as Array<{
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            thumbnail?: string;
            secure_media?: {
              reddit_video?: {
                fallback_url?: string;
                hls_url?: string;
                duration?: number;
              };
            };
            crosspost_parent_list?: Array<{
              secure_media?: {
                reddit_video?: {
                  fallback_url?: string;
                  hls_url?: string;
                  duration?: number;
                };
              };
            }>;
          };
        }>;
      };
    }>;
    const post = listings?.[0]?.data?.children?.[0]?.data;
    const rv =
      post?.secure_media?.reddit_video ??
      post?.crosspost_parent_list?.[0]?.secure_media?.reddit_video;
    if (!rv) return null;

    const streams: ExtractedStream[] = [];
    const seen = new Set<string>();
    addStream(streams, seen, rv.hls_url, "HLS (映像+音声)", "hls");
    addStream(streams, seen, rv.fallback_url, "MP4 (映像のみ)", "mp4");
    if (streams.length === 0) return null;

    return {
      sourceUrl: targetUrl.toString(),
      site: "Reddit",
      title: post?.title || "Reddit Video",
      thumbnailUrl: post?.thumbnail?.startsWith("http") ? post.thumbnail : undefined,
      duration: rv.duration,
      refererOrigin: "https://www.reddit.com",
      streams,
    };
  } catch {
    return null;
  }
}

async function tryExtractDailymotion(targetUrl: URL): Promise<ExtractedVideoInfo | null> {
  const m =
    targetUrl.pathname.match(/\/video\/([A-Za-z0-9]+)/) ??
    (targetUrl.hostname.includes("dai.ly") ? targetUrl.pathname.match(/\/([A-Za-z0-9]+)/) : null);
  if (!m) return null;
  const videoId = m[1];
  const embedUrl = `https://www.dailymotion.com/embed/video/${videoId}?autoplay=1`;

  try {
    const res = await fetchWithTimeout(
      `https://www.dailymotion.com/player/metadata/video/${videoId}`,
      { headers: { "User-Agent": BROWSER_UA } },
      6000
    );
    if (!res.ok) {
      return {
        sourceUrl: targetUrl.toString(),
        site: "Dailymotion",
        title: `Dailymotion (${videoId})`,
        embedUrl,
        streams: [],
      };
    }
    const meta = (await res.json()) as {
      title?: string;
      duration?: number;
      posters?: Record<string, string>;
      qualities?: Record<string, Array<{ type?: string; url?: string }>>;
    };
    const streams: ExtractedStream[] = [];
    const seen = new Set<string>();
    for (const [q, arr] of Object.entries(meta.qualities ?? {})) {
      for (const item of arr ?? []) {
        if (!item.url) continue;
        const isHls = item.type?.includes("mpegURL") || item.url.includes(".m3u8");
        addStream(streams, seen, item.url, `${q}${/^\d+$/.test(q) ? "p" : ""}`, isHls ? "hls" : "mp4");
      }
    }
    const thumb = meta.posters?.["720"] || meta.posters?.["480"] || Object.values(meta.posters ?? {})[0];
    return {
      sourceUrl: targetUrl.toString(),
      site: "Dailymotion",
      title: meta.title || `Dailymotion (${videoId})`,
      thumbnailUrl: thumb,
      duration: meta.duration,
      embedUrl,
      refererOrigin: "https://www.dailymotion.com",
      streams: sortStreams(streams),
    };
  } catch {
    return {
      sourceUrl: targetUrl.toString(),
      site: "Dailymotion",
      title: `Dailymotion (${videoId})`,
      embedUrl,
      streams: [],
    };
  }
}

async function tryExtractVimeo(targetUrl: URL): Promise<ExtractedVideoInfo | null> {
  const m = targetUrl.pathname.match(/\/(\d{5,})/);
  if (!m) return null;
  const videoId = m[1];
  const embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1`;
  const streams: ExtractedStream[] = [];
  const seen = new Set<string>();
  let title = `Vimeo (${videoId})`;
  let thumbnailUrl: string | undefined;
  let duration: number | undefined;

  try {
    const res = await fetchWithTimeout(
      `https://player.vimeo.com/video/${videoId}/config`,
      { headers: { "User-Agent": BROWSER_UA, Referer: "https://vimeo.com/" } },
      6000
    );
    if (res.ok) {
      const cfg = (await res.json()) as {
        video?: { title?: string; duration?: number; thumbs?: Record<string, string> };
        request?: {
          files?: {
            progressive?: Array<{ url?: string; quality?: string }>;
            hls?: { cdns?: Record<string, { url?: string }> };
          };
        };
      };
      if (cfg.video?.title) title = cfg.video.title;
      if (cfg.video?.duration) duration = cfg.video.duration;
      thumbnailUrl = cfg.video?.thumbs?.["640"] || Object.values(cfg.video?.thumbs ?? {})[0];
      for (const prog of cfg.request?.files?.progressive ?? []) {
        addStream(streams, seen, prog.url, prog.quality || "MP4", "mp4");
      }
      for (const cdn of Object.values(cfg.request?.files?.hls?.cdns ?? {})) {
        addStream(streams, seen, cdn.url, "HLS", "hls");
      }
    }
  } catch {
    // fallback to embed
  }

  return {
    sourceUrl: targetUrl.toString(),
    site: "Vimeo",
    title,
    thumbnailUrl,
    duration,
    embedUrl,
    refererOrigin: "https://vimeo.com",
    streams: sortStreams(streams),
  };
}

function buildKnownEmbedUrl(url: URL): { site: string; embedUrl?: string } {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host.includes("nicovideo.jp") || host.includes("nico.ms")) {
    const m = url.href.match(/(sm\d+|so\d+|nm\d+)/);
    if (m) {
      return {
        site: "ニコニコ動画",
        embedUrl: `https://embed.nicovideo.jp/watch/${m[1]}?autoplay=1`,
      };
    }
  }
  if (host.includes("xvideos")) {
    const m = path.match(/video\.([a-z0-9]+)/i) ?? path.match(/video(\d+)/i);
    if (m) {
      return {
        site: "XVideos",
        embedUrl: `https://www.xvideos.com/embedframe/${m[1]}`,
      };
    }
  }
  if (host.includes("pornhub")) {
    const vk = url.searchParams.get("viewkey");
    if (vk) {
      return {
        site: "Pornhub",
        embedUrl: `https://www.pornhub.com/embed/${vk}`,
      };
    }
  }
  if (host.includes("spankbang")) {
    const m = path.match(/^\/([a-z0-9]+)\//i);
    if (m) {
      return {
        site: "SpankBang",
        embedUrl: `https://spankbang.com/${m[1]}/embed/`,
      };
    }
  }
  if (host.includes("xhamster")) {
    const m = path.match(/-(\d+)$/) ?? path.match(/\/videos\/[^/]+-xh([a-z0-9]+)/i);
    if (m) {
      return {
        site: "xHamster",
        embedUrl: `https://xhamster.com/xembed.php?video=${m[1]}`,
      };
    }
  }
  if (host.includes("bilibili.com")) {
    const bv = path.match(/\/(BV[0-9A-Za-z]+)/);
    if (bv) {
      return {
        site: "Bilibili",
        embedUrl: `https://player.bilibili.com/player.html?bvid=${bv[1]}&autoplay=1`,
      };
    }
  }
  if (host.includes("twitch.tv")) {
    const vid = path.match(/\/videos\/(\d+)/);
    if (vid) {
      return {
        site: "Twitch",
        embedUrl: `https://player.twitch.tv/?video=${vid[1]}&parent=localhost`,
      };
    }
  }
  return { site: url.hostname.replace(/^www\./, "") };
}

function extractStreamsAndMetaFromHtml(html: string, pageUrl: URL): {
  title?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  streams: ExtractedStream[];
} {
  const streams: ExtractedStream[] = [];
  const seen = new Set<string>();

  const ogTitle =
    html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i)?.[1] ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  const title = ogTitle ? decodeHtmlEntities(ogTitle) : undefined;

  const ogImage =
    html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)?.[1] ??
    html.match(/<video[^>]+poster=["']([^"']+)["']/i)?.[1];
  let thumbnailUrl: string | undefined;
  if (ogImage) {
    try {
      thumbnailUrl = new URL(decodeHtmlEntities(ogImage), pageUrl).toString();
    } catch {
      // ignore
    }
  }

  let embedUrl: string | undefined;
  const ogVideo =
    html.match(/<meta[^>]+property=["']og:video(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/gi) ??
    [];
  for (const tag of ogVideo) {
    const m = tag.match(/content=["']([^"']+)["']/i);
    if (!m?.[1]) continue;
    const resolved = decodeHtmlEntities(m[1]);
    if (/\.(?:mp4|m3u8|webm)(?:$|[?#])/i.test(resolved)) {
      addStream(streams, seen, resolved, "OG Video");
    } else if (!embedUrl && resolved.startsWith("http")) {
      embedUrl = resolved;
    }
  }

  // Known tube / HTML5 script assignment helpers
  const namedPatterns: Array<{ re: RegExp; quality: string; format?: "mp4" | "hls" }> = [
    { re: /setVideoHLS\(\s*['"]([^'"]+)['"]\s*\)/gi, quality: "HLS", format: "hls" },
    { re: /setVideoUrlHigh\(\s*['"]([^'"]+)['"]\s*\)/gi, quality: "High MP4", format: "mp4" },
    { re: /setVideoUrlLow\(\s*['"]([^'"]+)['"]\s*\)/gi, quality: "SD MP4", format: "mp4" },
    { re: /html5player\.setVideoUrl(?:1080p|720p)\(\s*['"]([^'"]+)['"]\s*\)/gi, quality: "HD MP4", format: "mp4" },
    { re: /"(?:videoUrl|contentUrl|file|src|url|hlsUrl|stream_url)"\s*:\s*"(https?:[^"\\]*(?:\\\/[^"\\]*)*\.(?:mp4|m3u8|webm)[^"\\]*)"/gi, quality: "Stream" },
    { re: /'(?:1080p|720p|480p|360p|240p)'\s*:\s*\[\s*['"]([^'"]+)['"]/gi, quality: "Quality Stream" },
    { re: /<source[^>]+src=["']([^"']+)["']/gi, quality: "Source" },
    { re: /<video[^>]+src=["']([^"']+)["']/gi, quality: "Video" },
  ];

  for (const { re, quality, format } of namedPatterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (!match[1]) continue;
      try {
        const abs = new URL(decodeEscapedUrl(match[1]), pageUrl).toString();
        const qHint = abs.match(/\b(2160p|1080p|720p|480p|360p)\b/i)?.[1] ?? quality;
        addStream(streams, seen, abs, qHint, format);
      } catch {
        // ignore relative parse failure
      }
    }
  }

  // Catch-all literal http(s)://...mp4 or ...m3u8 URLs in HTML/inline JSON
  const genericMediaRe = /https?:\\?\/\\?\/[^\s"'<>\\`]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\`]*)?/gi;
  let gm: RegExpExecArray | null;
  let count = 0;
  while ((gm = genericMediaRe.exec(html)) !== null && count < 30) {
    count += 1;
    const raw = gm[0];
    const qHint = raw.match(/\b(2160p|1080p|720p|480p|360p)\b/i)?.[1] ?? "Auto";
    addStream(streams, seen, raw, qHint);
  }

  // Extract mediaDefinitions JSON blocks cleanly if present
  const mediaDefRe = /"videoUrl"\s*:\s*"([^"]+)"[\s\S]{0,160}?"quality"\s*:\s*"?(\d{3,4}p?)"?/gi;
  let md: RegExpExecArray | null;
  while ((md = mediaDefRe.exec(html)) !== null) {
    const qLabel = /^\d+$/.test(md[2]) ? `${md[2]}p` : md[2];
    addStream(streams, seen, md[1], qLabel);
  }

  return {
    title,
    thumbnailUrl,
    embedUrl,
    streams: sortStreams(streams),
  };
}

async function tryGenericHtmlExtract(targetUrl: URL): Promise<ExtractedVideoInfo> {
  const known = buildKnownEmbedUrl(targetUrl);
  const streams: ExtractedStream[] = [];
  let title = known.site;
  let thumbnailUrl: string | undefined;
  let embedUrl = known.embedUrl;

  try {
    const res = await fetchWithTimeout(
      targetUrl.toString(),
      {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
          Referer: `${targetUrl.origin}/`,
        },
      },
      7500
    );

    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.startsWith("video/") || contentType.includes("mpegurl")) {
        const seen = new Set<string>();
        addStream(streams, seen, res.url || targetUrl.toString(), "Direct");
        return {
          sourceUrl: targetUrl.toString(),
          site: known.site,
          title: decodeURIComponent(targetUrl.pathname.split("/").pop() || "Video"),
          refererOrigin: targetUrl.origin,
          streams,
        };
      }
      if (contentType.includes("html") || contentType.includes("text/plain") || !contentType) {
        const rawText = await res.text();
        const cappedHtml = rawText.slice(0, 1_800_000);
        const finalUrl = parseSafePublicUrl(res.url || targetUrl.toString()) ?? targetUrl;
        const parsed = extractStreamsAndMetaFromHtml(cappedHtml, finalUrl);
        if (parsed.title) title = parsed.title;
        if (parsed.thumbnailUrl) thumbnailUrl = parsed.thumbnailUrl;
        if (!embedUrl && parsed.embedUrl) embedUrl = parsed.embedUrl;
        streams.push(...parsed.streams);
      }
    }
  } catch {
    // ignore fetch error; may still have embedUrl
  }

  return {
    sourceUrl: targetUrl.toString(),
    site: known.site,
    title,
    thumbnailUrl,
    embedUrl,
    refererOrigin: targetUrl.origin,
    streams,
    note:
      streams.length === 0 && !embedUrl
        ? "このページから直接ストリームを取得できませんでした（ログイン必須または DRM / Bot 保護サイトの可能性があります。PC では local companion の url_server.py (yt-dlp) を起動すると取得できる場合があります）。"
        : undefined,
  };
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (context.request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const reqUrl = new URL(context.request.url);
  const rawTarget = reqUrl.searchParams.get("url") ?? "";
  const targetUrl = parseSafePublicUrl(rawTarget);
  if (!targetUrl) {
    return jsonResponse({ error: "有効な http:// または https:// URL を指定してください。" }, 400);
  }

  const host = targetUrl.hostname.toLowerCase();

  // Direct video / HLS file link
  if (/\.(?:mp4|m3u8|webm|mov)(?:$|[?#])/i.test(targetUrl.pathname)) {
    const fileName = decodeURIComponent(targetUrl.pathname.split("/").pop() || "External Video");
    return jsonResponse({
      sourceUrl: targetUrl.toString(),
      site: host.replace(/^www\./, ""),
      title: fileName.replace(/\.[^.]+$/, "") || "External Video",
      refererOrigin: targetUrl.origin,
      streams: [
        {
          url: targetUrl.toString(),
          quality: "Direct",
          format: inferStreamFormat(targetUrl.toString()),
        },
      ],
    } satisfies ExtractedVideoInfo);
  }

  const ytId = extractYouTubeId(targetUrl);
  if (ytId) {
    return jsonResponse(await tryExtractYouTube(targetUrl, ytId));
  }

  if (host.includes("x.com") || host.includes("twitter.com") || host.includes("vxtwitter") || host.includes("fxtwitter")) {
    const xResult = await tryExtractTwitter(targetUrl);
    if (xResult) return jsonResponse(xResult);
  }

  if (host.includes("tiktok.com")) {
    const ttResult = await tryExtractTikTok(targetUrl);
    if (ttResult) return jsonResponse(ttResult);
  }

  if (host.includes("reddit.com") || host.includes("redd.it")) {
    const rdResult = await tryExtractReddit(targetUrl);
    if (rdResult) return jsonResponse(rdResult);
  }

  if (host.includes("dailymotion.com") || host.includes("dai.ly")) {
    const dmResult = await tryExtractDailymotion(targetUrl);
    if (dmResult) return jsonResponse(dmResult);
  }

  if (host.includes("vimeo.com")) {
    const vmResult = await tryExtractVimeo(targetUrl);
    if (vmResult) return jsonResponse(vmResult);
  }

  return jsonResponse(await tryGenericHtmlExtract(targetUrl));
}
