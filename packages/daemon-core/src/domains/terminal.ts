import type { TerminalId, WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

export interface OpenTerminalOpts {
  workspacePath: WorkspacePath;
  shell?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface TerminalHandle {
  id: TerminalId;
  shell: string;
}

export interface TerminalDescriptor {
  id: TerminalId;
  shell: string;
  workspacePath: WorkspacePath;
  startedAt: string;
}

export type TerminalOutputEvent =
  | { kind: 'data'; data: string }
  | { kind: 'exit'; code: number };

export interface TerminalCapability {
  open(opts: OpenTerminalOpts): Promise<TerminalHandle>;
  write(terminalId: TerminalId, data: string): Promise<void>;
  resize(
    terminalId: TerminalId,
    cols: number,
    rows: number,
  ): Promise<void>;
  close(terminalId: TerminalId): Promise<void>;
  list(workspacePath: WorkspacePath): Promise<TerminalDescriptor[]>;
  watchOutput(
    terminalId: TerminalId,
    onEvent: (event: TerminalOutputEvent) => void,
  ): Promise<StreamHandle>;
}
