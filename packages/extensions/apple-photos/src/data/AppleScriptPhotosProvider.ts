/**
 * AppleScript-backed PhotosProvider.
 *
 * Architecture (NIM-1 final):
 *   panel → host.exec → /usr/bin/osascript -l JavaScript → Photos.app
 *
 * Why: direct reads of ~/Pictures/Photos Library.photoslibrary/database/Photos.sqlite
 * are TCC-blocked when attributed to Nimbalyst.app on macOS Sonoma+ even with
 * Full Disk Access granted. Routing through Photos.app uses Photos's own
 * privileges; the only user-facing permission is the Automation prompt.
 *
 * JXA over AppleScript because JSON.stringify is built-in and the property
 * accessor syntax is far less error-prone than raw AppleScript records.
 *
 * v1 implements reads only. Write methods throw so callers see a clear
 * "not yet implemented" rather than silently no-oping.
 */

import type {
  ListAssetsOptions,
  PhotoAlbum,
  PhotoAsset,
  PhotosProvider,
  SearchOptions,
} from './PhotosProvider';

/** Minimal subset of PanelHost we need — keeps the provider testable. */
export interface HostExecLike {
  exec(
    command: string,
    options?: { timeout?: number },
  ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }>;
}

/**
 * POSIX-safe single-quote escape. Any embedded "'" becomes "'\''" (close,
 * escape literal, reopen). Lets us pass arbitrary JXA scripts as a single
 * shell argument without worrying about $, `, \, or " inside.
 *
 * SECURITY: this is the only barrier between caller-controlled strings and
 * the shell. Two layers of escaping protect us:
 *   1. Caller data interpolated into JXA goes through JSON.stringify (which
 *      produces a valid JS string literal inside the script).
 *   2. The whole JXA script then goes through shellSingleQuote before being
 *      passed to host.exec. Inside single quotes bash performs no expansion
 *      — `$`, backtick, backslash, double quote are all literal.
 * Do not move to template-string interpolation or printf %q; the current
 * scheme is the smallest safe path given PanelHost.exec only accepts a
 * single command string (no execFile-style argv).
 */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Photos.app asset IDs are PHAsset.localIdentifier-shaped strings:
 *   "C7C8A7AD-D444-46B5-BC3A-C5B069E4D7A3/L0/001"
 * Hex chars, dashes, slashes, digits. Belt-and-braces guard before
 * embedding into JXA so a malformed id can't break the JSON.stringify
 * contract or surprise downstream callers.
 */
function assertValidAssetId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    throw new Error('Invalid asset id');
  }
  if (!/^[A-Za-z0-9/\-]+$/.test(id)) {
    throw new Error('Invalid asset id (allowed: alphanumerics, slash, dash)');
  }
}

/**
 * Run a JXA script via osascript and parse its JSON output.
 *
 * Two layers of error capture:
 *   1. The script is wrapped in a try/catch that converts any in-JXA error
 *      into JSON `{ __jxaError, __jxaStack }`. Without this we lose the real
 *      error because PanelHost.exec surfaces only Node's "Command failed:"
 *      synthetic stderr on non-zero exit, not osascript's own stderr.
 *   2. If host.exec rejects entirely, we still try parsing stdout — JXA may
 *      have written valid JSON before something went wrong elsewhere.
 *
 * The caller still passes a script whose final expression is the result.
 * The wrapper IIFE preserves that — the original script runs as its own
 * function body, and its last expression becomes the wrapper's return.
 */
export async function runJXA<T>(host: HostExecLike, script: string, timeoutMs = 30_000): Promise<T> {
  const wrapped = `(function(){
try {
  return (function(){
${script}
  })();
} catch (e) {
  return JSON.stringify({
    __jxaError: (e && e.message) ? e.message : String(e),
    __jxaName: (e && e.name) ? e.name : null
  });
}
})()`;
  // base64-encode the whole script, write to a temp file, run osascript on
  // the FILE rather than via `-e`. This bypasses every shell quoting concern
  // and the rumored single-line restriction on `osascript -e`.  Two earlier
  // attempts hit "exit 1 with empty stdout AND empty stderr" using -e — that
  // signature only makes sense if osascript was rejecting the invocation
  // pre-execution (likely arg-parsing). Files dodge that.
  const b64 = btoa(wrapped);
  // base64 alphabet is just [A-Za-z0-9+/=]; safe to embed in single quotes
  // directly. macOS BSD base64 uses -D for decode.
  const command =
    `set -e; ` +
    `tmp=$(mktemp /tmp/nim-jxa.XXXXXX.js); ` +
    `printf '%s' '${b64}' | /usr/bin/base64 -D > "$tmp"; ` +
    `/usr/bin/osascript -l JavaScript "$tmp" 2>&1; ` +
    `rc=$?; ` +
    `rm -f "$tmp"; ` +
    `exit $rc`;
  const result = await host.exec(command, { timeout: timeoutMs });
  const stdout = result.stdout.trim();

  // Happy path first: was the output valid JSON?
  if (stdout) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined) {
      if (parsed && typeof parsed === 'object' && '__jxaError' in (parsed as Record<string, unknown>)) {
        const err = parsed as { __jxaError: string; __jxaName?: string; __jxaStack?: string };
        throw new Error(`JXA${err.__jxaName ? ` ${err.__jxaName}` : ''}: ${err.__jxaError}`);
      }
      return parsed as T;
    }
  }

  // Non-JSON output means osascript wrote a diagnostic (now visible thanks
  // to 2>&1) — pass it through verbatim so the panel error bar shows what
  // actually happened.
  const detail = stdout || result.stderr.trim() || '(no output)';
  if (!result.success) {
    throw new Error(`osascript failed (exit ${result.exitCode}): ${detail}`);
  }
  throw new Error(`osascript returned non-JSON output: ${detail.slice(0, 400)}`);
}

