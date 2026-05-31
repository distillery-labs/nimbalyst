/**
 * Custom editor for .photoquery files — saved AI/keyword searches against
 * the Photos library. Phase 1 just renders + edits the JSON definition
 * and previews matching mock photos. Phase 8 will add "Materialize as
 * Photos album" that creates a real PHAssetCollection.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useEditorLifecycle, type EditorHostProps } from '@nimbalyst/extension-sdk';
import { extensionStore, providerAtom } from '../state';
import type { PhotoAsset } from '../data/PhotosProvider';

interface PhotoQueryDoc {
  version: 1;
  name: string;
  query: string;
  filters: {
    favoritesOnly: boolean;
    dateRange: { since?: string; until?: string } | null;
    albums: string[];
  };
  materializedAlbumId: string | null;
}

const DEFAULT_DOC: PhotoQueryDoc = {
  version: 1,
  name: 'New smart query',
  query: '',
  filters: { favoritesOnly: false, dateRange: null, albums: [] },
  materializedAlbumId: null,
};

function parseDoc(raw: string): PhotoQueryDoc {
  if (!raw.trim()) return { ...DEFAULT_DOC };
  try {
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_DOC,
      ...parsed,
      filters: { ...DEFAULT_DOC.filters, ...(parsed.filters ?? {}) },
    };
  } catch {
    return { ...DEFAULT_DOC };
  }
}

function serializeDoc(doc: PhotoQueryDoc): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export function PhotoQueryEditor({ host }: EditorHostProps) {
  const provider = useAtomValue(providerAtom, { store: extensionStore });
  const [doc, setDoc] = useState<PhotoQueryDoc>(DEFAULT_DOC);
  const [preview, setPreview] = useState<PhotoAsset[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const { isLoading, error } = useEditorLifecycle<PhotoQueryDoc>(host, {
    parse: parseDoc,
    serialize: serializeDoc,
    applyContent: (parsed) => setDoc(parsed),
    getCurrentContent: () => doc,
  });

  const runPreview = useCallback(
    async (current: PhotoQueryDoc) => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const results = current.query.trim()
          ? await provider.search({
              query: current.query,
              favoritesOnly: current.filters.favoritesOnly,
              limit: 40,
            })
          : await provider.listAssets({
              favoritesOnly: current.filters.favoritesOnly,
              limit: 40,
            });
        setPreview(results);
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewLoading(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    void runPreview(doc);
  }, [doc, runPreview]);

  const updateDoc = useCallback(
    (mutator: (current: PhotoQueryDoc) => PhotoQueryDoc) => {
      setDoc((current) => {
        const next = mutator(current);
        host.setDirty(true);
        return next;
      });
    },
    [host],
  );

  if (isLoading) {
    return <div style={{ padding: 24, fontSize: 12 }}>Loading query…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, fontSize: 12, color: '#c92a2a' }}>Failed to load: {error.message}</div>;
  }

  return (
    <div
      className="apple-photos-query-editor"
      data-extension-id="com.nimbalyst.apple-photos"
      data-editor="photo-query"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--nim-bg-primary, #fff)',
        color: 'var(--nim-text-primary, #111)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: 16,
          borderBottom: '1px solid var(--nim-border, rgba(0,0,0,0.08))',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <input
          className="apple-photos-query-name"
          value={doc.name}
          onChange={(e) => updateDoc((d) => ({ ...d, name: e.target.value }))}
          placeholder="Smart query name"
          style={{
            fontSize: 18,
            fontWeight: 600,
            border: 'none',
            outline: 'none',
            padding: 0,
            backgroundColor: 'transparent',
            color: 'inherit',
          }}
        />
        <input
          className="apple-photos-query-text"
          value={doc.query}
          onChange={(e) => updateDoc((d) => ({ ...d, query: e.target.value }))}
          placeholder='Natural-language query — e.g. "sunsets at the beach"'
          style={{
            fontSize: 14,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--nim-border, rgba(0,0,0,0.12))',
            backgroundColor: 'var(--nim-bg-secondary, #f4f4f4)',
            color: 'inherit',
          }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={doc.filters.favoritesOnly}
            onChange={(e) =>
              updateDoc((d) => ({ ...d, filters: { ...d.filters, favoritesOnly: e.target.checked } }))
            }
          />
          Favorites only
        </label>
        <div style={{ fontSize: 11, color: 'var(--nim-text-muted, #666)' }}>
          {doc.materializedAlbumId
            ? `Mirroring to Photos album: ${doc.materializedAlbumId}`
            : 'Not yet materialized to a Photos album. (Phase 8.)'}
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <strong style={{ fontSize: 13 }}>Preview</strong>
          <span style={{ fontSize: 11, color: 'var(--nim-text-muted, #666)' }}>
            {previewLoading ? 'searching…' : `${preview.length} match${preview.length === 1 ? '' : 'es'}`}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 4,
              backgroundColor: provider.kind === 'native' ? '#d3f9d8' : '#ffe066',
              color: '#222',
              marginLeft: 'auto',
            }}
          >
            {provider.kind === 'native' ? 'Live library' : 'Mock data'}
          </span>
        </div>

        {previewError && (
          <div style={{ fontSize: 11, color: '#c92a2a', marginBottom: 8 }}>{previewError}</div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 6,
          }}
        >
          {preview.map((asset) => (
            <img
              key={asset.id}
              src={asset.thumbnailDataUrl}
              alt={asset.filename}
              title={`${asset.filename} — ${new Date(asset.creationDate).toLocaleDateString()}`}
              style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 4 }}
            />
          ))}
          {!previewLoading && preview.length === 0 && (
            <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--nim-text-muted, #666)' }}>
              No photos match this query yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
