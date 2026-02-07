/**
 * In-memory drawing store. Used when no Redis/KV env vars are set (local development).
 */

import type { StoredDrawing } from "./drawing-store.js";

let drawing: StoredDrawing | null = null;

export async function storeDrawing(d: StoredDrawing): Promise<void> {
  drawing = d;
}

export async function getDrawing(): Promise<StoredDrawing | null> {
  return drawing;
}

export async function consumeDrawing(): Promise<StoredDrawing | null> {
  const d = drawing;
  drawing = null;
  return d;
}
