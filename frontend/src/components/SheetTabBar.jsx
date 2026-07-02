import React from "react";

/**
 * Sheet tab bar rendered above the CAD toolbar. Displays every blueprint sheet
 * for the current project (one sheet per uploaded blueprint OR hand-created).
 * Clicking a tab activates that sheet — its geometry loads into the canvas.
 * Right-click / long-press could later open a context menu; for now we expose
 * rename / floor-level / delete actions directly on the tab.
 */
export function SheetTabBar({
  sheets,
  activeSheetId,
  dirty,
  onActivate,
  onCreate,
  onRename,
  onDelete,
  onChangeFloor,
}) {
  if (!sheets || sheets.length === 0) return null;
  const REF_ONLY = new Set([
    "framing_plan", "roof_plan", "sheathing_plan", "elevation",
    "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
  ]);
  return (
    <div
      data-testid="cad-sheet-tabs"
      className="flex items-stretch bg-[#1a1a1a] text-white border-b border-black overflow-x-auto flex-shrink-0"
    >
      {sheets.map((s) => {
        const isActive = s.id === activeSheetId;
        const isRef = REF_ONLY.has(s.view_type || "");
        return (
          <div
            key={s.id}
            data-testid={`cad-sheet-tab-${s.id}`}
            className={`group flex items-center gap-2 pl-3 pr-1 border-r border-black min-w-[160px] max-w-[240px] cursor-pointer transition-colors ${
              isActive ? "bg-[#F5F5F0] text-black" : "bg-[#1a1a1a] text-neutral-300 hover:bg-[#2a2a2a]"
            }`}
            onClick={() => onActivate(s.id)}
            title={`${(s.view_type || "floor_plan").replace(/_/g, " ")} · Floor ${s.floor_level} · ${s.source_document_id ? "AI-traced" : "hand-drawn"}`}
          >
            <div className="flex-1 min-w-0 py-2">
              <div className="text-xs font-mono font-bold truncate flex items-center gap-1.5">
                {isActive && dirty && <span className="text-[#FF3333]">●</span>}
                {s.name}
              </div>
              <div className={`text-[10px] uppercase tracking-wider flex items-center gap-1.5 ${isActive ? "text-neutral-500" : "text-neutral-500"}`}>
                {isRef ? (
                  <span className={isActive ? "text-[#B87400]" : "text-[#FFAA00]"} title="Not stacked as a floor in 3D — reference underlay only">
                    REF · {(s.view_type || "").replace("_plan", "").toUpperCase()}
                  </span>
                ) : (
                  <span>Floor {s.floor_level}</span>
                )}
                {s.source_document_id && (
                  <span className={isActive ? "text-[#B8860B]" : "text-[#FFCC00]"}>AI</span>
                )}
                {!isRef && (
                  <button
                    data-testid={`cad-sheet-floor-${s.id}`}
                    onClick={(e) => { e.stopPropagation(); onChangeFloor(s.id, s.floor_level); }}
                    className={`hover:underline ${isActive ? "text-neutral-500 hover:text-black" : "text-neutral-500 hover:text-white"}`}
                  >
                    ⇅
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                data-testid={`cad-sheet-rename-${s.id}`}
                onClick={(e) => { e.stopPropagation(); onRename(s.id, s.name); }}
                className={`w-6 h-4 text-[10px] leading-none ${isActive ? "text-neutral-600 hover:text-black" : "text-neutral-400 hover:text-white"}`}
                title="Rename sheet"
              >✎</button>
              <button
                data-testid={`cad-sheet-delete-${s.id}`}
                onClick={(e) => { e.stopPropagation(); onDelete(s.id, s.name); }}
                className={`w-6 h-4 text-[10px] leading-none ${isActive ? "text-neutral-600 hover:text-[#FF3333]" : "text-neutral-400 hover:text-[#FF6666]"}`}
                title="Delete sheet"
              >✕</button>
            </div>
          </div>
        );
      })}
      <button
        data-testid="cad-sheet-add"
        onClick={onCreate}
        className="min-w-[44px] px-3 border-r border-black text-lg text-[#FFCC00] hover:bg-[#2a2a2a]"
        title="Add a blank sheet"
      >
        +
      </button>
    </div>
  );
}

export default SheetTabBar;
