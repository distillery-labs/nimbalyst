import { describe, it, expect } from 'vitest';
import { composePromptWithScriptOutput } from '../AutomationScheduler';

describe('composePromptWithScriptOutput', () => {
  it('substitutes {{script_output}} when the token is present', () => {
    const result = composePromptWithScriptOutput(
      'Summarize this:\n\n{{script_output}}\n\nIn one paragraph.',
      'Item A\nItem B',
    );
    expect(result).toBe('Summarize this:\n\nItem A\nItem B\n\nIn one paragraph.');
  });

  it('replaces every occurrence of the token', () => {
    const result = composePromptWithScriptOutput(
      '{{script_output}}\n---\n{{script_output}}',
      'X',
    );
    expect(result).toBe('X\n---\nX');
  });

  it('appends under a heading when token is absent and payload is non-empty', () => {
    const result = composePromptWithScriptOutput('Do the thing.', 'payload-data');
    expect(result).toBe('Do the thing.\n\n## Script Output\n\npayload-data');
  });

  it('returns the prompt unchanged when payload is empty/whitespace and token absent', () => {
    expect(composePromptWithScriptOutput('Body', '')).toBe('Body');
    expect(composePromptWithScriptOutput('Body', '   \n  ')).toBe('Body');
  });

  it('still substitutes an empty payload when the token is present (author explicit)', () => {
    const result = composePromptWithScriptOutput('Pre {{script_output}} Post', '');
    expect(result).toBe('Pre  Post');
  });
});
