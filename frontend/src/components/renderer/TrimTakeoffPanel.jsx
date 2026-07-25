import React, { useMemo } from "react";

/**
 * Trim takeoff widget (Session 7).
 *
 * Computes linear feet of trim per room for each of the 5 trim types:
 *   • Baseboard    (from `wall.trim_baseboard`)
 *   • Crown        (from `wall.trim_crown`)
 *   • Chair Rail   (from `wall.trim_chair_rail`)
 *   • Door casing  (auto from doors on that wall × 17 LF each)
 *   • Window casing(auto from windows on that wall × 16 LF each)
 *
 * Room ↔ wall association uses the same axis-aligned room-rect algorithm
 * as `buildRooms` (see sceneBuilder.js). A wall is associated with a room
 * if it lies on the room's perimeter (within a small tolerance).
 *
 * Casing constants match industry-typical measurements:
 *   • Door casing per unit ≈ 2·(6.67 ft header) + door_width  → ~17 LF for a 3 ft door
 *   • Window casing per unit ≈ 2·(window_h) + 2·(window_w)    → ~16 LF for a 4×4 ft window
 * The widget uses 17 LF and 16 LF flat rates for simplicity; refine later.
 */

const DOOR_CASING_LF   = 17;
const WINDOW_CASING_LF = 16;
const PERIMETER_TOL_FT = 1.5;   // wall midpoint within N ft of rect edge

function _roomRectFt(labelXy, walls, aabbFt) {
  const [lx, ly] = labelXy;
  const PAD = 0.25;
  let x0 = aabbFt.x0, x1 = aabbFt.x1, y0 = aabbFt.y0, y1 = aabbFt.y1;
  const EPS = 0.05;
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    const [ax, ay] = w.start, [bx, by] = w.end;
    const wminY = Math.min(ay, by), wmaxY = Math.max(ay, by);
    const wminX = Math.min(ax, bx), wmaxX = Math.max(ax, bx);
    if (wminY - EPS <= ly && ly <= wmaxY + EPS) {
      if (Math.abs(by - ay) > 1e-6) {
        const t = (ly - ay) / (by - ay);
        const wx = ax + t * (bx - ax);
        if (wx > lx && wx < x1) x1 = wx;
        if (wx < lx && wx > x0) x0 = wx;
      }
    }
    if (wminX - EPS <= lx && lx <= wmaxX + EPS) {
      if (Math.abs(bx - ax) > 1e-6) {
        const t = (lx - ax) / (bx - ax);
        const wy = ay + t * (by - ay);
        if (wy > ly && wy < y1) y1 = wy;
        if (wy < ly && wy > y0) y0 = wy;
      }
    }
  }
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  return { x0: x0 + PAD, y0: y0 + PAD, x1: x1 - PAD, y1: y1 - PAD };
}

function _wallOnRoomPerimeter(wall, rect) {
  // Wall is "on" the room's perimeter if BOTH endpoints are within the
  // rect (extended by TOL) AND the wall is aligned to one of the 4 edges.
  const [sx, sy] = wall.start, [ex, ey] = wall.end;
  const inside = (x, y) =>
    x >= rect.x0 - PERIMETER_TOL_FT && x <= rect.x1 + PERIMETER_TOL_FT &&
    y >= rect.y0 - PERIMETER_TOL_FT && y <= rect.y1 + PERIMETER_TOL_FT;
  if (!inside(sx, sy) || !inside(ex, ey)) return false;
  const midX = (sx + ex) / 2, midY = (sy + ey) / 2;
  return (
    Math.abs(midY - rect.y0) < PERIMETER_TOL_FT ||
    Math.abs(midY - rect.y1) < PERIMETER_TOL_FT ||
    Math.abs(midX - rect.x0) < PERIMETER_TOL_FT ||
    Math.abs(midX - rect.x1) < PERIMETER_TOL_FT
  );
}

function _wallLengthFt(wall) {
  if (!wall.start || !wall.end) return 0;
  const [sx, sy] = wall.start, [ex, ey] = wall.end;
  return Math.hypot(ex - sx, ey - sy);
}

