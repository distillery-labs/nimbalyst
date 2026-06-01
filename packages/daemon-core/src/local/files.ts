import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { RuntimeErrorObject } from '../types/errors.js';
import type {
  FileContent,
  FileEntry,
  FileStat,
  FileWatchEvent,
  FileWatchParams,
  FilesCapability,
  ListOpts,
  QuickOpenHit,
  SearchHit,
  SearchQuery,
  WriteResult,
} from '../domains/files.js';
import type { StreamHandle } from '../types/streams.js';
import type { WorkspacePath } from '../types/identifiers.js';

import { BINARY_EXTENSIONS, RIPGREP_EXCLUDE_ARGS } from './exclusions.js';
import { getRipgrepPath } from './ripgrep.js';

const execFileAsync = promisify(execFile);

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
    workspacePath: WorkspacePath,
    query: SearchQuery,
  ): Promise<SearchHit[]> {
    if (query.pattern.length === 0) {
      return [];
    }
    if (/[;&|`$]/.test(query.pattern)) {
      throw new RuntimeErrorObject({
        code: 'PERMISSION_DENIED',
        message: 'Search pattern contains shell metacharacters',
        retryable: false,
      });
    }

    const root = path.resolve(workspacePath);
    const rgPath = await getRipgrepPath();
    const args: string[] = ['--json'];
    if (!query.caseSensitive) args.push('-i');
    if (typeof query.limit === 'number') args.push('-m', String(query.limit));
    for (const glob of query.globs ?? []) {
      // Reject obviously dangerous glob strings — match the existing
      // packages/electron filter.
      if (/[;&|`$]/.test(glob)) {
        throw new RuntimeErrorObject({
          code: 'PERMISSION_DENIED',
          message: 'Search glob contains shell metacharacters',
          retryable: false,
        });
      }
      args.push('-g', glob);
    }
    args.push(...RIPGREP_EXCLUDE_ARGS);
    args.push('--', query.pattern, root);

    let stdout = '';
    try {
      const result = await execFileAsync(rgPath, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });
      stdout = result.stdout;
    } catch (err) {
      // ripgrep exits 1 when there are no matches — that's a normal empty
      // result, not an error.
      const e = err as { code?: unknown; stdout?: string };
      if (e.code === 1) {
        stdout = e.stdout ?? '';
      } else {
        throw err;
      }
    }

    const hits: SearchHit[] = [];
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as RipgrepJsonRecord;
        if (parsed.type !== 'match') continue;
        const absPath = parsed.data.path.text;
        const relPath = path.relative(root, absPath);
        const match = parsed.data.submatches?.[0];
        hits.push({
          relPath,
          line: parsed.data.line_number,
          column: match ? match.start + 1 : 1,
          preview: parsed.data.lines.text.replace(/\r?\n$/, ''),
        });
      } catch {
        // ignore unparseable line
      }
    }
    return hits;
  }

  async quickOpen(
    workspacePath: WorkspacePath,
    query: string,
    limit: number,
  ): Promise<QuickOpenHit[]> {
    const root = path.resolve(workspacePath);
    const rgPath = await getRipgrepPath();
    const args: string[] = [
      '--files',
      '--hidden',
      ...RIPGREP_EXCLUDE_ARGS,
      root,
    ];

    let stdout = '';
    try {
      const result = await execFileAsync(rgPath, args, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30_000,
      });
      stdout = result.stdout;
    } catch (err) {
      const e = err as { code?: unknown; stdout?: string };
      if (e.code === 1) {
        stdout = e.stdout ?? '';
      } else {
        throw err;
      }
    }

    const allRel: string[] = [];
    for (const line of stdout.split('\n')) {
      const absPath = line.trim();
      if (!absPath) continue;
      const ext = path.extname(absPath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      allRel.push(path.relative(root, absPath));
    }

    const lowerQuery = query.toLowerCase();
    if (lowerQuery.length === 0) {
      return allRel.slice(0, limit).map((relPath) => ({ relPath, score: 1 }));
    }

    const scored: QuickOpenHit[] = [];
    for (const relPath of allRel) {
      const score = fuzzyScore(relPath.toLowerCase(), lowerQuery);
      if (score > 0) {
        scored.push({ relPath, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async watch(
    params: FileWatchParams,
    onEvent: (event: FileWatchEvent) => void,
  ): Promise<StreamHandle> {
    const root = params.relPath
      ? this.resolveSafe(params.workspacePath, params.relPath)
      : path.resolve(params.workspacePath);
    const workspaceRoot = path.resolve(params.workspacePath);

    const chokidar = await import('chokidar');
    const watcher = chokidar.watch(root, {
      ignoreInitial: true,
      persistent: true,
      ignored: (target: string) => {
        // Skip noisy dirs by name segment match (cheap; chokidar passes paths
        // for both files and the directory entries on traverse).
        const segments = target.split(/[\\/]/);
        return segments.some((seg) =>
          seg === 'node_modules'
          || seg === '.git'
          || seg === 'dist'
          || seg === 'build'
          || seg === 'out',
        );
      },
    });

    const emit = (event: FileWatchEvent) => {
      try {
        onEvent(event);
      } catch {
        // listener errors shouldn't tear down the watcher
      }
    };

    const toRel = (absPath: string) => path.relative(workspaceRoot, absPath);

    watcher
      .on('add', (absPath: string) =>
        emit({ kind: 'created', relPath: toRel(absPath) }),
      )
      .on('change', (absPath: string) =>
        emit({ kind: 'modified', relPath: toRel(absPath) }),
      )
      .on('unlink', (absPath: string) =>
        emit({ kind: 'deleted', relPath: toRel(absPath) }),
      );

    const handle: StreamHandle = {
      id: randomUUID(),
      async unsubscribe() {
        await watcher.close();
      },
    };
    return handle;
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

interface RipgrepJsonRecord {
  type: string;
  data: {
    path: { text: string };
    line_number: number;
    lines: { text: string };
    submatches?: Array<{ start: number; end: number; match?: { text: string } }>;
  };
}

/**
 * Cheap subsequence fuzzy match — same shape the renderer's QuickOpen uses.
 * Returns 0 when `query` chars don't appear in `target` in order.
 * Higher score = better match. Bonuses for: consecutive matches, matches at
 * path-segment boundaries, and matches in the basename.
 */
function fuzzyScore(target: string, query: string): number {
  let score = 0;
  let qi = 0;
  let lastMatchIdx = -1;
  const lastSlash = target.lastIndexOf('/');
  const basenameStart = lastSlash === -1 ? 0 : lastSlash + 1;

  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) {
      let pointScore = 1;
      // Consecutive match bonus
      if (lastMatchIdx === i - 1) pointScore += 3;
      // Boundary bonus (start of string, after /, after .)
      if (i === 0 || target[i - 1] === '/' || target[i - 1] === '.') {
        pointScore += 2;
      }
      // Basename match bonus
      if (i >= basenameStart) pointScore += 1;
      score += pointScore;
      lastMatchIdx = i;
      qi++;
    }
  }

  if (qi < query.length) return 0; // Not all query chars matched
  return score;
}
