import { useCallback, useState } from "react";
import { MAX_PHASE } from "../../lib/renderer/sceneBuilder";

/**
 * Owns Studio Render (4K still) and Walkthrough Video (WebM) export flows.
 * The pending-export state powers the preview modal.
 */
export function useSceneExport({ engineRef, setPhase, setAutoMode }) {
  const [rendering, setRendering] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
  const [pendingExport, setPendingExport] = useState(null);

  const closeExportPreview = useCallback(() => {
    setPendingExport((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const downloadPendingExport = useCallback(() => {
    setPendingExport((prev) => {
      if (!prev) return null;
      const a = document.createElement("a");
      a.href = prev.url;
      a.download = prev.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(prev.url), 2000);
      return null;
    });
  }, []);

  const renderStudio = useCallback(async () => {
    if (!engineRef.current) return;
    setRendering(true);
    try {
      const blob = await engineRef.current.captureHiRes(3840, 2160);
      const url = URL.createObjectURL(blob);
      setPendingExport({
        kind: "image",
        url,
        blob,
        filename: `studio_render_${Date.now()}.png`,
        sizeMb: (blob.size / (1024 * 1024)).toFixed(2),
        width: 3840,
        height: 2160,
      });
    } catch (e) {
      alert("Render failed: " + (e?.message || e));
    } finally {
      setRendering(false);
    }
  }, [engineRef]);

  const recordWalkthrough = useCallback(async () => {
    if (!engineRef.current) return;
    const canvas = engineRef.current.getDomElement();
    if (!canvas?.captureStream) {
      alert("Your browser doesn't support canvas.captureStream — try Chrome/Edge/Firefox.");
      return;
    }
    setRecording(true);
    setRecProgress(0);
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(250);

    setAutoMode(true);
    setPhase(0);
    const total = 16;
    const phaseTick = setInterval(() => {
      setPhase((p) => (p < MAX_PHASE ? p + 1 : p));
    }, (total * 1000) / (MAX_PHASE + 1));

    try {
      await engineRef.current.startDolly({
        durationSec: total,
        onProgress: (u) => setRecProgress(u),
      });
    } finally {
      clearInterval(phaseTick);
      rec.stop();
      await stopped;
    }
    const blob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    setPendingExport({
      kind: "video",
      url,
      blob,
      filename: `walkthrough_${Date.now()}.webm`,
      sizeMb: (blob.size / (1024 * 1024)).toFixed(2),
      duration: total,
    });
    setRecording(false);
    setRecProgress(0);
  }, [engineRef, setPhase, setAutoMode]);

  return {
    rendering, recording, recProgress, pendingExport,
    renderStudio, recordWalkthrough,
    closeExportPreview, downloadPendingExport,
  };
}
