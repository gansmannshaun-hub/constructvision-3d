import React from "react";

/**
 * Floating panel shown while the tape-measure tool is active.
 * Displays the last measurement, the persisted list, and a snap toggle.
 */
export function TapeMeasurePanel({
  pickStatus, snapEnabled, onToggleSnap,
  measurePreview, measurements, onDelete, fmtFtIn,
}) {
  return (
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
            onChange={onToggleSnap}
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
                  onClick={() => onDelete(m.id)}
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
  );
}
