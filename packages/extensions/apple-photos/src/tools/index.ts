/**
 * AI tools exposed by the Apple Photos extension.
 *
 * Phase 1 wires these against the Mock provider. They keep the same
 * signatures once Phase 3 swaps in the native helper.
 */

import {
  extensionStore,
  filtersAtom,
  getCurrentAlbums,
  getCurrentAssets,
  getProvider,
  getSelectedAssets,
} from '../state';
import type { PhotoAsset } from '../data/PhotosProvider';

function summarize(asset: PhotoAsset) {
  return {
    id: asset.id,
    filename: asset.filename,
    mediaType: asset.mediaType,
    creationDate: asset.creationDate,
    isFavorite: asset.isFavorite,
    pixelWidth: asset.pixelWidth,
    pixelHeight: asset.pixelHeight,
    placeName: asset.location?.placeName ?? null,
    albumIds: asset.albumIds,
    keywords: asset.keywords,
    caption: asset.caption ?? null,
    isInICloud: asset.isInICloud,
  };
}

export const aiTools = [
  {
    name: 'apple_photos.list_recent',
    description:
      'List the most recently captured photos in the Apple Photos library. Returns metadata only (no pixel data). Use this when the user asks "what did I take recently" or to seed a conversation about their library.',
    parameters: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'How many recent photos to return (default 20, max 200).' },
        favoritesOnly: { type: 'boolean', description: 'Only return photos the user has favorited.' },
      },
    },
    handler: async (args: { limit?: number; favoritesOnly?: boolean }) => {
      const provider = getProvider();
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 200);
      const assets = await provider.listAssets({ limit, favoritesOnly: args.favoritesOnly });
      return {
        success: true,
        data: {
          provider: provider.kind,
          count: assets.length,
          assets: assets.map(summarize),
        },
      };
    },
  },

  {
    name: 'apple_photos.search',
    description:
      'Search the photo library by natural-language query. Phase 1 uses keyword / place matching; Phase 5 swaps in CLIP-embedding similarity.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural-language search query.' },
        limit: { type: 'number', description: 'Max number of results (default 30).' },
      },
      required: ['query'],
    },
    handler: async (args: { query: string; limit?: number }) => {
      const provider = getProvider();
      const limit = Math.min(Math.max(args.limit ?? 30, 1), 200);
      const assets = await provider.search({ query: args.query, limit });
      // Reflect the query in the panel so the user sees what the AI looked at.
      extensionStore.set(filtersAtom, { ...extensionStore.get(filtersAtom), query: args.query });
      return {
        success: true,
        data: {
          provider: provider.kind,
          query: args.query,
          count: assets.length,
          assets: assets.map(summarize),
        },
      };
    },
  },

  {
    name: 'apple_photos.get_selection',
    description:
      'Return the photos the user has currently selected in the Photos browser panel. Use this before suggesting a batch action like "caption these" or "build a story from these."',
    parameters: { type: 'object' as const, properties: {} },
    handler: async () => {
      const selected = getSelectedAssets();
      if (selected.length === 0) {
        return {
          success: false,
          error: 'No photos selected. Ask the user to select some photos in the Photos panel first.',
        };
      }
      return {
        success: true,
        data: {
          count: selected.length,
          assets: selected.map(summarize),
        },
      };
    },
  },

  {
    name: 'apple_photos.list_albums',
    description: 'List all albums (user-made and smart) in the photo library.',
    parameters: { type: 'object' as const, properties: {} },
    handler: async () => {
      const albums = getCurrentAlbums();
      // Fall back to provider if the panel hasn't loaded yet.
      const resolved = albums.length > 0 ? albums : await getProvider().listAlbums();
      return {
        success: true,
        data: {
          count: resolved.length,
          albums: resolved,
          inMemoryAssetSample: getCurrentAssets().length,
        },
      };
    },
  },
];
