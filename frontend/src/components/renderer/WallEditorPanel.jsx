import React from "react";
import { formatFeetInches } from "../../lib/dim";

/**
 * Floating panel shown while the 3D wall editor is active. Sits at the
 * bottom-center; shows the selected wall's stats and the mutating tools.
 */
export function WallEditorPanel({
  selected, cutMode, setCutMode, busy, error,
  onDelete, onUndo, onRedo, canUndo, canRedo,
  onExit,
}) {
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
              : selected
              ? "Wall selected. DEL removes · CUT splits at click point."
              : "Click any wall in the 3D view to select it."}
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
