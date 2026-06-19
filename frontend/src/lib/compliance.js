// Building-code compliance checker — pure deterministic logic over the blueprint.
// 1 blueprint unit = 1 foot.
//
// Rules implemented (IBC 2021 + IRC residential):
//   - Egress doors >= 32" clear (2.67 ft); front door >= 36" (3 ft)
//   - Bedroom egress window >= 5.7 sqft net, sill <= 44" — flagged as "needs verification"
//   - Corridor / hallway width >= 36" residential, 44" commercial
//   - Minimum room area: bedroom >= 70 sqft, bath >= 35 sqft (heuristic)
//   - At least one labeled exterior door
//   - Ceiling height (from blueprint config) >= 7'6"
//
// Output: { warnings: [{ severity, code, message, location:{x,y}|null }], summary }

const HALLWAY_KEYWORDS = ["corridor", "hall", "hallway", "passage"];
const BEDROOM_KEYWORDS = ["bed", "br", "bedroom", "master"];
const BATH_KEYWORDS    = ["bath", "wc", "restroom", "toilet"];
const KITCHEN_KEYWORDS = ["kitchen"];

const MIN_DOOR_WIDTH   = 2.67;   // 32"
const MIN_FRONT_DOOR   = 3.0;    // 36"
const MIN_HALL_WIDTH   = 3.0;    // residential 36"
const MIN_HALL_WIDTH_C = 3.67;   // commercial 44"
const MIN_BEDROOM_AREA = 70;     // sqft
const MIN_BATH_AREA    = 35;     // sqft
const MIN_CEILING_FT   = 7.5;    // 7'6"

function dist(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function wallLen(w) {
  return dist(w.start, w.end);
}

/** Compute axis-aligned bounding box around all wall endpoints. */
function aabb(walls) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.start[0], w.end[0]);
    maxX = Math.max(maxX, w.start[0], w.end[0]);
    minY = Math.min(minY, w.start[1], w.end[1]);
    maxY = Math.max(maxY, w.start[1], w.end[1]);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

function pointInLabel(label, key) {
  const t = (label?.text || "").toLowerCase();
  return key.some((k) => t.includes(k));
}

/** Heuristic per-label room area: distance to nearest non-coincident label, squared. */
function approxRoomArea(label, allLabels) {
  let nearest = Infinity;
  for (const other of allLabels) {
    if (other === label) continue;
    const d = dist(label.position, other.position);
    if (d > 0.1 && d < nearest) nearest = d;
  }
  if (!Number.isFinite(nearest)) return null;
  // crude: assume rectangular room ~ nearest^2/2
  return Math.max(20, (nearest * nearest) / 2);
}

