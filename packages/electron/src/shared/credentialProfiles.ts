/**
 * Shared types for credential profiles.
 *
 * A credential profile is a global, named record that holds one credential
 * (currently only API keys; OAuth tokens are reserved for v1.1).
 * Projects and individual chat threads reference profiles by `id` instead
 * of embedding raw keys, so a key can be swapped in one place and rotated
 * cleanly when no longer used.
 *
 * Renderer-safe: do not import main-process modules from here.
 */

export type CredentialKind = 'apiKey' | 'oauth';

export interface ApiKeyPayload {
  value: string;
}

export interface OAuthPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes?: string[];
  /** Optional override for the Claude config directory used by the agent SDK. v1.1. */
  configDirPath?: string;
}

export interface CredentialProfile {
  id: string;
  label: string;
  providerId: string;
  kind: CredentialKind;
  createdAt: string;
  updatedAt: string;
  apiKey?: ApiKeyPayload;
  oauth?: OAuthPayload;
}

/**
 * A profile-shaped value returned by resolution. Callers use this to decide
 * how to authenticate (set ANTHROPIC_API_KEY vs. set an OAuth bearer).
 */
export type ResolvedCredential =
  | { kind: 'apiKey'; profileId: string; label: string; providerId: string; value: string }
  | { kind: 'oauth'; profileId: string; label: string; providerId: string; oauth: OAuthPayload };

/**
 * Result returned when a deletion is refused because the profile is still
 * referenced. The renderer renders this so the user can clear references first.
 */
export interface ProfileReferences {
  projects: Array<{ workspacePath: string; providerId: string }>;
  sessions: Array<{ sessionId: string; title?: string }>;
}

export type DeleteProfileResult =
  | { ok: true }
  | { ok: false; reason: 'in-use'; references: ProfileReferences };

export const CREDENTIAL_PROFILE_IPC = {
  list: 'credentials:list',
  create: 'credentials:create',
  update: 'credentials:update',
  delete: 'credentials:delete',
  references: 'credentials:references',
} as const;

export interface CreateCredentialProfileInput {
  label: string;
  providerId: string;
  kind: CredentialKind;
  apiKey?: ApiKeyPayload;
  oauth?: OAuthPayload;
}

export interface UpdateCredentialProfileInput {
  id: string;
  label?: string;
  apiKey?: ApiKeyPayload;
  oauth?: OAuthPayload;
}
