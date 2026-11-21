#!/usr/bin/env python3
"""
VaultStream Packer GUI (Windows Desktop App / Cross-platform Tkinter)

A clean, dark-mode desktop interface for VaultStream's all-in-one E2EE packer:
  - No command line or Python setup required when distributed as VaultStream-Packer.exe
  - Auto-extracts Google Drive Folder ID from full Drive URLs
  - 1-click FFmpeg check & winget installer on Windows
  - Live progress bar, real-time log console, and safe stop/resume support
"""

from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Optional

from pack_video import (
    VIDEO_EXTENSIONS,
    GoogleApiUploader,
    ensure_vault_master_key,
    find_ffmpeg_bin,
    invalidate_library_index,
    load_state,
    process_single_video,
    save_state,
)

APP_TITLE = "VaultStream Packer"
APP_VERSION = "v1.0.0"

# Dark theme palette matching VaultStream PWA
BG_MAIN = "#0b0b0e"
BG_CARD = "#141419"
BG_INPUT = "#1c1c24"
FG_TEXT = "#f4f4f5"
FG_MUTED = "#a1a1aa"
ACCENT = "#e11d48"
ACCENT_HOVER = "#f43f5e"
EMERALD = "#10b981"
BORDER = "#27272a"


def get_app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def extract_drive_folder_id(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    match = re.search(r"/folders/([A-Za-z0-9_-]+)", text)
    if match:
        return match.group(1)
    match_id = re.search(r"[?&]id=([A-Za-z0-9_-]+)", text)
    if match_id:
        return match_id.group(1)
    return text


class QueueLogStream:
    """Thread-safe stdout/stderr redirector into a Tkinter log queue."""

    def __init__(self, log_queue: "queue.Queue[str]") -> None:
        self.log_queue = log_queue
        self._buf = ""

    def write(self, data: str) -> int:
        if not data:
            return 0
        # Filter noisy tqdm carriage-return redraws while keeping real log lines
        cleaned = data.replace("\r", "\n")
        self._buf += cleaned
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            stripped = line.strip()
            if stripped and not stripped.startswith("Uploading:") and not stripped.endswith("file/s]"):
                self.log_queue.put(stripped)
        return len(data)

    def flush(self) -> None:
        if self._buf.strip():
            self.log_queue.put(self._buf.strip())
            self._buf = ""

    def isatty(self) -> bool:
        return False


class VaultStreamPackerGUI:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.app_dir = get_app_dir()
        self.settings_path = self.app_dir / "vaultstream_gui_settings.json"
        self.log_queue: "queue.Queue[str]" = queue.Queue()
        self.stop_event = threading.Event()
        self.worker_thread: Optional[threading.Thread] = None

        self.root.title(f"{APP_TITLE} ({APP_VERSION})")
        self.root.geometry("760x720")
        self.root.minsize(680, 640)
        self.root.configure(bg=BG_MAIN)

        self._configure_ttk_styles()

        # Form variables
        self.input_var = tk.StringVar()
        self.folder_id_var = tk.StringVar()
        self.credentials_var = tk.StringVar(value=str(self.app_dir / "credentials.json"))
        self.password_var = tk.StringVar()
        self.show_pw_var = tk.BooleanVar(value=False)
        self.with_360p_var = tk.BooleanVar(value=True)
        self.auto_copy_var = tk.BooleanVar(value=True)
        self.delete_source_var = tk.BooleanVar(value=False)
        self.workers_var = tk.IntVar(value=3)

        self.status_var = tk.StringVar(value="待機中 — 動画フォルダと設定を入力して開始してください")
        self.progress_var = tk.DoubleVar(value=0.0)
        self.ffmpeg_status_var = tk.StringVar(value="FFmpeg 確認中...")

        self._load_settings()
        self._build_ui()
        self._refresh_ffmpeg_status()
        self._poll_logs()

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _configure_ttk_styles(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "Rose.Horizontal.TProgressbar",
            troughcolor=BG_INPUT,
            background=ACCENT,
            bordercolor=BORDER,
            lightcolor=ACCENT,
            darkcolor=ACCENT,
            thickness=12,
        )

    def _load_settings(self) -> None:
        if not self.settings_path.exists():
            return
        try:
            data = json.loads(self.settings_path.read_text(encoding="utf-8"))
            if data.get("input_path"):
                self.input_var.set(str(data["input_path"]))
            if data.get("folder_id"):
                self.folder_id_var.set(str(data["folder_id"]))
            if data.get("credentials_path"):
                self.credentials_var.set(str(data["credentials_path"]))
            if "with_360p" in data:
                self.with_360p_var.set(bool(data["with_360p"]))
            if "auto_copy" in data:
                self.auto_copy_var.set(bool(data["auto_copy"]))
            if "workers" in data:
                self.workers_var.set(max(1, min(6, int(data["workers"]))))
        except Exception:
            pass

    def _save_settings(self) -> None:
        # Never persist the master passphrase to disk
        data = {
            "input_path": self.input_var.get().strip(),
            "folder_id": extract_drive_folder_id(self.folder_id_var.get()),
            "credentials_path": self.credentials_var.get().strip(),
            "with_360p": bool(self.with_360p_var.get()),
            "auto_copy": bool(self.auto_copy_var.get()),
            "workers": int(self.workers_var.get()),
        }
        try:
            self.settings_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            pass

    def _build_ui(self) -> None:
        font_title = ("Meiryo UI", 15, "bold") if sys.platform == "win32" else ("Helvetica", 15, "bold")
        font_label = ("Meiryo UI", 9, "bold") if sys.platform == "win32" else ("Helvetica", 10, "bold")
        font_body = ("Meiryo UI", 9) if sys.platform == "win32" else ("Helvetica", 10)
        font_mono = ("Consolas", 9) if sys.platform == "win32" else ("Courier", 10)

        # Top Header
        header = tk.Frame(self.root, bg=BG_MAIN, padx=20, pady=14)
        header.pack(fill="x")

        title_row = tk.Frame(header, bg=BG_MAIN)
        title_row.pack(fill="x")
        tk.Label(
            title_row,
            text="VaultStream Packer",
            font=font_title,
            bg=BG_MAIN,
            fg=FG_TEXT,
        ).pack(side="left")

        self.ffmpeg_badge = tk.Label(
            title_row,
            textvariable=self.ffmpeg_status_var,
            font=font_label,
            bg=BG_INPUT,
            fg=FG_MUTED,
            padx=10,
            pady=3,
        )
        self.ffmpeg_badge.pack(side="right")

        self.ffmpeg_install_btn = tk.Button(
            title_row,
            text="FFmpeg を自動インストール",
            font=font_body,
            bg="#2563eb",
            fg="#ffffff",
            activebackground="#1d4ed8",
            activeforeground="#ffffff",
            relief="flat",
            padx=10,
            pady=2,
            cursor="hand2",
            command=self._install_ffmpeg_winget,
        )

        tk.Label(
            header,
            text="動画をローカルで完全暗号化 (E2EE) + 360p 高速ABR + 6×6プレビュー生成して Google Drive へ一括アップロード",
            font=font_body,
            bg=BG_MAIN,
            fg=FG_MUTED,
            anchor="w",
        ).pack(fill="x", pady=(4, 0))

        # Main Form Card
        card = tk.Frame(
            self.root,
            bg=BG_CARD,
            highlightbackground=BORDER,
            highlightthickness=1,
            padx=18,
            pady=14,
        )
        card.pack(fill="x", padx=20, pady=(0, 12))

        def make_entry(parent: tk.Widget, var: tk.StringVar, show: str = "") -> tk.Entry:
            return tk.Entry(
                parent,
                textvariable=var,
                show=show,
                font=font_body,
                bg=BG_INPUT,
                fg=FG_TEXT,
                insertbackground=FG_TEXT,
                relief="flat",
                highlightbackground=BORDER,
                highlightcolor=ACCENT,
                highlightthickness=1,
            )

        def make_small_btn(parent: tk.Widget, text: str, cmd) -> tk.Button:
            return tk.Button(
                parent,
                text=text,
                font=font_body,
                bg="#27272a",
                fg=FG_TEXT,
                activebackground="#3f3f46",
                activeforeground=FG_TEXT,
                relief="flat",
                padx=10,
                pady=4,
                cursor="hand2",
                command=cmd,
            )

        # Row 1: Video Input
        tk.Label(card, text="1. 動画ファイル または 動画フォルダ", font=font_label, bg=BG_CARD, fg=FG_TEXT).pack(anchor="w")
        r1 = tk.Frame(card, bg=BG_CARD)
        r1.pack(fill="x", pady=(4, 10))
        make_entry(r1, self.input_var).pack(side="left", fill="x", expand=True, ipady=5)
        make_small_btn(r1, "フォルダ選択", self._pick_folder).pack(side="left", padx=(6, 0))
        make_small_btn(r1, "ファイル選択", self._pick_file).pack(side="left", padx=(6, 0))

        # Row 2: Google Drive Folder ID
        tk.Label(
            card,
            text="2. Google Drive フォルダ ID（フォルダの URL をそのまま貼り付けても自動抽出します）",
            font=font_label,
            bg=BG_CARD,
            fg=FG_TEXT,
        ).pack(anchor="w")
        r2 = tk.Frame(card, bg=BG_CARD)
        r2.pack(fill="x", pady=(4, 10))
        make_entry(r2, self.folder_id_var).pack(fill="x", ipady=5)

        # Row 3: OAuth credentials.json
        tk.Label(
            card,
            text="3. Google OAuth 認証ファイル (credentials.json)",
            font=font_label,
            bg=BG_CARD,
            fg=FG_TEXT,
        ).pack(anchor="w")
        r3 = tk.Frame(card, bg=BG_CARD)
        r3.pack(fill="x", pady=(4, 10))
        make_entry(r3, self.credentials_var).pack(side="left", fill="x", expand=True, ipady=5)
        make_small_btn(r3, "参照...", self._pick_credentials).pack(side="left", padx=(6, 0))

        # Row 4: E2EE Master Passphrase
        tk.Label(
            card,
            text="4. E2EE マスターパスワード（PWA のロック解除に使う合言葉・空欄で平文モード）",
            font=font_label,
            bg=BG_CARD,
            fg=FG_TEXT,
        ).pack(anchor="w")
        r4 = tk.Frame(card, bg=BG_CARD)
        r4.pack(fill="x", pady=(4, 10))
        self.pw_entry = make_entry(r4, self.password_var, show="•")
        self.pw_entry.pack(side="left", fill="x", expand=True, ipady=5)
        tk.Checkbutton(
            r4,
            text="表示",
            variable=self.show_pw_var,
            command=self._toggle_pw_visibility,
            font=font_body,
            bg=BG_CARD,
            fg=FG_MUTED,
            selectcolor=BG_INPUT,
            activebackground=BG_CARD,
            activeforeground=FG_TEXT,
        ).pack(side="left", padx=(8, 0))

        # Row 5: Options
        opts = tk.Frame(card, bg=BG_CARD)
        opts.pack(fill="x", pady=(4, 0))

        tk.Checkbutton(
            opts,
            text="360p 高速スタート画質(ABR)も生成",
            variable=self.with_360p_var,
            font=font_body,
            bg=BG_CARD,
            fg=FG_TEXT,
            selectcolor=BG_INPUT,
            activebackground=BG_CARD,
            activeforeground=FG_TEXT,
        ).pack(side="left", padx=(0, 12))

        tk.Checkbutton(
            opts,
            text="無劣化高速コピー (推奨)",
            variable=self.auto_copy_var,
            font=font_body,
            bg=BG_CARD,
            fg=FG_TEXT,
            selectcolor=BG_INPUT,
            activebackground=BG_CARD,
            activeforeground=FG_TEXT,
        ).pack(side="left", padx=(0, 12))

        tk.Label(opts, text="並列数:", font=font_body, bg=BG_CARD, fg=FG_MUTED).pack(side="left")
        tk.Spinbox(
            opts,
            from_=1,
            to=6,
            width=3,
            textvariable=self.workers_var,
            font=font_body,
            bg=BG_INPUT,
            fg=FG_TEXT,
            buttonbackground="#27272a",
            relief="flat",
        ).pack(side="left", padx=(4, 12))

        tk.Checkbutton(
            opts,
            text="完了後に元動画を削除",
            variable=self.delete_source_var,
            font=font_body,
            bg=BG_CARD,
            fg="#fca5a5",
            selectcolor=BG_INPUT,
            activebackground=BG_CARD,
            activeforeground="#fca5a5",
        ).pack(side="right")

        # Action Buttons
        actions = tk.Frame(self.root, bg=BG_MAIN, padx=20)
        actions.pack(fill="x", pady=(0, 10))

        self.start_btn = tk.Button(
            actions,
            text="暗号化 ＆ Google Drive アップロード開始",
            font=font_label,
            bg=ACCENT,
            fg="#ffffff",
            activebackground=ACCENT_HOVER,
            activeforeground="#ffffff",
            relief="flat",
            padx=20,
            pady=9,
            cursor="hand2",
            command=self._start_upload,
        )
        self.start_btn.pack(side="left", fill="x", expand=True)

        self.stop_btn = tk.Button(
            actions,
            text="安全に中断",
            font=font_label,
            bg="#27272a",
            fg=FG_MUTED,
            activebackground="#3f3f46",
            activeforeground=FG_TEXT,
            relief="flat",
            padx=16,
            pady=9,
            state="disabled",
            cursor="hand2",
            command=self._request_stop,
        )
        self.stop_btn.pack(side="left", padx=(10, 0))

        # Progress & Status
        prog_frame = tk.Frame(self.root, bg=BG_MAIN, padx=20)
        prog_frame.pack(fill="x", pady=(0, 8))

        tk.Label(
            prog_frame,
            textvariable=self.status_var,
            font=font_body,
            bg=BG_MAIN,
            fg=FG_TEXT,
            anchor="w",
        ).pack(fill="x", pady=(0, 4))

        self.progress_bar = ttk.Progressbar(
            prog_frame,
            variable=self.progress_var,
            maximum=100.0,
            style="Rose.Horizontal.TProgressbar",
        )
        self.progress_bar.pack(fill="x")

        # Live Log Console
        log_frame = tk.Frame(
            self.root,
            bg=BG_CARD,
            highlightbackground=BORDER,
            highlightthickness=1,
            padx=8,
            pady=8,
        )
        log_frame.pack(fill="both", expand=True, padx=20, pady=(4, 16))

        self.log_text = tk.Text(
            log_frame,
            font=font_mono,
            bg="#09090b",
            fg="#d4d4d8",
            insertbackground=FG_TEXT,
            relief="flat",
            wrap="word",
            state="disabled",
        )
        scrollbar = tk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.log_text.pack(side="left", fill="both", expand=True)

    def _toggle_pw_visibility(self) -> None:
        self.pw_entry.configure(show="" if self.show_pw_var.get() else "•")

    def _pick_folder(self) -> None:
        chosen = filedialog.askdirectory(title="動画フォルダを選択")
        if chosen:
            self.input_var.set(chosen)

    def _pick_file(self) -> None:
        chosen = filedialog.askopenfilename(
            title="動画ファイルを選択",
            filetypes=[("動画ファイル", "*.mp4 *.mov *.mkv *.webm *.avi *.m4v *.ts"), ("すべて", "*.*")],
        )
        if chosen:
            self.input_var.set(chosen)

    def _pick_credentials(self) -> None:
        chosen = filedialog.askopenfilename(
            title="credentials.json を選択",
            filetypes=[("JSON ファイル", "*.json"), ("すべて", "*.*")],
        )
        if chosen:
            self.credentials_var.set(chosen)

    def _refresh_ffmpeg_status(self) -> bool:
        has_ffmpeg = bool(find_ffmpeg_bin("ffmpeg")) and bool(find_ffmpeg_bin("ffprobe"))
        if has_ffmpeg:
            self.ffmpeg_status_var.set("● FFmpeg 準備OK")
            self.ffmpeg_badge.configure(fg=EMERALD, bg="#052e16")
            self.ffmpeg_install_btn.pack_forget()
        else:
            self.ffmpeg_status_var.set("● FFmpeg 未検出")
            self.ffmpeg_badge.configure(fg="#fca5a5", bg="#450a0a")
            if sys.platform == "win32":
                self.ffmpeg_install_btn.pack(side="right", padx=(0, 8))
        return has_ffmpeg

    def _install_ffmpeg_winget(self) -> None:
        if not messagebox.askyesno(
            "FFmpeg の自動インストール",
            "Windows 標準の winget を使って FFmpeg (Gyan.FFmpeg) をインストールします。\n実行しますか？",
        ):
            return
        self._append_log("[INFO] winget で FFmpeg をインストール中（1〜2分かかる場合があります）...")
        self.ffmpeg_install_btn.configure(state="disabled")

        def _run() -> None:
            try:
                proc = subprocess.run(
                    [
                        "winget",
                        "install",
                        "--id",
                        "Gyan.FFmpeg",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode == 0:
                    self.log_queue.put("[INFO] FFmpeg のインストールが完了しました！")
                else:
                    self.log_queue.put(
                        f"[WARN] winget 終了コード {proc.returncode}。手動インストール: winget install Gyan.FFmpeg"
                    )
            except Exception as err:
                self.log_queue.put(f"[ERROR] winget 実行失敗: {err}")
            finally:
                self.root.after(0, lambda: self.ffmpeg_install_btn.configure(state="normal"))
                self.root.after(0, self._refresh_ffmpeg_status)

        threading.Thread(target=_run, daemon=True).start()

    def _append_log(self, line: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", line + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _poll_logs(self) -> None:
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self._append_log(msg)
        except queue.Empty:
            pass
        self.root.after(120, self._poll_logs)

    def _set_running(self, running: bool) -> None:
        if running:
            self.start_btn.configure(state="disabled", bg="#52525b")
            self.stop_btn.configure(state="normal", fg=FG_TEXT)
        else:
            self.start_btn.configure(state="normal", bg=ACCENT)
            self.stop_btn.configure(state="disabled", fg=FG_MUTED)

    def _request_stop(self) -> None:
        self.stop_event.set()
        self.status_var.set("現在の動画が完了したら安全に中断します...")
        self.log_queue.put("[INFO] 中断リクエストを受け付けました。処理中の動画が終わり次第停止します。")

    def _start_upload(self) -> None:
        if not self._refresh_ffmpeg_status():
            messagebox.showerror(
                "FFmpeg が見つかりません",
                "FFmpeg がインストールされていません。\n右上の「FFmpeg を自動インストール」を押すか、winget install Gyan.FFmpeg を実行してください。",
            )
            return

        input_str = self.input_var.get().strip()
        if not input_str:
            messagebox.showwarning("入力不足", "動画ファイルまたは動画フォルダを選択してください。")
            return
        input_path = Path(input_str).expanduser().resolve()
        if not input_path.exists():
            messagebox.showerror("パスエラー", f"指定されたパスが見つかりません:\n{input_path}")
            return

        folder_id = extract_drive_folder_id(self.folder_id_var.get())
        if not folder_id:
            messagebox.showwarning("入力不足", "Google Drive のフォルダ ID（またはフォルダ URL）を入力してください。")
            return
        self.folder_id_var.set(folder_id)

        cred_path = Path(self.credentials_var.get().strip()).expanduser().resolve()
        if not cred_path.exists():
            messagebox.showerror(
                "credentials.json が見つかりません",
                f"OAuth 認証ファイルが見つかりません:\n{cred_path}\n\nGoogle Cloud Console からデスクトップアプリ用 OAuth JSON をダウンロードして指定してください。",
            )
            return

        passphrase = self.password_var.get()
        if not passphrase:
            if not messagebox.askyesno(
                "平文アップロードの確認",
                "マスターパスワードが空欄です。\n暗号化せず平文でアップロードしますか？（E2EE 暗号化を使う場合は「いいえ」を押してパスワードを入力してください）",
            ):
                return

        delete_source = bool(self.delete_source_var.get())
        if delete_source:
            if not messagebox.askyesno(
                "元動画削除の確認",
                "「完了後に元動画を削除」がオンになっています。\nアップロード成功後に PC 内の元動画ファイルが削除されます。よろしいですか？",
            ):
                return

        self._save_settings()
        self.stop_event.clear()
        self.progress_var.set(0.0)
        self._set_running(True)

        copy_mode = "auto" if self.auto_copy_var.get() else "reencode"
        with_360p = bool(self.with_360p_var.get())
        workers = max(1, min(6, int(self.workers_var.get())))

        self.worker_thread = threading.Thread(
            target=self._run_worker,
            args=(input_path, folder_id, cred_path, passphrase, copy_mode, with_360p, workers, delete_source),
            daemon=True,
        )
        self.worker_thread.start()

    def _run_worker(
        self,
        input_path: Path,
        folder_id: str,
        cred_path: Path,
        passphrase: str,
        copy_mode: str,
        with_360p: bool,
        workers: int,
        delete_source: bool,
    ) -> None:
        orig_stdout, orig_stderr = sys.stdout, sys.stderr
        stream = QueueLogStream(self.log_queue)
        sys.stdout = stream  # type: ignore[assignment]
        sys.stderr = stream  # type: ignore[assignment]

        try:
            self.root.after(0, lambda: self.status_var.set("Google Drive 認証中...（初回はブラウザが開きます）"))
            token_path = self.app_dir / "token.json"
            state_path = self.app_dir / ".upload_state_e2ee.json"

            uploader = GoogleApiUploader(credentials_path=cred_path, token_path=token_path)
            master_key = (
                ensure_vault_master_key(uploader, folder_id, passphrase)
                if passphrase
                else None
            )

            if input_path.is_file():
                video_files = [input_path]
            else:
                video_files = sorted(
                    p
                    for p in input_path.rglob("*")
                    if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
                )

            total = len(video_files)
            if total == 0:
                print(f"[ERROR] 対象の動画ファイルが見つかりませんでした: {input_path}")
                self.root.after(0, lambda: self.status_var.set("動画ファイルが見つかりませんでした"))
                return

            state = load_state(state_path)
            done_count = 0
            skip_count = 0
            fail_count = 0

            print(f"=== 処理開始: 全 {total} 本 (E2EE={'ON' if master_key else 'OFF'}, 360p={with_360p}, workers={workers}) ===")

            for idx, vf in enumerate(video_files, start=1):
                if self.stop_event.is_set():
                    print("[INFO] ユーザー操作により安全に中断しました。次回実行時は続きから再開されます。")
                    break

                key = f"{vf.name}:{vf.stat().st_size}"
                if len(video_files) > 1 and key in state:
                    skip_count += 1
                    print(f"[{idx}/{total}] SKIP (アップロード済): {vf.name}")
                    pct = (idx / total) * 100.0
                    self.root.after(0, lambda p=pct: self.progress_var.set(p))
                    continue

                self.root.after(
                    0,
                    lambda i=idx, t=total, n=vf.name: self.status_var.set(f"処理中 ({i}/{t}): {n}"),
                )
                print(f"[{idx}/{total}] 開始 ({vf.stat().st_size / (1024 * 1024):.1f} MB): {vf.name}")

                try:
                    result = process_single_video(
                        input_path=vf,
                        title=vf.stem.strip(),
                        folder_id=folder_id,
                        uploader=uploader,
                        master_key=master_key,
                        segment_duration=15,
                        crf=22,
                        copy_mode=copy_mode,
                        with_360p=with_360p,
                        workers=workers,
                        dry_run=False,
                        delete_source=delete_source,
                    )
                    state[key] = result
                    save_state(state_path, state)
                    done_count += 1
                except Exception as err:
                    fail_count += 1
                    print(f"  [ERROR] 失敗 ({vf.name}): {err}")

                pct = (idx / total) * 100.0
                self.root.after(0, lambda p=pct: self.progress_var.set(p))

            if done_count > 0:
                invalidate_library_index(uploader, folder_id)

            summary = f"完了: 成功 {done_count} / スキップ {skip_count} / 失敗 {fail_count} / 合計 {total}"
            print(f"=== {summary} ===")
            self.root.after(0, lambda s=summary: self.status_var.set(s))
            if not self.stop_event.is_set():
                self.root.after(
                    0,
                    lambda s=summary: messagebox.showinfo(
                        "処理完了",
                        f"{s}\n\nVaultStream PWA を開いて右上の「更新」ボタンを押すと新しい動画が表示されます！",
                    ),
                )
        except Exception as err:
            print(f"[ERROR] 致命的なエラー: {err}")
            self.root.after(0, lambda e=str(err): self.status_var.set(f"エラー: {e[:80]}"))
            self.root.after(0, lambda e=str(err): messagebox.showerror("エラー", e))
        finally:
            stream.flush()
            sys.stdout, sys.stderr = orig_stdout, orig_stderr
            self.root.after(0, lambda: self._set_running(False))

    def _on_close(self) -> None:
        if self.worker_thread and self.worker_thread.is_alive():
            if not messagebox.askyesno(
                "処理中です",
                "現在アップロード処理が実行中です。アプリを終了しますか？\n（すでに完了した動画は記録されているため、次回続きから再開できます）",
            ):
                return
            self.stop_event.set()
        self._save_settings()
        self.root.destroy()


def main() -> int:
    root = tk.Tk()
    VaultStreamPackerGUI(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
