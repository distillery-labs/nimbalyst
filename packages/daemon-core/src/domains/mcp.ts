import type { WorkspacePath } from '../types/identifiers.js';

export interface MCPServerDescriptor {
  name: string;
  command: string | null;
  url: string | null;
  status: 'running' | 'stopped' | 'errored';
  tools: string[];
}

export interface MCPToolResult {
  content: unknown;
  isError: boolean;
}

export interface MCPCapability {
  listServers(workspacePath: WorkspacePath): Promise<MCPServerDescriptor[]>;
  callTool(
    workspacePath: WorkspacePath,
    server: string,
    tool: string,
    args: unknown,
  ): Promise<MCPToolResult>;
}
