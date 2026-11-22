#!/usr/bin/env python3
"""
VaultStream Optional Local URL Companion Server (127.0.0.1:8787)
Powered by yt-dlp so PC browser users can play & download videos from 1,800+ sites
directly inside VaultStream PWA with full quality & E2EE Drive saving.

Install & run:
  pip install yt-dlp
  python url_server.py
"""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

try:
    import yt_dlp  # type: ignore
except ImportError:
    yt_dlp = None

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def add_cors_headers(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
    handler.send_header("Access-Control-Allow-Private-Network", "true")
    handler.send_header(
        "Access-Control-Expose-Headers",
        "Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition",
    )


def build_proxy_url(proxy_origin: str, target_url: str, referer: str | None = None) -> str:
    q = {"url": target_url}
    if referer:
        q["referer"] = referer
    return f"{proxy_origin}/api/proxy?{urllib.parse.urlencode(q)}"


def rewrite_m3u8(text: str, base_url: str, proxy_origin: str, referer: str | None) -> str:
    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out_lines.append(line)
            continue
        if stripped.startswith("#"):
            def repl(match: re.Match[str]) -> str:
                raw_uri = match.group(1)
                abs_uri = urllib.parse.urljoin(base_url, raw_uri)
                return f'URI="{build_proxy_url(proxy_origin, abs_uri, referer)}"'

            out_lines.append(re.sub(r'URI="([^"]+)"', repl, line, flags=re.IGNORECASE))
        else:
            abs_uri = urllib.parse.urljoin(base_url, stripped)
            out_lines.append(build_proxy_url(proxy_origin, abs_uri, referer))
    return "\n".join(out_lines)


def extract_with_ytdlp(target_url: str) -> dict:
    assert yt_dlp is not None
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "http_headers": {"User-Agent": BROWSER_UA},
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(target_url, download=False)
        if isinstance(info, dict) and info.get("entries"):
            entries = [e for e in info["entries"] if e]
            if entries:
                info = entries[0]

    if not isinstance(info, dict):
        raise ValueError("メディア情報を取得できませんでした。")

    streams: list[dict] = []
    seen: set[str] = set()
    formats = info.get("formats") or []

    def add_fmt(fmt: dict, rank_hint: int = 0) -> None:
        url = fmt.get("url")
        if not url or not str(url).startswith(("http://", "https://")):
            return
        if url in seen:
            return
        ext = (fmt.get("ext") or "mp4").lower()
        protocol = (fmt.get("protocol") or "").lower()
        is_hls = "m3u8" in protocol or ".m3u8" in url.lower()
        vcodec = fmt.get("vcodec") or ""
        acodec = fmt.get("acodec") or ""
        if vcodec == "none" and acodec != "none":
            return  # skip audio-only for direct player
        has_both = (vcodec != "none" and acodec != "none") or is_hls
        if not has_both and ext not in ("mp4", "webm"):
            return

        height = fmt.get("height")
        q_label = fmt.get("format_note") or (f"{height}p" if height else "Auto")
        stream_format = "hls" if is_hls else ("webm" if ext == "webm" else "mp4")
        seen.add(url)
        streams.append({
            "url": url,
            "quality": str(q_label),
            "format": stream_format,
            "_score": (1000 if (has_both and stream_format == "mp4") else 500) + int(height or 0) + rank_hint,
        })

    for fmt in formats:
        add_fmt(fmt)

    if info.get("url") and not streams:
        add_fmt({"url": info["url"], "ext": info.get("ext", "mp4"), "height": info.get("height")}, 10)

    streams.sort(key=lambda x: x.get("_score", 0), reverse=True)
    for st in streams:
        st.pop("_score", None)

    parsed_src = urllib.parse.urlparse(target_url)
    return {
        "sourceUrl": target_url,
        "site": info.get("extractor_key") or parsed_src.netloc,
        "title": info.get("title") or parsed_src.netloc,
        "thumbnailUrl": info.get("thumbnail"),
        "duration": info.get("duration"),
        "refererOrigin": f"{parsed_src.scheme}://{parsed_src.netloc}",
        "streams": streams[:12],
    }


class CompanionHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: object) -> None:
        return  # Keep console clean

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        add_cors_headers(self)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        add_cors_headers(self)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        proxy_origin = f"http://{self.headers.get('Host') or '127.0.0.1:8787'}"

        if parsed.path == "/api/health":
            self.send_json({"ok": True, "yt_dlp": yt_dlp is not None})
            return

        if parsed.path == "/api/extract":
            if yt_dlp is None:
                self.send_json({"error": "yt-dlp がインストールされていません (pip install yt-dlp)"}, 500)
                return
            target = (params.get("url") or [""])[0].strip()
            if not target.startswith(("http://", "https://")):
                self.send_json({"error": "有効な URL を指定してください"}, 400)
                return
            try:
                data = extract_with_ytdlp(target)
                self.send_json(data)
            except Exception as exc:  # noqa: BLE001
                self.send_json({"error": str(exc)}, 502)
            return

        if parsed.path == "/api/proxy":
            target = (params.get("url") or [""])[0].strip()
            referer = (params.get("referer") or [""])[0].strip() or None
            dl_mode = (params.get("dl") or ["0"])[0] == "1"
            filename = (params.get("filename") or ["video.mp4"])[0]
            if not target.startswith(("http://", "https://")):
                self.send_json({"error": "Invalid URL"}, 400)
                return

            headers = {"User-Agent": BROWSER_UA, "Accept": "*/*"}
            if referer:
                ref_u = urllib.parse.urlparse(referer)
                origin = f"{ref_u.scheme}://{ref_u.netloc}"
                headers["Referer"] = f"{origin}/"
                headers["Origin"] = origin
            rng = self.headers.get("Range")
            if rng:
                headers["Range"] = rng

            req = urllib.request.Request(target, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    ct = resp.headers.get("Content-Type") or "application/octet-stream"
                    final_url = resp.geturl()
                    looks_m3u8 = "mpegurl" in ct.lower() or ".m3u8" in final_url.lower()

                    if looks_m3u8:
                        raw_text = resp.read().decode("utf-8", errors="replace")
                        if "#EXTM3U" in raw_text:
                            rewritten = rewrite_m3u8(raw_text, final_url, proxy_origin, referer or target)
                            payload = rewritten.encode("utf-8")
                            self.send_response(200)
                            add_cors_headers(self)
                            self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
                            self.send_header("Content-Length", str(len(payload)))
                            self.end_headers()
                            self.wfile.write(payload)
                            return
                        payload = raw_text.encode("utf-8")
                        self.send_response(resp.status)
                        add_cors_headers(self)
                        self.send_header("Content-Type", ct)
                        self.send_header("Content-Length", str(len(payload)))
                        self.end_headers()
                        self.wfile.write(payload)
                        return

                    self.send_response(resp.status)
                    add_cors_headers(self)
                    self.send_header("Content-Type", ct)
                    for h in ("Content-Length", "Content-Range", "Accept-Ranges"):
                        val = resp.headers.get(h)
                        if val:
                            self.send_header(h, val)
                    if dl_mode:
                        encoded_fn = urllib.parse.quote(filename)
                        self.send_header(
                            "Content-Disposition",
                            f'attachment; filename="video.mp4"; filename*=UTF-8\'\'{encoded_fn}',
                        )
                    self.end_headers()
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except urllib.error.HTTPError as exc:
                self.send_json({"error": f"Upstream HTTP {exc.code}"}, exc.code)
            except Exception as exc:  # noqa: BLE001
                self.send_json({"error": str(exc)}, 502)
            return

        self.send_json({"error": "Not found"}, 404)


def main() -> None:
    parser = argparse.ArgumentParser(description="VaultStream local yt-dlp companion server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    if yt_dlp is None:
        print("[WARN] yt-dlp is not installed yet. Run: pip install yt-dlp", file=sys.stderr)
    server = ThreadingHTTPServer((args.host, args.port), CompanionHandler)
    print(f"VaultStream URL Companion listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
