import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import { consumeDrawing } from "./drawing-store.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

// ============================================================
// RECALL: shared knowledge for the agent
// ============================================================
const RECALL_CHEAT_SHEET = `# Excalidraw Element Format

Thanks for calling read_me! Do NOT call it again in this conversation — you will not see anything new. Now use create_view to draw.

## Color Palette (use consistently across all tools)

### Primary Colors
| Name | Hex | Use |
|------|-----|-----|
| Blue | \`#4a9eed\` | Primary actions, links, data series 1 |
| Amber | \`#f59e0b\` | Warnings, highlights, data series 2 |
| Green | \`#22c55e\` | Success, positive, data series 3 |
| Red | \`#ef4444\` | Errors, negative, data series 4 |
| Purple | \`#8b5cf6\` | Accents, special items, data series 5 |
| Pink | \`#ec4899\` | Decorative, data series 6 |
| Cyan | \`#06b6d4\` | Info, secondary, data series 7 |
| Lime | \`#84cc16\` | Extra, data series 8 |

### Excalidraw Fills (pastel, for shape backgrounds)
| Color | Hex | Good For |
|-------|-----|----------|
| Light Blue | \`#a5d8ff\` | Input, sources, primary nodes |
| Light Green | \`#b2f2bb\` | Success, output, completed |
| Light Orange | \`#ffd8a8\` | Warning, pending, external |
| Light Purple | \`#d0bfff\` | Processing, middleware, special |
| Light Red | \`#ffc9c9\` | Error, critical, alerts |
| Light Yellow | \`#fff3bf\` | Notes, decisions, planning |
| Light Teal | \`#c3fae8\` | Storage, data, memory |
| Light Pink | \`#eebefa\` | Analytics, metrics |

### Background Zones (use with opacity: 30 for layered diagrams)
| Color | Hex | Good For |
|-------|-----|----------|
| Blue zone | \`#dbe4ff\` | UI / frontend layer |
| Purple zone | \`#e5dbff\` | Logic / agent layer |
| Green zone | \`#d3f9d8\` | Data / tool layer |

---

## Excalidraw Elements

### Required Fields (all elements)
\`type\`, \`id\` (unique string), \`x\`, \`y\`, \`width\`, \`height\`

### Defaults (skip these)
strokeColor="#1e1e1e", backgroundColor="transparent", fillStyle="solid", strokeWidth=2, roughness=1, opacity=100
Canvas background is white.

### Element Types

**Rectangle**: \`{ "type": "rectangle", "id": "r1", "x": 100, "y": 100, "width": 200, "height": 100 }\`
- \`roundness: { type: 3 }\` for rounded corners
- \`backgroundColor: "#a5d8ff"\`, \`fillStyle: "solid"\` for filled

**Ellipse**: \`{ "type": "ellipse", "id": "e1", "x": 100, "y": 100, "width": 150, "height": 150 }\`

**Diamond**: \`{ "type": "diamond", "id": "d1", "x": 100, "y": 100, "width": 150, "height": 150 }\`

**Labeled shape (PREFERRED)**: Add \`label\` to any shape for auto-centered text. No separate text element needed.
\`{ "type": "rectangle", "id": "r1", "x": 100, "y": 100, "width": 200, "height": 80, "label": { "text": "Hello", "fontSize": 20 } }\`
- Works on rectangle, ellipse, diamond
- Text auto-centers and container auto-resizes to fit
- Saves tokens vs separate text elements

**Labeled arrow**: \`"label": { "text": "connects" }\` on an arrow element.

**Standalone text** (titles, annotations only):
\`{ "type": "text", "id": "t1", "x": 150, "y": 138, "text": "Hello", "fontSize": 20 }\`
- x is the LEFT edge of the text. To center text at position cx: set x = cx - estimatedWidth/2
- estimatedWidth ≈ text.length × fontSize × 0.5
- Do NOT rely on textAlign or width for positioning — they only affect multi-line wrapping

**Arrow**: \`{ "type": "arrow", "id": "a1", "x": 300, "y": 150, "width": 200, "height": 0, "points": [[0,0],[200,0]], "endArrowhead": "arrow" }\`
- points: [dx, dy] offsets from element x,y
- endArrowhead: null | "arrow" | "bar" | "dot" | "triangle"

### Arrow Bindings
Arrow: \`"startBinding": { "elementId": "r1", "fixedPoint": [1, 0.5] }\`
fixedPoint: top=[0.5,0], bottom=[0.5,1], left=[0,0.5], right=[1,0.5]

### Drawing Order (CRITICAL for streaming)
- Array order = z-order (first = back, last = front)
- **Emit progressively**: background → shape → its label → its arrows → next shape
- BAD: all rectangles → all texts → all arrows
- GOOD: bg_shape → shape1 → text1 → arrow1 → shape2 → text2 → ...

### Example: Two connected labeled boxes
\`\`\`json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 50, "y": 50 },
  { "type": "rectangle", "id": "b1", "x": 100, "y": 100, "width": 200, "height": 100, "roundness": { "type": 3 }, "backgroundColor": "#a5d8ff", "fillStyle": "solid", "label": { "text": "Start", "fontSize": 20 } },
  { "type": "rectangle", "id": "b2", "x": 450, "y": 100, "width": 200, "height": 100, "roundness": { "type": 3 }, "backgroundColor": "#b2f2bb", "fillStyle": "solid", "label": { "text": "End", "fontSize": 20 } },
  { "type": "arrow", "id": "a1", "x": 300, "y": 150, "width": 150, "height": 0, "points": [[0,0],[150,0]], "endArrowhead": "arrow", "startBinding": { "elementId": "b1", "fixedPoint": [1, 0.5] }, "endBinding": { "elementId": "b2", "fixedPoint": [0, 0.5] } }
]
\`\`\`

### Camera & Sizing (CRITICAL for readability)

The diagram displays inline at ~700px width. Design for this constraint.

**Recommended camera sizes (4:3 aspect ratio ONLY):**
| Size | Width x Height | Use |
|------|---------------|-----|
| S | 400 x 300 | Close-up on a small group (2-3 elements) |
| M | 600 x 450 | Medium view, a section of a diagram |
| L | 800 x 600 | Standard full diagram (DEFAULT) |
| XL | 1200 x 900 | Large diagram overview |
| XXL | 1600 x 1200 | Panorama / final overview of complex diagrams |

ALWAYS use one of these exact sizes. Non-4:3 viewports cause distortion.

**Font size rules:**
- Minimum fontSize: **16** for body text, labels, descriptions
- Minimum fontSize: **20** for titles and headings
- Minimum fontSize: **14** for secondary annotations only (sparingly)
- NEVER use fontSize below 14 — it becomes unreadable at display scale

**Element sizing rules:**
- Minimum shape size: 120x60 for labeled rectangles/ellipses
- Leave 20-30px gaps between elements minimum
- Prefer fewer, larger elements over many tiny ones

ALWAYS start with a \`cameraUpdate\` as the FIRST element:
\`{ "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 }\`

- x, y: top-left corner of visible area (scene coordinates)
- ALWAYS emit the cameraUpdate BEFORE drawing the elements it frames — camera moves first, then content appears
- The camera animates smoothly between positions
- Leave padding: don't match camera size to content size exactly (e.g., 500px content in 800x600 camera)

Examples:
\`{ "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 }\` — standard view
\`{ "type": "cameraUpdate", "width": 400, "height": 300, "x": 200, "y": 100 }\` — zoom into a detail
\`{ "type": "cameraUpdate", "width": 1600, "height": 1200, "x": -50, "y": -50 }\` — panorama overview

Tip: For large diagrams, emit a cameraUpdate to focus on each section as you draw it.

---

## Diagram Templates

### Flowchart (decision flow)

\`\`\`json
[
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0},
  {"type":"rectangle","id":"start","x":300,"y":20,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Start","fontSize":18}},
  {"type":"arrow","id":"a1","x":380,"y":80,"width":0,"height":40,"points":[[0,0],[0,40]],"endArrowhead":"arrow"},
  {"type":"diamond","id":"d1","x":290,"y":120,"width":180,"height":120,"backgroundColor":"#fff3bf","fillStyle":"solid","label":{"text":"Condition?","fontSize":16}},
  {"type":"arrow","id":"a2","x":470,"y":180,"width":80,"height":0,"points":[[0,0],[80,0]],"endArrowhead":"arrow","label":{"text":"Yes","fontSize":14}},
  {"type":"rectangle","id":"proc1","x":550,"y":150,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#b2f2bb","fillStyle":"solid","label":{"text":"Process A","fontSize":16}},
  {"type":"arrow","id":"a3","x":380,"y":240,"width":0,"height":40,"points":[[0,0],[0,40]],"endArrowhead":"arrow","label":{"text":"No","fontSize":14}},
  {"type":"rectangle","id":"proc2","x":300,"y":280,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#ffd8a8","fillStyle":"solid","label":{"text":"Process B","fontSize":16}},
  {"type":"arrow","id":"a4","x":380,"y":340,"width":0,"height":40,"points":[[0,0],[0,40]],"endArrowhead":"arrow"},
  {"type":"rectangle","id":"end","x":300,"y":380,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#d0bfff","fillStyle":"solid","label":{"text":"End","fontSize":18}}
]
\`\`\`

### Sequence Diagram (message flow between participants)

\`\`\`json
[
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0},
  {"type":"rectangle","id":"p1","x":50,"y":20,"width":140,"height":50,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Client","fontSize":18}},
  {"type":"rectangle","id":"p2","x":310,"y":20,"width":140,"height":50,"roundness":{"type":3},"backgroundColor":"#d0bfff","fillStyle":"solid","label":{"text":"Server","fontSize":18}},
  {"type":"rectangle","id":"p3","x":570,"y":20,"width":140,"height":50,"roundness":{"type":3},"backgroundColor":"#c3fae8","fillStyle":"solid","label":{"text":"Database","fontSize":18}},
  {"type":"arrow","id":"l1","x":120,"y":70,"width":0,"height":430,"points":[[0,0],[0,430]],"strokeColor":"#d4d4d0","strokeWidth":1,"endArrowhead":null,"strokeStyle":"dashed"},
  {"type":"arrow","id":"l2","x":380,"y":70,"width":0,"height":430,"points":[[0,0],[0,430]],"strokeColor":"#d4d4d0","strokeWidth":1,"endArrowhead":null,"strokeStyle":"dashed"},
  {"type":"arrow","id":"l3","x":640,"y":70,"width":0,"height":430,"points":[[0,0],[0,430]],"strokeColor":"#d4d4d0","strokeWidth":1,"endArrowhead":null,"strokeStyle":"dashed"},
  {"type":"arrow","id":"m1","x":120,"y":120,"width":260,"height":0,"points":[[0,0],[260,0]],"endArrowhead":"arrow","strokeColor":"#4a9eed","strokeWidth":2,"label":{"text":"POST /api","fontSize":14}},
  {"type":"arrow","id":"m2","x":380,"y":180,"width":260,"height":0,"points":[[0,0],[260,0]],"endArrowhead":"arrow","strokeColor":"#8b5cf6","strokeWidth":2,"label":{"text":"SELECT *","fontSize":14}},
  {"type":"arrow","id":"m3","x":640,"y":240,"width":-260,"height":0,"points":[[0,0],[-260,0]],"endArrowhead":"arrow","strokeColor":"#22c55e","strokeWidth":2,"strokeStyle":"dashed","label":{"text":"rows[]","fontSize":14}},
  {"type":"arrow","id":"m4","x":380,"y":300,"width":-260,"height":0,"points":[[0,0],[-260,0]],"endArrowhead":"arrow","strokeColor":"#4a9eed","strokeWidth":2,"strokeStyle":"dashed","label":{"text":"200 OK","fontSize":14}}
]
\`\`\`

### Architecture Diagram (layered services)

\`\`\`json
[
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0},
  {"type":"rectangle","id":"fe_zone","x":20,"y":20,"width":740,"height":120,"backgroundColor":"#dbe4ff","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#4a9eed","strokeWidth":1,"opacity":35},
  {"type":"text","id":"fe_label","x":30,"y":26,"text":"Frontend","fontSize":16,"strokeColor":"#4a9eed"},
  {"type":"rectangle","id":"web","x":120,"y":55,"width":180,"height":60,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Web App","fontSize":16}},
  {"type":"rectangle","id":"mobile","x":480,"y":55,"width":180,"height":60,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Mobile App","fontSize":16}},
  {"type":"rectangle","id":"api_zone","x":20,"y":180,"width":740,"height":120,"backgroundColor":"#e5dbff","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#8b5cf6","strokeWidth":1,"opacity":35},
  {"type":"text","id":"api_label","x":30,"y":186,"text":"API Layer","fontSize":16,"strokeColor":"#8b5cf6"},
  {"type":"rectangle","id":"gw","x":120,"y":215,"width":180,"height":60,"roundness":{"type":3},"backgroundColor":"#d0bfff","fillStyle":"solid","label":{"text":"API Gateway","fontSize":16}},
  {"type":"rectangle","id":"auth","x":480,"y":215,"width":180,"height":60,"roundness":{"type":3},"backgroundColor":"#d0bfff","fillStyle":"solid","label":{"text":"Auth Service","fontSize":16}},
  {"type":"arrow","id":"a1","x":210,"y":115,"width":0,"height":100,"points":[[0,0],[0,100]],"endArrowhead":"arrow","strokeWidth":2},
  {"type":"arrow","id":"a2","x":570,"y":115,"width":0,"height":100,"points":[[0,0],[0,100]],"endArrowhead":"arrow","strokeWidth":2},
  {"type":"rectangle","id":"db_zone","x":20,"y":340,"width":740,"height":120,"backgroundColor":"#d3f9d8","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#22c55e","strokeWidth":1,"opacity":35},
  {"type":"text","id":"db_label","x":30,"y":346,"text":"Data Layer","fontSize":16,"strokeColor":"#22c55e"},
  {"type":"rectangle","id":"pg","x":120,"y":375,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#c3fae8","fillStyle":"solid","label":{"text":"PostgreSQL","fontSize":16}},
  {"type":"rectangle","id":"redis","x":360,"y":375,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#c3fae8","fillStyle":"solid","label":{"text":"Redis Cache","fontSize":16}},
  {"type":"rectangle","id":"s3","x":600,"y":375,"width":140,"height":60,"roundness":{"type":3},"backgroundColor":"#c3fae8","fillStyle":"solid","label":{"text":"S3 Storage","fontSize":16}},
  {"type":"arrow","id":"a3","x":210,"y":275,"width":0,"height":100,"points":[[0,0],[0,100]],"endArrowhead":"arrow","strokeWidth":2},
  {"type":"arrow","id":"a4","x":570,"y":275,"width":-130,"height":100,"points":[[0,0],[-130,100]],"endArrowhead":"arrow","strokeWidth":2}
]
\`\`\`

### Mind Map (radial layout)

\`\`\`json
[
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0},
  {"type":"ellipse","id":"center","x":310,"y":240,"width":180,"height":80,"backgroundColor":"#d0bfff","fillStyle":"solid","strokeColor":"#8b5cf6","strokeWidth":2,"label":{"text":"Main Topic","fontSize":20}},
  {"type":"rectangle","id":"b1","x":50,"y":60,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","label":{"text":"Branch 1","fontSize":16}},
  {"type":"arrow","id":"a1","x":210,"y":100,"width":100,"height":150,"points":[[0,0],[100,150]],"strokeColor":"#4a9eed","strokeWidth":2,"endArrowhead":null},
  {"type":"rectangle","id":"b2","x":560,"y":60,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#b2f2bb","fillStyle":"solid","label":{"text":"Branch 2","fontSize":16}},
  {"type":"arrow","id":"a2","x":560,"y":100,"width":-70,"height":150,"points":[[0,0],[-70,150]],"strokeColor":"#22c55e","strokeWidth":2,"endArrowhead":null},
  {"type":"rectangle","id":"b3","x":50,"y":440,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#ffd8a8","fillStyle":"solid","label":{"text":"Branch 3","fontSize":16}},
  {"type":"arrow","id":"a3","x":210,"y":460,"width":100,"height":-140,"points":[[0,0],[100,-140]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null},
  {"type":"rectangle","id":"b4","x":560,"y":440,"width":160,"height":60,"roundness":{"type":3},"backgroundColor":"#ffc9c9","fillStyle":"solid","label":{"text":"Branch 4","fontSize":16}},
  {"type":"arrow","id":"a4","x":560,"y":460,"width":-70,"height":-140,"points":[[0,0],[-70,-140]],"strokeColor":"#ef4444","strokeWidth":2,"endArrowhead":null}
]
\`\`\`

### ER Diagram (entity-relationship)

\`\`\`json
[
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":0},
  {"type":"rectangle","id":"user","x":50,"y":50,"width":200,"height":160,"roundness":{"type":3},"backgroundColor":"#a5d8ff","fillStyle":"solid","strokeColor":"#4a9eed"},
  {"type":"text","id":"user_t","x":110,"y":60,"text":"User","fontSize":20,"strokeColor":"#1e1e1e"},
  {"type":"arrow","id":"user_sep","x":60,"y":90,"width":180,"height":0,"points":[[0,0],[180,0]],"strokeColor":"#4a9eed","strokeWidth":1,"endArrowhead":null},
  {"type":"text","id":"user_f1","x":70,"y":100,"text":"id: UUID (PK)","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"user_f2","x":70,"y":122,"text":"name: string","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"user_f3","x":70,"y":144,"text":"email: string","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"user_f4","x":70,"y":166,"text":"created_at: date","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"rectangle","id":"order","x":500,"y":50,"width":200,"height":160,"roundness":{"type":3},"backgroundColor":"#b2f2bb","fillStyle":"solid","strokeColor":"#22c55e"},
  {"type":"text","id":"order_t","x":560,"y":60,"text":"Order","fontSize":20,"strokeColor":"#1e1e1e"},
  {"type":"arrow","id":"order_sep","x":510,"y":90,"width":180,"height":0,"points":[[0,0],[180,0]],"strokeColor":"#22c55e","strokeWidth":1,"endArrowhead":null},
  {"type":"text","id":"order_f1","x":520,"y":100,"text":"id: UUID (PK)","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"order_f2","x":520,"y":122,"text":"user_id: UUID (FK)","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"order_f3","x":520,"y":144,"text":"total: decimal","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"order_f4","x":520,"y":166,"text":"status: enum","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"arrow","id":"rel1","x":250,"y":130,"width":250,"height":0,"points":[[0,0],[250,0]],"endArrowhead":"arrow","strokeColor":"#1e1e1e","strokeWidth":2,"label":{"text":"1 : N","fontSize":16}},
  {"type":"rectangle","id":"product","x":270,"y":350,"width":200,"height":160,"roundness":{"type":3},"backgroundColor":"#fff3bf","fillStyle":"solid","strokeColor":"#f59e0b"},
  {"type":"text","id":"prod_t","x":325,"y":360,"text":"Product","fontSize":20,"strokeColor":"#1e1e1e"},
  {"type":"arrow","id":"prod_sep","x":280,"y":390,"width":180,"height":0,"points":[[0,0],[180,0]],"strokeColor":"#f59e0b","strokeWidth":1,"endArrowhead":null},
  {"type":"text","id":"prod_f1","x":290,"y":400,"text":"id: UUID (PK)","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"prod_f2","x":290,"y":422,"text":"name: string","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"prod_f3","x":290,"y":444,"text":"price: decimal","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"text","id":"prod_f4","x":290,"y":466,"text":"stock: integer","fontSize":14,"strokeColor":"#6b7280"},
  {"type":"arrow","id":"rel2","x":600,"y":210,"width":-130,"height":150,"points":[[0,0],[-130,150]],"endArrowhead":"arrow","strokeColor":"#1e1e1e","strokeWidth":2,"label":{"text":"N : M","fontSize":16}}
]
\`\`\`

---

## Photosynthesis Example

Example prompt: "Explain how photosynthesis works"

Uses 2 camera positions: start zoomed in (M) for title, then zoom out (L) to reveal the full diagram. Sun art drawn last as a finishing touch.

- **Camera 1** (400x300): Draw the title "Photosynthesis" and formula subtitle zoomed in
- **Camera 2** (800x600): Zoom out — draw the leaf zone, process flow (Light Reactions -> Calvin Cycle), inputs (Sunlight, Water, CO2), outputs (O2, Glucose), and finally a cute 8-ray sun

\`\`\`json
[
  {"type":"cameraUpdate","width":400,"height":300,"x":200,"y":-20},
  {"type":"text","id":"ti","x":280,"y":10,"text":"Photosynthesis","fontSize":28,"strokeColor":"#1e1e1e"},
  {"type":"text","id":"fo","x":245,"y":48,"text":"6CO2 + 6H2O --> C6H12O6 + 6O2","fontSize":16,"strokeColor":"#b0b0b0"},
  {"type":"cameraUpdate","width":800,"height":600,"x":0,"y":-20},
  {"type":"rectangle","id":"lf","x":150,"y":90,"width":520,"height":380,"backgroundColor":"#d3f9d8","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#22c55e","strokeWidth":1,"opacity":35},
  {"type":"text","id":"lfl","x":170,"y":96,"text":"Inside the Leaf","fontSize":16,"strokeColor":"#22c55e"},
  {"type":"rectangle","id":"lr","x":190,"y":190,"width":160,"height":70,"backgroundColor":"#fff3bf","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#f59e0b","label":{"text":"Light Reactions","fontSize":16}},
  {"type":"arrow","id":"a1","x":350,"y":225,"width":120,"height":0,"points":[[0,0],[120,0]],"strokeColor":"#1e1e1e","strokeWidth":2,"endArrowhead":"arrow","label":{"text":"ATP","fontSize":14}},
  {"type":"rectangle","id":"cc","x":470,"y":190,"width":160,"height":70,"backgroundColor":"#d0bfff","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#8b5cf6","label":{"text":"Calvin Cycle","fontSize":16}},
  {"type":"rectangle","id":"sl","x":10,"y":200,"width":120,"height":50,"backgroundColor":"#fff3bf","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#f59e0b","label":{"text":"Sunlight","fontSize":16}},
  {"type":"arrow","id":"a2","x":130,"y":225,"width":60,"height":0,"points":[[0,0],[60,0]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":"arrow"},
  {"type":"rectangle","id":"wa","x":200,"y":360,"width":140,"height":50,"backgroundColor":"#a5d8ff","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#4a9eed","label":{"text":"Water (H2O)","fontSize":16}},
  {"type":"arrow","id":"a3","x":270,"y":360,"width":0,"height":-100,"points":[[0,0],[0,-100]],"strokeColor":"#4a9eed","strokeWidth":2,"endArrowhead":"arrow"},
  {"type":"rectangle","id":"co","x":480,"y":360,"width":130,"height":50,"backgroundColor":"#ffd8a8","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#f59e0b","label":{"text":"CO2","fontSize":16}},
  {"type":"arrow","id":"a4","x":545,"y":360,"width":0,"height":-100,"points":[[0,0],[0,-100]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":"arrow"},
  {"type":"rectangle","id":"ox","x":540,"y":100,"width":100,"height":40,"backgroundColor":"#ffc9c9","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#ef4444","label":{"text":"O2","fontSize":16}},
  {"type":"arrow","id":"a5","x":310,"y":190,"width":230,"height":-50,"points":[[0,0],[230,-50]],"strokeColor":"#ef4444","strokeWidth":2,"endArrowhead":"arrow"},
  {"type":"rectangle","id":"gl","x":690,"y":195,"width":120,"height":60,"backgroundColor":"#c3fae8","fillStyle":"solid","roundness":{"type":3},"strokeColor":"#22c55e","label":{"text":"Glucose","fontSize":18}},
  {"type":"arrow","id":"a6","x":630,"y":225,"width":60,"height":0,"points":[[0,0],[60,0]],"strokeColor":"#22c55e","strokeWidth":2,"endArrowhead":"arrow"},
  {"type":"ellipse","id":"sun","x":30,"y":110,"width":50,"height":50,"backgroundColor":"#fff3bf","fillStyle":"solid","strokeColor":"#f59e0b","strokeWidth":2},
  {"type":"arrow","id":"r1","x":55,"y":108,"width":0,"height":-14,"points":[[0,0],[0,-14]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r2","x":55,"y":162,"width":0,"height":14,"points":[[0,0],[0,14]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r3","x":28,"y":135,"width":-14,"height":0,"points":[[0,0],[-14,0]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r4","x":82,"y":135,"width":14,"height":0,"points":[[0,0],[14,0]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r5","x":73,"y":117,"width":10,"height":-10,"points":[[0,0],[10,-10]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r6","x":37,"y":117,"width":-10,"height":-10,"points":[[0,0],[-10,-10]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r7","x":73,"y":153,"width":10,"height":10,"points":[[0,0],[10,10]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null},
  {"type":"arrow","id":"r8","x":37,"y":153,"width":-10,"height":10,"points":[[0,0],[-10,10]],"strokeColor":"#f59e0b","strokeWidth":2,"endArrowhead":null,"startArrowhead":null}
]
\`\`\`

Common mistakes to avoid:
- **Camera size must match content with padding** — if your content is 500px tall, use 800x600 camera, not 500px. No padding = truncated edges
- **Center titles relative to the diagram below** — estimate the diagram's total width and center the title text over it, not over the canvas
- **Arrow labels need space** — long labels like "ATP + NADPH" overflow short arrows. Keep labels short or make arrows wider
- **Elements overlap when y-coordinates are close** — always check that text, boxes, and labels don't stack on top of each other
- **Draw art/illustrations LAST** — cute decorations (sun, stars, icons) should appear as the final drawing step

## Tips
- Do NOT call read_me again — you already have everything you need
- To give the user a blank canvas to draw on, call create_view with elements: "[]"
- Use the color palette consistently
- Make sure text is readable (never use same text color as background color)
- Do NOT use emoji in text — they don't render in Excalidraw's font
- cameraUpdate is MAGICAL and users love it! please use it a lot to guide the user's attention as you draw. It makes a huge difference in readability and engagement.
`;

