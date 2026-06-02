import { describe, expect, it, vi } from 'vitest';
import { resolveCredential, type CredentialResolutionDeps } from '../credentialResolution';
import type { ResolvedCredential } from '../../../../shared/credentialProfiles';
import type { ProviderOverride } from '../../../utils/store';

function makeDeps(opts: {
  profiles?: Record<string, ResolvedCredential>;
  projectOverrides?: Record<string, Record<string, ProviderOverride>>;
  globalKeys?: Record<string, string>;
  claudeCodeAuthMethod?: string;
}): CredentialResolutionDeps {
  return {
    resolveProfile: (id) => opts.profiles?.[id],
    getProjectOverride: (wp, p) => opts.projectOverrides?.[wp]?.[p],
    getGlobalApiKeys: () => opts.globalKeys ?? {},
    getClaudeCodeAuthMethod: () => opts.claudeCodeAuthMethod ?? 'login',
  };
}

const profileA: ResolvedCredential = {
  kind: 'apiKey', profileId: 'pA', label: 'A', providerId: 'claude', value: 'sk-A',
};
const profileB: ResolvedCredential = {
  kind: 'apiKey', profileId: 'pB', label: 'B', providerId: 'claude', value: 'sk-B',
};

describe('resolveCredential precedence', () => {
  it('returns session profile when set, ignoring project + global', () => {
    const deps = makeDeps({
      profiles: { pA: profileA, pB: profileB },
      projectOverrides: { '/w': { claude: { credentialProfileId: 'pB' } } },
      globalKeys: { anthropic: 'sk-global' },
    });
    const cred = resolveCredential(
      'claude',
      { workspacePath: '/w', sessionMetadata: { credentialProfileId: 'pA' } },
      deps,
    );
    expect(cred).toEqual(profileA);
  });

  it('falls back to project profile when session profile not set', () => {
    const deps = makeDeps({
      profiles: { pB: profileB },
      projectOverrides: { '/w': { claude: { credentialProfileId: 'pB' } } },
      globalKeys: { anthropic: 'sk-global' },
    });
    const cred = resolveCredential('claude', { workspacePath: '/w' }, deps);
    expect(cred).toEqual(profileB);
  });

  it('falls back to project legacy apiKey when no profile reference', () => {
    const deps = makeDeps({
      projectOverrides: { '/w': { claude: { apiKey: 'sk-legacy' } } },
      globalKeys: { anthropic: 'sk-global' },
    });
    const cred = resolveCredential('claude', { workspacePath: '/w' }, deps);
    expect(cred?.kind).toBe('apiKey');
    expect((cred as any).value).toBe('sk-legacy');
    expect((cred as any).profileId).toBe('__project_legacy__');
  });

  it('falls back to global apiKey when no overrides set', () => {
    const deps = makeDeps({ globalKeys: { anthropic: 'sk-global' } });
    const cred = resolveCredential('claude', { workspacePath: '/w' }, deps);
    expect(cred?.kind).toBe('apiKey');
    expect((cred as any).value).toBe('sk-global');
    expect((cred as any).profileId).toBe('__global__');
  });

  it('returns undefined when no global key and no overrides', () => {
    const deps = makeDeps({});
    expect(resolveCredential('claude', { workspacePath: '/w' }, deps)).toBeUndefined();
  });

  it('falls past a session profile id pointing at an unknown profile', () => {
    const deps = makeDeps({
      profiles: {}, // pX does not resolve
      globalKeys: { anthropic: 'sk-global' },
    });
    const cred = resolveCredential(
      'claude',
      { sessionMetadata: { credentialProfileId: 'pX' } },
      deps,
    );
    expect((cred as any).profileId).toBe('__global__');
  });

  it('falls past a project profile id pointing at an unknown profile to legacy apiKey', () => {
    const deps = makeDeps({
      profiles: {},
      projectOverrides: { '/w': { claude: { credentialProfileId: 'gone', apiKey: 'sk-legacy' } } },
    });
    const cred = resolveCredential('claude', { workspacePath: '/w' }, deps);
    expect((cred as any).value).toBe('sk-legacy');
  });
});

describe('claude-code authMethod gate', () => {
  it('global fallback returns undefined when claude-code authMethod is login', () => {
    const deps = makeDeps({
      globalKeys: { 'claude-code': 'sk-global' },
      claudeCodeAuthMethod: 'login',
    });
    expect(resolveCredential('claude-code', {}, deps)).toBeUndefined();
  });

  it('global fallback returns the key when claude-code authMethod is api-key', () => {
    const deps = makeDeps({
      globalKeys: { 'claude-code': 'sk-global' },
      claudeCodeAuthMethod: 'api-key',
    });
    const cred = resolveCredential('claude-code', {}, deps);
    expect((cred as any).value).toBe('sk-global');
  });

  it('project profile bypasses the authMethod gate', () => {
    const ccProfile: ResolvedCredential = {
      kind: 'apiKey', profileId: 'cc', label: 'CC', providerId: 'claude-code', value: 'sk-cc',
    };
    const deps = makeDeps({
      profiles: { cc: ccProfile },
      projectOverrides: { '/w': { 'claude-code': { credentialProfileId: 'cc' } } },
      globalKeys: { 'claude-code': 'sk-global' },
      claudeCodeAuthMethod: 'login', // gate is set to login but project profile wins
    });
    const cred = resolveCredential('claude-code', { workspacePath: '/w' }, deps);
    expect(cred).toEqual(ccProfile);
  });

  it('project legacy apiKey also bypasses the gate', () => {
    const deps = makeDeps({
      projectOverrides: { '/w': { 'claude-code': { apiKey: 'sk-legacy' } } },
      claudeCodeAuthMethod: 'login',
    });
    const cred = resolveCredential('claude-code', { workspacePath: '/w' }, deps);
    expect((cred as any).value).toBe('sk-legacy');
  });
});

describe('lmstudio sentinel', () => {
  it('returns the not-required sentinel regardless of globalKeys', () => {
    const deps = makeDeps({});
    const cred = resolveCredential('lmstudio', {}, deps);
    expect(cred?.kind).toBe('apiKey');
    expect((cred as any).value).toBe('not-required');
  });
});
