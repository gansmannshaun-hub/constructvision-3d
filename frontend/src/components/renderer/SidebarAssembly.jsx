import React from "react";
import { ROOF_TYPES } from "../../lib/renderer/sceneBuilder";

/**
 * Roof & finish panel: assembly readout, wall height slider, roof
 * type/pitch selector, and wall/roof color pickers.
 */
export function SidebarAssembly({ blueprint, roofType, roofPitch, wallColor, roofColor, savingCfg, updateCfg }) {
  const sheets = blueprint.sheets || [];
  const elevs = sheets.filter((s) => s.view_type === "elevation" && s.assembly_data);
  const roofSheets = sheets.filter((s) => s.view_type === "roof_plan" && s.assembly_data);
  const heights = elevs
    .map((s) => Number(s.assembly_data?.wall_top_ft || 0))
    .filter((v) => v > 3 && v < 100)
    .sort((a, b) => a - b);
  const wallTopFt = heights.length ? heights[Math.floor(heights.length / 2)] : null;
  const active = (elevs.length || roofSheets.length) && !blueprint.manual_override;
  const showAssemblyCard = active || elevs.length || roofSheets.length;

  return (
    <div className="space-y-3 mb-6">
      {showAssemblyCard && (
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
      )}
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
  );
}
