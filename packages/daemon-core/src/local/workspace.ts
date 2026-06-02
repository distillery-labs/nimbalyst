import path from 'node:path';

/**
 * True when `filePath` is the workspace root itself or sits inside it.
 * Boundary check uses `path.sep` so `/foo/bar_worktrees/x` does NOT count as
 * inside `/foo/bar`. Mirrors the main-process `isPathInWorkspace` helper but
 * lives here so daemon-core has no Electron dependency.
 */
export function isPathInWorkspace(
  filePath: string,
  workspacePath: string,
): boolean {
  if (!filePath || !workspacePath) {
    return false;
  }
  const normalizedFile = path.normalize(filePath);
  const normalizedWorkspace = path.normalize(workspacePath);
  return (
    normalizedFile === normalizedWorkspace
    || normalizedFile.startsWith(normalizedWorkspace + path.sep)
  );
}
