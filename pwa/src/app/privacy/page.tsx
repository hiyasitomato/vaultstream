import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-zinc-200">
      <div className="mb-8 flex items-center justify-between border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-bold text-white">
          Privacy Policy / プライバシーポリシー
        </h1>
        <Link
          href="/"
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          ← Back to VaultStream
        </Link>
      </div>

      <p className="mb-6 text-xs text-zinc-400">Last Updated: November 21, 2026</p>

      <section className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            1. Zero-Server Architecture / サーバー不介在（完全クライアント完結）
          </h2>
          <p>
            VaultStream is a 100% client-side, static Progressive Web Application (PWA).
            We do <strong>not</strong> operate any backend server, database, analytics tracker,
            or cloud storage of our own. All network traffic occurs directly between your web
            browser and Google&apos;s official APIs (<code>www.googleapis.com</code> and{" "}
            <code>accounts.google.com</code>).
          </p>
          <p className="mt-2 text-zinc-400">
            VaultStream は完全なクライアント完結型の静的 Web アプリです。開発者のバックエンドサーバーやデータベースは一切存在せず、動画データ・認証トークン・暗号化パスワード・設定情報が外部サーバーへ送信されることはありません。
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            2. Google Drive Data Accessed / アクセスする Google Drive データ
          </h2>
          <p>
            VaultStream requests only the minimal scope{" "}
            <code>https://www.googleapis.com/auth/drive.file</code> (non-sensitive per-file access).
            This scope strictly restricts VaultStream to accessing <strong>only</strong> the
            dedicated <code>VaultStream</code> folder and encrypted media/metadata files created
            directly by VaultStream itself. VaultStream <strong>cannot</strong> view, list, read,
            or modify any other files in your Google Drive.
          </p>
          <p className="mt-2 text-zinc-400">
            本アプリは最小権限スコープ（<code>drive.file</code>）のみを使用し、本アプリ自身が作成した専用フォルダ（<code>VaultStream</code>）内のファイルのみにアクセスします。Google Drive 内の他のファイルやフォルダを読み取ることは技術的に不可能です。
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            3. Local Storage &amp; End-to-End Encryption / 端末内保存と E2EE 暗号化
          </h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Your videos, thumbnails, hover preview sprites, custom genres, and watch progress
              are encrypted locally inside your browser using WebCrypto (AES-256-GCM / AES-128-CBC)
              before being uploaded to your own Google Drive.
            </li>
            <li>
              Your OAuth access token, folder ID, optional master passphrase, and decrypted
              thumbnail cache are stored exclusively in your browser&apos;s local storage / IndexedDB
              for playback performance and are never transmitted to any third party.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            4. Google API Services User Data Policy (Limited Use Disclosure)
          </h2>
          <p>
            VaultStream&apos;s use and transfer to any other app of information received from
            Google APIs will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
              className="text-rose-400 underline hover:text-rose-300"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. VaultStream does not sell user data,
            does not serve advertisements, and does not use Google user data to train AI/ML models.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            5. Data Deletion &amp; Access Revocation / データ削除と連携解除
          </h2>
          <p>
            You retain 100% ownership and control of your data at all times:
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              Sign out inside VaultStream to immediately revoke your session token and clear
              all locally cached thumbnails and credentials.
            </li>
            <li>
              Revoke Google account permissions anytime at{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className="text-rose-400 underline hover:text-rose-300"
              >
                myaccount.google.com/permissions
              </a>
              .
            </li>
            <li>
              Delete the <code>VaultStream</code> folder in your Google Drive to permanently
              remove all uploaded data.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            6. Open Source Verification &amp; Contact / ソースコード公開と連絡先
          </h2>
          <p>
            VaultStream is open source under the MIT License. You can inspect the complete
            source code or report issues at{" "}
            <a
              href="https://github.com/hiyasitomato/vaultstream"
              target="_blank"
              rel="noreferrer"
              className="text-rose-400 underline hover:text-rose-300"
            >
              github.com/hiyasitomato/vaultstream
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
