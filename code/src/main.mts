import dotenv from 'dotenv';

dotenv.config({ override: true, quiet: true });

// Entry dispatcher for the single binary:
//   • `--mcp` (or launched by Claude Desktop) → MCP server over stdio
//   • no args (double-click)                  → local web control panel
//
// An explicit flag is used rather than TTY detection because it is reliable
// across OSes; the control panel writes `"args": ["--mcp"]` into Claude's
// config so Claude always launches this binary in MCP mode.
const argv = process.argv.slice(2);

if (argv.includes('--mcp')) {
  const { startMcpStdio } = await import('./mcp-stdio.mjs');
  await startMcpStdio();
} else {
  const { startControlPanel } = await import('./control-panel.mjs');
  await startControlPanel();
}
