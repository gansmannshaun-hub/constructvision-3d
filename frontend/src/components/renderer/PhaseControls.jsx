import React from "react";
import { PHASES, MAX_PHASE } from "../../lib/renderer/sceneBuilder";

/**
 * Bottom overlay: current phase label, play/pause, auto/manual, prev/next,
 * scrub slider, and per-phase labels underneath.
 */
export function PhaseControls({ phase, setPhase, playing, setPlaying, autoMode, setAutoMode }) {
  return (
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
  );
}
