/**
 * Redis-backed drawing store for serverless (Vercel, etc.).
 * Uses Upstash Redis (or Vercel KV). Set env vars so the store is shared across instances.
 */

import { Redis } from "@upstash/redis";
import type { StoredDrawing } from "./drawing-store.js";

const KEY = "excalidraw:latest";
const TTL_SECONDS = 3600; // 1 hour

function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN for drawing store");
  }
  return new Redis({ url, token });
}

export async function storeDrawing(d: StoredDrawing): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY, JSON.stringify(d), { ex: TTL_SECONDS });
}

export async function getDrawing(): Promise<StoredDrawing | null> {
  const redis = getRedis();
  const raw = await redis.get<string>(KEY);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}

export async function consumeDrawing(): Promise<StoredDrawing | null> {
  const redis = getRedis();
  const raw = await redis.get<string>(KEY);
  if (raw) await redis.del(KEY);
  return raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : null;
}
