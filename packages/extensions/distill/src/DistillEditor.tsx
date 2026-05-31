import React, { useRef } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';
import { useEditorLifecycle } from '@nimbalyst/extension-sdk';
import { DistillSurface } from './DistillSurface';

export function DistillEditor({ host }: EditorHostProps): JSX.Element {
  const contentRef = useRef<string>('Distill');

  const { isLoading } = useEditorLifecycle(host, {
    applyContent: (raw: string) => {
      contentRef.current = raw;
    },
    getCurrentContent: () => contentRef.current,
    parse: (raw) => raw,
    serialize: (data) => data,
  });

  if (isLoading) {
    return <DistillSurface small label="Loading Distill..." />;
  }

  return <DistillSurface />;
}
