/**
 * Apple Photos extension entry point.
 *
 * Decision NIM-1: PhotoKit Swift helper + local Core ML embeddings.
 * Plan: nimbalyst-local/plans/apple-photos-extension.md.
 * Phase 1 only — UI runs against MockPhotosProvider.
 */

import { PhotosBrowserPanel } from './panel/PhotosBrowserPanel';
import { PhotoQueryEditor } from './editor/PhotoQueryEditor';
import { PhotosSettings } from './settings/PhotosSettings';
import { aiTools as photoAiTools } from './tools/index';

export async function activate() {
  console.log('[Apple Photos] activated (Phase 1 — mock provider)');
}

export async function deactivate() {
  console.log('[Apple Photos] deactivated');
}

export const components = {
  PhotoQueryEditor,
};

export const panels = {
  'photos-browser': {
    component: PhotosBrowserPanel,
  },
};

export const settingsPanel = {
  PhotosSettings,
};

export const aiTools = photoAiTools;
