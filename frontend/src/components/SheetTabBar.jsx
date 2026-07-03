import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Sheet tab bar rendered above the CAD toolbar. Displays every blueprint sheet
 * for the current project. When many sheets are open the bar scrolls horizontally
 * with left/right arrow buttons, auto-tightens tab widths for a compact fit, and
 * scrolls the active tab into view.
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
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useLayoutEffect(() => { updateScrollButtons(); }, [sheets]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateScrollButtons();
    const ro = new ResizeObserver(updateScrollButtons);
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  // Auto-scroll active tab into view when it changes.
  useEffect(() => {
    if (!activeRef.current) return;
    activeRef.current.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
  }, [activeSheetId]);

  const scrollBy = (delta) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  if (!sheets || sheets.length === 0) return null;

  const REF_ONLY = new Set([
    "framing_plan", "roof_plan", "sheathing_plan", "elevation",
    "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
  ]);

  // Compact tabs when >8 sheets — shrinks min-width so more fit on screen.
  const compact = sheets.length > 8;
  const tabMinW = compact ? "min-w-[110px]" : "min-w-[160px]";
  const tabMaxW = compact ? "max-w-[160px]" : "max-w-[240px]";

  return (
    <div
      data-testid="cad-sheet-tabs"
      className="relative flex items-stretch bg-[#1a1a1a] text-white border-b border-black flex-shrink-0"
    >
      {canScrollLeft && (
        <button
          data-testid="cad-sheet-scroll-left"
          onClick={() => scrollBy(-240)}
          className="absolute left-0 top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-[#1a1a1a]/90 hover:bg-[#2a2a2a] text-[#FFCC00] border-r border-black"
          title="Scroll tabs left"
        >
          ‹
        </button>
      )}
      <div
        ref={scrollerRef}
        className="flex items-stretch overflow-x-auto flex-1 scrollbar-thin"
        style={{
          paddingLeft: canScrollLeft ? 24 : 0,
          paddingRight: canScrollRight ? 24 : 0,
          scrollbarWidth: "thin",
        }}
      >
        {sheets.map((s) => {
          const isActive = s.id === activeSheetId;
          const isRef = REF_ONLY.has(s.view_type || "");
          return (
            <div
              ref={isActive ? activeRef : null}
              key={s.id}
              data-testid={`cad-sheet-tab-${s.id}`}
              className={`group flex items-center gap-2 pl-3 pr-1 border-r border-black ${tabMinW} ${tabMaxW} cursor-pointer transition-colors flex-shrink-0 ${
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
      </div>
      {canScrollRight && (
        <button
          data-testid="cad-sheet-scroll-right"
          onClick={() => scrollBy(240)}
          className="absolute right-[44px] top-0 bottom-0 z-10 w-6 flex items-center justify-center bg-[#1a1a1a]/90 hover:bg-[#2a2a2a] text-[#FFCC00] border-l border-black"
          title="Scroll tabs right"
        >
          ›
        </button>
      )}
      <button
        data-testid="cad-sheet-add"
        onClick={onCreate}
        className="min-w-[44px] px-3 border-l border-black text-lg text-[#FFCC00] hover:bg-[#2a2a2a] flex-shrink-0"
        title="Add a blank sheet"
      >
        +
      </button>
      {sheets.length > 3 && (
        <span
          data-testid="cad-sheet-count"
          className="hidden md:flex items-center px-3 border-l border-black text-[10px] font-mono text-neutral-400 flex-shrink-0"
          title="Total sheets"
        >
          {sheets.length} sheets
        </span>
      )}
    </div>
  );
}

export default SheetTabBar;
