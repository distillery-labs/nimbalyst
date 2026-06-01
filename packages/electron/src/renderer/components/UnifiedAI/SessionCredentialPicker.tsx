import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';
import {
  CREDENTIAL_PROFILE_IPC,
  type CredentialProfile,
} from '../../../shared/credentialProfiles';

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
 * the next turn via `resolveCredential`.
 */
export const SessionCredentialPicker: React.FC<SessionCredentialPickerProps> = ({
  sessionId,
  provider,
}) => {
  const [profiles, setProfiles] = useState<CredentialProfile[]>([]);
  const [currentProfileId, setCurrentProfileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, sessionResult] = await Promise.all([
        window.electronAPI.invoke(CREDENTIAL_PROFILE_IPC.list) as Promise<CredentialProfile[]>,
        window.electronAPI.invoke('session:load', sessionId) as Promise<{ session?: { metadata?: Record<string, unknown> } } | null>,
      ]);
      setProfiles(Array.isArray(list) ? list : []);
      const meta = sessionResult?.session?.metadata as Record<string, unknown> | undefined;
      const id = meta && typeof meta.credentialProfileId === 'string' ? meta.credentialProfileId : null;
      setCurrentProfileId(id);
    } catch (err) {
      console.error('[SessionCredentialPicker] load failed:', err);
    } finally {
      setLoaded(true);
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // React to external session updates (e.g. another window changed the metadata).
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
      // Revert on failure
      setCurrentProfileId(prev);
    }
  };

  if (!loaded) return null;

  // Hide entirely if no profiles exist for this provider AND no override is set.
  // No control to render — user has nothing to pick. The Settings panel is
  // where they'd create one. (Showing a useless control adds clutter without
  // value.)
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
