import React, { useEffect } from 'react';
import {
  clearTranscriptMarkdownContributions,
  setTranscriptMarkdownContributions,
} from '@nimbalyst/runtime';

const SOURCE = 'com.nimbalyst.distill';

function DistillCodeBlock(props: { className?: string; children?: React.ReactNode }): JSX.Element {
  const lang = (props.className ?? '').match(/language-(\w+)/)?.[1];
  if (lang === 'distill') {
    return <span className="distill-transcript-block">Distill</span>;
  }
  return <code className={props.className}>{props.children}</code>;
}

export function TranscriptDistillHost(): null {
  useEffect(() => {
    setTranscriptMarkdownContributions(SOURCE, {
      components: {
        code: DistillCodeBlock as React.ComponentType<unknown>,
      },
    });
    return () => {
      clearTranscriptMarkdownContributions(SOURCE);
    };
  }, []);
  return null;
}
