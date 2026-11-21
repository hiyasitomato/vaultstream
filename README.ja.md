# VaultStream（日本語ガイド）

**[English README](README.md) | 日本語**

**Google AI Pro（5TB）や Google One で余っている Google Drive 容量を、「サーバー代 0 円・完全暗号化（E2EE）・YouTube 並みの爆速プライベート動画アプリ」に変える OSS プロジェクトです。**

Cloudflare Pages の無料枠に静的フロントエンド（PWA）を置くだけで、バックエンドサーバー不要で PC・iPad・スマートフォンから安全かつ超高速に自分の動画ライブラリを視聴できます。

---

## なぜ作ったか（Gemini 4 Neon 目当てで入った Google AI Pro の 5TB を最強の動画ライブラリに）

**Gemini 4 Neon** を使いたくて **Google AI Pro（月額 2,900 円）** を契約したら、特典で **5TB の Google Drive** が付いてきて余っていませんか？  
せっかく 5TB あるのに、Google Drive 標準プレイヤーは読み込みが遅く、シークも重く、整理もしにくい問題があります。

| 手段 | 維持費 | 完全暗号化 (E2EE) | 360p 高速スタート | 6×6 ホバープレビュー | サーバー不要 |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Google Drive 標準** | 0 円 | ❌ | ❌ | ❌ | ✅ |
| **Infuse Pro / VidHub** | 買い切り約 2.2 万円 | ❌ | ❌ | ❌ | ✅ |
| **Cryptomator** | 無料〜有料 | ✅ | ❌（ストリーミング不可） | ❌ | ✅ |
| **Plex / Jellyfin + rclone** | NAS / VPS 代 | ❌ | ✅ | ✅ | ❌ |
| **VaultStream（本プロジェクト）** | **0 円** | **✅** | **✅** | **✅** | **✅** |

---

## 主な機能

- **完全エンドツーエンド暗号化（E2EE）**
  - 動画セグメントは **AES-128-CBC**、メタデータ・サムネイル・ホバースプライト・ジャンル・視聴履歴は **AES-256-GCM**（PBKDF2-SHA256 100,000 回）でローカル暗号化。
  - Drive 上のフォルダ名はランダム 16 桁、MIME タイプもすべて `application/octet-stream` に匿名化。
- **YouTube 級の高速化設計**
  - **360p 高速スタート ABR**：再生開始・シーク時は超軽量 360p（8 秒）で即再生し、自動で元画質（Full HD / 4K）へ昇格。
  - **WebCrypto ハードウェア復号**：`progressive: false` / `enableSoftwareAES: false` でブラウザのネイティブ暗号エンジンをフル活用。
  - **6 並列バックグラウンド全編キャッシュ（512MB LRU）**：視聴中に動画全編をメモリへ先読みし、`hls.js` の独自ローダーと重複排除して統合。
  - **6×6 ホバー・ストーリーボードプレビュー**：一覧カード・シークバー両方で 36 コマのコマ送りプレビュー。
  - **単一暗号化カタログ（`library_index.enc`）＋ IndexedDB キャッシュ**。
- **快適なプレイヤー＆整理機能（PC / iPad / スマホ PWA 対応）**
  - 統一カスタムプレイヤー（PiP / ホームへ戻っても再生継続するミニプレイヤー / ±10 秒 / 速度変更 / 連続再生キュー）
  - ワンクリックで現在フレームを暗号化サムネイルに保存＋**`📷 mm:ss` バッジからそのシーンへ直接ジャンプ**
  - マイジャンル管理・一括振り分け・高度フィルタ・PC/iPad 間の暗号化クラウド同期

---

## セットアップ手順（約 15 分）

### 前提ツール（各自インストール）
※FFmpeg 本体は本リポジトリに同梱していません。各自インストールしてください。
- **Node.js 20+**
- **Python 3.10+**
- **FFmpeg / FFprobe**
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### 1. Google Drive フォルダと OAuth クライアントの準備
1. Google Drive に非公開フォルダ（例：`VaultStream`）を作成し、URL 末尾の **フォルダ ID** を控える。
2. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、**Google Drive API** を有効化。
3. **OAuth 同意画面** を「外部 / テスト」で設定し、**テストユーザーに自分の Gmail アドレスを追加**。
4. **認証情報** から OAuth クライアント ID を 2 つ作成：
   - **ウェブアプリケーション**（PWA 用）：「**承認済みの JavaScript 生成元**」に `http://localhost:3000`（デプロイ後に本番 URL も追加）を登録し、クライアント ID を控える。
   - **デスクトップアプリ**（パッカー用）：JSON をダウンロードして `packer/credentials.json` に配置。

### 2. 動画を暗号化してアップロード
```bash
cd packer
pip install -r requirements.txt

# フォルダごと一括で「元画質 + 360p ABR + サムネ + 6×6スプライト」を E2EE アップロード
python pack_video.py "動画フォルダのパス" \
  --folder-id "あなたのGoogleDriveフォルダID" \
  --prompt-password
```
- デフォルトで元の動画ファイルは削除されません。
- 進捗は `.upload_state_e2ee.json` に保存されるため、途中で止まっても同じコマンドで続きから再開できます。
- 360p 生成を省きたい場合は `--no-360p`、API 制限が出た場合は `--workers 2` を指定してください。

### 3. Cloudflare Pages へ無料デプロイ
```bash
cd ../pwa
cp .env.example .env.local
# .env.local に Web用クライアントID と Google Drive フォルダID を記入

npm install
npm run build

npx wrangler login
npx wrangler pages project create my-vaultstream --production-branch main
npx wrangler pages deploy out --project-name my-vaultstream --branch main
```
発行された本番 URL（`https://my-vaultstream.pages.dev`）を Google Cloud Console の「**承認済みの JavaScript 生成元**」に追加すれば完了です！

---

## トラブルシューティング
- **`エラー 400: origin_mismatch`**：リダイレクト URI ではなく「**承認済みの JavaScript 生成元**」に本番 URL（末尾の `/` なし）を登録してください。
- **`エラー 403: access_denied`**：OAuth 同意画面の「テストユーザー」に自分の Gmail を追加してください。
- **アップロード時の `403 Quota Exceeded`**：一時的な API 制限です。`--workers 2` を付けて再実行すると続きから再開します。

---

## 注意事項・ライセンス
- 本プロジェクトは、ご自身の Google Drive アカウントでの**完全非公開な個人利用**を前提としています。共有リンクでの外部配信や商用 CDN 用途には使用しないでください。
- [MIT License](LICENSE)
