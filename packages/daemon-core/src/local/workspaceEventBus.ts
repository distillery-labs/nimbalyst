import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

import chokidar, { FSWatcher as ChokidarFSWatcher } from 'chokidar';
import ignore, { Ignore } from 'ignore';

import { pathContainsExcludedDir, shouldExcludeDir } from './exclusions.js';
import { isPathInWorkspace } from './workspace.js';

/**
 * Whether the platform supports `fs.watch(dir, { recursive: true })`.
 *
 * macOS uses FSEvents (1 FD for the entire tree).
 * Windows uses ReadDirectoryChangesW (1 handle for the entire tree).
 * Linux does NOT support recursive: true and throws ERR_FEATURE_UNAVAILABLE_ON_PLATFORM.
 */
const supportsRecursiveWatch = process.platform === 'darwin' || process.platform === 'win32';

/**
 * .git is always ignored — it's an internal data structure, never user content.
 * Everything else is determined by .gitignore (or fallback patterns).
 */
const ALWAYS_IGNORED_DIRS = new Set(['.git']);

/**
 * Top-level directory names (relative to workspace root) that are
 * macOS system/protected dirs and should be ignored entirely.
 * These only apply when the workspace root IS one of these (e.g. opening /).
 */
const IGNORED_TOP_DIRS = new Set([
  '.Trash', 'Library', 'Applications', 'Documents',
  'Downloads', 'Music', 'Pictures', 'Movies', 'Public',
  '.Spotlight-V100', '.TemporaryItems', '.fseventsd',
]);

/** OS junk files that should be silently ignored. */
const IGNORED_BASENAMES = new Set(['.DS_Store', 'Thumbs.db']);

/**
 * Fallback ignore patterns used when no .gitignore exists (non-git projects).
 *
 * When a .gitignore IS present, we trust it completely and don't add these.
 * When it ISN'T present, the project isn't under version control and there's
 * no authoritative source of what to ignore, so we use common conventions
 * for directories that are almost always generated/cached output.
 */
const FALLBACK_IGNORE_PATTERNS = [
  // Package managers
  'node_modules/',
  '.pnp/',
  '.yarn/',
  'bower_components/',

  // Build output
  'dist/',
  'build/',
  'out/',
  'target/',
  '.output/',

  // Framework caches
  '.next/',
  '.nuxt/',
  '.svelte-kit/',
  '.cache/',
  '.turbo/',
  '.parcel-cache/',
  '.webpack/',

  // Test/coverage
  'coverage/',

  // IDE
  '.vscode/',
  '.idea/',

  // Misc
  '.wrangler/',
  '__pycache__/',
  '*.pyc',
  '.DS_Store',
  'Thumbs.db',
];

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/** Normalize a path to forward slashes for consistent Set comparisons across platforms. */
function normalizeToForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Workspace path safety
// ---------------------------------------------------------------------------

/**
 * Minimum depth from filesystem root for a workspace path to be watchable.
 * Paths like `/`, `/Users`, `/home` are too broad and would flood FSEvents.
 */
const MIN_WORKSPACE_DEPTH = 3;

function pathDepth(p: string): number {
  const resolved = path.resolve(p);
  const segments = resolved.split(path.sep).filter(Boolean);
  return segments.length;
}

