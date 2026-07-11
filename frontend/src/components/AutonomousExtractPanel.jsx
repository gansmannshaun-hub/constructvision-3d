import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, useStore } from "../store";

/**
 * AutonomousExtractPanel — single-shot upload widget that runs the
 * validation-gated self-correcting pipeline (POST /projects/{id}/autonomous/extract)
 * and renders the resulting layout + earthwork overlay next to the 3D scene.
 *
 * Renders as a bordered card. Drop it into the Renderer tab (or anywhere)
 * and it hydrates from the latest saved extraction on mount, so users
 * see the last successful run without re-uploading.
 */
export default function AutonomousExtractPanel({ onLayout }) {
  const projectId = useStore((s) => s.currentProjectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  // Hydrate from the latest saved extraction on mount / project switch.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get(`/projects/${projectId}/autonomous/latest`);
        if (!cancelled && data && !data.empty) {
          setResult({ attempts: data.attempts, layout: data.layout, earthwork: data.earthwork });
          if (typeof onLayout === "function") onLayout(data.layout, data.earthwork);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [projectId, onLayout]);

  const runExtract = useCallback(async (file) => {
    if (!file || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      // Downscale + base64 encode client-side so we don't hit MongoDB's 16MB doc cap.
      const b64 = await downscaleToBase64(file, 1600);
      const { data } = await apiClient.post(
        `/projects/${projectId}/autonomous/extract`,
        { image_base64: b64, filename: file.name, max_attempts: 3 },
      );
      setResult(data);
      if (typeof onLayout === "function") onLayout(data.layout, data.earthwork);
    } catch (e) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === "object"
        ? `${d.message}\n\n${(d.last_validation_errors || []).slice(0, 5).map((x) => "• " + x).join("\n")}`
        : (d || e?.message || "Autonomous extraction failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [projectId, onLayout]);

  return (
    <div data-testid="autonomous-panel" className="border border-[#00E5FF]/40 bg-black/60 p-4 space-y-3 font-mono text-xs">
      <div className="flex items-baseline justify-between">
        <div className="label-mono text-[#00E5FF]">// AUTONOMOUS PIPELINE</div>
        {result?.attempts != null && (
          <span data-testid="autonomous-attempts" className="text-[10px] text-neutral-500">
            passed on attempt {result.attempts} / 3
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        data-testid="autonomous-file-input"
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => runExtract(e.target.files?.[0])}
      />
      <button
        data-testid="autonomous-run"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full py-2.5 bg-[#00E5FF] text-black font-bold uppercase tracking-wider hover:bg-[#00B8CC] transition-colors disabled:opacity-40"
      >
        {busy ? "Extracting + validating…" : "Extract → validate → render"}
      </button>

      {error && (
        <div data-testid="autonomous-error" className="border border-[#FF3333] bg-[#FF3333]/10 p-3 whitespace-pre-wrap text-[#FF6666]">
          {error}
        </div>
      )}

      {result?.earthwork && (
        <div data-testid="autonomous-earthwork" className="border border-[#FFCC00]/40 bg-[#FFCC00]/5 p-3">
          <div className="label-mono text-[#FFCC00] mb-2">// EARTHWORK · CUBIC YARDS</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Metric label="Bank"      value={result.earthwork.totals.bank_cy}      testId="earthwork-bank" />
            <Metric label="Loose"     value={result.earthwork.totals.loose_cy}     testId="earthwork-loose" note="×1.25 swell" />
            <Metric label="Compacted" value={result.earthwork.totals.compacted_cy} testId="earthwork-compacted" note="×0.85 shrink" />
          </div>
          {result.earthwork.zones?.length > 0 && (
            <div className="mt-3 text-[10px] text-neutral-400 space-y-1">
              {result.earthwork.zones.map((z) => (
                <div key={z.id} className="flex justify-between border-t border-neutral-800 pt-1">
                  <span>{z.id} · {z.soil_type} · {z.depth_ft} ft</span>
                  <span className="tabular-nums">{z.bank_cy} bank cy</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, testId, note }) {
  return (
    <div className="border border-white/10 bg-black/40 p-2">
      <div className="text-[9px] text-neutral-500 uppercase">{label}</div>
      <div data-testid={testId} className="font-serif-editorial text-white text-2xl tabular-nums leading-tight">{Number(value).toFixed(1)}</div>
      <div className="text-[8px] text-neutral-600 uppercase tracking-widest">CY {note && <span className="text-[#FFCC00]/70">· {note}</span>}</div>
    </div>
  );
}

// ---- Image downscaling helper — keeps upload payload under Mongo 16MB cap. ----
async function downscaleToBase64(file, maxDim = 1600) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = URL.createObjectURL(file);
  });
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(img.src);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}
