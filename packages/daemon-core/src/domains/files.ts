import type { WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

export interface FileContent {
  content: string | Uint8Array;
  encoding: 'utf-8' | 'binary';
  etag: string;
}

export interface WriteResult {
  etag: string;
  bytesWritten: number;
}

export interface FileStat {
  exists: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  etag: string;
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
}

export interface ListOpts {
  hidden?: boolean;
  recursive?: boolean;
  limit?: number;
}

export interface SearchQuery {
  pattern: string;
  globs?: string[];
  caseSensitive?: boolean;
  limit?: number;
}

export interface SearchHit {
  relPath: string;
  line: number;
  column: number;
  preview: string;
}

export interface QuickOpenHit {
  relPath: string;
  score: number;
}

export type FileWatchEvent =
  | { kind: 'created'; relPath: string }
  | { kind: 'modified'; relPath: string }
  | { kind: 'deleted'; relPath: string }
  | { kind: 'renamed'; fromRel: string; toRel: string };

export interface FileWatchParams {
  workspacePath: WorkspacePath;
  relPath?: string;
}

export interface FilesCapability {
  read(workspacePath: WorkspacePath, relPath: string): Promise<FileContent>;
  write(
    workspacePath: WorkspacePath,
    relPath: string,
    content: string | Uint8Array,
  ): Promise<WriteResult>;
  stat(workspacePath: WorkspacePath, relPath: string): Promise<FileStat>;
  list(
    workspacePath: WorkspacePath,
    relDir: string,
    opts?: ListOpts,
  ): Promise<FileEntry[]>;
  delete(workspacePath: WorkspacePath, relPath: string): Promise<void>;
  rename(
    workspacePath: WorkspacePath,
    fromRel: string,
    toRel: string,
  ): Promise<void>;
  move(
    workspacePath: WorkspacePath,
    fromRel: string,
    toRel: string,
  ): Promise<void>;
  mkdir(workspacePath: WorkspacePath, relPath: string): Promise<void>;
  search(
    workspacePath: WorkspacePath,
    query: SearchQuery,
  ): Promise<SearchHit[]>;
  quickOpen(
    workspacePath: WorkspacePath,
    query: string,
    limit: number,
  ): Promise<QuickOpenHit[]>;
  watch(
    params: FileWatchParams,
    onEvent: (event: FileWatchEvent) => void,
  ): Promise<StreamHandle>;
}
