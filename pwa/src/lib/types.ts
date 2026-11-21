export interface VaultConfig {
  version: number;
  kdf: string;
  iterations: number;
  salt: string;
  check: string;
}

export interface VaultQualityVariant {
  label: string;
  width: number;
  height: number;
  bandwidth: number;
  playlistFileId: string;
  hlsKeyBase64?: string;
  segments: Record<string, string>;
}

export interface VaultManifest {
  version: number;
  encrypted?: boolean;
  id: string;
  title: string;
  createdAt: string;
  duration: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  thumbnailFileId?: string;
  playlistFileId: string;
  hlsKeyBase64?: string;
  segments: Record<string, string>;
  variants?: VaultQualityVariant[];
  sourceFileName?: string;
  genres?: string[];
}

export interface VaultVideoItem {
  id: string;
  folderId: string;
  title: string;
  createdAt: string;
  duration: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  kind: "hls" | "direct";
  encrypted?: boolean;
  manifest?: VaultManifest;
  directFileId?: string;
  mimeType?: string;
  thumbnailFileId?: string;
  thumbnailModifiedTime?: string;
  spriteFileId?: string;
  sourceFileName?: string;
}

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
}

export interface PlaybackProgress {
  currentTime: number;
  duration: number;
  updatedAt: number;
  playCount?: number;
}

export interface VideoUserMeta {
  favorite?: boolean;
  addedGenres?: string[];
  removedGenres?: string[];
  thumbnailTimeSec?: number;
}

export interface CustomGenreDef {
  name: string;
  color: string;
}

export interface SyncedVaultUserData {
  version: number;
  updatedAt: number;
  useAutoGenres: boolean;
  customGenres: CustomGenreDef[];
  videoMeta: Record<string, VideoUserMeta>;
  progress?: Record<string, PlaybackProgress>;
}

export type NavSection = "home" | "genres" | "favorites" | "history" | "files";
export type ViewMode = "grid" | "list";
export type SortMode =
  | "newest"
  | "oldest"
  | "title_asc"
  | "title_desc"
  | "duration_desc"
  | "duration_asc"
  | "size_desc"
  | "recent_played";
export type DurationFilter = "all" | "short" | "medium" | "long";
export type QualityFilter = "all" | "hd1080" | "hd720" | "sd";
export type WatchFilter =
  | "all"
  | "unwatched"
  | "in_progress"
  | "watched"
  | "favorites"
  | "uncategorized";
