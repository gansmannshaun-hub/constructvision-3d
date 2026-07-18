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
import AutonomousExtractPanel from "./AutonomousExtractPanel";
import { RENDERER_API as API, fallbackFmtFtIn } from "./renderer/format";

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

  // ---------- Tape measure state ----------
  const [measuring, setMeasuring] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [pickStatus, setPickStatus] = useState("idle"); // idle | first | measured
  const [measurePreview, setMeasurePreview] = useState(null);

  // ---------- 3D landscape state ----------
  const [buildingLandscape, setBuildingLandscape] = useState(false);
  const [landscapeError, setLandscapeError] = useState("");
  const [terrainStats, setTerrainStats] = useState(null);
  const [verticalExag, setVerticalExag] = useState(3);

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
    // Re-apply terrain with current exaggeration and capture stats
    if (site?.terrain_3d && engineRef.current?.setSiteTerrain) {
      const stats = engineRef.current.setSiteTerrain(site, site.terrain_3d,
        { verticalExaggeration: verticalExag });
      setTerrainStats(stats || null);
    } else {
      setTerrainStats(null);
    }
  }, [site]);

  // 2) Build geometry ONLY when the blueprint's structural content actually
  // changes. Polling (`refreshBlueprint()`) hands us fresh object refs on
  // every tick even when the walls/doors/windows are byte-identical —
  // rebuilding on every ref-change was causing visible flicker AND
  // interfering with in-progress orbit/pan gestures ("the model resets
  // itself"). Content hash gates the rebuild so identical data is a no-op.
  const buildPayload = useMemo(() => ({
    walls, doors, windows,
    roof_type: roofType, roof_pitch_deg: roofPitch,
    wall_color: wallColor, roof_color: roofColor,
    sheets: blueprint.sheets || [],
    wall_height_ft: blueprint.wall_height_ft,
    manual_override: blueprint.manual_override,
  }), [walls, doors, windows, roofType, roofPitch, wallColor, roofColor, blueprint.sheets, blueprint.wall_height_ft, blueprint.manual_override]);
  const buildHash = useMemo(() => JSON.stringify(buildPayload), [buildPayload]);
  const lastBuildHashRef = useRef(null);
  useEffect(() => {
    if (!engineRef.current) return;
    if (lastBuildHashRef.current === buildHash) return;   // identical → skip
    lastBuildHashRef.current = buildHash;
    engineRef.current.build(buildPayload);
    engineRef.current.setVisibility(visibleLayers);
  }, [buildHash]);

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
  // Held export state — { kind: 'image'|'video', url, blob, filename, sizeMb }
  // When non-null, the export preview modal is shown.
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
      // Keep URL alive briefly so the download can start, then revoke
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

  // ---------- Tape measure ----------
  // Load saved measurements for this project
  useEffect(() => {
    if (!currentProjectId) { setMeasurements([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("cm_token");
        const { data } = await axios.get(
          `${API}/projects/${currentProjectId}/measurements`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!cancelled) {
          setMeasurements(data || []);
          engineRef.current?.setMeasurements(data || []);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [currentProjectId]);

  // Sync measurements into the scene whenever they load (from the initial
  // fetch effect above) or the engine finishes mounting. Prior version had
  // `[]` deps and fired before `measurements` was populated → dead code.
  useEffect(() => {
    engineRef.current?.setMeasurements(measurements);
  }, [measurements]);

  const persistMeasurement = useCallback(async ({ start, end, distance_ft }) => {
    if (!currentProjectId) return;
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/measurements`,
        { start, end, distance_ft },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMeasurements((prev) => [...prev, data]);
      engineRef.current?.addMeasurement(data);
      return data;
    } catch (e) {
      alert("Failed to save measurement: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId]);

  const deleteMeasurement = useCallback(async (id) => {
    if (!currentProjectId) return;
    try {
      const token = localStorage.getItem("cm_token");
      await axios.delete(
        `${API}/projects/${currentProjectId}/measurements/${id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMeasurements((prev) => prev.filter((m) => m.id !== id));
      engineRef.current?.removeMeasurement(id);
    } catch (e) {
      alert("Failed to delete: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId]);

  const startMeasure = useCallback(() => {
    if (!engineRef.current) return;
    setMeasuring(true);
    setPickStatus("idle");
    setMeasurePreview(null);
    engineRef.current.setSnapEnabled(snapEnabled);
    engineRef.current.enableMeasureTool(true, (action, payload) => {
      if (action === "first-pick") {
        setPickStatus("first");
        setMeasurePreview(null);
      } else if (action === "cancel-pick") {
        setPickStatus("idle");
      } else if (action === "measured") {
        setPickStatus("measured");
        setMeasurePreview(payload);
        persistMeasurement(payload);
        // Reset for next measurement
        setTimeout(() => setPickStatus("idle"), 200);
      }
    });
  }, [snapEnabled, persistMeasurement]);

  const stopMeasure = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.enableMeasureTool(false);
    setMeasuring(false);
    setPickStatus("idle");
    setMeasurePreview(null);
  }, []);

  const toggleSnap = useCallback(() => {
    setSnapEnabled((prev) => {
      const next = !prev;
      engineRef.current?.setSnapEnabled(next);
      return next;
    });
  }, []);

  const fmtFtIn = useCallback((ft) => {
    if (engineRef.current?.formatFtIn) return engineRef.current.formatFtIn(ft);
    return fallbackFmtFtIn(ft);
  }, []);

  const buildLandscape = useCallback(async () => {
    if (!currentProjectId || !site) return;
    setBuildingLandscape(true);
    setLandscapeError("");
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/site/build-3d`,
        {},
        { headers: { Authorization: `Bearer ${token}` }, timeout: 90_000 },
      );
      setSite((s) => s ? { ...s, terrain_3d: data } : s);
      const stats = engineRef.current?.setSiteTerrain(
        { ...site, terrain_3d: data }, data, { verticalExaggeration: verticalExag },
      );
      setTerrainStats(stats || null);
      // Auto-tilt camera to oblique angle so the user immediately sees the 3D shape
      engineRef.current?.tiltCameraOblique();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setLandscapeError(typeof d === "string" ? d : (e?.message || "Build 3D landscape failed"));
    } finally {
      setBuildingLandscape(false);
    }
  }, [currentProjectId, site, verticalExag]);

  const onExagChange = useCallback((v) => {
    const value = Math.max(1, Math.min(10, Number(v) || 1));
    setVerticalExag(value);
    if (site?.terrain_3d && engineRef.current?.setTerrainExaggeration) {
      const stats = engineRef.current.setTerrainExaggeration(value, site, site.terrain_3d);
      setTerrainStats(stats || null);
    }
  }, [site]);

  // Persist a new features_3d list, re-render the scene.
  const persistFeatures = useCallback(async (newFeatures) => {
    if (!currentProjectId || !site?.terrain_3d) return;
    const nextTerrain = { ...site.terrain_3d, features_3d: newFeatures };
    const nextSite = { ...site, terrain_3d: nextTerrain };
    setSite(nextSite);
    const stats = engineRef.current?.setSiteTerrain(
      nextSite, nextTerrain, { verticalExaggeration: verticalExag },
    );
    setTerrainStats(stats || null);
    try {
      const token = localStorage.getItem("cm_token");
      await axios.patch(
        `${API}/projects/${currentProjectId}/site/terrain/features`,
        { features_3d: newFeatures },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (e) {
      alert("Failed to save: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, site, verticalExag]);

  const toggleFeatureHidden = useCallback((idx) => {
    const list = site?.terrain_3d?.features_3d || [];
    const next = list.map((f, i) => i === idx ? { ...f, hidden: !f.hidden } : f);
    persistFeatures(next);
  }, [site, persistFeatures]);

  const deleteFeature = useCallback((idx) => {
    const list = site?.terrain_3d?.features_3d || [];
    const next = list.filter((_, i) => i !== idx);
    persistFeatures(next);
  }, [site, persistFeatures]);

  const clearLandscape = useCallback(async () => {
    if (!currentProjectId || !site) return;
    try {
      const token = localStorage.getItem("cm_token");
      await axios.delete(
        `${API}/projects/${currentProjectId}/site/build-3d`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setSite((s) => {
        if (!s) return s;
        const next = { ...s };
        delete next.terrain_3d;
        return next;
      });
      setTerrainStats(null);
      engineRef.current?.clearSiteTerrain();
    } catch (e) {
      alert("Failed to clear landscape: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, site]);

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
          {!measuring ? (
            <button
              data-testid="renderer-measure-start"
              onClick={startMeasure}
              className="label-mono px-3 py-2 bg-black/80 border border-[#FFCC00]/60 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black transition-colors flex items-center gap-2"
              title="Tape measure — click two points to measure in feet & inches"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 7h18v6H3z"/>
                <path d="M6 7v3M9 7v2M12 7v3M15 7v2M18 7v3"/>
              </svg>
              TAPE MEASURE
            </button>
          ) : (
            <button
              data-testid="renderer-measure-stop"
              onClick={stopMeasure}
              className="label-mono px-3 py-2 bg-[#FFCC00] text-black border border-[#FFCC00] hover:bg-[#E6B800] transition-colors flex items-center gap-2"
              title="Exit tape measure tool"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M6 18L18 6"/></svg>
              EXIT MEASURE
            </button>
          )}
          <button
            data-testid="renderer-fit-camera"
            onClick={() => engineRef.current?.fitCamera()}
            disabled={empty}
            className="label-mono px-3 py-2 bg-black/80 border border-white/20 text-neutral-200 hover:bg-white hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            title="Re-center camera on the model"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/>
              <rect x="9" y="9" width="6" height="6"/>
            </svg>
            FIT
          </button>
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

        {measuring && (
          <div
            data-testid="measure-tool-panel"
            className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-black/90 border border-[#FFCC00]/40 backdrop-blur-sm px-5 py-4 w-[480px] max-w-[95%]"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="label-mono text-[#FFCC00]">// TAPE MEASURE · 1 FT = 1 FT</div>
                <div className="text-xs text-neutral-400 font-mono mt-1">
                  {pickStatus === "first"
                    ? "Click the second point to measure. ESC to cancel."
                    : "Click two points on the ground or model. Snaps to 1' grid, wall corners & previous endpoints."}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-mono cursor-pointer select-none" title="Toggle snap-to-grid + corners">
                <input
                  data-testid="measure-snap-toggle"
                  type="checkbox"
                  checked={snapEnabled}
                  onChange={toggleSnap}
                  className="accent-[#FFCC00]"
                />
                <span className={snapEnabled ? "text-[#FFCC00]" : "text-neutral-500"}>SNAP</span>
              </label>
            </div>

            {measurePreview && pickStatus === "measured" && (
              <div data-testid="measure-last-result" className="mb-3 border border-[#FFCC00]/40 bg-[#FFCC00]/10 px-3 py-2">
                <div className="label-mono text-neutral-400">// LAST MEASUREMENT</div>
                <div className="font-display text-2xl text-[#FFCC00] tracking-tight">
                  {fmtFtIn(measurePreview.distance_ft)}
                </div>
                <div className="text-[10px] font-mono text-neutral-500">
                  {measurePreview.distance_ft.toFixed(2)} ft ({(measurePreview.distance_ft * 0.3048).toFixed(2)} m)
                </div>
              </div>
            )}

            <div className="max-h-[220px] overflow-y-auto border border-white/10">
              {measurements.length === 0 ? (
                <div className="px-3 py-4 text-xs font-mono text-neutral-500 text-center">
                  No measurements yet. Click two points to add one.
                </div>
              ) : (
                <ul data-testid="measurement-list">
                  {measurements.map((m, i) => (
                    <li
                      key={m.id}
                      data-testid={`measurement-row-${i}`}
                      className="flex items-center justify-between px-3 py-2 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03]"
                    >
                      <div className="flex items-center gap-3">
                        <span className="label-mono text-neutral-600 w-6">#{i + 1}</span>
                        <span className="font-mono text-sm text-[#FFCC00]">{fmtFtIn(m.distance_ft)}</span>
                        <span className="text-[10px] font-mono text-neutral-500">({m.distance_ft.toFixed(2)} ft)</span>
                      </div>
                      <button
                        data-testid={`measurement-delete-${i}`}
                        onClick={() => deleteMeasurement(m.id)}
                        className="text-neutral-500 hover:text-[#FF6666] text-xs font-mono px-2"
                        title="Delete measurement"
                      >✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between mt-3 text-[10px] font-mono text-neutral-500">
              <span>Total: <span className="text-[#FFCC00]">{measurements.length}</span></span>
              <span>{measurements.length > 0 && `Sum: ${fmtFtIn(measurements.reduce((s, m) => s + m.distance_ft, 0))}`}</span>
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

              {/* ---- 3D Landscape generator ---- */}
              <div className="mt-3 border-t border-white/10 pt-3">
                {site?.terrain_3d ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="label-mono text-[#88EEAA]">// 3D LANDSCAPE · ACTIVE</span>
                      <button
                        data-testid="renderer-landscape-clear"
                        onClick={clearLandscape}
                        className="label-mono text-neutral-500 hover:text-[#FF6666] text-[10px] px-2 py-0.5 border border-white/10"
                        title="Remove the 3D landscape and return to flat satellite plane"
                      >✕ CLEAR</button>
                    </div>
                    <div className="text-[10px] font-mono text-neutral-500">
                      Heightmap: {site.terrain_3d.grid_n}×{site.terrain_3d.grid_n} ·{" "}
                      {site.terrain_3d.features_3d?.length || 0} feature{(site.terrain_3d.features_3d?.length||0) === 1 ? "" : "s"}
                    </div>
                    {terrainStats && (
                      <div data-testid="terrain-elev-readout" className="text-[10px] font-mono text-neutral-400 border border-white/10 px-2 py-1.5 bg-white/[0.02]">
                        <div className="flex justify-between">
                          <span>Elevation Δ:</span>
                          <span className="text-[#88EEAA]">{terrainStats.delta_ft.toFixed(1)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Range:</span>
                          <span className="text-neutral-300">{terrainStats.elevation_min_m.toFixed(0)}–{terrainStats.elevation_max_m.toFixed(0)} m ASL</span>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="label-mono text-neutral-500">VERTICAL EXAGGERATION</span>
                        <span className="label-mono text-[#FFCC00]">{verticalExag.toFixed(1)}×</span>
                      </div>
                      <input
                        data-testid="terrain-exaggeration"
                        type="range"
                        min="1"
                        max="10"
                        step="0.5"
                        value={verticalExag}
                        onChange={(e) => onExagChange(e.target.value)}
                        className="w-full accent-[#FFCC00]"
                      />
                      <div className="flex justify-between text-[9px] font-mono text-neutral-600">
                        <span>1× real</span><span>3× dramatic</span><span>10× extreme</span>
                      </div>
                    </div>
                    <button
                      data-testid="renderer-landscape-rebuild"
                      onClick={buildLandscape}
                      disabled={buildingLandscape}
                      className="w-full label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5 disabled:opacity-40"
                    >
                      {buildingLandscape ? "REBUILDING…" : "↻ REBUILD 3D"}
                    </button>

                    {/* ---- Zoning compliance for the rendered landscape ---- */}
                    {site.terrain_3d.compliance && (
                      <div data-testid="terrain-compliance" className="mt-2 border border-white/10 p-2 text-[11px] font-mono">
                        {site.terrain_3d.compliance.clean ? (
                          <div className="text-[#88EEAA] flex items-center gap-1.5">
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>
                            No zoning red flags detected.
                          </div>
                        ) : (
                          <>
                            <div className="font-bold text-[#FFCC00] mb-1">
                              {site.terrain_3d.compliance.warn_count} zoning warning{site.terrain_3d.compliance.warn_count === 1 ? "" : "s"}
                            </div>
                            <ul className="space-y-1">
                              {site.terrain_3d.compliance.warnings.slice(0, 4).map((w, i) => (
                                <li key={i} className="text-[#FFCC00]">
                                  <span className="opacity-70">[{w.code}]</span> {w.message}
                                </li>
                              ))}
                              {site.terrain_3d.compliance.warnings.length > 4 && (
                                <li className="text-neutral-500">… +{site.terrain_3d.compliance.warnings.length - 4} more</li>
                              )}
                            </ul>
                            <div className="text-[10px] text-neutral-500 mt-1.5">Verify against local zoning — limits vary by jurisdiction.</div>
                          </>
                        )}
                      </div>
                    )}

                    {/* ---- Per-feature controls (hide / delete) ---- */}
                    {(site.terrain_3d.features_3d?.length || 0) > 0 && (
                      <div data-testid="terrain-features-list" className="mt-2 border border-white/10 max-h-[220px] overflow-y-auto">
                        <div className="label-mono text-neutral-500 px-2 pt-2 pb-1 sticky top-0 bg-black/80 backdrop-blur-sm">
                          // FEATURES ({site.terrain_3d.features_3d.length})
                        </div>
                        <ul>
                          {site.terrain_3d.features_3d.map((f, i) => {
                            const icon = ({
                              tree: "🌲", trees: "🌲", building: "▣",
                              water: "≋", road: "═", driveway: "═",
                              vegetation: "♣", rock: "◆", slope: "△",
                            })[String(f.kind || "").toLowerCase()] || "●";
                            return (
                              <li
                                key={i}
                                data-testid={`terrain-feature-row-${i}`}
                                className={`flex items-center gap-2 px-2 py-1.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] ${f.hidden ? "opacity-50" : ""}`}
                              >
                                <span className="font-mono text-base w-5 text-center text-neutral-400">{icon}</span>
                                <span className="text-[11px] font-mono text-neutral-300 flex-1 truncate">
                                  {f.label || f.kind}
                                  {f.stories ? <span className="text-neutral-500"> · {f.stories}st</span> : null}
                                </span>
                                <button
                                  data-testid={`terrain-feature-hide-${i}`}
                                  onClick={() => toggleFeatureHidden(i)}
                                  className="label-mono text-neutral-500 hover:text-[#FFCC00] text-[10px] px-1.5 py-0.5 border border-white/10"
                                  title={f.hidden ? "Show this feature" : "Hide this feature (kept in DB)"}
                                >
                                  {f.hidden ? "show" : "hide"}
                                </button>
                                <button
                                  data-testid={`terrain-feature-delete-${i}`}
                                  onClick={() => {
                                    if (window.confirm(`Delete "${f.label || f.kind}"?`)) deleteFeature(i);
                                  }}
                                  className="label-mono text-neutral-500 hover:text-[#FF6666] text-[10px] px-1.5 py-0.5 border border-white/10"
                                  title="Permanently delete this feature"
                                >✕</button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    data-testid="renderer-landscape-build"
                    onClick={buildLandscape}
                    disabled={buildingLandscape}
                    className="w-full label-mono px-3 py-2 bg-gradient-to-r from-[#2D5C2D]/30 to-[#FFCC00]/20 border border-[#88EEAA]/50 text-[#88EEAA] hover:from-[#2D5C2D] hover:to-[#FFCC00] hover:text-black disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                    title="Generate 3D heightmap terrain + extrude AI-detected trees, buildings, water, etc."
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 19l5-7 4 3 3-5 6 9z"/>
                      <circle cx="7" cy="7" r="2"/>
                    </svg>
                    {buildingLandscape ? "BUILDING 3D…" : "✦ BUILD 3D LANDSCAPE"}
                  </button>
                )}
                {landscapeError && (
                  <div data-testid="renderer-landscape-error" className="mt-2 border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-[11px] font-mono px-3 py-2 leading-relaxed">
                    {landscapeError}
                  </div>
                )}
                {!site?.terrain_3d && !buildingLandscape && !landscapeError && (
                  <p className="text-[10px] font-mono text-neutral-500 mt-2 leading-relaxed">
                    Generates real terrain elevation (Google Elevation API) + extrudes AI-detected
                    trees, buildings, water, roads, rocks, and vegetation as 3D objects.
                  </p>
                )}
              </div>
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

        {/* Autonomous validation-gated extraction pipeline. */}
        <div className="mb-6">
          <AutonomousExtractPanel
            onLayout={(layout) => {
              // Seed the current session with the validated walls so the
              // 3D scene rebuilds from the extracted layout. Non-persistent
              // — user can Save & Sync from the CAD tab to make it stick.
              if (!layout?.walls?.length) return;
              const walls = layout.walls.map((w, i) => ({
                id: w.id || `auto-w${i + 1}`,
                start: w.start,
                end: w.end,
                thickness: w.thickness_ft,
              }));
              useStore.setState((s) => ({
                blueprint: { ...s.blueprint, walls, building_ft: layout.building_ft || s.blueprint.building_ft },
              }));
            }}
          />
        </div>

        <div className="label-mono mb-2">// ROOF & FINISH</div>
        <div className="space-y-3 mb-6">
          {(() => {
            const sheets = blueprint.sheets || [];
            const elevs = sheets.filter((s) => s.view_type === "elevation" && s.assembly_data);
            const roofSheets = sheets.filter((s) => s.view_type === "roof_plan" && s.assembly_data);
            const wallTopFt = (() => {
              const heights = elevs.map((s) => Number(s.assembly_data?.wall_top_ft || 0)).filter((v) => v > 3 && v < 100);
              if (!heights.length) return null;
              heights.sort((a, b) => a - b);
              return heights[Math.floor(heights.length / 2)];
            })();
            const active = (elevs.length || roofSheets.length) && !blueprint.manual_override;
            if (!active && !elevs.length && !roofSheets.length) return null;
            return (
              <div data-testid="renderer-assembly-panel" className="border border-white/10 p-3 bg-black/40 space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="label-mono text-[#00E5FF]">// ASSEMBLY</span>
                  <span className={`label-mono ${active ? "text-[#FFCC00]" : "text-neutral-500"}`}>{active ? "ACTIVE" : "OVERRIDE"}</span>
                </div>
                <div className="text-xs text-neutral-300 leading-relaxed">
                  {active ? (
                    <>Building assembled from{" "}
                      <span className="text-white">{elevs.length}</span> elevation{elevs.length === 1 ? "" : "s"}
                      {roofSheets.length > 0 && <> + <span className="text-white">{roofSheets.length}</span> roof plan{roofSheets.length === 1 ? "" : "s"}</>}.</>
                  ) : (
                    <>Manual override active — AI-extracted assembly data is ignored.</>
                  )}
                </div>
                {wallTopFt && (
                  <div className="text-[10px] font-mono text-neutral-500">// wall height: {wallTopFt.toFixed(1)} ft</div>
                )}
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    data-testid="renderer-manual-override"
                    type="checkbox"
                    checked={!!blueprint.manual_override}
                    onChange={(e) => updateCfg({ manual_override: e.target.checked })}
                  />
                  <span>Force manual values</span>
                </label>
              </div>
            );
          })()}
          <label className="block">
            <div className="label-mono mb-1 flex justify-between">
              <span>Wall height (ft)</span>
              <span className="text-[#FFCC00]">{blueprint.wall_height_ft || 10} ft</span>
            </div>
            <input
              data-testid="renderer-wall-height"
              type="range" min="6" max="30" step="0.5"
              value={blueprint.wall_height_ft ?? 10}
              onChange={(e) => updateCfg({ wall_height_ft: Number(e.target.value) })}
              className="w-full accent-[#FFCC00]"
            />
          </label>
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

      {pendingExport && (
        <div
          data-testid="export-preview-modal"
          className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={(e) => { if (e.target === e.currentTarget) closeExportPreview(); }}
        >
          <div className="bg-[#0a0a0a] border border-[#FFCC00]/40 max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="label-mono text-[#FFCC00]">
                  // {pendingExport.kind === "image" ? "STUDIO RENDER · READY" : "WALKTHROUGH · READY"}
                </div>
                <div className="text-[10px] font-mono text-neutral-500 mt-1">
                  {pendingExport.kind === "image"
                    ? `${pendingExport.width} × ${pendingExport.height} · ${pendingExport.sizeMb} MB · PNG`
                    : `${pendingExport.duration}s · ${pendingExport.sizeMb} MB · WebM`}
                </div>
              </div>
              <button
                data-testid="export-preview-close"
                onClick={closeExportPreview}
                className="text-neutral-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center border border-white/10 hover:border-white/30"
                title="Close without downloading"
              >✕</button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-[#111] p-4 flex items-center justify-center">
              {pendingExport.kind === "image" ? (
                <img
                  data-testid="export-preview-image"
                  src={pendingExport.url}
                  alt="Studio render preview"
                  className="max-w-full max-h-[60vh] object-contain border border-white/10"
                />
              ) : (
                <video
                  data-testid="export-preview-video"
                  src={pendingExport.url}
                  controls
                  autoPlay
                  loop
                  className="max-w-full max-h-[60vh] border border-white/10"
                />
              )}
            </div>

            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
              <div className="text-xs font-mono text-neutral-500">
                {pendingExport.kind === "image"
                  ? "Review the still. Download saves a 4K PNG to your computer."
                  : "Review the walkthrough. Download saves the WebM to your computer."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  data-testid="export-preview-discard"
                  onClick={closeExportPreview}
                  className="label-mono px-4 py-2 border border-white/15 hover:bg-white/5 text-xs"
                >DISCARD</button>
                <button
                  data-testid="export-preview-download"
                  onClick={downloadPendingExport}
                  className="label-mono px-5 py-2 bg-[#FFCC00] hover:bg-[#E6B800] text-black text-xs flex items-center gap-2"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 3v12M6 11l6 6 6-6M5 21h14"/>
                  </svg>
                  DOWNLOAD
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