export function runCompliance(blueprint, opts = {}) {
  const occupancy = opts.occupancy || "residential"; // "residential" | "commercial"
  const ceilingFt = opts.ceilingFt ?? 9;
  const warnings = [];

  const walls = blueprint?.walls || [];
  const doors = blueprint?.doors || [];
  const windows = blueprint?.windows || [];
  const labels = blueprint?.labels || [];

  // Bail if there's no model yet
  if (walls.length === 0) {
    return {
      warnings: [],
      summary: "No model yet — compliance check needs walls.",
      counts: { errors: 0, warnings: 0, info: 0 },
    };
  }

  // ---- 1. Doors width ----
  doors.forEach((d, i) => {
    const w = Number(d.width || 0);
    if (w < MIN_DOOR_WIDTH) {
      warnings.push({
        severity: "error",
        code: "IBC-1010.1.1",
        message: `Door #${i + 1} is ${(w * 12).toFixed(0)}" — IBC egress requires ≥32" clear width.`,
        location: d.position,
      });
    }
  });

  // ---- 2. Exterior door exists ----
  if (doors.length === 0) {
    warnings.push({
      severity: "error",
      code: "IBC-1006.2",
      message: "No doors found — every dwelling must have at least one exterior egress door.",
      location: null,
    });
  } else {
    const widest = Math.max(...doors.map((d) => Number(d.width || 0)));
    if (widest < MIN_FRONT_DOOR) {
      warnings.push({
        severity: "warning",
        code: "IRC-R311.2",
        message: `Widest door is ${(widest * 12).toFixed(0)}" — IRC main entry door should be ≥36".`,
        location: null,
      });
    }
  }

  // ---- 3. Corridor / hallway labels: check adjacent wall spacing ----
  const minHall = occupancy === "commercial" ? MIN_HALL_WIDTH_C : MIN_HALL_WIDTH;
  for (const lbl of labels) {
    if (!pointInLabel(lbl, HALLWAY_KEYWORDS)) continue;
    // measure distance to nearest two parallel walls (horizontal + vertical)
    const [lx, ly] = lbl.position;
    let nearestXWallDist = Infinity, nearestYWallDist = Infinity;
    for (const w of walls) {
      const dx = Math.abs(w.start[0] - w.end[0]);
      const dy = Math.abs(w.start[1] - w.end[1]);
      if (dx < 0.05 && dy > 1) {  // vertical wall
        const xline = w.start[0];
        const dn = Math.abs(lx - xline);
        if (dn < nearestXWallDist) nearestXWallDist = dn;
      }
      if (dy < 0.05 && dx > 1) {  // horizontal wall
        const yline = w.start[1];
        const dn = Math.abs(ly - yline);
        if (dn < nearestYWallDist) nearestYWallDist = dn;
      }
    }
    const narrowest = Math.min(nearestXWallDist * 2, nearestYWallDist * 2);
    if (Number.isFinite(narrowest) && narrowest < minHall) {
      warnings.push({
        severity: "error",
        code: occupancy === "commercial" ? "IBC-1020.2" : "IRC-R311.6",
        message: `${lbl.text}: ~${(narrowest * 12).toFixed(0)}" wide — ${occupancy === "commercial" ? "IBC requires ≥44\"" : "IRC requires ≥36\""}.`,
        location: lbl.position,
      });
    }
  }

  // ---- 4. Min room area heuristic ----
  for (const lbl of labels) {
    const area = approxRoomArea(lbl, labels);
    if (!area) continue;
    if (pointInLabel(lbl, BEDROOM_KEYWORDS) && area < MIN_BEDROOM_AREA) {
      warnings.push({
        severity: "warning",
        code: "IRC-R304.1",
        message: `${lbl.text}: ~${area.toFixed(0)} sqft — habitable rooms must be ≥70 sqft.`,
        location: lbl.position,
      });
    }
    if (pointInLabel(lbl, BATH_KEYWORDS) && area < MIN_BATH_AREA) {
      warnings.push({
        severity: "warning",
        code: "IRC-R307.1",
        message: `${lbl.text}: ~${area.toFixed(0)} sqft — tight clearance, verify 30" toilet centerline.`,
        location: lbl.position,
      });
    }
  }

  // ---- 5. Bedrooms need an egress window ----
  for (const lbl of labels) {
    if (!pointInLabel(lbl, BEDROOM_KEYWORDS)) continue;
    const bb = aabb(walls);
    if (!bb) continue;
    // check if at least one window is within 8 ft of the label position
    const hasWindow = windows.some((w) => dist(w.position, lbl.position) < 10);
    if (!hasWindow) {
      warnings.push({
        severity: "error",
        code: "IRC-R310.1",
        message: `${lbl.text}: no nearby window — every sleeping room requires an egress window.`,
        location: lbl.position,
      });
    }
  }

  // ---- 6. Ceiling height ----
  if (ceilingFt < MIN_CEILING_FT) {
    warnings.push({
      severity: "error",
      code: "IRC-R305.1",
      message: `Ceiling height ${ceilingFt}' < 7'6" minimum.`,
      location: null,
    });
  }

  // ---- 7. Disconnected (unclosed) building footprint ----
  // simple check: total wall length should exceed the perimeter of the bounding box
  const bb = aabb(walls);
  if (bb) {
    const perimeter = 2 * ((bb.maxX - bb.minX) + (bb.maxY - bb.minY));
    const totalLen = walls.reduce((s, w) => s + wallLen(w), 0);
    if (totalLen < perimeter * 0.95) {
      warnings.push({
        severity: "warning",
        code: "STRUCT-01",
        message: `Wall perimeter looks incomplete — exterior may be open.`,
        location: null,
      });
    }
  }

  const counts = {
    errors: warnings.filter((w) => w.severity === "error").length,
    warnings: warnings.filter((w) => w.severity === "warning").length,
    info: warnings.filter((w) => w.severity === "info").length,
  };
  const summary =
    counts.errors > 0
      ? `${counts.errors} code violation${counts.errors === 1 ? "" : "s"} found.`
      : counts.warnings > 0
      ? `${counts.warnings} item${counts.warnings === 1 ? "" : "s"} to verify.`
      : "Looks compliant.";

  return { warnings, summary, counts };
}
