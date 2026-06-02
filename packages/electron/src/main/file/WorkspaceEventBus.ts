/**
 * Thin compatibility shim. The real WorkspaceEventBus implementation lives in
 * `@nimbalyst/daemon-core/src/local/workspaceEventBus.ts` so the local Electron
 * runtime and the Phase 1 `nimbalystd` daemon share one watcher pool. This
 * file preserves the module-singleton ergonomics today's Electron callers use
 * (`import * as workspaceEventBus from '../file/WorkspaceEventBus'`) while
 * dispatching every call through the single process-singleton bus held by
 * `LocalRuntime`.
 *
 * As consumers migrate to talk to the bus directly (or through
 * `runtime.files.watch`), this file shrinks. Don't add new functionality here —
 * extend the daemon-core implementation instead.
 */

import type {
  GitignoreChangeHandler,
  WorkspaceEventListener,
} from '@nimbalyst/daemon-core';
import { getLocalWorkspaceEventBus } from '../runtime/LocalRuntime';

export type {
  GitignoreChangeHandler,
  WorkspaceEventListener,
  WorkspaceEventType,
} from '@nimbalyst/daemon-core';

export function subscribe(
  workspacePath: string,
  subscriberId: string,
  listener: WorkspaceEventListener,
): Promise<void> {
  return getLocalWorkspaceEventBus().subscribe(workspacePath, subscriberId, listener);
}

export function unsubscribe(workspacePath: string, subscriberId: string): void {
  getLocalWorkspaceEventBus().unsubscribe(workspacePath, subscriberId);
}

export function getSubscriberIds(workspacePath: string): string[] {
  return getLocalWorkspaceEventBus().getSubscriberIds(workspacePath);
}

export function getBusEntryCount(): number {
  return getLocalWorkspaceEventBus().getBusEntryCount();
}

export function getRefCount(workspacePath: string): number {
  return getLocalWorkspaceEventBus().getRefCount(workspacePath);
}

/** Reset all bus state. Only for tests. */
export function resetBus(): void {
  getLocalWorkspaceEventBus().resetForTests();
}

export function addWatchedPath(workspacePath: string, folderPath: string): void {
  getLocalWorkspaceEventBus().addWatchedPath(workspacePath, folderPath);
}

export function removeWatchedPath(workspacePath: string, folderPath: string): void {
  getLocalWorkspaceEventBus().removeWatchedPath(workspacePath, folderPath);
}

export function addGitignoreBypass(workspacePath: string, absolutePath: string): void {
  getLocalWorkspaceEventBus().addGitignoreBypass(workspacePath, absolutePath);
}

export function removeGitignoreBypass(workspacePath: string, absolutePath: string): void {
  getLocalWorkspaceEventBus().removeGitignoreBypass(workspacePath, absolutePath);
}

export function hasGitignoreBypass(workspacePath: string, absolutePath: string): boolean {
  return getLocalWorkspaceEventBus().hasGitignoreBypass(workspacePath, absolutePath);
}

export function clearGitignoreBypasses(workspacePath: string): void {
  getLocalWorkspaceEventBus().clearGitignoreBypasses(workspacePath);
}

export function stopAll(): Promise<void> {
  return getLocalWorkspaceEventBus().stopAll();
}

export function getStats(): {
  type: string;
  activeWorkspaces: number;
  workspaces: Array<{ workspacePath: string; subscriberCount: number; subscriberIds: string[] }>;
} {
  return getLocalWorkspaceEventBus().getStats();
}

// ---------------------------------------------------------------------------
// Gitignore-change subscription
//
// Before the daemon-core port there was a single mutator,
// `setGitignoreChangeHandler(handler | null)`. The new bus exposes an
// event-style API supporting N subscribers. The shim keeps the old setter
// shape so existing callers (today only `WorkspaceWatcher`) don't have to
// change — internally it manages the lone slot via the new subscribe API.
// ---------------------------------------------------------------------------

let activeUnsubscribe: (() => void) | null = null;

export function setGitignoreChangeHandler(handler: GitignoreChangeHandler | null): void {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
  if (handler) {
    activeUnsubscribe = getLocalWorkspaceEventBus().onGitignoreChange(handler);
  }
}
