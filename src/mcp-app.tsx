import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import { Excalidraw, exportToSvg, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import morphdom from "morphdom";
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { initPencilAudio, playStroke } from "./pencil-audio";
import { captureInitialElements, onEditorChange, loadPersistedElements, savePersistedElements, clearPersistedElements, getLatestEditedElements, setScreenshotCapture } from "./edit-context";
import { captureScreenshot } from "./screenshot";
import "./global.css";

// ============================================================
// Shared helpers
// ============================================================

function parsePartialElements(str: string | undefined): any[] {
  try {
    const s = typeof str === "string" ? str.trim() : "";
    if (!s || !s.startsWith("[")) return [];
    if (/Standalone|not found|<!DOCTYPE|error\s/i.test(s) || (s.length > 300 && !s.includes("type"))) return [];
    try {
      return JSON.parse(s);
    } catch {
      /* partial */
    }
    const last = s.lastIndexOf("}");
    if (last < 0) return [];
    try {
      return JSON.parse(s.substring(0, last + 1) + "]");
    } catch {
      /* incomplete */
    }
  } catch {
    /* never let parse errors surface */
  }
  return [];
}

function excludeIncompleteLastItem<T>(arr: T[]): T[] {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= 1) return [];
  return arr.slice(0, -1);
}

interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function extractViewportAndElements(elements: any[]): {
  viewport: ViewportRect | null;
  drawElements: any[];
} {
  let viewport: ViewportRect | null = null;
  const drawElements: any[] = [];

  for (const el of elements) {
    if (el.type === "cameraUpdate" || el.type === "viewportUpdate") {
      viewport = { x: el.x, y: el.y, width: el.width, height: el.height };
    } else {
      drawElements.push(el);
    }
  }

  return { viewport, drawElements };
}

/** Lightweight content hash — sum of char codes of all element IDs. */
function contentHash(elements: any[]): number {
  let hash = 0;
  for (const el of elements) {
    const id = el.id ?? "";
    for (let i = 0; i < id.length; i++) {
      hash = (hash + id.charCodeAt(i)) | 0;
    }
  }
  return hash;
}

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
  </svg>
);

// Action button icons
const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 3h12v8H5l-3 3V3z" />
  </svg>
);
const WandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 14L10 6M10 6l2-4 2 2-4 2M6 8l-1 1M8 6l-1 1" />
  </svg>
);
const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M5 4L1 8l4 4M11 4l4 4-4 4M9 2l-2 12" />
  </svg>
);
const BookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 2h5l1 1 1-1h5v11H9l-1 1-1-1H2V2z" />
  </svg>
);
const SelectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 2h4M10 2h4M2 2v4M14 2v4M2 10v4M14 10v4M2 14h4M10 14h4" />
  </svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 4h10M5 4V3h6v1M6 7v4M10 7v4M4 4l1 9h6l1-9" />
  </svg>
);

// ============================================================
// Send to Claude
// ============================================================

async function sendToClaude(app: App, elements: readonly any[], prompt: string, includeJson: boolean) {
  const screenshot = await captureScreenshot(elements);
  const content: any[] = [];
  if (screenshot) {
    content.push({
      type: "image",
      data: screenshot.replace("data:image/png;base64,", ""),
      mimeType: "image/png",
    });
  }
  content.push({ type: "text", text: prompt });
  if (includeJson) {
    const json = JSON.stringify(elements.map((el: any) => {
      const { version, versionNonce, seed, ...rest } = el;
      return rest;
    }));
    content.push({ type: "text", text: `Current Excalidraw elements JSON:\n${json}` });
  }
  try {
    await app.sendMessage({ role: "user", content });
  } catch (e) {
    console.error("[Excalidraw] Failed to send message:", e);
  }
}

// ============================================================
// Action toolbar (visible in fullscreen editor)
// ============================================================

