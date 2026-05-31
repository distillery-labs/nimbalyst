import type { SessionId, WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

/**
 * The session event union ships canonical transcript events (per
 * docs/TRANSCRIPT_ARCHITECTURE.md), not provider-specific raw rows. The
 * transformer runs runtime-side; the renderer never sees `ai_agent_messages`
 * shapes.
 */
export type SessionEvent =
  | { kind: 'prompt-added'; promptId: string; text: string }
  | { kind: 'tool-call'; toolCallId: string; tool: string; args: unknown }
  | { kind: 'tool-result'; toolCallId: string; result: unknown }
  | { kind: 'text-delta'; text: string }
  | { kind: 'permission-request'; toolCallId: string; tool: string }
  | { kind: 'state-change'; state: 'idle' | 'running' | 'awaiting-input' | 'errored' }
  | { kind: 'error'; message: string };

export interface SessionMetadata {
  id: SessionId;
  workspacePath: WorkspacePath;
  provider: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  state: 'idle' | 'running' | 'awaiting-input' | 'errored';
}

export interface Session extends SessionMetadata {
  parentSessionId: SessionId | null;
  worktreeId: string | null;
  agentRole: string | null;
}

export interface SessionFilter {
  parentSessionId?: SessionId | null;
  worktreeId?: string | null;
  state?: Session['state'];
}

export interface CreateSessionOpts {
  workspacePath: WorkspacePath;
  provider: string;
  modelId?: string;
  parentSessionId?: SessionId;
  worktreeId?: string;
  agentRole?: string;
  documentContext?: unknown;
}

export interface SessionPatch {
  title?: string;
  modelId?: string;
}

export interface SessionPrompt {
  text: string;
  attachments?: Array<{ relPath: string }>;
}

export type ToolDecision =
  | { kind: 'allow' }
  | { kind: 'allow-once' }
  | { kind: 'deny'; reason?: string };

export interface SessionEventStreamParams {
  sessionId: SessionId;
  fromSeq?: number;
}

export interface SessionsCapability {
  list(
    workspacePath: WorkspacePath,
    filter?: SessionFilter,
  ): Promise<SessionMetadata[]>;
  get(sessionId: SessionId): Promise<Session>;
  create(opts: CreateSessionOpts): Promise<Session>;
  delete(sessionId: SessionId): Promise<void>;
  update(sessionId: SessionId, patch: SessionPatch): Promise<void>;

  sendPrompt(
    sessionId: SessionId,
    prompt: SessionPrompt,
  ): Promise<{ promptId: string }>;
  approveTool(
    sessionId: SessionId,
    toolCallId: string,
    decision: ToolDecision,
  ): Promise<void>;
  interrupt(sessionId: SessionId): Promise<void>;
  stop(sessionId: SessionId): Promise<void>;

  resume(sessionId: SessionId): Promise<void>;
  branch(sessionId: SessionId, atMessageId: string): Promise<Session>;

  watchEvents(
    params: SessionEventStreamParams,
    onEvent: (event: SessionEvent) => void,
  ): Promise<StreamHandle>;
}
