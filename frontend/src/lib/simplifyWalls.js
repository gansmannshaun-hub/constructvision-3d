/**
 * Wall geometry cleanup — merges near-parallel walls, snaps endpoints to a
 * grid, forces walls close to horizontal/vertical to be exactly axis-aligned,
 * and drops sub-length slivers.
 */

const DEG = 180 / Math.PI;

/**
 * @param {Array<{id, start, end, thickness}>} walls
 * @param {{gridFt?: number, minLenFt?: number, angleTolDeg?: number, gapFt?: number, axisSnap?: boolean}} opts
 * @returns {{ walls: Array, removed: number, merged: number, snapped: number, straightened: number }}
 */
export function simplifyWalls(walls, {
  gridFt = 0.5,
  minLenFt = 1.0,
  angleTolDeg = 3,
  gapFt = 0.5,
  axisSnap = true,
} = {}) {
  if (!Array.isArray(walls) || walls.length === 0) {
    return { walls: [], removed: 0, merged: 0, snapped: 0, straightened: 0 };
  }
  let snapped = 0;
  let straightened = 0;
  // 1. Snap endpoints to grid, force near-axis walls to be exactly axis-aligned,
  //    drop < minLenFt.
  const snappedList = [];
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    let sx = snap(w.start[0], gridFt), sy = snap(w.start[1], gridFt);
    let ex = snap(w.end[0], gridFt), ey = snap(w.end[1], gridFt);
    if (sx !== w.start[0] || sy !== w.start[1] || ex !== w.end[0] || ey !== w.end[1]) {
      snapped += 1;
    }
    if (axisSnap) {
      const dx = ex - sx, dy = ey - sy;
      const angle = Math.abs(Math.atan2(dy, dx) * DEG) % 180;
      // Horizontal
      if (angle < angleTolDeg * 3 || angle > 180 - angleTolDeg * 3) {
        if (sy !== ey) { ey = sy; straightened += 1; }
      }
      // Vertical
      else if (Math.abs(angle - 90) < angleTolDeg * 3) {
        if (sx !== ex) { ex = sx; straightened += 1; }
      }
    }
    const len = Math.hypot(ex - sx, ey - sy);
    if (len < minLenFt) continue;
    snappedList.push({ ...w, start: [sx, sy], end: [ex, ey] });
  }
  const removedByLen = walls.length - snappedList.length;

  // 2. Merge collinear segments in each (angle, perpendicular-offset) bucket.
  const buckets = new Map();
  for (const w of snappedList) {
    const dx = w.end[0] - w.start[0];
    const dy = w.end[1] - w.start[1];
    let ang = ((Math.atan2(dy, dx) * DEG) + 360) % 180;
    if (ang < angleTolDeg || ang > 180 - angleTolDeg) ang = 0;
    else if (Math.abs(ang - 90) < angleTolDeg) ang = 90;
    const angRad = ang / DEG;
    const nx = -Math.sin(angRad), ny = Math.cos(angRad);
    const perp = w.start[0] * nx + w.start[1] * ny;
    const angBucket = Math.round(ang / Math.max(angleTolDeg, 1));
    const perpBucket = Math.round(perp / Math.max(gapFt, 0.1));
    const key = `${angBucket}|${perpBucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    const dirx = Math.cos(angRad), diry = Math.sin(angRad);
    const t1 = w.start[0] * dirx + w.start[1] * diry;
    const t2 = w.end[0] * dirx + w.end[1] * diry;
    const tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
    buckets.get(key).push({ tmin, tmax, dirx, diry, nx, ny, perp, w });
  }

  const outWalls = [];
  let mergedCount = 0;
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.tmin - b.tmin);
    let cur = null;
    for (const seg of bucket) {
      if (!cur) { cur = { ...seg }; continue; }
      if (seg.tmin <= cur.tmax + gapFt) {
        if (seg.tmax > cur.tmax) cur.tmax = seg.tmax;
        mergedCount += 1;
      } else {
        outWalls.push(paramToWall(cur));
        cur = { ...seg };
      }
    }
    if (cur) outWalls.push(paramToWall(cur));
  }

  return {
    walls: outWalls,
    removed: removedByLen,
    merged: mergedCount,
    snapped,
    straightened,
  };
}

function snap(v, step) { return Math.round(v / step) * step; }

function paramToWall(seg) {
  const start = [
    seg.dirx * seg.tmin + seg.perp * seg.nx,
    seg.diry * seg.tmin + seg.perp * seg.ny,
  ];
  const end = [
    seg.dirx * seg.tmax + seg.perp * seg.nx,
    seg.diry * seg.tmax + seg.perp * seg.ny,
  ];
  return {
    ...seg.w,
    start: [Math.round(start[0] * 1000) / 1000, Math.round(start[1] * 1000) / 1000],
    end:   [Math.round(end[0]   * 1000) / 1000, Math.round(end[1]   * 1000) / 1000],
  };
}