function _footprintAabbFt(walls) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    x0 = Math.min(x0, w.start[0], w.end[0]);
    x1 = Math.max(x1, w.start[0], w.end[0]);
    y0 = Math.min(y0, w.start[1], w.end[1]);
    y1 = Math.max(y1, w.start[1], w.end[1]);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function _computeTrim(sheets) {
  const perRoom = [];
  const totals = { baseboard: 0, crown: 0, chair_rail: 0, door_casing: 0, window_casing: 0 };
  for (const sheet of sheets || []) {
    if ((sheet.view_type || "floor_plan") !== "floor_plan") continue;
    const walls = sheet.walls || [];
    const doors = sheet.doors || [];
    const windows = sheet.windows || [];
    const labels = sheet.labels || [];
    if (!walls.length || !labels.length) continue;
    const aabb = _footprintAabbFt(walls);
    if (!aabb) continue;
    for (let li = 0; li < labels.length; li++) {
      const lbl = labels[li];
      if (!lbl?.position) continue;
      const rect = _roomRectFt(lbl.position, walls, aabb);
      if (!rect) continue;
      let baseboardLF = 0, crownLF = 0, chairRailLF = 0;
      const perimeterWallIndices = new Set();
      for (let wi = 0; wi < walls.length; wi++) {
        const w = walls[wi];
        if (!_wallOnRoomPerimeter(w, rect)) continue;
        perimeterWallIndices.add(wi);
        const lf = _wallLengthFt(w);
        if (w.trim_baseboard) baseboardLF += lf;
        if (w.trim_crown) crownLF += lf;
        if (w.trim_chair_rail) chairRailLF += lf;
      }
      let doorCount = 0, windowCount = 0;
      for (const d of doors) {
        if (d.wall_index !== undefined && perimeterWallIndices.has(d.wall_index)) doorCount++;
      }
      for (const w of windows) {
        if (w.wall_index !== undefined && perimeterWallIndices.has(w.wall_index)) windowCount++;
      }
      const doorCasing = doorCount * DOOR_CASING_LF;
      const windowCasing = windowCount * WINDOW_CASING_LF;
      const name = (lbl.name_override || lbl.text || "Room").trim();
      const total = baseboardLF + crownLF + chairRailLF + doorCasing + windowCasing;
      if (total <= 0.5) continue;  // hide rooms with zero trim tagged
      perRoom.push({
        key: `${sheet.id}-${li}`,
        name,
        baseboard: baseboardLF,
        crown: crownLF,
        chair_rail: chairRailLF,
        door_casing: doorCasing,
        window_casing: windowCasing,
        total,
      });
      totals.baseboard    += baseboardLF;
      totals.crown        += crownLF;
      totals.chair_rail   += chairRailLF;
      totals.door_casing  += doorCasing;
      totals.window_casing += windowCasing;
    }
  }
  return { perRoom, totals };
}

const fmt = (n) => n > 0 ? `${n.toFixed(1)} LF` : "—";

export function TrimTakeoffPanel({ sheets }) {
  const { perRoom, totals } = useMemo(() => _computeTrim(sheets), [sheets]);
  const grandTotal = totals.baseboard + totals.crown + totals.chair_rail + totals.door_casing + totals.window_casing;

  if (grandTotal <= 0.5) {
    return (
      <div data-testid="trim-takeoff-panel" className="mt-6 border border-white/10 bg-black/40 p-3">
        <div className="label-mono text-neutral-400 mb-2">// TRIM TAKEOFF</div>
        <p className="text-xs text-neutral-500 leading-relaxed">
          Select a wall in the 3D editor and check <span className="text-[#FFCC00]">Baseboard</span>,
          {" "}<span className="text-[#FFCC00]">Crown</span>, or{" "}
          <span className="text-[#FFCC00]">Chair Rail</span> to start tagging trim.
          Door & window casings auto-count from openings on tagged walls.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="trim-takeoff-panel" className="mt-6 border border-[#FFCC00]/30 bg-[#FFCC00]/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="label-mono text-[#FFCC00]">// TRIM TAKEOFF</div>
        <div data-testid="trim-takeoff-grand-total" className="label-mono text-[#FFCC00] text-xs">
          {grandTotal.toFixed(1)} LF total
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead className="text-neutral-500">
            <tr className="border-b border-white/10">
              <th className="text-left py-1 pr-2">Room</th>
              <th className="text-right py-1 px-1" title="Baseboard">Base</th>
              <th className="text-right py-1 px-1" title="Crown molding">Crown</th>
              <th className="text-right py-1 px-1" title="Chair rail">Chair</th>
              <th className="text-right py-1 px-1" title="Door casing">D.Cas</th>
              <th className="text-right py-1 px-1" title="Window casing">W.Cas</th>
              <th className="text-right py-1 pl-2">Total</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {perRoom.map((r) => (
              <tr key={r.key} data-testid={`trim-takeoff-row-${r.key}`} className="border-b border-white/5">
                <td className="py-1 pr-2 text-[#FFCC00]">{r.name}</td>
                <td className="text-right py-1 px-1">{fmt(r.baseboard)}</td>
                <td className="text-right py-1 px-1">{fmt(r.crown)}</td>
                <td className="text-right py-1 px-1">{fmt(r.chair_rail)}</td>
                <td className="text-right py-1 px-1">{fmt(r.door_casing)}</td>
                <td className="text-right py-1 px-1">{fmt(r.window_casing)}</td>
                <td className="text-right py-1 pl-2 text-[#FFCC00]">{r.total.toFixed(1)}</td>
              </tr>
            ))}
            <tr className="border-t border-[#FFCC00]/40">
              <td className="py-1 pr-2 text-neutral-500">TOTAL</td>
              <td className="text-right py-1 px-1 text-[#FFCC00]">{fmt(totals.baseboard)}</td>
              <td className="text-right py-1 px-1 text-[#FFCC00]">{fmt(totals.crown)}</td>
              <td className="text-right py-1 px-1 text-[#FFCC00]">{fmt(totals.chair_rail)}</td>
              <td className="text-right py-1 px-1 text-[#FFCC00]">{fmt(totals.door_casing)}</td>
              <td className="text-right py-1 px-1 text-[#FFCC00]">{fmt(totals.window_casing)}</td>
              <td className="text-right py-1 pl-2 text-[#FFCC00]">{grandTotal.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-neutral-600 mt-2 leading-tight">
        Casing rates: door 17 LF / unit, window 16 LF / unit. Auto-counts openings whose
        <span className="text-neutral-400"> wall_index</span> falls on a tagged perimeter wall.
      </div>
    </div>
  );
}
