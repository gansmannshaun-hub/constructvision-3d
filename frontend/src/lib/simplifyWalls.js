/**
 * Wall geometry cleanup — merges near-parallel walls, snaps endpoints to a
 * grid, and drops sub-length slivers. Used by the CAD editor "SIMPLIFY"
 * button to tidy up messy AI/OpenCV-traced geometry in one click.
 */

const DEG = 180 / Math.PI;

/**
 * @param {Array<{id, start, end, thickness}>} walls
 * @param {{gridFt?: number, minLenFt?: number, angleTolDeg?: number, gapFt?: number}} opts
 * @returns {{ walls: Array, removed: number, merged: number, snapped: number }}
 */
export function simplifyWalls(walls, {
  gridFt = 0.5,
  minLenFt = 1.0,
  angleTolDeg = 3,
  gapFt = 0.5,
} = {}) {
  if (!Array.isArray(walls) || walls.length === 0) {
    return { walls: [], removed: 0, merged: 0, snapped: 0 };
  }
  let snapped = 0;
  // 1. Snap endpoints to the grid and drop < min length.
  const snappedList = [];
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    const s = [snap(w.start[0], gridFt), snap(w.start[1], gridFt)];
    const e = [snap(w.end[0], gridFt), snap(w.end[1], gridFt)];
    if (s[0] !== w.start[0] || s[1] !== w.start[1] || e[0] !== w.end[0] || e[1] !== w.end[1]) {
      snapped += 1;
    }
    const dx = e[0] - s[0], dy = e[1] - s[1];
    const len = Math.hypot(dx, dy);
    if (len < minLenFt) continue;
    snappedList.push({ ...w, start: s, end: e });
  }
  const removedByLen = walls.length - snappedList.length;

  // 2. Group by (angle bucket, perpendicular-offset bucket) and merge
  // overlapping / touching collinear segments in each bucket.
  const buckets = new Map();
  for (const w of snappedList) {
    const dx = w.end[0] - w.start[0];
    const dy = w.end[1] - w.start[1];
    // Angles are treated mod 180° so a segment and its reverse land in the
    // same bucket.
    let ang = ((Math.atan2(dy, dx) * DEG) + 360) % 180;
    // Snap the angle to horizontal/vertical when close, so slightly-off
    // walls collapse onto axis-aligned pairs.
    if (ang < angleTolDeg || ang > 180 - angleTolDeg) ang = 0;
    else if (Math.abs(ang - 90) < angleTolDeg) ang = 90;
    const angRad = ang / DEG;
    // Perpendicular offset from origin.
    const nx = -Math.sin(angRad), ny = Math.cos(angRad);
    const perp = w.start[0] * nx + w.start[1] * ny;
    const angBucket = Math.round(ang / Math.max(angleTolDeg, 1));
    const perpBucket = Math.round(perp / Math.max(gapFt, 0.1));
    const key = `${angBucket}|${perpBucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    // Parameterize both endpoints along the line direction so we can sort.
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
        // Merge — extend cur to include seg.
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
  };
}

function snap(v, step) {
  return Math.round(v / step) * step;
}

function paramToWall(seg) {
  const start = [
    seg.dirx * seg.tmin + seg.perp * seg.nx,
    seg.diry * seg.tmin + seg.perp * seg.ny,
  ];
  const end = [
    seg.dirx * seg.tmax + seg.perp * seg.nx,
    seg.diry * seg.tmax + seg.perp * seg.ny,
  ];
  // Round to millimeter to avoid float drift after trig.
  return {
    ...seg.w,
    start: [Math.round(start[0] * 1000) / 1000, Math.round(start[1] * 1000) / 1000],
    end:   [Math.round(end[0]   * 1000) / 1000, Math.round(end[1]   * 1000) / 1000],
  };
}
