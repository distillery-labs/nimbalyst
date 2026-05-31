import type { RuntimeId, RuntimeDisplayName } from './identifiers.js';

/**
 * Capability discovery — returned to the client at handshake time. The
 * renderer caches one `Capabilities` per registered runtime and aggregates
 * them for federated views.
 *
 * Bumping rules for `protocolVersion`:
 *   - Additive change (new methods, new fields, new error codes) → unchanged.
 *   - Backwards-incompatible (renamed/removed methods, changed field types) →
 *     bump. Clients refuse to connect when the server's protocol is newer
 *     than the client knows how to speak.
 */
export const RUNTIME_PROTOCOL_VERSION = 1;

export type RuntimeKind = 'local' | 'daemon' | 'cloud';

export type AuthMethodKind =
  | 'inherit'
  | 'token'
  | 'tailscale'
  | 'oauth';

export interface AIProviderDescriptor {
  id: string;
  displayName: string;
  configured: boolean;
}

export type WorkspaceTrust = 'trusted' | 'restricted' | 'untrusted';

export interface WorkspaceDescriptor {
  path: string;
  displayName: string;
  trust: WorkspaceTrust;
}

export interface RuntimeFeatures {
  fileWrite: boolean;
  terminal: boolean;
  git: boolean;
  worktrees: boolean;
  mcp: boolean;
  extensions: boolean;
  /** Phase 3 — Excalidraw/Mockup/DataModel round-trip from this runtime. */
  interactiveVisualEditors: boolean;
  /** Phase 6 only. */
  cron: boolean;
  webhooks: boolean;
  restApi: boolean;
}

export interface Capabilities {
  protocolVersion: number;
  runtimeKind: RuntimeKind;
  runtimeId: RuntimeId;
  runtimeName: RuntimeDisplayName;
  runtimeVersion: string;
  features: RuntimeFeatures;
  authMethods: AuthMethodKind[];
  aiProviders: AIProviderDescriptor[];
  workspaces: WorkspaceDescriptor[];
}
