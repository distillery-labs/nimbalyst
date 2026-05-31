/**
 * Photos Browser Panel — sidebar panel that shows a thumbnail grid of the
 * macOS Photos library and an AI-aware search/filter row.
 *
 * Phase 1 reads from MockPhotosProvider. Phase 3 swaps in the native
 * provider with no UI changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { useAtom } from 'jotai';
import {
  albumsAtom,
  assetsAtom,
  extensionStore,
  filtersAtom,
  isLoadingAtom,
  lastErrorAtom,
  providerAtom,
  selectedAssetIdsAtom,
} from '../state';
import { AppleScriptPhotosProvider, runJXA } from '../data/AppleScriptPhotosProvider';
import { MockPhotosProvider } from '../data/MockPhotosProvider';
import type { PhotoAsset } from '../data/PhotosProvider';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PhotosBrowserPanel({ host }: PanelHostProps) {
  // Do NOT install the real provider on mount. The first osascript call
  // triggers a macOS Automation prompt that has hung Nimbalyst's renderer
  // in past sessions (likely a TCC/Electron interaction). Stay on the mock
  // provider until the user explicitly clicks "Connect" so the channel is
  // only exercised by deliberate action.
  // Destructure ALL atoms first — `connect` below captures setLastError in
  // its useCallback dep list, so any declaration order that puts the atom
  // reads after the callback hits a const-in-TDZ at minified runtime.
  const [provider, setProvider] = useAtom(providerAtom, { store: extensionStore });
  const [assets, setAssets] = useAtom(assetsAtom, { store: extensionStore });
  const [albums, setAlbums] = useAtom(albumsAtom, { store: extensionStore });
  const [filters, setFilters] = useAtom(filtersAtom, { store: extensionStore });
  const [selected, setSelected] = useAtom(selectedAssetIdsAtom, { store: extensionStore });
  const [isLoading, setIsLoading] = useAtom(isLoadingAtom, { store: extensionStore });
  const [lastError, setLastError] = useAtom(lastErrorAtom, { store: extensionStore });
  const [previewAsset, setPreviewAsset] = useState<PhotoAsset | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    setLastError(null);
    // Clear stale mock data so the user sees an honest "Loading…" /
    // "No photos" state during the swap, not leftover gradient placeholders.
    setAssets([]);
    setAlbums([]);
    try {
      // Probe via runJXA against a trivial script. This proves the entire
      // pipeline (temp-file write, osascript -l JavaScript, JSON parse,
      // wrapper try/catch) works before we promote the provider. If JXA via
      // host.exec is broken at the base level, this surfaces a clear error
      // instead of letting listAssets fail mysteriously moments later.
      const probe = await runJXA<{ jxa: string; photosVersion: string }>(
        { exec: host.exec.bind(host) },
        `JSON.stringify({ jxa: "ok", photosVersion: Application("Photos").version() })`,
        15_000,
      );
      console.log(
        `[apple-photos] JXA pipeline ok; Photos.app version ${probe.photosVersion}`,
      );
      setProvider(new AppleScriptPhotosProvider(host));
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, [host, setProvider, setLastError, setAssets, setAlbums]);

  const disconnect = useCallback(() => {
    setAssets([]);
    setAlbums([]);
    setProvider(new MockPhotosProvider());
  }, [setProvider, setAssets, setAlbums]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLastError(null);
    // Run assets and albums independently so one failure doesn't void the
    // other. Surface every failure as a single combined error message.
    const [assetsResult, albumsResult] = await Promise.allSettled([
      filters.query.trim()
        ? provider.search({
            query: filters.query,
            favoritesOnly: filters.favoritesOnly,
            albumId: filters.albumId ?? undefined,
          })
        : provider.listAssets({
            favoritesOnly: filters.favoritesOnly,
            albumId: filters.albumId ?? undefined,
          }),
      provider.listAlbums(),
    ]);
    if (assetsResult.status === 'fulfilled') setAssets(assetsResult.value);
    if (albumsResult.status === 'fulfilled') setAlbums(albumsResult.value);

    const errs: string[] = [];
    if (assetsResult.status === 'rejected') {
      errs.push(`listAssets: ${assetsResult.reason instanceof Error ? assetsResult.reason.message : String(assetsResult.reason)}`);
    }
    if (albumsResult.status === 'rejected') {
      errs.push(`listAlbums: ${albumsResult.reason instanceof Error ? albumsResult.reason.message : String(albumsResult.reason)}`);
    }
    if (errs.length > 0) setLastError(errs.join(' • '));
    setIsLoading(false);
  }, [provider, filters, setAssets, setAlbums, setIsLoading, setLastError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Tell the agent what the user is currently looking at so chat is grounded.
  useEffect(() => {
    host.ai?.setContext({
      providerKind: provider.kind,
      query: filters.query,
      favoritesOnly: filters.favoritesOnly,
      activeAlbumId: filters.albumId,
      visibleAssetCount: assets.length,
      selectedAssetCount: selected.size,
      selectedAssetIds: Array.from(selected),
    });
  }, [host.ai, provider.kind, filters, assets.length, selected]);

  const toggleSelected = useCallback(
    (id: string) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setSelected],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), [setSelected]);

  const selectedAssets = useMemo(
    () => assets.filter((a) => selected.has(a.id)),
    [assets, selected],
  );

  return (
    <div
      className="apple-photos-panel"
      data-extension-id="com.nimbalyst.apple-photos"
      data-panel="photos-browser"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: 'var(--nim-bg-primary, #fff)',
        color: 'var(--nim-text-primary, #111)',
      }}
    >
      <header
        className="apple-photos-panel-header"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 12,
          borderBottom: '1px solid var(--nim-border, rgba(0,0,0,0.08))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>photo_library</span>
          <strong style={{ fontSize: 13 }}>Photos</strong>
          <span
            className="apple-photos-provider-badge"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              backgroundColor: provider.kind === 'apple-photos' ? '#d3f9d8' : '#ffe066',
              color: '#222',
            }}
            title={
              provider.kind === 'apple-photos'
                ? 'Connected to your Photos library via Photos.app'
                : 'Showing mock data — click Connect to use your real library'
            }
          >
            {provider.kind === 'apple-photos' ? 'Library connected' : 'Mock data'}
          </span>
          <button
            type="button"
            onClick={provider.kind === 'apple-photos' ? disconnect : connect}
            disabled={connecting}
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid currentColor',
              backgroundColor: 'transparent',
              color: 'inherit',
              cursor: connecting ? 'wait' : 'pointer',
              opacity: connecting ? 0.6 : 1,
            }}
            title={
              provider.kind === 'apple-photos'
                ? 'Disconnect and revert to mock data'
                : 'Triggers a macOS Automation prompt. If Nimbalyst becomes unresponsive, force-quit and try again — this is a known TCC/Electron interaction.'
            }
          >
            {connecting
              ? 'Connecting...'
              : provider.kind === 'apple-photos'
                ? 'Disconnect'
                : 'Connect'}
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--nim-text-muted, #666)' }}>
            {assets.length} item{assets.length === 1 ? '' : 's'}
          </span>
        </div>

        <input
          className="apple-photos-search"
          type="search"
          placeholder='Search your library — try "sunsets at the beach"'
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          style={{
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid var(--nim-border, rgba(0,0,0,0.12))',
            backgroundColor: 'var(--nim-bg-secondary, #f4f4f4)',
            color: 'inherit',
          }}
        />

        <div className="apple-photos-filter-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filters.favoritesOnly}
              onChange={(e) => setFilters({ ...filters, favoritesOnly: e.target.checked })}
            />
            Favorites only
          </label>

          <select
            value={filters.albumId ?? ''}
            onChange={(e) => setFilters({ ...filters, albumId: e.target.value || null })}
            style={{
              fontSize: 11,
              padding: '2px 4px',
              borderRadius: 4,
              border: '1px solid var(--nim-border, rgba(0,0,0,0.12))',
              backgroundColor: 'var(--nim-bg-secondary, #f4f4f4)',
              color: 'inherit',
            }}
          >
            <option value="">All photos</option>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.assetCount})
              </option>
            ))}
          </select>

          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid var(--nim-border, rgba(0,0,0,0.12))',
                backgroundColor: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Clear selection ({selected.size})
            </button>
          )}
        </div>
      </header>

      {lastError && (
        <div
          className="apple-photos-error"
          style={{ padding: 8, fontSize: 11, color: '#c92a2a', backgroundColor: '#fff5f5' }}
        >
          {lastError}
        </div>
      )}

      <div
        className="apple-photos-grid"
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
          gap: 4,
          padding: 8,
        }}
      >
        {isLoading && assets.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 40,
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--nim-text-muted, #666)',
            }}
          >
            Loading…
          </div>
        ) : assets.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: 40,
              textAlign: 'center',
              fontSize: 12,
              color: 'var(--nim-text-muted, #666)',
            }}
          >
            No photos match your filters.
          </div>
        ) : (
          assets.map((asset) => {
            const isSelected = selected.has(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                className="apple-photos-thumb"
                onClick={(e) => {
                  if (e.metaKey || e.shiftKey) toggleSelected(asset.id);
                  else setPreviewAsset(asset);
                }}
                onDoubleClick={() => toggleSelected(asset.id)}
                title={`${asset.filename} — ${formatDate(asset.creationDate)}`}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  padding: 0,
                  border: isSelected
                    ? '2px solid var(--nim-accent, #1971c2)'
                    : '2px solid transparent',
                  borderRadius: 6,
                  overflow: 'hidden',
                  backgroundColor: '#000',
                  cursor: 'pointer',
                }}
              >
                <img
                  src={asset.thumbnailDataUrl}
                  alt={asset.filename}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {asset.isFavorite && (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      fontSize: 14,
                      color: '#fff',
                      textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                    }}
                  >
                    favorite
                  </span>
                )}
                {asset.mediaType === 'video' && (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      fontSize: 14,
                      color: '#fff',
                      textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                    }}
                  >
                    play_circle
                  </span>
                )}
                {asset.isInICloud && (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      fontSize: 14,
                      color: '#fff',
                      textShadow: '0 1px 2px rgba(0,0,0,0.6)',
                    }}
                  >
                    cloud
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {previewAsset && (
        <PhotoPreview
          asset={previewAsset}
          isSelected={selected.has(previewAsset.id)}
          onClose={() => setPreviewAsset(null)}
          onToggleSelect={() => toggleSelected(previewAsset.id)}
        />
      )}

      {selectedAssets.length > 0 && (
        <div
          className="apple-photos-selection-bar"
          style={{
            padding: 8,
            borderTop: '1px solid var(--nim-border, rgba(0,0,0,0.08))',
            fontSize: 11,
            color: 'var(--nim-text-muted, #666)',
          }}
        >
          Ask the AI to caption, group, or build a story from {selectedAssets.length} selected photo
          {selectedAssets.length === 1 ? '' : 's'}.
        </div>
      )}
    </div>
  );
}

interface PhotoPreviewProps {
  asset: PhotoAsset;
  isSelected: boolean;
  onClose: () => void;
  onToggleSelect: () => void;
}

function PhotoPreview({ asset, isSelected, onClose, onToggleSelect }: PhotoPreviewProps) {
  return (
    <div
      className="apple-photos-preview"
      role="dialog"
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <img
          src={asset.thumbnailDataUrl}
          alt={asset.filename}
          style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 6, boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}
        />
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 12,
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: '#fff',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span>{asset.filename}</span>
        <span style={{ color: 'rgba(255,255,255,0.7)' }}>{formatDate(asset.creationDate)}</span>
        {asset.location?.placeName && (
          <span style={{ color: 'rgba(255,255,255,0.7)' }}>· {asset.location.placeName}</span>
        )}
        {asset.caption && <em style={{ color: 'rgba(255,255,255,0.9)' }}>"{asset.caption}"</em>}
        <button
          type="button"
          onClick={onToggleSelect}
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: isSelected ? '#1971c2' : '#fff',
            color: isSelected ? '#fff' : '#111',
            cursor: 'pointer',
          }}
        >
          {isSelected ? 'Deselect' : 'Select'}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.3)',
            backgroundColor: 'transparent',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
