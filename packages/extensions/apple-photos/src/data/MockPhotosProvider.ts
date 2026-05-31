/**
 * Phase 1 mock data so the UI is buildable before the Swift helper exists.
 *
 * Thumbnails are SVG data URLs so we don't ship any binary assets and the
 * grid still feels alive. Real provider returns actual JPEG data URLs.
 */

import type {
  ListAssetsOptions,
  PhotoAlbum,
  PhotoAsset,
  PhotosProvider,
  SearchOptions,
} from './PhotosProvider';

const PALETTES = [
  ['#ffd6a5', '#fdffb6', '#caffbf'],
  ['#a0c4ff', '#bdb2ff', '#ffc6ff'],
  ['#ff595e', '#ffca3a', '#8ac926'],
  ['#1982c4', '#6a4c93', '#ffadad'],
  ['#0d3b66', '#faf0ca', '#f4d35e'],
  ['#264653', '#2a9d8f', '#e9c46a'],
  ['#3a0ca3', '#7209b7', '#f72585'],
];

function buildSvgThumbnail(seed: number, label: string): string {
  const palette = PALETTES[seed % PALETTES.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>
    <defs>
      <linearGradient id='g${seed}' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${palette[0]}'/>
        <stop offset='50%' stop-color='${palette[1]}'/>
        <stop offset='100%' stop-color='${palette[2]}'/>
      </linearGradient>
    </defs>
    <rect width='200' height='200' fill='url(#g${seed})'/>
    <text x='100' y='105' text-anchor='middle' font-family='-apple-system, BlinkMacSystemFont, sans-serif'
          font-size='14' font-weight='600' fill='rgba(0,0,0,0.55)'>${label}</text>
  </svg>`.replace(/\s+/g, ' ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const ALBUMS: PhotoAlbum[] = [
  { id: 'album-fav', name: 'Favorites', assetCount: 14, isSmartAlbum: true, isManaged: false },
  { id: 'album-recents', name: 'Recents', assetCount: 60, isSmartAlbum: true, isManaged: false },
  { id: 'album-trip', name: 'Iceland 2024', assetCount: 22, isSmartAlbum: false, isManaged: false },
  { id: 'album-dog', name: 'Mango', assetCount: 41, isSmartAlbum: false, isManaged: false },
];

const SCENES = [
  'Beach sunset', 'Mountain trail', 'Coffee shop',
  'Family dinner', 'Hotel pool', 'Concert',
  'Hiking with Mango', 'Office window', 'Snowy street',
  'Northern lights', 'Bookstore aisle', 'Tide pool',
  'Cold brew', 'Lobby art', 'Crosswalk at night',
  'Cherry blossoms', 'Brewery patio', 'Foggy bridge',
];

function buildAsset(index: number): PhotoAsset {
  const scene = SCENES[index % SCENES.length];
  const baseDate = new Date('2024-08-01T10:00:00Z').getTime();
  const created = new Date(baseDate - index * 86400000 * 3).toISOString();
  const isFavorite = index % 5 === 0;
  const albumIds: string[] = [];
  if (isFavorite) albumIds.push('album-fav');
  if (index < 12) albumIds.push('album-recents');
  if (scene === 'Hiking with Mango') albumIds.push('album-dog');
  if (scene === 'Northern lights' || scene === 'Foggy bridge') albumIds.push('album-trip');

  return {
    id: `mock-${index.toString().padStart(4, '0')}`,
    filename: `IMG_${(4000 + index).toString()}.HEIC`,
    mediaType: index % 13 === 0 ? 'video' : index % 7 === 0 ? 'live' : 'photo',
    creationDate: created,
    modificationDate: created,
    isFavorite,
    pixelWidth: 4032,
    pixelHeight: 3024,
    location: index % 3 === 0
      ? { latitude: 64.146 + index * 0.001, longitude: -21.94 + index * 0.001, placeName: 'Reykjavík' }
      : undefined,
    albumIds,
    keywords: isFavorite ? ['favorite'] : [],
    thumbnailDataUrl: buildSvgThumbnail(index, scene),
    isInICloud: index % 11 === 0,
  };
}

const ASSETS: PhotoAsset[] = Array.from({ length: 60 }, (_, i) => buildAsset(i));

function filterAssets(assets: PhotoAsset[], opts: ListAssetsOptions | undefined): PhotoAsset[] {
  let result = assets;
  if (opts?.favoritesOnly) result = result.filter((a) => a.isFavorite);
  if (opts?.albumId) result = result.filter((a) => a.albumIds.includes(opts.albumId!));
  if (opts?.since) result = result.filter((a) => a.creationDate >= opts.since!);
  if (opts?.until) result = result.filter((a) => a.creationDate <= opts.until!);
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? result.length;
  return result.slice(offset, offset + limit);
}

export class MockPhotosProvider implements PhotosProvider {
  readonly kind = 'mock';

  async listAssets(options?: ListAssetsOptions): Promise<PhotoAsset[]> {
    return filterAssets(ASSETS, options);
  }

  async listAlbums(): Promise<PhotoAlbum[]> {
    return ALBUMS;
  }

  async search(options: SearchOptions): Promise<PhotoAsset[]> {
    const q = options.query.trim().toLowerCase();
    if (!q) return filterAssets(ASSETS, options);

    // Until the embeddings index lands in Phase 4, we fake "semantic" search
    // by substring-matching against the scene label baked into each thumbnail.
    const matches = ASSETS.filter((a) => {
      const labelMatch = decodeURIComponent(a.thumbnailDataUrl.split('>').find((s) => s.includes('</text')) ?? '')
        .toLowerCase()
        .includes(q);
      const keywordMatch = a.keywords.some((k) => k.toLowerCase().includes(q));
      const placeMatch = a.location?.placeName?.toLowerCase().includes(q) ?? false;
      return labelMatch || keywordMatch || placeMatch;
    });
    return filterAssets(matches, options);
  }

  async getAsset(id: string): Promise<PhotoAsset | null> {
    return ASSETS.find((a) => a.id === id) ?? null;
  }

  async addKeyword(assetId: string, keyword: string): Promise<void> {
    const asset = ASSETS.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    if (!asset.keywords.includes(keyword)) asset.keywords.push(keyword);
  }

  async setCaption(assetId: string, caption: string): Promise<void> {
    const asset = ASSETS.find((a) => a.id === assetId);
    if (!asset) throw new Error(`Unknown asset: ${assetId}`);
    asset.caption = caption;
  }

  async createAlbum(name: string): Promise<PhotoAlbum> {
    const album: PhotoAlbum = {
      id: `album-managed-${Date.now()}`,
      name,
      assetCount: 0,
      isSmartAlbum: false,
      isManaged: true,
    };
    ALBUMS.push(album);
    return album;
  }

  async addToAlbum(albumId: string, assetIds: string[]): Promise<void> {
    const album = ALBUMS.find((a) => a.id === albumId);
    if (!album) throw new Error(`Unknown album: ${albumId}`);
    for (const assetId of assetIds) {
      const asset = ASSETS.find((a) => a.id === assetId);
      if (asset && !asset.albumIds.includes(albumId)) {
        asset.albumIds.push(albumId);
        album.assetCount += 1;
      }
    }
  }
}
