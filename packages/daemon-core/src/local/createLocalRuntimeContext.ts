import { RuntimeErrorObject } from '../types/errors.js';
import { RUNTIME_PROTOCOL_VERSION } from '../types/capabilities.js';
import type {
  Capabilities,
  RuntimeFeatures,
  WorkspaceDescriptor,
} from '../types/capabilities.js';
import type { RuntimeContext } from '../RuntimeContext.js';
import type { AuthCapability } from '../domains/auth.js';
import type { ExtensionsCapability } from '../domains/extensions.js';
import type { FilesCapability } from '../domains/files.js';
import type { GitCapability } from '../domains/git.js';
import type { MCPCapability } from '../domains/mcp.js';
import type { MetaCapability } from '../domains/meta.js';
import type { SessionsCapability } from '../domains/sessions.js';
import type { TerminalCapability } from '../domains/terminal.js';
import type { TranscriptsCapability } from '../domains/transcripts.js';

import { LocalFilesCapability } from './files.js';

export interface LocalRuntimeContextOptions {
  runtimeId: string;
  runtimeName: string;
  runtimeVersion: string;
  workspaces: WorkspaceDescriptor[];
  features?: Partial<RuntimeFeatures>;
}

const DEFAULT_FEATURES: RuntimeFeatures = {
  fileWrite: true,
  terminal: false,
  git: false,
  worktrees: false,
  mcp: false,
  extensions: false,
  interactiveVisualEditors: false,
  cron: false,
  webhooks: false,
  restApi: false,
};

/**
 * Composes a RuntimeContext where `files` is real and the other capabilities
 * throw CAPABILITY_NOT_SUPPORTED.
 *
 * This is the seam Electron main will use to register its in-process
 * runtime once each domain's services migrate into daemon-core. Each
 * follow-up chunk lights up one more capability: terminal, git, sessions,
 * transcripts, extensions, mcp, auth, meta. The features flags in
 * `Capabilities` flip as each domain becomes real, so the renderer's
 * capability-gated UI lights up incrementally without needing a flag day.
 */
export function createLocalRuntimeContext(
  options: LocalRuntimeContextOptions,
): RuntimeContext {
  const features: RuntimeFeatures = {
    ...DEFAULT_FEATURES,
    ...options.features,
  };

  const capabilities: Capabilities = {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    runtimeKind: 'local',
    runtimeId: options.runtimeId,
    runtimeName: options.runtimeName,
    runtimeVersion: options.runtimeVersion,
    features,
    authMethods: ['inherit'],
    aiProviders: [],
    workspaces: options.workspaces,
  };

  const files = new LocalFilesCapability();

  return {
    capabilities,
    files,
    meta: notImplemented<MetaCapability>('meta'),
    auth: notImplemented<AuthCapability>('auth'),
    git: notImplemented<GitCapability>('git'),
    sessions: notImplemented<SessionsCapability>('sessions'),
    terminal: notImplemented<TerminalCapability>('terminal'),
    transcripts: notImplemented<TranscriptsCapability>('transcripts'),
    extensions: notImplemented<ExtensionsCapability>('extensions'),
    mcp: notImplemented<MCPCapability>('mcp'),
    async shutdown() {
      /* no resources to release yet */
    },
  };
}

/**
 * Produces a proxy that throws CAPABILITY_NOT_SUPPORTED for every property
 * access. Used as a placeholder for domains not yet migrated. Lets the
 * RuntimeContext shape be complete from day one without forcing every
 * caller to null-check capabilities they may not use.
 */
function notImplemented<T extends object>(domain: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new RuntimeErrorObject({
          code: 'CAPABILITY_NOT_SUPPORTED',
          message: `RuntimeContext.${domain}.${String(prop)} is not yet migrated to daemon-core.`,
          retryable: false,
        });
      };
    },
  });
}
