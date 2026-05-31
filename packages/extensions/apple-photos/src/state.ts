/**
 * Shared Jotai store for the Apple Photos extension.
 *
 * Used by the browser panel, the .photoquery editor, and the AI tool
 * handlers so they see the same selection, filters, and recent results.
 * (Per docs/EXTENSION_PANELS.md "Shared state pattern".)
 */

import { atom, createStore } from 'jotai';
import { MockPhotosProvider } from './data/MockPhotosProvider';
import type { PhotoAlbum, PhotoAsset, PhotosProvider } from './data/PhotosProvider';

export const extensionStore = createStore();

/**
 * The provider is Mock for Phase 1. Phase 3 will swap this for the
 * Native one. Keep this atom so tests / settings can hot-swap it.
 */
export const providerAtom = atom<PhotosProvider>(new MockPhotosProvider());

export const assetsAtom = atom<PhotoAsset[]>([]);
export const albumsAtom = atom<PhotoAlbum[]>([]);

export const selectedAssetIdsAtom = atom<Set<string>>(new Set<string>());

export interface BrowserFilters {
  query: string;
  favoritesOnly: boolean;
  albumId: string | null;
}

export const filtersAtom = atom<BrowserFilters>({
  query: '',
  favoritesOnly: false,
  albumId: null,
});

export const lastErrorAtom = atom<string | null>(null);
export const isLoadingAtom = atom<boolean>(false);

// --- helpers exposed to AI tool handlers ---

export function getProvider(): PhotosProvider {
  return extensionStore.get(providerAtom);
}

export function getCurrentAssets(): PhotoAsset[] {
  return extensionStore.get(assetsAtom);
}

export function getSelectedAssets(): PhotoAsset[] {
  const ids = extensionStore.get(selectedAssetIdsAtom);
  return extensionStore.get(assetsAtom).filter((a) => ids.has(a.id));
}

export function getCurrentAlbums(): PhotoAlbum[] {
  return extensionStore.get(albumsAtom);
}
