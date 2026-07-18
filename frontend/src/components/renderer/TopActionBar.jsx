import React from "react";

/**
 * Top-right vertical stack of primary scene actions:
 * Studio Render · Walkthrough · Place on Map · Tape Measure · Fit.
 */
export function TopActionBar({
  empty,
  rendering, onRenderStudio,
  recording, recProgress, onRecordWalkthrough,
  site, placing, onStartPlacement,
  measuring, onStartMeasure, onStopMeasure,
  onFitCamera,
}) {
  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
      <button
        data-testid="renderer-studio-render"
        onClick={onRenderStudio}
        disabled={rendering || empty}
        className="label-mono px-3 py-2 bg-black/80 border border-[#FFCC00]/60 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        title="Render high-resolution 4K still"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M8 6V4h8v2" /></svg>
        {rendering ? "RENDERING…" : "STUDIO RENDER (4K)"}
      </button>
      <button
        data-testid="renderer-walkthrough"
        onClick={onRecordWalkthrough}
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
          onClick={onStartPlacement}
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
          onClick={onStartMeasure}
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
          onClick={onStopMeasure}
          className="label-mono px-3 py-2 bg-[#FFCC00] text-black border border-[#FFCC00] hover:bg-[#E6B800] transition-colors flex items-center gap-2"
          title="Exit tape measure tool"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M6 18L18 6"/></svg>
          EXIT MEASURE
        </button>
      )}
      <button
        data-testid="renderer-fit-camera"
        onClick={onFitCamera}
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
  );
}
