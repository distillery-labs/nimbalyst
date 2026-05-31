import type { AuthMethodKind } from '../types/capabilities.js';

export interface Identity {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** Which auth method established this identity. */
  via: AuthMethodKind;
}

export type AuthParams =
  | { kind: 'token'; token: string }
  | { kind: 'tailscale' }
  | { kind: 'oauth'; redirect: string };

export type AIProviderType =
  | 'claude'
  | 'claude-code'
  | 'openai'
  | 'openai-codex'
  | 'opencode'
  | 'copilot-cli'
  | 'lmstudio';

/**
 * Returned by `getProviderKey` — the actual secret never leaves the runtime
 * once stored. The mask is just enough for the UI to confirm "yes, a key is
 * present" without rendering it.
 */
export interface MaskedKey {
  provider: AIProviderType;
  last4: string;
  setAt: string;
}

export interface AuthCapability {
  whoAmI(): Promise<Identity | null>;
  signIn(method: AuthMethodKind, params: AuthParams): Promise<Identity>;
  signOut(): Promise<void>;
  getProviderKey(provider: AIProviderType): Promise<MaskedKey | null>;
  setProviderKey(provider: AIProviderType, key: string): Promise<void>;
  clearProviderKey(provider: AIProviderType): Promise<void>;
}
