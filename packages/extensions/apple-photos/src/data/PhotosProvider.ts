/**
 * Provider contract for the Photos library.
 *
 * Phase 1 ships a Mock implementation so the UI is buildable before the
 * Swift helper exists. Phase 3 swaps in a Native implementation that
 * spawns `apple-photos-helper` and parses its JSON / streams its bytes.
 *
 * Implementations MUST be safe to call from the renderer (the Native one
 * proxies through the extension's main-process bridge).
 */

export type PhotoMediaType = 'photo' | 'video' | 'live';

export interface PhotoLocation {
  latitude: number;
  longitude: number;
  placeName?: string;
}

export interface PhotoAsset {
  /** PHAsset.localIdentifier (UUID/<flag>) on real impls, synthetic on mock. */
  id: string;
  filename: string;
  mediaType: PhotoMediaType;
  /** ISO-8601 creation date. */
  creationDate: string;
  /** ISO-8601 modification date. */
  modificationDate: string;
  isFavorite: boolean;
  pixelWidth: number;
  pixelHeight: number;
  location?: PhotoLocation;
  albumIds: string[];
  keywords: string[];
  caption?: string;
  /**
   * Small thumbnail. data: URL so the renderer can drop it straight into
   * <img src>. Real provider returns ~256px JPEGs; mock returns SVGs.
   */
  thumbnailDataUrl: string;
  /** True if the original isn't downloaded locally (iCloud-only). */
  isInICloud: boolean;
}

export interface PhotoAlbum {
  id: string;
  name: string;
  assetCount: number;
  isSmartAlbum: boolean;
  /** True if this album was created by this extension. */
  isManaged: boolean;
}

export interface ListAssetsOptions {
  limit?: number;
  offset?: number;
  favoritesOnly?: boolean;
  albumId?: string;
  /** Inclusive lower bound, ISO-8601. */
  since?: string;
  /** Inclusive upper bound, ISO-8601. */
  until?: string;
}

export interface SearchOptions extends ListAssetsOptions {
  /** Free-text query. Provider decides whether this hits embeddings or keywords. */
  query: string;
}

/**
 * Stable interface across mock + native providers.
 *
 * Write methods (addKeyword, setCaption, createAlbum, addToAlbum) are
 * no-ops on the Mock provider and only do real work once the Swift
 * helper is wired in Phase 3.
 */
/**
 * Stable identifier for a provider implementation.
 *
 * Open-ended so future providers (google-photos, folder, sftp, …) slot in
 * without breaking the type. The string is also surfaced to AI tools so the
 * agent can reason about which backend it's talking to.
 */
export type PhotoProviderKind = 'mock' | 'apple-photos' | 'google-photos' | 'folder' | (string & {});

export interface PhotosProvider {
  readonly kind: PhotoProviderKind;

  listAssets(options?: ListAssetsOptions): Promise<PhotoAsset[]>;
  listAlbums(): Promise<PhotoAlbum[]>;
  search(options: SearchOptions): Promise<PhotoAsset[]>;
  getAsset(id: string): Promise<PhotoAsset | null>;

  addKeyword(assetId: string, keyword: string): Promise<void>;
  setCaption(assetId: string, caption: string): Promise<void>;
  createAlbum(name: string): Promise<PhotoAlbum>;
  addToAlbum(albumId: string, assetIds: string[]): Promise<void>;
}
