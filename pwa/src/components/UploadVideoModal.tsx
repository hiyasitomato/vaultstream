"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Film,
  KeyRound,
  Loader2,
  Lock,
  Upload,
  X,
} from "lucide-react";
import { createVaultConfig } from "@/lib/crypto";
import { formatBytes, saveVaultConfigToDrive } from "@/lib/drive";
import { savePassphrase } from "@/lib/storage";
import type { VaultConfig, VaultVideoItem } from "@/lib/types";
import { uploadVideoFromBrowser, type BrowserUploadProgress } from "@/lib/uploader";

interface UploadVideoModalProps {
  rootFolderId: string;
  accessToken: string;
  vaultConfig: VaultConfig | null;
  masterKey: CryptoKey | null;
  onVaultInitialized: (config: VaultConfig, key: CryptoKey) => void;
  onUploaded: (items: VaultVideoItem[]) => void;
  onAuthExpired: () => void;
  onClose: () => void;
}

export default function UploadVideoModal({
  rootFolderId,
  accessToken,
  vaultConfig,
  masterKey,
  onVaultInitialized,
  onUploaded,
  onAuthExpired,
  onClose,
}: UploadVideoModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [customTitle, setCustomTitle] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [useE2eeForNewVault, setUseE2eeForNewVault] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [currentFileIdx, setCurrentFileIdx] = useState(0);
  const [progress, setProgress] = useState<BrowserUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);

  const needsInitialPassphrase = !vaultConfig && !masterKey;

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setSelectedFiles(list);
    setError(null);
    setCompletedCount(0);
    if (list.length === 1) {
      setCustomTitle(list[0].name.replace(/\.[^.]+$/, ""));
    } else {
      setCustomTitle("");
    }
  };

  const handleStartUpload = async () => {
    if (selectedFiles.length === 0) return;

    setError(null);
    setUploading(true);
    setCompletedCount(0);

    try {
      let activeKey = masterKey;

      // Brand-new vault setup directly from smartphone (zero PC needed!)
      if (needsInitialPassphrase && useE2eeForNewVault) {
        const pass = newPassphrase.trim();
        if (pass.length < 4) {
          setError("E2EE マスターパスワードは 4 文字以上で設定してください。");
          setUploading(false);
          return;
        }
        setProgress({
          stage: "encrypting",
          percent: 3,
          detail: "暗号化 Vault (vault.json) を初期化中...",
        });
        const { config, masterKey: derivedKey } = await createVaultConfig(pass);
        await saveVaultConfigToDrive(rootFolderId, config, accessToken);
        savePassphrase(pass);
        onVaultInitialized(config, derivedKey);
        activeKey = derivedKey;
      }

      const uploadedItems: VaultVideoItem[] = [];
      for (let i = 0; i < selectedFiles.length; i += 1) {
        const file = selectedFiles[i];
        setCurrentFileIdx(i + 1);
        const title =
          selectedFiles.length === 1 && customTitle.trim()
            ? customTitle.trim()
            : file.name.replace(/\.[^.]+$/, "");

        const item = await uploadVideoFromBrowser({
          file,
          title,
          rootFolderId,
          accessToken,
          masterKey: activeKey,
          onProgress: (p) => setProgress(p),
        });
        uploadedItems.push(item);
        setCompletedCount(i + 1);
      }

      onUploaded(uploadedItems);
      setTimeout(() => {
        onClose();
      }, 650);
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_EXPIRED") {
        onAuthExpired();
        onClose();
        return;
      }
      setError(
        err instanceof Error ? err.message : "アップロード中にエラーが発生しました。"
      );
    } finally {
      setUploading(false);
    }
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  const hasLargeFile = selectedFiles.some((f) => f.size > 350 * 1024 * 1024);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="動画をアップロード"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-rose-400" />
            <h2 className="text-base font-bold text-white">スマホ・ブラウザから動画アップロード</h2>
          </div>
          {!uploading && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
              aria-label="閉じる"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="max-h-[78vh] space-y-4 overflow-y-auto p-5">
          {/* E2EE Badge */}
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3.5 py-2.5 text-xs text-emerald-200">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="leading-relaxed">
              PC 不要で、端末内で <strong>AES-256-GCM 完全暗号化 ＋ サムネイル ＋ 6×6 ホバープレビュー</strong> を自動生成して Google Drive へ直接アップロードします。
            </p>
          </div>

          {/* Initial vault.json passphrase setup for brand-new mobile-only users */}
          {needsInitialPassphrase && (
            <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                  <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
                  初回 E2EE 暗号化パスワード設定
                </span>
                <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={useE2eeForNewVault}
                    onChange={(e) => setUseE2eeForNewVault(e.target.checked)}
                    disabled={uploading}
                    className="accent-rose-500"
                  />
                  E2EE 暗号化を有効化（推奨）
                </label>
              </div>
              {useE2eeForNewVault && (
                <input
                  type="password"
                  value={newPassphrase}
                  onChange={(e) => setNewPassphrase(e.target.value)}
                  disabled={uploading}
                  placeholder="好きなマスターパスワードを設定（4文字以上）"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                />
              )}
            </div>
          )}

          {/* File Picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="hidden"
          />

          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/40 px-4 py-7 text-center transition hover:border-rose-500/60 hover:bg-zinc-900/80 disabled:opacity-50"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/15 text-rose-400">
              <Film className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-zinc-100">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} 本の動画を選択中（合計 ${formatBytes(totalBytes)}）`
                : "ここをタップして動画を選択（複数可）"}
            </p>
            <p className="text-[11px] text-zinc-400">
              iPhone 写真ライブラリ・Android ギャラリー・MP4 / MOV / WebM に対応
            </p>
          </button>

          {/* Single video title override */}
          {selectedFiles.length === 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">
                動画タイトル
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={uploading}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm text-zinc-100 focus:border-rose-500 focus:outline-none"
              />
            </div>
          )}

          {/* Large file hint */}
          {hasLargeFile && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/25 px-3.5 py-2 text-[11px] leading-relaxed text-amber-200">
              350MB を超える動画が含まれています。スマホのブラウザはメモリ制限があるため、長尺・大容量動画（または一括アップロード）は PC 版の <strong>VaultStream-Packer.exe</strong>（360p 高速スタート ABR 対応）がおすすめです。
            </div>
          )}

          {/* Progress UI */}
          {uploading && progress && (
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5">
              <div className="flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-zinc-100">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-400" />
                  {selectedFiles.length > 1
                    ? `(${currentFileIdx}/${selectedFiles.length}) `
                    : ""}
                  {progress.detail}
                </span>
                <span className="font-mono font-bold text-rose-300">
                  {progress.percent}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-rose-500 transition-all duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {!uploading && completedCount > 0 && !error && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-2.5 text-xs font-semibold text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              {completedCount} 本のアップロードが完了しました！
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
          <button
            type="button"
            disabled={uploading}
            onClick={onClose}
            className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={uploading || selectedFiles.length === 0}
            onClick={handleStartUpload}
            className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-600/25 transition hover:bg-rose-500 disabled:opacity-40"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                アップロード中...
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" />
                暗号化してアップロード
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
