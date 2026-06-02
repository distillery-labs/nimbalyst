/**
 * Path filtering for runtime-local file operations.
 *
 * Centralized so `LocalFilesCapability.search`, `quickOpen`, and `watch` apply
 * the same rules. These mirror the lists in
 * `packages/electron/src/main/utils/fileFilters.ts` but are intentionally
 * Electron-free so they work in `nimbalystd` too.
 */

export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'worktrees',
  'dist',
  'build',
  '.build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.vscode',
  '.idea',
  '__pycache__',
  '.DS_Store',
  '.venv',
  'venv',
  '.env',
  'env',
  '.tox',
  'target',
  '.gradle',
  '.maven',
  'vendor',
  'Pods',
  '.swiftpm',
  'DerivedData',
]);

/**
 * Binary extensions QuickOpen results should drop. These are extensions we
 * never want surfaced as a file pick — even if ripgrep listed them.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Media
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.webm', '.flac', '.wav', '.ogg', '.m4a',
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.ico', '.webp', '.avif', '.heic',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.rar', '.7z',
  // Executables / shared libs
  '.exe', '.dll', '.so', '.dylib', '.bin',
  // Office
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Data
  '.db', '.sqlite', '.sqlite3', '.lock',
  // Secrets / certs
  '.pem', '.key', '.wallet', '.p12', '.pfx',
  // Fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

/** True if a directory name is one of the always-excluded build/tooling dirs. */
export function shouldExcludeDir(dirName: string): boolean {
  return EXCLUDED_DIRS.has(dirName);
}

/**
 * True if any segment of `relativePath` (slash-separated) is an excluded dir.
 * Used to drop events whose path crosses through a build-output tree even when
 * the entry itself isn't a directory.
 */
export function pathContainsExcludedDir(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.some((segment) => EXCLUDED_DIRS.has(segment));
}

/**
 * Ripgrep `--glob !<pattern>` arguments to exclude noisy directories,
 * pre-flattened as an args array for `execFile`.
 */
export const RIPGREP_EXCLUDE_ARGS: readonly string[] = Object.freeze([
  '--glob', '!**/node_modules/**',
  '--glob', '!**/.git/**',
  '--glob', '!**/.worktrees/**',
  '--glob', '!**/worktrees/**',
  '--glob', '!**/dist/**',
  '--glob', '!**/build/**',
  '--glob', '!**/.build/**',
  '--glob', '!**/out/**',
  '--glob', '!**/.next/**',
  '--glob', '!**/.nuxt/**',
  '--glob', '!**/.cache/**',
  '--glob', '!**/coverage/**',
  '--glob', '!**/.vscode/**',
  '--glob', '!**/.idea/**',
  '--glob', '!**/__pycache__/**',
  '--glob', '!**/.DS_Store/**',
  '--glob', '!**/.venv/**',
  '--glob', '!**/venv/**',
  '--glob', '!**/.env/**',
  '--glob', '!**/env/**',
  '--glob', '!**/.tox/**',
  '--glob', '!**/target/**',
  '--glob', '!**/.gradle/**',
  '--glob', '!**/.maven/**',
  '--glob', '!**/vendor/**',
  '--glob', '!**/Pods/**',
  '--glob', '!**/.swiftpm/**',
  '--glob', '!**/DerivedData/**',
]);
