import React from 'react';
import type { SettingsPanelProps } from '@nimbalyst/extension-sdk';

export function DistillSettings(_props: SettingsPanelProps): JSX.Element {
  return (
    <div className="distill-settings">
      <h2>Distill</h2>
      <p>
        This extension is a capability-exercise demo. Every UI hook the Nimbalyst extension SDK
        exposes is wired up to show the word <strong>Distill</strong>.
      </p>
      <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>
        There is nothing to configure on this Settings panel - this entry itself is the demo for
        the <code>settingsPanel</code> contribution.
      </p>
    </div>
  );
}
