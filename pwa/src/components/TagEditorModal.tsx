"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Tag, X } from "lucide-react";
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
  const [showPresets, setShowPresets] = useState(false);
  const activeSet = new Set(currentGenres);

  const groupedPresets = GENRE_RULES.reduce<Record<string, string[]>>((acc, rule) => {
    if (!acc[rule.group]) acc[rule.group] = [];
    acc[rule.group].push(rule.name);
    return acc;
  }, {});

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
          {/* Create new custom genre */}
          <form onSubmit={handleSubmitNew} className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3.5">
            <div className="flex gap-2">
              <input
                type="text"
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                placeholder="新しいジャンル名を入力（例: バトル、日常、異世界、SF...）"
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

          {/* User's own custom genres */}
          <div>
            <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-300">
              マイジャンル（タップで ON / OFF）
            </h3>
            {customGenres.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-4 text-center text-xs text-zinc-500">
                まだマイジャンルがありません。上の入力欄から好きなジャンルを作成してください。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {customGenres.map((genre) => {
                  const selected = activeSet.has(genre.name);
                  return (
                    <button
                      key={genre.name}
                      type="button"
                      onClick={() => onToggleGenre(video.id, genre.name)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? `${getGenreStyle(genre.name, customGenres)} ring-1 ring-white/30`
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                      #{genre.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Optional collapsible preset genres */}
          <div className="border-t border-zinc-800/80 pt-3">
            <button
              type="button"
              onClick={() => setShowPresets((prev) => !prev)}
              className="flex w-full items-center justify-between py-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
            >
              <span>プリセットジャンルから選ぶ（任意）</span>
              {showPresets ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {showPresets && (
              <div className="mt-3 space-y-4">
                {Object.entries(groupedPresets).map(([groupName, names]) => (
                  <div key={groupName}>
                    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      {groupName}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {names.map((genre) => {
                        const selected = activeSet.has(genre);
                        return (
                          <button
                            key={genre}
                            type="button"
                            onClick={() => onToggleGenre(video.id, genre)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                              selected
                                ? `${getGenreStyle(genre, customGenres)} ring-1 ring-white/25`
                                : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                            }`}
                          >
                            {selected && <Check className="h-3 w-3" />}
                            #{genre}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
