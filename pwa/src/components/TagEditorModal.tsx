"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Search, Tag, X } from "lucide-react";
import {
  CATEGORY_TAG_SET,
  GENRE_GROUP_TABS,
  type GenreGroupId,
  getGenreStyle,
  matchesGenreGroup,
  sortGenresForCard,
} from "@/lib/genres";
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
  const [tagSearch, setTagSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState<GenreGroupId>("main");
  const activeSet = useMemo(() => new Set(currentGenres), [currentGenres]);

  const categoryTags = ["現実", "アニメ", "漫画"];

  // Unified strictly to the user's 作成済みマイジャンル (+ any already-attached tag on this item)
  const unifiedGenres = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    const add = (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed && !CATEGORY_TAG_SET.has(trimmed) && !seen.has(trimmed)) {
        seen.add(trimmed);
        list.push(trimmed);
      }
    };
    for (const g of customGenres) add(g.name);
    for (const g of currentGenres) add(g);
    return list;
  }, [customGenres, currentGenres]);

  const selectedSorted = useMemo(() => {
    const { content, credits } = sortGenresForCard(currentGenres);
    return [...content, ...credits];
  }, [currentGenres]);

  const normalizedSearch = tagSearch.trim().toLowerCase();

  const groupCounts = useMemo(() => {
    const map = new Map<GenreGroupId, number>();
    for (const tab of GENRE_GROUP_TABS) {
      map.set(tab.id, 0);
    }
    for (const g of unifiedGenres) {
      for (const tab of GENRE_GROUP_TABS) {
        if (matchesGenreGroup(g, tab.id)) {
          map.set(tab.id, (map.get(tab.id) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [unifiedGenres]);

  const visibleGenres = useMemo(() => {
    return unifiedGenres.filter((g) => {
      if (normalizedSearch) {
        return g.toLowerCase().includes(normalizedSearch);
      }
      return matchesGenreGroup(g, activeGroup);
    });
  }, [unifiedGenres, normalizedSearch, activeGroup]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const handleSubmitNew = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newGenre.trim().replace(/^#/, "");
    if (!cleaned) return;
    onAddCustomGenre(video.id, cleaned, "zinc");
    setNewGenre("");
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ジャンル・タグ編集"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Tag className="h-4 w-4 text-zinc-400" />
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

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Selected tags quick overview & 1-tap remove */}
          <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-200">
                選択中のタグ ({selectedSorted.length})
              </h3>
              <span className="text-[11px] text-zinc-500">タップで外す</span>
            </div>
            {selectedSorted.length === 0 ? (
              <p className="text-xs text-zinc-500">
                まだ内容タグが付いていません。下の一覧や検索から追加できます。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedSorted.map((genre) => (
                  <button
                    key={`sel-${genre}`}
                    type="button"
                    onClick={() => onToggleGenre(video.id, genre)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-950 transition hover:bg-white"
                    title="タップして外す"
                  >
                    <span>{genre}</span>
                    <X className="h-3 w-3 opacity-75" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Top-level Category Switcher (現実 / アニメ / 漫画) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-zinc-400">カテゴリ:</span>
            {categoryTags.map((cat) => {
              const selected = activeSet.has(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onToggleGenre(video.id, cat)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-bold transition ${
                    selected
                      ? "border-zinc-300 bg-zinc-100 text-zinc-950"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  {selected && <Check className="h-3 w-3" />}
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Tag search + group filter tabs */}
          <div className="space-y-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="タグを検索（例: 旅行、家族、作者名、制作会社名...）"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-8 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              {tagSearch && (
                <button
                  type="button"
                  onClick={() => setTagSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  aria-label="検索をクリア"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {!normalizedSearch ? (
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1">
                {GENRE_GROUP_TABS.map((tab) => {
                  const active = activeGroup === tab.id;
                  const count = groupCounts.get(tab.id) ?? 0;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveGroup(tab.id)}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        active
                          ? "border-zinc-600 bg-zinc-800 text-white"
                          : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className="font-mono text-[10px] opacity-70">{count}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-400">
                全 {unifiedGenres.length} タグから「{tagSearch.trim()}」を検索中（{visibleGenres.length} 件）
              </p>
            )}

            {/* Filtered 1-tap toggle chips */}
            {visibleGenres.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
                一致するタグがありません。下のフォームから新しく作成できます。
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {visibleGenres.map((genre) => {
                  const selected = activeSet.has(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => onToggleGenre(video.id, genre)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                        selected
                          ? "border-zinc-300 bg-zinc-100 font-semibold text-zinc-950"
                          : getGenreStyle(genre, customGenres)
                      }`}
                    >
                      {selected && <Check className="h-3.5 w-3.5" />}
                      {genre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create new genre */}
          <form onSubmit={handleSubmitNew} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                placeholder="新しいタグを追加..."
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newGenre.trim()}
                className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                作成して追加
              </button>
            </div>
          </form>
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
