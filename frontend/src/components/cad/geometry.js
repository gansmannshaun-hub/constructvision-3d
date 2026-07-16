// Pure geometry helpers used by the CAD editor. No React, no side effects —
// safe to import from anywhere and unit-testable in isolation.

/** Generates a stable id via crypto.randomUUID when available. */
export function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Euclidean distance between two [x, y] points. */
export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Distance from point p to line segment ab.
 * @returns {{ point: [number, number], t: number, dist: number }}
 *   `point` is the closest point on the segment, `t` is the normalized
 *   position along AB (0 = at A, 1 = at B), `dist` is the distance from p.
 */
export function nearestOnSegment(p, a, b) {
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
