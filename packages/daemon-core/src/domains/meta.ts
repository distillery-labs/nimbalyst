import type { StreamHandle } from '../types/streams.js';

export interface PingResult {
  ts: number;
  latencyMs?: number;
}

export interface LogQuery {
  limit?: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
  category?: string;
  sinceMs?: number;
}

export interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
}

export type RuntimeStatusEvent =
  | { kind: 'connected'; sinceMs: number }
  | { kind: 'disconnected'; lastError: string | null }
  | { kind: 'reconnecting'; attempt: number };

export interface MetaCapability {
  ping(): Promise<PingResult>;
  getLogs(opts?: LogQuery): Promise<LogEntry[]>;
  watchStatus(
    onEvent: (event: RuntimeStatusEvent) => void,
  ): Promise<StreamHandle>;
}
