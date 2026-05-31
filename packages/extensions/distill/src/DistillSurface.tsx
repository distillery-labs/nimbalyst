import React from 'react';

interface DistillSurfaceProps {
  small?: boolean;
  label?: string;
}

export function DistillSurface({ small = false, label = 'Distill' }: DistillSurfaceProps): JSX.Element {
  return (
    <div className={`distill-surface${small ? ' distill-surface--small' : ''}`}>
      <div className="distill-surface__label">{label}</div>
    </div>
  );
}
