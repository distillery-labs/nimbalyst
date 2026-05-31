import type { RuntimeContext } from '@nimbalyst/daemon-core';
import type { ConnectionState, RuntimeTransport } from './RuntimeTransport.js';

/**
 * Direct in-process delegation to a RuntimeContext living in the same Node
 * process. Used by the Electron main process to register itself as the
 * `kind: 'local'` runtime — no serialization, no transport overhead.
 *
 * The "connection" is always considered live as long as the wrapped context
 * exists; `disconnect()` only signals state for symmetry with WS transport.
 */
export class InProcessTransport implements RuntimeTransport {
  readonly context: RuntimeContext;
  private currentState: ConnectionState;
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(context: RuntimeContext) {
    this.context = context;
    this.currentState = { kind: 'connected', since: Date.now() };
  }

  get state(): ConnectionState {
    return this.currentState;
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.currentState.kind !== 'connected') {
      this.setState({ kind: 'connected', since: Date.now() });
    }
  }

  async disconnect(): Promise<void> {
    this.setState({ kind: 'disconnected', lastError: null });
  }

  private setState(next: ConnectionState): void {
    this.currentState = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
