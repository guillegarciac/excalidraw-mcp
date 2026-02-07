import { exportToSvg } from "@excalidraw/excalidraw";

const EXPORT_PADDING = 20;

/**
 * Export current Excalidraw elements to a PNG data URL (base64) via SVG → Canvas.
 * Used by the MCP widget and standalone app for screenshots.
 */
export async function captureScreenshot(
  elements: readonly any[],
  maxWidth: number = 512,
): Promise<string | null> {
  if (elements.length === 0) return null;
  try {
    const svg = await exportToSvg({
      elements: elements as any,
      appState: { viewBackgroundColor: "#ffffff", exportBackground: true } as any,
      files: null,
      exportPadding: EXPORT_PADDING,
      skipInliningFonts: true,
    });
    const svgString = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}
