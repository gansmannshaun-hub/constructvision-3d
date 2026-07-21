import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../store";

/**
 * Full-screen overlay for MANUAL WALL TRACING over a blueprint image.
 *
 * Workflow:
 *  1. Load the doc's page image + the sheet's existing walls (from AI auto-trace).
 *  2. User clicks start point → clicks end point → wall segment added.
 *     Right-click or ESC cancels an in-progress segment.
 *     Click on an existing wall to select it, then Delete/Backspace to remove.
 *     Undo (Ctrl+Z) removes the last-added wall.
 *  3. Save & Re-analyze → POST /api/blueprint_sheets/{sheet_id}/reanalyze-with-walls
 *     AI extracts matching doors/windows/labels/fixtures around the user's walls.
 */
export default function ManualTraceOverlay({ doc, sheet, onClose, onSaved }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageBase, setImageBase] = useState({ width: 0, height: 0 });
  const [buildingFt, setBuildingFt] = useState(sheet?.building_ft || { w: 40, h: 30 });
  const [walls, setWalls] = useState(() =>
    (sheet?.walls || []).map((w) => ({ ...w }))
  );
  const [pending, setPending] = useState(null);   // { start_ft: [x, y] } after first click
  const [mouseFt, setMouseFt] = useState(null);   // for live preview line
  const [selected, setSelected] = useState(null); // wall id
  const [snap, setSnap] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const svgRef = useRef(null);

  // Load the doc image (source of truth is per-page image if this sheet has one).
  useEffect(() => {
    let alive = true;
    const page = sheet?.source_page;
    apiClient
      .get(`/documents/${doc.id}/image`, { params: page ? { page } : {} })
      .then(({ data }) => {
        if (!alive || !data.image_base64) return;
        const url = `data:${data.mime_type || "image/jpeg"};base64,${data.image_base64}`;
        setImageUrl(url);
        // Probe intrinsic size for coordinate mapping.
        const img = new Image();
        img.onload = () => alive && setImageBase({ width: img.naturalWidth, height: img.naturalHeight });
        img.src = url;
      })
      .catch(() => alive && setError("Failed to load blueprint image."));
    return () => { alive = false; };
  }, [doc.id, sheet?.source_page]);

  // Feet ↔ SVG pixel conversion. The SVG uses the image's intrinsic pixel
  // dimensions; the wall coordinates are in feet against building_ft.
  // We render the SVG at a fixed viewBox so scaling is CSS-driven.
  const feetToPx = useCallback((x_ft, y_ft) => {
    const w = buildingFt?.w || 1;
    const h = buildingFt?.h || 1;
    return {
      x: (x_ft / w) * imageBase.width,
      y: (y_ft / h) * imageBase.height,
    };
  }, [buildingFt, imageBase]);

  const pxToFeet = useCallback((px, py) => {
    const w = buildingFt?.w || 1;
    const h = buildingFt?.h || 1;
    const x_ft = (px / imageBase.width) * w;
    const y_ft = (py / imageBase.height) * h;
    if (snap) {
      // Snap to 0.5 ft grid
      return [Math.round(x_ft * 2) / 2, Math.round(y_ft * 2) / 2];
    }
    return [x_ft, y_ft];
  }, [buildingFt, imageBase, snap]);

  // Convert clientX/Y to SVG-local coordinates.
  const svgFromEvent = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return [local.x, local.y];
  }, []);

  const onSvgClick = useCallback((e) => {
    if (!imageBase.width) return;
    if (e.button !== 0) return;
    const local = svgFromEvent(e);
    if (!local) return;
    const [x_ft, y_ft] = pxToFeet(local[0], local[1]);
    if (!pending) {
      setPending({ start_ft: [x_ft, y_ft] });
    } else {
      // Second click — finalize wall
      const [sx, sy] = pending.start_ft;
      const dx = x_ft - sx;
      const dy = y_ft - sy;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) {
        setPending(null);
        return;
      }
      setWalls((prev) => [
        ...prev,
        {
          id: `manual-${Date.now()}-${prev.length}`,
          start: [sx, sy],
          end: [x_ft, y_ft],
          thickness: 0.5,
          source: "manual",
        },
      ]);
      setPending(null);
    }
  }, [pending, pxToFeet, svgFromEvent, imageBase.width]);

  const onSvgMove = useCallback((e) => {
    if (!imageBase.width) return;
    const local = svgFromEvent(e);
    if (!local) return;
    setMouseFt(pxToFeet(local[0], local[1]));
  }, [pxToFeet, svgFromEvent, imageBase.width]);

  const onContextMenu = useCallback((e) => {
    e.preventDefault();
    setPending(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setWalls((prev) => prev.filter((w) => w.id !== selected));
    setSelected(null);
  }, [selected]);

  const undoLast = useCallback(() => {
    setWalls((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setPending(null); setSelected(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) deleteSelected();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, deleteSelected, undoLast]);

  const clearAll = useCallback(() => {
    if (!window.confirm(`Clear all ${walls.length} walls? This can't be undone once you close the overlay.`)) return;
    setWalls([]);
    setSelected(null);
    setPending(null);
  }, [walls.length]);

  const saveAndReanalyze = useCallback(async () => {
    if (walls.length === 0) {
      setError("Draw at least one wall before saving.");
      return;
    }
    setSaving(true);
    setReanalyzing(true);
    setError("");
    try {
      const { data } = await apiClient.post(
        `/blueprint_sheets/${sheet.id}/reanalyze-with-walls`,
        { walls, building_ft: buildingFt },
      );
      onSaved?.(data);
      onClose();
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Re-analyze failed";
      setError(detail);
    } finally {
      setSaving(false);
      setReanalyzing(false);
    }
  }, [walls, buildingFt, sheet?.id, onClose, onSaved]);

  const svgWalls = useMemo(() => walls.map((w) => {
    const s = feetToPx(w.start[0], w.start[1]);
    const e = feetToPx(w.end[0], w.end[1]);
    return { id: w.id, x1: s.x, y1: s.y, x2: e.x, y2: e.y };
  }), [walls, feetToPx]);

  const pendingPreview = useMemo(() => {
    if (!pending || !mouseFt) return null;
    const s = feetToPx(pending.start_ft[0], pending.start_ft[1]);
    const e = feetToPx(mouseFt[0], mouseFt[1]);
    return { x1: s.x, y1: s.y, x2: e.x, y2: e.y };
  }, [pending, mouseFt, feetToPx]);

  return (
    <div
      data-testid="manual-trace-overlay"
      className="fixed inset-0 z-[120] bg-black/95 flex flex-col"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 bg-[#0a0a0a]">
        <div className="flex items-center gap-4">
          <div>
            <div className="label-mono text-[#FFCC00]">// MANUAL TRACE · {sheet?.name || doc?.filename}</div>
            <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
              Click two points to draw a wall · right-click / ESC cancels · click a wall to select · Del removes · Ctrl+Z undoes
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-neutral-400 mr-3" data-testid="manual-trace-count">
            {walls.length} wall{walls.length === 1 ? "" : "s"}
          </span>
          <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
            <input
              data-testid="manual-trace-snap"
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
              className="accent-[#FFCC00]"
            />
            <span className={snap ? "text-[#FFCC00]" : "text-neutral-500"}>SNAP 0.5ft</span>
          </label>
          <button
            data-testid="manual-trace-undo"
            onClick={undoLast}
            disabled={walls.length === 0}
            className="label-mono px-3 py-1.5 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30"
            title="Undo last wall (Ctrl+Z)"
          >↺ UNDO</button>
          <button
            data-testid="manual-trace-clear"
            onClick={clearAll}
            disabled={walls.length === 0}
            className="label-mono px-3 py-1.5 border border-[#FF3333]/40 text-[#FF6666] hover:bg-[#FF3333]/20 disabled:opacity-30"
          >✕ CLEAR ALL</button>
          <button
            data-testid="manual-trace-save"
            onClick={saveAndReanalyze}
            disabled={saving || walls.length === 0}
            className="label-mono px-5 py-1.5 bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold disabled:opacity-40"
            title="Save walls and let AI extract doors/windows/labels around them"
          >
            {reanalyzing ? "AI RE-ANALYZING…" : "✓ SAVE & RE-ANALYZE"}
          </button>
          <button
            data-testid="manual-trace-close"
            onClick={onClose}
            disabled={saving}
            className="label-mono px-3 py-1.5 border border-white/15 text-neutral-400 hover:bg-white/5"
          >EXIT</button>
        </div>
      </div>

      {/* Building footprint controls */}
      <div className="border-b border-white/10 px-5 py-2 bg-[#0a0a0a] flex items-center gap-4 text-xs font-mono">
        <span className="text-neutral-500">// BUILDING SIZE (ft) — controls the scale of your traced walls</span>
        <label className="flex items-center gap-2">
          W:
          <input
            data-testid="manual-trace-bf-w"
            type="number"
            min="1"
            max="500"
            step="0.5"
            value={buildingFt.w}
            onChange={(e) => setBuildingFt((prev) => ({ ...prev, w: Math.max(1, Number(e.target.value) || 1) }))}
            className="w-20 bg-black border border-white/15 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-2">
          H:
          <input
            data-testid="manual-trace-bf-h"
            type="number"
            min="1"
            max="500"
            step="0.5"
            value={buildingFt.h}
            onChange={(e) => setBuildingFt((prev) => ({ ...prev, h: Math.max(1, Number(e.target.value) || 1) }))}
            className="w-20 bg-black border border-white/15 px-2 py-1 text-sm"
          />
        </label>
        {mouseFt && (
          <span className="text-neutral-500 ml-auto">
            cursor: <span className="text-[#FFCC00]">{mouseFt[0].toFixed(1)}, {mouseFt[1].toFixed(1)} ft</span>
          </span>
        )}
      </div>

      {/* Trace canvas */}
      <div className="flex-1 overflow-auto bg-[#111]">
        {!imageUrl ? (
          <div className="flex items-center justify-center h-full text-neutral-500 font-mono text-sm">
            Loading blueprint…
          </div>
        ) : (
          <div className="p-8 min-h-full flex items-start justify-center">
            <div className="relative" style={{ width: "min(90vw, 1600px)" }}>
              <img
                src={imageUrl}
                alt="blueprint underlay"
                className="w-full h-auto block select-none pointer-events-none"
                draggable={false}
              />
              <svg
                ref={svgRef}
                data-testid="manual-trace-svg"
                viewBox={`0 0 ${imageBase.width || 1} ${imageBase.height || 1}`}
                preserveAspectRatio="none"
                className="absolute inset-0 w-full h-full cursor-crosshair"
                onClick={onSvgClick}
                onMouseMove={onSvgMove}
                onContextMenu={onContextMenu}
              >
                {svgWalls.map((w) => (
                  <g key={w.id}>
                    <line
                      x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
                      stroke={selected === w.id ? "#FF3333" : "#FFCC00"}
                      strokeWidth={selected === w.id ? 8 : 5}
                      strokeLinecap="round"
                      onClick={(e) => { e.stopPropagation(); setSelected(w.id); }}
                      style={{ cursor: "pointer" }}
                      data-testid={`manual-trace-wall-${w.id}`}
                    />
                  </g>
                ))}
                {pendingPreview && (
                  <line
                    x1={pendingPreview.x1} y1={pendingPreview.y1}
                    x2={pendingPreview.x2} y2={pendingPreview.y2}
                    stroke="#00E5FF"
                    strokeWidth={4}
                    strokeDasharray="8 4"
                    strokeLinecap="round"
                  />
                )}
                {pending && (
                  <circle
                    cx={feetToPx(pending.start_ft[0], pending.start_ft[1]).x}
                    cy={feetToPx(pending.start_ft[0], pending.start_ft[1]).y}
                    r={6}
                    fill="#00E5FF"
                  />
                )}
              </svg>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div
          data-testid="manual-trace-error"
          className="border-t border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-xs font-mono px-5 py-3"
        >
          {error}
        </div>
      )}
    </div>
  );
}
