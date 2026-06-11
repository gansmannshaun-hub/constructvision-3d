import React, { useMemo } from "react";
import { useStore } from "../store";

const CATEGORY_COLORS = {
  Structural: "#0055FF",
  Framing: "#FFCC00",
  Electrical: "#FF8800",
  Plumbing: "#00CCFF",
  Finishes: "#CC66FF",
  HVAC: "#00CC66",
  Insulation: "#FFAA88",
  Roofing: "#FF5577",
  "Doors & Windows": "#88FF66",
  Other: "#888888",
};

export default function MaterialsTab() {
  const { materials } = useStore();
  const grouped = useMemo(() => {
    const m = {};
    for (const mat of materials) {
      const k = mat.category || "Other";
      (m[k] ||= []).push(mat);
    }
    return m;
  }, [materials]);

  const aiCount = materials.filter((m) => m.ai_extracted).length;
  const categories = Object.keys(grouped);

  return (
    <div className="h-full overflow-y-auto p-8" data-testid="materials-tab">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div className="label-mono mb-1">// AUTO-EXTRACTED</div>
          <h2 className="font-display text-3xl tracking-tighter">Materials</h2>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-1 mb-8 border border-white/10">
        <div className="p-5 border-r border-white/10">
          <div className="label-mono">TOTAL ITEMS</div>
          <div className="font-mono text-3xl mt-2" data-testid="materials-total">{materials.length}</div>
        </div>
        <div className="p-5 border-r border-white/10">
          <div className="label-mono">CATEGORIES</div>
          <div className="font-mono text-3xl mt-2" data-testid="materials-categories">{categories.length}</div>
        </div>
        <div className="p-5">
          <div className="label-mono text-[#FFCC00]">AI EXTRACTED</div>
          <div className="font-mono text-3xl mt-2 text-[#FFCC00]" data-testid="materials-ai-count">{aiCount}</div>
        </div>
      </div>

      {materials.length === 0 ? (
        <div className="border border-white/10 p-12 text-center text-neutral-500 font-mono text-sm">
          No materials yet. Upload a blueprint and AI will auto-populate this list.
        </div>
      ) : (
        <div className="space-y-8">
          {categories.map((cat) => (
            <section key={cat}>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-3 h-3"
                  style={{ background: CATEGORY_COLORS[cat] || "#888" }}
                />
                <div className="label-mono">{cat}</div>
                <div className="flex-1 border-b border-white/10" />
                <div className="label-mono">{grouped[cat].length} items</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
                {grouped[cat].map((m) => (
                  <article
                    key={m.id}
                    data-testid={`material-${m.id}`}
                    className="border border-white/10 bg-[#141414] hover:bg-[#1A1A1A] transition-colors p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium leading-tight">{m.name}</div>
                      {m.ai_extracted && (
                        <span className="label-mono bg-[#FFCC00]/15 border border-[#FFCC00]/40 text-[#FFCC00] px-2 py-0.5 whitespace-nowrap">
                          AI
                        </span>
                      )}
                    </div>
                    <div className="mt-3 flex items-baseline gap-1 font-mono">
                      <span className="text-2xl">{m.quantity || "—"}</span>
                      <span className="text-neutral-500 text-xs">{m.unit}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