interface ActionDef {
  label: string;
  icon: () => React.JSX.Element;
  hint?: string;
  prompt: string;
  includeJson: boolean;
  selectionOnly?: boolean;
}

const ACTIONS: ActionDef[] = [
  {
    label: "Ask Claude",
    icon: ChatIcon,
    hint: "\u2318\u21A9",
    prompt: "Look at this diagram I drew. What do you see? Describe it and share any thoughts or suggestions.",
    includeJson: false,
  },
  {
    label: "Iterate Selection",
    icon: SelectIcon,
    prompt: "I selected these elements from my canvas. Please improve/modify just these elements and redraw them using create_view. Keep their approximate positions and IDs so they merge back into the full diagram.",
    includeJson: true,
    selectionOnly: true,
  },
  {
    label: "Refine",
    icon: WandIcon,
    prompt: "I sketched this rough diagram. Please clean it up and redraw it as a polished, well-organized diagram using the create_view tool. Keep the same concepts but improve the layout, colors, and styling. Reuse the same element IDs so changes merge into the existing canvas.",
    includeJson: true,
  },
  {
    label: "Generate Code",
    icon: CodeIcon,
    prompt: "Based on this diagram I drew, generate the code or implementation it represents. If it's a wireframe, generate the UI code. If it's an architecture diagram, generate the infrastructure/service code. If it's a flowchart, generate the logic.",
    includeJson: true,
  },
  {
    label: "Explain",
    icon: BookIcon,
    prompt: "Explain the concepts shown in this diagram step by step. Break down each component and how they relate to each other.",
    includeJson: false,
  },
];

function ActionToolbar({ app, getElements, getSelectedElements }: {
  app: App;
  getElements: () => readonly any[];
  getSelectedElements: () => readonly any[];
}) {
  const [visible, setVisible] = useState(true);
  const [sending, setSending] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 4000);
    };
    document.addEventListener("mousemove", show);
    document.addEventListener("pointerdown", show);
    hideTimer.current = setTimeout(() => setVisible(false), 4000);
    return () => {
      document.removeEventListener("mousemove", show);
      document.removeEventListener("pointerdown", show);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const handleAction = useCallback(async (action: ActionDef) => {
    if (sending) return;
    const els = action.selectionOnly ? getSelectedElements() : getElements();
    if (els.length === 0) {
      if (action.selectionOnly) {
        // No selection — fall back to all elements
        const all = getElements();
        if (all.length === 0) return;
        setSending(true);
        try {
          await sendToClaude(app, all, action.prompt.replace("I selected these elements from my canvas.", "Here is my full canvas."), action.includeJson);
        } finally { setSending(false); }
        return;
      }
      return;
    }
    setSending(true);
    try {
      await sendToClaude(app, els, action.prompt, action.includeJson);
    } finally {
      setSending(false);
    }
  }, [app, getElements, getSelectedElements, sending]);

  return (
    <div className={`action-toolbar${visible ? "" : " hidden"}`}>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          className="action-btn"
          disabled={sending}
          onClick={() => handleAction(action)}
          title={action.hint ? `${action.label} (${action.hint})` : action.label}
        >
          <action.icon />
          <span>{action.label}</span>
          {action.hint && <kbd className="action-hint">{action.hint}</kbd>}
        </button>
      ))}
      {sending && <div className="action-sending">Sending...</div>}
    </div>
  );
}

// ============================================================
// Error boundary
// ============================================================

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-inner">
            <p className="error-boundary-title">Something went wrong rendering the diagram</p>
            <p className="error-boundary-message">{this.state.error?.message ?? "Unknown error"}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================
// Loading skeleton
// ============================================================

function LoadingSkeleton({ height }: { height?: number }) {
  return (
    <div className="loading-skeleton" style={{ height: height ?? 300 }}>
      <div className="skeleton-inner">
        <div className="skeleton-shape skeleton-rect-lg" />
        <div className="skeleton-shape skeleton-line" />
        <div className="skeleton-shape skeleton-rect-sm" />
      </div>
    </div>
  );
}

