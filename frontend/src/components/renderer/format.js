// Pure formatting helpers used by the 3D renderer. Kept in a plain JS module
// so they can be unit-tested and reused without pulling in Three.js or React.

const API_BASE = process.env.REACT_APP_BACKEND_URL;
export const RENDERER_API = `${API_BASE}/api`;

/**
 * Fallback feet-inches formatter used when the engine is not yet mounted.
 * The engine's own `formatFtIn` produces slightly nicer output (fractional
 * inches, mixed-unit rounding) — this is the "before hydration" fallback.
 */
export function fallbackFmtFtIn(ft) {
  if (!Number.isFinite(ft)) return "—";
  const whole = Math.floor(ft);
  const inches = Math.round((ft - whole) * 12);
  return `${whole}' ${inches}"`;
}
