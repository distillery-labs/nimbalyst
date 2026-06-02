import Store from 'electron-store';
import { randomUUID } from 'crypto';
import type {
  CredentialProfile,
  CreateCredentialProfileInput,
  UpdateCredentialProfileInput,
  DeleteProfileResult,
  ProfileReferences,
  ResolvedCredential,
} from '../../shared/credentialProfiles';
import { listWorkspaceProviderOverrides } from '../utils/store';
import { getDatabase } from '../database/initialize';
import { logger } from '../utils/logger';

interface CredentialProfileStoreSchema {
  profiles: CredentialProfile[];
}

/**
 * Global, named credential records referenced by per-project and per-thread
 * overrides. v1 holds API keys only; OAuth payloads are accepted but no UI
 * wires them in yet (see plans/credential-profiles.md).
 *
 * Refused-delete behavior is intentional: if a workspace or session still
 * references the profile, we surface the references rather than silently
 * dropping them, since a silent drop would swap the user onto a different
 * key on the next turn.
 */
export class CredentialProfileService {
  private static instance: CredentialProfileService;
  private store: Store<CredentialProfileStoreSchema>;

  private constructor() {
    this.store = new Store<CredentialProfileStoreSchema>({
      name: 'credential-profiles',
      clearInvalidConfig: true,
      defaults: { profiles: [] },
    });
  }

  static getInstance(): CredentialProfileService {
    if (!this.instance) this.instance = new CredentialProfileService();
    return this.instance;
  }

  list(): CredentialProfile[] {
    const raw = this.store.get('profiles', []);
    return Array.isArray(raw) ? raw : [];
  }

  get(id: string): CredentialProfile | undefined {
    return this.list().find((p) => p.id === id);
  }

  create(input: CreateCredentialProfileInput): CredentialProfile {
    this.assertLabelUniqueForProvider(input.providerId, input.label, null);
    if (input.kind === 'apiKey' && !input.apiKey?.value) {
      throw new Error('apiKey profile requires a non-empty apiKey.value');
    }
    if (input.kind === 'oauth' && !input.oauth?.accessToken) {
      throw new Error('oauth profile requires a non-empty oauth.accessToken');
    }

    const now = new Date().toISOString();
    const profile: CredentialProfile = {
      id: randomUUID(),
      label: input.label.trim(),
      providerId: input.providerId,
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
      ...(input.kind === 'apiKey' ? { apiKey: { value: input.apiKey!.value } } : {}),
      ...(input.kind === 'oauth' ? { oauth: input.oauth! } : {}),
    };

    const next = [...this.list(), profile];
    this.store.set('profiles', next);
    return profile;
  }

  update(input: UpdateCredentialProfileInput): CredentialProfile {
    const profiles = this.list();
    const idx = profiles.findIndex((p) => p.id === input.id);
    if (idx < 0) throw new Error(`Credential profile not found: ${input.id}`);
    const existing = profiles[idx];

    if (input.label !== undefined && input.label.trim() !== existing.label) {
      this.assertLabelUniqueForProvider(existing.providerId, input.label, existing.id);
    }

    const next: CredentialProfile = {
      ...existing,
      label: input.label?.trim() ?? existing.label,
      apiKey: input.apiKey ?? existing.apiKey,
      oauth: input.oauth ?? existing.oauth,
      updatedAt: new Date().toISOString(),
    };
    profiles[idx] = next;
    this.store.set('profiles', profiles);
    return next;
  }

  async delete(id: string): Promise<DeleteProfileResult> {
    const refs = await this.findReferences(id);
    if (refs.projects.length > 0 || refs.sessions.length > 0) {
      return { ok: false, reason: 'in-use', references: refs };
    }
    const next = this.list().filter((p) => p.id !== id);
    this.store.set('profiles', next);
    return { ok: true };
  }

  /**
   * Find every project override and session metadata that references the
   * given profile id. Used by both the delete path (refuse if in use) and
   * the renderer UI (show "this profile is used by N projects").
   */
  async findReferences(id: string): Promise<ProfileReferences> {
    const projects: ProfileReferences['projects'] = [];
    for (const { workspacePath, providers } of listWorkspaceProviderOverrides()) {
      for (const [providerId, override] of Object.entries(providers)) {
        if (override?.credentialProfileId === id) {
          projects.push({ workspacePath, providerId });
        }
      }
    }

    const sessions: ProfileReferences['sessions'] = [];
    const db = getDatabase();
    if (db) {
      try {
        const { rows } = await db.query<{ id: string; title: string | null }>(
          `SELECT id, title FROM ai_sessions WHERE metadata->>'credentialProfileId' = $1`,
          [id],
        );
        for (const row of rows) {
          sessions.push({ sessionId: row.id, title: row.title ?? undefined });
        }
      } catch (err) {
        logger.store.warn('[CredentialProfileService] session-ref query failed', err as Error);
      }
    }

    return { projects, sessions };
  }

  /**
   * Materialize a profile into a resolution-friendly shape. Used by Phase 2's
   * resolveCredential(). Returns undefined if the profile id is unknown — the
   * caller should fall back to the next step in the precedence ladder.
   */
  resolve(id: string | undefined | null): ResolvedCredential | undefined {
    if (!id) return undefined;
    const profile = this.get(id);
    if (!profile) return undefined;
    if (profile.kind === 'apiKey') {
      if (!profile.apiKey?.value) return undefined;
      return {
        kind: 'apiKey',
        profileId: profile.id,
        label: profile.label,
        providerId: profile.providerId,
        value: profile.apiKey.value,
      };
    }
    if (profile.kind === 'oauth') {
      if (!profile.oauth?.accessToken) return undefined;
      return {
        kind: 'oauth',
        profileId: profile.id,
        label: profile.label,
        providerId: profile.providerId,
        oauth: profile.oauth,
      };
    }
    return undefined;
  }

  private assertLabelUniqueForProvider(providerId: string, label: string, excludeId: string | null) {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Credential profile label cannot be empty');
    const collision = this.list().some(
      (p) => p.providerId === providerId && p.label === trimmed && p.id !== excludeId,
    );
    if (collision) {
      throw new Error(`A credential profile named "${trimmed}" already exists for ${providerId}`);
    }
  }
}
