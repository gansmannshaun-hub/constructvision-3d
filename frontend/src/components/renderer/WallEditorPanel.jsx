import React from "react";
import { formatFeetInches } from "../../lib/dim";

/**
 * Floating panel shown while the 3D wall editor is active. Sits at the
 * bottom-center; shows the selected wall's stats and the mutating tools.
 */
export function WallEditorPanel({
  selected, cutMode, setCutMode, busy, error,
  onDelete, onUndo, onRedo, canUndo, canRedo,
  onSetHeight,
  selectedRoof, blueprintRoof, onSetRoof,
  onExit,
}) {
  const heightFt = Number(selected?.height_ft) > 0 ? Number(selected.height_ft) : 10;
  const ROOF_TYPES = [
    { id: "gable",   label: "Gable" },
    { id: "hip",     label: "Hip" },
    { id: "shed",    label: "Shed" },
    { id: "flat",    label: "Flat" },
    { id: "gambrel", label: "Gambrel" },
  ];
  return (
    <div
      data-testid="wall-editor-panel"
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-black/90 border border-[#FFCC00]/50 backdrop-blur-sm px-5 py-4 w-[520px] max-w-[95%]"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="label-mono text-[#FFCC00]">// EDIT WALLS · 3D</div>
          <div className="text-xs text-neutral-400 font-mono mt-1">
            {cutMode
              ? "CUT — click any wall to split at that point. ESC cancels."
              : selectedRoof
              ? "Roof selected. Change type / pitch / color below."
              : selected
              ? "Wall selected. DEL removes · CUT splits at click point."
              : "Click any wall or roof in the 3D view to select it."}
          </div>
        </div>
        <button
          data-testid="wall-editor-exit"
          onClick={onExit}
          className="label-mono text-neutral-400 hover:text-white text-xs px-2 py-1 border border-white/15 hover:border-white/30"
          title="Exit edit mode"
        >EXIT</button>
      </div>

      {selected && !cutMode && (
        <div className="border border-[#FFCC00]/30 bg-[#FFCC00]/5 p-3 mb-3 text-xs font-mono">
          <div className="label-mono text-neutral-500 mb-1">// SELECTED WALL</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-neutral-300">
            <div>id: <span className="text-[#FFCC00]">{String(selected.wall_id).slice(0, 10)}…</span></div>
            <div>length: <span className="text-[#FFCC00]">{formatFeetInches(selected.length_ft)}</span></div>
            <div>start: <span className="text-neutral-400">{selected.start[0].toFixed(1)}, {selected.start[1].toFixed(1)}</span></div>
            <div>end: <span className="text-neutral-400">{selected.end[0].toFixed(1)}, {selected.end[1].toFixed(1)}</span></div>
          </div>
          <div className="text-[10px] text-[#00E5FF] mt-2 font-mono">
            💡 Drag the cyan spheres on this wall&apos;s endpoints to reshape it.
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="label-mono text-neutral-500">HEIGHT</span>
              <span className="label-mono text-[#FFCC00]">{heightFt.toFixed(1)} ft</span>
            </div>
            <input
              data-testid="wall-editor-height"
              type="range" min="4" max="30" step="0.5"
              value={heightFt}
              disabled={busy}
              onChange={(e) => onSetHeight?.(Number(e.target.value))}
              className="w-full accent-[#FFCC00] disabled:opacity-40"
            />
            <div className="flex justify-between text-[9px] font-mono text-neutral-600">
              <span>4</span><span>10</span><span>20</span><span>30 ft</span>
            </div>
          </div>
        </div>
      )}

      {selectedRoof && (
        <div data-testid="roof-editor-card" className="border border-[#00E5FF]/40 bg-[#00E5FF]/5 p-3 mb-3 text-xs font-mono">
          <div className="label-mono text-neutral-500 mb-2">// SELECTED ROOF</div>
          <label className="block mb-2">
            <div className="label-mono text-neutral-500 mb-1">TYPE</div>
            <select
              data-testid="roof-editor-type"
              value={blueprintRoof.type}
              onChange={(e) => onSetRoof?.({ roof_type: e.target.value })}
              disabled={busy}
              className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs disabled:opacity-40"
            >
              {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block mb-2">
            <div className="flex justify-between mb-1">
              <span className="label-mono text-neutral-500">PITCH</span>
              <span className="label-mono text-[#00E5FF]">{blueprintRoof.pitch}°</span>
            </div>
            <input
              data-testid="roof-editor-pitch"
              type="range" min="0" max="45" step="1"
              value={blueprintRoof.pitch}
              disabled={busy || blueprintRoof.type === "flat"}
              onChange={(e) => onSetRoof?.({ roof_pitch_deg: Number(e.target.value) })}
              className="w-full accent-[#00E5FF] disabled:opacity-40"
            />
          </label>
          <label className="block">
            <div className="label-mono text-neutral-500 mb-1">COLOR</div>
            <input
              data-testid="roof-editor-color"
              type="color"
              value={blueprintRoof.color}
              disabled={busy}
              onChange={(e) => onSetRoof?.({ roof_color: e.target.value })}
              className="w-full h-8 bg-black border border-white/15 cursor-pointer disabled:opacity-40"
            />
          </label>
        </div>
      )}

      {error && (
        <div data-testid="wall-editor-error" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-[11px] font-mono px-3 py-2 mb-3">
          {typeof error === "string" ? error : (error?.msg || JSON.stringify(error))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          data-testid="wall-editor-delete"
          onClick={onDelete}
          disabled={!selected || busy || cutMode}
          className="flex-1 label-mono px-3 py-2 bg-[#FF3333] hover:bg-[#DD1111] text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Delete selected wall (Del)"
        >
          {busy ? "…" : "✕ DELETE"}
        </button>
        <button
          data-testid="wall-editor-cut"
          onClick={() => setCutMode((v) => !v)}
          disabled={busy}
          className={`flex-1 label-mono px-3 py-2 border transition-colors disabled:opacity-30 ${
            cutMode
              ? "bg-[#00E5FF] text-black border-[#00E5FF]"
              : "border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black"
          }`}
          title="Toggle cut mode — click a wall to split at that point"
        >
          {cutMode ? "CUT MODE · ESC" : "✂ CUT"}
        </button>
        <button
          data-testid="wall-editor-undo"
          onClick={onUndo}
          disabled={!canUndo() || busy}
          className="label-mono px-3 py-2 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30"
          title="Undo last edit (Ctrl+Z)"
        >↺</button>
        <button
          data-testid="wall-editor-redo"
          onClick={onRedo}
          disabled={!canRedo() || busy}
          className="label-mono px-3 py-2 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30"
          title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        >↻</button>
      </div>
    </div>
  );
}
