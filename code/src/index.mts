import dotenv from 'dotenv';

dotenv.config({ override: true, quiet: true });

import { startMcpStdio } from './mcp-stdio.mjs';

// Backward-compatible pure MCP stdio entry point (`node dist/index.mjs`).
await startMcpStdio();
