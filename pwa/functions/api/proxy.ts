const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
};

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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

function buildProxyUrl(proxyOrigin: string, targetUrl: string, referer?: string): string {
  const params = new URLSearchParams({ url: targetUrl });
  if (referer) params.set("referer", referer);
  return `${proxyOrigin}/api/proxy?${params.toString()}`;
}

function rewriteM3u8Playlist(
  text: string,
  playlistUrl: URL,
  proxyOrigin: string,
  referer?: string
): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/gi, (_, rawUri: string) => {
          try {
            const abs = new URL(rawUri, playlistUrl).toString();
            if (!parseSafePublicUrl(abs)) return `URI="${rawUri}"`;
            return `URI="${buildProxyUrl(proxyOrigin, abs, referer)}"`;
          } catch {
            return `URI="${rawUri}"`;
          }
        });
      }
      try {
        const abs = new URL(trimmed, playlistUrl).toString();
        if (!parseSafePublicUrl(abs)) return line;
        return buildProxyUrl(proxyOrigin, abs, referer);
      } catch {
        return line;
      }
    })
    .join("\n");
}

function sanitizeDownloadFilename(raw: string): string {
  const clean = raw.replace(/[\\/:*?"<>|\r\n]+/g, "_").trim() || "video.mp4";
  return encodeURIComponent(clean).replace(/['()]/g, escape);
}

export async function onRequest(context: { request: Request }): Promise<Response> {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const reqUrl = new URL(context.request.url);
  const rawTarget = reqUrl.searchParams.get("url") ?? "";
  const targetUrl = parseSafePublicUrl(rawTarget);
  if (!targetUrl) {
    return new Response("Invalid or blocked target URL", { status: 400, headers: CORS_HEADERS });
  }

  const rawReferer = reqUrl.searchParams.get("referer") ?? "";
  const safeReferer = parseSafePublicUrl(rawReferer);
  const downloadMode = reqUrl.searchParams.get("dl") === "1";
  const filename = reqUrl.searchParams.get("filename") ?? "video.mp4";

  const upstreamHeaders = new Headers({
    "User-Agent": BROWSER_UA,
    Accept: "*/*",
  });
  if (safeReferer) {
    upstreamHeaders.set("Referer", `${safeReferer.origin}/`);
    upstreamHeaders.set("Origin", safeReferer.origin);
  }
  const rangeHeader = context.request.headers.get("Range");
  if (rangeHeader) {
    upstreamHeaders.set("Range", rangeHeader);
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl.toString(), {
      method: context.request.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });
  } catch (err) {
    return new Response(
      `Upstream fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 502, headers: CORS_HEADERS }
    );
  }

  const finalUrl = parseSafePublicUrl(upstreamRes.url || targetUrl.toString());
  if (!finalUrl) {
    return new Response("Blocked redirect destination", { status: 403, headers: CORS_HEADERS });
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "application/octet-stream";
  const looksLikeM3u8 =
    /mpegurl/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(finalUrl.pathname);

  if (looksLikeM3u8 && upstreamRes.ok && context.request.method === "GET") {
    const playlistText = await upstreamRes.text();
    if (playlistText.includes("#EXTM3U")) {
      const rewritten = rewriteM3u8Playlist(
        playlistText,
        finalUrl,
        reqUrl.origin,
        safeReferer?.origin || targetUrl.origin
      );
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "no-store",
          ...CORS_HEADERS,
        },
      });
    }
    return new Response(playlistText, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": contentType,
        ...CORS_HEADERS,
      },
    });
  }

  const resHeaders = new Headers(CORS_HEADERS);
  resHeaders.set("Content-Type", contentType);
  const copyHeaders = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];
  for (const h of copyHeaders) {
    const val = upstreamRes.headers.get(h);
    if (val) resHeaders.set(h, val);
  }
  if (!resHeaders.has("Accept-Ranges")) {
    resHeaders.set("Accept-Ranges", "bytes");
  }
  if (downloadMode) {
    resHeaders.set(
      "Content-Disposition",
      `attachment; filename="video.mp4"; filename*=UTF-8''${sanitizeDownloadFilename(filename)}`
    );
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: resHeaders,
  });
}
