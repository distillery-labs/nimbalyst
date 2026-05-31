import type { WorkspacePath } from '../types/identifiers.js';
import type { StreamHandle } from '../types/streams.js';

export interface GitStatusEntry {
  relPath: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  entries: GitStatusEntry[];
}

export interface GitLogOpts {
  limit?: number;
  branch?: string;
  pathFilter?: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitDiffOpts {
  from: string;
  to: string;
  pathFilter?: string;
}

export interface GitDiff {
  patches: Array<{
    relPath: string;
    patch: string;
  }>;
}

export interface GitCommitResult {
  sha: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
}

export interface Worktree {
  id: string;
  path: string;
  branch: string;
  baseCommit: string;
}

export interface CreateWorktreeOpts {
  branch: string;
  baseCommit?: string;
  detached?: boolean;
}

export interface WorktreeStatus {
  worktree: Worktree;
  status: GitStatus;
}

export interface GitStatusChange {
  workspacePath: WorkspacePath;
}

export interface GitBranchCapability {
  list(workspacePath: WorkspacePath): Promise<GitBranch[]>;
  create(
    workspacePath: WorkspacePath,
    name: string,
    base?: string,
  ): Promise<void>;
  checkout(workspacePath: WorkspacePath, name: string): Promise<void>;
  delete(workspacePath: WorkspacePath, name: string): Promise<void>;
}

export interface GitWorktreeCapability {
  list(workspacePath: WorkspacePath): Promise<Worktree[]>;
  create(
    workspacePath: WorkspacePath,
    opts: CreateWorktreeOpts,
  ): Promise<Worktree>;
  delete(worktreeId: string): Promise<void>;
  getStatus(worktreeId: string): Promise<WorktreeStatus>;
}

export interface GitCapability {
  status(workspacePath: WorkspacePath): Promise<GitStatus>;
  log(workspacePath: WorkspacePath, opts?: GitLogOpts): Promise<GitCommit[]>;
  diff(workspacePath: WorkspacePath, opts: GitDiffOpts): Promise<GitDiff>;
  commit(
    workspacePath: WorkspacePath,
    message: string,
    files?: string[],
  ): Promise<GitCommitResult>;
  branch: GitBranchCapability;
  worktree: GitWorktreeCapability;
  watchStatus(
    workspacePath: WorkspacePath,
    onChange: (change: GitStatusChange) => void,
  ): Promise<StreamHandle>;
}
