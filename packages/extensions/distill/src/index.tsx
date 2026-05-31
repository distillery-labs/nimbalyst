/**
 * Distill extension entry.
 *
 * Capability exercise: surfaces the word "Distill" in every UI hook the
 * Nimbalyst extension SDK exposes. No real functionality.
 */

import './styles.css';

import type {
  AIToolContext,
  ExtensionAITool,
  ExtensionToolResult,
} from '@nimbalyst/extension-sdk';
import { setExtensionContributions } from '@nimbalyst/runtime';

import { DistillEditor } from './DistillEditor';
import { DistillHeader } from './DistillHeader';
import {
  DistillBottomPanel,
  DistillFloatingPanel,
  DistillFullscreenPanel,
  DistillSidebarPanel,
} from './DistillPanels';
import { DistillSettings } from './DistillSettings';
import { DistillBadge } from './DistillBadge';
import { TranscriptDistillHost } from './TranscriptDistillHost';
import { DISTILL_NOOP_COMMAND, DistillLexicalExtension } from './lexical';

const EXTENSION_ID = 'com.nimbalyst.distill';

export async function activate(): Promise<void> {
  // Register a "Distill" entry in the markdown editor's slash menu.
  setExtensionContributions(EXTENSION_ID, {
    userCommands: [
      {
        title: 'Distill',
        description: 'Inserts the literal word "Distill" at the cursor',
        icon: 'science',
        keywords: ['distill', 'demo'],
        command: DISTILL_NOOP_COMMAND,
      },
    ],
  });
  console.log('[Distill] activated');
}

export async function deactivate(): Promise<void> {
  console.log('[Distill] deactivated');
}

// Custom editor + document header components
export const components = {
  DistillEditor,
  DistillHeader,
};

// Panel exports - keys match `panels[].id` in manifest.json
export const panels = {
  'distill-sidebar': { component: DistillSidebarPanel },
  'distill-bottom': { component: DistillBottomPanel },
  'distill-fullscreen': { component: DistillFullscreenPanel },
  'distill-floating': { component: DistillFloatingPanel },
};

// Settings panel component - key matches manifest `settingsPanel.component`
export const settingsPanel = {
  DistillSettings,
};

// Host components mounted at app level by the host - keys match
// `contributions.hostComponents` strings in manifest.json
export const hostComponents = {
  DistillBadge,
  TranscriptDistillHost,
};

// Declarative Lexical extension - key matches `contributions.lexicalExtensions`
export const lexicalExtensions = {
  DistillLexicalExtension,
};

// Slash command handler - key matches `slashCommands[].handler` in manifest
export const slashCommandHandlers = {
  insertDistill: () => {
    // Demo placeholder. The slash entry exists so we can see it; the
    // handler does nothing visible because we ship no Lexical insertion
    // command of our own.
    console.log('[Distill] insertDistill handler invoked');
  },
};

// AI tool - name matches `contributions.aiTools` entry in manifest
const distillEchoTool: ExtensionAITool = {
  name: 'distill.echo',
  description:
    'Distill demo tool. Returns the literal string "Distill", optionally prefixed by the caller-supplied message.',
  scope: 'global',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'Optional message to prefix before "Distill"',
      },
    },
  },
  handler: async (
    args: Record<string, unknown>,
    _context: AIToolContext,
  ): Promise<ExtensionToolResult> => {
    const message = typeof args.message === 'string' ? args.message : '';
    const out = message ? `${message} Distill` : 'Distill';
    return {
      success: true,
      message: out,
      data: { distill: out },
    };
  },
};

export const aiTools = [distillEchoTool];
