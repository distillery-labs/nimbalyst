// @vitest-environment node
/**
 * Tests for nested-repo .gitignore handling in WorkspaceEventBus.
 *
 * Covers the issue #207 layout: a non-git workspace root containing nested
 * git repos. The watcher must honor each nested repo's .gitignore so that
 * build-output trees the nested repo already excludes do not flood the
 * watcher.
 *
 * Mocks fs.watch (so events can be fired synthetically) but uses the real
 * filesystem and real `ignore` package, so on-disk .git and .gitignore files
 * drive the behavior end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const { mockFsWatch, mockWatcherCallbacks, originalPlatform } = vi.hoisted(() => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
  const mockWatcherCallbacks: Array<(eventType: string, filename: string | null) => void> = [];
  const mockFsWatch = vi.fn((_path: string, _opts: unknown, callback: (eventType: string, filename: string | null) => void) => {
    mockWatcherCallbacks.push(callback);
    return {
      close: vi.fn(),
      on: vi.fn().mockReturnThis(),
    };
  });
  return { mockFsWatch, mockWatcherCallbacks, originalPlatform };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, watch: mockFsWatch };
});

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

import { WorkspaceEventBus, type WorkspaceEventListener } from '../local/workspaceEventBus.js';

function createListener(): WorkspaceEventListener & {
  changes: Array<{ path: string; type: string; bypassed?: boolean }>;
} {
  const changes: Array<{ path: string; type: string; bypassed?: boolean }> = [];
  return {
    changes,
    receiveGitignoredStructureEvents: false,
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

function buildIssue207Layout(): { workspace: string; cleanup: () => void } {
  // Bus refuses workspaces below MIN_WORKSPACE_DEPTH=3, so on Linux CI where
  // os.tmpdir() is /tmp (depth 1) we need an extra parent level.
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbalyst-test-'));
  const parent = path.join(baseDir, 'parent');
  fs.mkdirSync(parent, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(parent, 'wsbus-nested-'));
  const nested = path.join(workspace, 'nested');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  fs.writeFileSync(path.join(nested, '.gitignore'), '/rootfs\n');
  fs.mkdirSync(path.join(nested, 'src'), { recursive: true });
  fs.writeFileSync(path.join(nested, 'src', 'app.ts'), '');
  fs.mkdirSync(path.join(nested, 'rootfs', 'etc'), { recursive: true });
  fs.writeFileSync(path.join(nested, 'rootfs', 'etc', 'foo.txt'), '');
  return {
    workspace,
    cleanup: () => fs.rmSync(baseDir, { recursive: true, force: true }),
  };
}

describe('WorkspaceEventBus nested-repo .gitignore (issue #207)', () => {
  let bus: WorkspaceEventBus;
  let layout: { workspace: string; cleanup: () => void };

  beforeEach(() => {
    mockWatcherCallbacks.length = 0;
    mockFsWatch.mockClear();
    bus = new WorkspaceEventBus();
    layout = buildIssue207Layout();
  });

  afterEach(() => {
    bus.resetForTests();
    layout.cleanup();
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
  });

  it('drops content events for files inside a nested-repo gitignored dir', async () => {
    const listener = createListener();
    await bus.subscribe(layout.workspace, 'sub-1', listener);

    fireWatchEvent('change', 'nested/rootfs/etc/foo.txt');

    expect(listener.onChange).not.toHaveBeenCalled();
    bus.unsubscribe(layout.workspace, 'sub-1');
  });

  it('still dispatches files outside the nested ignore', async () => {
    const listener = createListener();
    await bus.subscribe(layout.workspace, 'sub-1', listener);

    fireWatchEvent('change', 'nested/src/app.ts');

    expect(listener.onChange).toHaveBeenCalledWith(
      path.join(layout.workspace, 'nested/src/app.ts'),
      undefined,
    );
    bus.unsubscribe(layout.workspace, 'sub-1');
  });

  it('reloads a nested repo .gitignore when it changes on disk', async () => {
    const listener = createListener();
    await bus.subscribe(layout.workspace, 'sub-1', listener);

    fireWatchEvent('change', 'nested/rootfs/etc/foo.txt');
    expect(listener.onChange).not.toHaveBeenCalled();

    fs.writeFileSync(path.join(layout.workspace, 'nested', '.gitignore'), '/dist\n');
    fireWatchEvent('change', 'nested/.gitignore');
    fireWatchEvent('change', 'nested/rootfs/etc/foo.txt');

    expect(listener.onChange).toHaveBeenCalledWith(
      path.join(layout.workspace, 'nested/rootfs/etc/foo.txt'),
      undefined,
    );
    bus.unsubscribe(layout.workspace, 'sub-1');
  });

  it('does not deliver structure events for nested-ignored paths to listeners that did not opt in', async () => {
    const listener = createListener();
    listener.receiveGitignoredStructureEvents = false;
    await bus.subscribe(layout.workspace, 'sub-1', listener);

    fireWatchEvent('rename', 'nested/rootfs/etc/foo.txt');

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listener.onAdd).not.toHaveBeenCalled();
    expect(listener.onUnlink).not.toHaveBeenCalled();
    bus.unsubscribe(layout.workspace, 'sub-1');
  });

  it('delivers structure events for nested-ignored paths to listeners that opt in', async () => {
    const listener = createListener();
    listener.receiveGitignoredStructureEvents = true;
    await bus.subscribe(layout.workspace, 'sub-1', listener);

    fireWatchEvent('rename', 'nested/rootfs/etc/foo.txt');

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(listener.onAdd).toHaveBeenCalledWith(
      path.join(layout.workspace, 'nested/rootfs/etc/foo.txt'),
      true,
    );
    bus.unsubscribe(layout.workspace, 'sub-1');
  });
});
