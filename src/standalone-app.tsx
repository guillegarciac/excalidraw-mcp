import { Excalidraw } from "@excalidraw/excalidraw";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureScreenshot } from "./screenshot";
import "./standalone.css";

const ACTIONS = [
  {
    label: "Ask Claude",
    prompt: "Look at this diagram I drew. What do you see? Describe it and share any thoughts or suggestions.",
    includeJson: false,
  },
  {
    label: "Refine",
    prompt: "I sketched this rough diagram. Please clean it up and redraw it as a polished, well-organized diagram using the create_view tool. Keep the same concepts but improve the layout, colors, and styling.",
    includeJson: true,
  },
  {
    label: "Generate Code",
    prompt: "Based on this diagram I drew, generate the code or implementation it represents. If it's a wireframe, generate the UI code. If it's an architecture diagram, generate the infrastructure/service code. If it's a flowchart, generate the logic.",
    includeJson: true,
  },
  {
    label: "Explain",
    prompt: "Explain the concepts shown in this diagram step by step. Break down each component and how they relate to each other.",
    includeJson: false,
  },
] as const;

function StandaloneToolbar({
  getElements,
  onToast,
}: {
  getElements: () => readonly any[];
  onToast: (msg: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [visible, setVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setVisible(false), 4000);
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", show);
    document.addEventListener("pointerdown", show);
    hideTimerRef.current = setTimeout(() => setVisible(false), 4000);
    return () => {
      document.removeEventListener("mousemove", show);
      document.removeEventListener("pointerdown", show);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [show]);

  const handleAction = useCallback(
    async (action: (typeof ACTIONS)[number]) => {
      const els = getElements();
      if (els.length === 0 || sending) return;
      setSending(true);
      try {
        const screenshot = await captureScreenshot(els);
        const screenshotBase64 = screenshot?.replace("data:image/png;base64,", "") ?? "";
        const elementsJson = JSON.stringify(
          els.map((el: any) => {
            const { version, versionNonce, seed, ...rest } = el;
            return rest;
          }),
        );
        const res = await fetch("/api/drawing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshot: screenshotBase64,
            elements: elementsJson,
            prompt: action.prompt,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        onToast("Drawing sent! Go to Claude and say \"check my drawing\".");
      } catch (e) {
        console.error("[Standalone] Send failed:", e);
        onToast("Failed to send. Is the server running on this port?");
      } finally {
        setSending(false);
      }
    },
    [getElements, sending, onToast],
  );

  return (
    <div className={`standalone-toolbar${visible ? "" : " hidden"}`}>
      {ACTIONS.map((action) => (
        <button
          key={action.label}
          type="button"
          className="standalone-action-btn"
          disabled={sending}
          onClick={() => handleAction(action)}
        >
          {action.label}
        </button>
      ))}
      {sending && <span className="standalone-sending">Sending...</span>}
    </div>
  );
}

function StandaloneApp() {
  const elementsRef = useRef<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getElements = useCallback(() => elementsRef.current, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return (
    <div className="standalone-root">
      <div className="standalone-editor">
        <Excalidraw
          theme="light"
          onChange={(els) => {
            elementsRef.current = els.filter((el: any) => !el.isDeleted);
          }}
        />
      </div>
      <StandaloneToolbar getElements={getElements} onToast={showToast} />
      {toast && <div className="standalone-toast">{toast}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StandaloneApp />);
