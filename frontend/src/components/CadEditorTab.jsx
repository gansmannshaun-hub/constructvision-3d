import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { formatFeetInches, wallsAabb } from "../lib/dim";
import CadAIPanel from "./CadAIPanel";

/** SketchUp-inspired 2D CAD editor.
 *  - Tools: Select / Line / Rectangle / Circle / Door / Window / Eraser /
 *           Tape Measure / Move / Pan / Zoom
 *  - Inference: endpoint, midpoint, on-axis, grid (1 unit)
 *  - Bottom status bar with tool hint + length measurement input
 *  - Pan/zoom via Hand tool or middle-mouse / wheel
 *  - Keyboard shortcuts: V S L R C D W E T M H Z (single letter activation)
 */

const VIEWBOX_MIN = 0;
const VIEWBOX_MAX = 100;
const GRID_STEP = 2; // major grid step in coord units
const SNAP_THRESHOLD = 3; // distance in coord units within which we snap
const CIRCLE_SEGMENTS = 16;

const TOOLS = [
  { id: "select",   key: "V", label: "Select",       hint: "Click an element to select. Backspace to delete." },
  { id: "line",     key: "L", label: "Line",         hint: "Click for start, click again to finish wall. ESC cancels." },
  { id: "rect",     key: "R", label: "Rectangle",    hint: "Click corner 1, then corner 2. Creates 4 walls." },
  { id: "circle",   key: "C", label: "Circle",       hint: "Click center, then drag to radius. Approximated to 16 segments." },
  { id: "door",     key: "D", label: "Door",         hint: "Click on a wall to drop a door." },
  { id: "window",   key: "W", label: "Window",       hint: "Click on a wall to drop a window." },
  { id: "eraser",   key: "E", label: "Eraser",       hint: "Click any element to remove it." },
  { id: "tape",     key: "T", label: "Tape Measure", hint: "Click two points to measure distance." },
  { id: "move",     key: "M", label: "Move",         hint: "Click an element, then click a destination." },
  { id: "offset",   key: "O", label: "Offset",       hint: "Click a wall, then click the side / type a distance and Enter." },
  { id: "text",     key: "X", label: "Text",         hint: "Click anywhere to place a text label." },
  { id: "pan",      key: "H", label: "Pan",          hint: "Drag to pan the view." },
  { id: "zoom",     key: "Z", label: "Zoom",         hint: "Click to zoom in. Shift+click to zoom out." },
];

function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Distance from point p to line segment ab; also returns the closest point on segment
function nearestOnSegment(p, a, b) {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1];
  const px = p[0], py = p[1];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return { point: [ax, ay], t: 0, dist: Math.hypot(px - ax, py - ay) };
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { point: [cx, cy], t, dist: Math.hypot(px - cx, py - cy) };
}

const TOOL_ICON = ({ id, className = "" }) => {
  const s = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className };
  switch (id) {
    case "select":  return <svg {...s}><path d="M5 3l14 11h-7l4 7-3 1-4-7-4 4z" /></svg>;
    case "line":    return <svg {...s}><path d="M4 20L20 4" /><circle cx="4" cy="20" r="1.5" fill="currentColor" /><circle cx="20" cy="4" r="1.5" fill="currentColor" /></svg>;
    case "rect":    return <svg {...s}><rect x="4" y="4" width="16" height="16" /></svg>;
    case "circle":  return <svg {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>;
    case "door":    return <svg {...s}><path d="M6 3v18h12V3z" /><path d="M14 12h.01" /><path d="M18 21l-12-9V3" strokeOpacity="0.4" /></svg>;
    case "window":  return <svg {...s}><rect x="4" y="4" width="16" height="16" /><path d="M12 4v16M4 12h16" /></svg>;
    case "eraser":  return <svg {...s}><path d="M21 14L11 4l-7 7 10 10h7z" /><path d="M14 21l-3-3" /><path d="M3 21h18" /></svg>;
    case "tape":    return <svg {...s}><path d="M3 9h18v6H3z" /><path d="M7 9v6M11 9v6M15 9v6M19 9v3" /></svg>;
    case "move":    return <svg {...s}><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg>;
    case "offset":  return <svg {...s}><path d="M5 6l14 0M5 18l14 0" /><path d="M9 10l-3 2 3 2" /><path d="M5 12h7" /></svg>;
    case "text":    return <svg {...s}><path d="M5 5h14M12 5v14M9 19h6" /></svg>;
    case "pan":     return <svg {...s}><path d="M9 11V5a2 2 0 0 1 4 0v6M13 7v9a2 2 0 0 1-4 0V9M5 13l1 3a4 4 0 0 0 4 3h2a4 4 0 0 0 4-4v-4" /></svg>;
    case "zoom":    return <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M8 11h6M11 8v6" /></svg>;
    default:        return null;
  }
};

