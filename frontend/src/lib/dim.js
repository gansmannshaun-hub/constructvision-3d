// Shared dimension formatting helpers for the 2D CAD editor, blueprint view,
// and any future label rendering. Conventions:
//   1 blueprint coordinate unit = 1 foot (US construction default).
// Conversion to metric is centralised here so the renderer / takeoff PDF
// stay aligned.
export const UNIT_FT = 1;            // feet per blueprint unit
export const UNIT_M  = 0.3048;        // meters per blueprint unit

/** Format a blueprint-unit length as feet-inches (e.g. 12'-6"). */
export function formatFeetInches(units) {
  const totalInches = Math.round(units * 12);
  if (!Number.isFinite(totalInches)) return "";
  const sign = totalInches < 0 ? "-" : "";
  const abs = Math.abs(totalInches);
  const feet = Math.floor(abs / 12);
  const inches = abs % 12;
  return `${sign}${feet}'-${inches.toString().padStart(1, "0")}"`;
}

/** Format as meters with 2 decimal places (e.g. 3.81 m). */
export function formatMeters(units) {
  return `${(units * UNIT_M).toFixed(2)} m`;
}

/** Combined display: 12'-6" (3.81 m). Used in tooltips & headers. */
export function formatDual(units) {
  return `${formatFeetInches(units)} (${formatMeters(units)})`;
}

/** Axis-aligned bounding box of a list of walls (with .start/.end). */
export function wallsAabb(walls) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of walls || []) {
    if (!w.start || !w.end) continue;
    minX = Math.min(minX, w.start[0], w.end[0]);
    maxX = Math.max(maxX, w.start[0], w.end[0]);
    minY = Math.min(minY, w.start[1], w.end[1]);
    maxY = Math.max(maxY, w.start[1], w.end[1]);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}
