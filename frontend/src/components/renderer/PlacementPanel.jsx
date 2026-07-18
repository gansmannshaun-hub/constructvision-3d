import React from "react";

/**
 * Floating panel shown while the user is dragging the 3D model on the
 * satellite plane. Contains rotation & display-scale sliders plus an
 * "AI Match" entry-point and save/cancel actions.
 */
export function PlacementPanel({
  transform, onRotationChange, onScaleChange, onReset,
  onOpenAIMatch, savingTransform, onSave, onCancel,
}) {
  return (
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
          onClick={onReset}
          className="label-mono text-neutral-500 hover:text-white px-2 py-1 border border-white/10 hover:border-white/30"
          title="Reset to (0, 0, 0°)"
        >
          ↺ reset
        </button>
      </div>

      <button
        data-testid="renderer-ai-match-open"
        onClick={onOpenAIMatch}
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
          onClick={onSave}
          disabled={savingTransform}
          className="flex-1 bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2 text-xs uppercase tracking-wider"
        >
          {savingTransform ? "Saving…" : "Save placement"}
        </button>
        <button
          data-testid="renderer-place-cancel"
          onClick={onCancel}
          className="px-4 py-2 text-xs uppercase tracking-wider border border-white/15 text-neutral-300 hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
