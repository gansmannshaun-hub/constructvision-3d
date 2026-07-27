import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { formatFeetInches, wallsAabb } from "../lib/dim";
import { simplifyWalls } from "../lib/simplifyWalls";
import CadAIPanel from "./CadAIPanel";
import { SheetTabBar } from "./SheetTabBar";
import {
  VIEWBOX_MIN, VIEWBOX_MAX, GRID_STEP_DEFAULT, GRID_STEP_OPTIONS,
  SNAP_THRESHOLD, CIRCLE_SEGMENTS,
  DOOR_STYLES, WINDOW_STYLES, WALL_STYLES, FIXTURE_META, TOOL_INPUT, TOOLS,
} from "./cad/constants";
import { cryptoId, dist, nearestOnSegment } from "./cad/geometry";
import { ToolIcon } from "./cad/ToolIcon";
import { useCadHistory } from "./cad/useCadHistory";

/** SketchUp-inspired 2D CAD editor.
 *  - Tools: Select / Line / Rectangle / Circle / Door / Window / Eraser /
 *           Tape Measure / Move / Pan / Zoom
 *  - Inference: endpoint, midpoint, on-axis, grid (1 unit)
 *  - Bottom status bar with tool hint + length measurement input
 *  - Pan/zoom via Hand tool or middle-mouse / wheel
 *  - Keyboard shortcuts: V S L R C D W E T M H Z (single letter activation)
 */

