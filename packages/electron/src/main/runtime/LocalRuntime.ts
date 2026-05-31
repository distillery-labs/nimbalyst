import { app } from 'electron';
import {
  LocalFilesCapability,
  createLocalRuntimeContext,
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
let filesCapability: LocalFilesCapability | null = null;

function build(): RuntimeContext {
  const files = new LocalFilesCapability();
  filesCapability = files;

  const ctx = createLocalRuntimeContext({
    runtimeId: 'local',
    runtimeName: 'local',
    runtimeVersion: app.getVersion(),
    workspaces: [],
    features: {
      fileWrite: true,
    },
  });

  // The createLocalRuntimeContext default builds its own LocalFilesCapability;
  // we want the same instance that's exposed to in-process callers via
  // getLocalFiles(). Swap in the shared instance.
  Object.defineProperty(ctx, 'files', {
    value: files,
    writable: false,
    enumerable: true,
    configurable: false,
  });

  logger.main.info(
    `[LocalRuntime] initialized runtime context (version ${app.getVersion()})`,
  );
  return ctx;
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
  if (!filesCapability) {
    // Ensure the runtime is built; that wires `filesCapability`.
    getLocalRuntime();
  }
  // Non-null after build() runs.
  return filesCapability!;
}
