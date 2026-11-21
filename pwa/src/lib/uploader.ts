import { encryptAesGcmBytes, encryptAesGcmText } from "./crypto";
import { createDriveFolder, uploadFileResumableToDrive } from "./drive";
import type { VaultManifest, VaultVideoItem } from "./types";

export interface BrowserUploadProgress {
  stage: "probing" | "thumbnail" | "sprite" | "encrypting" | "uploading" | "finalizing";
  percent: number;
  detail: string;
}

interface ProbedVideoAssets {
  duration: number;
  width: number;
  height: number;
  thumbnailBytes: Uint8Array | null;
  spriteBytes: Uint8Array | null;
}

function randomHex(byteCount = 8): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(byteCount));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateUuid(): string {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${randomHex(4)}-${randomHex(2)}-${randomHex(2)}-${randomHex(2)}-${randomHex(6)}`;
}

function seekVideoTo(video: HTMLVideoElement, timeSec: number, timeoutMs = 4500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = Math.max(0, timeSec);
    } catch {
      finish(false);
    }
  });
}

async function canvasToJpegBytes(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

async function extractBrowserVideoAssets(
  file: File,
  onProgress?: (p: BrowserUploadProgress) => void
): Promise<ProbedVideoAssets> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = objectUrl;

  try {
    onProgress?.({ stage: "probing", percent: 5, detail: "動画情報を解析中..." });

    const loaded = await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 12000);
      video.onloadeddata = () => finish(true);
      video.onloadedmetadata = () => {
        if (video.readyState >= 2) finish(true);
      };
      video.onerror = () => finish(false);
      video.load();
    });

    if (!loaded || !Number.isFinite(video.duration)) {
      return {
        duration: 0,
        width: 0,
        height: 0,
        thumbnailBytes: null,
        spriteBytes: null,
      };
    }

    const duration = Math.round(video.duration * 100) / 100;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;

    // 1. Capture 640px thumbnail
    let thumbnailBytes: Uint8Array | null = null;
    if (width > 0 && height > 0) {
      onProgress?.({ stage: "thumbnail", percent: 12, detail: "サムネイル生成中..." });
      const thumbSeek = duration > 2 ? Math.min(Math.max(duration * 0.1, 1), 15) : 0;
      const ok = await seekVideoTo(video, thumbSeek, 5000);
      if (ok || video.readyState >= 2) {
        const targetW = 640;
        const targetH = Math.max(2, Math.round((height / width) * targetW));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, targetW, targetH);
          thumbnailBytes = await canvasToJpegBytes(canvas, 0.85);
        }
      }
    }

    // 2. Capture 6x6 (36-frame) hover storyboard sprite sheet (best-effort within 18s budget)
    let spriteBytes: Uint8Array | null = null;
    if (width > 0 && height > 0 && duration > 1) {
      onProgress?.({
        stage: "sprite",
        percent: 18,
        detail: "6×6 プレビュー画像を生成中...",
      });
      const tileW = 160;
      const tileH = 90;
      const spriteCanvas = document.createElement("canvas");
      spriteCanvas.width = tileW * 6;
      spriteCanvas.height = tileH * 6;
      const sctx = spriteCanvas.getContext("2d");

      if (sctx) {
        sctx.fillStyle = "#000000";
        sctx.fillRect(0, 0, spriteCanvas.width, spriteCanvas.height);

        const aspect = width / height;
        const targetAspect = tileW / tileH;
        let drawW = tileW;
        let drawH = tileH;
        let offsetX = 0;
        let offsetY = 0;
        if (aspect > targetAspect) {
          drawH = Math.round(tileW / aspect);
          offsetY = Math.round((tileH - drawH) / 2);
        } else {
          drawW = Math.round(tileH * aspect);
          offsetX = Math.round((tileW - drawW) / 2);
        }

        const startAt = Date.now();
        let capturedFrames = 0;
        for (let i = 0; i < 36; i += 1) {
          if (Date.now() - startAt > 18000) break;
          const t = ((i + 0.5) / 36) * duration;
          const ok = await seekVideoTo(video, t, 1500);
          if (!ok) continue;
          const col = i % 6;
          const row = Math.floor(i / 6);
          sctx.drawImage(video, col * tileW + offsetX, row * tileH + offsetY, drawW, drawH);
          capturedFrames += 1;
          if (i % 6 === 5) {
            onProgress?.({
              stage: "sprite",
              percent: 18 + Math.round(((i + 1) / 36) * 14),
              detail: `6×6 プレビュー画像を生成中 (${i + 1}/36)...`,
            });
          }
        }
        if (capturedFrames >= 12) {
          spriteBytes = await canvasToJpegBytes(spriteCanvas, 0.72);
        }
      }
    }

    return {
      duration,
      width,
      height,
      thumbnailBytes,
      spriteBytes,
    };
  } finally {
    video.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

export async function uploadVideoFromBrowser(params: {
  file: File;
  title: string;
  rootFolderId: string;
  accessToken: string;
  masterKey: CryptoKey | null;
  onProgress?: (p: BrowserUploadProgress) => void;
}): Promise<VaultVideoItem> {
  const { file, title, rootFolderId, accessToken, masterKey, onProgress } = params;
  const encrypted = Boolean(masterKey);
  const mimeType = file.type || "video/mp4";

  const probed = await extractBrowserVideoAssets(file, onProgress);

  onProgress?.({
    stage: "encrypting",
    percent: 35,
    detail: encrypted
      ? "ブラウザ内で E2EE 暗号化中 (AES-256-GCM)..."
      : "アップロードデータを準備中...",
  });

  const rawVideoBytes = new Uint8Array(await file.arrayBuffer());
  const videoPayload =
    encrypted && masterKey
      ? await encryptAesGcmBytes(rawVideoBytes, masterKey)
      : rawVideoBytes;

  const thumbPayload =
    probed.thumbnailBytes && encrypted && masterKey
      ? await encryptAesGcmBytes(probed.thumbnailBytes, masterKey)
      : probed.thumbnailBytes;

  const spritePayload =
    probed.spriteBytes && encrypted && masterKey
      ? await encryptAesGcmBytes(probed.spriteBytes, masterKey)
      : probed.spriteBytes;

  const folderName = encrypted
    ? randomHex(8)
    : `${title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80)}_${Date.now()}`;
  const videoFolderId = await createDriveFolder(folderName, rootFolderId, accessToken);

  const uploadMime = encrypted ? "application/octet-stream" : mimeType;

  onProgress?.({
    stage: "uploading",
    percent: 42,
    detail: "動画本体を Google Drive へアップロード中 (0%)...",
  });

  const videoFileName = encrypted ? "v.enc" : file.name || "video.mp4";
  const directFileId = await uploadFileResumableToDrive(
    videoFolderId,
    videoFileName,
    videoPayload,
    uploadMime,
    accessToken,
    (pct) => {
      onProgress?.({
        stage: "uploading",
        percent: 42 + Math.round(pct * 0.48),
        detail: `Google Drive へアップロード中 (${pct}%)...`,
      });
    }
  );

  let thumbnailFileId: string | undefined;
  if (thumbPayload) {
    onProgress?.({
      stage: "finalizing",
      percent: 92,
      detail: "サムネイルを保存中...",
    });
    thumbnailFileId = await uploadFileResumableToDrive(
      videoFolderId,
      encrypted ? "t.enc" : "thumbnail.jpg",
      thumbPayload,
      encrypted ? "application/octet-stream" : "image/jpeg",
      accessToken
    );
  }

  let spriteFileId: string | undefined;
  if (spritePayload) {
    onProgress?.({
      stage: "finalizing",
      percent: 95,
      detail: "6×6 プレビューを保存中...",
    });
    spriteFileId = await uploadFileResumableToDrive(
      videoFolderId,
      encrypted ? "s.enc" : "sprite.jpg",
      spritePayload,
      encrypted ? "application/octet-stream" : "image/jpeg",
      accessToken
    );
  }

  onProgress?.({
    stage: "finalizing",
    percent: 98,
    detail: "メタデータを保存中...",
  });

  const createdAt = new Date().toISOString();
  const videoId = generateUuid();
  const manifest: VaultManifest = {
    version: encrypted ? 2 : 1,
    encrypted,
    id: videoId,
    title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
    createdAt,
    duration: probed.duration,
    width: probed.width || undefined,
    height: probed.height || undefined,
    sizeBytes: videoPayload.byteLength,
    thumbnailFileId,
    spriteFileId,
    directFileId,
    mimeType,
    sourceFileName: file.name,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBytes =
    encrypted && masterKey
      ? await encryptAesGcmText(manifestJson, masterKey)
      : new TextEncoder().encode(manifestJson);

  await uploadFileResumableToDrive(
    videoFolderId,
    encrypted ? "m.enc" : "manifest.json",
    manifestBytes,
    encrypted ? "application/octet-stream" : "application/json",
    accessToken
  );

  onProgress?.({ stage: "finalizing", percent: 100, detail: "アップロード完了！" });

  return {
    id: videoId,
    folderId: videoFolderId,
    title: manifest.title,
    createdAt,
    duration: probed.duration,
    width: probed.width || undefined,
    height: probed.height || undefined,
    sizeBytes: videoPayload.byteLength,
    kind: "direct",
    encrypted,
    manifest,
    directFileId,
    mimeType,
    thumbnailFileId,
    spriteFileId,
    sourceFileName: file.name,
  };
}
