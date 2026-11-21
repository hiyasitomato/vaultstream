<div align="center">

# VaultStream

**Turn your idle Google AI Pro (5TB) / Google Drive storage into a `$0/mo`, End-to-End Encrypted, YouTube-fast private video streaming PWA.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Cloudflare Pages](https://img.shields.io/badge/Hosting-Cloudflare%20Pages%20%240%2Fmo-F38020.svg)](https://pages.cloudflare.com/)
[![E2EE](https://img.shields.io/badge/Security-AES--256--GCM%20%2B%20AES--128%20HLS-blue.svg)](#security--e2ee-architecture)

**[English](README.md) | [日本語 (Japanese)](README.ja.md)**

</div>

---

## Why VaultStream?

Just subscribed to **Google AI Pro** for **Gemini 4 Neon** and suddenly have **5TB of Google Drive storage** sitting idle?

Yet existing ways to watch your personal video library from Google Drive all fall short:

| Solution | Hosting Cost | Client-Side E2EE | Fast Start (360p ABR) | 6×6 Hover Previews | Zero Backend Server |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Google Drive Native Player** | $0 | ❌ | ❌ | ❌ | ✅ |
| **Infuse Pro / VidHub** | $149 lifetime / sub | ❌ | ❌ | ❌ | ✅ |
| **Cryptomator** | Free / paid | ✅ | ❌ (no streaming) | ❌ | ✅ |
| **Plex / Jellyfin + rclone** | NAS / VPS cost | ❌ | ✅ | ✅ | ❌ |
| **VaultStream (This Repo)** | **$0/mo** | **✅** | **✅** | **✅** | **✅** |

**VaultStream** is a static Next.js PWA hosted on **Cloudflare Pages ($0/mo)** + an all-in-one Python/FFmpeg E2EE packer. Your browser talks **directly** to your own private Google Drive via the official Google Drive API v3 — **zero video bytes ever touch Cloudflare or any third-party server.**

---

## Key Features

### Performance Engineered Like YouTube
- **Dual-Rendition Fast-Start ABR (360p → Original HD/4K)**: Starts playback & seeking on lightweight 360p 8s chunks and automatically upgrades to your lossless original stream (`hls.js` ABR, plus manual quality switcher).
- **Hardware WebCrypto Decryption**: Uses native browser WebCrypto AES-128 (`progressive: false`, `enableSoftwareAES: false`) — zero slow JS software decryption.
- **6-Parallel Background Full-Video Prefetcher**: Downloads the entire video into a 512MB in-memory LRU cache while watching, deduplicated seamlessly with a custom `hls.js` fragment loader so seeking anywhere is instant.
- **6×6 Storyboard Hover Previews**: Smooth 36-frame scrub previews on both library cards and the unified custom seek bar.
- **Single Encrypted Catalog (`library_index.enc`) + IndexedDB Cache**: Instant home screen load even with hundreds of videos.

### Full End-to-End Encryption (Zero-Knowledge on Drive)
- **Video Segments**: AES-128-CBC with a unique random 16-byte key per video & rendition.
- **Metadata, Thumbnails, Sprites, Playlists, Genres & Watch History**: AES-256-GCM derived from your master passphrase via PBKDF2-SHA256 (100,000 iterations).
- **Anonymized Storage**: Random 16-char hex folder names and `application/octet-stream` MIME types on Google Drive.

### Modern Viewing & Library Management (PC / iPad / Mobile PWA)
- Unified YouTube-style custom player (auto-hide HUD, PiP, "Back to Home" mini-player that keeps playing, ±10s skip, speed control, keyboard shortcuts).
- **1-Click Thumbnail Capture & Timestamp Jump**: Capture any frame as the video's encrypted thumbnail; click the `📷 mm:ss` badge on any card or the seek bar marker to jump directly to that scene.
- Playback queue (reorder, shuffle, auto-play next, MediaSession controls).
- Custom genres, bulk assignment, multi-token AND / `-exclude` search, grid/list toggle, and encrypted cross-device sync (`user_meta.enc`).

---

## Architecture

```text
[Your PC]
  └─ packer/pack_video.py (Python + FFmpeg)
       ├─ Lossless/H.264 HLS + 360p Fast-Start ABR + 6x6 Sprite + Thumbnail
       └─ Local E2EE Encryption ──▶ [Your Private Google Drive Folder (5TB)]
                                                   │
                                        Official Google Drive API v3
                                        (Your OAuth Token — Direct)
                                                   ▼
[Cloudflare Pages ($0 Static PWA)] ──▶ [Browser on PC / iPad / Phone]
  (Video bytes never touch Cloudflare)       └─ WebCrypto Decryption + 512MB LRU Cache
```

---

## Quick Start (15 Minutes)

### Prerequisites
Install these free tools locally (FFmpeg binary is not bundled in this repository):
- **Node.js 20+**
- **Python 3.10+**
- **FFmpeg & FFprobe**:
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### 1. Create a Private Google Drive Folder & OAuth Credentials
1. Create a private folder in Google Drive (e.g. `VaultStream`) and copy its **Folder ID** from the URL (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
2. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a project and enable **Google Drive API**.
   - Configure the **OAuth consent screen** as **External / Testing** and add your own Gmail under **Test users**.
   - Create **two** OAuth 2.0 Client IDs under **Credentials**:
     1. **Web application** (for the PWA): Add `http://localhost:3000` (and later your `https://<project>.pages.dev` URL) under **Authorized JavaScript origins**. Copy the Client ID.
     2. **Desktop app** (for the Python packer): Download the JSON file and save it as `packer/credentials.json`.

### 2. Encrypt & Upload Your Videos
```bash
cd packer
pip install -r requirements.txt

# Pack & upload a single video or an entire folder (lossless HD + 360p ABR + thumbnail + 6x6 sprite + E2EE)
python pack_video.py "/path/to/your/videos" \
  --folder-id "YOUR_GOOGLE_DRIVE_FOLDER_ID" \
  --prompt-password
```
- Safe by default: **never deletes your original local videos** unless `--delete-source` is explicitly passed.
- Resumable: progress is tracked in `.upload_state_e2ee.json` so interrupted batches continue right where they left off.
- Use `--no-360p` if you want to skip 360p fast-start generation, or `--workers 2` if you hit temporary Drive API rate limits.

### 3. Build & Deploy the PWA for Free on Cloudflare Pages
```bash
cd ../pwa
cp .env.example .env.local
# Edit .env.local with your Web Client ID and Google Drive Folder ID

npm install
npm run build

# Deploy to Cloudflare Pages ($0 free tier)
npx wrangler login
npx wrangler pages project create my-vaultstream --production-branch main
npx wrangler pages deploy out --project-name my-vaultstream --branch main
```
Finally, add your deployed `https://my-vaultstream.pages.dev` URL to **Authorized JavaScript origins** in Google Cloud Console, open it on PC or add it to your iPad/iPhone home screen, sign in, enter your master passphrase, and enjoy!

---

## Troubleshooting

- **`Error 400: origin_mismatch`**: Make sure your exact deployed origin (`https://my-vaultstream.pages.dev`, no trailing slash) is added under **Authorized JavaScript origins** (not Redirect URIs), and open the production URL rather than a random preview subdomain.
- **`Error 403: access_denied`**: Add your Google account email under **OAuth consent screen → Test users**.
- **`403 Quota Exceeded` during large batch uploads**: Temporary Drive API rate limit. Re-run the same command with `--workers 2` to resume automatically.

---

## Disclaimer & License

- VaultStream is designed strictly for **private, personal use** on your own Google Drive account. Do not share public links or operate a public streaming service on top of Google Drive.
- Licensed under the [MIT License](LICENSE).
