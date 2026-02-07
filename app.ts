/**
 * Vercel entry: export the Express app so it can be deployed as a serverless function.
 * Set env vars UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_*) for the drawing store.
 * Run "npm run build" before deploy so dist/ exists; this file imports from dist/create-http-app.js.
 */

import path from "node:path";
import { createHttpApp } from "./dist/create-http-app.js";

const baseDir = path.join(process.cwd(), "dist");
export default createHttpApp(baseDir);
