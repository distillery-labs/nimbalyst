import { promises as fs } from 'node:fs';
import path from 'node:path';

import { RuntimeErrorObject } from '../types/errors.js';
import type {
  FileContent,
  FileEntry,
  FileStat,
  FilesCapability,
  ListOpts,
  QuickOpenHit,
  SearchHit,
  SearchQuery,
  WriteResult,
} from '../domains/files.js';
import type { StreamHandle } from '../types/streams.js';
import type { WorkspacePath } from '../types/identifiers.js';

/**
 * Node-fs implementation of FilesCapability. Used by the local runtime
 * (Electron main) and by the daemon (Phase 1). Read/write are confined to
 * the workspace root — any relPath that escapes (via `..` or absolute paths)
 * throws PERMISSION_DENIED.
 *
 * Etags are computed as `{mtimeMs}-{size}`. Cheap and sufficient for the
 * last-writer-wins semantics today's IPC handlers already use. If we later
 * adopt compare-and-set, `write` can be extended to accept an `ifMatch`
 * parameter.
 *
 * Search, quickOpen, and watch are intentionally not implemented yet — they
 * need ripgrep / chokidar plumbing migrated from packages/electron and will
 * land in the next chunk.
 */
export class LocalFilesCapability implements FilesCapability {
  async read(
    workspacePath: WorkspacePath,
    relPath: string,
  ): Promise<FileContent> {
    const absolute = this.resolveSafe(workspacePath, relPath);
    const [buffer, stat] = await Promise.all([
      fs.readFile(absolute),
      fs.stat(absolute),
    ]);
    const looksBinary = isProbablyBinary(buffer);
    return {
      content: looksBinary ? buffer : buffer.toString('utf-8'),
      encoding: looksBinary ? 'binary' : 'utf-8',
      etag: makeEtag(stat.mtimeMs, stat.size),
    };
  }

  async write(
    workspacePath: WorkspacePath,
    relPath: string,
    content: string | Uint8Array,
  ): Promise<WriteResult> {
    const absolute = this.resolveSafe(workspacePath, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const data =
      typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    await fs.writeFile(absolute, data);
    const stat = await fs.stat(absolute);
    return {
      etag: makeEtag(stat.mtimeMs, stat.size),
      bytesWritten: data.byteLength,
    };
  }

  async stat(
    workspacePath: WorkspacePath,
    relPath: string,
  ): Promise<FileStat> {
    const absolute = this.resolveSafe(workspacePath, relPath);
    try {
      const stat = await fs.stat(absolute);
      return {
        exists: true,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        etag: makeEtag(stat.mtimeMs, stat.size),
      };
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return {
          exists: false,
          isDirectory: false,
          size: 0,
          mtimeMs: 0,
          etag: '',
        };
      }
      throw err;
    }
  }

  async list(
    workspacePath: WorkspacePath,
    relDir: string,
    opts?: ListOpts,
  ): Promise<FileEntry[]> {
    const absolute = this.resolveSafe(workspacePath, relDir);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const filtered = opts?.hidden
      ? entries
      : entries.filter((e) => !e.name.startsWith('.'));
    const mapped: FileEntry[] = filtered.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
    if (typeof opts?.limit === 'number') {
      return mapped.slice(0, opts.limit);
    }
    return mapped;
  }

  async delete(
    workspacePath: WorkspacePath,
    relPath: string,
  ): Promise<void> {
    const absolute = this.resolveSafe(workspacePath, relPath);
    await fs.rm(absolute, { recursive: true, force: true });
  }

  async rename(
    workspacePath: WorkspacePath,
    fromRel: string,
    toRel: string,
  ): Promise<void> {
    const from = this.resolveSafe(workspacePath, fromRel);
    const to = this.resolveSafe(workspacePath, toRel);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
  }

  async move(
    workspacePath: WorkspacePath,
    fromRel: string,
    toRel: string,
  ): Promise<void> {
    return this.rename(workspacePath, fromRel, toRel);
  }

  async mkdir(
    workspacePath: WorkspacePath,
    relPath: string,
  ): Promise<void> {
    const absolute = this.resolveSafe(workspacePath, relPath);
    await fs.mkdir(absolute, { recursive: true });
  }

  async search(
    _workspacePath: WorkspacePath,
    _query: SearchQuery,
  ): Promise<SearchHit[]> {
    throw new RuntimeErrorObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
      message:
        'LocalFilesCapability.search is not implemented yet — ripgrep plumbing pending.',
      retryable: false,
    });
  }

  async quickOpen(
    _workspacePath: WorkspacePath,
    _query: string,
    _limit: number,
  ): Promise<QuickOpenHit[]> {
    throw new RuntimeErrorObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
      message:
        'LocalFilesCapability.quickOpen is not implemented yet — ripgrep plumbing pending.',
      retryable: false,
    });
  }

  async watch(): Promise<StreamHandle> {
    throw new RuntimeErrorObject({
      code: 'CAPABILITY_NOT_SUPPORTED',
      message:
        'LocalFilesCapability.watch is not implemented yet — chokidar plumbing pending.',
      retryable: false,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Migration shims
  //
  // The following methods take absolute paths instead of (workspacePath,
  // relPath). They exist because today's Electron IPC handlers receive
  // absolute paths directly from the renderer; converting every handler to
  // the workspace-scoped shape happens incrementally. As the renderer's
  // file service is rewritten to thread workspacePath through, these
  // shims can be retired.
  //
  // They are NOT part of the FilesCapability interface — they're a
  // class-only escape hatch for in-process Electron callers.
  // ────────────────────────────────────────────────────────────────────

  async statAbsolute(absolutePath: string): Promise<FileStat> {
    try {
      const stat = await fs.stat(absolutePath);
      return {
        exists: true,
        isDirectory: stat.isDirectory(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        etag: makeEtag(stat.mtimeMs, stat.size),
      };
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        return {
          exists: false,
          isDirectory: false,
          size: 0,
          mtimeMs: 0,
          etag: '',
        };
      }
      throw err;
    }
  }

  async existsAbsolute(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Confine a relPath to the workspace root. Rejects absolute paths and
   * any traversal that escapes the workspace. Returns the safe absolute path.
   */
  private resolveSafe(workspacePath: WorkspacePath, relPath: string): string {
    if (path.isAbsolute(relPath)) {
      throw new RuntimeErrorObject({
        code: 'PERMISSION_DENIED',
        message: `Absolute paths are not allowed: ${relPath}`,
        retryable: false,
      });
    }
    const root = path.resolve(workspacePath);
    const resolved = path.resolve(root, relPath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new RuntimeErrorObject({
        code: 'PERMISSION_DENIED',
        message: `Path escapes workspace: ${relPath}`,
        retryable: false,
      });
    }
    return resolved;
  }
}

function makeEtag(mtimeMs: number, size: number): string {
  return `${Math.floor(mtimeMs)}-${size}`;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}

/**
 * Heuristic: treat as binary if the first 8KB contains a NUL byte. Cheap and
 * matches what most editors do. The renderer can override by explicitly
 * passing a Uint8Array to `write` when it wants binary semantics.
 */
function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return sample.includes(0);
}
