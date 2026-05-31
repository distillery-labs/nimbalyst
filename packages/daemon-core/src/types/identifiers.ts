/**
 * Common identifier types used across RuntimeContext domains.
 *
 * `RuntimeId` is the stable opaque identifier for a runtime, persisted in the
 * client's runtime registry. `RuntimeDisplayName` is the human-readable label
 * users edit; it composes into the URI `{displayName}:{absolutePath}` for
 * surfaces like the project rail and breadcrumbs.
 */

export type RuntimeId = string;
export type RuntimeDisplayName = string;

export type WorkspacePath = string;
export type SessionId = string;
export type TerminalId = string;
export type StreamId = string;
