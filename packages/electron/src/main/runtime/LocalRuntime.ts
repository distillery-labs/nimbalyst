import { app } from 'electron';
import {
  LocalFilesCapability,
  WorkspaceEventBus,
  createLocalRuntimeContextWithBus,
  type RuntimeContext,
} from '@nimbalyst/daemon-core';

import { logger } from '../utils/logger';

/**
 * Lazy-initialized singleton holding the local runtime's RuntimeContext.
 *
 * This is the seam every Electron main-process caller uses to reach
 * daemon-core capabilities. During the Phase 0 migration, IPC handlers are
 * being swapped over one domain at a time — handlers that haven't been
 * migrated yet keep their existing direct-node:fs paths.
 *
 * Per MAIN_PROCESS_INIT.md, the runtime is built lazily so it doesn't run
 * `app.getPath()` (via `app.getVersion()`) before Electron's `app` module
 * is ready. The first caller after `app.whenReady()` resolves triggers
 * construction; subsequent callers reuse the same instance.
 */

let runtimeContext: RuntimeContext | null = null;
let workspaceEventBus: WorkspaceEventBus | null = null;

function build(): RuntimeContext {
  const { context, bus } = createLocalRuntimeContextWithBus({
    runtimeId: 'local',
    runtimeName: 'local',
    runtimeVersion: app.getVersion(),
    workspaces: [],
    features: {
      fileWrite: true,
    },
    workspaceEventBusLogger: logger.main,
  });

  workspaceEventBus = bus;

  logger.main.info(
    `[LocalRuntime] initialized runtime context (version ${app.getVersion()})`,
  );
  return context;
}

export function getLocalRuntime(): RuntimeContext {
  if (!runtimeContext) {
    runtimeContext = build();
  }
  return runtimeContext;
}

/**
 * Direct access to the in-process FilesCapability. Used by IPC handlers
 * during the migration so they can call migration-shim helpers
 * (`statAbsolute`, `existsAbsolute`) that aren't part of the public
 * FilesCapability interface.
 *
 * Callers that already have (workspacePath, relPath) should prefer
 * `getLocalRuntime().files` — the public interface — instead.
 */
export function getLocalFiles(): LocalFilesCapability {
  return getLocalRuntime().files as LocalFilesCapability;
}

/**
 * Direct access to the in-process WorkspaceEventBus. Used by Electron-side
 * file watchers, session file trackers, project file sync, and action-prompt
 * services that subscribe to per-workspace fs events. There is exactly one
 * bus per main process: a single chokidar/fs.watch per workspace, multi-
 * subscriber multiplex, with `.gitignore` handling and bypass bookkeeping.
 */
export function getLocalWorkspaceEventBus(): WorkspaceEventBus {
  if (!workspaceEventBus) {
    // Ensure the runtime is built; that wires `workspaceEventBus`.
    getLocalRuntime();
  }
  return workspaceEventBus!;
}
