/**
 * Drawing store facade. Uses in-memory store locally; uses Redis (Upstash/Vercel KV)
 * when UPSTASH_REDIS_REST_URL or KV_REST_API_URL is set (e.g. serverless deployment).
 */

export interface StoredDrawing {
  screenshot: string;
  elements: string;
  prompt: string;
  timestamp: number;
}

type StoreImpl = {
  storeDrawing(d: StoredDrawing): Promise<void>;
  getDrawing(): Promise<StoredDrawing | null>;
  consumeDrawing(): Promise<StoredDrawing | null>;
};

let impl: StoreImpl | null = null;

async function getImpl(): Promise<StoreImpl> {
  if (impl) return impl;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  if (url) {
    const m = await import("./drawing-store-kv.js");
    impl = { storeDrawing: m.storeDrawing, getDrawing: m.getDrawing, consumeDrawing: m.consumeDrawing };
  } else {
    const m = await import("./drawing-store-memory.js");
    impl = { storeDrawing: m.storeDrawing, getDrawing: m.getDrawing, consumeDrawing: m.consumeDrawing };
  }
  return impl;
}

export async function storeDrawing(d: StoredDrawing): Promise<void> {
  const s = await getImpl();
  return s.storeDrawing(d);
}

export async function getDrawing(): Promise<StoredDrawing | null> {
  const s = await getImpl();
  return s.getDrawing();
}

export async function consumeDrawing(): Promise<StoredDrawing | null> {
  const s = await getImpl();
  return s.consumeDrawing();
}
