import type { StreamId } from './identifiers.js';

/**
 * Unified subscribe/unsubscribe primitive. Replaces the ad-hoc
 * `ipcRenderer.on(...)` calls in the existing renderer with a single
 * topic-keyed stream model.
 *
 * Wire format: each `subscribe` call allocates a `StreamId`; the server
 * sends `{ kind: 'stream', id, event }` frames; the client multiplexes them
 * back to the registered callback. `unsubscribe` sends `{ kind: 'stream-close', id }`.
 *
 * Phase 0 / Phase 1 ship without backpressure or coalescing. Add only if it
 * bites.
 *
 * Tracker mutations and document Y.Doc updates are NOT topics here — they
 * flow over the cloud collab connection (`packages/collabv3`), not over
 * RuntimeContext. See the v0 design doc for the rationale.
 */

export type StreamTopic =
  | 'file-watch'
  | 'session-events'
  | 'terminal-output'
  | 'git-status'
  | 'transcript-events'
  | 'runtime-status'
  | 'extension-events';

export interface StreamHandle {
  readonly id: StreamId;
  unsubscribe(): Promise<void>;
}