// ============================================================
// Blank canvas (empty create_view)
// ============================================================

function BlankCanvas({ onStartDrawing }: { onStartDrawing: () => void }) {
  return (
    <div className="blank-canvas">
      <div className="blank-canvas-inner">
        <div className="blank-canvas-icon" aria-hidden>
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 19l3-3m-3 3l-3-3m3 3V5" />
          </svg>
        </div>
        <p className="blank-canvas-title">Blank canvas</p>
        <p className="blank-canvas-subtitle">Draw from scratch and use the action buttons to send to Claude.</p>
        <button type="button" className="blank-canvas-btn" onClick={onStartDrawing}>
          Start Drawing
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Streaming indicator
// ============================================================

function StreamingIndicator() {
  return (
    <div className="streaming-indicator">
      <div className="streaming-dot" />
      <div className="streaming-dot" />
      <div className="streaming-dot" />
    </div>
  );
}

// ============================================================
// Diagram component (Excalidraw SVG)
// ============================================================

const EXPORT_PADDING = 20;

/**
 * Compute adaptive LERP speed based on distance to target.
 * Large jumps (camera changes) are fast, small adjustments are smooth.
 */
function adaptiveLerpSpeed(distance: number): number {
  if (distance > 500) return 0.08;
  if (distance > 100) return 0.05;
  return 0.025;
}

/**
 * Compute the min x/y of all draw elements in scene coordinates.
 */
function computeSceneBounds(elements: any[]): { minX: number; minY: number } {
  let minX = Infinity;
  let minY = Infinity;
  for (const el of elements) {
    if (el.x != null) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      if (el.points && Array.isArray(el.points)) {
        for (const pt of el.points) {
          minX = Math.min(minX, el.x + pt[0]);
          minY = Math.min(minY, el.y + pt[1]);
        }
      }
    }
  }
  return { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0 };
}

/**
 * Convert a scene-space viewport rect to an SVG-space viewBox.
 */
function sceneToSvgViewBox(
  vp: ViewportRect,
  sceneMinX: number,
  sceneMinY: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: vp.x - sceneMinX + EXPORT_PADDING,
    y: vp.y - sceneMinY + EXPORT_PADDING,
    w: vp.width,
    h: vp.height,
  };
}

