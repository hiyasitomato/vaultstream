"use client";

import Hls from "hls.js";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Download,
  ExternalLink,
  Film,
  Globe,
  HardDriveUpload,
  Loader2,
  Lock,
  Play,
  ShieldCheck,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createVaultConfig, unlockVaultWithPassphrase } from "@/lib/crypto";
import { formatBytes, saveVaultConfigToDrive } from "@/lib/drive";
import {
  buildProxiedStreamUrl,
  downloadExternalStreamToBlob,
  loadRecentExternalUrls,
  type RecentExternalItem,
  removeRecentExternalUrl,
  resolveExternalVideoUrl,
  sanitizeFilenameBase,
  saveRecentExternalUrl,
  triggerBrowserFileDownload,
  type ExtractedVideoInfo,
  type ExternalDownloadProgress,
} from "@/lib/externalVideo";
import { savePassphrase } from "@/lib/storage";
import type { VaultConfig, VaultVideoItem } from "@/lib/types";
import { uploadVideoFromBrowser, type BrowserUploadProgress } from "@/lib/uploader";

interface ExternalUrlModalProps {
  initialUrl?: string;
  accessToken: string | null;
  rootFolderId: string;
  vaultConfig: VaultConfig | null;
  masterKey: CryptoKey | null;
  onVaultInitialized: (config: VaultConfig, key: CryptoKey) => void;
  onVideoSavedToVault: (item: VaultVideoItem) => void;
  onClose: () => void;
}

