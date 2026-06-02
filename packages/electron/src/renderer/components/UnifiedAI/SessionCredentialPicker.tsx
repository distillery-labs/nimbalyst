import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  CREDENTIAL_PROFILE_IPC,
  type CredentialProfile,
} from '../../../shared/credentialProfiles';
import { sessionRegistryAtom } from '../../store/atoms/sessions';

interface SessionCredentialPickerProps {
  sessionId: string;
  provider: string;
}

/**
 * Per-thread credential picker. Always renders an interactive control next to
 * the model picker. When the session inherits from project/global, the control
 * is a small key icon button — discoverable but visually quiet. When an
 * override is active, the control expands into a pill showing the profile
 * label.
 *
 * Writes `metadata.credentialProfileId` on the session via
 * `sessions:update-session-metadata`. The streaming handler picks this up on
 * the next turn via `resolveCredential`. Initial value is read from the
 * in-renderer sessionRegistry (which projects metadata.credentialProfileId
 * off the JSONB column in PGLiteSessionStore.list()).
 */
export const SessionCredentialPicker: React.FC<SessionCredentialPickerProps> = ({
  sessionId,
  provider,
}) => {
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Seed initial value from the session registry. The registry is populated
  // from PGLiteSessionStore.list(), which projects metadata.credentialProfileId
  // onto the SessionMeta object (extracted from the JSONB column).
  useEffect(() => {
    const meta = sessionRegistry.get(sessionId) as { credentialProfileId?: string } | undefined;
    setCurrentProfileId(meta?.credentialProfileId ?? null);
  }, [sessionId, sessionRegistry]);

  const loadProfiles = useCallback(async () => {
    try {
      const list = (await window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.list)) as CredentialProfile[];
      setProfiles(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('[SessionCredentialPicker] failed to load profiles:', err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  // React to external session metadata updates so the pill stays in sync when
  // another window changes the credential.
  useEffect(() => {
    const handler = (_event: unknown, updatedSessionId: string, metadataFields: Record<string, unknown>) => {
      if (updatedSessionId !== sessionId) return;
      if ('credentialProfileId' in metadataFields) {
        const v = metadataFields.credentialProfileId;
        setCurrentProfileId(typeof v === 'string' ? v : null);
      }
    };
    const off = window.electronAPI.on?.('sessions:session-updated', handler);
    return () => {
      if (typeof off === 'function') off();
      else window.electronAPI.off?.('sessions:session-updated', handler);
    };
  }, [sessionId]);

  const providerProfiles = useMemo(
    () => profiles.filter((p) => p.providerId === provider),
    [profiles, provider],
  );
  const currentProfile = useMemo(
    () => (currentProfileId ? profiles.find((p) => p.id === currentProfileId) : undefined),
    [profiles, currentProfileId],
  );

  const handleChange = async (value: string) => {
    const next = value === '' ? null : value;
    const prev = currentProfileId;
    setCurrentProfileId(next);
    try {
      await window.electronAPI.invoke('sessions:update-session-metadata', sessionId, {
        credentialProfileId: next,
      });
    } catch (err) {
      console.error('[SessionCredentialPicker] save failed:', err);
      setCurrentProfileId(prev);
    }
  };

  if (!loaded) return null;

  // Hide entirely when there's no profile to pick AND no override to display.
  // Showing an empty control adds clutter; the Credential Profiles panel is
  // where users create profiles in the first place.
  if (providerProfiles.length === 0 && !currentProfile) return null;

  const isOverridden = !!currentProfile;

  return (
    <label
      className={`session-credential-picker inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs cursor-pointer transition-colors ${
        isOverridden
          ? 'bg-[var(--nim-accent-subtle)] text-[var(--nim-primary)] border border-[var(--nim-primary)]'
          : 'text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)]'
      }`}
      title={
        isOverridden
          ? `This thread uses credential profile "${currentProfile?.label}"`
          : 'Use a specific credential profile for this thread'
      }
    >
      <MaterialSymbol icon="key" size={14} />
      {isOverridden && <span className="truncate max-w-[140px]">{currentProfile?.label}</span>}
      <select
        className="bg-transparent border-none outline-none cursor-pointer text-inherit appearance-none"
        value={currentProfileId ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        style={{ width: isOverridden ? 12 : 16 }}
      >
        <option value="">Inherit from project</option>
        {providerProfiles.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </label>
  );
};
