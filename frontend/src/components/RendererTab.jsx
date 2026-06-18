import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  createSceneEngine,
  PHASES,
  MAX_PHASE,
  ALL_LAYERS,
  ROOF_TYPES,
  DEFAULT_CFG,
} from "../lib/renderer/sceneBuilder";

export default function RendererTab() {
  const { blueprint, saveBlueprint } = useStore();
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

  const empty = walls.length === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] grid-rows-[1fr_auto] lg:grid-rows-1 h-full" data-testid="renderer-tab">
      <section className="relative min-h-[60vh] lg:min-h-0 border-b border-white/10 lg:border-b-0">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm pointer-events-none">
          <div className="label-mono">// CONSTRUCTION PHASE</div>
          <div className="font-display text-lg tracking-tighter">{PHASES[phase].label}</div>
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
    </div>
  );
}
