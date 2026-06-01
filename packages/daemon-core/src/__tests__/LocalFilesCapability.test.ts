// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalFilesCapability } from '../local/files.js';
import { RuntimeErrorObject } from '../types/errors.js';
import { createLocalRuntimeContext } from '../local/createLocalRuntimeContext.js';

describe('LocalFilesCapability', () => {
  let workspace: string;
  let files: LocalFilesCapability;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'daemon-core-files-'));
    files = new LocalFilesCapability();
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  describe('read / write roundtrip', () => {
    it('writes and reads back a text file', async () => {
      const writeResult = await files.write(workspace, 'hello.md', '# hi');
      expect(writeResult.bytesWritten).toBe(4);
      expect(writeResult.etag).toMatch(/^\d+-\d+$/);

      const read = await files.read(workspace, 'hello.md');
      expect(read.content).toBe('# hi');
      expect(read.encoding).toBe('utf-8');
      expect(read.etag).toBe(writeResult.etag);
    });

    it('detects binary content by NUL byte', async () => {
      const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
      await files.write(workspace, 'image.bin', binary);
      const read = await files.read(workspace, 'image.bin');
      expect(read.encoding).toBe('binary');
      expect(read.content).toBeInstanceOf(Buffer);
    });

    it('creates parent directories on write', async () => {
      await files.write(workspace, 'nested/deep/file.txt', 'ok');
      const read = await files.read(workspace, 'nested/deep/file.txt');
      expect(read.content).toBe('ok');
    });
  });

  describe('stat', () => {
    it('returns exists: false for missing files', async () => {
      const stat = await files.stat(workspace, 'missing.md');
      expect(stat.exists).toBe(false);
      expect(stat.size).toBe(0);
    });

    it('returns metadata for existing files', async () => {
      await writeFile(path.join(workspace, 'a.txt'), 'abc');
      const stat = await files.stat(workspace, 'a.txt');
      expect(stat.exists).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(3);
      expect(stat.etag).toMatch(/^\d+-3$/);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await writeFile(path.join(workspace, 'visible.md'), '');
      await writeFile(path.join(workspace, '.hidden'), '');
      await mkdir(path.join(workspace, 'subdir'));
    });

    it('omits dotfiles by default', async () => {
      const entries = await files.list(workspace, '.');
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['subdir', 'visible.md']);
    });

    it('includes dotfiles when hidden:true', async () => {
      const entries = await files.list(workspace, '.', { hidden: true });
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(['.hidden', 'subdir', 'visible.md']);
    });

    it('flags directories', async () => {
      const entries = await files.list(workspace, '.');
      const subdir = entries.find((e) => e.name === 'subdir');
      expect(subdir?.isDirectory).toBe(true);
    });

    it('respects limit', async () => {
      const entries = await files.list(workspace, '.', { limit: 1 });
      expect(entries).toHaveLength(1);
    });
  });

  describe('mkdir / delete / rename', () => {
    it('creates and removes directories', async () => {
      await files.mkdir(workspace, 'new-dir');
      let stat = await files.stat(workspace, 'new-dir');
      expect(stat.isDirectory).toBe(true);

      await files.delete(workspace, 'new-dir');
      stat = await files.stat(workspace, 'new-dir');
      expect(stat.exists).toBe(false);
    });

    it('renames files', async () => {
      await files.write(workspace, 'a.md', 'x');
      await files.rename(workspace, 'a.md', 'b.md');
      const stat = await files.stat(workspace, 'a.md');
      expect(stat.exists).toBe(false);
      const moved = await files.read(workspace, 'b.md');
      expect(moved.content).toBe('x');
    });

    it('creates target parent directories on rename', async () => {
      await files.write(workspace, 'a.md', 'x');
      await files.rename(workspace, 'a.md', 'archive/year/a.md');
      const moved = await files.read(workspace, 'archive/year/a.md');
      expect(moved.content).toBe('x');
    });
  });

  describe('path safety', () => {
    it('rejects absolute paths', async () => {
      await expect(files.read(workspace, '/etc/passwd')).rejects.toBeInstanceOf(
        RuntimeErrorObject,
      );
    });

    it('rejects traversal that escapes workspace', async () => {
      await expect(
        files.read(workspace, '../outside.md'),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('allows traversal that stays inside workspace', async () => {
      await files.write(workspace, 'a/b/c.md', 'inside');
      const read = await files.read(workspace, 'a/b/../b/c.md');
      expect(read.content).toBe('inside');
    });
  });

  describe('listWorkspaceFiles (migration shim)', () => {
    beforeEach(async () => {
      // ripgrep's gitignore semantics are anchored on the presence of a
      // `.git` directory; create one so the workspace looks like a real repo.
      await mkdir(path.join(workspace, '.git'));
      await mkdir(path.join(workspace, 'src'));
      await writeFile(path.join(workspace, 'src', 'main.ts'), '');
      await writeFile(path.join(workspace, 'README.md'), '');
      await writeFile(path.join(workspace, '.gitignore'), 'secret.md\n');
      await writeFile(path.join(workspace, 'secret.md'), 'hidden');
    });

    it('lists files in the workspace as absolute paths', async () => {
      const result = await files.listWorkspaceFiles(workspace);
      expect(result.length).toBeGreaterThan(0);
      for (const p of result) {
        expect(path.isAbsolute(p)).toBe(true);
      }
      const names = result.map((p) => path.basename(p)).sort();
      expect(names).toContain('main.ts');
      expect(names).toContain('README.md');
    });

    it('honors .gitignore by default', async () => {
      const result = await files.listWorkspaceFiles(workspace);
      const names = result.map((p) => path.basename(p));
      expect(names).not.toContain('secret.md');
    });

    it('honors noIgnore:true and surfaces gitignored files', async () => {
      const result = await files.listWorkspaceFiles(workspace, {
        noIgnore: true,
      });
      const names = result.map((p) => path.basename(p));
      expect(names).toContain('secret.md');
    });
  });

  describe('absolute-path migration shims', () => {
    it('statAbsolute returns metadata for an existing file', async () => {
      const abs = path.join(workspace, 'absolute.md');
      await writeFile(abs, 'hi');
      const stat = await files.statAbsolute(abs);
      expect(stat.exists).toBe(true);
      expect(stat.size).toBe(2);
    });

    it('statAbsolute returns exists:false for a missing file', async () => {
      const stat = await files.statAbsolute(path.join(workspace, 'gone.md'));
      expect(stat.exists).toBe(false);
    });

    it('existsAbsolute reflects presence', async () => {
      const abs = path.join(workspace, 'here.md');
      expect(await files.existsAbsolute(abs)).toBe(false);
      await writeFile(abs, 'x');
      expect(await files.existsAbsolute(abs)).toBe(true);
    });
  });

  describe('search (ripgrep-backed)', () => {
    beforeEach(async () => {
      await mkdir(path.join(workspace, 'src'));
      await writeFile(path.join(workspace, 'src', 'one.ts'), 'hello world\nhello again\n');
      await writeFile(path.join(workspace, 'src', 'two.ts'), 'goodbye world\n');
      await writeFile(path.join(workspace, 'README.md'), 'Hello — uppercase H\n');
    });

    it('finds matching lines across files', async () => {
      const hits = await files.search(workspace, { pattern: 'world' });
      const previews = hits.map((h) => h.preview).sort();
      expect(previews).toContain('hello world');
      expect(previews).toContain('goodbye world');
    });

    it('honors caseSensitive=false (default) and finds case-insensitive matches', async () => {
      const hits = await files.search(workspace, { pattern: 'hello' });
      expect(hits.some((h) => h.preview.includes('Hello — uppercase H'))).toBe(true);
    });

    it('honors caseSensitive=true', async () => {
      const hits = await files.search(workspace, { pattern: 'hello', caseSensitive: true });
      expect(hits.every((h) => !h.preview.includes('Hello — uppercase H'))).toBe(true);
    });

    it('returns empty for unmatched pattern', async () => {
      const hits = await files.search(workspace, { pattern: 'completelyabsentstring' });
      expect(hits).toEqual([]);
    });

    it('returns empty for empty pattern (does not crash)', async () => {
      const hits = await files.search(workspace, { pattern: '' });
      expect(hits).toEqual([]);
    });

    it('rejects patterns with shell metacharacters', async () => {
      await expect(
        files.search(workspace, { pattern: 'foo; rm -rf /' }),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    });

    it('honors glob filter', async () => {
      const hits = await files.search(workspace, {
        pattern: 'world',
        globs: ['*.md'],
      });
      expect(hits.every((h) => h.relPath.endsWith('.md'))).toBe(true);
    });
  });

  describe('quickOpen (ripgrep --files + fuzzy)', () => {
    beforeEach(async () => {
      await mkdir(path.join(workspace, 'src'));
      await mkdir(path.join(workspace, 'src', 'components'));
      await writeFile(path.join(workspace, 'src', 'index.ts'), '');
      await writeFile(path.join(workspace, 'src', 'components', 'Button.tsx'), '');
      await writeFile(path.join(workspace, 'src', 'components', 'Modal.tsx'), '');
      await writeFile(path.join(workspace, 'README.md'), '');
      await writeFile(path.join(workspace, 'logo.png'), '');
    });

    it('lists files when query is empty (up to limit)', async () => {
      const hits = await files.quickOpen(workspace, '', 100);
      const rels = hits.map((h) => h.relPath).sort();
      expect(rels).toEqual(expect.arrayContaining([
        'README.md',
        path.join('src', 'index.ts'),
        path.join('src', 'components', 'Button.tsx'),
      ]));
      // PNG is binary — should be filtered out
      expect(rels).not.toContain('logo.png');
    });

    it('ranks substring matches higher', async () => {
      const hits = await files.quickOpen(workspace, 'button', 10);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.relPath.toLowerCase()).toContain('button');
    });

    it('returns empty when no file matches the fuzzy query', async () => {
      const hits = await files.quickOpen(workspace, 'zzqxn', 10);
      expect(hits).toEqual([]);
    });

    it('respects limit', async () => {
      const hits = await files.quickOpen(workspace, '', 2);
      expect(hits).toHaveLength(2);
    });
  });

  describe('watch (chokidar-backed)', () => {
    it('emits created/modified/deleted events for files within the workspace', async () => {
      const events: Array<{ kind: string; relPath: string }> = [];
      const handle = await files.watch(
        { workspacePath: workspace },
        (event) => {
          if (event.kind === 'renamed') {
            events.push({ kind: 'renamed', relPath: event.toRel });
          } else {
            events.push({ kind: event.kind, relPath: event.relPath });
          }
        },
      );

      try {
        // chokidar takes a moment to start watching
        await new Promise((r) => setTimeout(r, 200));

        await writeFile(path.join(workspace, 'new.md'), 'hi');
        await new Promise((r) => setTimeout(r, 300));

        await writeFile(path.join(workspace, 'new.md'), 'hi again');
        await new Promise((r) => setTimeout(r, 300));

        await rm(path.join(workspace, 'new.md'));
        await new Promise((r) => setTimeout(r, 300));
      } finally {
        await handle.unsubscribe();
      }

      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain('created');
      expect(kinds).toContain('modified');
      expect(kinds).toContain('deleted');
      expect(events.every((e) => e.relPath === 'new.md')).toBe(true);
    });

    it('returns a handle with a stable id and unsubscribe', async () => {
      const handle = await files.watch(
        { workspacePath: workspace },
        () => {},
      );
      expect(typeof handle.id).toBe('string');
      expect(handle.id.length).toBeGreaterThan(8);
      await handle.unsubscribe();
    });
  });
});

describe('createLocalRuntimeContext', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'daemon-core-ctx-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns a context whose files capability works against a temp workspace', async () => {
    const ctx = createLocalRuntimeContext({
      runtimeId: 'rt-local-test',
      runtimeName: 'local',
      runtimeVersion: '0.0.0-test',
      workspaces: [
        { path: workspace, displayName: 'test', trust: 'trusted' },
      ],
    });

    await ctx.files.write(workspace, 'hi.md', 'from runtime context');
    const read = await ctx.files.read(workspace, 'hi.md');
    expect(read.content).toBe('from runtime context');

    expect(ctx.capabilities.runtimeKind).toBe('local');
    expect(ctx.capabilities.runtimeId).toBe('rt-local-test');
    expect(ctx.capabilities.features.fileWrite).toBe(true);
    expect(ctx.capabilities.features.terminal).toBe(false);
  });

  it('throws CAPABILITY_NOT_SUPPORTED for unmigrated domains', async () => {
    const ctx = createLocalRuntimeContext({
      runtimeId: 'rt',
      runtimeName: 'local',
      runtimeVersion: '0.0.0',
      workspaces: [],
    });

    expect(() => ctx.git.status(workspace)).toThrow(RuntimeErrorObject);
    expect(() => ctx.terminal.list(workspace)).toThrow(RuntimeErrorObject);
    expect(() => ctx.sessions.list(workspace)).toThrow(RuntimeErrorObject);
  });

  it('shutdown is a no-op for now', async () => {
    const ctx = createLocalRuntimeContext({
      runtimeId: 'rt',
      runtimeName: 'local',
      runtimeVersion: '0.0.0',
      workspaces: [],
    });
    await expect(ctx.shutdown()).resolves.toBeUndefined();
  });
});

describe('RuntimeClient + InProcessTransport wiring', () => {
  // This proves the abstraction end-to-end: a renderer-side RuntimeClient
  // calling through an InProcessTransport hits the LocalFilesCapability we
  // implemented above, with zero serialization in between. When Phase 1
  // lands the WebSocketTransport, the same test should pass against a
  // remote endpoint without touching the client-side code.

  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'daemon-core-wiring-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('renderer-style read/write via RuntimeClient roundtrips', async () => {
    const { RuntimeClient, InProcessTransport } = await import(
      '@nimbalyst/runtime-client'
    );

    const ctx = createLocalRuntimeContext({
      runtimeId: 'rt-wiring',
      runtimeName: 'local',
      runtimeVersion: '0.0.0',
      workspaces: [
        { path: workspace, displayName: 'test', trust: 'trusted' },
      ],
    });

    const client = new RuntimeClient(new InProcessTransport(ctx));
    await client.connect();
    expect(client.state.kind).toBe('connected');

    await client.files.write(workspace, 'note.md', 'via runtime client');
    const read = await client.files.read(workspace, 'note.md');
    expect(read.content).toBe('via runtime client');

    expect(client.capabilities.runtimeKind).toBe('local');
  });
});
