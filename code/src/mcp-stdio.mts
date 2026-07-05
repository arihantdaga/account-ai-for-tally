// Shared MCP-over-stdio startup, used by both entry points:
//   - index.mts (backward-compat: `node dist/index.mjs`)
//   - main.mts  (dispatcher: `--mcp` flag / launched by Claude Desktop)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMcpServer } from './mcp.mjs';

export async function startMcpStdio(): Promise<void> {
  const mcpServer = await registerMcpServer();
  // Start receiving messages on stdin and sending messages on stdout.
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