export default function CadEditorTab() {
  const { blueprint, saveBlueprint, currentProjectId, refreshBlueprint } = useStore();
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [tool, setTool] = useState("select");

  // Data
  const [walls, setWalls] = useState(blueprint.walls || []);
  const [doors, setDoors] = useState(blueprint.doors || []);
  const [windows, setWindows] = useState(blueprint.windows || []);
  const [labels, setLabels] = useState(blueprint.labels || []);
  const [selected, setSelected] = useState(null);
  const [pendingStart, setPendingStart] = useState(null);     // 2-click tools
  const [rectStart, setRectStart] = useState(null);
  const [circleCenter, setCircleCenter] = useState(null);
  const [tapeStart, setTapeStart] = useState(null);
  const [moveFrom, setMoveFrom] = useState(null);             // {type, id, anchor}
  const [offsetWall, setOffsetWall] = useState(null);         // wall picked for offset
  const [textEditor, setTextEditor] = useState(null);         // {x, y, value}
  const [hover, setHover] = useState(null);                   // current cursor in coords
  const [inference, setInference] = useState(null);           // {type, point} for snap indicator
  const [measureInput, setMeasureInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);

  // viewbox state (pan/zoom)
  const [vb, setVb] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [panning, setPanning] = useState(null);

  // sync from store
  useEffect(() => {
    setWalls(blueprint.walls || []);
    setDoors(blueprint.doors || []);
    setWindows(blueprint.windows || []);
    setLabels(blueprint.labels || []);
    setDirty(false);
  }, [blueprint]);

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
    const gx = Math.round(p[0] / GRID_STEP) * GRID_STEP;
    const gy = Math.round(p[1] / GRID_STEP) * GRID_STEP;
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
    const raw = toSvgCoord(e);
    const { p, inf } = snappedPoint(raw);
    setHover(p);
    setInference(inf);
  };

  const onMouseUp = () => setPanning(null);

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
        setWalls((arr) => [...arr, { id: cryptoId(), start: prev, end: p, thickness: 0.2 }]);
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
        { id: cryptoId(), start: corners[0], end: corners[1], thickness: 0.2 },
        { id: cryptoId(), start: corners[1], end: corners[2], thickness: 0.2 },
        { id: cryptoId(), start: corners[2], end: corners[3], thickness: 0.2 },
        { id: cryptoId(), start: corners[3], end: corners[0], thickness: 0.2 },
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
        id: cryptoId(), start: pt, end: pts[(i + 1) % segs], thickness: 0.2,
      }));
      setWalls((arr) => [...arr, ...newWalls]);
      setCircleCenter(null);
      markDirty();
      return;
    }
    if (tool === "door")    { setDoors((arr) => [...arr, { id: cryptoId(), position: p, width: 3, wall_index: 0 }]); markDirty(); return; }
    if (tool === "window")  { setWindows((arr) => [...arr, { id: cryptoId(), position: p, width: 4, wall_index: 0 }]); markDirty(); return; }
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
    }
    setMoveFrom(null);
    markDirty();
  };

  // ---------- Keyboard shortcuts + delete / esc ----------
  useEffect(() => {
    const h = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if (e.key === "Escape") {
        setPendingStart(null); setRectStart(null); setCircleCenter(null); setTapeStart(null); setMoveFrom(null); setSelected(null);
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        if (selected.type === "wall")   setWalls((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "door")   setDoors((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "window") setWindows((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "label")  setLabels((a) => a.filter((w) => w.id !== selected.id));
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
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  // ---------- Measurement input (length-aware commit while drawing) ----------
  const onMeasureSubmit = (e) => {
    e.preventDefault();
    const v = parseFloat(measureInput);
    setMeasureInput("");
    if (!Number.isFinite(v) || v <= 0) return;
    // Line tool: exact-length wall
    if (tool === "line" && pendingStart && hover) {
      const dx = hover[0] - pendingStart[0];
      const dy = hover[1] - pendingStart[1];
      const cur = Math.hypot(dx, dy);
      if (cur < 0.001) return;
      const k = v / cur;
      const end = [pendingStart[0] + dx * k, pendingStart[1] + dy * k];
      setWalls((arr) => [...arr, { id: cryptoId(), start: pendingStart, end, thickness: 0.2 }]);
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
    try { await saveBlueprint(walls, doors, windows, labels); setDirty(false); }
    finally { setSaving(false); }
  };
  const clearAll = () => {
    if (!window.confirm("Remove ALL walls, doors, windows, and labels?")) return;
    setWalls([]); setDoors([]); setWindows([]); setLabels([]); markDirty();
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
  // grid lines based on viewbox
  const gridLines = useMemo(() => {
    const lines = [];
    const sx = Math.floor(vb.x / GRID_STEP) * GRID_STEP;
    const ex = vb.x + vb.w;
    const sy = Math.floor(vb.y / GRID_STEP) * GRID_STEP;
    const ey = vb.y + vb.h;
    for (let x = sx; x <= ex; x += GRID_STEP) lines.push({ k: `v${x}`, x1: x, y1: vb.y, x2: x, y2: vb.y + vb.h, major: x % (GRID_STEP * 5) === 0 });
    for (let y = sy; y <= ey; y += GRID_STEP) lines.push({ k: `h${y}`, x1: vb.x, y1: y, x2: vb.x + vb.w, y2: y, major: y % (GRID_STEP * 5) === 0 });
    return lines;
  }, [vb]);

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
            <TOOL_ICON id={t.id} />
            <span className="absolute -bottom-0.5 right-0.5 text-[8px] font-mono text-neutral-500">{t.key}</span>
          </button>
        ))}

        <div className="w-px h-8 bg-[#CCC] mx-2" />

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
        <button
          data-testid="cad-toggle-dim"
          onClick={() => setShowDimensions((s) => !s)}
          className={`h-10 px-3 text-xs uppercase tracking-wider font-bold border ${showDimensions ? "bg-[#0055FF] text-white border-[#0055FF]" : "bg-white border-[#CCC] text-[#333]"}`}
          title="Show dimension annotations"
        >
          DIM
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
          {/* Grid */}
          {showGrid && gridLines.map((l) => (
            <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.major ? "#BBB" : "#E0E0D8"} strokeWidth={l.major ? 0.08 : 0.04} />
          ))}
          {/* Axes (red X, green Y) */}
          <line x1={vb.x} y1={0} x2={vb.x + vb.w} y2={0} stroke="#FF3333" strokeWidth="0.15" opacity="0.7" />
          <line x1={0} y1={vb.y} x2={0} y2={vb.y + vb.h} stroke="#22AA22" strokeWidth="0.15" opacity="0.7" />

          {/* Walls */}
          {walls.map((w) => {
            const isSel = selected?.type === "wall" && selected.id === w.id;
            const isMoving = moveFrom?.type === "wall" && moveFrom.id === w.id;
            return (
              <line
                key={w.id}
                x1={w.start[0]}
                y1={w.start[1]}
                x2={w.end[0]}
                y2={w.end[1]}
                stroke={isSel ? "#FFCC00" : isMoving ? "#0055FF" : "#1a1a1a"}
                strokeWidth={Math.max(0.5, (w.thickness || 0.2) * 2)}
                strokeLinecap="square"
                onClick={(e) => onElementClick(e, "wall", w.id)}
                style={{ cursor: tool === "select" || tool === "eraser" || tool === "move" ? "pointer" : undefined }}
              />
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
                >DOOR</text>
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
                >WINDOW</text>
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

          {/* Text labels */}
          {labels.map((l) => {
            const isSel = selected?.type === "label" && selected.id === l.id;
            return (
              <g key={l.id} onClick={(e) => onElementClick(e, "label", l.id)} style={{ cursor: (tool === "select" || tool === "eraser") ? "pointer" : undefined }}>
                <rect x={l.position[0] - (String(l.text || "").length * 0.45 + 0.6)} y={l.position[1] - 1.1}
                  width={String(l.text || "").length * 0.9 + 1.2} height={2.2}
                  fill={isSel ? "#FFCC00" : "rgba(255,255,255,0.85)"} stroke="#333" strokeWidth="0.08" />
                <text x={l.position[0]} y={l.position[1] + 0.55}
                  fontSize="1.5" fill="#1a1a1a" textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace" fontWeight="600">
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

        {/* Text label inline editor */}
        {textEditor && (
          <form
            data-testid="cad-text-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const v = (textEditor.value || "").trim();
              if (v) {
                setLabels((arr) => [...arr, { id: cryptoId(), position: textEditor.position, text: v.slice(0, 40) }]);
                markDirty();
              }
              setTextEditor(null);
            }}
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
              onBlur={(e) => {
                const v = (e.target.value || "").trim();
                if (v) {
                  setLabels((arr) => [...arr, { id: cryptoId(), position: textEditor.position, text: v.slice(0, 40) }]);
                  markDirty();
                }
                setTextEditor(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTextEditor(null);
                  e.stopPropagation();
                }
              }}
              placeholder="Type label…"
              maxLength={40}
              className="bg-white border-2 border-[#FFCC00] px-2 py-1 text-sm font-mono text-black shadow-md w-44"
            />
          </form>
        )}

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
        <form onSubmit={onMeasureSubmit} className="flex items-center gap-1">
          <span className="label-mono text-neutral-500">LENGTH</span>
          <input
            data-testid="cad-measurement-input"
            value={measureInput}
            onChange={(e) => setMeasureInput(e.target.value)}
            placeholder="e.g. 12"
            className="w-20 bg-black border border-white/20 px-2 py-1 text-white text-right font-mono"
          />
          <button type="submit" className="text-[#FFCC00] hover:underline">↵</button>
        </form>
      </div>
    </div>
  );
}
