/**
 * Entry point for running the MCP server.
 * Run with: node dist/index.js [--stdio]
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHttpApp, createStandaloneOnlyApp } from "./create-http-app.js";
import { createServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = __dirname;

/**
 * Starts an MCP server with Streamable HTTP transport in stateless mode.
 */
export async function startStreamableHTTPServer(
  createServerFn: (distDir?: string) => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createHttpApp(distDir);

  const httpServer = app.listen(port, () => {
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
    console.log(`Standalone Excalidraw: http://localhost:${port}/excalidraw`);
  });

  const shutdown = () => {
    console.log("\nShutting down...");
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Starts an MCP server with stdio transport (for Claude Desktop).
 * Also starts an HTTP server on port 3001 for the standalone Excalidraw app.
 */
export async function startStdioServer(
  createServerFn: () => McpServer,
): Promise<void> {
  const port = parseInt(process.env.PORT ?? "3001", 10);
  const app = createStandaloneOnlyApp(distDir);

  app.listen(port, () => {
    console.log(`Standalone Excalidraw: http://localhost:${port}/excalidraw`);
  });

  await createServerFn().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
  } else {
    await startStreamableHTTPServer(createServer);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
