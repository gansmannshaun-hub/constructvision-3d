import React, { useState } from "react";
import { FLOOR_MATERIALS, WALL_MATERIALS, ROOF_MATERIALS } from "../lib/renderer/floorMaterials";

/**
 * Materials Palette — SketchUp-style browse view for every material
 * swatch in the app. Split into three sections: Floor, Wall, Roof.
 *
 * MVP: floor materials are already wired via the 3D Renderer's Room
 * editor (click a room floor → pick from dropdown). Wall + roof
 * swatches are preview-only for now — the "Apply" button just tells
 * the user which editor to open. Full drag-and-apply on the 3D scene
 * is a future session.
 */
export default function MaterialsPalette() {
  const [copied, setCopied] = useState(null);
  const copy = async (id) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch { /* clipboard blocked — ignore */ }
  };

  return (
    <div data-testid="materials-palette" className="space-y-8">
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="label-mono text-[#FF9933]">// FLOOR MATERIALS</div>
          <div className="text-[10px] font-mono text-neutral-500">
            wired via <span className="text-[#FF9933]">3D Renderer → Room editor</span>
          </div>
        </div>
        <SwatchGrid items={FLOOR_MATERIALS} accent="#FF9933" wired copied={copied} onCopy={copy} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="label-mono text-[#5588FF]">// WALL SIDING</div>
          <div className="text-[10px] font-mono text-neutral-500">preview · direct apply coming</div>
        </div>
        <SwatchGrid items={WALL_MATERIALS} accent="#5588FF" copied={copied} onCopy={copy} />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <div className="label-mono text-[#00E5FF]">// ROOF FINISH</div>
          <div className="text-[10px] font-mono text-neutral-500">
            color wired via <span className="text-[#00E5FF]">3D Renderer → Roof editor</span>
          </div>
        </div>
        <SwatchGrid items={ROOF_MATERIALS} accent="#00E5FF" wired copied={copied} onCopy={copy} />
      </div>

      <div className="border border-white/10 bg-black/40 p-4 text-xs font-mono text-neutral-400 leading-relaxed">
        <div className="label-mono text-[#FFCC00] mb-2">// USAGE</div>
        Click any swatch to copy its <span className="text-white">id</span>. Then open the{" "}
        <span className="text-white">3D Renderer → EDIT WALLS</span> mode and click a room floor
        (or roof) to open its editor and pick the material by name. Wall siding + roof-finish
        selectors are on the roadmap.
      </div>
    </div>
  );
}

function SwatchGrid({ items, accent, wired, copied, onCopy }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {items.map((m) => {
        const isCopied = copied === m.id;
        return (
          <button
            key={m.id}
            data-testid={`palette-swatch-${m.id}`}
            onClick={() => onCopy(m.id)}
            className="group text-left border border-white/10 hover:border-white/40 bg-black/30 p-3 transition-colors"
            title={`Copy id "${m.id}"`}
          >
            <div
              className="w-full h-16 mb-2 border border-white/10"
              style={{
                background: m.color,
                // Give a hint of texture — a subtle inner shadow so the
                // swatch reads as a material rather than a flat color.
                boxShadow: `inset 0 -6px 12px rgba(0,0,0,${0.25 + m.roughness * 0.15}), inset 0 3px 6px rgba(255,255,255,${0.06 + m.metalness * 0.1})`,
              }}
            />
            <div className="text-xs text-white font-medium leading-tight">{m.label}</div>
            <div className="mt-1 flex items-center justify-between text-[10px] font-mono">
              <span className="text-neutral-500">{m.id}</span>
              {isCopied ? (
                <span style={{ color: accent }}>✓ copied</span>
              ) : wired ? (
                <span className="text-neutral-600 group-hover:text-neutral-300">click to copy</span>
              ) : (
                <span className="text-neutral-600">preview</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
