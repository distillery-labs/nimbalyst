import React from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { DistillSurface } from './DistillSurface';

export function DistillSidebarPanel(_props: PanelHostProps): JSX.Element {
  return <DistillSurface />;
}

export function DistillBottomPanel(_props: PanelHostProps): JSX.Element {
  return <DistillSurface small />;
}

export function DistillFullscreenPanel(_props: PanelHostProps): JSX.Element {
  return <DistillSurface />;
}

export function DistillFloatingPanel({ host }: PanelHostProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        padding: '2rem 3rem',
        borderRadius: '12px',
        background: 'var(--nim-bg-secondary, #161a22)',
        border: '1px solid var(--nim-border, #2a3140)',
        color: 'var(--nim-primary, #7dd3fc)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
      }}
      onClick={() => host.close()}
    >
      <div style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '0.1em' }}>Distill</div>
      <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.5rem' }}>(click to dismiss)</div>
    </div>
  );
}
