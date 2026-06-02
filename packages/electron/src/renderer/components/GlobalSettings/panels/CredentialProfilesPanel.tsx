import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol, getProviderIcon } from '@nimbalyst/runtime';
import {
  CREDENTIAL_PROFILE_IPC,
  type CredentialProfile,
  type CreateCredentialProfileInput,
  type DeleteProfileResult,
  type ProfileReferences,
} from '../../../../shared/credentialProfiles';

interface ProviderInfo {
  id: string;
  name: string;
  /** Key name inside the global apiKeys map (for the import-from-global affordance). */
  globalKeyName?: string;
}

const SUPPORTED_PROVIDERS: ProviderInfo[] = [
  { id: 'claude-code', name: 'Claude Agent', globalKeyName: 'claude-code' },
  { id: 'claude', name: 'Claude Chat', globalKeyName: 'anthropic' },
  { id: 'openai', name: 'OpenAI', globalKeyName: 'openai' },
  { id: 'openai-codex', name: 'OpenAI Codex', globalKeyName: 'openai-codex' },
];

interface DraftProfile {
  /** undefined = creating; string = editing existing id */
  id?: string;
  providerId: string;
  label: string;
  apiKey: string;
}

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export const CredentialProfilesPanel: React.FC = () => {
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalApiKeys, setGlobalApiKeys] = useState<Record<string, string>>({});
  const [deleteRefs, setDeleteRefs] = useState<{ profile: CredentialProfile; refs: ProfileReferences } | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, settings] = await Promise.all([
        window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.list) as Promise<CredentialProfile[]>,
        window.electronAPI.aiGetSettings(),
      ]);
      setProfiles(Array.isArray(list) ? list : []);
      setGlobalApiKeys((settings?.apiKeys ?? {}) as Record<string, string>);
    } catch (err) {
      setError(`Failed to load profiles: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const profilesByProvider = useMemo(() => {
    const map = new Map<string, CredentialProfile[]>();
    for (const p of profiles) {
      const arr = map.get(p.providerId) ?? [];
      arr.push(p);
      map.set(p.providerId, arr);
    }
    return map;
  }, [profiles]);

  const startCreate = (providerId: string) => {
    setError(null);
    setDraft({ providerId, label: '', apiKey: '' });
  };

  const startEdit = (profile: CredentialProfile) => {
    setError(null);
    setDraft({
      id: profile.id,
      providerId: profile.providerId,
      label: profile.label,
      apiKey: '', // blank = leave value unchanged
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        const update: { id: string; label?: string; apiKey?: { value: string } } = {
          id: draft.id,
          label: draft.label.trim(),
        };
        if (draft.apiKey) update.apiKey = { value: draft.apiKey };
        await window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.update, update);
      } else {
        const input: CreateCredentialProfileInput = {
          label: draft.label.trim(),
          providerId: draft.providerId,
          kind: 'apiKey',
          apiKey: { value: draft.apiKey },
        };
        await window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.create, input);
      }
      setDraft(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profile: CredentialProfile) => {
    try {
      const result = (await window.electronAPI.invoke(
        CREDENTIAL_PROFILE_IPC.delete,
        profile.id,
      )) as DeleteProfileResult;
      if (result.ok) {
        await reload();
      } else {
        setDeleteRefs({ profile, refs: result.references });
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleImportFromGlobal = (provider: ProviderInfo) => {
    const value = provider.globalKeyName ? globalApiKeys[provider.globalKeyName] : '';
    if (!value) return;
    setError(null);
    setDraft({
      providerId: provider.id,
      label: `Default ${provider.name}`,
      apiKey: value,
    });
  };

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="credential-profiles-panel flex flex-col h-full p-6 gap-6">
        <div className="panel-loading flex items-center justify-center h-[200px] text-[var(--nim-text-muted)]">
          Loading credential profiles…
        </div>
      </div>
    );
  }

  return (
    <div className="credential-profiles-panel flex flex-col h-full p-6 gap-6">
      <div className="panel-header">
        <h2 className="m-0 mb-2 text-lg font-semibold text-[var(--nim-text)]">Credential Profiles</h2>
        <p className="panel-description m-0 text-[13px] text-[var(--nim-text-muted)] leading-normal">
          Named API keys you can attach to a specific project or chat thread.
          Profiles let you use different Anthropic accounts (personal vs work, client A vs client B)
          without copy-pasting keys into multiple places.
        </p>
      </div>

      {error && (
        <div className="credential-profiles-error flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] text-[var(--nim-error)]">
          <MaterialSymbol icon="error" size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="panel-content flex-1 overflow-y-auto flex flex-col gap-4">
        {SUPPORTED_PROVIDERS.map((provider) => {
          const list = profilesByProvider.get(provider.id) ?? [];
          const globalValue = provider.globalKeyName ? globalApiKeys[provider.globalKeyName] : '';
          const hasGlobalKey = !!globalValue;
          const hasProfileMatchingGlobal = list.some(
            (p) => p.apiKey?.value && p.apiKey.value === globalValue,
          );
          const canImport = hasGlobalKey && !hasProfileMatchingGlobal;

          return (
            <div
              key={provider.id}
              className="credential-provider-group rounded-lg overflow-hidden bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]"
            >
              <div className="provider-group-header flex items-center justify-between px-4 py-3 border-b border-[var(--nim-border)]">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 bg-[var(--nim-bg-tertiary)] rounded-lg">
                    {getProviderIcon(provider.id as any, { size: 20 })}
                  </span>
                  <span className="text-sm font-medium text-[var(--nim-text)]">{provider.name}</span>
                </div>
                <button
                  className="nim-btn-secondary text-xs px-3 py-1.5"
                  onClick={() => startCreate(provider.id)}
                  disabled={!!draft}
                >
                  + New profile
                </button>
              </div>

              <div className="provider-group-body p-4 flex flex-col gap-2">
                {list.length === 0 && draft?.providerId !== provider.id && (
                  <div className="text-[13px] text-[var(--nim-text-faint)] italic">No profiles yet.</div>
                )}

                {list.map((profile) => {
                  const revealed = revealedIds.has(profile.id);
                  return (
                    <div
                      key={profile.id}
                      className="profile-row flex items-center justify-between px-3 py-2 rounded-md bg-[var(--nim-bg)] border border-[var(--nim-border)]"
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--nim-text)] font-medium truncate">{profile.label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-faint)] uppercase">
                            {profile.kind}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--nim-text-faint)] font-mono">
                          {revealed ? (profile.apiKey?.value ?? '') : maskKey(profile.apiKey?.value ?? '')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          className="p-1.5 rounded hover:bg-[var(--nim-bg-hover)] text-[var(--nim-text-muted)]"
                          onClick={() => toggleReveal(profile.id)}
                          aria-label={revealed ? 'Hide key' : 'Reveal key'}
                        >
                          <MaterialSymbol icon={revealed ? 'visibility_off' : 'visibility'} size={16} />
                        </button>
                        <button
                          className="p-1.5 rounded hover:bg-[var(--nim-bg-hover)] text-[var(--nim-text-muted)]"
                          onClick={() => startEdit(profile)}
                          disabled={!!draft}
                          aria-label="Edit profile"
                        >
                          <MaterialSymbol icon="edit" size={16} />
                        </button>
                        <button
                          className="p-1.5 rounded hover:bg-[var(--nim-bg-hover)] text-[var(--nim-error)]"
                          onClick={() => handleDelete(profile)}
                          disabled={!!draft}
                          aria-label="Delete profile"
                        >
                          <MaterialSymbol icon="delete" size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {draft?.providerId === provider.id && (
                  <CredentialProfileForm
                    draft={draft}
                    saving={saving}
                    onChange={setDraft}
                    onCancel={() => { setDraft(null); setError(null); }}
                    onSave={handleSave}
                  />
                )}

                {canImport && draft?.providerId !== provider.id && (
                  <button
                    className="self-start text-xs px-2 py-1 rounded text-[var(--nim-primary)] hover:bg-[var(--nim-accent-subtle)]"
                    onClick={() => handleImportFromGlobal(provider)}
                  >
                    + Create profile from your existing global {provider.name} key
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {deleteRefs && (
        <DeleteReferencesModal
          profile={deleteRefs.profile}
          references={deleteRefs.refs}
          onClose={() => setDeleteRefs(null)}
        />
      )}
    </div>
  );
};

interface FormProps {
  draft: DraftProfile;
  saving: boolean;
  onChange: (next: DraftProfile) => void;
  onCancel: () => void;
  onSave: () => void;
}

const CredentialProfileForm: React.FC<FormProps> = ({ draft, saving, onChange, onCancel, onSave }) => {
  const isEdit = !!draft.id;
  const canSave = draft.label.trim().length > 0 && (isEdit || draft.apiKey.length > 0);
  return (
    <div className="credential-profile-form flex flex-col gap-3 p-3 rounded-md bg-[var(--nim-bg)] border border-[var(--nim-primary)]">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--nim-text-muted)]">Label</label>
        <input
          type="text"
          className="nim-input text-[13px]"
          placeholder="e.g. Acme prod"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-[var(--nim-text-muted)]">
          API key {isEdit && <span className="text-[var(--nim-text-faint)]">(leave blank to keep the existing key)</span>}
        </label>
        <input
          type="password"
          className="nim-input font-mono text-[13px]"
          placeholder={isEdit ? '••••••••' : 'sk-...'}
          value={draft.apiKey}
          onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2 justify-end">
        <button className="nim-btn-secondary text-xs px-3 py-1.5" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          className="nim-btn-primary text-xs px-3 py-1.5"
          onClick={onSave}
          disabled={!canSave || saving}
        >
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create profile'}
        </button>
      </div>
    </div>
  );
};

interface ReferencesModalProps {
  profile: CredentialProfile;
  references: ProfileReferences;
  onClose: () => void;
}

const DeleteReferencesModal: React.FC<ReferencesModalProps> = ({ profile, references, onClose }) => {
  const total = references.projects.length + references.sessions.length;
  return (
    <div className="credential-references-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="credential-references-modal w-[480px] max-w-[90vw] rounded-lg bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] shadow-xl">
        <div className="px-4 py-3 border-b border-[var(--nim-border)] flex items-center gap-2">
          <MaterialSymbol icon="warning" size={20} className="text-[var(--nim-warning)]" />
          <h3 className="m-0 text-sm font-semibold text-[var(--nim-text)]">
            "{profile.label}" is still in use
          </h3>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          <p className="m-0 text-[13px] text-[var(--nim-text-muted)]">
            Clear the {total === 1 ? 'reference' : `${total} references`} below before deleting the profile.
          </p>
          {references.projects.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase">Projects</div>
              <ul className="m-0 pl-4 text-[13px] text-[var(--nim-text)]">
                {references.projects.map((p, idx) => (
                  <li key={`${p.workspacePath}-${p.providerId}-${idx}`} className="font-mono text-xs">
                    {p.workspacePath} <span className="text-[var(--nim-text-faint)]">({p.providerId})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {references.sessions.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-semibold text-[var(--nim-text-muted)] uppercase">Chat threads</div>
              <ul className="m-0 pl-4 text-[13px] text-[var(--nim-text)]">
                {references.sessions.map((s) => (
                  <li key={s.sessionId}>
                    {s.title || <span className="text-[var(--nim-text-faint)] italic">(untitled)</span>}
                    <span className="text-[var(--nim-text-faint)] font-mono text-xs ml-2">{s.sessionId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-[var(--nim-border)] flex justify-end">
          <button className="nim-btn-primary text-xs px-3 py-1.5" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
