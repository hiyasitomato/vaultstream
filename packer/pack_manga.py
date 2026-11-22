#!/usr/bin/env python3
"""
VaultStream E2EE Manga Packer

Encrypts manga image folders (natural-sorted pages: .jpg/.jpeg/.png/.webp)
with AES-256-GCM into anonymized Google Drive folders, generates a crisp 480px
cover thumbnail (t.enc), writes m.enc (kind="manga"), auto-tags #漫画 in
user_meta.enc, and refreshes library_index.enc.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

from tqdm import tqdm

from pack_video import (
    GdriveCliUploader,
    encrypt_aes_gcm,
    ensure_vault_master_key,
    load_state,
    save_state,
    upload_with_retry,
)
from smart_batch_upload import sync_tags_to_user_meta, trash_drive_file_cli

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def natural_sort_key(path: Path) -> List[object]:
    parts = re.split(r"(\d+)", path.name.lower())
    return [int(p) if p.isdigit() else p for p in parts]


def guess_image_mime(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    if ext == ".gif":
        return "image/gif"
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "image/jpeg"


def make_cover_thumbnail(first_page: Path, out_jpg: Path) -> bool:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(first_page),
        "-vf",
        "scale=480:-2",
        "-q:v",
        "3",
        str(out_jpg),
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    return proc.returncode == 0 and out_jpg.exists() and out_jpg.stat().st_size > 0


def find_manga_folders(root: Path) -> List[Tuple[Path, List[Path]]]:
    """Find every directory under root (including root itself) that directly contains >= 5 images."""
    found: List[Tuple[Path, List[Path]]] = []
    candidates = [root] + sorted(p for p in root.rglob("*") if p.is_dir())
    for d in candidates:
        imgs = sorted(
            (p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS),
            key=natural_sort_key,
        )
        if len(imgs) >= 3:
            found.append((d, imgs))
    return found


def pack_single_manga(
    manga_dir: Path,
    image_files: List[Path],
    folder_id: str,
    uploader: GdriveCliUploader,
    master_key: bytes,
    workers: int = 3,
) -> Dict[str, str]:
    title = manga_dir.name.strip()
    total_raw_size = sum(p.stat().st_size for p in image_files)

    with tempfile.TemporaryDirectory(prefix="vaultstream_manga_") as tmp:
        work_dir = Path(tmp)

        # Generate encrypted cover thumbnail from page 1
        thumb_jpg = work_dir / "cover.jpg"
        has_thumb = make_cover_thumbnail(image_files[0], thumb_jpg)
        enc_thumb = work_dir / "t.enc"
        if has_thumb:
            enc_thumb.write_bytes(encrypt_aes_gcm(thumb_jpg.read_bytes(), master_key))

        # Encrypt all pages
        enc_pages: List[Tuple[int, Path, str]] = []
        for idx, img in enumerate(image_files):
            enc_path = work_dir / f"{idx:04d}.enc"
            enc_path.write_bytes(encrypt_aes_gcm(img.read_bytes(), master_key))
            enc_pages.append((idx, enc_path, guess_image_mime(img)))

        drive_folder_name = secrets.token_hex(8)
        manga_folder_id = uploader.create_folder(drive_folder_name, folder_id)

        upload_targets: List[Path] = []
        if has_thumb:
            upload_targets.append(enc_thumb)
        upload_targets.extend(p for _, p, _ in enc_pages)

        uploaded_ids: Dict[str, str] = {}

        def _up(p: Path) -> Tuple[str, str]:
            fid = upload_with_retry(uploader, p, manga_folder_id, "application/octet-stream")
            return p.name, fid

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            futures = [ex.submit(_up, fp) for fp in upload_targets]
            for fut in tqdm(
                concurrent.futures.as_completed(futures),
                total=len(futures),
                desc="  Pages",
                unit="page",
                leave=False,
            ):
                fname, fid = fut.result()
                uploaded_ids[fname] = fid

        manga_id = str(uuid.uuid4())
        pages_meta = [
            {"fileId": uploaded_ids[enc_path.name], "mimeType": mime}
            for _, enc_path, mime in enc_pages
        ]
        manifest: Dict[str, object] = {
            "version": 2,
            "kind": "manga",
            "encrypted": True,
            "id": manga_id,
            "title": title,
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "duration": 0,
            "sizeBytes": total_raw_size,
            "thumbnailFileId": uploaded_ids.get("t.enc") or pages_meta[0]["fileId"],
            "pageCount": len(pages_meta),
            "pages": pages_meta,
            "sourceFileName": title,
        }

        manifest_path = work_dir / "m.enc"
        manifest_path.write_bytes(
            encrypt_aes_gcm(
                json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
                master_key,
            )
        )
        manifest_id = upload_with_retry(
            uploader, manifest_path, manga_folder_id, "application/octet-stream"
        )

        return {
            "mangaId": manga_id,
            "mangaFolderId": manga_folder_id,
            "manifestId": manifest_id,
            "pageCount": str(len(pages_meta)),
            "uploadedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="漫画フォルダを E2EE 暗号化して VaultStream へ一括アップロード")
    parser.add_argument("input_dirs", nargs="+", help="漫画フォルダを含むルートディレクトリ（複数指定可）")
    parser.add_argument("--folder-id", required=True)
    parser.add_argument("--password", default=os.environ.get("VAULT_PASSWORD", ""))
    parser.add_argument("--state-file", default="./.manga_state_e2ee.json")
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    manga_list: List[Tuple[Path, List[Path]]] = []
    seen_keys: set[str] = set()
    for raw_dir in args.input_dirs:
        root = Path(raw_dir).resolve()
        if not root.exists():
            print(f"[WARN] Path not found: {root}", file=sys.stderr)
            continue
        for m_dir, imgs in find_manga_folders(root):
            dedupe_key = f"{m_dir.name.strip()}:{len(imgs)}"
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            manga_list.append((m_dir, imgs))

    if not manga_list:
        print("No manga image folders found.", flush=True)
        return 0

    state_path = Path(args.state_file).resolve()
    state = load_state(state_path)

    uploader = GdriveCliUploader()
    master_key = ensure_vault_master_key(uploader, args.folder_id, args.password)

    print(f"=== 漫画 E2EE アップロード開始: 全 {len(manga_list)} 冊 ===", flush=True)
    done = 0
    skipped = 0
    failed = 0
    new_tags: Dict[str, Tuple[List[str], bool]] = {}

    for idx, (m_dir, imgs) in enumerate(manga_list, start=1):
        key = f"{m_dir.name}:{len(imgs)}"
        if key in state:
            skipped += 1
            print(f"[{idx}/{len(manga_list)}] SKIP (済): {len(imgs)} ページ", flush=True)
            continue

        print(f"[{idx}/{len(manga_list)}] 処理中 ({len(imgs)} ページ)...", flush=True)
        try:
            res = pack_single_manga(m_dir, imgs, args.folder_id, uploader, master_key, args.workers)
            state[key] = res
            save_state(state_path, state)
            new_tags[res["mangaId"]] = (["漫画"], False)
            done += 1
            print(f"  [OK] 完了 ({len(imgs)} ページ)", flush=True)
        except Exception as err:
            failed += 1
            print(f"  [ERROR] 失敗: {err}", file=sys.stderr, flush=True)

    if new_tags:
        sync_tags_to_user_meta(uploader, args.folder_id, master_key, new_tags)

    if done > 0:
        idx_id = uploader.find_file_in_folder("library_index.enc", args.folder_id)
        if idx_id:
            trash_drive_file_cli(uploader, idx_id)
            print("[SYNC] library_index.enc を更新対象にしました", flush=True)

    print(f"=== 漫画アップロード完了: 成功 {done} / スキップ {skipped} / 失敗 {failed} ===", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
