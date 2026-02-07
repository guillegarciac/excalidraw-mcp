# Excalidraw MCP — How to test and what you see

This guide explains how to test both flows (from Claude and from the standalone Excalidraw app), how to reload the MCP server after code changes, and exactly what the user sees at each step.

---

## 1. Reloading the “extension” (MCP server) after changes

The Excalidraw MCP runs as a **separate process** that Claude Desktop starts. Code and config changes are not picked up until that process is restarted.

### After you change code

1. **Rebuild** (so `dist/` is up to date):
   ```bash
   cd /path/to/excalidraw-mcp
   npm run build
   ```
2. **Restart the MCP server** so it runs the new build:
   - **If Claude Desktop is using the server:** quit Claude Desktop completely and open it again. It will spawn a new process running `node dist/index.js --stdio`.
   - **If you run the server by hand** (e.g. `node dist/index.js --stdio` in a terminal): stop it with Ctrl+C and run the same command again.

### After you change Claude Desktop config

The config file (e.g. `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) is read when Claude Desktop **starts**. So:

1. Edit the config (e.g. fix the path to `dist/index.js`).
2. **Quit Claude Desktop** and open it again.

There is no “reload MCP” inside a running session in the current Claude Desktop; a full restart is required.

### Config reminder (Claude Desktop, stdio)

Your config should point at the **built** entry point and pass `--stdio`:

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/path/to/excalidraw-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

Replace `/path/to/excalidraw-mcp` with the real path to the project. After changing this, restart Claude Desktop.

---

## 2. Testing from Claude (inside Claude Desktop)

Here you always start in a chat; the diagram UI appears inside Claude as an MCP app (widget).

### Prerequisites

- Claude Desktop is running and the Excalidraw MCP server is in config and has been loaded (restart Claude Desktop once after adding/changing it).
- Server runs with `--stdio` when used by Claude Desktop (so you don’t need to run `npm run serve` for this flow).

### Flow A: Blank canvas (draw from scratch)

1. **In a new chat**, say for example:
   - *“Give me a blank Excalidraw canvas so I can draw.”*
   - *“Open a blank diagram for me.”*

2. **What you see:** Claude calls `create_view` with empty elements. The widget shows:
   - A centered card with a pencil/draw icon.
   - Title: **“Blank canvas”**.
   - Subtitle: *“Draw from scratch and use the action buttons to send to Claude.”*
   - A blue **“Start Drawing”** button.

3. **Click “Start Drawing”.** The widget goes fullscreen and you see the full Excalidraw editor (white canvas, tools on the left, etc.).

4. **Draw something** (shapes, arrows, text).

5. **Send to Claude** (either):
   - **Keyboard:** `Cmd+Enter` (Mac) or `Ctrl+Enter` (Windows/Linux) → sends the same as “Ask Claude”.
   - **Toolbar:** A floating bar at the bottom appears (or on mouse move). Use:
     - **Ask Claude** — “What do you see? Describe it…”
     - **Refine** — “Clean it up and redraw with create_view…”
     - **Generate Code** — “Generate code from this diagram…”
     - **Explain** — “Explain the concepts step by step…”

6. **What you see:** Your drawing is sent as a message (screenshot + optional JSON). Claude replies in the chat. You can keep editing and sending again.

7. **Exit fullscreen:** Press **Escape** or use the host’s back/close for the fullscreen view. The diagram stays in the chat as the last view.

### Flow B: Claude draws first, you edit

1. **In a new chat**, ask for a diagram, e.g.:
   - *“Draw a simple flowchart with Start, Process, and End.”*
   - *“Make a small architecture diagram with a frontend and an API.”*

2. **What you see:** The widget first shows a loading skeleton, then the diagram appears and streams in (elements draw on, camera may move). When finished, you see the diagram inline and a small **fullscreen** (expand) icon in the top-right on hover.

3. **Click the fullscreen icon.** The same full Excalidraw editor opens in fullscreen, pre-filled with Claude’s diagram.

4. **Edit** (move, add, delete elements). As you edit, the app sends passive context updates to Claude (debounced) so the model knows the current state.

5. **Send to Claude** the same way as in Flow A: **Ask Claude**, **Refine**, **Generate Code**, **Explain**, or **Cmd+Enter**.

6. **What you see:** Your current drawing (screenshot + optional JSON) is sent; Claude replies. You can refine again or exit fullscreen with **Escape**.

---

## 3. Testing from Excalidraw (standalone app in the browser)

Here you draw in a **separate** Excalidraw page in the browser; Claude only sees the drawing when you say “check my drawing” in chat and the model calls `check_drawing`.

### Prerequisites

- The MCP server must be **running** and serving HTTP on port 3001 so the standalone app and `/api/drawing` are available.
  - **If you use Claude Desktop (stdio):** When you start Claude Desktop with the Excalidraw MCP config, the server is started with `node dist/index.js --stdio`. That same process also starts an HTTP server on port 3001 for the standalone app. So you don’t need to run `npm run serve`; just have Claude Desktop open.
  - **If you don’t use Claude Desktop:** Run `node dist/index.js` (no `--stdio`) or `npm run serve` so that `http://localhost:3001` is up.

### Flow: Standalone → Claude

1. **Open the standalone Excalidraw app** in your browser:
   ```
   http://localhost:3001/excalidraw
   ```

2. **What you see:** A full-page Excalidraw editor (same as the in-Claude fullscreen editor): white canvas, tools, no Claude chat. At the bottom, a floating **toolbar** with four buttons: **Ask Claude**, **Refine**, **Generate Code**, **Explain**.

3. **Draw something** (e.g. a quick wireframe or flowchart).

4. **Click one of the toolbar buttons** (e.g. **“Ask Claude”**). The app:
   - Captures a screenshot of the diagram.
   - Sends it to the server with `POST /api/drawing` (screenshot + elements JSON + the prompt for that button).

5. **What you see:** A **toast** at the bottom of the page, e.g.:
   - *“Drawing sent! Go to Claude and say \"check my drawing\".”*

6. **Switch to Claude Desktop** (same machine, same user).

7. **In a chat**, say for example:
   - *“Check my drawing.”*
   - *“I just sent you a diagram from Excalidraw, take a look.”*

8. **What you see:** Claude calls the `check_drawing` tool, gets the screenshot and elements you sent, and replies (e.g. describes the diagram, refines it, generates code, or explains it). The stored drawing is **consumed** once per `check_drawing` call; if you say “check my drawing” again without sending a new one from the standalone app, Claude will say no drawing is available.

9. **To test again:** In the browser, draw again (or the same), click a toolbar button again, then in Claude say “check my drawing” again.

### If the standalone app can’t reach the server

- **Toast:** *“Failed to send. Is the server running on this port?”*
- **Check:** Server must be running (Claude Desktop with MCP, or `node dist/index.js` / `npm run serve`).
- **Check:** You opened `http://localhost:3001/excalidraw` (same host/port as the server). If you use a different host or port, the fetch in the app is to `/api/drawing`, which is relative to that page’s origin.

---

## 4. Quick reference: what runs when

| You run | MCP (Claude) | HTTP :3001 (standalone + API) |
|--------|----------------|-------------------------------|
| `node dist/index.js --stdio` (e.g. via Claude Desktop) | Yes (stdio) | Yes |
| `node dist/index.js` (no args) | No | Yes (`/mcp`, `/excalidraw`, `/api/drawing`) |
| `npm run serve` | Depends how `serve` is set up (often runs `main.ts` which can do HTTP) | Yes if same app |

So for **testing from Claude** you need the server started with `--stdio` (usually by Claude Desktop). For **testing from Excalidraw** you need the HTTP server on 3001, which you get in both modes above.

---

## 5. Summary

- **Reload “extension”:** `npm run build` then **restart Claude Desktop** (or the process that runs `dist/index.js`). Config changes also require a Claude Desktop restart.
- **Test from Claude:** Use “blank canvas” or “draw a diagram” in chat; use **Start Drawing** or **fullscreen** → edit → **Ask Claude** / **Refine** / **Generate Code** / **Explain** or **Cmd+Enter**.
- **Test from Excalidraw:** Open `http://localhost:3001/excalidraw`, draw, click a toolbar button, then in Claude say **“check my drawing”**.
- **What you see:** In Claude you see the widget (blank canvas card or diagram + fullscreen); in standalone you see the full-page editor and a toast after sending; in chat you see Claude’s reply using the diagram you sent.
