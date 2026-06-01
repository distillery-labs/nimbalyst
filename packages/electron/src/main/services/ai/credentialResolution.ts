/**
 * Pure credential resolution logic.
 *
 * Extracted from AIService so the precedence ladder can be unit-tested
 * without spinning up the full service. The order is:
 *
 *   1. session.metadata.credentialProfileId
 *   2. project override `credentialProfileId`
 *   3. project override legacy inline `apiKey`
 *   4. global apiKey from settings (subject to claude-code authMethod gate)
 *
 * Explicitly-selected profiles at session or project level bypass the
 * claude-code authMethod gate, since the user opted in. The gate still
 * applies to the global fallback.
 */

import type { ProviderOverride } from '../../utils/store';
import type { ResolvedCredential } from '../../../shared/credentialProfiles';

export interface CredentialResolutionDeps {
  /** Look up a profile by id; return undefined if missing. */
  resolveProfile: (id: string) => ResolvedCredential | undefined;
  /** Workspace-level overrides for the given path. */
  getProjectOverride: (workspacePath: string, provider: string) => ProviderOverride | undefined;
  /** Read globally-stored API keys (the `apiKeys` map in ai-settings). */
  getGlobalApiKeys: () => Record<string, string>;
  /** Read the authMethod for claude-code from provider settings ('login' if unset). */
  getClaudeCodeAuthMethod: () => string;
}

export interface ResolveCredentialOpts {
  workspacePath?: string;
  sessionMetadata?: Record<string, unknown>;
}

/**
 * lmstudio doesn't need auth, but downstream code currently expects an
 * "apiKey" string to be present. We return a sentinel to preserve that
 * contract.
 */
const LMSTUDIO_SENTINEL_VALUE = 'not-required';

export function globalApiKeyNameForProvider(provider: string): string | undefined {
  switch (provider) {
    case 'claude': return 'anthropic';
    case 'claude-code': return 'claude-code';
    case 'openai': return 'openai';
    case 'openai-codex': return 'openai-codex';
    case 'lmstudio': return '__not_required__';
    default: return provider;
  }
}

export function resolveCredential(
  provider: string,
  opts: ResolveCredentialOpts,
  deps: CredentialResolutionDeps,
): ResolvedCredential | undefined {
  const { workspacePath, sessionMetadata } = opts;

  // 1. Session-level profile
  const sessionProfileId = sessionMetadata?.credentialProfileId;
  if (typeof sessionProfileId === 'string' && sessionProfileId.length > 0) {
    const resolved = deps.resolveProfile(sessionProfileId);
    if (resolved) return resolved;
  }

  // 2 & 3. Project-level override
  if (workspacePath) {
    const override = deps.getProjectOverride(workspacePath, provider);
    if (override?.credentialProfileId) {
      const resolved = deps.resolveProfile(override.credentialProfileId);
      if (resolved) return resolved;
    }
    if (override?.apiKey) {
      return {
        kind: 'apiKey',
        profileId: '__project_legacy__',
        label: 'Project override',
        providerId: provider,
        value: override.apiKey,
      };
    }
  }

  // 4. Global default
  if (provider === 'claude-code') {
    const authMethod = deps.getClaudeCodeAuthMethod();
    if (authMethod !== 'api-key') return undefined;
  }

  const globalKeyName = globalApiKeyNameForProvider(provider);
  if (!globalKeyName) return undefined;
  if (globalKeyName === '__not_required__') {
    return {
      kind: 'apiKey',
      profileId: '__not_required__',
      label: 'lmstudio',
      providerId: provider,
      value: LMSTUDIO_SENTINEL_VALUE,
    };
  }
  const value = deps.getGlobalApiKeys()[globalKeyName];
  if (!value) return undefined;
  return {
    kind: 'apiKey',
    profileId: '__global__',
    label: `Global ${provider}`,
    providerId: provider,
    value,
  };
}
