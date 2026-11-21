import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-zinc-200">
      <div className="mb-8 flex items-center justify-between border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-bold text-white">
          Terms of Service / 利用規約
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
            1. Personal Private Use / 個人利用の目的
          </h2>
          <p>
            VaultStream is a free, open-source client-side web player designed strictly for
            private, personal media storage and playback on your own Google Drive account.
            You agree not to use VaultStream to distribute copyrighted content publicly,
            violate Google Drive&apos;s Terms of Service, or store unlawful material.
          </p>
          <p className="mt-2 text-zinc-400">
            VaultStream はご自身の Google Drive アカウントで個人的な動画をプライベートに再生・管理するための無料オープンソースアプリです。第三者への不正配信や Google の利用規約・法令に違反する利用は禁止します。
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            2. Your Responsibility for Passphrases &amp; Backups / パスワードとバックアップ
          </h2>
          <p>
            Because VaultStream uses true end-to-end encryption (E2EE), we never see or store
            your master passphrase. If you forget your passphrase, your encrypted files cannot
            be recovered. Always keep backups of important original video files.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-bold text-white">
            3. Disclaimer of Warranty / 免責事項（MIT License）
          </h2>
          <p>
            VaultStream is provided &quot;AS IS&quot;, without warranty of any kind, express
            or implied, under the MIT License. In no event shall the authors or copyright
            holders be liable for any claim, damages, data loss, or other liability arising
            from the use of the software.
          </p>
        </div>
      </section>
    </main>
  );
}
