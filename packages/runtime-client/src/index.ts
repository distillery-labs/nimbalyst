/**
 * @nimbalyst/runtime-client
 *
 * Renderer-side facade over a RuntimeContext. Wraps either an in-process
 * RuntimeContext (local Electron main) or a WebSocketTransport (remote
 * daemon / cloud, Phase 1) behind a single shape.
 *
 * Usage outline (renderer):
 *
 *   const transport = new InProcessTransport(electronMainsRuntimeContext);
 *   const client = new RuntimeClient(transport);
 *   await client.connect();
 *   const files = await client.files.list(workspacePath, '.');
 *
 * Phase 2 introduces a `RuntimeRegistry` that owns N RuntimeClient
 * instances and exposes federated views across them.
 */

export { RuntimeClient } from './RuntimeClient.js';
export { InProcessTransport } from './transports/InProcessTransport.js';
export { WebSocketTransport } from './transports/WebSocketTransport.js';
export type { WebSocketTransportOptions } from './transports/WebSocketTransport.js';
export type {
  ConnectionState,
  RuntimeTransport,
} from './transports/RuntimeTransport.js';
