/**
 * @nimbalyst/daemon-core
 *
 * Runtime-local services and the RuntimeContext interface every runtime
 * implements. Consumed by the Electron main process (in-process / local
 * runtime) and the standalone `nimbalystd` daemon (Phase 1).
 *
 * Tracker and document data live on the shared cloud collab data plane
 * (`packages/collabv3`); they are intentionally not part of RuntimeContext.
 * See `nimbalyst-local/plans/runtime-context-interface-v0.md`.
 */

// Top-level contract
export type { RuntimeContext } from './RuntimeContext.js';

// Shared types
export type {
  RuntimeId,
  RuntimeDisplayName,
  WorkspacePath,
  SessionId,
  TerminalId,
  StreamId,
} from './types/identifiers.js';

export type {
  RuntimeError,
  RuntimeErrorCode,
} from './types/errors.js';
export { RuntimeErrorObject } from './types/errors.js';

export type {
  AIProviderDescriptor,
  AuthMethodKind,
  Capabilities,
  RuntimeFeatures,
  RuntimeKind,
  WorkspaceDescriptor,
  WorkspaceTrust,
} from './types/capabilities.js';
export { RUNTIME_PROTOCOL_VERSION } from './types/capabilities.js';

export type {
  StreamHandle,
  StreamTopic,
} from './types/streams.js';

// Domain capability interfaces and their supporting types
export type {
  FileContent,
  FileEntry,
  FileStat,
  FileWatchEvent,
  FileWatchParams,
  FilesCapability,
  ListOpts,
  QuickOpenHit,
  SearchHit,
  SearchQuery,
  WriteResult,
} from './domains/files.js';

export type {
  CreateWorktreeOpts,
  GitBranch,
  GitBranchCapability,
  GitCapability,
  GitCommit,
  GitCommitResult,
  GitDiff,
  GitDiffOpts,
  GitLogOpts,
  GitStatus,
  GitStatusChange,
  GitStatusEntry,
  GitWorktreeCapability,
  Worktree,
  WorktreeStatus,
} from './domains/git.js';

export type {
  CreateSessionOpts,
  Session,
  SessionEvent,
  SessionEventStreamParams,
  SessionFilter,
  SessionMetadata,
  SessionPatch,
  SessionPrompt,
  SessionsCapability,
  ToolDecision,
} from './domains/sessions.js';

export type {
  OpenTerminalOpts,
  TerminalCapability,
  TerminalDescriptor,
  TerminalHandle,
  TerminalOutputEvent,
} from './domains/terminal.js';

export type {
  ExportResult,
  TranscriptEvent,
  TranscriptListOpts,
  TranscriptSearchHit,
  TranscriptStreamParams,
  TranscriptsCapability,
} from './domains/transcripts.js';

export type {
  ExtensionBackendEvent,
  ExtensionSource,
  ExtensionStatus,
  ExtensionsCapability,
  InstalledExtension,
} from './domains/extensions.js';

export type {
  MCPCapability,
  MCPServerDescriptor,
  MCPToolResult,
} from './domains/mcp.js';

export type {
  AIProviderType,
  AuthCapability,
  AuthParams,
  Identity,
  MaskedKey,
} from './domains/auth.js';

export type {
  LogEntry,
  LogQuery,
  MetaCapability,
  PingResult,
  RuntimeStatusEvent,
} from './domains/meta.js';

// Local-runtime implementation
export {
  LocalFilesCapability,
  type LocalFilesCapabilityOptions,
} from './local/files.js';
export {
  createLocalRuntimeContext,
  createLocalRuntimeContextWithBus,
  type LocalRuntimeContextOptions,
} from './local/createLocalRuntimeContext.js';
export {
  WorkspaceEventBus,
  type WorkspaceEventBusLogger,
  type WorkspaceEventBusOptions,
  type WorkspaceEventListener,
  type WorkspaceEventType,
  type GitignoreChangeHandler,
} from './local/workspaceEventBus.js';
export { isPathInWorkspace } from './local/workspace.js';
export {
  shouldExcludeDir,
  pathContainsExcludedDir,
} from './local/exclusions.js';
