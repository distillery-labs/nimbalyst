import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractFilePathsFromCommand } from '../HooklessAgentFileWatcher';

describe('extractFilePathsFromCommand', () => {
  let workspaceRoot: string;
  let nestedDir: string;
  let realFile: string;
  let realFileRel: string;

  beforeAll(async () => {
    // Realpath the workspace root so the boundary check (which compares
    // against `workspaceRoot` after symlink resolution) doesn't reject
    // candidates resolved through /private/var on macOS.
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hookless-watcher-'));
    workspaceRoot = await fs.promises.realpath(tmp);
    nestedDir = path.join(workspaceRoot, 'packages', 'electron', 'src');
    await fs.promises.mkdir(nestedDir, { recursive: true });
    realFile = path.join(nestedDir, 'file.ts');
    await fs.promises.writeFile(realFile, 'export const a = 1;\n');
    realFileRel = path.relative(workspaceRoot, realFile);
  });

  afterAll(async () => {
    await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('returns the file when a real file is referenced as an absolute path', async () => {
    const result = await extractFilePathsFromCommand(
      `cat ${realFile}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([realFile]);
  });

  it('skips directory candidates so they do not later cause EISDIR reads', async () => {
    // Pre-fix behavior: nestedDir would be returned and downstream readFile
    // would fail with EISDIR, producing a noisy WARN log line.
    const result = await extractFilePathsFromCommand(
      `find ${nestedDir} -name '*.ts'`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([]);
  });

  it('also skips the workspace root itself when used as a positional arg', async () => {
    const result = await extractFilePathsFromCommand(
      `ls -la ${workspaceRoot}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([]);
  });

  it('returns the file when both a directory and a file are referenced together', async () => {
    const result = await extractFilePathsFromCommand(
      `grep -l "x" ${nestedDir} ${realFile}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([realFile]);
  });

  it('resolves relative-path tokens against cwd', async () => {
    const result = await extractFilePathsFromCommand(
      `cat ${realFileRel}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([realFile]);
  });

  it('ignores tokens that do not contain a path separator', async () => {
    // `head` and `-2` should not be treated as relative paths.
    const result = await extractFilePathsFromCommand(
      `head -2 ${realFile}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([realFile]);
  });

  it('rejects absolute paths outside the workspace', async () => {
    const outsideTmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hookless-outside-'));
    try {
      const outsideFile = path.join(await fs.promises.realpath(outsideTmp), 'leak.txt');
      await fs.promises.writeFile(outsideFile, 'nope');
      const result = await extractFilePathsFromCommand(
        `cat ${outsideFile}`,
        workspaceRoot,
        workspaceRoot,
      );
      expect(result).toEqual([]);
    } finally {
      await fs.promises.rm(outsideTmp, { recursive: true, force: true });
    }
  });

  it('returns nothing when the referenced path does not exist on disk', async () => {
    const ghost = path.join(workspaceRoot, 'does', 'not', 'exist.ts');
    const result = await extractFilePathsFromCommand(
      `cat ${ghost}`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([]);
  });

  it('strips trailing punctuation from absolute path matches', async () => {
    // The extractor strips trailing );:, so a command like
    // `(cat /path/file);` still resolves to /path/file.
    const result = await extractFilePathsFromCommand(
      `(cat ${realFile});`,
      workspaceRoot,
      workspaceRoot,
    );
    expect(result).toEqual([realFile]);
  });
});
