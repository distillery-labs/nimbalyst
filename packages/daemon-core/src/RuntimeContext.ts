import type { Capabilities } from './types/capabilities.js';
import type { StreamHandle } from './types/streams.js';
import type { StreamTopic } from './types/streams.js';
import type { AuthCapability } from './domains/auth.js';
import type { ExtensionsCapability } from './domains/extensions.js';
import type { FilesCapability } from './domains/files.js';
import type { GitCapability } from './domains/git.js';
import type { MCPCapability } from './domains/mcp.js';
import type { MetaCapability } from './domains/meta.js';
import type { SessionsCapability } from './domains/sessions.js';
import type { TerminalCapability } from './domains/terminal.js';
import type { TranscriptsCapability } from './domains/transcripts.js';

/**
 * The contract every runtime implements.
 *
 * Local Electron main, the standalone `nimbalystd` daemon, and the cloud
 * runtime all expose the same `RuntimeContext` shape — only the transport
 * differs. The local runtime uses an in-process transport that bypasses
 * serialization; daemon and cloud both use WebSocket.
 *
 * Tracker and document data are NOT exposed here — those flow over the
 * shared cloud collab data plane (`packages/collabv3`) that every runtime
 * connects to as a client. See `nimbalyst-local/plans/runtime-context-interface-v0.md`
 * for the full design rationale.
 */
export interface RuntimeContext {
  readonly capabilities: Capabilities;

  readonly meta: MetaCapability;
  readonly auth: AuthCapability;
  readonly files: FilesCapability;
  readonly git: GitCapability;
  readonly sessions: SessionsCapability;
  readonly terminal: TerminalCapability;
  readonly transcripts: TranscriptsCapability;
  readonly extensions: ExtensionsCapability;
  readonly mcp: MCPCapability;

  shutdown(): Promise<void>;
}

/**
 * Re-exported for callers that need to enumerate runtime stream topics.
 */
export type { StreamHandle, StreamTopic };
