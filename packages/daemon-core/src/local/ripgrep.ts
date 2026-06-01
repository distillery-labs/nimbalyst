import { existsSync } from 'node:fs';

/**
 * Resolve the ripgrep binary path. Prefers the one bundled by `@vscode/ripgrep`;
 * falls back to the system `rg` on PATH if the bundled copy isn't reachable
 * (e.g. when running in a custom packaging setup that hasn't carried the
 * native binary across).
 *
 * Result is cached for the lifetime of the process — `rgPath` is stable.
 */

let cached: string | null = null;

export async function getRipgrepPath(): Promise<string> {
  if (cached) {
    return cached;
  }
  try {
    const mod = (await import('@vscode/ripgrep')) as { rgPath?: string };
    if (mod.rgPath && existsSync(mod.rgPath)) {
      cached = mod.rgPath;
      return cached;
    }
  } catch {
    // Bundled rg unavailable — fall back to system rg.
  }
  cached = 'rg';
  return cached;
}
