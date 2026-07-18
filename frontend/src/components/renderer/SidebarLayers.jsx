import React from "react";
import { ALL_LAYERS } from "../../lib/renderer/sceneBuilder";

/**
 * Layer visibility list. Toggling any checkbox flips the parent into
 * MANUAL mode and updates the per-layer overrides map.
 */
export function SidebarLayers({ visibleLayers, setAutoMode, setLayerOverrides }) {
  return (
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
  );
}
