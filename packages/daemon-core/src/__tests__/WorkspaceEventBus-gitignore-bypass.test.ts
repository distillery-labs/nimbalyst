// @vitest-environment node
/**
 * Tests for gitignore bypass and replay buffer in WorkspaceEventBus.
 *
 * Mocks fs.watch so events can be fired synthetically. The `ignore` package
 * stub keeps the test deterministic without depending on its exact wildcard
 * semantics — we only need substring/prefix behavior for these paths.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const {
  mockFsWatch,
  mockWatcherCallbacks,
  mockFsAccess,
  mockGitignoreReadFile,
  mockGitignoreReadFileSync,
  originalPlatform,
} = vi.hoisted(() => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
  const mockWatcherCallbacks: Array<(eventType: string, filename: string | null) => void> = [];
  const mockFsWatch = vi.fn((_path: string, _opts: any, callback: any) => {
    mockWatcherCallbacks.push(callback);
    return {
      close: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
  });

  const mockFsAccess = vi.fn(() => Promise.resolve());
  const mockGitignoreReadFile = vi.fn().mockRejectedValue(new Error('no .gitignore'));
  const mockGitignoreReadFileSync = vi.fn<(...args: any[]) => string>(() => {
    throw new Error('no .gitignore');
  });

  return {
    mockFsWatch,
    mockWatcherCallbacks,
    mockFsAccess,
    mockGitignoreReadFile,
    mockGitignoreReadFileSync,
    originalPlatform,
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    watch: mockFsWatch,
    readFileSync: mockGitignoreReadFileSync,
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: mockGitignoreReadFile,
    access: mockFsAccess,
  };
});

// chokidar is stubbed because the darwin path uses fs.watch, but the module
// is imported at load time.
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
      add: vi.fn(),
      unwatch: vi.fn(),
    })),
  },
}));

vi.mock('ignore', () => {
  const createMatcher = () => {
    const rules: string[] = [];
    const matcher = {
      add: vi.fn((input: string | string[]) => {
        const lines = Array.isArray(input) ? input : String(input).split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          rules.push(trimmed.replace(/^\//, '').replace(/\/$/, ''));
        }
        return matcher;
      }),
      ignores: (p: string) => {
        return rules.some((rule) => p === rule || p.startsWith(`${rule}/`));
      },
    };
    return matcher;
  };
  return { default: createMatcher };
});

import { WorkspaceEventBus, type WorkspaceEventListener } from '../local/workspaceEventBus.js';

const WORKSPACE = '/Users/test/project';

function createListener(): WorkspaceEventListener & {
  changes: Array<{ path: string; type: string; bypassed?: boolean }>;
} {
  const changes: Array<{ path: string; type: string; bypassed?: boolean }> = [];
  return {
    changes,
    onChange: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'change', bypassed: gitignoreBypassed });
    }),
    onAdd: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'add', bypassed: gitignoreBypassed });
    }),
    onUnlink: vi.fn((filePath: string, gitignoreBypassed?: boolean) => {
      changes.push({ path: filePath, type: 'unlink', bypassed: gitignoreBypassed });
    }),
  };
}

function fireWatchEvent(eventType: string, filename: string) {
  const cb = mockWatcherCallbacks[mockWatcherCallbacks.length - 1];
  if (!cb) throw new Error('No watcher callback registered');
  cb(eventType, filename);
}

describe('WorkspaceEventBus gitignore bypass', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    mockWatcherCallbacks.length = 0;
    mockFsWatch.mockClear();
    mockFsAccess.mockReset();
    mockFsAccess.mockResolvedValue(undefined);
    mockGitignoreReadFile.mockReset();
    mockGitignoreReadFile.mockResolvedValue('temp/\n');
    mockGitignoreReadFileSync.mockReset();
    mockGitignoreReadFileSync.mockReturnValue('temp/\n');
    bus = new WorkspaceEventBus();
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  afterEach(() => {
    bus.resetForTests();
  });

  describe('bypass set management', () => {
    it('adds and removes bypass paths', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`);
      expect(bus.hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`)).toBe(true);

      bus.removeGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`);
      expect(bus.hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`)).toBe(false);

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('returns false for non-existent bypass', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      expect(bus.hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/nope.js`)).toBe(false);

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('handles bypass for non-existent workspace gracefully', () => {
      bus.addGitignoreBypass('/nonexistent', '/nonexistent/file.js');
      expect(bus.hasGitignoreBypass('/nonexistent', '/nonexistent/file.js')).toBe(false);
    });
  });

  describe('event dispatch with bypass', () => {
    it('reloads the workspace .gitignore matcher when the file changes', async () => {
      const listener = createListener();
      const onGitignoreChange = vi.fn();
      bus.onGitignoreChange(onGitignoreChange);

      mockGitignoreReadFile.mockResolvedValue('build/\n');
      mockGitignoreReadFileSync.mockReturnValue('temp/\n');

      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/bundle.js');
      expect(listener.onChange).toHaveBeenLastCalledWith(
        `${WORKSPACE}/temp/bundle.js`,
        undefined,
      );

      fireWatchEvent('change', '.gitignore');
      fireWatchEvent('change', 'temp/bundle.js');

      expect(onGitignoreChange).toHaveBeenCalledWith(WORKSPACE);
      expect(listener.changes.filter((c) => c.path.endsWith('temp/bundle.js'))).toHaveLength(1);
      expect(listener.changes.some((c) => c.path.endsWith('/.gitignore'))).toBe(true);

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('dispatches non-gitignored events without bypass flag', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'src/app.ts');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/src/app.ts`,
        undefined,
      );
      expect(listener.changes[0]?.bypassed).toBeUndefined();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('drops gitignored events not in bypass set', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/bundle.js');

      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('dispatches bypassed gitignored events with flag', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`);
      fireWatchEvent('change', 'temp/bundle.js');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/temp/bundle.js`,
        true,
      );
      expect(listener.changes[0]?.bypassed).toBe(true);

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('dispatches .md files in gitignored dirs with bypass flag', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/README.md');

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/temp/README.md`,
        true,
      );

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('handles rename events (add/unlink) with bypass', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/output.js`);

      mockFsAccess.mockResolvedValue(undefined);
      fireWatchEvent('rename', 'temp/output.js');

      await vi.waitFor(() => {
        expect(listener.onAdd).toHaveBeenCalledWith(
          `${WORKSPACE}/temp/output.js`,
          true,
        );
      });

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('retries rename events before treating a delayed file as unlink', async () => {
      vi.useFakeTimers();

      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/output.js`);

      mockFsAccess
        .mockRejectedValueOnce(new Error('not yet visible'))
        .mockRejectedValueOnce(new Error('still not visible'))
        .mockResolvedValueOnce(undefined);

      fireWatchEvent('rename', 'temp/output.js');

      await vi.advanceTimersByTimeAsync(125);

      expect(listener.onAdd).toHaveBeenCalledWith(
        `${WORKSPACE}/temp/output.js`,
        true,
      );
      expect(listener.onUnlink).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
      vi.useRealTimers();
    });
  });

  describe('replay buffer', () => {
    it('replays dropped events when bypass is registered', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/bundle.js');
      expect(listener.onChange).not.toHaveBeenCalled();

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`);

      expect(listener.onChange).toHaveBeenCalledWith(
        `${WORKSPACE}/temp/bundle.js`,
        true,
      );

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('does not replay expired events', async () => {
      vi.useFakeTimers({ now: 1000000 });

      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/bundle.js');
      expect(listener.onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(6000);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/bundle.js`);
      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
      vi.useRealTimers();
    });

    it('does not replay events for unrelated paths', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      fireWatchEvent('change', 'temp/a.js');

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/temp/b.js`);

      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });
  });

  describe('gitignored structure events for tree refresh', () => {
    it('dispatches gitignored add events to opt-in listeners with bypassed=true', async () => {
      const treeListener = createListener();
      treeListener.receiveGitignoredStructureEvents = true;
      const aiListener = createListener();
      await bus.subscribe(WORKSPACE, 'tree-sub', treeListener);
      await bus.subscribe(WORKSPACE, 'ai-sub', aiListener);

      mockFsAccess.mockResolvedValue(undefined);
      fireWatchEvent('rename', 'temp');

      await vi.waitFor(() => {
        expect(treeListener.onAdd).toHaveBeenCalledWith(`${WORKSPACE}/temp`, true);
      });

      expect(aiListener.onAdd).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'tree-sub');
      bus.unsubscribe(WORKSPACE, 'ai-sub');
    });

    it('dispatches gitignored unlink events to opt-in listeners with bypassed=true', async () => {
      const treeListener = createListener();
      treeListener.receiveGitignoredStructureEvents = true;
      const aiListener = createListener();
      await bus.subscribe(WORKSPACE, 'tree-sub', treeListener);
      await bus.subscribe(WORKSPACE, 'ai-sub', aiListener);

      mockFsAccess.mockRejectedValue(new Error('ENOENT'));
      fireWatchEvent('rename', 'temp');

      await vi.waitFor(() => {
        expect(treeListener.onUnlink).toHaveBeenCalledWith(`${WORKSPACE}/temp`, true);
      });
      expect(aiListener.onUnlink).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'tree-sub');
      bus.unsubscribe(WORKSPACE, 'ai-sub');
    });

    it('still drops gitignored change events for opt-in listeners', async () => {
      const treeListener = createListener();
      treeListener.receiveGitignoredStructureEvents = true;
      await bus.subscribe(WORKSPACE, 'tree-sub', treeListener);

      fireWatchEvent('change', 'temp/bundle.js');

      expect(treeListener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'tree-sub');
    });
  });

  describe('hardcoded ignores are never bypassed', () => {
    it('rejects bypass registration for excluded build artifact directories', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/.build/output.d`);
      expect(bus.hasGitignoreBypass(WORKSPACE, `${WORKSPACE}/.build/output.d`)).toBe(false);

      fireWatchEvent('change', '.build/output.d');
      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('always filters .git paths regardless of bypass', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/.git/HEAD`);
      fireWatchEvent('change', '.git/HEAD');

      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });

    it('always filters .DS_Store regardless of bypass', async () => {
      const listener = createListener();
      await bus.subscribe(WORKSPACE, 'test-sub', listener);

      bus.addGitignoreBypass(WORKSPACE, `${WORKSPACE}/.DS_Store`);
      fireWatchEvent('change', '.DS_Store');

      expect(listener.onChange).not.toHaveBeenCalled();

      bus.unsubscribe(WORKSPACE, 'test-sub');
    });
  });
});
