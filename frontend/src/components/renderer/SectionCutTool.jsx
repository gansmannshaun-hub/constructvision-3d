import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * Section-cut tool — overlay that lets the user drag a rectangle over
 * the 3D viewport. On release, the engine hides the front-most mesh
 * chunk inside that rectangle (see sceneBuilder.applySectionCut).
 *
 * Rendered as an absolutely-positioned wrapper inside the renderer
 * viewport. `containerRef` points to the same DOM node that holds the
 * WebGL canvas — the SVG covers it 1:1 in CSS px so screen-space rect
 * math is trivial.
 *
 * A polyline/snap variant will be added in a follow-up session.
 */
export function SectionCutTool({ engineRef, containerRef }) {
  const [active, setActive] = useState(false);
  const [dragBox, setDragBox] = useState(null);  // {x, y, width, height} in CSS px, container-local
  const [cuts, setCuts] = useState([]);          // [{id, count}]
  const [error, setError] = useState("");
  const [tolerance, setTolerance] = useState(1.5);   // ft-ish meters window
  const startRef = useRef(null);

  const refreshCuts = useCallback(() => {
    const list = engineRef.current?.getSectionCuts?.() || [];
    setCuts(list);
  }, [engineRef]);

  // Sync engine mode when active state flips
  useEffect(() => {
    engineRef.current?.enableSectionMode?.(active);
    return () => { engineRef.current?.enableSectionMode?.(false); };
  }, [active, engineRef]);

  // ESC exits section mode
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => { if (e.key === "Escape") { setActive(false); setDragBox(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const onPointerDown = useCallback((e) => {
    if (!active) return;
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    startRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragBox({ x: startRef.current.x, y: startRef.current.y, width: 0, height: 0 });
    e.preventDefault();
    e.stopPropagation();
  }, [active, containerRef]);

  const onPointerMove = useCallback((e) => {
    if (!startRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const curX = e.clientX - rect.left;
    const curY = e.clientY - rect.top;
    setDragBox({
      x: Math.min(startRef.current.x, curX),
      y: Math.min(startRef.current.y, curY),
      width: Math.abs(curX - startRef.current.x),
      height: Math.abs(curY - startRef.current.y),
    });
  }, [containerRef]);

  const onPointerUp = useCallback((e) => {
    if (!startRef.current) return;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const box = {
      x: Math.min(startRef.current.x, endX) + rect.left,
      y: Math.min(startRef.current.y, endY) + rect.top,
      width: Math.abs(endX - startRef.current.x),
      height: Math.abs(endY - startRef.current.y),
    };
    startRef.current = null;
    setDragBox(null);
    if (box.width < 6 || box.height < 6) return;   // ignore tiny drags
    setError("");
    const result = engineRef.current?.applySectionCut?.(box, { tolerance });
    if (!result) {
      setError("Nothing to cut in that region. Aim over visible geometry.");
      return;
    }
    refreshCuts();
  }, [containerRef, engineRef, tolerance, refreshCuts]);

  const onRestoreOne = (id) => {
    engineRef.current?.restoreSectionCut?.(id);
    refreshCuts();
  };
  const onRestoreAll = () => {
    engineRef.current?.restoreAllSectionCuts?.();
    refreshCuts();
  };

  return (
    <>
      {/* SVG overlay — only captures pointer events while active */}
      {active && (
        <svg
          data-testid="section-cut-overlay"
          className="absolute inset-0 z-30"
          style={{ pointerEvents: "auto", cursor: "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {dragBox && (
            <rect
              data-testid="section-cut-drag-rect"
              x={dragBox.x} y={dragBox.y}
              width={dragBox.width} height={dragBox.height}
              fill="#FFCC00" fillOpacity={0.12}
              stroke="#FFCC00" strokeWidth={1.5} strokeDasharray="6 4"
            />
          )}
        </svg>
      )}

      {/* Side toolbar — always mounted at top-right of viewport */}
      <div
        data-testid="section-cut-toolbar"
        className="absolute top-3 right-3 z-30 bg-black/90 border border-white/15 backdrop-blur-sm p-3 w-[240px] font-mono text-xs"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="label-mono text-[#FFCC00]">// SECTION CUT</span>
          <button
            data-testid="section-cut-toggle"
            onClick={() => setActive((v) => !v)}
            className={`label-mono px-2 py-1 border transition-colors ${
              active
                ? "bg-[#FFCC00] text-black border-[#FFCC00]"
                : "border-[#FFCC00]/50 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black"
            }`}
          >{active ? "ACTIVE · ESC" : "OFF"}</button>
        </div>

        <p className="text-[10px] text-neutral-500 leading-tight mb-2">
          Toggle ON, then <span className="text-[#FFCC00]">click-drag a box</span> across
          the model. The front slab / wall / roof in that region is hidden so you can see
          what&apos;s behind. Deeper geometry stays visible.
        </p>

        <label className="block mb-3">
          <div className="flex justify-between mb-0.5 text-[10px]">
            <span className="text-neutral-500">DEPTH BAND</span>
            <span className="text-[#FFCC00]">{tolerance.toFixed(1)} m</span>
          </div>
          <input
            data-testid="section-cut-tolerance"
            type="range" min="0.3" max="6" step="0.1"
            value={tolerance}
            onChange={(e) => setTolerance(Number(e.target.value))}
            className="w-full accent-[#FFCC00]"
            disabled={!active}
          />
          <div className="text-[9px] text-neutral-600">
            How thick a &quot;slice&quot; to cut from the surface toward the interior.
          </div>
        </label>

        {error && (
          <div data-testid="section-cut-error"
               className="border border-[#FF6666]/40 bg-[#FF3333]/10 text-[#FF6666] text-[10px] px-2 py-1 mb-2">
            {error}
          </div>
        )}

        {cuts.length > 0 && (
          <div className="mb-2">
            <div className="label-mono text-neutral-500 mb-1">// ACTIVE CUTS ({cuts.length})</div>
            <ul data-testid="section-cut-list" className="space-y-1 max-h-40 overflow-y-auto">
              {cuts.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between border border-white/10 px-2 py-1">
                  <span className="text-[10px] text-neutral-400">
                    Cut #{i + 1} · <span className="text-[#FFCC00]">{c.count} pcs</span>
                  </span>
                  <button
                    data-testid={`section-cut-restore-${i}`}
                    onClick={() => onRestoreOne(c.id)}
                    className="text-[10px] text-neutral-500 hover:text-white underline"
                    title="Restore this cut"
                  >restore</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          data-testid="section-cut-restore-all"
          onClick={onRestoreAll}
          disabled={cuts.length === 0}
          className="w-full label-mono px-2 py-1.5 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30 text-[10px]"
        >RESTORE ALL</button>
      </div>
    </>
  );
}