export default function ExternalUrlModal({
  initialUrl = "",
  accessToken,
  rootFolderId,
  vaultConfig,
  masterKey,
  onVaultInitialized,
  onVideoSavedToVault,
  onClose,
}: ExternalUrlModalProps) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [info, setInfo] = useState<ExtractedVideoInfo | null>(null);
  const [selectedStreamIdx, setSelectedStreamIdx] = useState(0);
  const [playerMode, setPlayerMode] = useState<"stream" | "embed">("stream");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [streamWarning, setStreamWarning] = useState<string | null>(null);

  const [busyMode, setBusyMode] = useState<"download" | "vault" | null>(null);
  const [dlProgress, setDlProgress] = useState<ExternalDownloadProgress | null>(null);
  const [vaultProgress, setVaultProgress] = useState<BrowserUploadProgress | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [vaultPassInput, setVaultPassInput] = useState("");
  const [recentItems, setRecentItems] = useState<RecentExternalItem[]>(() =>
    loadRecentExternalUrls()
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedStream = useMemo(() => {
    if (!info || info.streams.length === 0) return null;
    return info.streams[selectedStreamIdx] ?? info.streams[0];
  }, [info, selectedStreamIdx]);

  const handleResolve = useCallback(async (overrideUrl?: string) => {
    const raw = (overrideUrl ?? urlInput).trim();
    if (!raw) return;
    if (overrideUrl) setUrlInput(overrideUrl);

    setResolving(true);
    setResolveError(null);
    setStreamWarning(null);
    setActionError(null);
    setActionMessage(null);
    try {
      const resolved = await resolveExternalVideoUrl(raw);
      setInfo(resolved);
      setSelectedStreamIdx(0);
      setPlayerMode(resolved.streams.length > 0 ? "stream" : "embed");
      const updated = saveRecentExternalUrl({
        url: resolved.sourceUrl,
        title: resolved.title,
        site: resolved.site,
        thumbnailUrl: resolved.thumbnailUrl,
        addedAt: Date.now(),
      });
      setRecentItems(updated);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "URL の解析に失敗しました。");
    } finally {
      setResolving(false);
    }
  }, [urlInput]);

  // Auto-resolve initialUrl if provided when opening modal
  useEffect(() => {
    if (initialUrl.trim()) {
      void handleResolve(initialUrl.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel active downloads and destroy HLS instance on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, []);

  // Attach stream player (HTML5 video or hls.js)
  useEffect(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (playerMode !== "stream" || !info || !selectedStream) {
      videoEl.removeAttribute("src");
      videoEl.load();
      return;
    }

    const playUrl = buildProxiedStreamUrl(selectedStream.url, info);
    setStreamWarning(null);

    const triggerFallback = (reason: string) => {
      if (info.embedUrl) {
        setStreamWarning(`${reason} 埋め込みプレーヤーへ自動で切り替えました。`);
        setPlayerMode("embed");
      } else {
        setStreamWarning(reason);
      }
    };

    if (selectedStream.format === "hls") {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            hls.destroy();
            hlsRef.current = null;
            triggerFallback("HLS ストリームを直接再生できませんでした。");
          }
        });
        hls.loadSource(playUrl);
        hls.attachMedia(videoEl);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoEl.playbackRate = playbackRate;
          void videoEl.play().catch(() => undefined);
        });
      } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        videoEl.src = playUrl;
        videoEl.playbackRate = playbackRate;
        void videoEl.play().catch(() => undefined);
      } else {
        triggerFallback("お使いのブラウザは HLS 直接再生に対応していません。");
      }
    } else {
      videoEl.src = playUrl;
      videoEl.playbackRate = playbackRate;
      void videoEl.play().catch(() => undefined);
    }

    const onVideoError = () => {
      triggerFallback("動画ストリームの読み込みに失敗しました。");
    };
    videoEl.addEventListener("error", onVideoError);

    return () => {
      videoEl.removeEventListener("error", onVideoError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [info, selectedStream, playerMode, playbackRate]);

  const handlePasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) {
        setUrlInput(clip.trim());
        void handleResolve(clip.trim());
      }
    } catch {
      setResolveError("クリップボードの読み取り権限がありません。入力欄に直接貼り付けてください。");
    }
  };

  const handleCancelBusy = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusyMode(null);
    setDlProgress(null);
    setVaultProgress(null);
  };

  const handleDownloadToDevice = async () => {
    if (!info || !selectedStream || busyMode) return;
    setBusyMode("download");
    setActionError(null);
    setActionMessage(null);
    setDlProgress({
      phase: "resolving",
      percent: 1,
      loadedBytes: 0,
      detail: "ダウンロードを準備中...",
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await downloadExternalStreamToBlob(
        selectedStream,
        info,
        (p) => setDlProgress(p),
        controller.signal
      );
      triggerBrowserFileDownload(result.blob, result.filename);
      setActionMessage(
        `ダウンロード完了: ${result.filename} (${formatBytes(result.blob.size)})`
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setActionError(
          err instanceof Error
            ? err.message
            : "ダウンロードに失敗しました。下の「直リンクDL」ボタンもお試しください。"
        );
      }
    } finally {
      abortRef.current = null;
      setBusyMode(null);
      setDlProgress(null);
    }
  };

  const handleSaveToVault = async () => {
    if (!info || !selectedStream || busyMode) return;
    if (!accessToken || !rootFolderId) {
      setActionError("Vault (Google Drive) へ保存するには先に Google ログインしてください。");
      return;
    }

    let activeKey = masterKey;
    if (vaultConfig && !activeKey) {
      if (!vaultPassInput.trim()) {
        setActionError("保存するには下に Vault のマスターパスワードを入力してください。");
        return;
      }
      try {
        activeKey = await unlockVaultWithPassphrase(vaultPassInput.trim(), vaultConfig);
        savePassphrase(vaultPassInput.trim());
        onVaultInitialized(vaultConfig, activeKey);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "マスターパスワードが正しくありません。");
        return;
      }
    } else if (!vaultConfig && !activeKey) {
      const pass = vaultPassInput.trim();
      if (pass.length < 4) {
        setActionError("新規 Vault 用のマスターパスワード（4文字以上）を下に入力してください。");
        return;
      }
      const { config, masterKey: derivedKey } = await createVaultConfig(pass);
      await saveVaultConfigToDrive(rootFolderId, config, accessToken);
      savePassphrase(pass);
      onVaultInitialized(config, derivedKey);
      activeKey = derivedKey;
    }

    setBusyMode("vault");
    setActionError(null);
    setActionMessage(null);
    setDlProgress({
      phase: "resolving",
      percent: 1,
      loadedBytes: 0,
      detail: "外部動画をブラウザへ取得中...",
    });
    setVaultProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await downloadExternalStreamToBlob(
        selectedStream,
        info,
        (p) => setDlProgress(p),
        controller.signal
      );
      setDlProgress(null);
      const file = new File([result.blob], result.filename, {
        type: result.mimeType || "video/mp4",
      });
      const savedItem = await uploadVideoFromBrowser({
        file,
        title: info.title,
        rootFolderId,
        accessToken,
        masterKey: activeKey,
        onProgress: (vp) => setVaultProgress(vp),
      });
      onVideoSavedToVault(savedItem);
      setActionMessage(`暗号化して Google Drive (Vault) に保存しました: ${savedItem.title}`);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setActionError(
          err instanceof Error ? err.message : "Vault への暗号化保存に失敗しました。"
        );
      }
    } finally {
      abortRef.current = null;
      setBusyMode(null);
      setDlProgress(null);
      setVaultProgress(null);
    }
  };

  const directDownloadHref = useMemo(() => {
    if (!info || !selectedStream || selectedStream.format === "hls" || !info.proxyOrigin) {
      return null;
    }
    const ext = selectedStream.format === "webm" ? "webm" : "mp4";
    return buildProxiedStreamUrl(selectedStream.url, info, {
      downloadFilename: `${sanitizeFilenameBase(info.title)}.${ext}`,
    });
  }, [info, selectedStream]);

  const backendBadge = useMemo(() => {
    if (!info) return null;
    if (info.backend === "local_ytdlp") {
      return { label: "PC yt-dlp 接続中", cls: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" };
    }
    if (info.backend === "edge_proxy") {
      return { label: "Cloudflare 高速プロキシ", cls: "border-sky-500/40 bg-sky-500/15 text-sky-200" };
    }
    return { label: "ブラウザ直接解析", cls: "border-zinc-700 bg-zinc-800 text-zinc-300" };
  }, [info]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label="外部動画 URL 再生・ダウンロード"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
              <Globe className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">外部サイト URL 再生 ＆ ダウンロード</h2>
              <p className="text-[11px] text-zinc-400">
                YouTube / X / TikTok / 各種動画サイト / 直リンク (.mp4 / .m3u8) に対応
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* URL Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleResolve();
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://... 動画ページの URL または .mp4 / .m3u8 リンクを貼り付け"
                autoFocus
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-3.5 pr-20 text-xs text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none sm:text-sm"
              />
              <button
                type="button"
                onClick={() => void handlePasteClipboard()}
                className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-700"
              >
                <ClipboardPaste className="h-3 w-3 text-rose-400" />
                <span>貼付</span>
              </button>
            </div>
            <button
              type="submit"
              disabled={resolving || !urlInput.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm shadow-rose-600/30 transition hover:bg-rose-500 disabled:opacity-50"
            >
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span>{resolving ? "解析中..." : "読み込んで再生"}</span>
            </button>
          </form>

          {resolveError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-950/30 p-3 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{resolveError}</span>
            </div>
          )}

          {/* Extracted Video Player & Actions */}
          {info && (
            <div className="space-y-3 rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-3.5 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 font-semibold text-zinc-200">
                      {info.site}
                    </span>
                    {backendBadge && (
                      <span className={`rounded border px-2 py-0.5 font-medium ${backendBadge.cls}`}>
                        {backendBadge.label}
                      </span>
                    )}
                    {info.duration ? (
                      <span className="font-mono text-zinc-400">
                        {Math.floor(info.duration / 60)}:{String(Math.floor(info.duration % 60)).padStart(2, "0")}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-1.5 truncate text-sm font-bold text-white">{info.title}</h3>
                </div>

                {/* Mode switcher + speed + source link */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {info.streams.length > 0 && info.embedUrl && (
                    <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPlayerMode("stream")}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                          playerMode === "stream" ? "bg-rose-600 text-white" : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        <Film className="h-3 w-3" />
                        <span>直接再生</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPlayerMode("embed")}
                        className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                          playerMode === "embed" ? "bg-rose-600 text-white" : "text-zinc-400 hover:text-white"
                        }`}
                      >
                        <Tv className="h-3 w-3" />
                        <span>埋め込み</span>
                      </button>
                    </div>
                  )}
                  <a
                    href={info.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-zinc-600 hover:text-white"
                  >
                    <span>元ページ</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              {streamWarning && (
                <div className="rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
                  {streamWarning}
                </div>
              )}

              {info.note && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-950/25 px-3 py-2 text-[11px] text-sky-200">
                  {info.note}
                </div>
              )}

              {/* Player Viewport */}
              <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black">
                {playerMode === "stream" && selectedStream ? (
                  <video
                    ref={videoRef}
                    controls
                    playsInline
                    poster={info.thumbnailUrl}
                    className="aspect-video w-full bg-black"
                  />
                ) : info.embedUrl ? (
                  <iframe
                    src={info.embedUrl}
                    title={info.title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="aspect-video w-full border-0"
                  />
                ) : (
                  <div className="flex aspect-video flex-col items-center justify-center gap-2 p-6 text-center text-xs text-zinc-400">
                    <AlertCircle className="h-7 w-7 text-zinc-500" />
                    <p>このページから再生可能な動画ストリームが見つかりませんでした。</p>
                    <a
                      href={info.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-zinc-100 hover:bg-zinc-700"
                    >
                      <span>新しいタブで元ページを開く</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Stream Quality & Speed Controls */}
              {info.streams.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-zinc-400">画質 / ストリーム:</span>
                    {info.streams.map((st, idx) => {
                      const active = idx === selectedStreamIdx;
                      return (
                        <button
                          key={`${st.url}-${idx}`}
                          type="button"
                          onClick={() => {
                            setSelectedStreamIdx(idx);
                            setPlayerMode("stream");
                          }}
                          className={`rounded-lg border px-2.5 py-1 font-medium transition ${
                            active
                              ? "border-rose-500 bg-rose-600/25 text-rose-200"
                              : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700"
                          }`}
                        >
                          {st.quality} ({st.format.toUpperCase()})
                        </button>
                      );
                    })}
                  </div>

                  {playerMode === "stream" && (
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-400">速度:</span>
                      {[1, 1.25, 1.5, 2].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => {
                            setPlaybackRate(rate);
                            if (videoRef.current) videoRef.current.playbackRate = rate;
                          }}
                          className={`rounded px-2 py-0.5 font-mono transition ${
                            playbackRate === rate
                              ? "bg-zinc-700 text-white"
                              : "bg-zinc-900 text-zinc-400 hover:text-white"
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Vault unlock prompt if saving needs key */}
              {accessToken && selectedStream && !masterKey && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-xs">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <input
                    type="password"
                    value={vaultPassInput}
                    onChange={(e) => setVaultPassInput(e.target.value)}
                    placeholder={
                      vaultConfig
                        ? "Drive 暗号化保存を使う場合は Vault パスワードを入力"
                        : "初回 Vault 保存用パスワード (4文字以上)"
                    }
                    className="min-w-[220px] flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Download & Vault Save Buttons */}
              {selectedStream && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busyMode !== null}
                    onClick={() => void handleDownloadToDevice()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm shadow-emerald-600/25 transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {busyMode === "download" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {selectedStream.format === "hls"
                        ? "HLS を結合して端末に保存"
                        : "端末にダウンロード"}
                    </span>
                  </button>

                  {directDownloadHref && (
                    <a
                      href={directDownloadHref}
                      download={`${sanitizeFilenameBase(info.title)}.${selectedStream.format === "webm" ? "webm" : "mp4"}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white"
                      title="大容量ファイルをプロキシ直リンクで高速保存"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-cyan-400" />
                      <span>プロキシ直リンク DL</span>
                    </a>
                  )}

                  {accessToken && rootFolderId && (
                    <button
                      type="button"
                      disabled={busyMode !== null}
                      onClick={() => void handleSaveToVault()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                    >
                      {busyMode === "vault" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <HardDriveUpload className="h-3.5 w-3.5" />
                      )}
                      <span>Vault (Google Drive) に暗号化保存</span>
                    </button>
                  )}

                  {busyMode && (
                    <button
                      type="button"
                      onClick={handleCancelBusy}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
                    >
                      中止
                    </button>
                  )}
                </div>
              )}

              {/* Live Download / Vault Upload Progress Bar */}
              {(dlProgress || vaultProgress) && (
                <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-xs">
                  <div className="flex items-center justify-between text-[11px] text-zinc-300">
                    <span>{vaultProgress?.detail ?? dlProgress?.detail}</span>
                    <span className="font-mono font-bold text-emerald-300">
                      {vaultProgress?.percent ?? dlProgress?.percent ?? 0}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-[width] duration-200"
                      style={{ width: `${vaultProgress?.percent ?? dlProgress?.percent ?? 0}%` }}
                    />
                  </div>
                </div>
              )}

              {actionMessage && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{actionMessage}</span>
                </div>
              )}

              {actionError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-950/30 p-3 text-xs text-rose-200">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{actionError}</span>
                </div>
              )}
            </div>
          )}

          {/* Optional Local Companion Note */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3 text-[11px] leading-relaxed text-zinc-400">
            <p className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-sky-400" />
              ヒント: PC でより多くのサイトを高画質 DL したい場合
            </p>
            <p className="mt-1">
              PC で <code className="text-zinc-200">python packer/url_server.py</code>（<code className="text-zinc-200">yt-dlp</code> 同梱サーバー）を起動しておくと、この画面が自動検出して 1,800 以上の動画サイトから最高画質を直接取得・保存できるようになります。
            </p>
          </div>

          {/* Recent External URLs History */}
          {recentItems.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-zinc-400">最近開いた外部 URL</h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {recentItems.map((item) => (
                  <div
                    key={item.url}
                    className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 px-3 py-2 text-xs transition hover:border-zinc-700"
                  >
                    <button
                      type="button"
                      onClick={() => void handleResolve(item.url)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate font-medium text-zinc-200 hover:text-white">
                        {item.title}
                      </p>
                      <p className="truncate text-[10px] text-zinc-500">
                        {item.site} ・ {item.url}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRecentItems(removeRecentExternalUrl(item.url))}
                      className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                      aria-label="履歴から削除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
