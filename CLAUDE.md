# Excalidraw MCP Server

MCP server that streams hand-drawn Excalidraw diagrams as SVG with animations.

**Testing and reload:** See [EXAMPLES.md](EXAMPLES.md) for step-by-step testing from Claude and from the standalone Excalidraw app, and how to reload the MCP server after code or config changes.

**Deployment (Vercel/serverless):** See [DEPLOYMENT.md](DEPLOYMENT.md) for using a persistent Redis store so the standalone app and `check_drawing` work across serverless instances.

## Architecture

```
server.ts          -> 3 tools (read_me, check_drawing, create_view) + resource + cheat sheet
main.ts            -> HTTP (Streamable) + stdio transports; serves /excalidraw and /api/drawing
drawing-store.ts   -> Module-level store for standalone app → Claude bridge
src/mcp-app.tsx    -> React widget: SVG rendering via exportToSvg + morphdom
src/standalone-app.tsx -> Standalone Excalidraw editor (full page at /excalidraw)
src/screenshot.ts  -> Shared screenshot capture (widget + standalone)
src/global.css     -> Animations (stroke draw-on, fade-in) + auto-resize
```

## Tools

### `read_me` (text tool, no UI)
Returns a cheat sheet with element format, color palettes, coordinate tips, diagram templates, and examples. The model should call this before `create_view`.

### `check_drawing` (text + image tool, no UI)
Checks if the user has sent a drawing from the **standalone Excalidraw app** (http://localhost:3001/excalidraw). Returns the screenshot and elements JSON if available. Call this when the user says they sent a drawing or asks to "check my drawing".

### `create_view` (UI tool)
Takes `elements` — a JSON string of standard Excalidraw elements. The widget parses partial JSON during streaming and renders via `exportToSvg` + morphdom diffing. **Pass `"[]"` for a blank canvas** so the user can draw from scratch and use the action toolbar to send to Claude.

## Key Design Decisions

### Standard Excalidraw JSON with label extension
Input uses standard Excalidraw element JSON. Labels on shapes use `label` property which is converted via `convertToExcalidrawElements`.

### SVG-only rendering (no Excalidraw React canvas in view mode)
The widget uses `exportToSvg` for ALL inline rendering. The full `<Excalidraw>` React component is only used in fullscreen edit mode.

### Streaming improvements
- Adaptive LERP viewport animation (fast for large jumps, slow for fine adjustments)
- Content-hash re-render trigger (not just element count changes)
- Loading skeleton before first content
- Streaming progress indicator dots
- Error boundary with friendly message

### Auto-sizing
Container has no fixed height. Uses 4:3 aspect ratio via ResizeObserver. SVG viewBox preserves proportions.

### CSP: `esm.sh` allowed
Excalidraw loads the Virgil font from `esm.sh` at runtime.

## Build

```bash
npm install
npm run build
```

Build pipeline: `tsc --noEmit` -> Vite build (mcp-app.html + standalone.html) -> `tsc -p tsconfig.server.json` -> esbuild drawing-store.ts -> esbuild server.ts + main.ts.

## Running

```bash
# HTTP (Streamable) — default
npm run serve
# MCP: http://localhost:3001/mcp
# Standalone Excalidraw: http://localhost:3001/excalidraw

# stdio — for Claude Desktop (standalone app still at :3001/excalidraw)
node dist/index.js --stdio

# Dev mode (watch + serve)
npm run dev
```

## Phase 2: Blank canvas and standalone app

### Blank canvas
- In Claude Desktop, ask Claude to "give me a blank canvas" or use `create_view` with `elements: "[]"`.
- The widget shows a "Start Drawing" button; clicking it enters fullscreen with an empty Excalidraw editor.
- Draw and use the action toolbar (Ask Claude, Refine, Generate Code, Explain) or Cmd+Enter to send to Claude.

### Standalone Excalidraw app
- Open **http://localhost:3001/excalidraw** in a browser (with the MCP server running).
- Draw in the full-page Excalidraw editor.
- Use the floating toolbar to send the drawing to Claude (Ask Claude, Refine, Generate Code, Explain). The app POSTs to `/api/drawing`; the server stores it in memory.
- In Claude Desktop, the user says e.g. "check my drawing". Claude calls `check_drawing` and receives the screenshot + elements + prompt. Each `check_drawing` call consumes the stored drawing (one-shot).

### Drawing store
- `drawing-store.ts` is a module-level singleton. The Express routes (main.ts) call `storeDrawing()` on POST /api/drawing; the MCP tool handler (server.ts) calls `consumeDrawing()` when Claude invokes `check_drawing`. Both bundles load the same `dist/drawing-store.js` at runtime so they share state.

## Claude Desktop config

```json
{
  "excalidraw": {
    "command": "node",
    "args": ["<path>/dist/index.js", "--stdio"]
  }
}
```

## Rendering Pipeline

### Streaming (`ontoolinputpartial`)
1. `parsePartialElements` tries `JSON.parse`, falls back to closing array after last `}`
2. `excludeIncompleteLastItem` drops the last element (may be incomplete)
3. Re-renders when element count OR content hash changes
4. Seeds randomized per render for natural hand-drawn animation
5. `exportToSvg` generates SVG -> morphdom diffs against existing DOM
6. morphdom preserves existing elements (no re-animation)

### Final render (`ontoolinput`)
1. Parses complete JSON, renders with original seeds (stable final look)
2. Same `exportToSvg` + morphdom path
3. Captures initial elements for edit tracking

### CSS Animations (3 layers)
- **Shapes**: opacity fade-in with subtle scale 0.5s
- **Lines**: stroke-dashoffset draw-on effect 0.6s
- **Existing elements**: smooth transition on fill/stroke/opacity changes 0.4s

## Debugging

### Widget logging
Use the SDK logger for widget logging — routes through host to log file.

### Common issues
- **No diagram appears:** Check that `ontoolinputpartial` is firing
- **All elements re-animate:** morphdom not working — check SVG structure similarity
- **Font is default:** `skipInliningFonts` must be true (fonts from CDN)
- **Elements in wrong positions:** Don't use CSS transform: scale() on SVG children