function DiagramView({ toolInput, isFinal, displayMode, onElements, editedElements, sessionElements }: {
  toolInput: any;
  isFinal: boolean;
  displayMode: string;
  onElements?: (els: any[]) => void;
  editedElements?: any[];
  sessionElements?: any[];
}) {
  const svgRef = useRef<HTMLDivElement | null>(null);
  const latestRef = useRef<any[]>([]);
  const latestHashRef = useRef<number>(0);
  const [, setCount] = useState(0);
  const [hasContent, setHasContent] = useState(false);

  // Init pencil audio on first mount
  useEffect(() => { initPencilAudio(); }, []);

  // Set container height: 4:3 in inline, full viewport in fullscreen
  useEffect(() => {
    if (!svgRef.current) return;
    if (displayMode === "fullscreen") {
      svgRef.current.style.height = "100vh";
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0 && svgRef.current) {
        svgRef.current.style.height = `${Math.round(w * 3 / 4)}px`;
      }
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [displayMode]);

  // Font preloading
  const fontsReady = useRef<Promise<void> | null>(null);
  const ensureFontsLoaded = useCallback(() => {
    if (!fontsReady.current) {
      fontsReady.current = document.fonts.load("20px Virgil").then(() => {});
    }
    return fontsReady.current;
  }, []);

  // Animated viewport in SCENE coordinates (stable across re-exports)
  const animatedVP = useRef<ViewportRect | null>(null);
  const targetVP = useRef<ViewportRect | null>(null);
  const sceneBoundsRef = useRef<{ minX: number; minY: number }>({ minX: 0, minY: 0 });
  const animFrameRef = useRef<number>(0);

  /** Apply current animated scene-space viewport to the SVG. */
  const applyViewBox = useCallback(() => {
    if (!animatedVP.current || !svgRef.current) return;
    const svg = svgRef.current.querySelector("svg");
    if (!svg) return;
    const { minX, minY } = sceneBoundsRef.current;
    const vb = sceneToSvgViewBox(animatedVP.current, minX, minY);
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }, []);

  /** Lerp scene-space viewport toward target each frame (adaptive speed). */
  const animateViewBox = useCallback(() => {
    if (!animatedVP.current || !targetVP.current) return;
    const a = animatedVP.current;
    const t = targetVP.current;

    const distance = Math.abs(t.x - a.x) + Math.abs(t.y - a.y)
      + Math.abs(t.width - a.width) + Math.abs(t.height - a.height);
    const speed = adaptiveLerpSpeed(distance);

    a.x += (t.x - a.x) * speed;
    a.y += (t.y - a.y) * speed;
    a.width += (t.width - a.width) * speed;
    a.height += (t.height - a.height) * speed;
    applyViewBox();

    if (distance > 0.5) {
      animFrameRef.current = requestAnimationFrame(animateViewBox);
    }
  }, [applyViewBox]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  const renderSvgPreview = useCallback(async (els: any[], viewport: ViewportRect | null) => {
    if (els.length === 0 || !svgRef.current) return;
    try {
      sceneBoundsRef.current = computeSceneBounds(els);

      await ensureFontsLoaded();

      const withLabelDefaults = els.map((el: any) =>
        el.label ? { ...el, label: { textAlign: "center", verticalAlign: "middle", ...el.label } } : el
      );
      const excalidrawEls = convertToExcalidrawElements(withLabelDefaults, { regenerateIds: false })
        .map((el: any) => el.type === "text" ? { ...el, fontFamily: 1 } : el);

      const svg = await exportToSvg({
        elements: excalidrawEls as any,
        appState: { viewBackgroundColor: "transparent", exportBackground: false } as any,
        files: null,
        exportPadding: EXPORT_PADDING,
        skipInliningFonts: true,
      });
      if (!svgRef.current) return;

      let wrapper = svgRef.current.querySelector(".svg-wrapper") as HTMLDivElement | null;
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "svg-wrapper";
        svgRef.current.appendChild(wrapper);
      }

      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.removeAttribute("width");
      svg.removeAttribute("height");

      const existing = wrapper.querySelector("svg");
      if (existing) {
        morphdom(existing, svg, {
          childrenOnly: false,
          onBeforeElUpdated(fromEl, toEl) {
            // Preserve animation classes during morphdom updates
            if (fromEl.getAttribute("class") && !toEl.getAttribute("class")) {
              toEl.setAttribute("class", fromEl.getAttribute("class")!);
            }
            return true;
          },
        });
      } else {
        wrapper.appendChild(svg);
      }

      setHasContent(true);

      // Animate viewport
      if (viewport) {
        targetVP.current = { ...viewport };
        if (!animatedVP.current) {
          animatedVP.current = { ...viewport };
        }
        applyViewBox();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(animateViewBox);
      } else {
        const defaultVP: ViewportRect = { x: 0, y: 0, width: 1024, height: 768 };
        targetVP.current = defaultVP;
        if (!animatedVP.current) {
          animatedVP.current = { ...defaultVP };
        }
        applyViewBox();
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(animateViewBox);
        targetVP.current = null;
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      }
    } catch {
      // export can fail on partial/malformed elements
    }
  }, [applyViewBox, animateViewBox, ensureFontsLoaded]);

  useEffect(() => {
    if (!toolInput) return;
    const raw = toolInput.elements;
    if (!raw) return;

    const str = typeof raw === "string" ? raw : JSON.stringify(raw);

    // Existing session elements to render as stable background
    const bgElements = sessionElements ?? [];

    if (isFinal) {
      const parsed = parsePartialElements(str);
      const { viewport, drawElements } = extractViewportAndElements(parsed);
      latestRef.current = drawElements;
      latestHashRef.current = contentHash(drawElements);
      const withDefaults = drawElements.map((el: any) =>
        el.label ? { ...el, label: { textAlign: "center", verticalAlign: "middle", ...el.label } } : el
      );
      const converted = convertToExcalidrawElements(withDefaults, { regenerateIds: false })
        .map((el: any) => el.type === "text" ? { ...el, fontFamily: 1 } : el);
      captureInitialElements(converted);
      if (!editedElements) onElements?.(converted);
      // Merge session background with new elements for the SVG preview
      const newIds = new Set(drawElements.map((el: any) => el.id));
      const bgOnly = bgElements.filter((el: any) => !newIds.has(el.id));
      const allElements = [...bgOnly, ...drawElements];
      renderSvgPreview(allElements, viewport);

      // NOTE: updateModelContext removed — the 4000 token limit is too small for any
      // useful canvas summary. Use the action toolbar (sendMessage) to share canvas state.
      return;
    }

    // Partial input — drop last (potentially incomplete) element
    const parsed = parsePartialElements(str);
    const safe = excludeIncompleteLastItem(parsed);
    const { viewport, drawElements } = extractViewportAndElements(safe);

    // Re-render when count OR content changes (improved trigger)
    const newHash = contentHash(drawElements);
    if (drawElements.length > 0 &&
        (drawElements.length !== latestRef.current.length || newHash !== latestHashRef.current)) {
      const prevCount = latestRef.current.length;
      for (let i = prevCount; i < drawElements.length; i++) {
        playStroke(drawElements[i].type ?? "rectangle");
      }
      latestRef.current = drawElements;
      latestHashRef.current = newHash;
      setCount(drawElements.length);
      const jittered = drawElements.map((el: any) => ({ ...el, seed: Math.floor(Math.random() * 1e9) }));
      // Merge session background with new streaming elements
      const newIds = new Set(jittered.map((el: any) => el.id));
      const bgOnly = bgElements.filter((el: any) => !newIds.has(el.id));
      renderSvgPreview([...bgOnly, ...jittered], viewport);
    }
  }, [toolInput, isFinal, renderSvgPreview, editedElements, onElements, sessionElements]);

  // Render already-converted elements directly (skip convertToExcalidrawElements)
  useEffect(() => {
    if (!editedElements || editedElements.length === 0 || !svgRef.current) return;
    (async () => {
      try {
        await ensureFontsLoaded();
        const svg = await exportToSvg({
          elements: editedElements as any,
          appState: { viewBackgroundColor: "transparent", exportBackground: false } as any,
          files: null,
          exportPadding: EXPORT_PADDING,
          skipInliningFonts: true,
        });
        if (!svgRef.current) return;
        let wrapper = svgRef.current.querySelector(".svg-wrapper") as HTMLDivElement | null;
        if (!wrapper) {
          wrapper = document.createElement("div");
          wrapper.className = "svg-wrapper";
          svgRef.current.appendChild(wrapper);
        }
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        const existing = wrapper.querySelector("svg");
        if (existing) {
          morphdom(existing, svg, { childrenOnly: false });
        } else {
          wrapper.appendChild(svg);
        }
        setHasContent(true);
      } catch {}
    })();
  }, [editedElements, ensureFontsLoaded]);

  return (
    <div style={{ position: "relative" }}>
      {!hasContent && !isFinal && <LoadingSkeleton />}
      <div
        ref={svgRef}
        className="excalidraw-container"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
      />
      {hasContent && !isFinal && <StreamingIndicator />}
    </div>
  );
}

// ============================================================
// Main app
// ============================================================

// ============================================================
// Session-level element merge helper
// ============================================================

/** Merge new elements into a session map by ID (upsert). Returns array of all session elements. */
function mergeSessionElements(
  sessionMap: Map<string, any>,
  newElements: any[],
): any[] {
  for (const el of newElements) {
    if (el.id) {
      sessionMap.set(el.id, el);
    }
  }
  return Array.from(sessionMap.values());
}

function ExcalidrawApp() {
  const [toolInput, setToolInput] = useState<any>(null);
  const [inputIsFinal, setInputIsFinal] = useState(false);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");
  const [elements, setElements] = useState<any[]>([]);
  const [userEdits, setUserEdits] = useState<any[] | null>(null);
  const appRef = useRef<App | null>(null);

  // Session-persistent element store: accumulates across create_view calls
  const sessionElementsRef = useRef<Map<string, any>>(new Map());
  // Excalidraw imperative API ref (available in fullscreen editor mode)
  const excalidrawAPIRef = useRef<any>(null);

  /** Get currently selected elements from Excalidraw editor. */
  const getSelectedElements = useCallback((): readonly any[] => {
    const api = excalidrawAPIRef.current;
    if (!api) return [];
    try {
      const appState = api.getAppState();
      const selectedIds = appState?.selectedElementIds ?? {};
      const sceneEls = api.getSceneElements() ?? [];
      return sceneEls.filter((el: any) => selectedIds[el.id] && !el.isDeleted);
    } catch {
      return [];
    }
  }, []);

  /** Set elements from new tool input, merging into session + saving to shared storage. */
  const mergeAndSetElements = useCallback((newEls: any[]) => {
    const merged = mergeSessionElements(sessionElementsRef.current, newEls);
    setElements(merged);
    setUserEdits(null);
    savePersistedElements(merged);
  }, []);

  /** Clear all session state + shared storage. */
  const clearCanvas = useCallback(() => {
    sessionElementsRef.current.clear();
    setElements([]);
    setUserEdits(null);
    setToolInput(null);
    setInputIsFinal(false);
    clearPersistedElements();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!appRef.current) return;
    const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    if (newMode === "inline") {
      // Sync editor changes back to session + save to shared storage
      const edited = getLatestEditedElements();
      if (edited) {
        const merged = mergeSessionElements(sessionElementsRef.current, edited);
        setElements(merged);
        setUserEdits(merged);
        savePersistedElements(merged);
      }
    } else {
      // Entering fullscreen: ensure elements are populated from session
      if (sessionElementsRef.current.size > 0) {
        setElements(Array.from(sessionElementsRef.current.values()));
      }
    }
    try {
      const result = await appRef.current.requestDisplayMode({ mode: newMode });
      setDisplayMode(result.mode as "inline" | "fullscreen");
    } catch (err) {
      console.error("Failed to change display mode:", err);
    }
  }, [displayMode]);

  // After Excalidraw editor mounts in fullscreen, force-update scene with elements
  useEffect(() => {
    if (displayMode !== "fullscreen" || !inputIsFinal) return;
    // Small delay to let Excalidraw mount and expose its API
    const timer = setTimeout(() => {
      const api = excalidrawAPIRef.current;
      if (api && elements.length > 0) {
        try {
          api.updateScene({ elements });
          api.scrollToContent(undefined, { fitToViewport: true });
        } catch {}
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [displayMode, inputIsFinal, elements]);

  // Keyboard shortcuts: Escape exits fullscreen, Cmd+Enter sends to Claude
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && displayMode === "fullscreen") toggleFullscreen();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && displayMode === "fullscreen" && appRef.current) {
        e.preventDefault();
        const els = getLatestEditedElements() ?? elements;
        if (els.length > 0) {
          sendToClaude(appRef.current, els, ACTIONS[0].prompt, ACTIONS[0].includeJson);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [displayMode, toggleFullscreen, elements]);

  const { app, error } = useApp({
    appInfo: { name: "Excalidraw", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      appRef.current = app;
      // Register screenshot capture for edit-context passive updates
      setScreenshotCapture(captureScreenshot);

      app.onhostcontextchanged = (ctx: any) => {
        if (ctx.displayMode) {
          if (ctx.displayMode === "inline") {
            const edited = getLatestEditedElements();
            if (edited) {
              const merged = mergeSessionElements(sessionElementsRef.current, edited);
              setElements(merged);
              setUserEdits(merged);
              savePersistedElements(merged);
            }
          }
          setDisplayMode(ctx.displayMode as "inline" | "fullscreen");
        }
      };

      app.ontoolinputpartial = async (input) => {
        const args = (input as any)?.arguments || input;
        // Load shared session elements on first partial (provides stable background during streaming)
        if (sessionElementsRef.current.size === 0) {
          const persisted = loadPersistedElements();
          if (persisted?.length) {
            for (const el of persisted) {
              if (el.id) sessionElementsRef.current.set(el.id, el);
            }
            setElements(Array.from(sessionElementsRef.current.values()));
          }
        }
        setInputIsFinal(false);
        setToolInput(args);
      };

      app.ontoolinput = async (input) => {
        const args = (input as any)?.arguments || input;
        // Load shared session elements on first call (if not already loaded during streaming)
        if (sessionElementsRef.current.size === 0) {
          const persisted = loadPersistedElements();
          if (persisted?.length) {
            for (const el of persisted) {
              if (el.id) sessionElementsRef.current.set(el.id, el);
            }
          }
        }
        setInputIsFinal(true);
        setToolInput(args);
      };

      app.onteardown = async () => ({});
      app.onerror = (err) => console.error("[Excalidraw] Error:", err);
    },
  });

  if (error) return <div className="error">ERROR: {error.message}</div>;
  if (!app) return <div className="loading">Connecting...</div>;

  // Only show blank canvas if the tool input itself is empty ("[]") AND session is empty
  const toolInputRaw = toolInput?.elements;
  const toolInputIsEmpty = !toolInputRaw ||
    (typeof toolInputRaw === "string" && toolInputRaw.trim() === "[]");
  const sessionHasElements = sessionElementsRef.current.size > 0 || elements.length > 0;
  const isBlankCanvas = inputIsFinal && !sessionHasElements && toolInputIsEmpty && !userEdits?.length;
  const showEditor = displayMode === "fullscreen" && inputIsFinal;
  return (
    <main className={`main${displayMode === "fullscreen" ? " fullscreen" : ""}`}>
      {displayMode === "inline" && !isBlankCanvas && (
        <div className="toolbar">
          {sessionHasElements && (
            <button
              className="fullscreen-btn"
              onClick={clearCanvas}
              title="Clear canvas"
              style={{ marginRight: 4 }}
            >
              <TrashIcon />
            </button>
          )}
          <button
            className="fullscreen-btn"
            onClick={toggleFullscreen}
            title="Enter fullscreen"
          >
            <ExpandIcon />
          </button>
        </div>
      )}
      <ErrorBoundary>
        {showEditor ? (
          <div style={{ width: "100%", height: "100vh", position: "relative" }}>
            <Excalidraw
              excalidrawAPI={(api: any) => { excalidrawAPIRef.current = api; }}
              initialData={{ elements: (elements ?? []) as any, scrollToContent: elements?.length ? true : false }}
              theme="light"
              onChange={(els) => onEditorChange(app, els)}
            />
            <ActionToolbar
              app={app}
              getElements={() => getLatestEditedElements() ?? elements ?? []}
              getSelectedElements={getSelectedElements}
            />
          </div>
        ) : isBlankCanvas ? (
          <BlankCanvas onStartDrawing={toggleFullscreen} />
        ) : (
          <DiagramView
            toolInput={toolInput}
            isFinal={inputIsFinal}
            displayMode={displayMode}
            onElements={mergeAndSetElements}
            editedElements={userEdits ?? undefined}
            sessionElements={elements}
          />
        )}
      </ErrorBoundary>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ExcalidrawApp />);
