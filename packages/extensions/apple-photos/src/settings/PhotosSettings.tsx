/**
 * Settings panel for the Apple Photos extension.
 *
 * Phase 1: shows the current provider and a "Connect" button stub.
 * Phase 3: the Connect button triggers the Swift helper to ask the OS
 * for Photos access and then swaps the provider over.
 */

import type { SettingsPanelProps } from '@nimbalyst/extension-sdk';
import { useAtomValue } from 'jotai';
import { extensionStore, providerAtom } from '../state';

export function PhotosSettings(_props: SettingsPanelProps) {
  const provider = useAtomValue(providerAtom, { store: extensionStore });

  return (
    <div
      className="apple-photos-settings"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 560,
        color: 'var(--nim-text-primary, #111)',
      }}
    >
      <header>
        <h2 style={{ margin: 0, fontSize: 18 }}>Apple Photos</h2>
        <p style={{ marginTop: 4, fontSize: 12, color: 'var(--nim-text-muted, #666)' }}>
          Connect Nimbalyst to your macOS Photos library so the panel and the AI tools see real
          photos. Your library never leaves your Mac unless you click an AI action that obviously
          needs to.
        </p>
      </header>

      <section
        style={{
          padding: 16,
          borderRadius: 8,
          border: '1px solid var(--nim-border, rgba(0,0,0,0.08))',
          backgroundColor: 'var(--nim-bg-secondary, #f7f7f7)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 13 }}>Library connection</strong>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              backgroundColor: provider.kind === 'native' ? '#d3f9d8' : '#ffe066',
              color: '#222',
            }}
          >
            {provider.kind === 'native' ? 'Connected' : 'Mock data'}
          </span>
        </div>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--nim-text-muted, #666)' }}>
          {provider.kind === 'native'
            ? 'Connected via the apple-photos-helper. Disconnect to switch back to mock data.'
            : 'Currently showing mock data so you can preview the UI. Connecting will launch a small signed helper that asks macOS for Photos access.'}
        </p>
        <button
          type="button"
          disabled
          title="Coming in Phase 3 — Swift helper not yet built"
          style={{
            marginTop: 8,
            padding: '6px 12px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: 'var(--nim-accent, #1971c2)',
            color: '#fff',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        >
          Connect to Photos (coming soon)
        </button>
      </section>

      <section
        style={{
          padding: 16,
          borderRadius: 8,
          border: '1px solid var(--nim-border, rgba(0,0,0,0.08))',
        }}
      >
        <strong style={{ fontSize: 13 }}>Indexing</strong>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--nim-text-muted, #666)' }}>
          Natural-language search needs a one-time pass that generates a CLIP embedding for each
          photo locally on your Mac. Nothing is uploaded. The index lives in Nimbalyst's PGLite
          database. You'll be able to start the index from here after Phase 4 lands.
        </p>
        <button
          type="button"
          disabled
          style={{
            marginTop: 8,
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid var(--nim-border, rgba(0,0,0,0.12))',
            backgroundColor: 'transparent',
            color: 'inherit',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.6,
          }}
        >
          Index library (coming soon)
        </button>
      </section>
    </div>
  );
}
