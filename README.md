<div align="center">

# VaultStream

**Turn your idle Google AI Pro (5TB) / Google Drive storage into a `$0/mo`, End-to-End Encrypted, YouTube-fast private video streaming PWA.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Cloudflare Pages](https://img.shields.io/badge/Hosting-Cloudflare%20Pages%20%240%2Fmo-F38020.svg)](https://pages.cloudflare.com/)
[![E2EE](https://img.shields.io/badge/Security-AES--256--GCM%20%2B%20AES--128%20HLS-blue.svg)](#key-features)
[![Web App](https://img.shields.io/badge/Try%20on%20Phone%20%2F%20Browser-Open%20PWA-e11d48.svg)](https://hiyasitomato.github.io/vaultstream/)

**[English](README.md) | [日本語 (Japanese)](README.ja.md)** | **[📱 Open Hosted PWA (No PC Needed)](https://hiyasitomato.github.io/vaultstream/)** | **[🪟 Download Windows App (.exe)](https://github.com/hiyasitomato/vaultstream/releases)**

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

### Modern Viewing, Mobile Upload & Library Management (PC / iPad / Phone PWA)
- **Built-in Smartphone / Browser E2EE Uploader (Zero PC Needed)**: Select videos directly from iPhone Photos or Android Gallery — VaultStream automatically generates the encrypted thumbnail, 6×6 hover sprite, and AES-256-GCM encrypted video right inside your browser and uploads straight to your Google Drive.
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

## Quick Start

### 📱 Fastest Path: Smartphone / Browser Only (Zero PC, Zero Coding!)
1. In [Google Cloud Console](https://console.cloud.google.com/), create a free project, enable **Google Drive API**, add your Gmail as a **Test user**, and create a **Web application** OAuth Client ID with **`https://hiyasitomato.github.io`** under **Authorized JavaScript origins**.
2. Open **[https://hiyasitomato.github.io/vaultstream/](https://hiyasitomato.github.io/vaultstream/)** on your iPhone / Android / iPad / PC (and add to Home Screen as a PWA).
3. Tap the **⚙ Settings** button, paste your **Web Client ID** and your private **Google Drive Folder URL**, sign in with Google, and tap **Upload** to encrypt & upload videos straight from your camera roll! *(Your data talks directly between your browser and your own Google Drive — nothing ever touches any third-party server.)*

---

### 💻 Self-Hosted & Bulk / Large Video Setup (PC + 360p Fast-Start ABR)

### Prerequisites
- **FFmpeg & FFprobe** (not bundled in this repo):
  - Windows: `winget install Gyan.FFmpeg` *(or click the built-in **"Install FFmpeg"** button inside `VaultStream-Packer.exe`)*
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
- **Node.js 20+** (for deploying the PWA to Cloudflare Pages)
- **Python 3.10+** *(only needed if you use the CLI instead of `VaultStream-Packer.exe`)*

### 0. Get VaultStream
- **Windows GUI App (Easiest — no Python required)**: Download `VaultStream-Packer.exe` from the **[Releases page](https://github.com/hiyasitomato/vaultstream/releases)**.
- **Full Source Code (for PWA deploy & CLI)**:
  ```bash
  git clone https://github.com/hiyasitomato/vaultstream.git
  cd vaultstream
  ```
  *(Or click the green **Code → Download ZIP** button on GitHub.)*

### 1. Create a Private Google Drive Folder & OAuth Credentials (Free)
1. Create a private folder in Google Drive (e.g. `VaultStream`) and copy its URL or **Folder ID** (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
2. In [Google Cloud Console](https://console.cloud.google.com/):
   - Create a new project and enable **Google Drive API** under *APIs & Services → Library*.
   - Under *Google Auth Platform / OAuth consent screen*, set User Type to **External**, leave status as **Testing** (no Google verification needed for personal use), and add your own Gmail under **Test users**.
   - Under *Clients / Credentials → Create Credentials → OAuth client ID*, create **two** clients:
     1. **Web application** (for the PWA): Add `http://localhost:3000` (and later your `https://<project>.pages.dev` URL) under **Authorized JavaScript origins**. Copy the Client ID.
     2. **Desktop app** (for the Packer): Download the JSON file and rename it to `credentials.json` (place it next to `VaultStream-Packer.exe` or inside `packer/`).

### 2. Encrypt & Upload Your Videos

#### Option A: Windows Desktop GUI App (`VaultStream-Packer.exe`) — Recommended
1. Double-click `VaultStream-Packer.exe` *(if Windows SmartScreen pops up for an unsigned app, click **More info → Run anyway**)*.
2. Select your video file or folder, paste your Google Drive folder URL (ID is extracted automatically), select `credentials.json`, enter your master passphrase, and click **Start**.
3. If FFmpeg isn't installed yet, click the **Install FFmpeg** button in the top-right corner of the app.

#### Option B: Command Line (Windows / macOS / Linux)
```bash
cd packer
pip install -r requirements.txt

# Pack & upload a single video or an entire folder (lossless HD + 360p ABR + thumbnail + 6x6 sprite + E2EE)
python pack_video.py "/path/to/your/videos" \
  --folder-id "YOUR_GOOGLE_DRIVE_FOLDER_ID" \
  --prompt-password
```
- Safe by default: **never deletes your original local videos** unless `--delete-source` is explicitly enabled.
- Resumable: progress is tracked in `.upload_state_e2ee.json` so interrupted batches continue right where they left off.
- Build the `.exe` yourself anytime on Windows via `packer\build_exe.ps1`.

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
