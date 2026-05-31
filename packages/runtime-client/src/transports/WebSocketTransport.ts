import type { RuntimeContext } from '@nimbalyst/daemon-core';
import type { ConnectionState, RuntimeTransport } from './RuntimeTransport.js';

export interface WebSocketTransportOptions {
  /** URL of the daemon or cloud runtime's RuntimeContext endpoint. */
  url: URL;
  /**
   * Bearer token presented at handshake. For daemon: the pairing-issued token.
   * For cloud: the user's Stytch session token.
   */
  token: string;
}

/**
 * Wraps a remote RuntimeContext over WebSocket, marshalling method calls and
 * stream events using the protocol defined in `@nimbalyst/collab-protocol`.
 *
 * This is a Phase 1 deliverable — the constructor accepts options and the
 * shape is stable, but `connect()` throws until the protocol implementation
 * lands. Phase 0 ships this skeleton so callers can be written against the
 * final shape without waiting on Phase 1.
 */
export class WebSocketTransport implements RuntimeTransport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly options: WebSocketTransportOptions) {}

  get context(): RuntimeContext {
    throw new Error(
      'WebSocketTransport.context is not yet implemented. Phase 1 deliverable.',
    );
  }

  get state(): ConnectionState {
    return { kind: 'disconnected', lastError: null };
  }

  onStateChange(_listener: (state: ConnectionState) => void): () => void {
    return () => {
      /* no-op until Phase 1 */
    };
  }

  async connect(): Promise<void> {
    throw new Error(
      'WebSocketTransport.connect is not yet implemented. Phase 1 deliverable.',
    );
  }

  async disconnect(): Promise<void> {
    /* no-op until Phase 1 */
  }
}
