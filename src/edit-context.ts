import type { App } from "@modelcontextprotocol/ext-apps";

const DEBOUNCE_MS = 3000;
let timer: ReturnType<typeof setTimeout> | null = null;

// Shared session key — all widget instances read/write to the same key
// so a new create_view call can pick up the previous widget's canvas state
const SHARED_SESSION_KEY = "excalidraw:session";

/**
 * Register a screenshot capture function (called from mcp-app.tsx).
 * Kept for API compatibility; screenshots are sent via action toolbar instead.
 */
export function setScreenshotCapture(_fn: (elements: readonly any[]) => Promise<string | null>) {
  // No-op: screenshots removed from context updates to stay under 4000 token limit
}

let initialSnapshot: string | null = null;

/**
 * Call once after final render to capture the baseline element state.
 */
export function captureInitialElements(elements: readonly any[]) {
  initialSnapshot = JSON.stringify(elements.map((el: any) => el.id + ":" + (el.version ?? 0)));
}

/**
 * Load persisted elements from the shared session storage.
 */
export function loadPersistedElements(): any[] | null {
  try {
    const stored = localStorage.getItem(SHARED_SESSION_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Save elements to the shared session storage.
 * Called after final render and when exiting fullscreen editor.
 */
export function savePersistedElements(elements: readonly any[]) {
  try {
    localStorage.setItem(SHARED_SESSION_KEY, JSON.stringify(elements));
  } catch {}
}

/**
 * Clear the shared session storage (when user clicks "Clear canvas").
 */
export function clearPersistedElements() {
  try {
    localStorage.removeItem(SHARED_SESSION_KEY);
  } catch {}
}

/** Latest edited elements (kept in sync without triggering React re-renders). */
let latestEditedElements: any[] | null = null;

/**
 * Get the latest user-edited elements (or null if no edits were made).
 */
export function getLatestEditedElements(): any[] | null {
  return latestEditedElements;
}

/**
 * Excalidraw onChange handler. Persists to localStorage (debounced).
 */
export function onEditorChange(_app: App, elements: readonly any[]) {
  const currentSnapshot = JSON.stringify(elements.map((el: any) => el.id + ":" + (el.version ?? 0)));
  if (currentSnapshot === initialSnapshot) return;

  const live = [...elements].filter((el: any) => !el.isDeleted);
  latestEditedElements = live;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(SHARED_SESSION_KEY, JSON.stringify(live));
    } catch {}
  }, DEBOUNCE_MS);
}
