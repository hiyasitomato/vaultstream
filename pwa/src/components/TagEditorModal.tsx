"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { GENRE_COLOR_OPTIONS, GENRE_RULES, getGenreStyle } from "@/lib/genres";
import type { CustomGenreDef, VaultVideoItem } from "@/lib/types";

interface TagEditorModalProps {
  video: VaultVideoItem;
  currentGenres: string[];
  customGenres: CustomGenreDef[];
  onToggleGenre: (videoId: string, genre: string) => void;
  onAddCustomGenre: (videoId: string, genre: string, color: string) => void;
  onClose: () => void;
}

export default function TagEditorModal({
  video,
  currentGenres,
  customGenres,
  onToggleGenre,
  onAddCustomGenre,
  onClose,
}: TagEditorModalProps) {
  const [newGenre, setNewGenre] = useState("");
  const [selectedColor, setSelectedColor] = useState("rose");
  const activeSet = new Set(currentGenres);

  // Merge user custom genres, preset genres, and any active genres into a single flat list
  const unifiedGenres = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const g of customGenres) {
      if (g.name && !seen.has(g.name)) {
        seen.add(g.name);
        list.push(g.name);
      }
    }
    for (const rule of GENRE_RULES) {
      if (rule.name && !seen.has(rule.name)) {
        seen.add(rule.name);
        list.push(rule.name);
      }
    }
    for (const g of currentGenres) {
      if (g && !seen.has(g)) {
        seen.add(g);
        list.push(g);
      }
    }
    return list;
  }, [customGenres, currentGenres]);

  const handleSubmitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newGenre.trim().replace(/^#/, "");
    if (!cleaned) return;
    onAddCustomGenre(video.id, cleaned, selectedColor);
    setNewGenre("");
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ジャンル・タグ編集"
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Tag className="h-4 w-4 text-rose-400" />
              <span>ジャンル・タグ設定</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-400">{video.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Create new genre */}
          <form onSubmit={handleSubmitNew} className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5">
            <div className="flex gap-2">
              <input
                type="text"
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                placeholder="新しいジャンル名を入力..."
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newGenre.trim()}
                className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                作成して追加
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-zinc-500">色:</span>
              {GENRE_COLOR_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedColor(c.id)}
                  className={`flex h-5 w-5 items-center justify-center rounded-full ${c.dot} transition ${
                    selectedColor === c.id
                      ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
                      : "opacity-60 hover:opacity-100"
                  }`}
                  title={c.label}
                />
              ))}
            </div>
          </form>

          {/* Unified genre list (always open, 1-tap toggle) */}
          <div>
            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
              ジャンル一覧（タップで ON / OFF）
            </h3>
            {unifiedGenres.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-4 text-center text-xs text-zinc-500">
                まだジャンルがありません。上の入力欄から好きなジャンルを作成してください。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {unifiedGenres.map((genre) => {
                  const selected = activeSet.has(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => onToggleGenre(video.id, genre)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? `${getGenreStyle(genre, customGenres)} ring-1 ring-white/30`
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                      #{genre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-zinc-100 px-5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white"
          >
            完了
          </button>
        </div>
      </div>
    </div>
  );
}
