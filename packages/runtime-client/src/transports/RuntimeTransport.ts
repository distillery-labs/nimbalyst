import type { RuntimeContext } from '@nimbalyst/daemon-core';

/**
 * Abstraction over how a RuntimeClient reaches its backing RuntimeContext.
 *
 * `InProcessTransport` returns the in-process `RuntimeContext` directly — no
 * serialization, no network. Used by the Electron main process for its local
 * runtime registration.
 *
 * `WebSocketTransport` (Phase 1) marshals method calls and stream events
 * over the wire, presenting the same `RuntimeContext` shape on the client.
 *
 * Both transports surface the same contract: a connected `RuntimeContext`
 * plus a connection-status observer.
 */

export type ConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; since: number }
  | { kind: 'disconnected'; lastError: string | null }
  | { kind: 'reconnecting'; attempt: number };

export interface RuntimeTransport {
  /**
   * The connected `RuntimeContext`. Methods called before `connect()` settles
   * should throw `RuntimeError { code: 'RUNTIME_OFFLINE' }`.
   */
  readonly context: RuntimeContext;

  /** Current state of the underlying connection. */
  readonly state: ConnectionState;

  /** Subscribe to connection-state transitions. */
  onStateChange(listener: (state: ConnectionState) => void): () => void;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
