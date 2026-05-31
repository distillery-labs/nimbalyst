import type { WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

export type ExtensionSource =
  | { kind: 'marketplace'; id: string; version?: string }
  | { kind: 'local'; path: string }
  | { kind: 'url'; url: string };

export interface ExtensionStatus {
  id: string;
  enabled: boolean;
  running: boolean;
  lastError: string | null;
}

export interface ExtensionBackendEvent {
  extensionId: string;
  channel: string;
  payload: unknown;
}

export interface ExtensionsCapability {
  list(workspacePath: WorkspacePath): Promise<InstalledExtension[]>;
  install(
    workspacePath: WorkspacePath,
    source: ExtensionSource,
  ): Promise<InstalledExtension>;
  uninstall(workspacePath: WorkspacePath, extensionId: string): Promise<void>;
  reload(workspacePath: WorkspacePath, extensionId: string): Promise<void>;
  getStatus(
    workspacePath: WorkspacePath,
    extensionId: string,
  ): Promise<ExtensionStatus>;

  /**
   * Renderer → extension backend call. The backend runs on the runtime that
   * owns the project; this method is the renderer-facing surface for invoking
   * methods it exposes.
   */
  callBackend(
    extensionId: string,
    method: string,
    payload: unknown,
  ): Promise<unknown>;

  watchEvents(
    extensionId: string,
    onEvent: (event: ExtensionBackendEvent) => void,
  ): Promise<StreamHandle>;
}