export default function CadEditorTab() {
  const { blueprint, saveBlueprint, currentProjectId, refreshBlueprint,
          createSheet, renameSheet, deleteSheet, activateSheet,
          fetchDocumentImage } = useStore();
  const sheets = blueprint.sheets || [];
  const activeSheetId = blueprint.active_sheet_id;
  const activeSheet = sheets.find((s) => s.id === activeSheetId) || null;

  // Underlay (source blueprint image) state
  const [underlayUrl, setUnderlayUrl] = useState(null);
  const [underlayVisible, setUnderlayVisible] = useState(true);
  const [underlayOpacity, setUnderlayOpacity] = useState(0.55);
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [tool, setTool] = useState("select");

  // Data
  const [walls, setWalls] = useState(blueprint.walls || []);
  const [doors, setDoors] = useState(blueprint.doors || []);
  const [windows, setWindows] = useState(blueprint.windows || []);
  const [labels, setLabels] = useState(blueprint.labels || []);
  const [fixtures, setFixtures] = useState(blueprint.fixtures || []);
  const [selected, setSelected] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);     // 2-click tools
  const [rectStart, setRectStart] = useState(null);
  const [circleCenter, setCircleCenter] = useState(null);
  const [tapeStart, setTapeStart] = useState(null);
  const [moveFrom, setMoveFrom] = useState(null);             // {type, id, anchor}
  const [offsetWall, setOffsetWall] = useState(null);         // wall picked for offset
  const [textEditor, setTextEditor] = useState(null);         // {x, y, value}
  // Lasso tool state — freehand polygon that multi-selects walls
  // whose midpoint falls inside on release. `lassoPath` is null when
  // not drawing; an array of [x,y] SVG-coord points while dragging.
  const [lassoPath, setLassoPath] = useState(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState([]);
  // Dimension tool state — persistent labeled ft-in dimension lines.
  // `dimStart` is set after the first click; second click commits.
  // Persisted inside `labels[]` with `kind: "dimension"` so we don't
  // need a schema change (labels is a free-form List[dict] on the
  // backend). Rendered inline with normal text labels but drawn as a
  // dim line + ticks + centered ft-in text.
  const [dimStart, setDimStart] = useState(null);
  const [hover, setHover] = useState(null);                   // current cursor in coords
  const [inference, setInference] = useState(null);           // {type, point} for snap indicator
  const [measureInput, setMeasureInput] = useState("");
  // Per-tool selected style + size (size in inches for door/window, ft for wall)
  const [doorStyle, setDoorStyle] = useState(DOOR_STYLES[0].value);
  const [windowStyle, setWindowStyle] = useState(WINDOW_STYLES[0].value);
  const [wallStyle, setWallStyle] = useState(WALL_STYLES[0].value);
  const [doorSizeIn, setDoorSizeIn] = useState(DOOR_STYLES[0].default_in);
  const [windowSizeIn, setWindowSizeIn] = useState(WINDOW_STYLES[0].default_in);
  // Current wall thickness derived from the selected wall-style preset.
  const wallThicknessFt = (WALL_STYLES.find((s) => s.value === wallStyle)?.thickness_ft) || 0.5;
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);

  // viewbox state (pan/zoom)
  const [vb, setVb] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [panning, setPanning] = useState(null);
  // User-configurable grid spacing in feet. Snapping + drawing all respect
  // this. Persisted per browser via localStorage so setup carries across
  // sheet switches.
  const [gridStep, setGridStep] = useState(() => {
    const v = parseFloat(localStorage.getItem("atlas-cad-grid-step") || "");
    return GRID_STEP_OPTIONS.includes(v) ? v : GRID_STEP_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem("atlas-cad-grid-step", String(gridStep));
  }, [gridStep]);
  // Drag-to-move a label with Select tool: {id, offset:[dx,dy], moved:bool, origPos}
  const [labelDrag, setLabelDrag] = useState(null);

  // Undo/redo history — snapshots of {walls, doors, windows, labels, fixtures}
  // captured on every state change. Reset per sheet. Encapsulated in
  // useCadHistory so this file only wires setters + a clear-tools callback.
  const savingRef = useRef(false);
  const clearTransientToolState = useCallback(() => {
    setSelected(null);
    setPendingStart(null); setRectStart(null); setCircleCenter(null);
    setTapeStart(null); setMoveFrom(null); setOffsetWall(null);
    setLassoPath(null); setMultiSelectedIds([]); setDimStart(null);
    setDirty(true);
  }, []);
  const {
    undo, redo, canUndo, canRedo,
    noteDragStart, noteDragEnd, isRestoringRef,
  } = useCadHistory({
    blueprint,
    walls, doors, windows, labels, fixtures,
    setWalls, setDoors, setWindows, setLabels, setFixtures,
    onRestore: clearTransientToolState,
    savingRef,
  });
  // Legacy alias — a few call sites still reference dragInProgressRef.
  // useCadHistory owns the drag suppression internally; these are no-ops.
  const dragInProgressRef = useRef(false);

  // Fetch the source blueprint image for the active sheet (if any).
  // For multi-page PDFs, `source_page` selects the correct page thumbnail.
  useEffect(() => {
    let cancelled = false;
    const docId = activeSheet?.source_document_id;
    if (!docId) { setUnderlayUrl(null); return; }
    (async () => {
      const url = await fetchDocumentImage(docId, activeSheet?.source_page || null);
      if (!cancelled) setUnderlayUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeSheet?.source_document_id, activeSheet?.source_page, fetchDocumentImage]);

  const markDirty = () => setDirty(true);

  // ---------- Coord conversion (handles viewBox + preserveAspectRatio correctly) ----------
  const toSvgCoord = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  // ---------- Inference & snapping ----------
  const findInference = useCallback((p) => {
    if (!snapEnabled) return null;
    const candidates = [];
    // endpoints of walls
    for (const w of walls) {
      if (w.start) candidates.push({ type: "endpoint", point: w.start });
      if (w.end)   candidates.push({ type: "endpoint", point: w.end });
      if (w.start && w.end) {
        candidates.push({ type: "midpoint", point: [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2] });
      }
    }
    let best = null;
    for (const c of candidates) {
      const d = dist(p, c.point);
      if (d < SNAP_THRESHOLD && (!best || d < best.dist)) best = { ...c, dist: d };
    }
    if (best) return best;

    // on-edge snap (line projection)
    let bestEdge = null;
    for (const w of walls) {
      if (!w.start || !w.end) continue;
      const r = nearestOnSegment(p, w.start, w.end);
      if (r.dist < SNAP_THRESHOLD && (!bestEdge || r.dist < bestEdge.dist)) {
        bestEdge = { type: "on-edge", point: r.point, dist: r.dist, wall: w };
      }
    }
    if (bestEdge) return bestEdge;

    // grid snap
    const gx = Math.round(p[0] / gridStep) * gridStep;
    const gy = Math.round(p[1] / gridStep) * gridStep;
    if (Math.abs(gx - p[0]) < SNAP_THRESHOLD / 2 && Math.abs(gy - p[1]) < SNAP_THRESHOLD / 2) {
      return { type: "grid", point: [gx, gy] };
    }
    return null;
  }, [walls, snapEnabled]);

  const snappedPoint = (raw) => {
    const inf = findInference(raw);
    return inf ? { p: inf.point, inf } : { p: [Math.round(raw[0] * 10) / 10, Math.round(raw[1] * 10) / 10], inf: null };
  };

  // ---------- Mouse handlers ----------
  const onMouseDown = (e) => {
    // Middle-mouse OR pan tool = start panning
    if (e.button === 1 || (tool === "pan" && e.button === 0)) {
      setPanning({ startClient: [e.clientX, e.clientY], startVb: { ...vb } });
      e.preventDefault();
      return;
    }
    // Lasso tool — begin drawing the polygon
    if (tool === "lasso" && e.button === 0) {
      const raw = toSvgCoord(e);
      setLassoPath([raw]);
      setMultiSelectedIds([]);
      e.preventDefault();
      return;
    }
  };

  const onMouseMove = (e) => {
    if (panning) {
      const svg = svgRef.current;
      if (!svg) return;
      // Convert client-pixel delta to viewBox-coord delta using CTM
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const dxPx = e.clientX - panning.startClient[0];
      const dyPx = e.clientY - panning.startClient[1];
      const invScaleX = panning.startVb.w / (svg.clientWidth || 1);
      const invScaleY = panning.startVb.h / (svg.clientHeight || 1);
      // Use min scale so pan respects letterbox
      const s = Math.max(invScaleX, invScaleY);
      setVb({ ...panning.startVb, x: panning.startVb.x - dxPx * s, y: panning.startVb.y - dyPx * s });
      return;
    }
    if (labelDrag) {
      const raw = toSvgCoord(e);
      const { p } = snappedPoint(raw);
      const nextPos = [p[0] + labelDrag.offset[0], p[1] + labelDrag.offset[1]];
      setLabels((arr) => arr.map((x) => x.id === labelDrag.id ? { ...x, position: nextPos } : x));
      if (!labelDrag.moved) setLabelDrag({ ...labelDrag, moved: true });
      return;
    }
    // Lasso — accumulate every ~0.5 unit of movement to keep the SVG
    // path short. Rendering + inside-test only care about vertices,
    // not sub-pixel precision.
    if (lassoPath) {
      const raw = toSvgCoord(e);
      const last = lassoPath[lassoPath.length - 1];
      if (!last || Math.hypot(raw[0] - last[0], raw[1] - last[1]) > 0.4) {
        setLassoPath([...lassoPath, raw]);
      }
      return;
    }
    const raw = toSvgCoord(e);
    const { p, inf } = snappedPoint(raw);
    setHover(p);
    setInference(inf);
  };

  const onMouseUp = () => {
    setPanning(null);
    if (labelDrag) {
      // Push exactly one snapshot representing the post-drag state,
      // then release the drag guard so the standard history effect resumes.
      if (labelDrag.moved) {
        noteDragEnd();
        markDirty();
      } else {
        // No actual movement — just clear the drag guard.
        dragInProgressRef.current = false;
      }
      setLabelDrag(null);
    }
    // Lasso commit — ray-cast every wall midpoint against the traced
    // polygon. Even-odd rule fill test. Skips micro-loops (<5 vertices).
    if (lassoPath) {
      const path = lassoPath;
      setLassoPath(null);
      if (path.length < 5) { setMultiSelectedIds([]); return; }
      const inside = (x, y) => {
        let hit = false;
        for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
          const [xi, yi] = path[i], [xj, yj] = path[j];
          const cross = (yi > y) !== (yj > y) &&
                        x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
          if (cross) hit = !hit;
        }
        return hit;
      };
      const hitIds = walls
        .filter((w) => inside((w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2))
        .map((w) => w.id);
      setMultiSelectedIds(hitIds);
      setSelected(null);
    }
  };

  // Keep `onWheel` in a ref so the native listener (which we attach below) can
  // always call the latest closure (capturing the current vb / tool state).
  const onWheelRef = useRef(null);

  const onWheel = (e) => {
    e.preventDefault();
    const [cx, cy] = toSvgCoord(e);
    const scale = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newW = Math.max(5, Math.min(400, vb.w * scale));
    const newH = newW;
    // Keep cursor world-position stable: adjust origin so that (cx, cy) stays where the mouse points
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    setVb({ x: cx - newW * mx, y: cy - newH * my, w: newW, h: newH });
  };
  onWheelRef.current = onWheel;

  // React's synthetic `onWheel` is registered as PASSIVE, so preventDefault is
  // silently ignored and the page scrolls in addition to our zoom. We bypass
  // this by attaching the listener manually with passive:false on the SVG.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const handler = (e) => onWheelRef.current && onWheelRef.current(e);
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  const resetView = () => setVb({ x: 0, y: 0, w: 100, h: 100 });

  // ---------- Click / commit ----------
  const onCanvasClick = (e) => {
    if (panning) return;
    const raw = toSvgCoord(e);
    const { p } = snappedPoint(raw);

    if (tool === "select") { setSelected(null); return; }

    if (tool === "line") {
      setPendingStart((prev) => {
        if (!prev) return p;
        if (dist(prev, p) < 0.5) return prev;
        setWalls((arr) => [...arr, { id: cryptoId(), start: prev, end: p, thickness: wallThicknessFt, style: wallStyle }]);
        markDirty();
        return null;
      });
      return;
    }
    if (tool === "rect") {
      if (!rectStart) { setRectStart(p); return; }
      const [x1, y1] = rectStart, [x2, y2] = p;
      const corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      const newWalls = [
        { id: cryptoId(), start: corners[0], end: corners[1], thickness: wallThicknessFt, style: wallStyle },
        { id: cryptoId(), start: corners[1], end: corners[2], thickness: wallThicknessFt, style: wallStyle },
        { id: cryptoId(), start: corners[2], end: corners[3], thickness: wallThicknessFt, style: wallStyle },
        { id: cryptoId(), start: corners[3], end: corners[0], thickness: wallThicknessFt, style: wallStyle },
      ];
      setWalls((arr) => [...arr, ...newWalls]);
      setRectStart(null);
      markDirty();
      return;
    }
    if (tool === "circle") {
      if (!circleCenter) { setCircleCenter(p); return; }
      const r = dist(circleCenter, p);
      const segs = CIRCLE_SEGMENTS;
      const pts = Array.from({ length: segs }, (_, i) => {
        const t = (i / segs) * Math.PI * 2;
        return [circleCenter[0] + r * Math.cos(t), circleCenter[1] + r * Math.sin(t)];
      });
      const newWalls = pts.map((pt, i) => ({
        id: cryptoId(), start: pt, end: pts[(i + 1) % segs], thickness: wallThicknessFt, style: wallStyle,
      }));
      setWalls((arr) => [...arr, ...newWalls]);
      setCircleCenter(null);
      markDirty();
      return;
    }
    if (tool === "door") {
      const widthFt = Math.max(2, doorSizeIn / 12);
      setDoors((arr) => [...arr, {
        id: cryptoId(), position: p, width: widthFt, wall_index: 0, style: doorStyle,
      }]);
      markDirty();
      return;
    }
    if (tool === "window") {
      const widthFt = Math.max(2, windowSizeIn / 12);
      setWindows((arr) => [...arr, {
        id: cryptoId(), position: p, width: widthFt, wall_index: 0, style: windowStyle,
      }]);
      markDirty();
      return;
    }
    if (tool === "text")    { setTextEditor({ position: p, value: "" }); return; }
    if (tool === "offset") {
      if (!offsetWall) {
        // pick the nearest wall under cursor
        let best = null;
        for (const w of walls) {
          if (!w.start || !w.end) continue;
          const r = nearestOnSegment(p, w.start, w.end);
          if (r.dist < 5 && (!best || r.dist < best.dist)) best = { wall: w, near: r };
        }
        if (best) setOffsetWall(best.wall);
        return;
      }
      // commit offset by side click
      const w = offsetWall;
      const dx = w.end[0] - w.start[0];
      const dy = w.end[1] - w.start[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.001) { setOffsetWall(null); return; }
      // unit normal
      const nx = -dy / len, ny = dx / len;
      // signed distance from wall to p (perpendicular)
      const mid = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
      const signed = (p[0] - mid[0]) * nx + (p[1] - mid[1]) * ny;
      if (Math.abs(signed) < 0.05) { setOffsetWall(null); return; }
      const newWall = {
        id: cryptoId(),
        start: [w.start[0] + nx * signed, w.start[1] + ny * signed],
        end:   [w.end[0]   + nx * signed, w.end[1]   + ny * signed],
        thickness: w.thickness || 0.2,
      };
      setWalls((arr) => [...arr, newWall]);
      setOffsetWall(null);
      markDirty();
      return;
    }
    if (tool === "tape") {
      setTapeStart((prev) => (prev ? null : p));
      return;
    }
    if (tool === "dimension") {
      // Two-click flow: first click sets start, second click commits a
      // persistent label with kind="dimension". Rendered as a dim line
      // + ticks + centered ft-in text. ESC cancels; tool switch clears.
      if (!dimStart) { setDimStart(p); return; }
      if (dist(dimStart, p) < 0.25) { setDimStart(null); return; }
      const midX = (dimStart[0] + p[0]) / 2;
      const midY = (dimStart[1] + p[1]) / 2;
      const len = dist(dimStart, p);
      setLabels((arr) => [...arr, {
        id: cryptoId(),
        kind: "dimension",
        position: [midX, midY - 1],  // labels[] require a position
        text: formatFeetInches(len),
        start: dimStart,
        end: p,
        offset_ft: 1,
      }]);
      setDimStart(null);
      markDirty();
      return;
    }
    if (tool === "zoom") {
      const scale = e.shiftKey ? 1.25 : 1 / 1.25;
      const newW = Math.max(5, Math.min(400, vb.w * scale));
      setVb((v) => ({ x: p[0] - newW / 2, y: p[1] - newW / 2, w: newW, h: newW }));
      return;
    }
  };

  // Eraser: per-element click
  const onElementClick = (e, type, id) => {
    if (tool === "eraser") {
      e.stopPropagation();
      if (type === "wall")   setWalls((a) => a.filter((x) => x.id !== id));
      if (type === "door")   setDoors((a) => a.filter((x) => x.id !== id));
      if (type === "window") setWindows((a) => a.filter((x) => x.id !== id));
      if (type === "label")  setLabels((a) => a.filter((x) => x.id !== id));
      if (type === "fixture") setFixtures((a) => a.filter((x) => x.id !== id));
      markDirty();
      return;
    }
    if (tool === "select") {
      e.stopPropagation();
      setSelected({ type, id });
    }
    if (tool === "move") {
      e.stopPropagation();
      setMoveFrom({ type, id, anchor: toSvgCoord(e) });
      setSelected({ type, id });
    }
  };

  // Move commit
  useEffect(() => {
    if (!moveFrom || !hover) return;
    // wait for click on canvas to commit move
  }, [moveFrom, hover]);
  const onMoveCommit = (e) => {
    if (!moveFrom) return;
    const target = snappedPoint(toSvgCoord(e)).p;
    const dx = target[0] - moveFrom.anchor[0];
    const dy = target[1] - moveFrom.anchor[1];
    if (moveFrom.type === "wall") {
      setWalls((arr) => arr.map((w) => w.id === moveFrom.id ? { ...w, start: [w.start[0] + dx, w.start[1] + dy], end: [w.end[0] + dx, w.end[1] + dy] } : w));
    } else if (moveFrom.type === "door") {
      setDoors((arr) => arr.map((d) => d.id === moveFrom.id ? { ...d, position: [d.position[0] + dx, d.position[1] + dy] } : d));
    } else if (moveFrom.type === "window") {
      setWindows((arr) => arr.map((w) => w.id === moveFrom.id ? { ...w, position: [w.position[0] + dx, w.position[1] + dy] } : w));
    } else if (moveFrom.type === "fixture") {
      setFixtures((arr) => arr.map((f) => f.id === moveFrom.id ? { ...f, position: [f.position[0] + dx, f.position[1] + dy] } : f));
    }
    setMoveFrom(null);
    markDirty();
  };

  // ---------- Keyboard shortcuts + delete / esc ----------
  useEffect(() => {
    const h = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      // Undo / redo (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y — also Cmd on Mac)
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Escape") {
        setPendingStart(null); setRectStart(null); setCircleCenter(null); setTapeStart(null); setMoveFrom(null); setSelected(null);
        setLassoPath(null); setMultiSelectedIds([]); setDimStart(null);
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && multiSelectedIds.length > 0) {
        // Lasso multi-select delete — remove every selected wall at once.
        const ids = new Set(multiSelectedIds);
        setWalls((a) => a.filter((w) => !ids.has(w.id)));
        setMultiSelectedIds([]);
        markDirty();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        if (selected.type === "wall")   setWalls((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "door")   setDoors((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "window") setWindows((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "label")  setLabels((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "fixture") setFixtures((a) => a.filter((w) => w.id !== selected.id));
        setSelected(null);
        markDirty();
        return;
      }
      // Single-letter tool shortcuts
      const k = e.key.toUpperCase();
      const t = TOOLS.find((x) => x.key === k);
      if (t) {
        setTool(t.id);
        setPendingStart(null); setRectStart(null); setCircleCenter(null); setTapeStart(null); setMoveFrom(null);
        setLassoPath(null); setMultiSelectedIds([]); setDimStart(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected, multiSelectedIds, undo, redo]);

  // ---------- Measurement input (length-aware commit while drawing) ----------
  const onMeasureSubmit = (e) => {
    e.preventDefault();
    const v = parseFloat(measureInput);
    setMeasureInput("");
    if (!Number.isFinite(v) || v <= 0) return;
    // Door / Window width: typed in inches, sets the upcoming-click size
    if (tool === "door")   { setDoorSizeIn(v); return; }
    if (tool === "window") { setWindowSizeIn(v); return; }
    // Line tool: exact-length wall
    if (tool === "line" && pendingStart && hover) {
      const dx = hover[0] - pendingStart[0];
      const dy = hover[1] - pendingStart[1];
      const cur = Math.hypot(dx, dy);
      if (cur < 0.001) return;
      const k = v / cur;
      const end = [pendingStart[0] + dx * k, pendingStart[1] + dy * k];
      setWalls((arr) => [...arr, { id: cryptoId(), start: pendingStart, end, thickness: wallThicknessFt, style: wallStyle }]);
      setPendingStart(null);
      markDirty();
      return;
    }
    // Offset tool: exact distance on side of cursor
    if (tool === "offset" && offsetWall && hover) {
      const w = offsetWall;
      const dx = w.end[0] - w.start[0];
      const dy = w.end[1] - w.start[1];
      const len = Math.hypot(dx, dy);
      if (len < 0.001) return;
      const nx = -dy / len, ny = dx / len;
      const mid = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
      const side = Math.sign((hover[0] - mid[0]) * nx + (hover[1] - mid[1]) * ny) || 1;
      const off = side * v;
      setWalls((arr) => [...arr, {
        id: cryptoId(),
        start: [w.start[0] + nx * off, w.start[1] + ny * off],
        end:   [w.end[0]   + nx * off, w.end[1]   + ny * off],
        thickness: w.thickness || 0.2,
      }]);
      setOffsetWall(null);
      markDirty();
    }
  };

  // ---------- Save ----------
  const save = async () => {
    setSaving(true);
    savingRef.current = true;
    try { await saveBlueprint(walls, doors, windows, labels, { fixtures }); setDirty(false); }
    finally { setSaving(false); }
  };
  const clearAll = () => {
    if (!window.confirm("Remove ALL walls, doors, windows, labels, and fixtures?")) return;
    setWalls([]); setDoors([]); setWindows([]); setLabels([]); setFixtures([]); markDirty();
  };

  // ---------- Linear Array (acts on selected wall) ----------
  const doArray = () => {
    if (!selected || selected.type !== "wall") {
      alert("Select a wall first (use the Select tool).");
      return;
    }
    const w = walls.find((x) => x.id === selected.id);
    if (!w) return;
    const countStr = window.prompt("Number of copies (linear array):", "3");
    const count = parseInt(countStr, 10);
    if (!Number.isFinite(count) || count < 1) return;
    const spacingStr = window.prompt("Spacing in coord units (perpendicular to wall):", "10");
    const spacing = parseFloat(spacingStr);
    if (!Number.isFinite(spacing) || spacing <= 0) return;
    const dx = w.end[0] - w.start[0];
    const dy = w.end[1] - w.start[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = -dy / len, ny = dx / len;
    const copies = [];
    for (let i = 1; i <= count; i++) {
      const o = spacing * i;
      copies.push({
        id: cryptoId(),
        start: [w.start[0] + nx * o, w.start[1] + ny * o],
        end:   [w.end[0]   + nx * o, w.end[1]   + ny * o],
        thickness: w.thickness || 0.2,
      });
    }
    setWalls((arr) => [...arr, ...copies]);
    markDirty();
  };

  const doMirror = () => {
    if (!selected || selected.type !== "wall") {
      alert("Select a wall first to use as the mirror axis.");
      return;
    }
    const axis = walls.find((x) => x.id === selected.id);
    if (!axis) return;
    // Mirror ALL other walls across the axis
    const ax = axis.start[0], ay = axis.start[1];
    const bx = axis.end[0],   by = axis.end[1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return;
    const reflect = ([px, py]) => {
      const t = ((px - ax) * dx + (py - ay) * dy) / len2;
      const fx = ax + t * dx, fy = ay + t * dy;
      return [2 * fx - px, 2 * fy - py];
    };
    const mirrored = walls
      .filter((w) => w.id !== axis.id)
      .map((w) => ({
        id: cryptoId(),
        start: reflect(w.start),
        end: reflect(w.end),
        thickness: w.thickness || 0.2,
      }));
    setWalls((arr) => [...arr, ...mirrored]);
    markDirty();
  };

  // ---------- Render helpers ----------
  const currentTool = TOOLS.find((t) => t.id === tool);
  const liveDistance = useMemo(() => {
    if (tool === "line" && pendingStart && hover) return dist(pendingStart, hover);
    if (tool === "rect" && rectStart && hover) {
      const dx = Math.abs(hover[0] - rectStart[0]);
      const dy = Math.abs(hover[1] - rectStart[1]);
      return Math.hypot(dx, dy);
    }
    if (tool === "circle" && circleCenter && hover) return dist(circleCenter, hover);
    if (tool === "tape" && tapeStart && hover) return dist(tapeStart, hover);
    return null;
  }, [tool, pendingStart, rectStart, circleCenter, tapeStart, hover]);

  // viewBox string
  const vbStr = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  // grid lines based on viewbox + current gridStep. Cap the line count to
  // avoid millions of tiny SVG elements at extreme zoom levels.
  const gridLines = useMemo(() => {
    const lines = [];
    // Coarsen the visual step if we'd emit more than ~400 lines per axis.
    let step = gridStep;
    while (Math.max(vb.w, vb.h) / step > 400) step *= 5;
    const sx = Math.floor(vb.x / step) * step;
    const ex = vb.x + vb.w;
    const sy = Math.floor(vb.y / step) * step;
    const ey = vb.y + vb.h;
    // Guard against float-precision infinite loops
    const majorEvery = step * 5;
    const isMajor = (v) => Math.abs(Math.round(v / majorEvery) * majorEvery - v) < step * 0.001;
    for (let x = sx; x <= ex; x += step) lines.push({ k: `v${x.toFixed(2)}`, x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, major: isMajor(x) });
    for (let y = sy; y <= ey; y += step) lines.push({ k: `h${y.toFixed(2)}`, x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y, major: isMajor(y) });
    return lines;
  }, [vb, gridStep]);

  const cursorClass = {
    select: "cursor-pointer",
    line: "cursor-crosshair",
    rect: "cursor-crosshair",
    circle: "cursor-crosshair",
    door: "cursor-crosshair",
    window: "cursor-crosshair",
    eraser: "cursor-not-allowed",
    tape: "cursor-cell",
    move: "cursor-move",
    offset: "cursor-copy",
    text: "cursor-text",
    pan: panning ? "cursor-grabbing" : "cursor-grab",
    zoom: "cursor-zoom-in",
  }[tool];

  return (
    <div className="flex flex-col h-full bg-[#F5F5F0] text-black" data-testid="cad-editor-tab">
      {/* Sheet tabs — one tab per blueprint (each uploaded blueprint gets its own sheet + own geometry) */}
      <SheetTabBar
        sheets={sheets}
        activeSheetId={activeSheetId}
        dirty={dirty}
        onActivate={async (id) => {
          if (id === activeSheetId) return;
          if (dirty && !window.confirm("You have unsaved changes on the current sheet. Switch anyway?")) return;
          await activateSheet(id);
        }}
        onCreate={async () => {
          const name = window.prompt("New sheet name:", `Sheet ${sheets.length + 1}`);
          if (!name || !name.trim()) return;
          const fl = parseInt(window.prompt("Floor level (0 = ground, 1 = 2nd floor, -1 = basement):", "0"), 10) || 0;
          const s = await createSheet({ name: name.trim(), floor_level: fl });
          if (s) await activateSheet(s.id);
        }}
        onRename={async (id, currentName) => {
          const name = window.prompt("Rename sheet:", currentName);
          if (name && name.trim() && name !== currentName) await renameSheet(id, { name: name.trim() });
        }}
        onDelete={async (id, name) => {
          if (sheets.length <= 1) { alert("You must keep at least one sheet."); return; }
          if (!window.confirm(`Delete sheet "${name}"? This cannot be undone.`)) return;
          await deleteSheet(id);
        }}
        onChangeFloor={async (id, currentFloor) => {
          const raw = window.prompt("Floor level (-5..50):", String(currentFloor));
          if (raw === null) return;
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) await renameSheet(id, { floor_level: n });
        }}
      />

      {/* Top toolbar (SketchUp style) */}
      <div className="flex items-center gap-1 px-3 py-2 bg-[#E8E8E0] border-b border-[#BBB] flex-shrink-0 flex-wrap">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            data-testid={`cad-tool-${t.id}`}
            onClick={() => setTool(t.id)}
            className={`relative w-10 h-10 flex items-center justify-center rounded-sm transition-colors group ${
              tool === t.id
                ? "bg-[#FFCC00] text-black ring-2 ring-[#000] ring-offset-1 ring-offset-[#E8E8E0]"
                : "bg-white border border-[#CCC] hover:bg-[#FFCC00]/30 text-[#333]"
            }`}
            title={`${t.label} (${t.key})`}
          >
            <ToolIcon id={t.id} />
            <span className="absolute -bottom-0.5 right-0.5 text-[8px] font-mono text-neutral-500">{t.key}</span>
          </button>
        ))}

        <div className="w-px h-8 bg-[#CCC] mx-2" />

        <button
          data-testid="cad-undo"
          onClick={undo}
          disabled={!canUndo}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          ↶ UNDO
        </button>
        <button
          data-testid="cad-redo"
          onClick={redo}
          disabled={!canRedo}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        >
          ↷ REDO
        </button>

        <button
          data-testid="cad-toggle-snap"
          onClick={() => setSnapEnabled((s) => !s)}
          className={`h-10 px-3 text-xs uppercase tracking-wider font-bold border ${snapEnabled ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white border-[#CCC] text-[#333]"}`}
        >
          SNAP
        </button>
        <button
          data-testid="cad-toggle-grid"
          onClick={() => setShowGrid((s) => !s)}
          className={`h-10 px-3 text-xs uppercase tracking-wider font-bold border ${showGrid ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white border-[#CCC] text-[#333]"}`}
        >
          GRID
        </button>
        {/* Grid spacing picker + snap-all-to-grid */}
        <div className="flex items-center gap-1 border border-[#CCC] bg-white h-10 px-2" title="Grid spacing (feet)">
          <span className="text-[9px] uppercase font-mono text-[#666]">STEP</span>
          <select
            data-testid="cad-grid-step"
            value={gridStep}
            onChange={(e) => setGridStep(parseFloat(e.target.value))}
            className="text-xs font-mono bg-white text-[#111] border-0 focus:outline-none tabular-nums cursor-pointer"
          >
            {GRID_STEP_OPTIONS.map((g) => (
              <option key={g} value={g}>{g < 1 ? `${g * 12}"` : `${g}'`}</option>
            ))}
          </select>
        </div>
        <button
          data-testid="cad-snap-to-grid"
          onClick={() => {
            const step = gridStep;
            const snap = (v) => Math.round(v / step) * step;
            const snapWall = (w) => ({ ...w, start: w.start ? [snap(w.start[0]), snap(w.start[1])] : w.start, end: w.end ? [snap(w.end[0]), snap(w.end[1])] : w.end });
            const snapPos = (o) => (o.position ? { ...o, position: [snap(o.position[0]), snap(o.position[1])] } : o);
            setWalls((arr) => arr.map(snapWall));
            setDoors((arr) => arr.map(snapPos));
            setWindows((arr) => arr.map(snapPos));
            setLabels((arr) => arr.map(snapPos));
            setFixtures((arr) => arr.map(snapPos));
            markDirty();
          }}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30"
          title="Snap every wall endpoint, door, window, label and fixture to the current grid spacing"
        >
          ⊞ FIT GRID
        </button>
        <button
          data-testid="cad-toggle-dim"
          onClick={() => setShowDimensions((s) => !s)}
          className={`h-10 px-3 text-xs uppercase tracking-wider font-bold border ${showDimensions ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white border-[#CCC] text-[#333]"}`}
          title="Show dimension annotations"
        >
          DIM
        </button>
        <button
          data-testid="cad-simplify"
          onClick={() => {
            const r = simplifyWalls(walls, { gridFt: 0.5, minLenFt: 1.0, angleTolDeg: 3, gapFt: 0.5, axisSnap: true });
            const before = walls.length;
            setWalls(r.walls);
            markDirty();
            setSelected(null);
            const findNearestWallIndex = (pos) => {
              let best = 0, bestD = Infinity;
              r.walls.forEach((w, i) => {
                const midx = (w.start[0] + w.end[0]) / 2;
                const midy = (w.start[1] + w.end[1]) / 2;
                const d = Math.hypot(pos[0] - midx, pos[1] - midy);
                if (d < bestD) { bestD = d; best = i; }
              });
              return best;
            };
            setDoors((arr) => arr.map((d) => ({ ...d, wall_index: findNearestWallIndex(d.position) })));
            setWindows((arr) => arr.map((w) => ({ ...w, wall_index: findNearestWallIndex(w.position) })));
            alert(
              `Simplify complete\n\n` +
              `Walls: ${before} → ${r.walls.length}\n` +
              `• ${r.merged} merged\n` +
              `• ${r.removed} sub-1 ft slivers dropped\n` +
              `• ${r.snapped} endpoints snapped to 6" grid\n` +
              `• ${r.straightened} walls axis-aligned`
            );
          }}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold border bg-white border-[#CCC] text-[#333] hover:bg-[#F0F0E8]"
          title="Merge near-parallel walls, snap endpoints to 6″ grid, drop sub-1 ft slivers, axis-align near-orthogonal walls"
        >
          SIMPLIFY
        </button>
        <button
          data-testid="cad-denoise"
          onClick={() => {
            const before = walls.length;
            const kept = walls.filter((w) => w.source !== "opencv");
            const removed = before - kept.length;
            if (removed === 0) {
              alert("No auto-traced walls to remove — this sheet only has AI or hand-drawn walls.");
              return;
            }
            if (!window.confirm(
              `DENOISE removes only the auto-traced (OpenCV) walls.\n\n` +
              `${removed} of ${before} walls will be removed.\n${kept.length} AI/hand-drawn walls will remain.\n\n` +
              `Use this when the AI over-traced an elevation or busy schematic.`
            )) return;
            setWalls(kept);
            setDoors((arr) => arr.filter((d) => d.wall_index < kept.length));
            setWindows((arr) => arr.filter((w) => w.wall_index < kept.length));
            markDirty();
            setSelected(null);
          }}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold border bg-white border-[#CCC] text-[#333] hover:bg-[#F0F0E8]"
          title="Remove all auto-traced (OpenCV) walls — keep only AI-vision walls and hand-drawn ones. Use when the pipeline over-traced an elevation or dense drawing."
        >
          DENOISE
        </button>
        <button
          data-testid="cad-straighten"
          onClick={() => {
            // Aggressive straighten: force every wall within 12° of an axis
            // to be exactly axis-aligned + snap endpoints to a tight 3-inch
            // grid. Great for making messy phone-photo traces look sharp.
            const r = simplifyWalls(walls, { gridFt: 0.25, minLenFt: 0.5, angleTolDeg: 4, gapFt: 0.25, axisSnap: true });
            const before = walls.length;
            setWalls(r.walls);
            markDirty();
            setSelected(null);
            alert(
              `Straighten complete\n\n` +
              `${r.straightened} walls forced axis-aligned\n` +
              `${r.snapped} endpoints snapped to 3" grid\n` +
              `${before - r.walls.length} duplicates removed`
            );
          }}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold border bg-white border-[#CCC] text-[#333] hover:bg-[#F0F0E8]"
          title="Force near-orthogonal walls to be exactly axis-aligned and snap endpoints to a 3-inch grid"
        >
          STRAIGHTEN
        </button>
        {underlayUrl && (
          <div className="flex items-center gap-1 h-10 px-2 border border-[#CCC] bg-white" title="Blueprint underlay controls">
            <button
              data-testid="cad-toggle-underlay"
              onClick={() => setUnderlayVisible((v) => !v)}
              className={`h-8 px-2 text-[10px] uppercase tracking-wider font-bold border ${underlayVisible ? "bg-[#B8860B] text-white border-[#B8860B]" : "bg-white border-[#CCC] text-[#666]"}`}
              title="Toggle the uploaded blueprint image behind the CAD layer"
            >
              UNDERLAY
            </button>
            <input
              data-testid="cad-underlay-opacity"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={underlayOpacity}
              onChange={(e) => setUnderlayOpacity(parseFloat(e.target.value))}
              disabled={!underlayVisible}
              className="w-20 accent-[#B8860B]"
              title="Underlay opacity"
            />
            <span className="text-[10px] font-mono text-[#666] tabular-nums w-8">
              {Math.round(underlayOpacity * 100)}%
            </span>
          </div>
        )}
        <button
          data-testid="cad-zoom-out"
          onClick={() => setVb((v) => {
            const scale = 1.25;
            const newW = Math.min(400, v.w * scale);
            const newH = newW * (v.h / v.w);
            return { x: v.x + (v.w - newW) / 2, y: v.y + (v.h - newH) / 2, w: newW, h: newH };
          })}
          className="h-10 w-10 text-lg font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30"
          title="Zoom out"
        >
          −
        </button>
        <button
          data-testid="cad-zoom-in"
          onClick={() => setVb((v) => {
            const scale = 1 / 1.25;
            const newW = Math.max(2, v.w * scale);
            const newH = newW * (v.h / v.w);
            return { x: v.x + (v.w - newW) / 2, y: v.y + (v.h - newH) / 2, w: newW, h: newH };
          })}
          className="h-10 w-10 text-lg font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30"
          title="Zoom in"
        >
          +
        </button>
        <button
          data-testid="cad-reset-view"
          onClick={resetView}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30"
          title="Reset zoom & pan"
        >
          ⌂ FIT
        </button>

        <div className="w-px h-8 bg-[#CCC] mx-1" />
        <button
          data-testid="cad-action-array"
          onClick={doArray}
          disabled={!selected || selected.type !== "wall"}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Linear array of the selected wall (count + spacing prompt)"
        >
          ⋮⋮ ARRAY
        </button>
        <button
          data-testid="cad-action-mirror"
          onClick={doMirror}
          disabled={!selected || selected.type !== "wall"}
          className="h-10 px-3 text-xs uppercase tracking-wider font-bold bg-white border border-[#CCC] text-[#333] hover:bg-[#FFCC00]/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Mirror all other walls across the selected wall axis"
        >
          ⇄ MIRROR
        </button>

        <div className="flex-1" />

        <span className={`label-mono mr-3 ${dirty ? "text-[#FF3333]" : "text-neutral-500"}`} data-testid="cad-dirty-flag">{dirty ? "● UNSAVED" : "○ SAVED"}</span>
        <button
          data-testid="cad-save-button"
          onClick={save}
          disabled={saving || !dirty}
          className="h-10 px-5 bg-[#FFCC00] hover:bg-[#E6B800] disabled:bg-[#DDD] disabled:text-[#999] text-black font-bold uppercase tracking-wider text-xs"
        >
          {saving ? "Saving…" : "Save & Sync"}
        </button>
        <button
          data-testid="cad-clear-button"
          onClick={clearAll}
          className="h-10 px-3 bg-white border border-[#FF3333] text-[#FF3333] hover:bg-[#FF3333] hover:text-white text-xs uppercase tracking-wider font-bold"
        >
          ✕ Clear
        </button>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative overflow-hidden bg-[#FAFAF5]" onMouseUp={onMouseUp}>
        <svg
          ref={svgRef}
          viewBox={vbStr}
          preserveAspectRatio="xMidYMid meet"
          className={`w-full h-full ${cursorClass}`}
          style={{ touchAction: "none", overscrollBehavior: "contain" }}
          data-testid="cad-canvas"
          onClick={moveFrom ? onMoveCommit : onCanvasClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Blueprint underlay (source drawing) — pixel-perfect trace reference.
              Falls back to a 100×100 ft canvas when we don't yet have
              building_ft or wall geometry, so a scanned image ALWAYS renders. */}
          {underlayVisible && underlayUrl && (() => {
            const bf = activeSheet?.building_ft;
            let x = 0, y = 0, w = 100, h = 100;
            if (bf?.w > 0 && bf?.h > 0) {
              w = bf.w;
              h = bf.h;
            } else if (walls.length > 0) {
              const ab = wallsAabb(walls);
              if (ab) {
                x = ab.minX;
                y = ab.minY;
                w = ab.maxX - ab.minX;
                h = ab.maxY - ab.minY;
              }
            }
            return (
              <image
                data-testid="cad-underlay"
                href={underlayUrl}
                x={x}
                y={y}
                width={w}
                height={h}
                preserveAspectRatio="none"
                opacity={underlayOpacity}
                pointerEvents="none"
              />
            );
          })()}
          {/* Grid */}
          {showGrid && gridLines.map((l) => (
            <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.major ? "#BBB" : "#E0E0D8"} strokeWidth={l.major ? 0.08 : 0.04} />
          ))}
          {/* Axes (red X, green Y) */}
          <line x1={vb.x} y1={0} x2={vb.x + vb.w} y2={0} stroke="#FF3333" strokeWidth="0.15" opacity="0.7" />
          <line x1={0} y1={vb.y} x2={0} y2={vb.y + vb.h} stroke="#22AA22" strokeWidth="0.15" opacity="0.7" />

          {/* Walls — professional double-line style with poché fill.
              We draw a thick "poché" (solid fill) rectangle following the
              wall's axis, then two thinner black outline lines to give the
              classic drafting look. Click target is a wider invisible line. */}
          {walls.map((w) => {
            const isSel = selected?.type === "wall" && selected.id === w.id;
            const isMulti = multiSelectedIds.includes(w.id);
            const isMoving = moveFrom?.type === "wall" && moveFrom.id === w.id;
            const dx = w.end[0] - w.start[0];
            const dy = w.end[1] - w.start[1];
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const t = (w.thickness || 0.5);
            const half = t / 2;
            // Corner points of the poché rectangle (in world feet).
            const p1 = [w.start[0] + nx * half, w.start[1] + ny * half];
            const p2 = [w.end[0]   + nx * half, w.end[1]   + ny * half];
            const p3 = [w.end[0]   - nx * half, w.end[1]   - ny * half];
            const p4 = [w.start[0] - nx * half, w.start[1] - ny * half];
            const fillColor = isMulti ? "rgba(255,102,0,0.45)"
              : isSel ? "rgba(255,204,0,0.35)"
              : (w.source === "opencv" ? "rgba(50,50,60,0.55)" : "rgba(30,30,40,0.85)");
            const strokeColor = isMulti ? "#FF6600"
              : isSel ? "#FFCC00"
              : isMoving ? "#0055FF"
              : "#0F0F14";
            const strokeW = Math.max(0.06, t * 0.15);
            return (
              <g
                key={w.id}
                onClick={(e) => onElementClick(e, "wall", w.id)}
                style={{ cursor: tool === "select" || tool === "eraser" || tool === "move" ? "pointer" : undefined }}
              >
                <polygon
                  points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]} ${p4[0]},${p4[1]}`}
                  fill={fillColor} stroke={strokeColor} strokeWidth={strokeW}
                  strokeLinejoin="miter"
                />
                {/* Invisible thick line for a bigger click hit-box */}
                <line
                  x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]}
                  stroke="transparent" strokeWidth={Math.max(0.4, t * 1.4)}
                />
              </g>
            );
          })}

          {/* Doors */}
          {/* Doors — neutral outline + "DOOR" text label */}
          {doors.map((d) => {
            const isSel = selected?.type === "door" && selected.id === d.id;
            const r = (d.width || 3) / 4;
            const stroke = isSel ? "#FFCC00" : "#222";
            const strokeW = isSel ? 0.22 : 0.14;
            return (
              <g key={d.id} onClick={(e) => onElementClick(e, "door", d.id)} className="cursor-pointer">
                <circle
                  cx={d.position[0]} cy={d.position[1]} r={r}
                  fill="#FFFFFF" stroke={stroke} strokeWidth={strokeW}
                />
                {/* swing arc to visually hint a door */}
                <path
                  d={`M ${d.position[0] - r} ${d.position[1]} A ${r * 1.6} ${r * 1.6} 0 0 1 ${d.position[0] + r * 0.5} ${d.position[1] + r * 1.3}`}
                  fill="none" stroke={stroke} strokeWidth={strokeW * 0.7} opacity="0.6"
                />
                <text
                  x={d.position[0]} y={d.position[1] + r + 1.6}
                  fontSize="1.2"
                  fill={isSel ? "#FFCC00" : "#222"}
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fontWeight="600"
                  pointerEvents="none"
                >DOOR{d.style ? ` · ${(DOOR_STYLES.find(s => s.value === d.style)?.label || d.style).split(" ·")[0].toUpperCase()}` : ""}</text>
              </g>
            );
          })}

          {/* Windows — neutral outline + "WINDOW" text label */}
          {windows.map((w) => {
            const isSel = selected?.type === "window" && selected.id === w.id;
            const width = w.width || 4;
            const stroke = isSel ? "#FFCC00" : "#222";
            const strokeW = isSel ? 0.22 : 0.14;
            return (
              <g key={w.id} onClick={(e) => onElementClick(e, "window", w.id)} className="cursor-pointer">
                <rect
                  x={w.position[0] - width / 2}
                  y={w.position[1] - 0.4}
                  width={width} height={0.8}
                  fill="#FFFFFF" stroke={stroke} strokeWidth={strokeW}
                />
                {/* center mullion to visually hint a window */}
                <line
                  x1={w.position[0]} y1={w.position[1] - 0.4}
                  x2={w.position[0]} y2={w.position[1] + 0.4}
                  stroke={stroke} strokeWidth={strokeW * 0.7} opacity="0.6"
                />
                <text
                  x={w.position[0]} y={w.position[1] + 1.8}
                  fontSize="1.2"
                  fill={isSel ? "#FFCC00" : "#222"}
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fontWeight="600"
                  pointerEvents="none"
                >WINDOW{w.style ? ` · ${(WINDOW_STYLES.find(s => s.value === w.style)?.label || w.style).split(" ·")[0].toUpperCase()}` : ""}</text>
              </g>
            );
          })}

          {/* Auto dimension annotations (toggleable) */}
          {showDimensions && walls.map((w) => {
            if (!w.start || !w.end) return null;
            const dx = w.end[0] - w.start[0];
            const dy = w.end[1] - w.start[1];
            const len = Math.hypot(dx, dy);
            if (len < 1) return null;
            const mx = (w.start[0] + w.end[0]) / 2;
            const my = (w.start[1] + w.end[1]) / 2;
            const nx = -dy / len, ny = dx / len;
            const off = 1.6; // perpendicular offset
            const tx = mx + nx * off;
            const ty = my + ny * off;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            const flip = angle > 90 || angle < -90 ? 180 : 0;
            return (
              <g key={`dim-${w.id}`} pointerEvents="none">
                <line x1={w.start[0]} y1={w.start[1]} x2={w.start[0] + nx * off * 0.9} y2={w.start[1] + ny * off * 0.9} stroke="#0055FF" strokeWidth="0.08" />
                <line x1={w.end[0]} y1={w.end[1]} x2={w.end[0] + nx * off * 0.9} y2={w.end[1] + ny * off * 0.9} stroke="#0055FF" strokeWidth="0.08" />
                <line x1={w.start[0] + nx * off} y1={w.start[1] + ny * off} x2={w.end[0] + nx * off} y2={w.end[1] + ny * off} stroke="#0055FF" strokeWidth="0.08" />
                <text x={tx} y={ty} fontSize="1.6" fill="#0055FF" textAnchor="middle"
                  transform={`rotate(${angle + flip}, ${tx}, ${ty})`}
                  fontFamily="IBM Plex Mono, monospace" fontWeight="600">
                  {formatFeetInches(len)}
                </text>
              </g>
            );
          })}

          {/* Overall outer dimension chain (W × H) */}
          {showDimensions && (() => {
            const aabb = wallsAabb(walls);
            if (!aabb || aabb.w < 1 || aabb.h < 1) return null;
            const outer = 4.5;            // distance outside footprint
            const tick = 0.8;             // tick mark length
            return (
              <g pointerEvents="none">
                {/* Top: overall width */}
                <line x1={aabb.minX} y1={aabb.minY - outer} x2={aabb.maxX} y2={aabb.minY - outer} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.minX} y1={aabb.minY - outer - tick / 2} x2={aabb.minX} y2={aabb.minY - outer + tick / 2} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.maxX} y1={aabb.minY - outer - tick / 2} x2={aabb.maxX} y2={aabb.minY - outer + tick / 2} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.minX} y1={aabb.minY} x2={aabb.minX} y2={aabb.minY - outer + tick} stroke="#FF6600" strokeWidth="0.06" strokeDasharray="0.4 0.4" />
                <line x1={aabb.maxX} y1={aabb.minY} x2={aabb.maxX} y2={aabb.minY - outer + tick} stroke="#FF6600" strokeWidth="0.06" strokeDasharray="0.4 0.4" />
                <text x={(aabb.minX + aabb.maxX) / 2} y={aabb.minY - outer - 1.0} fontSize="2.2" fill="#FF6600" textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                  {formatFeetInches(aabb.w)}
                </text>
                {/* Left: overall height */}
                <line x1={aabb.minX - outer} y1={aabb.minY} x2={aabb.minX - outer} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.minX - outer - tick / 2} y1={aabb.minY} x2={aabb.minX - outer + tick / 2} y2={aabb.minY} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.minX - outer - tick / 2} y1={aabb.maxY} x2={aabb.minX - outer + tick / 2} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.12" />
                <line x1={aabb.minX} y1={aabb.minY} x2={aabb.minX - outer + tick} y2={aabb.minY} stroke="#FF6600" strokeWidth="0.06" strokeDasharray="0.4 0.4" />
                <line x1={aabb.minX} y1={aabb.maxY} x2={aabb.minX - outer + tick} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.06" strokeDasharray="0.4 0.4" />
                <text x={aabb.minX - outer - 1.0} y={(aabb.minY + aabb.maxY) / 2} fontSize="2.2" fill="#FF6600" textAnchor="middle"
                  transform={`rotate(-90, ${aabb.minX - outer - 1.0}, ${(aabb.minY + aabb.maxY) / 2})`}
                  fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                  {formatFeetInches(aabb.h)}
                </text>
              </g>
            );
          })()}

          {/* AI-traced fixtures (toilets, sinks, appliances, etc.) */}
          {fixtures.map((f) => {
            const meta = FIXTURE_META[f.kind] || FIXTURE_META.other;
            const [w, h] = f.size || [2, 2];
            const rot = f.rotation_deg || 0;
            const isSel = selected?.type === "fixture" && selected.id === f.id;
            return (
              <g
                key={f.id}
                data-testid={`cad-fixture-${f.id}`}
                transform={`translate(${f.position[0]},${f.position[1]}) rotate(${rot})`}
                onClick={(e) => onElementClick(e, "fixture", f.id)}
                style={{ cursor: (tool === "select" || tool === "eraser") ? "pointer" : undefined }}
              >
                <rect x={-w / 2} y={-h / 2} width={w} height={h}
                  fill={isSel ? "#FFCC00" : meta.color} fillOpacity="0.55"
                  stroke={isSel ? "#FFCC00" : "#333"} strokeWidth="0.12" />
                <text x={0} y={0.35} fontSize={Math.min(w, h) * 0.42}
                  fill="#111" textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace" fontWeight="700"
                  pointerEvents="none">
                  {meta.label}
                </text>
              </g>
            );
          })}

          {/* Text labels + dimension labels (kind === "dimension") */}
          {labels.map((l) => {
            if (l.kind === "dimension") {
              const isSel = selected?.type === "label" && selected.id === l.id;
              const [sx, sy] = l.start;
              const [ex, ey] = l.end;
              const dx = ex - sx, dy = ey - sy;
              const len = Math.hypot(dx, dy) || 1;
              const nx = -dy / len, ny = dx / len;
              const off = l.offset_ft || 1;
              // Baseline offset perpendicular to the measured segment
              const bx1 = sx + nx * off, by1 = sy + ny * off;
              const bx2 = ex + nx * off, by2 = ey + ny * off;
              const tick = 0.4;
              const midX = (bx1 + bx2) / 2, midY = (by1 + by2) / 2;
              const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              const color = isSel ? "#FFCC00" : "#00E5FF";
              return (
                <g
                  key={l.id}
                  data-testid={`cad-dimension-${l.id}`}
                  onClick={(e) => onElementClick(e, "label", l.id)}
                  style={{ cursor: tool === "select" || tool === "eraser" ? "pointer" : undefined }}
                >
                  {/* Extension lines */}
                  <line x1={sx} y1={sy} x2={bx1} y2={by1} stroke={color} strokeWidth="0.06" strokeDasharray="0.3 0.15" />
                  <line x1={ex} y1={ey} x2={bx2} y2={by2} stroke={color} strokeWidth="0.06" strokeDasharray="0.3 0.15" />
                  {/* Main dim line */}
                  <line x1={bx1} y1={by1} x2={bx2} y2={by2} stroke={color} strokeWidth="0.08" />
                  {/* Ticks */}
                  <line x1={bx1 - nx * tick} y1={by1 - ny * tick} x2={bx1 + nx * tick} y2={by1 + ny * tick} stroke={color} strokeWidth="0.08" />
                  <line x1={bx2 - nx * tick} y1={by2 - ny * tick} x2={bx2 + nx * tick} y2={by2 + ny * tick} stroke={color} strokeWidth="0.08" />
                  <text
                    x={midX} y={midY - 0.4}
                    fontSize="1.1"
                    fill={color}
                    textAnchor="middle"
                    fontFamily="'IBM Plex Mono', monospace"
                    style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 0.25, strokeLinejoin: "round" }}
                    transform={`rotate(${angle} ${midX} ${midY - 0.4})`}
                  >{l.text}</text>
                </g>
              );
            }
            const isSel = selected?.type === "label" && selected.id === l.id;
            const fs = l.font_size || 1.5;
            const textLen = String(l.text || "").length;
            const rectW = textLen * fs * 0.62 + fs * 0.8;
            const rectH = fs * 1.55;
            return (
              <g
                key={l.id}
                data-testid={`cad-label-${l.id}`}
                onMouseDown={(e) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  const raw = toSvgCoord(e);
                  // offset = current label center minus click point (world-space);
                  // preserved as we drag so the label doesn't jump under cursor.
                  dragInProgressRef.current = true;
                  noteDragStart();
                  setLabelDrag({
                    id: l.id,
                    offset: [l.position[0] - raw[0], l.position[1] - raw[1]],
                    moved: false,
                    origPos: [...l.position],
                  });
                  setSelected({ type: "label", id: l.id });
                }}
                onClick={(e) => {
                  // Skip the parent onElementClick if we actually dragged.
                  if (labelDrag?.moved) { e.stopPropagation(); return; }
                  onElementClick(e, "label", l.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setTextEditor({ position: l.position, value: l.text || "", editingId: l.id, fontSize: fs });
                }}
                style={{ cursor: tool === "select" ? (labelDrag?.id === l.id ? "grabbing" : "grab") : (tool === "eraser" ? "pointer" : undefined) }}
              >
                <rect
                  x={l.position[0] - rectW / 2}
                  y={l.position[1] - rectH / 2}
                  width={rectW}
                  height={rectH}
                  fill={isSel ? "#FFCC00" : "rgba(255,255,255,0.85)"}
                  stroke={isSel ? "#000" : "#333"}
                  strokeWidth={isSel ? "0.15" : "0.08"}
                />
                <text
                  x={l.position[0]}
                  y={l.position[1] + fs * 0.38}
                  fontSize={fs}
                  fill="#1a1a1a"
                  textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace"
                  fontWeight="600"
                >
                  {l.text}
                </text>
              </g>
            );
          })}

          {/* Offset preview */}
          {tool === "offset" && offsetWall && hover && (() => {
            const w = offsetWall;
            const dx = w.end[0] - w.start[0];
            const dy = w.end[1] - w.start[1];
            const len = Math.hypot(dx, dy);
            if (len < 0.001) return null;
            const nx = -dy / len, ny = dx / len;
            const mid = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
            const signed = (hover[0] - mid[0]) * nx + (hover[1] - mid[1]) * ny;
            return (
              <g pointerEvents="none">
                <line x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]} stroke="#FF8800" strokeWidth="0.5" opacity="0.6" />
                <line x1={w.start[0] + nx * signed} y1={w.start[1] + ny * signed} x2={w.end[0] + nx * signed} y2={w.end[1] + ny * signed} stroke="#FF8800" strokeWidth="0.4" strokeDasharray="1 0.6" />
                <text x={mid[0] + nx * (signed / 2)} y={mid[1] + ny * (signed / 2)} fontSize="1.8" fill="#FF8800" textAnchor="middle" fontFamily="IBM Plex Mono, monospace">
                  {formatFeetInches(Math.abs(signed))}
                </text>
              </g>
            );
          })()}

          {/* Pending previews */}
          {tool === "line" && pendingStart && hover && (
            <>
              <line x1={pendingStart[0]} y1={pendingStart[1]} x2={hover[0]} y2={hover[1]} stroke="#FFCC00" strokeWidth="0.4" strokeDasharray="1 0.6" />
              <circle cx={pendingStart[0]} cy={pendingStart[1]} r="0.7" fill="#FFCC00" />
            </>
          )}
          {tool === "rect" && rectStart && hover && (
            <rect x={Math.min(rectStart[0], hover[0])} y={Math.min(rectStart[1], hover[1])}
              width={Math.abs(hover[0] - rectStart[0])} height={Math.abs(hover[1] - rectStart[1])}
              fill="rgba(255, 204, 0, 0.1)" stroke="#FFCC00" strokeWidth="0.3" strokeDasharray="1 0.6" />
          )}
          {tool === "circle" && circleCenter && hover && (
            <circle cx={circleCenter[0]} cy={circleCenter[1]} r={dist(circleCenter, hover)}
              fill="rgba(255, 204, 0, 0.1)" stroke="#FFCC00" strokeWidth="0.3" strokeDasharray="1 0.6" />
          )}
          {/* Lasso — live polygon preview while dragging */}
          {tool === "lasso" && lassoPath && lassoPath.length > 1 && (
            <polygon
              data-testid="cad-lasso-preview"
              points={lassoPath.map((p) => `${p[0]},${p[1]}`).join(" ")}
              fill="rgba(255,102,0,0.15)"
              stroke="#FF6600" strokeWidth="0.2" strokeDasharray="0.7 0.4"
            />
          )}
          {/* Dimension — preview line while awaiting second click */}
          {tool === "dimension" && dimStart && hover && (() => {
            const [sx, sy] = dimStart, [ex, ey] = hover;
            const len = dist(dimStart, hover);
            return (
              <g data-testid="cad-dimension-preview">
                <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#00E5FF" strokeWidth="0.15" strokeDasharray="0.5 0.3" />
                <circle cx={sx} cy={sy} r="0.35" fill="#00E5FF" />
                <circle cx={ex} cy={ey} r="0.35" fill="#00E5FF" />
                {len > 0.05 && (
                  <text
                    x={(sx + ex) / 2} y={(sy + ey) / 2 - 0.7}
                    fontSize="1.1" fill="#00E5FF" textAnchor="middle"
                    fontFamily="'IBM Plex Mono', monospace"
                    style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 0.25 }}
                  >{formatFeetInches(len)}</text>
                )}
              </g>
            );
          })()}
          {tool === "tape" && tapeStart && hover && (() => {
            const dx = hover[0] - tapeStart[0];
            const dy = hover[1] - tapeStart[1];
            const len = Math.hypot(dx, dy);
            const mx = (tapeStart[0] + hover[0]) / 2;
            const my = (tapeStart[1] + hover[1]) / 2;
            // Perpendicular offset so the label sits just above the line
            const offUnits = 1.4;
            let nx = 0, ny = -offUnits;
            if (len > 0.001) {
              nx = -dy / len * offUnits;
              ny = dx / len * offUnits;
              // Always offset "up" relative to screen — flip if the normal points down
              if (ny > 0) { nx = -nx; ny = -ny; }
            }
            const lx = mx + nx;
            const ly = my + ny;
            return (
              <>
                <line x1={tapeStart[0]} y1={tapeStart[1]} x2={hover[0]} y2={hover[1]}
                      stroke="#FF3333" strokeWidth="0.3" strokeDasharray="0.6 0.6" />
                <circle cx={tapeStart[0]} cy={tapeStart[1]} r="0.6" fill="#FF3333" />
                <circle cx={hover[0]} cy={hover[1]} r="0.6" fill="#FF3333" />
                {len > 0.05 && (
                  <g pointerEvents="none" data-testid="cad-tape-live-label">
                    {/* white halo behind text for legibility */}
                    <text x={lx} y={ly} fontSize="1.8"
                          stroke="#FFFFFF" strokeWidth="0.55"
                          paintOrder="stroke"
                          fill="#FF3333"
                          textAnchor="middle"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                          fontWeight="700">
                      {formatFeetInches(len)}
                    </text>
                  </g>
                )}
              </>
            );
          })()}

          {/* Inference snap indicator */}
          {inference && hover && (
            <>
              <rect x={inference.point[0] - 1} y={inference.point[1] - 1} width="2" height="2"
                fill="none" stroke={
                  inference.type === "endpoint" ? "#00CC66" :
                  inference.type === "midpoint" ? "#00CCFF" :
                  inference.type === "on-edge"  ? "#FF8800" :
                                                  "#888888"
                } strokeWidth="0.3" />
            </>
          )}
        </svg>

        {/* Inference label */}
        {inference && (
          <div className="absolute pointer-events-none px-2 py-1 bg-black text-white text-xs font-mono"
            style={{
              left: `${((inference.point[0] - vb.x) / vb.w) * 100}%`,
              top: `${((inference.point[1] - vb.y) / vb.h) * 100}%`,
              transform: "translate(12px, -28px)",
            }}>
            {inference.type}
          </div>
        )}

        {/* Text label inline editor — handles both new labels and editing an existing one */}
        {textEditor && (() => {
          const commit = (raw) => {
            const v = (raw || "").trim().slice(0, 40);
            if (textEditor.editingId) {
              if (!v) {
                // empty text on edit → delete the label
                setLabels((arr) => arr.filter((x) => x.id !== textEditor.editingId));
              } else {
                setLabels((arr) => arr.map((x) => x.id === textEditor.editingId ? { ...x, text: v } : x));
              }
              markDirty();
            } else if (v) {
              setLabels((arr) => [...arr, {
                id: cryptoId(),
                position: textEditor.position,
                text: v,
                font_size: textEditor.fontSize || 1.5,
              }]);
              markDirty();
            }
            setTextEditor(null);
          };
          return (
            <form
              data-testid="cad-text-editor"
              onSubmit={(e) => { e.preventDefault(); commit(textEditor.value); }}
              className="absolute"
              style={{
                left: `${((textEditor.position[0] - vb.x) / vb.w) * 100}%`,
                top: `${((textEditor.position[1] - vb.y) / vb.h) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <input
                autoFocus
                data-testid="cad-text-input"
                value={textEditor.value}
                onChange={(e) => setTextEditor({ ...textEditor, value: e.target.value })}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setTextEditor(null);
                    e.stopPropagation();
                  }
                }}
                placeholder={textEditor.editingId ? "(empty to delete)" : "Type label…"}
                maxLength={40}
                className="bg-white border-2 border-[#FFCC00] px-2 py-1 text-sm font-mono text-black shadow-md w-44"
              />
            </form>
          );
        })()}

        {/* Floating action bar for a selected label — Edit / font size / Delete */}
        {selected?.type === "label" && tool === "select" && !textEditor && (() => {
          const l = labels.find((x) => x.id === selected.id);
          if (!l) return null;
          const fs = l.font_size || 1.5;
          const resize = (delta) => {
            const next = Math.max(0.6, Math.min(6, +(fs + delta).toFixed(2)));
            setLabels((arr) => arr.map((x) => x.id === l.id ? { ...x, font_size: next } : x));
            markDirty();
          };
          return (
            <div
              data-testid={`cad-label-toolbar-${l.id}`}
              className="absolute z-20 flex items-center gap-1 bg-black/85 border border-[#FFCC00] rounded px-1 py-1 shadow-lg"
              style={{
                left: `${((l.position[0] - vb.x) / vb.w) * 100}%`,
                top: `${((l.position[1] - vb.y) / vb.h) * 100}%`,
                transform: "translate(-50%, calc(-100% - 16px))",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                data-testid={`cad-label-edit-${l.id}`}
                onClick={() => setTextEditor({ position: l.position, value: l.text || "", editingId: l.id, fontSize: fs })}
                className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider text-white hover:bg-[#FFCC00] hover:text-black rounded"
                title="Edit text (or double-click the label)"
              >
                Edit
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button
                data-testid={`cad-label-shrink-${l.id}`}
                onClick={() => resize(-0.25)}
                className="h-6 w-6 text-white text-[13px] hover:bg-[#FFCC00] hover:text-black rounded font-bold"
                title="Shrink text"
              >
                A−
              </button>
              <span className="text-[10px] font-mono text-[#FFCC00] tabular-nums w-8 text-center">{fs.toFixed(2)}</span>
              <button
                data-testid={`cad-label-grow-${l.id}`}
                onClick={() => resize(0.25)}
                className="h-6 w-6 text-white text-[13px] hover:bg-[#FFCC00] hover:text-black rounded font-bold"
                title="Grow text"
              >
                A+
              </button>
              <div className="w-px h-4 bg-white/20" />
              <button
                data-testid={`cad-label-delete-${l.id}`}
                onClick={() => {
                  setLabels((arr) => arr.filter((x) => x.id !== l.id));
                  setSelected(null);
                  markDirty();
                }}
                className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider text-[#FF6666] hover:bg-[#FF3333] hover:text-white rounded"
                title="Delete label"
              >
                ✕
              </button>
            </div>
          );
        })()}

        {currentProjectId && (
          <CadAIPanel
            projectId={currentProjectId}
            onPlanLoaded={async () => { await refreshBlueprint(); }}
          />
        )}
      </div>

      {/* Bottom status bar */}
      <div className="flex items-center gap-4 px-4 py-2 bg-[#1a1a1a] text-white border-t border-black flex-shrink-0 text-xs font-mono">
        <span className="label-mono text-[#FFCC00]" data-testid="cad-status-tool">{currentTool?.label.toUpperCase()}</span>
        <span className="text-neutral-400 truncate">{currentTool?.hint}</span>
        <div className="flex-1" />
        {liveDistance != null && (
          <span data-testid="cad-live-distance" className="bg-black px-2 py-1 border border-white/10">
            Δ {formatFeetInches(liveDistance)}
          </span>
        )}
        {hover && (
          <span data-testid="cad-cursor-coords" className="bg-black px-2 py-1 border border-white/10">
            X {hover[0].toFixed(1)} · Y {hover[1].toFixed(1)}
          </span>
        )}
        <span className="bg-black px-2 py-1 border border-white/10">ZOOM {(100 / vb.w).toFixed(1)}×</span>

        {/* ---- Per-tool style dropdown (door / window / wall) ---- */}
        {tool === "door" && (
          <select
            data-testid="cad-door-style"
            value={doorStyle}
            onChange={(e) => {
              const s = DOOR_STYLES.find((x) => x.value === e.target.value);
              setDoorStyle(e.target.value);
              if (s) setDoorSizeIn(s.default_in);
            }}
            className="bg-black border border-white/20 text-[#FFCC00] px-2 py-1 font-mono text-xs"
            title="Door style"
          >
            {DOOR_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        {tool === "window" && (
          <select
            data-testid="cad-window-style"
            value={windowStyle}
            onChange={(e) => {
              const s = WINDOW_STYLES.find((x) => x.value === e.target.value);
              setWindowStyle(e.target.value);
              if (s) setWindowSizeIn(s.default_in);
            }}
            className="bg-black border border-white/20 text-[#FFCC00] px-2 py-1 font-mono text-xs"
            title="Window style"
          >
            {WINDOW_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        {(tool === "wall" || tool === "line" || tool === "rect" || tool === "circle") && (
          <select
            data-testid="cad-wall-style"
            value={wallStyle}
            onChange={(e) => setWallStyle(e.target.value)}
            className="bg-black border border-white/20 text-neutral-300 px-2 py-1 font-mono text-xs"
            title="Wall thickness preset"
          >
            {WALL_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}

        {/* ---- Per-tool measurement input ---- */}
        {TOOL_INPUT[tool] && (
          <form onSubmit={onMeasureSubmit} className="flex items-center gap-1">
            <span className="label-mono text-neutral-500">{TOOL_INPUT[tool].label}</span>
            <input
              data-testid="cad-measurement-input"
              value={measureInput}
              onChange={(e) => setMeasureInput(e.target.value)}
              placeholder={TOOL_INPUT[tool].placeholder}
              className="w-24 bg-black border border-white/20 px-2 py-1 text-white text-right font-mono"
            />
            <span className="text-neutral-500 font-mono text-[10px]">{TOOL_INPUT[tool].unit}</span>
            <button type="submit" className="text-[#FFCC00] hover:underline">↵</button>
          </form>
        )}

        {/* ---- Current upcoming size readout for door/window ---- */}
        {tool === "door" && (
          <span data-testid="cad-door-size-readout" className="bg-black px-2 py-1 border border-white/10 font-mono text-[10px] text-neutral-400">
            next: {doorSizeIn}″
          </span>
        )}
        {tool === "window" && (
          <span data-testid="cad-window-size-readout" className="bg-black px-2 py-1 border border-white/10 font-mono text-[10px] text-neutral-400">
            next: {windowSizeIn}″
          </span>
        )}
      </div>
    </div>
  );
}
