import type {
  Capabilities,
  RuntimeContext,
} from '@nimbalyst/daemon-core';
import type {
  AuthCapability,
  ExtensionsCapability,
  FilesCapability,
  GitCapability,
  MCPCapability,
  MetaCapability,
  SessionsCapability,
  TerminalCapability,
  TranscriptsCapability,
} from '@nimbalyst/daemon-core';
import type {
  ConnectionState,
  RuntimeTransport,
} from './transports/RuntimeTransport.js';

/**
 * Renderer-side facade over a single runtime. The renderer holds one
 * `RuntimeClient` per registered runtime (managed by a `RuntimeRegistry`,
 * Phase 2). All renderer code dispatches against this interface — there
 * is no longer a direct path from the renderer into Electron main IPC
 * for runtime-scoped concerns.
 *
 * The shape mirrors `RuntimeContext` but is owned by the client side. This
 * indirection gives the renderer a single place to add connection-aware
 * behaviors (offline UX, reconnect hints, etc.) without leaking those into
 * `RuntimeContext` itself.
 */
export class RuntimeClient {
  constructor(private readonly transport: RuntimeTransport) {}

  get state(): ConnectionState {
    return this.transport.state;
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    return this.transport.onStateChange(listener);
  }

  async connect(): Promise<void> {
    return this.transport.connect();
  }

  async disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  private get ctx(): RuntimeContext {
    return this.transport.context;
  }

  get capabilities(): Capabilities {
    return this.ctx.capabilities;
  }

  get meta(): MetaCapability {
    return this.ctx.meta;
  }
  get auth(): AuthCapability {
    return this.ctx.auth;
  }
  get files(): FilesCapability {
    return this.ctx.files;
  }
  get git(): GitCapability {
    return this.ctx.git;
  }
  get sessions(): SessionsCapability {
    return this.ctx.sessions;
  }
  get terminal(): TerminalCapability {
    return this.ctx.terminal;
  }
  get transcripts(): TranscriptsCapability {
    return this.ctx.transcripts;
  }
  get extensions(): ExtensionsCapability {
    return this.ctx.extensions;
  }
  get mcp(): MCPCapability {
    return this.ctx.mcp;
  }
}
