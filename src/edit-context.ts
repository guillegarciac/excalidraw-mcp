import type { App } from "@modelcontextprotocol/ext-apps";

const DEBOUNCE_MS = 3000;
let timer: ReturnType<typeof setTimeout> | null = null;
let screenshotFn: ((elements: readonly any[]) => Promise<string | null>) | null = null;

/**
 * Register a screenshot capture function (called from mcp-app.tsx).
 */
export function setScreenshotCapture(fn: (elements: readonly any[]) => Promise<string | null>) {
  screenshotFn = fn;
}
let initialSnapshot: string | null = null;
let initialElementsById: Map<string, any> = new Map();
let storageKey: string | null = null;

/**
 * Set the localStorage key for this widget instance.
 */
export function setStorageKey(key: string) {
  storageKey = `excalidraw:${key}`;
}

/**
 * Call once after final render to capture the baseline element state.
 */
export function captureInitialElements(elements: readonly any[]) {
  initialSnapshot = JSON.stringify(elements.map((el: any) => el.id + ":" + (el.version ?? 0)));
  initialElementsById = new Map(elements.map((el: any) => [el.id, el]));
}

/** Compute a compact diff between initial and current elements. */
function computeDiff(current: any[]): string {
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const currentIds = new Set<string>();

  for (const el of current) {
    currentIds.add(el.id);
    const orig = initialElementsById.get(el.id);
    if (!orig) {
      const desc = `${el.type} "${el.text ?? el.label?.text ?? ""}" at (${Math.round(el.x)},${Math.round(el.y)})`;
      added.push(desc);
    } else if (Math.round(orig.x) !== Math.round(el.x) || Math.round(orig.y) !== Math.round(el.y) ||
               Math.round(orig.width) !== Math.round(el.width) || Math.round(orig.height) !== Math.round(el.height)) {
      moved.push(`${el.id} -> (${Math.round(el.x)},${Math.round(el.y)}) ${Math.round(el.width)}x${Math.round(el.height)}`);
    }
  }

  for (const id of initialElementsById.keys()) {
    if (!currentIds.has(id)) removed.push(id);
  }

  const parts: string[] = [];
  if (added.length) parts.push(`Added: ${added.join("; ")}`);
  if (removed.length) parts.push(`Removed: ${removed.join(", ")}`);
  if (moved.length) parts.push(`Moved/resized: ${moved.join("; ")}`);
  if (!parts.length) return "";
  return `User edited diagram. ${parts.join(". ")}`;
}

/**
 * Load persisted elements from localStorage (if any).
 */
export function loadPersistedElements(): any[] | null {
  if (!storageKey) return null;
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
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
 * Excalidraw onChange handler. Persists to localStorage and sends updated
 * elements JSON to model context (debounced 2s).
 */
export function onEditorChange(app: App, elements: readonly any[]) {
  const currentSnapshot = JSON.stringify(elements.map((el: any) => el.id + ":" + (el.version ?? 0)));
  if (currentSnapshot === initialSnapshot) return;

  const live = [...elements].filter((el: any) => !el.isDeleted);
  latestEditedElements = live;

  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(live));
      } catch {}
    }
    const diff = computeDiff(live);
    if (diff) {
      const content: any[] = [];
      // Capture screenshot if available
      if (screenshotFn) {
        try {
          const screenshot = await screenshotFn(live);
          if (screenshot) {
            content.push({
              type: "image",
              data: screenshot.replace("data:image/png;base64,", ""),
              mimeType: "image/png",
            });
          }
        } catch {}
      }
      content.push({ type: "text", text: diff });
      app.updateModelContext({ content }).catch(() => {});
    }
  }, DEBOUNCE_MS);
}