function validateWorkspacePath(workspacePath: string): string | null {
  const depth = pathDepth(workspacePath);
  if (depth < MIN_WORKSPACE_DEPTH) {
    return `Workspace path "${workspacePath}" is too shallow (depth ${depth}, minimum ${MIN_WORKSPACE_DEPTH}). `
      + `Watching this path would monitor the entire filesystem and freeze the process.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event rate circuit breaker
// ---------------------------------------------------------------------------

const CIRCUIT_BREAKER_THRESHOLD = 5000;
const CIRCUIT_BREAKER_WINDOW_MS = 5000;

interface CircuitBreakerState {
  timestamps: number[];
  writeIndex: number;
  tripped: boolean;
}

function createCircuitBreaker(): CircuitBreakerState {
  return {
    timestamps: new Array(CIRCUIT_BREAKER_THRESHOLD).fill(0),
    writeIndex: 0,
    tripped: false,
  };
}

function recordEvent(cb: CircuitBreakerState): boolean {
  if (cb.tripped) return true;

  const now = Date.now();
  const oldestIndex = cb.writeIndex;
  const oldestTimestamp = cb.timestamps[oldestIndex];

  cb.timestamps[cb.writeIndex] = now;
  cb.writeIndex = (cb.writeIndex + 1) % cb.timestamps.length;

  if (oldestTimestamp > 0 && (now - oldestTimestamp) < CIRCUIT_BREAKER_WINDOW_MS) {
    cb.tripped = true;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceEventType = 'change' | 'add' | 'unlink';

export interface WorkspaceEventListener {
  onChange: (filePath: string, gitignoreBypassed?: boolean) => void;
  onAdd: (filePath: string, gitignoreBypassed?: boolean) => void;
  onUnlink: (filePath: string, gitignoreBypassed?: boolean) => void;
  /**
   * Opt in to receive `add` and `unlink` events for gitignored paths
   * (dispatched with `gitignoreBypassed=true`). `change` events for
   * gitignored paths are still dropped — only structural events come through.
   */
  receiveGitignoredStructureEvents?: boolean;
}

export type GitignoreChangeHandler = (workspacePath: string) => void;

export interface WorkspaceEventBusLogger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

export interface WorkspaceEventBusOptions {
  /**
   * Optional logger. When omitted, errors fall back to console.error and
   * info/warn/debug are silent. The Electron main process supplies its own
   * `logger.main` here so bus logs end up in main.log alongside everything else.
   */
  logger?: WorkspaceEventBusLogger;
}

interface DroppedGitignoreEvent {
  absolutePath: string;
  eventType: 'change' | 'add' | 'unlink' | 'rename';
  timestamp: number;
}

const REPLAY_BUFFER_MAX = 50;
const REPLAY_BUFFER_TTL_MS = 5000;

interface BusEntry {
  watcher: fs.FSWatcher | ChokidarFSWatcher;
  refCount: number;
  listeners: Map<string, WorkspaceEventListener>;
  workspaceAbs: string;
  workspaceGitignoreFilter: Ignore;
  nestedGitignoreCache: Map<string, Ignore>;
  gitRootDirCache: Map<string, string | null>;
  circuitBreaker: CircuitBreakerState;
  gitignoreBypassPaths: Set<string>;
  replayBuffer: DroppedGitignoreEvent[];
}

// ---------------------------------------------------------------------------
// Filtering helpers (pure)
// ---------------------------------------------------------------------------

function shouldIgnoreHardcoded(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  if (IGNORED_TOP_DIRS.has(segments[0])) return true;

  for (const seg of segments) {
    if (ALWAYS_IGNORED_DIRS.has(seg)) return true;
  }

  if (pathContainsExcludedDir(relativePath)) return true;

  const basename = segments[segments.length - 1];
  if (IGNORED_BASENAMES.has(basename)) return true;
  if (basename.startsWith('S.')) return true;

  return false;
}

async function loadGitignoreFilter(workspacePath: string): Promise<Ignore> {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const content = await fsPromises.readFile(gitignorePath, 'utf-8');
    return ignore().add(content);
  } catch {
    return ignore().add(FALLBACK_IGNORE_PATTERNS);
  }
}

function loadWorkspaceGitignoreFilterSync(workspacePath: string): Ignore {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return ignore().add(content);
  } catch {
    return ignore().add(FALLBACK_IGNORE_PATTERNS);
  }
}

/**
 * Synchronous loader for nested-repo `.gitignore`s. Empty filter when missing —
 * we don't fall back to the workspace patterns at the nested level because
 * a nested repo's silence is its own choice.
 */
function loadGitignoreFilterSync(rootPath: string): Ignore {
  const gitignorePath = path.join(rootPath, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return ignore().add(content);
  } catch {
    return ignore();
  }
}

/**
 * Walk up from `dirname(absolutePath)` to find the deepest enclosing directory
 * that contains a `.git` entry, bounded at `workspaceAbs`. Memoizes per-directory
 * results.
 */
function findGitRootForPathCached(
  absolutePath: string,
  workspaceAbs: string,
  cache: Map<string, string | null>,
): string | null {
  const sep = process.platform === 'win32' ? '\\' : '/';
  const boundaryWithSep = workspaceAbs.endsWith(sep) ? workspaceAbs : workspaceAbs + sep;
  if (absolutePath !== workspaceAbs && !absolutePath.startsWith(boundaryWithSep)) {
    return null;
  }

  const ancestorsVisited: string[] = [];
  let dir = path.dirname(absolutePath);
  let result: string | null = null;

  while (true) {
    const cached = cache.get(dir);
    if (cached !== undefined) {
      result = cached;
      break;
    }
    ancestorsVisited.push(dir);

    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        result = dir;
        break;
      }
    } catch {
      // ignore - keep walking
    }

    if (dir === workspaceAbs) {
      result = null;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      result = null;
      break;
    }
    if (!parent.startsWith(boundaryWithSep) && parent !== workspaceAbs) {
      result = null;
      break;
    }
    dir = parent;
  }

  for (const visited of ancestorsVisited) {
    cache.set(visited, result);
  }
  return result;
}

function isGitignoredScoped(
  absolutePath: string,
  workspaceAbs: string,
  entry: BusEntry,
): boolean {
  const wsRel = path.relative(workspaceAbs, absolutePath).split(path.sep).join('/');
  if (wsRel === '' || wsRel.startsWith('..')) return false;

  if (entry.workspaceGitignoreFilter.ignores(wsRel)
    || entry.workspaceGitignoreFilter.ignores(wsRel + '/')) {
    return true;
  }

  const owningRoot = findGitRootForPathCached(absolutePath, workspaceAbs, entry.gitRootDirCache);
  if (!owningRoot || owningRoot === workspaceAbs) return false;

  let nestedFilter = entry.nestedGitignoreCache.get(owningRoot);
  if (!nestedFilter) {
    nestedFilter = loadGitignoreFilterSync(owningRoot);
    entry.nestedGitignoreCache.set(owningRoot, nestedFilter);
  }
  const rootRel = path.relative(owningRoot, absolutePath).split(path.sep).join('/');
  if (rootRel === '' || rootRel.startsWith('..')) return false;
  return nestedFilter.ignores(rootRel) || nestedFilter.ignores(rootRel + '/');
}

function isGitignoreFile(absolutePath: string): boolean {
  return path.basename(absolutePath) === '.gitignore';
}

function isMarkdownFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.md';
}

function getGitignoreAction(
  absolutePath: string,
  entry: BusEntry,
): 'bypass' | 'drop' {
  if (entry.gitignoreBypassPaths.has(normalizeToForwardSlash(absolutePath))) return 'bypass';
  if (isMarkdownFile(absolutePath)) return 'bypass';
  return 'drop';
}

function addToReplayBuffer(
  entry: BusEntry,
  absolutePath: string,
  eventType: 'change' | 'add' | 'unlink' | 'rename',
): void {
  const now = Date.now();

  entry.replayBuffer = entry.replayBuffer.filter(
    (e) => now - e.timestamp < REPLAY_BUFFER_TTL_MS,
  );

  if (entry.replayBuffer.length >= REPLAY_BUFFER_MAX) {
    entry.replayBuffer.shift();
  }

  entry.replayBuffer.push({
    absolutePath: normalizeToForwardSlash(absolutePath),
    eventType,
    timestamp: now,
  });
}

const RENAME_EXISTS_RETRY_DELAYS_MS = [0, 25, 100];

async function pathExistsAfterRename(absolutePath: string): Promise<boolean> {
  for (const delayMs of RENAME_EXISTS_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await fsPromises.access(absolutePath);
      return true;
    } catch {
      // keep retrying
    }
  }
  return false;
}

const CHOKIDAR_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// WorkspaceEventBus
// ---------------------------------------------------------------------------

const defaultLogger: WorkspaceEventBusLogger = {
  info: () => {},
  warn: () => {},
  error: (message, data) => {
    if (data !== undefined) {
      // eslint-disable-next-line no-console
      console.error(message, data);
    } else {
      // eslint-disable-next-line no-console
      console.error(message);
    }
  },
  debug: () => {},
};

/**
 * Workspace-wide watcher pool with `.gitignore` filtering and bypass support.
 *
 * One `fs.watch(recursive)` (macOS/Windows) or chokidar instance (Linux) per
 * workspace root, refcounted across N subscribers. Subscribers receive the
 * normalized `WorkspaceEventListener` callbacks. `addGitignoreBypass` lets
 * callers track gitignored paths (AI-edited files in `nimbalyst-local/`,
 * tracked-but-gitignored markdown, etc.) and replays recently-dropped events
 * when a late bypass is registered.
 *
 * Lives in daemon-core so the local Electron runtime and the standalone
 * `nimbalystd` daemon share a single implementation.
 */
export class WorkspaceEventBus {
  private readonly logger: WorkspaceEventBusLogger;
  private readonly entries = new Map<string, BusEntry>();
  private readonly gitignoreChangeHandlers = new Set<GitignoreChangeHandler>();

  constructor(options: WorkspaceEventBusOptions = {}) {
    this.logger = options.logger ?? defaultLogger;
  }

  // ---------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------

  async subscribe(
    workspacePath: string,
    subscriberId: string,
    listener: WorkspaceEventListener,
  ): Promise<void> {
    const key = path.resolve(workspacePath);
    const existing = this.entries.get(key);

    if (existing) {
      existing.refCount++;
      existing.listeners.set(subscriberId, listener);
      return;
    }

    const validationError = validateWorkspacePath(key);
    if (validationError) {
      this.logger.error('[WorkspaceEventBus] Refusing to watch unsafe path:', {
        workspacePath: key,
        subscriberId,
        reason: validationError,
      });
      return;
    }

    const ig = await loadGitignoreFilter(workspacePath);

    if (supportsRecursiveWatch) {
      this.startRecursiveWatch(key, workspacePath, subscriberId, listener, ig);
    } else {
      this.startChokidarWatch(key, workspacePath, subscriberId, listener, ig);
    }
  }

  unsubscribe(workspacePath: string, subscriberId: string): void {
    const key = path.resolve(workspacePath);
    const entry = this.entries.get(key);
    if (!entry) return;

    entry.listeners.delete(subscriberId);
    entry.refCount--;

    if (entry.refCount <= 0) {
      this.entries.delete(key);
      closeWatcher(entry.watcher);
      entry.gitignoreBypassPaths.clear();
      entry.replayBuffer = [];
      this.logger.info('[WorkspaceEventBus] Closed shared watcher for workspace:', {
        workspacePath: key,
        lastSubscriberId: subscriberId,
      });
    }
  }

  // ---------------------------------------------------------------
  // Diagnostics / test hooks
  // ---------------------------------------------------------------

  getSubscriberIds(workspacePath: string): string[] {
    const entry = this.entries.get(path.resolve(workspacePath));
    if (!entry) return [];
    return [...entry.listeners.keys()];
  }

  getBusEntryCount(): number {
    return this.entries.size;
  }

  getRefCount(workspacePath: string): number {
    return this.entries.get(path.resolve(workspacePath))?.refCount ?? 0;
  }

  resetForTests(): void {
    this.entries.clear();
    this.gitignoreChangeHandlers.clear();
  }

  getStats(): {
    type: string;
    activeWorkspaces: number;
    workspaces: Array<{ workspacePath: string; subscriberCount: number; subscriberIds: string[] }>;
  } {
    const workspaces: Array<{
      workspacePath: string;
      subscriberCount: number;
      subscriberIds: string[];
    }> = [];
    for (const [workspacePath, entry] of this.entries.entries()) {
      workspaces.push({
        workspacePath,
        subscriberCount: entry.listeners.size,
        subscriberIds: [...entry.listeners.keys()],
      });
    }
    return {
      type: supportsRecursiveWatch
        ? 'WorkspaceEventBus (fs.watch recursive)'
        : 'WorkspaceEventBus (chokidar)',
      activeWorkspaces: this.entries.size,
      workspaces,
    };
  }

  // ---------------------------------------------------------------
  // Linux folder expansion / collapse
  // ---------------------------------------------------------------

  addWatchedPath(workspacePath: string, folderPath: string): void {
    if (supportsRecursiveWatch) return;
    const entry = this.entries.get(path.resolve(workspacePath));
    if (!entry) return;
    if ('add' in entry.watcher) {
      (entry.watcher as ChokidarFSWatcher).add(folderPath);
    }
  }

  removeWatchedPath(workspacePath: string, folderPath: string): void {
    if (supportsRecursiveWatch) return;
    const entry = this.entries.get(path.resolve(workspacePath));
    if (!entry) return;
    if ('unwatch' in entry.watcher) {
      (entry.watcher as ChokidarFSWatcher).unwatch(folderPath);
    }
  }

  // ---------------------------------------------------------------
  // Gitignore bypass
  // ---------------------------------------------------------------

  addGitignoreBypass(workspacePath: string, absolutePath: string): void {
    const key = path.resolve(workspacePath);
    const entry = this.entries.get(key);
    if (!entry) return;

    if (!isPathInWorkspace(absolutePath, key)) {
      this.logger.debug('[WorkspaceEventBus] Rejected gitignore bypass for path outside workspace:', {
        workspacePath: key,
        absolutePath,
      });
      return;
    }

    const relativePath = path.relative(key, absolutePath);
    if (relativePath && !relativePath.startsWith('..') && pathContainsExcludedDir(relativePath)) {
      this.logger.debug('[WorkspaceEventBus] Rejected gitignore bypass for excluded path:', {
        workspacePath: key,
        absolutePath,
      });
      return;
    }

    const normalizedPath = normalizeToForwardSlash(absolutePath);
    entry.gitignoreBypassPaths.add(normalizedPath);

    if (!supportsRecursiveWatch && 'add' in entry.watcher) {
      (entry.watcher as ChokidarFSWatcher).add(absolutePath);
    }

    this.replayDroppedEvents(entry, normalizedPath);

    this.logger.debug('[WorkspaceEventBus] Added gitignore bypass:', {
      workspacePath: key,
      absolutePath: normalizedPath,
      bypassCount: entry.gitignoreBypassPaths.size,
    });
  }

  removeGitignoreBypass(workspacePath: string, absolutePath: string): void {
    const entry = this.entries.get(path.resolve(workspacePath));
    if (!entry) return;
    entry.gitignoreBypassPaths.delete(normalizeToForwardSlash(absolutePath));
  }

  hasGitignoreBypass(workspacePath: string, absolutePath: string): boolean {
    const entry = this.entries.get(path.resolve(workspacePath));
    return entry?.gitignoreBypassPaths.has(normalizeToForwardSlash(absolutePath)) ?? false;
  }

  clearGitignoreBypasses(workspacePath: string): void {
    const key = path.resolve(workspacePath);
    const entry = this.entries.get(key);
    if (!entry) return;
    const count = entry.gitignoreBypassPaths.size;
    entry.gitignoreBypassPaths.clear();
    entry.replayBuffer = [];
    if (count > 0) {
      this.logger.debug('[WorkspaceEventBus] Cleared all gitignore bypasses:', {
        workspacePath: key,
        clearedCount: count,
      });
    }
  }

  // ---------------------------------------------------------------
  // Gitignore-change subscribers
  // ---------------------------------------------------------------

  /**
   * Subscribe to gitignore-change notifications. Fires whenever a workspace's
   * own `.gitignore` (or any nested-repo `.gitignore` already on the radar) is
   * modified. Returns an unsubscribe function. Multiple subscribers supported
   * (cache invalidators, git-status broadcasters, etc.).
   */
  onGitignoreChange(handler: GitignoreChangeHandler): () => void {
    this.gitignoreChangeHandlers.add(handler);
    return () => {
      this.gitignoreChangeHandlers.delete(handler);
    };
  }

  // ---------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------

  async stopAll(): Promise<void> {
    this.logger.info(`[WorkspaceEventBus] Stopping all watchers (${this.entries.size} active)`);

    const closePromises: Promise<void>[] = [];
    for (const [key, entry] of this.entries.entries()) {
      try {
        if (supportsRecursiveWatch) {
          (entry.watcher as fs.FSWatcher).close();
        } else {
          closePromises.push((entry.watcher as ChokidarFSWatcher).close());
        }
      } catch (error) {
        this.logger.error(`[WorkspaceEventBus] Error closing watcher for ${key}:`, error);
      }
    }

    if (closePromises.length > 0) {
      const allClosesPromise = Promise.all(closePromises);
      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          this.logger.warn('[WorkspaceEventBus] Watcher close timed out after 1000ms, forcing cleanup');
          resolve();
        }, 1000);
      });
      await Promise.race([allClosesPromise, timeoutPromise]);
    }

    this.entries.clear();
    this.logger.info('[WorkspaceEventBus] All watchers stopped');
  }

  // ---------------------------------------------------------------
  // Internal — gitignore refresh + replay
  // ---------------------------------------------------------------

  private reloadGitignoreFiltersForPath(absolutePath: string, entry: BusEntry): boolean {
    if (!isGitignoreFile(absolutePath)) return false;

    const normalizedPath = path.resolve(absolutePath);
    const workspaceGitignorePath = path.join(entry.workspaceAbs, '.gitignore');
    let reloaded = false;

    if (normalizedPath === workspaceGitignorePath) {
      entry.workspaceGitignoreFilter = loadWorkspaceGitignoreFilterSync(entry.workspaceAbs);
      reloaded = true;
    } else {
      const candidateRoot = path.dirname(normalizedPath);
      if (
        entry.nestedGitignoreCache.has(candidateRoot)
        || fs.existsSync(path.join(candidateRoot, '.git'))
      ) {
        entry.nestedGitignoreCache.set(candidateRoot, loadGitignoreFilterSync(candidateRoot));
        reloaded = true;
      }
    }

    if (!reloaded) return false;

    // Ignore semantics changed; dropped-event replay is no longer valid.
    entry.replayBuffer = [];
    this.notifyGitignoreChange(entry.workspaceAbs);
    return true;
  }

  private refreshGitignoreFiltersForEvent(
    absolutePath: string,
    eventType: 'change' | 'add' | 'unlink' | 'rename',
    entry: BusEntry,
  ): void {
    if (!isGitignoreFile(absolutePath)) return;

    if (eventType === 'rename') {
      void pathExistsAfterRename(absolutePath).finally(() => {
        this.reloadGitignoreFiltersForPath(absolutePath, entry);
      });
      return;
    }

    this.reloadGitignoreFiltersForPath(absolutePath, entry);
  }

  private notifyGitignoreChange(workspacePath: string): void {
    for (const handler of this.gitignoreChangeHandlers) {
      try {
        handler(workspacePath);
      } catch (err) {
        this.logger.error('[WorkspaceEventBus] gitignore-change handler threw:', err);
      }
    }
  }

  private replayDroppedEvents(entry: BusEntry, absolutePath: string): void {
    const now = Date.now();
    const matching: DroppedGitignoreEvent[] = [];
    const remaining: DroppedGitignoreEvent[] = [];

    for (const event of entry.replayBuffer) {
      if (now - event.timestamp >= REPLAY_BUFFER_TTL_MS) continue; // expired
      if (event.absolutePath === absolutePath) {
        matching.push(event);
      } else {
        remaining.push(event);
      }
    }

    entry.replayBuffer = remaining;

    if (matching.length === 0) return;

    for (const event of matching) {
      switch (event.eventType) {
        case 'change':
          for (const l of entry.listeners.values()) l.onChange(event.absolutePath, true);
          break;
        case 'add':
          for (const l of entry.listeners.values()) l.onAdd(event.absolutePath, true);
          break;
        case 'unlink':
          for (const l of entry.listeners.values()) l.onUnlink(event.absolutePath, true);
          break;
        case 'rename':
          fsPromises.access(event.absolutePath).then(
            () => {
              for (const l of entry.listeners.values()) l.onAdd(event.absolutePath, true);
            },
            () => {
              for (const l of entry.listeners.values()) l.onUnlink(event.absolutePath, true);
            },
          );
          break;
      }
    }

    this.logger.debug('[WorkspaceEventBus] Replayed dropped events:', {
      absolutePath,
      count: matching.length,
    });
  }

  // ---------------------------------------------------------------
  // Internal — circuit breaker
  // ---------------------------------------------------------------

  private tripCircuitBreaker(key: string, entry: BusEntry): void {
    this.logger.error(
      `[WorkspaceEventBus] Circuit breaker tripped for "${key}" — `
        + `received ${CIRCUIT_BREAKER_THRESHOLD} events in ${CIRCUIT_BREAKER_WINDOW_MS}ms. `
        + 'Killing watcher to protect the process. This workspace may be too large, '
        + 'missing a .gitignore at the workspace root, or contain nested repos whose .gitignore is not honored.',
    );
    closeWatcher(entry.watcher);
    this.entries.delete(key);
  }

  // ---------------------------------------------------------------
  // Internal — fs.watch (macOS / Windows)
  // ---------------------------------------------------------------

  private startRecursiveWatch(
    key: string,
    workspacePath: string,
    subscriberId: string,
    listener: WorkspaceEventListener,
    ig: Ignore,
  ): void {
    const cb = createCircuitBreaker();
    const entry: BusEntry = {
      watcher: null!,
      refCount: 1,
      listeners: new Map([[subscriberId, listener]]),
      workspaceAbs: key,
      workspaceGitignoreFilter: ig,
      nestedGitignoreCache: new Map(),
      gitRootDirCache: new Map(),
      circuitBreaker: cb,
      gitignoreBypassPaths: new Set(),
      replayBuffer: [],
    };

    try {
      const watcher = fs.watch(
        workspacePath,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (!filename) return;

          if (recordEvent(cb)) {
            if (cb.tripped && this.entries.has(key)) {
              this.tripCircuitBreaker(key, entry);
            }
            return;
          }

          const relativePath = filename.split(path.sep).join('/');
          if (shouldIgnoreHardcoded(relativePath)) return;

          const absolutePath = path.join(workspacePath, filename);
          this.refreshGitignoreFiltersForEvent(
            absolutePath,
            eventType === 'change' ? 'change' : 'rename',
            entry,
          );

          let bypassed = false;
          let dropForNonStructureListeners = false;
          if (isGitignoredScoped(absolutePath, key, entry)) {
            const action = getGitignoreAction(absolutePath, entry);
            if (action === 'drop') {
              const bufferEventType = eventType === 'change' ? 'change' : 'rename';
              addToReplayBuffer(entry, absolutePath, bufferEventType);
              if (eventType === 'change') return;
              dropForNonStructureListeners = true;
              bypassed = true;
            } else {
              bypassed = true;
            }
          }

          if (eventType === 'change') {
            for (const l of entry.listeners.values()) l.onChange(absolutePath, bypassed || undefined);
          } else {
            void pathExistsAfterRename(absolutePath).then((exists) => {
              for (const l of entry.listeners.values()) {
                if (dropForNonStructureListeners && !l.receiveGitignoredStructureEvents) continue;
                if (exists) l.onAdd(absolutePath, bypassed || undefined);
                else l.onUnlink(absolutePath, bypassed || undefined);
              }
            });
          }
        },
      );

      entry.watcher = watcher;

      watcher.on('error', (error: NodeJS.ErrnoException) => {
        const code = error.code;
        if (code === 'EMFILE' || code === 'ENFILE') {
          this.logger.error(
            `[WorkspaceEventBus] Too many open files (${code}) for "${key}" — `
              + 'closing watcher. File changes will not be detected.',
          );
          if (this.entries.has(key)) {
            (watcher as fs.FSWatcher).close();
            this.entries.delete(key);
          }
        } else if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
          this.logger.debug('[WorkspaceEventBus] Skipping unwatchable path:', error);
        } else {
          this.logger.error('[WorkspaceEventBus] Watcher error:', error);
        }
      });

      this.entries.set(key, entry);

      this.logger.info('[WorkspaceEventBus] Created shared watcher (fs.watch recursive):', {
        workspacePath: key,
        subscriberId,
      });
    } catch (error) {
      this.logger.error('[WorkspaceEventBus] Failed to start recursive watcher:', error);
    }
  }

  // ---------------------------------------------------------------
  // Internal — chokidar (Linux)
  // ---------------------------------------------------------------

  private startChokidarWatch(
    key: string,
    workspacePath: string,
    subscriberId: string,
    listener: WorkspaceEventListener,
    ig: Ignore,
  ): void {
    try {
      const cb = createCircuitBreaker();
      const entry: BusEntry = {
        watcher: null!,
        refCount: 1,
        listeners: new Map([[subscriberId, listener]]),
        workspaceAbs: key,
        workspaceGitignoreFilter: ig,
        nestedGitignoreCache: new Map(),
        gitRootDirCache: new Map(),
        circuitBreaker: cb,
        gitignoreBypassPaths: new Set(),
        replayBuffer: [],
      };

      const watcher = chokidar.watch(workspacePath, {
        ignored: (filePath: string) => {
          const relativePath = path.relative(workspacePath, filePath);
          if (!relativePath) return false;
          if (shouldIgnoreHardcoded(relativePath)) return true;
          if (!isGitignoredScoped(filePath, key, entry)) return false;
          return getGitignoreAction(filePath, entry) === 'drop';
        },
        ignoreInitial: true,
        followSymlinks: false,
        usePolling: false,
        atomic: true,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 20,
        },
        alwaysStat: false,
        depth: CHOKIDAR_MAX_DEPTH,
      });

      entry.watcher = watcher;
      this.entries.set(key, entry);

      const checkBreaker = (): boolean => {
        if (recordEvent(cb)) {
          if (cb.tripped && this.entries.has(key)) {
            this.tripCircuitBreaker(key, entry);
          }
          return true;
        }
        return false;
      };

      const isBypassed = (filePath: string): boolean => {
        const relativePath = path.relative(workspacePath, filePath);
        if (!relativePath) return false;
        return isGitignoredScoped(filePath, key, entry);
      };

      watcher
        .on('change', (filePath: string) => {
          if (checkBreaker()) return;
          this.refreshGitignoreFiltersForEvent(filePath, 'change', entry);
          const bypassed = isBypassed(filePath) || undefined;
          for (const l of entry.listeners.values()) l.onChange(filePath, bypassed);
        })
        .on('add', (filePath: string) => {
          if (checkBreaker()) return;
          this.refreshGitignoreFiltersForEvent(filePath, 'add', entry);
          const bypassed = isBypassed(filePath) || undefined;
          for (const l of entry.listeners.values()) l.onAdd(filePath, bypassed);
        })
        .on('unlink', (filePath: string) => {
          if (checkBreaker()) return;
          this.refreshGitignoreFiltersForEvent(filePath, 'unlink', entry);
          const bypassed = isBypassed(filePath) || undefined;
          for (const l of entry.listeners.values()) l.onUnlink(filePath, bypassed);
        })
        .on('error', (error: unknown) => {
          const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
          if (code === 'EMFILE' || code === 'ENFILE') {
            this.logger.error(
              `[WorkspaceEventBus] Too many open files (${code}) for "${key}" — `
                + 'closing watcher to stop retry-spam. File changes will not be detected.',
            );
            if (this.entries.has(key)) {
              closeWatcher(entry.watcher);
              this.entries.delete(key);
            }
          } else if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
            this.logger.debug('[WorkspaceEventBus] Skipping unwatchable path:', error);
          } else {
            this.logger.error('[WorkspaceEventBus] Watcher error:', error);
          }
        });

      this.logger.info('[WorkspaceEventBus] Created shared watcher (chokidar):', {
        workspacePath: key,
        subscriberId,
      });
    } catch (error) {
      this.logger.error('[WorkspaceEventBus] Failed to start chokidar watcher:', error);
    }
  }
}

function closeWatcher(watcher: fs.FSWatcher | ChokidarFSWatcher): void {
  if (supportsRecursiveWatch) {
    (watcher as fs.FSWatcher).close();
  } else {
    void (watcher as ChokidarFSWatcher).close();
  }
}
