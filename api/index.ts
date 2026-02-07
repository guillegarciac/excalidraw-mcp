/**
 * Vercel serverless function: load the Express app at runtime (after build creates dist/).
 * This avoids "Missing files" by not importing dist at parse time.
 */
import path from "node:path";

/** Express app used as (req, res) => void */
type RequestListener = (req: unknown, res: unknown) => void;

let app: RequestListener | null = null;

async function getApp(): Promise<RequestListener> {
  if (app) return app;
  const { createHttpApp } = await import("../dist/create-http-app.js");
  const baseDir = path.join(process.cwd(), "dist");
  app = createHttpApp(baseDir) as RequestListener;
  return app;
}

export default async function handler(req: unknown, res: unknown) {
  const expressApp = await getApp();
  expressApp(req, res);
}
