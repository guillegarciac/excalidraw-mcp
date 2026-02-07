/**
 * Creates the Express app for HTTP mode (local or Vercel).
 * Used by main.ts and by app.ts (Vercel entry).
 */

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { storeDrawing } from "./drawing-store.js";
import { createServer } from "./server.js";

export function createHttpApp(baseDir: string): express.Express {
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/excalidraw", async (_req: Request, res: Response) => {
    try {
      const html = await fs.readFile(path.join(baseDir, "standalone.html"), "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e) {
      console.error("Failed to serve standalone:", e);
      res.status(500).send("Standalone app not found. Run npm run build.");
    }
  });

  app.post("/api/drawing", async (req: Request, res: Response) => {
    try {
      const { screenshot, elements, prompt } = req.body as { screenshot?: string; elements?: string; prompt?: string };
      if (typeof screenshot !== "string" || typeof elements !== "string") {
        res.status(400).json({ error: "Missing screenshot or elements" });
        return;
      }
      await storeDrawing({
        screenshot,
        elements,
        prompt: typeof prompt === "string" ? prompt : "",
        timestamp: Date.now(),
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("Failed to store drawing:", e);
      res.status(500).json({ error: "Failed to store drawing" });
    }
  });

  app.all("/mcp", async (req: Request, res: Response) => {
    const server = createServer(baseDir);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  return app;
}

/** Express app with only /excalidraw and /api/drawing (for stdio mode, no /mcp). */
export function createStandaloneOnlyApp(baseDir: string): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  app.get("/excalidraw", async (_req: Request, res: Response) => {
    try {
      const html = await fs.readFile(path.join(baseDir, "standalone.html"), "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (e) {
      console.error("Failed to serve standalone:", e);
      res.status(500).send("Standalone app not found. Run npm run build.");
    }
  });

  app.post("/api/drawing", async (req: Request, res: Response) => {
    try {
      const { screenshot, elements, prompt } = req.body as { screenshot?: string; elements?: string; prompt?: string };
      if (typeof screenshot !== "string" || typeof elements !== "string") {
        res.status(400).json({ error: "Missing screenshot or elements" });
        return;
      }
      await storeDrawing({
        screenshot,
        elements,
        prompt: typeof prompt === "string" ? prompt : "",
        timestamp: Date.now(),
      });
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("Failed to store drawing:", e);
      res.status(500).json({ error: "Failed to store drawing" });
    }
  });

  return app;
}
