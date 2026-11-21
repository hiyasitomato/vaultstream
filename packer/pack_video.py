#!/usr/bin/env python3
"""
VaultStream All-in-One Packer (E2EE + 360p ABR + 6x6 Storyboard Sprite)

Converts local video file(s) into:
  - Primary lossless/H.264 HLS stream (AES-128-CBC encrypted)
  - Optional 360p lightweight ABR fast-start stream (8s segments, ~550kbps)
  - Thumbnail JPEG (AES-256-GCM encrypted)
  - 6x6 hover storyboard preview sprite sheet (AES-256-GCM encrypted)
  - Encrypted manifest & playlist with anonymized random Drive folder names
  - Automatic library_index.enc invalidation so the PWA sees new videos immediately

Note: FFmpeg and FFprobe must be installed separately on your machine.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import getpass
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Protocol, Tuple

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from tqdm import tqdm

SCOPES = ["https://www.googleapis.com/auth/drive"]
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".ts", ".flv", ".wmv"}
CHECK_PLAINTEXT = b"VAULTSTREAM_E2EE_V2"
PBKDF2_ITERATIONS = 100_000
LOW_HEIGHT = 360
LOW_SEGMENT_DURATION = 8


def derive_master_key(passphrase: str, salt: bytes, iterations: int = PBKDF2_ITERATIONS) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_aes_gcm(plain: bytes, master_key: bytes) -> bytes:
    iv = os.urandom(12)
    ciphertext = AESGCM(master_key).encrypt(iv, plain, None)
    return iv + ciphertext


def decrypt_aes_gcm(payload: bytes, master_key: bytes) -> bytes:
    if len(payload) < 28:
        raise ValueError("Encrypted payload too short")
    iv = payload[:12]
    ciphertext = payload[12:]
    return AESGCM(master_key).decrypt(iv, ciphertext, None)


class DriveUploader(Protocol):
    def create_folder(self, name: str, parent_id: str) -> str: ...
    def upload_file(self, file_path: Path, parent_id: str, mime_type: str) -> str: ...
    def find_file_in_folder(self, name: str, parent_id: str) -> Optional[str]: ...
    def download_text(self, file_id: str) -> str: ...
    def trash_file(self, file_id: str) -> None: ...


class GoogleApiUploader:
    """Uploads files using official Google Drive API v3 and desktop OAuth credentials."""

    def __init__(self, credentials_path: Path, token_path: Path) -> None:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow

        if not credentials_path.exists():
            raise FileNotFoundError(
                f"OAuth credentials file not found: {credentials_path}\n"
                "Google Cloud Console からデスクトップアプリ用 OAuth JSON をダウンロードし、"
                "packer/credentials.json に配置してください。"
            )

        creds: Optional[Credentials] = None
        if token_path.exists():
            creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    str(credentials_path), SCOPES
                )
                creds = flow.run_local_server(port=0)
            token_path.parent.mkdir(parents=True, exist_ok=True)
            token_path.write_text(creds.to_json(), encoding="utf-8")

        self.creds = creds

    def _build_service(self):
        from googleapiclient.discovery import build

        return build("drive", "v3", credentials=self.creds, cache_discovery=False)

    def create_folder(self, name: str, parent_id: str) -> str:
        service = self._build_service()
        metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        result = service.files().create(body=metadata, fields="id").execute()
        return str(result["id"])

    def upload_file(self, file_path: Path, parent_id: str, mime_type: str) -> str:
        from googleapiclient.http import MediaFileUpload

        service = self._build_service()
        metadata = {
            "name": file_path.name,
            "parents": [parent_id],
        }
        media = MediaFileUpload(str(file_path), mimetype=mime_type, resumable=True)
        result = (
            service.files()
            .create(body=metadata, media_body=media, fields="id")
            .execute()
        )
        return str(result["id"])

    def find_file_in_folder(self, name: str, parent_id: str) -> Optional[str]:
        service = self._build_service()
        escaped = name.replace("'", "\\'")
        query = f"'{parent_id}' in parents and name = '{escaped}' and trashed = false"
        res = service.files().list(q=query, fields="files(id, name)", pageSize=5).execute()
        files = res.get("files", [])
        return str(files[0]["id"]) if files else None

    def download_text(self, file_id: str) -> str:
        service = self._build_service()
        data = service.files().get_media(fileId=file_id).execute()
        return data.decode("utf-8") if isinstance(data, bytes) else str(data)

    def trash_file(self, file_id: str) -> None:
        service = self._build_service()
        service.files().update(fileId=file_id, body={"trashed": True}).execute()


def _win_no_window_kwargs() -> Dict[str, object]:
    if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        return {"creationflags": subprocess.CREATE_NO_WINDOW}
    return {}


def find_ffmpeg_bin(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    if sys.platform == "win32":
        local_app = os.environ.get("LOCALAPPDATA", "")
        if local_app:
            winget_link = Path(local_app) / "Microsoft" / "WinGet" / "Links" / f"{name}.exe"
            if winget_link.exists():
                return str(winget_link)
            pkg_root = Path(local_app) / "Microsoft" / "WinGet" / "Packages"
            if pkg_root.exists():
                for candidate in pkg_root.glob(f"*FFmpeg*/**/bin/{name}.exe"):
                    return str(candidate)
    return None


def check_ffmpeg_available() -> None:
    if not find_ffmpeg_bin("ffmpeg") or not find_ffmpeg_bin("ffprobe"):
        raise RuntimeError(
            "ffmpeg または ffprobe が PATH に見つかりません。\n"
            "FFmpeg をインストールしてから再実行してください。\n"
            "  Windows: winget install Gyan.FFmpeg\n"
            "  macOS:   brew install ffmpeg\n"
            "  Linux:   sudo apt install ffmpeg"
        )


def upload_with_retry(
    uploader: DriveUploader,
    file_path: Path,
    parent_id: str,
    mime_type: str,
    max_retries: int = 6,
) -> str:
    last_err: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            return uploader.upload_file(file_path, parent_id, mime_type)
        except Exception as err:
            last_err = err
            if attempt < max_retries - 1:
                msg = str(err).lower()
                if "quota" in msg or "403" in msg or "429" in msg or "rate" in msg:
                    time.sleep(10.0 * (attempt + 1))
                else:
                    time.sleep(2.5 * (attempt + 1))
    assert last_err is not None
    raise last_err


def ensure_vault_master_key(
    uploader: DriveUploader, folder_id: str, passphrase: str
) -> bytes:
    existing_id = uploader.find_file_in_folder("vault.json", folder_id)
    if existing_id:
        raw = uploader.download_text(existing_id)
        cfg = json.loads(raw)
        salt = base64.b64decode(cfg["salt"])
        iterations = int(cfg.get("iterations", PBKDF2_ITERATIONS))
        master_key = derive_master_key(passphrase, salt, iterations)
        try:
            decoded = decrypt_aes_gcm(base64.b64decode(cfg["check"]), master_key)
            if decoded != CHECK_PLAINTEXT:
                raise ValueError("mismatch")
        except Exception as err:
            raise RuntimeError(
                "既存の vault.json とパスワードが一致しません。正しいマスターパスワードを指定してください。"
            ) from err
        print("[E2EE] 既存の vault.json でマスターパスワードを検証しました。", flush=True)
        return master_key

    salt = os.urandom(16)
    master_key = derive_master_key(passphrase, salt, PBKDF2_ITERATIONS)
    check_blob = encrypt_aes_gcm(CHECK_PLAINTEXT, master_key)
    cfg = {
        "version": 2,
        "kdf": "PBKDF2-SHA256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": base64.b64encode(salt).decode("ascii"),
        "check": base64.b64encode(check_blob).decode("ascii"),
    }
    with tempfile.TemporaryDirectory(prefix="vaultstream_cfg_") as tmp:
        cfg_path = Path(tmp) / "vault.json"
        cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        cfg_id = upload_with_retry(uploader, cfg_path, folder_id, "application/json")
        print(f"[E2EE] 新規 vault.json を作成・アップロードしました (ID: {cfg_id})", flush=True)
    return master_key


def probe_video(input_path: Path) -> Dict[str, object]:
    ffprobe_bin = find_ffmpeg_bin("ffprobe") or "ffprobe"
    cmd = [
        ffprobe_bin,
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(input_path),
    ]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=True,
        encoding="utf-8",
        **_win_no_window_kwargs(),
    )
    data = json.loads(proc.stdout)

    duration = float(data.get("format", {}).get("duration", 0.0) or 0.0)
    width = 0
    height = 0
    video_codec = ""
    audio_codec = ""
    for stream in data.get("streams", []):
        ctype = stream.get("codec_type")
        if ctype == "video" and not video_codec:
            video_codec = str(stream.get("codec_name", "") or "").lower()
            width = int(stream.get("width", 0) or 0)
            height = int(stream.get("height", 0) or 0)
        elif ctype == "audio" and not audio_codec:
            audio_codec = str(stream.get("codec_name", "") or "").lower()

    return {
        "duration": round(duration, 2),
        "width": width,
        "height": height,
        "video_codec": video_codec,
        "audio_codec": audio_codec,
    }


def generate_thumbnail(input_path: Path, output_path: Path, duration: float) -> bool:
    ffmpeg_bin = find_ffmpeg_bin("ffmpeg") or "ffmpeg"
    seek_sec = min(max(duration * 0.1, 1.0), 15.0) if duration > 2.0 else 0.0
    cmd = [
        ffmpeg_bin,
        "-y",
        "-ss",
        f"{seek_sec:.2f}",
        "-i",
        str(input_path),
        "-vframes",
        "1",
        "-vf",
        "scale=640:-2",
        "-q:v",
        "3",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, **_win_no_window_kwargs())
    return proc.returncode == 0 and output_path.exists()


def generate_sprite_sheet(input_path: Path, output_path: Path, duration: float) -> bool:
    ffmpeg_bin = find_ffmpeg_bin("ffmpeg") or "ffmpeg"
    safe_dur = max(duration, 1.0)
    fps_val = 36.0 / safe_dur
    vf = (
        f"fps={fps_val:.6f},"
        "scale=160:90:force_original_aspect_ratio=decrease,"
        "pad=160:90:(ow-iw)/2:(oh-ih)/2:black,"
        "tile=6x6"
    )
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-vf",
        vf,
        "-frames:v",
        "1",
        "-q:v",
        "5",
        str(output_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, **_win_no_window_kwargs())
    return proc.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0


def encode_hls(
    input_path: Path,
    out_dir: Path,
    segment_duration: int,
    crf: int,
    copy_streams: bool,
    hls_key: Optional[bytes] = None,
) -> Path:
    ffmpeg_bin = find_ffmpeg_bin("ffmpeg") or "ffmpeg"
    playlist_path = out_dir / "index.m3u8"
    segment_pattern = str(out_dir / ("%04d.enc" if hls_key is not None else "seg_%04d.ts"))

    cmd = [ffmpeg_bin, "-y", "-i", str(input_path)]
    if copy_streams:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"]
    else:
        cmd += [
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            str(crf),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ac",
            "2",
        ]

    cmd += [
        "-f",
        "hls",
        "-hls_time",
        str(segment_duration),
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "independent_segments",
    ]

    if hls_key is not None:
        key_file = out_dir / "hls.key"
        key_file.write_bytes(hls_key)
        iv_hex = os.urandom(16).hex()
        keyinfo_file = out_dir / "keyinfo.txt"
        keyinfo_file.write_text(
            f"vault://key\n{key_file.as_posix()}\n{iv_hex}\n",
            encoding="utf-8",
        )
        cmd += ["-hls_key_info_file", str(keyinfo_file)]

    cmd += [
        "-hls_segment_filename",
        segment_pattern,
        str(playlist_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, **_win_no_window_kwargs())
    if proc.returncode != 0 or not playlist_path.exists():
        raise RuntimeError(f"FFmpeg HLS 変換に失敗しました:\n{proc.stderr[-1000:]}")
    return playlist_path


def encode_low_hls(
    input_path: Path,
    out_dir: Path,
    src_width: int,
    src_height: int,
    hls_key: Optional[bytes] = None,
) -> Tuple[Path, int, int]:
    ffmpeg_bin = find_ffmpeg_bin("ffmpeg") or "ffmpeg"
    playlist_path = out_dir / "low.m3u8"
    segment_pattern = str(out_dir / ("l%04d.enc" if hls_key is not None else "low_%04d.ts"))

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(input_path),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        f"scale=-2:{LOW_HEIGHT}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-maxrate",
        "550k",
        "-bufsize",
        "1100k",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "60",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-ac",
        "2",
        "-f",
        "hls",
        "-hls_time",
        str(LOW_SEGMENT_DURATION),
        "-hls_playlist_type",
        "vod",
        "-hls_flags",
        "independent_segments",
    ]

    if hls_key is not None:
        key_file = out_dir / "low.key"
        key_file.write_bytes(hls_key)
        iv_hex = os.urandom(16).hex()
        keyinfo_file = out_dir / "low_keyinfo.txt"
        keyinfo_file.write_text(
            f"vault://key\n{key_file.as_posix()}\n{iv_hex}\n",
            encoding="utf-8",
        )
        cmd += ["-hls_key_info_file", str(keyinfo_file)]

    cmd += [
        "-hls_segment_filename",
        segment_pattern,
        str(playlist_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, **_win_no_window_kwargs())
    if proc.returncode != 0 or not playlist_path.exists():
        raise RuntimeError(f"FFmpeg 360p 変換に失敗しました:\n{proc.stderr[-800:]}")

    safe_w = src_width or 1280
    safe_h = src_height or 720
    low_w = max(2, int(round((safe_w / max(1, safe_h)) * LOW_HEIGHT / 2.0)) * 2)
    return playlist_path, low_w, LOW_HEIGHT


def sanitize_folder_name(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", title).strip()
    if len(cleaned) > 100:
        cleaned = cleaned[:100].rstrip()
    return cleaned or "video"


def guess_mime_type(path: Path, encrypted: bool) -> str:
    if encrypted:
        return "application/octet-stream"
    ext = path.suffix.lower()
    if ext == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if ext == ".ts":
        return "video/mp2t"
    if ext == ".json":
        return "application/json"
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def load_state(state_path: Path) -> Dict[str, Dict[str, str]]:
    if not state_path.exists():
        return {}
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state_path: Path, state: Dict[str, Dict[str, str]]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def invalidate_library_index(uploader: DriveUploader, folder_id: str) -> None:
    try:
        idx_id = uploader.find_file_in_folder("library_index.enc", folder_id)
        if idx_id:
            uploader.trash_file(idx_id)
            print("[INFO] library_index.enc を自動更新対象にしました。", flush=True)
    except Exception:
        pass


def process_single_video(
    input_path: Path,
    title: str,
    folder_id: str,
    uploader: Optional[DriveUploader],
    master_key: Optional[bytes],
    segment_duration: int,
    crf: int,
    copy_mode: str,
    with_360p: bool,
    workers: int,
    dry_run: bool,
    delete_source: bool,
) -> Dict[str, str]:
    encrypted = master_key is not None
    meta = probe_video(input_path)
    duration = float(meta["duration"])
    width = int(meta["width"])
    height = int(meta["height"])
    video_codec = str(meta["video_codec"])
    audio_codec = str(meta["audio_codec"])

    can_copy = video_codec == "h264" and audio_codec in ("aac", "mp3", "")
    use_copy = copy_mode == "copy" or (copy_mode == "auto" and can_copy)
    enable_low = with_360p and (height == 0 or height > LOW_HEIGHT + 60)

    mode_label = "copy(無劣化)" if use_copy else "re-encode(H.264/AAC)"
    enc_label = "E2EE暗号化" if encrypted else "平文"
    abr_label = "+360p高速ABR" if enable_low else "単一画質"
    print(
        f"  [1/3] {width}x{height} / {duration:.1f}s / {video_codec}+{audio_codec or 'none'} "
        f"-> {mode_label} [{enc_label} / {abr_label}]",
        flush=True,
    )

    with tempfile.TemporaryDirectory(prefix="vaultstream_") as tmp:
        work_dir = Path(tmp)
        thumb_path = work_dir / "thumbnail.jpg"
        sprite_path = work_dir / "sprite.jpg"
        hls_key = os.urandom(16) if encrypted else None
        low_hls_key = os.urandom(16) if (encrypted and enable_low) else None

        has_thumb = generate_thumbnail(input_path, thumb_path, duration)
        has_sprite = generate_sprite_sheet(input_path, sprite_path, duration)

        try:
            playlist_path = encode_hls(
                input_path=input_path,
                out_dir=work_dir,
                segment_duration=segment_duration,
                crf=crf,
                copy_streams=use_copy,
                hls_key=hls_key,
            )
        except RuntimeError:
            if use_copy and copy_mode == "auto":
                print("  [WARN] ストリームコピー失敗、H.264 再エンコードにフォールバックします...", flush=True)
                for old_f in list(work_dir.glob("*.enc")) + list(work_dir.glob("seg_*.ts")):
                    old_f.unlink(missing_ok=True)
                (work_dir / "index.m3u8").unlink(missing_ok=True)
                playlist_path = encode_hls(
                    input_path=input_path,
                    out_dir=work_dir,
                    segment_duration=segment_duration,
                    crf=crf,
                    copy_streams=False,
                    hls_key=hls_key,
                )
            else:
                raise

        low_playlist_path: Optional[Path] = None
        low_w = 0
        low_h = LOW_HEIGHT
        if enable_low:
            low_playlist_path, low_w, low_h = encode_low_hls(
                input_path=input_path,
                out_dir=work_dir,
                src_width=width,
                src_height=height,
                hls_key=low_hls_key,
            )

        if encrypted:
            assert master_key is not None and hls_key is not None
            segment_files = sorted(
                p for p in work_dir.glob("*.enc") if re.match(r"^\d{4}\.enc$", p.name)
            )
            low_segment_files = (
                sorted(p for p in work_dir.glob("l*.enc") if re.match(r"^l\d{4}\.enc$", p.name))
                if low_playlist_path is not None
                else []
            )
            enc_playlist_path = work_dir / "p.enc"
            enc_playlist_path.write_bytes(encrypt_aes_gcm(playlist_path.read_bytes(), master_key))

            enc_low_playlist_path: Optional[Path] = None
            if low_playlist_path is not None:
                enc_low_playlist_path = work_dir / "lp.enc"
                enc_low_playlist_path.write_bytes(
                    encrypt_aes_gcm(low_playlist_path.read_bytes(), master_key)
                )

            enc_thumb_path = work_dir / "t.enc"
            if has_thumb:
                enc_thumb_path.write_bytes(encrypt_aes_gcm(thumb_path.read_bytes(), master_key))

            enc_sprite_path = work_dir / "s.enc"
            if has_sprite:
                enc_sprite_path.write_bytes(encrypt_aes_gcm(sprite_path.read_bytes(), master_key))
        else:
            segment_files = sorted(work_dir.glob("seg_*.ts"))
            low_segment_files = sorted(work_dir.glob("low_*.ts")) if low_playlist_path else []
            enc_playlist_path = playlist_path
            enc_low_playlist_path = low_playlist_path
            enc_thumb_path = thumb_path
            enc_sprite_path = sprite_path

        total_size = (
            sum(f.stat().st_size for f in segment_files)
            + sum(f.stat().st_size for f in low_segment_files)
            + enc_playlist_path.stat().st_size
            + (enc_low_playlist_path.stat().st_size if enc_low_playlist_path else 0)
            + (enc_thumb_path.stat().st_size if has_thumb else 0)
            + (enc_sprite_path.stat().st_size if has_sprite else 0)
        )

        print(
            f"  [2/3] 生成完了: メイン {len(segment_files)}本"
            + (f" + 360p {len(low_segment_files)}本" if low_segment_files else "")
            + f" / 合計 {total_size / (1024 * 1024):.1f} MB",
            flush=True,
        )

        if dry_run or uploader is None:
            print("  [DRY-RUN] アップロードをスキップしました。", flush=True)
            return {"status": "dry-run"}

        if encrypted:
            folder_name = secrets.token_hex(8)
        else:
            timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")
            folder_name = f"{sanitize_folder_name(title)}_{timestamp}"

        video_folder_id = uploader.create_folder(folder_name, folder_id)

        upload_targets: List[Path] = []
        if has_thumb:
            upload_targets.append(enc_thumb_path)
        if has_sprite:
            upload_targets.append(enc_sprite_path)
        upload_targets.extend(segment_files)
        upload_targets.append(enc_playlist_path)
        if low_segment_files and enc_low_playlist_path is not None:
            upload_targets.extend(low_segment_files)
            upload_targets.append(enc_low_playlist_path)

        uploaded_ids: Dict[str, str] = {}

        def _upload_one(path: Path) -> Tuple[str, str]:
            fid = upload_with_retry(
                uploader, path, video_folder_id, guess_mime_type(path, encrypted)
            )
            return path.name, fid

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = [executor.submit(_upload_one, fp) for fp in upload_targets]
            for fut in tqdm(
                concurrent.futures.as_completed(futures),
                total=len(futures),
                desc="  Uploading",
                unit="file",
                leave=False,
            ):
                fname, fid = fut.result()
                uploaded_ids[fname] = fid

        manifest: Dict[str, object] = {
            "version": 2 if encrypted else 1,
            "encrypted": encrypted,
            "id": str(uuid.uuid4()),
            "title": title,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "duration": duration,
            "width": width,
            "height": height,
            "sizeBytes": total_size,
            "thumbnailFileId": uploaded_ids.get(enc_thumb_path.name),
            "spriteFileId": uploaded_ids.get(enc_sprite_path.name) if has_sprite else None,
            "playlistFileId": uploaded_ids[enc_playlist_path.name],
            "segments": {seg.name: uploaded_ids[seg.name] for seg in segment_files},
            "sourceFileName": input_path.name,
        }
        if encrypted and hls_key is not None:
            manifest["hlsKeyBase64"] = base64.b64encode(hls_key).decode("ascii")

        if low_segment_files and enc_low_playlist_path is not None:
            low_variant: Dict[str, object] = {
                "label": "360p (高速)",
                "width": low_w,
                "height": low_h,
                "bandwidth": 650000,
                "playlistFileId": uploaded_ids[enc_low_playlist_path.name],
                "segments": {seg.name: uploaded_ids[seg.name] for seg in low_segment_files},
            }
            if encrypted and low_hls_key is not None:
                low_variant["hlsKeyBase64"] = base64.b64encode(low_hls_key).decode("ascii")
            manifest["variants"] = [low_variant]

        manifest_json_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        if encrypted:
            assert master_key is not None
            manifest_path = work_dir / "m.enc"
            manifest_path.write_bytes(encrypt_aes_gcm(manifest_json_bytes, master_key))
            manifest_mime = "application/octet-stream"
        else:
            manifest_path = work_dir / "manifest.json"
            manifest_path.write_bytes(manifest_json_bytes)
            manifest_mime = "application/json"

        manifest_id = upload_with_retry(
            uploader, manifest_path, video_folder_id, manifest_mime
        )

        print(
            f"  [3/3] 完了! folder={folder_name} ({video_folder_id}) manifest={manifest_id}",
            flush=True,
        )

    if delete_source:
        input_path.unlink()
        print(f"  元動画ファイルを削除しました: {input_path.name}", flush=True)

    return {
        "videoFolderId": video_folder_id,
        "manifestId": manifest_id,
        "encrypted": str(encrypted),
        "uploadedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="動画を暗号化 HLS + 360p ABR + スプライトに変換して Google Drive (VaultStream) へ一括アップロードします。"
    )
    parser.add_argument("input", help="入力動画ファイルまたはフォルダのパス")
    parser.add_argument("--title", help="動画タイトル（単一ファイル時のみ、省略時はファイル名）")
    parser.add_argument(
        "--folder-id",
        default=os.environ.get("VAULT_FOLDER_ID", ""),
        help="アップロード先の Google Drive フォルダ ID",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("VAULT_PASSWORD", ""),
        help="E2EE 暗号化マスターパスワード（指定すると完全暗号化モード）",
    )
    parser.add_argument(
        "--prompt-password",
        action="store_true",
        help="パスワードを対話入力する（おすすめ）",
    )
    parser.add_argument(
        "--credentials",
        default="./credentials.json",
        help="デスクトップ用 OAuth クライアント JSON のパス (デフォルト: ./credentials.json)",
    )
    parser.add_argument(
        "--token",
        default="./token.json",
        help="認証トークンのキャッシュ保存先 (デフォルト: ./token.json)",
    )
    parser.add_argument(
        "--segment-duration",
        type=int,
        default=15,
        help="メイン HLS セグメント長（秒、デフォルト: 15）",
    )
    parser.add_argument(
        "--crf",
        type=int,
        default=22,
        help="H.264 CRF 値（再エンコード時、デフォルト: 22）",
    )
    parser.add_argument(
        "--copy-streams",
        action="store_true",
        help="常にストリームコピーで HLS 分割する",
    )
    parser.add_argument(
        "--auto-copy",
        action="store_true",
        default=True,
        help="H.264/AAC の場合は無劣化コピー、非対応形式のみ自動再エンコードする（デフォルト有効）",
    )
    parser.add_argument(
        "--no-auto-copy",
        action="store_true",
        help="自動コピーを無効にし、常に H.264/AAC へ再エンコードする",
    )
    parser.add_argument(
        "--no-360p",
        action="store_true",
        help="360p 高速スタート画質の自動生成をスキップする",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="セグメント並列アップロード数（デフォルト: 3）",
    )
    parser.add_argument(
        "--state-file",
        default="./.upload_state_e2ee.json",
        help="一括処理時の進捗保存ファイル（途中再開・重複スキップ用）",
    )
    parser.add_argument(
        "--delete-source",
        action="store_true",
        help="アップロード成功後に元動画ファイルを削除する（デフォルトは残す）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="HLS 変換とメタデータ生成のみ行い、Google Drive へのアップロードをスキップする",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    check_ffmpeg_available()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        print(f"[ERROR] パスが見つかりません: {input_path}", file=sys.stderr)
        return 1

    if not args.dry_run and not args.folder_id:
        print("[ERROR] --folder-id を指定してください。", file=sys.stderr)
        return 1

    passphrase = args.password
    if args.prompt_password and not passphrase:
        passphrase = getpass.getpass("VaultStream マスターパスワード: ")

    if args.copy_streams:
        copy_mode = "copy"
    elif args.no_auto_copy:
        copy_mode = "reencode"
    else:
        copy_mode = "auto"

    with_360p = not args.no_360p

    uploader: Optional[DriveUploader] = None
    master_key: Optional[bytes] = None
    if not args.dry_run:
        uploader = GoogleApiUploader(
            credentials_path=Path(args.credentials).expanduser().resolve(),
            token_path=Path(args.token).expanduser().resolve(),
        )
        if passphrase:
            master_key = ensure_vault_master_key(uploader, args.folder_id, passphrase)
    elif passphrase:
        master_key = derive_master_key(passphrase, b"0" * 16, PBKDF2_ITERATIONS)

    if input_path.is_file():
        title = (args.title or input_path.stem).strip()
        print(f"[1/1] 処理開始: {input_path.name}", flush=True)
        process_single_video(
            input_path=input_path,
            title=title,
            folder_id=args.folder_id,
            uploader=uploader,
            master_key=master_key,
            segment_duration=args.segment_duration,
            crf=args.crf,
            copy_mode=copy_mode,
            with_360p=with_360p,
            workers=args.workers,
            dry_run=args.dry_run,
            delete_source=args.delete_source,
        )
        if uploader is not None:
            invalidate_library_index(uploader, args.folder_id)
        return 0

    video_files = sorted(
        p for p in input_path.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS
    )
    if not video_files:
        print(f"[ERROR] 動画ファイルが見つかりません: {input_path}", file=sys.stderr)
        return 1

    state_path = Path(args.state_file).expanduser().resolve()
    state = load_state(state_path)
    total = len(video_files)
    done_count = 0
    skip_count = 0
    fail_list: List[Tuple[str, str]] = []

    enc_str = "E2EE" if master_key else "PLAIN"
    print(
        f"=== 一括アップロード開始 ({enc_str}): 全 {total} 本 (workers={args.workers}, mode={copy_mode}, 360p={with_360p}) ===",
        flush=True,
    )

    for idx, vf in enumerate(video_files, start=1):
        key = f"{vf.name}:{vf.stat().st_size}"
        if not args.dry_run and key in state:
            skip_count += 1
            print(f"[{idx}/{total}] SKIP (アップロード済): {vf.name}", flush=True)
            continue

        print(f"[{idx}/{total}] 処理中 ({vf.stat().st_size / (1024 * 1024):.1f} MB): {vf.name}", flush=True)
        try:
            result = process_single_video(
                input_path=vf,
                title=vf.stem.strip(),
                folder_id=args.folder_id,
                uploader=uploader,
                master_key=master_key,
                segment_duration=args.segment_duration,
                crf=args.crf,
                copy_mode=copy_mode,
                with_360p=with_360p,
                workers=args.workers,
                dry_run=args.dry_run,
                delete_source=args.delete_source,
            )
            if not args.dry_run:
                state[key] = result
                save_state(state_path, state)
            done_count += 1
        except Exception as err:
            print(f"  [ERROR] 失敗: {err}", file=sys.stderr, flush=True)
            fail_list.append((vf.name, str(err)))

    if uploader is not None and done_count > 0:
        invalidate_library_index(uploader, args.folder_id)

    print(
        f"=== 完了サマリー: 成功 {done_count} / スキップ {skip_count} / 失敗 {len(fail_list)} / 合計 {total} ===",
        flush=True,
    )
    return 1 if fail_list else 0


if __name__ == "__main__":
    raise SystemExit(main())
