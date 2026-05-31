/**
 * Structured error type for RuntimeContext method calls.
 *
 * The renderer branches on `code` to drive UX (re-auth flow, retry button,
 * "runtime offline" banner, etc.). Codes are stable strings; new codes can
 * be added without breaking older clients.
 */

export type RuntimeErrorCode =
  | 'RUNTIME_OFFLINE'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'WORKSPACE_NOT_FOUND'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface RuntimeError {
  code: RuntimeErrorCode;
  message: string;
  details?: unknown;
  retryable: boolean;
}

export class RuntimeErrorObject extends Error implements RuntimeError {
  readonly code: RuntimeErrorCode;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(error: RuntimeError) {
    super(error.message);
    this.name = 'RuntimeError';
    this.code = error.code;
    this.details = error.details;
    this.retryable = error.retryable;
  }
}