/**
 * Registers all Excalidraw tools and resources on the given McpServer.
 */
export function registerTools(server: McpServer, distDir: string): void {
  const resourceUri = "ui://excalidraw/mcp-app.html";

  // ============================================================
  // Tool 1: read_me (call before drawing)
  // ============================================================
  server.registerTool(
    "read_me",
    {
      description: "Returns the Excalidraw element format reference with color palettes, examples, and tips. Call this BEFORE using create_view for the first time.",
      annotations: { readOnlyHint: true },
    },
    async (): Promise<CallToolResult> => {
      return { content: [{ type: "text", text: RECALL_CHEAT_SHEET }] };
    },
  );

  // ============================================================
  // Tool 2: check_drawing (standalone app bridge)
  // ============================================================
  server.registerTool(
    "check_drawing",
    {
      description: "Check if the user has sent a drawing from the standalone Excalidraw app (localhost:3001/excalidraw). Returns the screenshot and elements if available.",
      annotations: { readOnlyHint: true },
    },
    async (): Promise<CallToolResult> => {
      const drawing = await consumeDrawing();
      if (!drawing) {
        return {
          content: [{
            type: "text",
            text: "No drawing available. The user hasn't sent anything from the standalone Excalidraw app yet.",
          }],
        };
      }
      return {
        content: [
          {
            type: "image",
            data: drawing.screenshot,
            mimeType: "image/png",
          },
          {
            type: "text",
            text: `Drawing received ${Math.round((Date.now() - drawing.timestamp) / 1000)}s ago.\n\nExcalidraw elements:\n${drawing.elements}`,
          },
          {
            type: "text",
            text: drawing.prompt,
          },
        ],
      };
    },
  );

  // ============================================================
  // Tool 3: create_view (Excalidraw SVG)
  // ============================================================
  registerAppTool(server,
    "create_view",
    {
      title: "Draw Diagram",
      description: `Renders a hand-drawn diagram using Excalidraw elements.
Elements stream in one by one with draw-on animations.
Call read_me first to learn the element format. Pass "[]" for elements to open a blank drawing canvas.`,
      inputSchema: z.object({
        elements: z.string().describe(
          "JSON array string of Excalidraw elements. Must be valid JSON — no comments, no trailing commas. Keep compact. Pass \"[]\" for a blank canvas. Call read_me first for format reference."
        ),
      }),
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri } },
    },
    async ({ elements }): Promise<CallToolResult> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(elements);
      } catch (e) {
        return {
          content: [{ type: "text", text: `Invalid JSON in elements: ${(e as Error).message}. Ensure no comments, no trailing commas, and proper quoting.` }],
          isError: true,
        };
      }
      const isEmpty = Array.isArray(parsed) && parsed.length === 0;
      const msg = isEmpty
        ? "Blank canvas displayed. User can enter fullscreen to draw from scratch."
        : "Diagram displayed. If the user edits the diagram in fullscreen, updated elements JSON is sent as model context.";
      return { content: [{ type: "text", text: msg }] };
    },
  );

  // CSP: allow Excalidraw to load fonts from esm.sh
  const cspMeta = {
    ui: {
      csp: {
        resourceDomains: ["https://esm.sh"],
        connectDomains: ["https://esm.sh"],
      },
    },
  };

  // Register the single shared resource for all UI tools
  registerAppResource(server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(distDir, "mcp-app.html"), "utf-8");
      return {
        contents: [{
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: {
            ui: {
              ...cspMeta.ui,
              prefersBorder: true,
            },
          },
        }],
      };
    },
  );
}

/**
 * Creates a new MCP server instance with Excalidraw drawing tools.
 * @param distDir - Override directory for HTML assets (e.g. Vercel: path.join(process.cwd(), 'dist'))
 */
export function createServer(distDir?: string): McpServer {
  const server = new McpServer({
    name: "Excalidraw",
    version: "1.0.0",
  });
  registerTools(server, distDir ?? DIST_DIR);
  return server;
}