// Phase 1 reuses the gradient-thumbnail trick. Real thumbnails need
// `tell Photos to export {...} to file ...` per asset, which is a separate
// (slow) operation worth its own caching layer.
const THUMB_PALETTES = [
  ['#ffd6a5', '#fdffb6', '#caffbf'],
  ['#a0c4ff', '#bdb2ff', '#ffc6ff'],
  ['#ff595e', '#ffca3a', '#8ac926'],
  ['#1982c4', '#6a4c93', '#ffadad'],
  ['#0d3b66', '#faf0ca', '#f4d35e'],
  ['#264653', '#2a9d8f', '#e9c46a'],
];

function placeholderThumb(seed: number, label: string): string {
  const p = THUMB_PALETTES[Math.abs(seed) % THUMB_PALETTES.length];
  const safeLabel = label.replace(/[<>&]/g, '').slice(0, 24);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><defs><linearGradient id='g${seed}' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${p[0]}'/><stop offset='50%' stop-color='${p[1]}'/><stop offset='100%' stop-color='${p[2]}'/></linearGradient></defs><rect width='200' height='200' fill='url(#g${seed})'/><text x='100' y='180' text-anchor='middle' font-family='-apple-system, BlinkMacSystemFont, sans-serif' font-size='10' fill='rgba(0,0,0,0.55)'>${safeLabel}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface JxaAsset {
  id: string;
  name: string;
  date: string | null;
  favorite: boolean;
  width: number;
  height: number;
  description: string;
}

function jxaToAsset(item: JxaAsset, seed: number): PhotoAsset {
  const created = item.date ?? new Date(0).toISOString();
  return {
    id: item.id,
    filename: item.name || 'unknown',
    mediaType: 'photo',
    creationDate: created,
    modificationDate: created,
    isFavorite: item.favorite,
    pixelWidth: item.width || 0,
    pixelHeight: item.height || 0,
    location: undefined,
    albumIds: [],
    keywords: [],
    caption: item.description || undefined,
    thumbnailDataUrl: placeholderThumb(seed, item.name || 'photo'),
    isInICloud: false,
  };
}

export class AppleScriptPhotosProvider implements PhotosProvider {
  readonly kind = 'apple-photos';

  constructor(private readonly host: HostExecLike) {}

  async listAssets(options: ListAssetsOptions = {}): Promise<PhotoAsset[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 60, 500));
    const favoritesOnly = !!options.favoritesOnly;

    // Defensive JXA: each property is its own try/catch and any error is
    // sampled into the output so we can see what's actually failing. The
    // only required property is `id` — items without one are skipped.
    // Returns { items, totalSeen, errors } so the caller can distinguish
    // "library is empty" from "every property is throwing silently".
    const script = `
const Photos = Application('Photos');
const out = [];
const limit = ${limit};
const favoritesOnly = ${favoritesOnly ? 'true' : 'false'};
const safetyMax = 5000;
const errors = [];
function recordErr(label, e) {
  if (errors.length < 5) errors.push(label + ': ' + (e && e.message ? e.message : String(e)));
}
let i = 0;
let collected = 0;
let firstItemAccessFailed = false;
while (collected < limit && i < safetyMax) {
  let item;
  try { item = Photos.mediaItems[i]; }
  catch (e) {
    recordErr('mediaItems[' + i + ']', e);
    if (i === 0) firstItemAccessFailed = true;
    break;
  }
  let id;
  try { id = item.id(); } catch (e) { recordErr('id[' + i + ']', e); i++; continue; }
  if (!id) { i++; continue; }
  let fav = false;
  try { fav = item.favorite(); } catch (e) { recordErr('favorite[' + i + ']', e); }
  if (favoritesOnly && !fav) { i++; continue; }
  let name = '';
  try { name = item.name() || ''; } catch (e) { recordErr('name[' + i + ']', e); }
  let date = null;
  try { const d = item.date(); if (d) date = d.toISOString(); } catch (e) { recordErr('date[' + i + ']', e); }
  let desc = '';
  try { desc = item.description() || ''; } catch (e) { recordErr('description[' + i + ']', e); }
  let w = 0, h = 0;
  try { w = item.width(); } catch (e) { recordErr('width[' + i + ']', e); }
  try { h = item.height(); } catch (e) { recordErr('height[' + i + ']', e); }
  out.push({ id: id, name: name, date: date, favorite: fav, width: w, height: h, description: desc });
  collected++;
  i++;
}
let totalCount = null;
try { totalCount = Photos.mediaItems.length; } catch (e) { recordErr('length', e); }
JSON.stringify({ items: out, totalSeen: i, totalCount: totalCount, errors: errors, firstItemAccessFailed: firstItemAccessFailed });
`;

    const raw = await runJXA<{
      items: JxaAsset[];
      totalSeen: number;
      totalCount: number | null;
      errors: string[];
      firstItemAccessFailed: boolean;
    }>(this.host, script, 90_000);

    if (raw.items.length === 0) {
      const parts: string[] = [];
      parts.push(`returned 0 usable items`);
      parts.push(`scanned ${raw.totalSeen}`);
      if (raw.totalCount !== null) parts.push(`library count=${raw.totalCount}`);
      if (raw.firstItemAccessFailed) parts.push('first index access failed');
      if (raw.errors.length > 0) parts.push(`errors: ${raw.errors.join(' | ')}`);
      throw new Error(`AppleScriptPhotosProvider.listAssets ${parts.join(', ')}`);
    }

    return raw.items.map((item, idx) => jxaToAsset(item, idx));
  }

  async listAlbums(): Promise<PhotoAlbum[]> {
    const script = `
const Photos = Application('Photos');
const albums = Photos.albums;
const out = [];
let len = 0;
try { len = albums.length; } catch (e) {}
for (let i = 0; i < len && i < 500; i++) {
  try {
    const a = albums[i];
    let count = 0;
    try { count = a.mediaItems.length; } catch (e) {}
    out.push({ id: a.id(), name: a.name() || '', count });
  } catch (e) {}
}
JSON.stringify(out);
`;
    const raw = await runJXA<Array<{ id: string; name: string; count: number }>>(
      this.host,
      script,
      60_000,
    );
    return raw.map((a) => ({
      id: a.id,
      name: a.name,
      assetCount: a.count,
      isSmartAlbum: false,
      isManaged: false,
    }));
  }

  async search(options: SearchOptions): Promise<PhotoAsset[]> {
    // v1: fetch a wider window, filter client-side by name/caption.
    // Photos AppleScript `whose name contains "..."` exists but is slow and
    // case-sensitive in surprising ways. The Provider is allowed to grow a
    // proper search method later.
    const widened = await this.listAssets({
      ...options,
      limit: Math.max(options.limit ?? 60, 200),
    });
    const q = options.query.trim().toLowerCase();
    if (!q) return widened;
    return widened.filter(
      (a) =>
        a.filename.toLowerCase().includes(q) ||
        (a.caption ?? '').toLowerCase().includes(q) ||
        a.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }

  async getAsset(id: string): Promise<PhotoAsset | null> {
    assertValidAssetId(id);
    // Photos AppleScript identifies items by id, but JXA's `byId` accessor
    // works on names not arbitrary identifiers — use `whose({id})` instead.
    const script = `
const Photos = Application('Photos');
let item = null;
try {
  const matches = Photos.mediaItems.whose({ id: ${JSON.stringify(id)} })();
  if (matches && matches.length > 0) item = matches[0];
} catch (e) {}
if (!item) { 'null'; } else {
  let d = null;
  try { const raw = item.date(); if (raw) d = raw.toISOString(); } catch (e) {}
  JSON.stringify({
    id: item.id(),
    name: item.name() || '',
    date: d,
    favorite: item.favorite(),
    width: (function(){ try { return item.width(); } catch (e) { return 0; } })(),
    height: (function(){ try { return item.height(); } catch (e) { return 0; } })(),
    description: (function(){ try { return item.description() || ''; } catch (e) { return ''; } })(),
  });
}
`;
    const raw = await runJXA<JxaAsset | null>(this.host, script, 30_000);
    if (!raw) return null;
    return jxaToAsset(raw, 0);
  }

  // Write methods — implementations land in the next phase. Throwing
  // (rather than silently no-oping) surfaces misuse fast.
  async addKeyword(_assetId: string, _keyword: string): Promise<void> {
    throw new Error('AppleScriptPhotosProvider.addKeyword: not yet implemented');
  }
  async setCaption(_assetId: string, _caption: string): Promise<void> {
    throw new Error('AppleScriptPhotosProvider.setCaption: not yet implemented');
  }
  async createAlbum(_name: string): Promise<PhotoAlbum> {
    throw new Error('AppleScriptPhotosProvider.createAlbum: not yet implemented');
  }
  async addToAlbum(_albumId: string, _assetIds: string[]): Promise<void> {
    throw new Error('AppleScriptPhotosProvider.addToAlbum: not yet implemented');
  }
}
