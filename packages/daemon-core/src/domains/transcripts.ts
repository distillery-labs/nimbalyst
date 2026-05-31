import type { SessionId, WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

/**
 * Canonical transcript event — provider-agnostic, the single shape the
 * renderer sees. Matches docs/TRANSCRIPT_ARCHITECTURE.md.
 *
 * The exact event union is intentionally left open here; the canonical type
 * lives in `@nimbalyst/runtime/ai/server/transcript/types`. Phase 0's
 * extraction will narrow this once that module moves into daemon-core.
 */
export interface TranscriptEvent {
  sessionId: SessionId;
  seq: number;
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface TranscriptListOpts {
  fromSeq?: number;
  limit?: number;
}

export interface TranscriptSearchHit {
  sessionId: SessionId;
  seq: number;
  preview: string;
  score: number;
}

export interface ExportResult {
  format: 'html' | 'markdown' | 'json';
  content: string;
}

export interface TranscriptStreamParams {
  sessionId: SessionId;
  fromSeq?: number;
}

export interface TranscriptsCapability {
  list(
    sessionId: SessionId,
    opts?: TranscriptListOpts,
  ): Promise<TranscriptEvent[]>;
  search(
    workspacePath: WorkspacePath,
    query: string,
  ): Promise<TranscriptSearchHit[]>;
  export(
    sessionId: SessionId,
    format: 'html' | 'markdown' | 'json',
  ): Promise<ExportResult>;
  watch(
    params: TranscriptStreamParams,
    onEvent: (event: TranscriptEvent) => void,
  ): Promise<StreamHandle>;
}
