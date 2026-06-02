import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock workspace iteration and the database before importing the service,
// so the singleton picks up our mocks on first construction.
const mockWorkspaceOverrides = vi.fn<() => Array<{ workspacePath: string; providers: Record<string, any> }>>();
const mockDbQuery = vi.fn();

vi.mock('../../utils/store', () => ({
  listWorkspaceProviderOverrides: () => mockWorkspaceOverrides(),
}));

vi.mock('../../database/initialize', () => ({
  getDatabase: () => ({ query: mockDbQuery }),
}));

vi.mock('../../utils/logger', () => ({
  logger: { store: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

// In-memory fake for electron-store so tests don't touch disk. The class
// lives inside the factory because vi.mock is hoisted above top-level decls.
vi.mock('electron-store', () => {
  class FakeStore<T extends Record<string, any>> {
    private data: T;
    constructor(opts: { defaults: T }) { this.data = { ...opts.defaults }; }
    get<K extends keyof T>(key: K, _fallback?: T[K]): T[K] { return this.data[key]; }
    set<K extends keyof T>(key: K, value: T[K]): void { this.data[key] = value; }
  }
  return { default: FakeStore };
});

import { CredentialProfileService } from '../CredentialProfileService';

function fresh(): CredentialProfileService {
  // Reset the singleton so each test starts with an empty store.
  (CredentialProfileService as any).instance = undefined;
  return CredentialProfileService.getInstance();
}

beforeEach(() => {
  mockWorkspaceOverrides.mockReset();
  mockWorkspaceOverrides.mockReturnValue([]);
  mockDbQuery.mockReset();
  mockDbQuery.mockResolvedValue({ rows: [] });
});

describe('CredentialProfileService', () => {
  it('creates and lists an apiKey profile', () => {
    const svc = fresh();
    const created = svc.create({
      label: 'Acme prod',
      providerId: 'anthropic',
      kind: 'apiKey',
      apiKey: { value: 'sk-ant-abc' },
    });

    expect(created.id).toBeTruthy();
    expect(created.label).toBe('Acme prod');
    expect(svc.list()).toHaveLength(1);
    expect(svc.get(created.id)?.apiKey?.value).toBe('sk-ant-abc');
  });

  it('rejects empty apiKey value', () => {
    const svc = fresh();
    expect(() =>
      svc.create({ label: 'x', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: '' } }),
    ).toThrow(/non-empty apiKey/);
  });

  it('rejects duplicate label within the same provider', () => {
    const svc = fresh();
    svc.create({ label: 'Acme prod', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' } });
    expect(() =>
      svc.create({ label: 'Acme prod', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-2' } }),
    ).toThrow(/already exists/);
  });

  it('allows the same label across different providers', () => {
    const svc = fresh();
    svc.create({ label: 'Default', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' } });
    expect(() =>
      svc.create({ label: 'Default', providerId: 'openai', kind: 'apiKey', apiKey: { value: 'sk-2' } }),
    ).not.toThrow();
  });

  it('updates a profile and bumps updatedAt', async () => {
    const svc = fresh();
    const created = svc.create({
      label: 'A', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-old' },
    });
    // Force a measurable delay between createdAt and updatedAt.
    await new Promise((r) => setTimeout(r, 5));
    const updated = svc.update({ id: created.id, apiKey: { value: 'sk-new' }, label: 'A renamed' });
    expect(updated.apiKey?.value).toBe('sk-new');
    expect(updated.label).toBe('A renamed');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  it('refuses to delete a profile referenced by a project override', async () => {
    const svc = fresh();
    const created = svc.create({
      label: 'A', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' },
    });
    mockWorkspaceOverrides.mockReturnValue([
      { workspacePath: '/Users/x/proj', providers: { anthropic: { credentialProfileId: created.id } } },
    ]);

    const result = await svc.delete(created.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.references.projects).toEqual([{ workspacePath: '/Users/x/proj', providerId: 'anthropic' }]);
    }
    expect(svc.list()).toHaveLength(1); // still there
  });

  it('refuses to delete a profile referenced by a session', async () => {
    const svc = fresh();
    const created = svc.create({
      label: 'A', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' },
    });
    mockDbQuery.mockResolvedValue({ rows: [{ id: 'sess-1', title: 'A thread' }] });

    const result = await svc.delete(created.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.references.sessions).toEqual([{ sessionId: 'sess-1', title: 'A thread' }]);
    }
  });

  it('deletes a profile when no references exist', async () => {
    const svc = fresh();
    const created = svc.create({
      label: 'A', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' },
    });
    const result = await svc.delete(created.id);
    expect(result.ok).toBe(true);
    expect(svc.list()).toHaveLength(0);
  });

  it('resolves an apiKey profile to a ResolvedCredential', () => {
    const svc = fresh();
    const created = svc.create({
      label: 'A', providerId: 'anthropic', kind: 'apiKey', apiKey: { value: 'sk-1' },
    });
    const resolved = svc.resolve(created.id);
    expect(resolved).toEqual({
      kind: 'apiKey',
      profileId: created.id,
      label: 'A',
      providerId: 'anthropic',
      value: 'sk-1',
    });
  });

  it('resolves an unknown id to undefined', () => {
    const svc = fresh();
    expect(svc.resolve('does-not-exist')).toBeUndefined();
    expect(svc.resolve(null)).toBeUndefined();
    expect(svc.resolve(undefined)).toBeUndefined();
  });
});
