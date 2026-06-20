import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useStore } from "../store";
import { wallsAabb } from "../lib/dim";
import {
  createSceneEngine,
  PHASES,
  MAX_PHASE,
  ALL_LAYERS,
  ROOF_TYPES,
  DEFAULT_CFG,
} from "../lib/renderer/sceneBuilder";
import SitePickerModal from "./SitePickerModal";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function RendererTab() {
  const { blueprint, saveBlueprint, currentProjectId } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];
  const roofType  = blueprint.roof_type      || DEFAULT_CFG.roof_type;
  const roofPitch = blueprint.roof_pitch_deg ?? DEFAULT_CFG.roof_pitch_deg;
  const wallColor = blueprint.wall_color     || DEFAULT_CFG.wall_color;
  const roofColor = blueprint.roof_color     || DEFAULT_CFG.roof_color;

  const [phase, setPhase] = useState(MAX_PHASE);
  const [layerOverrides, setLayerOverrides] = useState({});
  const [autoMode, setAutoMode] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [site, setSite] = useState(null);
  const [showSitePicker, setShowSitePicker] = useState(false);

  // ---------- Model placement state ----------
  const [placing, setPlacing] = useState(false);
  const [transform, setTransform] = useState({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
  const [savingTransform, setSavingTransform] = useState(false);
  const transformBackupRef = useRef(null);

  // ---------- AI Match dialog state ----------
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiRefLabel, setAiRefLabel] = useState("");
  const [aiRefFeet, setAiRefFeet] = useState("");

  const mountRef = useRef(null);
  const engineRef = useRef(null);

  const updateCfg = useCallback(async (patch) => {
    setSavingCfg(true);
    try {
      await saveBlueprint(walls, doors, windows, blueprint.labels || [], patch);
    } finally {
      setSavingCfg(false);
    }
  }, [saveBlueprint, walls, doors, windows, blueprint.labels]);

  const visibleLayers = useMemo(() => {
    if (autoMode) {
      const set = new Set(PHASES[phase].layers);
      return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, set.has(l.id) || (layerOverrides[l.id] === true)]));
    }
    return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, !!layerOverrides[l.id]]));
  }, [phase, layerOverrides, autoMode]);

  // 1) Mount/unmount the scene engine
  useEffect(() => {
    if (!mountRef.current) return;
    const engine = createSceneEngine(mountRef.current);
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  // 1b) Load the project's site (if any), keep in sync when project changes
  useEffect(() => {
    if (!currentProjectId) { setSite(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("cm_token");
        const { data } = await axios.get(`${API}/projects/${currentProjectId}/site`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setSite(data?.captured ? data : null);
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
  }, [currentProjectId]);

  // 1c) Push the site (or absence of it) into the engine
  useEffect(() => {
    engineRef.current?.setSite(site);
    // Also apply any saved model transform.
    if (site?.model_transform) {
      engineRef.current?.setModelTransform(site.model_transform);
      setTransform({
        x: site.model_transform.x || 0,
        z: site.model_transform.z || 0,
        rotation_deg: site.model_transform.rotation_deg || 0,
        scale: site.model_transform.scale || 1,
      });
    } else {
      engineRef.current?.setModelTransform({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
      setTransform({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
    }
  }, [site]);

  // 2) Build geometry whenever the blueprint changes
  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.build({
      walls, doors, windows,
      roof_type: roofType, roof_pitch_deg: roofPitch,
      wall_color: wallColor, roof_color: roofColor,
    });
    engineRef.current.setVisibility(visibleLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walls, doors, windows, roofType, roofPitch, wallColor, roofColor]);

  // 3) Apply visibility on phase/layer changes
  useEffect(() => {
    engineRef.current?.setVisibility(visibleLayers);
  }, [visibleLayers]);

  // 4) Animate phases when playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPhase((p) => {
        if (p >= MAX_PHASE) { setPlaying(false); return MAX_PHASE; }
        return p + 1;
      });
    }, 850);
    return () => clearInterval(t);
  }, [playing]);

  // 5) Studio Render (4K still PNG)
  const [rendering, setRendering] = useState(false);
  const renderStudio = useCallback(async () => {
    if (!engineRef.current) return;
    setRendering(true);
    try {
      const blob = await engineRef.current.captureHiRes(3840, 2160);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `studio_render_${Date.now()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Render failed: " + (e?.message || e));
    } finally {
      setRendering(false);
    }
  }, []);

  // 6) Walkthrough video export (webm)
  const [recording, setRecording] = useState(false);
  const [recProgress, setRecProgress] = useState(0);
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

    // Animate phases + camera dolly together
    setAutoMode(true);
    setPhase(0);
    const total = 16; // seconds
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
    const a = document.createElement("a");
    a.href = url;
    a.download = `walkthrough_${Date.now()}.webm`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setRecording(false);
    setRecProgress(0);
  }, []);

  // 7) Placement mode handlers
  const startPlacement = useCallback(() => {
    if (!engineRef.current || !site) return;
    transformBackupRef.current = engineRef.current.getModelTransform();
    setPlacing(true);
    engineRef.current.enablePlacement(true, (t) => setTransform(t));
    setTransform(engineRef.current.getModelTransform());
  }, [site]);

  const cancelPlacement = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.enablePlacement(false);
    if (transformBackupRef.current) {
      engineRef.current.setModelTransform(transformBackupRef.current);
      setTransform(transformBackupRef.current);
    }
    setPlacing(false);
  }, []);

  const onRotationChange = useCallback((deg) => {
    if (!engineRef.current) return;
    const next = { ...transform, rotation_deg: Number(deg) || 0 };
    setTransform(next);
    engineRef.current.setModelTransform(next);
  }, [transform]);

  const onScaleChange = useCallback((s) => {
    if (!engineRef.current) return;
    const next = { ...transform, scale: Math.max(0.1, Math.min(10, Number(s) || 1)) };
    setTransform(next);
    engineRef.current.setModelTransform(next);
  }, [transform]);

  const resetTransform = useCallback(() => {
    if (!engineRef.current) return;
    const zero = { x: 0, z: 0, rotation_deg: 0, scale: 1 };
    setTransform(zero);
    engineRef.current.setModelTransform(zero);
  }, []);

  const runAIMatch = useCallback(async () => {
    if (!engineRef.current || !currentProjectId) return;
    const aabb = wallsAabb(walls);
    if (!aabb || aabb.w < 0.5 || aabb.h < 0.5) {
      setAiError("Need a blueprint with walls before AI Match can run.");
      return;
    }
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    try {
      const token = localStorage.getItem("cm_token");
      const refFeet = Number(aiRefFeet);
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/site/auto-scale`,
        {
          blueprint_width_ft: aabb.w,
          blueprint_depth_ft: aabb.h,
          reference_label: aiRefLabel.trim() || null,
          reference_feet: Number.isFinite(refFeet) && refFeet > 0 ? refFeet : null,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setAiResult(data);
      if (data.applied) {
        const next = { ...transform, scale: data.scale };
        setTransform(next);
        engineRef.current.setModelTransform(next);
      }
    } catch (e) {
      const d = e?.response?.data?.detail;
      setAiError(typeof d === "string" ? d : (Array.isArray(d) ? d.map(x => x.msg).join("; ") : "AI Match failed"));
    } finally {
      setAiBusy(false);
    }
  }, [currentProjectId, walls, aiRefLabel, aiRefFeet, transform]);

  const savePlacement = useCallback(async () => {
    if (!engineRef.current || !currentProjectId) return;
    setSavingTransform(true);
    try {
      const t = engineRef.current.getModelTransform();
      const token = localStorage.getItem("cm_token");
      await axios.patch(
        `${API}/projects/${currentProjectId}/site/transform`,
        t, { headers: { Authorization: `Bearer ${token}` } },
      );
      setSite((s) => s ? { ...s, model_transform: t } : s);
      transformBackupRef.current = t;
      engineRef.current.enablePlacement(false);
      setPlacing(false);
    } catch (e) {
      alert("Failed to save placement: " + (e?.response?.data?.detail || e?.message));
    } finally {
      setSavingTransform(false);
    }
  }, [currentProjectId]);

  const empty = walls.length === 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px] grid-rows-[1fr_auto] md:grid-rows-1 h-full" data-testid="renderer-tab">
      <section className="relative min-h-[60vh] md:min-h-0 border-b border-white/10 md:border-b-0">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm pointer-events-none">
          <div className="label-mono">// CONSTRUCTION PHASE</div>
          <div className="font-display text-lg tracking-tighter">{PHASES[phase].label}</div>
        </div>

        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
          <button
            data-testid="renderer-studio-render"
            onClick={renderStudio}
            disabled={rendering || empty}
            className="label-mono px-3 py-2 bg-black/80 border border-[#FFCC00]/60 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Render high-resolution 4K still"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M8 6V4h8v2" /></svg>
            {rendering ? "RENDERING…" : "STUDIO RENDER (4K)"}
          </button>
          <button
            data-testid="renderer-walkthrough"
            onClick={recordWalkthrough}
            disabled={recording || empty}
            className="label-mono px-3 py-2 bg-black/80 border border-[#FF3333]/60 text-[#FF6666] hover:bg-[#FF3333] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Record 16s walkthrough video (webm)"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3.5" fill="currentColor" /><rect x="3" y="6" width="18" height="14" rx="2" /></svg>
            {recording ? `REC ${(recProgress * 100).toFixed(0)}%` : "WALKTHROUGH VIDEO"}
          </button>
          {site && !placing && (
            <button
              data-testid="renderer-place-model"
              onClick={startPlacement}
              disabled={empty}
              className="label-mono px-3 py-2 bg-black/80 border border-[#5588FF]/60 text-[#88AAFF] hover:bg-[#5588FF] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              title="Move + rotate the model on the satellite plane"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/><rect x="9" y="9" width="6" height="6"/></svg>
              PLACE ON MAP
            </button>
          )}
        </div>

        {empty && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="text-center bg-black/60 px-6 py-4 border border-white/10">
              <div className="label-mono text-neutral-500 mb-2">// NO GEOMETRY</div>
              <div className="text-neutral-400 font-mono text-sm">Upload a floor plan or draw walls in the CAD editor.</div>
            </div>
          </div>
        )}
        <div ref={mountRef} data-testid="renderer-canvas-mount" className="w-full h-full bg-[#f5f5f5]" />

        {placing && (
          <div
            data-testid="renderer-placement-panel"
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-black/90 border border-[#5588FF]/40 backdrop-blur-sm px-5 py-4 w-[440px] max-w-[95%]"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="label-mono text-[#88AAFF]">// PLACE MODEL ON SATELLITE</div>
                <div className="text-xs text-neutral-400 font-mono mt-1">
                  Drag to move · scroll wheel to scale · slider to rotate. Visual scale doesn&apos;t change blueprint dimensions.
                </div>
              </div>
              <button
                data-testid="renderer-place-reset"
                onClick={resetTransform}
                className="label-mono text-neutral-500 hover:text-white px-2 py-1 border border-white/10 hover:border-white/30"
                title="Reset to (0, 0, 0°)"
              >
                ↺ reset
              </button>
            </div>

            <button
              data-testid="renderer-ai-match-open"
              onClick={() => { setAiOpen(true); setAiResult(null); setAiError(""); }}
              className="w-full mb-3 label-mono px-3 py-2 bg-gradient-to-r from-[#FFCC00]/20 to-[#5588FF]/20 border border-[#FFCC00]/60 text-[#FFCC00] hover:from-[#FFCC00] hover:to-[#5588FF] hover:text-black transition-all flex items-center justify-center gap-2"
              title="Use GPT-4o vision to size your model to the building visible in the satellite image"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3 7h7l-5.5 4 2 8L12 16l-6.5 5 2-8L2 9h7z"/></svg>
              ✦ AI MATCH SATELLITE SCALE
            </button>

            <div className="space-y-3 text-xs font-mono">
              <div className="flex items-center justify-between gap-3 text-[11px] text-neutral-400">
                <span>x: <span className="text-[#FFCC00]">{transform.x.toFixed(1)} ft</span></span>
                <span>z: <span className="text-[#FFCC00]">{transform.z.toFixed(1)} ft</span></span>
                <span>rotation: <span className="text-[#FFCC00]">{transform.rotation_deg.toFixed(0)}°</span></span>
                <span>scale: <span className="text-[#FFCC00]">{transform.scale.toFixed(2)}×</span></span>
              </div>

              <div>
                <div className="label-mono mb-1.5 text-neutral-500">ROTATION (Y axis)</div>
                <input
                  data-testid="renderer-place-rotation"
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={transform.rotation_deg}
                  onChange={(e) => onRotationChange(e.target.value)}
                  className="w-full accent-[#5588FF]"
                />
                <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
                  <span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="label-mono text-neutral-500">DISPLAY SCALE</div>
                  <span className="label-mono text-neutral-600">scroll wheel · visual only</span>
                </div>
                <input
                  data-testid="renderer-place-scale"
                  type="range"
                  min="0.1"
                  max="5"
                  step="0.01"
                  value={transform.scale}
                  onChange={(e) => onScaleChange(e.target.value)}
                  className="w-full accent-[#FFCC00]"
                />
                <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
                  <span>0.1×</span><span>1×</span><span>2×</span><span>3×</span><span>5×</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button
                data-testid="renderer-place-save"
                onClick={savePlacement}
                disabled={savingTransform}
                className="flex-1 bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2 text-xs uppercase tracking-wider"
              >
                {savingTransform ? "Saving…" : "Save placement"}
              </button>
              <button
                data-testid="renderer-place-cancel"
                onClick={cancelPlacement}
                className="px-4 py-2 text-xs uppercase tracking-wider border border-white/15 text-neutral-300 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {aiOpen && (
          <div
            data-testid="ai-match-modal"
            className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={(e) => { if (e.target === e.currentTarget) setAiOpen(false); }}
          >
            <div className="bg-[#0a0a0a] border border-white/10 max-w-md w-full">
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black">
                <div>
                  <div className="label-mono text-[#FFCC00]">// AI MATCH · GPT-4o VISION</div>
                  <div className="font-display text-lg tracking-tighter mt-1">Match satellite scale</div>
                </div>
                <button
                  data-testid="ai-match-close"
                  onClick={() => setAiOpen(false)}
                  className="text-neutral-500 hover:text-white text-2xl leading-none"
                >✕</button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-neutral-400 leading-relaxed">
                  GPT-4o will detect the building in your satellite tile and size your 3D model
                  to match. Optionally hint a known reference dimension to lock the scale exactly.
                </p>

                <div className="space-y-3">
                  <label className="block">
                    <div className="label-mono mb-1.5 text-neutral-500">Building hint (optional)</div>
                    <input
                      data-testid="ai-match-label"
                      type="text"
                      value={aiRefLabel}
                      onChange={(e) => setAiRefLabel(e.target.value)}
                      placeholder="e.g. 'the white house with gable roof'"
                      maxLength={80}
                      className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <label className="block">
                    <div className="label-mono mb-1.5 text-neutral-500">
                      Known dimension (optional) — feet
                    </div>
                    <input
                      data-testid="ai-match-feet"
                      type="number"
                      min="1"
                      max="10000"
                      value={aiRefFeet}
                      onChange={(e) => setAiRefFeet(e.target.value)}
                      placeholder='e.g. 32 (front wall length)'
                      className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
                    />
                    <div className="text-[10px] text-neutral-600 font-mono mt-1">
                      Locks AI&apos;s estimate to your known size — most accurate.
                    </div>
                  </label>
                </div>

                {aiError && (
                  <div data-testid="ai-match-error" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-xs font-mono px-3 py-2">
                    {aiError}
                  </div>
                )}

                {aiResult && (
                  <div data-testid="ai-match-result"
                       className={`border px-3 py-3 text-xs font-mono space-y-1 ${
                         aiResult.applied
                           ? "border-[#00CC66]/50 bg-[#00CC66]/10"
                           : "border-[#FF8866]/40 bg-[#FF8866]/10"
                       }`}>
                    <div className={`font-bold ${aiResult.applied ? "text-[#88EEAA]" : "text-[#FFB8A0]"}`}>
                      {aiResult.applied
                        ? `✓ Applied scale ${aiResult.scale.toFixed(3)}×`
                        : `✗ No building detected`}
                    </div>
                    {aiResult.detection?.found && (
                      <>
                        <div className="text-neutral-300">
                          Detected: ~{Math.round(aiResult.detection.width_ft)} × {Math.round(aiResult.detection.depth_ft)} ft
                          <span className="text-neutral-500 ml-2">
                            (confidence {(aiResult.detection.confidence * 100).toFixed(0)}%)
                          </span>
                        </div>
                        {aiResult.detection.rationale && (
                          <div className="text-neutral-500 italic">&ldquo;{aiResult.detection.rationale}&rdquo;</div>
                        )}
                      </>
                    )}
                    {aiResult.message && !aiResult.detection?.rationale && (
                      <div className="text-neutral-400">{aiResult.message}</div>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    data-testid="ai-match-run"
                    onClick={runAIMatch}
                    disabled={aiBusy}
                    className="flex-1 bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2.5 text-xs uppercase tracking-wider"
                  >
                    {aiBusy ? "Analyzing…" : (aiResult ? "Re-run" : "Detect & match")}
                  </button>
                  <button
                    data-testid="ai-match-done"
                    onClick={() => setAiOpen(false)}
                    className="px-4 py-2.5 text-xs uppercase tracking-wider border border-white/15 text-neutral-300 hover:bg-white/5"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="absolute bottom-3 left-3 right-3 z-10 bg-black/80 border border-white/10 backdrop-blur-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="label-mono text-[#FFCC00]">// PHASE {phase} / {MAX_PHASE} · {PHASES[phase].label}</div>
            <div className="flex items-center gap-2">
              <button
                data-testid="renderer-play"
                onClick={() => {
                  if (!playing && phase >= MAX_PHASE) setPhase(0);
                  setPlaying((p) => !p);
                  setAutoMode(true);
                }}
                className={`label-mono px-2 py-1 border ${playing ? "bg-[#FF3333] text-white border-[#FF3333]" : "bg-[#00CC66] text-black border-[#00CC66]"}`}
                title="Animate construction phases"
              >
                {playing ? "■ STOP" : "▶ PLAY"}
              </button>
              <button
                data-testid="renderer-auto-toggle"
                onClick={() => setAutoMode((a) => !a)}
                className={`label-mono px-2 py-1 border ${autoMode ? "bg-[#FFCC00] text-black border-[#FFCC00]" : "border-white/20 text-white hover:bg-white/10"}`}
              >
                {autoMode ? "AUTO" : "MANUAL"}
              </button>
              <button
                data-testid="renderer-prev"
                onClick={() => { setPhase((p) => Math.max(0, p - 1)); setAutoMode(true); }}
                className="label-mono px-2 py-1 border border-white/20 hover:bg-white/10"
                disabled={phase === 0}
              >◀</button>
              <button
                data-testid="renderer-next"
                onClick={() => { setPhase((p) => Math.min(MAX_PHASE, p + 1)); setAutoMode(true); }}
                className="label-mono px-2 py-1 border border-white/20 hover:bg-white/10"
                disabled={phase === MAX_PHASE}
              >▶</button>
            </div>
          </div>
          <input
            data-testid="renderer-phase-slider"
            type="range" min={0} max={MAX_PHASE} value={phase}
            onChange={(e) => { setPhase(Number(e.target.value)); setAutoMode(true); }}
            className="w-full accent-[#FFCC00]"
          />
          <div className="flex justify-between mt-1 text-[9px] font-mono text-neutral-500 gap-0.5 overflow-hidden">
            {PHASES.map((p) => (
              <span key={p.id} className={`truncate ${p.id === phase ? "text-[#FFCC00]" : ""}`}>{p.label.slice(0, 5)}</span>
            ))}
          </div>
        </div>
      </section>

      <aside className="border-l border-white/10 p-5 overflow-y-auto">
        <div className="label-mono mb-2">// SITE</div>
        {site?.captured ? (
          <div className="border border-white/10 mb-6 overflow-hidden">
            <img
              data-testid="renderer-site-thumb"
              src={`data:image/png;base64,${site.image_base64}`}
              alt="Site satellite view"
              className="w-full h-32 object-cover"
            />
            <div className="p-3">
              <div className="text-xs font-mono text-neutral-300 truncate">
                {site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`}
              </div>
              <div className="label-mono text-neutral-500 mt-1">
                {Math.round((site.world_meters || 0) * 3.28084)} ft × {Math.round((site.world_meters || 0) * 3.28084)} ft
              </div>
              {site.analysis?.summary && (
                <p className="text-xs text-neutral-400 leading-relaxed mt-2 line-clamp-3">
                  {site.analysis.summary}
                </p>
              )}
              {site.analysis?.lot_estimate_sqft && (
                <div className="label-mono text-[#FFCC00] mt-2">
                  ≈ {site.analysis.lot_estimate_sqft.toLocaleString()} sqft
                </div>
              )}
              <button
                data-testid="renderer-site-edit"
                onClick={() => setShowSitePicker(true)}
                className="mt-3 w-full label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5"
              >Change site</button>
            </div>
          </div>
        ) : (
          <button
            data-testid="renderer-site-pick"
            onClick={() => setShowSitePicker(true)}
            className="w-full mb-6 border border-[#5588FF]/60 bg-[#0055FF]/10 hover:bg-[#0055FF]/20 text-[#5588FF] label-mono px-3 py-3 flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-7.6-7-12a7 7 0 0 1 14 0c0 4.4-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
            PICK SITE FROM MAP
          </button>
        )}

        <div className="label-mono mb-2">// ROOF & FINISH</div>
        <div className="space-y-3 mb-6">
          <label className="block">
            <div className="label-mono mb-1">Roof type</div>
            <select
              data-testid="renderer-roof-type"
              value={roofType}
              onChange={(e) => updateCfg({ roof_type: e.target.value })}
              className="w-full bg-black border border-white/15 px-3 py-2 text-sm"
            >
              {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="label-mono mb-1 flex justify-between">
              <span>Roof pitch</span><span className="text-[#FFCC00]">{roofPitch}°</span>
            </div>
            <input
              data-testid="renderer-roof-pitch"
              type="range" min="0" max="45" step="1"
              value={roofPitch}
              onChange={(e) => updateCfg({ roof_pitch_deg: Number(e.target.value) })}
              disabled={roofType === "flat"}
              className="w-full accent-[#FFCC00]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="label-mono mb-1">Wall color</div>
              <input
                data-testid="renderer-wall-color"
                type="color" value={wallColor}
                onChange={(e) => updateCfg({ wall_color: e.target.value })}
                className="w-full h-9 bg-black border border-white/15 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="label-mono mb-1">Roof color</div>
              <input
                data-testid="renderer-roof-color"
                type="color" value={roofColor}
                onChange={(e) => updateCfg({ roof_color: e.target.value })}
                className="w-full h-9 bg-black border border-white/15 cursor-pointer"
              />
            </label>
          </div>
          {savingCfg && <div className="label-mono text-[#FFCC00]">SAVING…</div>}
        </div>

        <div className="label-mono mb-2">// LAYERS</div>
        <p className="text-xs text-neutral-500 leading-relaxed mb-4">
          Toggle individual layers to peel through the build. AUTO mode follows the phase slider; MANUAL gives you per-layer control.
        </p>
        <div className="space-y-1">
          {ALL_LAYERS.map((l) => {
            const on = !!visibleLayers[l.id];
            return (
              <label key={l.id}
                data-testid={`renderer-layer-${l.id}`}
                className={`flex items-center gap-3 p-2 border border-white/5 cursor-pointer hover:bg-white/[0.03] transition-colors ${on ? "bg-white/[0.04]" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    setAutoMode(false);
                    setLayerOverrides((o) => ({ ...o, [l.id]: e.target.checked }));
                  }}
                  className="accent-[#FFCC00]"
                />
                <span className="w-3 h-3 flex-shrink-0" style={{ background: l.color }} />
                <span className="text-sm">{l.label}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-6 label-mono mb-2">// CONTROLS</div>
        <div className="text-xs text-neutral-400 font-mono space-y-1.5 leading-relaxed">
          <div>· Left drag — orbit</div>
          <div>· Right drag — pan</div>
          <div>· Scroll — zoom</div>
          <div>· Slider — scrub phases</div>
        </div>

        <div className="mt-6 border border-[#0055FF]/40 bg-[#0055FF]/5 p-3">
          <div className="label-mono text-[#5588FF]">// PROCEDURAL</div>
          <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
            Structural framing, MEP rough-ins, and site utilities are auto-generated from the wall
            footprint with standard trade spacing. Edits in the CAD editor instantly update every layer.
          </p>
        </div>
      </aside>

      {showSitePicker && currentProjectId && (
        <SitePickerModal
          projectId={currentProjectId}
          currentSite={site}
          onClose={() => setShowSitePicker(false)}
          onCaptured={(s) => setSite(s?.captured ? s : null)}
        />
      )}
    </div>
  );
}
