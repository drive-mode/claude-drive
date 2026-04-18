/**
 * mcpServer.ts — Thin compatibility shim over `src/mcp/server.ts`.
 *
 * The original 866-LoC file registered every tool inline. After Stage 9 of
 * the review, tools live in `src/mcp/tools.ts` and transport plumbing lives
 * in `src/mcp/server.ts`. This file keeps the legacy import path working so
 * existing callers (and `tests/mcpServer.test.ts`) do not need to change.
 */
export {
  buildMcpServer,
  startMcpServer,
  startMcpServerStdio,
  getPortFilePath,
  readPortFile,
} from "./mcp/server.js";
export type { McpServerOptions } from "./mcp/server.js";
