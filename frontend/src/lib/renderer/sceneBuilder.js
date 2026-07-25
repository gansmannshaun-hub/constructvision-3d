// Pure Three.js scene engine for the 3D renderer.
// No React, no DOM ops other than what the caller supplies (a mount element).
// Public API:
//   createSceneEngine(mountEl) -> {
//     build(blueprint), setVisibility(map), dispose()
//   }
//   PHASES, ALL_LAYERS, MAX_PHASE, ROOF_TYPES, DEFAULT_CFG
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getFloorMaterial, DEFAULT_FLOOR_MATERIAL_ID, CEILING_DEFAULT_FT } from "./floorMaterials.js";
import { buildFixtureGroup } from "./fixtureMeshes.js";

// ---------- Constants ----------
// WALL_HEIGHT can be overridden per-build from elevation-sheet assembly
// data or a manual blueprint.wall_height_ft. Kept as `let` so all builder
// functions in this module see the same up-to-date value.
export let WALL_HEIGHT = 3.05;    // ~10 ft default (meters)
const DEFAULT_WALL_HEIGHT = 3.05;
export const SCALE = 0.3048;        // 1 blueprint unit (ft) -> meters
export const SLAB_THICK = 0.18;
export const FOOTING_DEPTH = 0.45;
export const EAVE_OVERHANG = 0.3;
const COLUMN_SIZE = 0.18;
const GIRT_SIZE = 0.12;
const GIRT_HEIGHTS = [0.6, 1.5, 2.4];
const PURLIN_SPACING = 1.2;
const PURLIN_SIZE = 0.12;
const PANEL_THICKNESS = 0.04;
const TRIM_THICKNESS = 0.06;
const COLUMN_MAX_SPACING = 4.0;

export const ROOF_TYPES = [
  { id: "gable", label: "Gable" },
  { id: "shed",  label: "Shed (Mono)" },
  { id: "flat",  label: "Flat" },
  { id: "hip",   label: "Hip" },
];

export const DEFAULT_CFG = {
  roof_type: "gable",
  roof_pitch_deg: 12,
  wall_color: "#D8D4CC",
  roof_color: "#4A5C6E",
};

export const PHASES = [
  { id: 0,  label: "Site",        layers: ["excavation"] },
  { id: 1,  label: "Underground", layers: ["excavation", "underground"] },
  { id: 2,  label: "Septic",      layers: ["excavation", "underground", "septic"] },
  { id: 3,  label: "Foundation",  layers: ["foundation", "underground", "septic"] },
  { id: 4,  label: "Columns",     layers: ["foundation", "underground", "septic", "columns"] },
  { id: 5,  label: "Frame",       layers: ["foundation", "underground", "septic", "columns", "frame"] },
  { id: 6,  label: "Plumbing",    layers: ["foundation", "columns", "frame", "plumbing"] },
  { id: 7,  label: "Electrical",  layers: ["foundation", "columns", "frame", "plumbing", "electrical"] },
  { id: 8,  label: "Wall Girts",  layers: ["foundation", "columns", "frame", "plumbing", "electrical", "girts"] },
  { id: 9,  label: "Roof Purlins",layers: ["foundation", "columns", "frame", "plumbing", "electrical", "girts", "purlins"] },
  { id: 10, label: "Roof Sheet",  layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet"] },
  { id: 11, label: "Wall Sheet",  layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet"] },
  { id: 12, label: "Openings",    layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet", "openings"] },
  { id: 13, label: "Trim",        layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet", "openings", "trim"] },
  { id: 14, label: "Finished",    layers: ["foundation", "wallSheet", "roofSheet", "openings", "trim", "rooms", "fixtures"] },
];
export const MAX_PHASE = PHASES.length - 1;

export const ALL_LAYERS = [
  { id: "excavation",  label: "Excavation",            color: "#5C3A1E" },
  { id: "underground", label: "Underground Utilities", color: "#3a78d6" },
  { id: "septic",      label: "Septic / Drain Field",  color: "#4d6b3a" },
  { id: "foundation",  label: "Foundation",            color: "#B0B0B0" },
  { id: "columns",     label: "Columns",               color: "#444444" },
  { id: "frame",       label: "Primary Frame",         color: "#555555" },
  { id: "plumbing",    label: "Plumbing",              color: "#3a9ed6" },
  { id: "electrical",  label: "Electrical",            color: "#FF6600" },
  { id: "girts",       label: "Wall Girts",            color: "#8C9499" },
  { id: "purlins",     label: "Roof Purlins",          color: "#8C9499" },
  { id: "roofSheet",   label: "Roof Sheeting",         color: "#4A5C6E" },
  { id: "wallSheet",   label: "Wall Sheeting",         color: "#D8D4CC" },
  { id: "openings",    label: "Doors & Windows",       color: "#FFCC00" },
  { id: "trim",        label: "Trim & Flashing",       color: "#FFFFFF" },
  { id: "rooms",       label: "Rooms (Floor & Ceiling)", color: "#8B5A2B" },
  { id: "fixtures",    label: "Fixtures",              color: "#5C7A8C" },
];

// Mutable config consumed by builders (set inside build()).
let CFG = { ...DEFAULT_CFG };

const pitchH = (aabb) => {
  if (CFG.roof_type === "flat") return 0;
  const ridgeAlongX = aabb.w >= aabb.d;
  const run = CFG.roof_type === "shed"
    ? (ridgeAlongX ? aabb.d : aabb.w)
    : (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  return Math.tan(THREE.MathUtils.degToRad(CFG.roof_pitch_deg || 0)) * run;
};
const toWorld = (p) => [p[0] * SCALE - 5, p[1] * SCALE - 5];

function wallSegment(w) {
  if (!w.start || !w.end) return null;
  const [sx, sz] = toWorld(w.start);
  const [ex, ez] = toWorld(w.end);
  const dx = ex - sx, dz = ez - sz;
  const length = Math.hypot(dx, dz);
  if (length < 0.05) return null;
  return { sx, sz, ex, ez, dx, dz, length, angle: Math.atan2(dz, dx), cx: (sx + ex) / 2, cz: (sz + ez) / 2 };
}

function footprintAabb(walls) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    minX = Math.min(minX, s.sx, s.ex);
    maxX = Math.max(maxX, s.sx, s.ex);
    minZ = Math.min(minZ, s.sz, s.ez);
    maxZ = Math.max(maxZ, s.sz, s.ez);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ };
}

function makeBox(w, h, d, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.2,
    transparent: !!opts.opacity,
    opacity: opts.opacity ?? 1,
    emissive: opts.emissive ?? 0,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = !opts.noShadow;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- Builders ----------
function buildExcavation(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const pad = 0.8;
  const m = makeBox(aabb.w + pad * 2, FOOTING_DEPTH * 1.2, aabb.d + pad * 2, "#5C3A1E", { roughness: 1, metalness: 0 });
  m.position.set(aabb.cx, -FOOTING_DEPTH * 0.6, aabb.cz);
  g.add(m);
  return g;
}

function buildFoundation(aabb, walls) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const slab = makeBox(aabb.w + 0.2, SLAB_THICK, aabb.d + 0.2, "#B8B5A8", { roughness: 0.9, metalness: 0 });
  slab.position.set(aabb.cx, SLAB_THICK / 2, aabb.cz);
  g.add(slab);
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const footing = makeBox(s.length + 0.3, FOOTING_DEPTH, 0.5, "#9A9789", { roughness: 1 });
    footing.position.set(s.cx, -FOOTING_DEPTH / 2 + 0.02, s.cz);
    footing.rotation.y = -s.angle;
    g.add(footing);
  }
  return g;
}

function buildColumns(walls) {
  const g = new THREE.Group();
  const placed = new Set();
  const placeAt = (x, z) => {
    const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
    if (placed.has(key)) return;
    placed.add(key);
    const col = makeBox(COLUMN_SIZE, WALL_HEIGHT, COLUMN_SIZE, "#3A3A3A", { roughness: 0.4, metalness: 0.85 });
    col.position.set(x, WALL_HEIGHT / 2 + SLAB_THICK, z);
    g.add(col);
  };
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    placeAt(s.sx, s.sz);
    placeAt(s.ex, s.ez);
    const n = Math.floor(s.length / COLUMN_MAX_SPACING);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      placeAt(s.sx + s.dx * t, s.sz + s.dz * t);
    }
  }
  return g;
}

function buildFrame(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const beam = makeBox(s.length, 0.22, 0.18, "#444", { roughness: 0.4, metalness: 0.85 });
    beam.position.set(s.cx, WALL_HEIGHT + SLAB_THICK - 0.11, s.cz);
    beam.rotation.y = -s.angle;
    g.add(beam);
  }
  if (CFG.roof_type === "flat") return g;
  const ridgeAlongX = aabb.w >= aabb.d;
  const ph = pitchH(aabb);
  const ridgeY = WALL_HEIGHT + SLAB_THICK + ph;
  if (CFG.roof_type === "shed") {
    const len = ridgeAlongX ? aabb.w : aabb.d;
    const ridge = makeBox(len, 0.2, 0.2, "#444", { roughness: 0.4, metalness: 0.85 });
    if (ridgeAlongX) ridge.position.set(aabb.cx, ridgeY, aabb.minZ);
    else { ridge.position.set(aabb.minX, ridgeY, aabb.cz); ridge.rotation.y = Math.PI / 2; }
    g.add(ridge);
    return g;
  }
  const ridgeLen = ridgeAlongX ? aabb.w : aabb.d;
  const ridgeShrink = CFG.roof_type === "hip" ? Math.min(aabb.w, aabb.d) * 0.5 : 0;
  const ridge = makeBox(ridgeLen - ridgeShrink, 0.2, 0.2, "#444", { roughness: 0.4, metalness: 0.85 });
  ridge.position.set(aabb.cx, ridgeY, aabb.cz);
  if (!ridgeAlongX) ridge.rotation.y = Math.PI / 2;
  g.add(ridge);
  return g;
}

function buildGirts(walls) {
  const g = new THREE.Group();
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    for (const h of GIRT_HEIGHTS) {
      const girt = makeBox(s.length, GIRT_SIZE, GIRT_SIZE, "#A4ACB0", { roughness: 0.4, metalness: 0.85 });
      girt.position.set(s.cx, h + SLAB_THICK, s.cz);
      girt.rotation.y = -s.angle;
      g.add(girt);
    }
  }
  return g;
}

function buildPurlins(aabb) {
  const g = new THREE.Group();
  if (!aabb || CFG.roof_type === "flat") return g;
  const ridgeAlongX = aabb.w >= aabb.d;
  const ph = pitchH(aabb);
  const isShed = CFG.roof_type === "shed";
  const slopeRun = isShed ? (ridgeAlongX ? aabb.d : aabb.w) : (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  const slopeLen = Math.hypot(slopeRun, ph);
  const sideLen = (ridgeAlongX ? aabb.w : aabb.d) + EAVE_OVERHANG * 2;
  const purlinCount = Math.max(2, Math.floor(slopeLen / PURLIN_SPACING));
  const sides = isShed ? [1] : [-1, 1];
  for (let i = 0; i <= purlinCount; i++) {
    const t = purlinCount === 0 ? 0 : i / purlinCount;
    const yAtSlope = WALL_HEIGHT + SLAB_THICK + ph * (1 - t);
    const offRun = slopeRun * t;
    for (const side of sides) {
      if (ridgeAlongX) {
        const p = makeBox(sideLen, PURLIN_SIZE, PURLIN_SIZE, "#A4ACB0", { roughness: 0.4, metalness: 0.85 });
        p.position.set(aabb.cx, yAtSlope, aabb.cz + side * offRun);
        g.add(p);
      } else {
        const p = makeBox(PURLIN_SIZE, PURLIN_SIZE, sideLen, "#A4ACB0", { roughness: 0.4, metalness: 0.85 });
        p.position.set(aabb.cx + side * offRun, yAtSlope, aabb.cz);
        g.add(p);
      }
    }
  }
  return g;
}

function buildWallSheeting(walls) {
  const g = new THREE.Group();
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    // Per-wall height override — falls back to the sheet-wide WALL_HEIGHT
    // when the wall doesn't carry an explicit `height_ft` (Session 2 3D-editor feature).
    const hFt = Number(w.height_ft);
    const wh = (Number.isFinite(hFt) && hFt > 0) ? hFt * SCALE : WALL_HEIGHT;
    const nx = -Math.sin(-s.angle), nz = Math.cos(-s.angle);
    const panel = makeBox(s.length, wh, PANEL_THICKNESS, CFG.wall_color, { roughness: 0.5, metalness: 0.6 });
    panel.position.set(s.cx + nx * (PANEL_THICKNESS / 2 + 0.05),
                       wh / 2 + SLAB_THICK,
                       s.cz + nz * (PANEL_THICKNESS / 2 + 0.05));
    panel.rotation.y = -s.angle;
    g.add(panel);
    const ribCount = Math.max(2, Math.floor(s.length / 0.6));
    for (let i = 0; i < ribCount; i++) {
      const t = (i + 0.5) / ribCount;
      const rib = makeBox(0.04, wh * 0.98, 0.02, "#C6C2BA", { roughness: 0.6, metalness: 0.5, noShadow: true });
      const x = s.sx + s.dx * t + nx * (PANEL_THICKNESS / 2 + 0.07);
      const z = s.sz + s.dz * t + nz * (PANEL_THICKNESS / 2 + 0.07);
      rib.position.set(x, wh / 2 + SLAB_THICK, z);
      rib.rotation.y = -s.angle;
      g.add(rib);
    }
  }
  return g;
}

function buildRoofSheeting(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  // Every roof panel added below is tagged pickable_roof so the 3D
  // wall editor's raycaster can also select roofs.
  const color = CFG.roof_color;
  const ridgeAlongX = aabb.w >= aabb.d;
  const ph = pitchH(aabb);
  if (CFG.roof_type === "flat") {
    const panel = makeBox(aabb.w + EAVE_OVERHANG * 2, PANEL_THICKNESS, aabb.d + EAVE_OVERHANG * 2, color, { roughness: 0.4, metalness: 0.7 });
    panel.position.set(aabb.cx, WALL_HEIGHT + SLAB_THICK + PANEL_THICKNESS / 2, aabb.cz);
    g.add(panel);
    return g;
  }
  if (CFG.roof_type === "shed") {
    const run = ridgeAlongX ? aabb.d : aabb.w;
    const slope = Math.hypot(run, ph);
    const panel = makeBox(
      ridgeAlongX ? aabb.w + EAVE_OVERHANG * 2 : slope + EAVE_OVERHANG * 2,
      PANEL_THICKNESS,
      ridgeAlongX ? slope + EAVE_OVERHANG * 2 : aabb.d + EAVE_OVERHANG * 2,
      color, { roughness: 0.4, metalness: 0.7 }
    );
    panel.position.set(aabb.cx, WALL_HEIGHT + SLAB_THICK + ph / 2, aabb.cz);
    if (ridgeAlongX) panel.rotation.x = -Math.atan2(ph, run);
    else             panel.rotation.z = Math.atan2(ph, run);
    g.add(panel);
    return g;
  }
  const slopeRun = ridgeAlongX ? aabb.d / 2 : aabb.w / 2;
  const slopeLen = Math.hypot(slopeRun, ph);
  const sideLen = (ridgeAlongX ? aabb.w : aabb.d) + EAVE_OVERHANG * 2;
  for (const side of [-1, 1]) {
    const panel = makeBox(sideLen, PANEL_THICKNESS, slopeLen + EAVE_OVERHANG * 2, color, { roughness: 0.4, metalness: 0.7 });
    const midY = WALL_HEIGHT + SLAB_THICK + ph / 2;
    if (ridgeAlongX) {
      panel.position.set(aabb.cx, midY, aabb.cz + side * slopeRun / 2);
      panel.rotation.x = side * Math.atan2(ph, slopeRun);
    } else {
      panel.position.set(aabb.cx + side * slopeRun / 2, midY, aabb.cz);
      panel.rotation.z = -side * Math.atan2(ph, slopeRun);
      panel.rotation.y = Math.PI / 2;
    }
    g.add(panel);
  }
  return g;
}

function buildOpenings(walls, doors, windows) {
  const g = new THREE.Group();
  const _wallAtIndex = (i) => (i >= 0 && i < walls.length) ? wallSegment(walls[i]) : null;
  for (let di = 0; di < (doors || []).length; di++) {
    const d = doors[di];
    if (!d.position) continue;
    const [x, z] = toWorld(d.position);
    const w = Math.max(0.7, (d.width || 3) * SCALE * 0.5);
    const h = 2.1;
    const mesh = makeBox(w, h, 0.06, "#FFCC00", { roughness: 0.45, metalness: 0.3 });
    mesh.position.set(x, h / 2 + SLAB_THICK, z);
    // If the door references a wall, rotate to align with that wall's angle
    // so the panel visually cuts through it.
    const ws = _wallAtIndex(d.wall_index);
    if (ws) mesh.rotation.y = -ws.angle;
    mesh.userData.pickable_opening = true;
    mesh.userData.opening_type = "door";
    mesh.userData.opening_index = di;
    mesh.userData.opening_id = d.id || null;
    mesh.userData.wall_index = (d.wall_index >= 0) ? d.wall_index : null;
    mesh.userData.width_ft = Number(d.width) || 3;
    g.add(mesh);
  }
  for (let wi = 0; wi < (windows || []).length; wi++) {
    const w = windows[wi];
    if (!w.position) continue;
    const [x, z] = toWorld(w.position);
    const ww = Math.max(0.6, (w.width || 4) * SCALE * 0.5);
    const wh = 1.0;
    const m = makeBox(ww, wh, 0.05, "#3a78d6", {
      roughness: 0.1, metalness: 0.5, opacity: 0.7,
      emissive: 0x1133aa, emissiveIntensity: 0.25,
    });
    m.position.set(x, 1.2 + SLAB_THICK, z);
    const ws = _wallAtIndex(w.wall_index);
    if (ws) m.rotation.y = -ws.angle;
    m.userData.pickable_opening = true;
    m.userData.opening_type = "window";
    m.userData.opening_index = wi;
    m.userData.opening_id = w.id || null;
    m.userData.wall_index = (w.wall_index >= 0) ? w.wall_index : null;
    m.userData.width_ft = Number(w.width) || 4;
    g.add(m);
  }
  return g;
}

// ---------- Fixtures (Session 5) ----------
// Renders each `fixture` as a low-poly kind-specific group at its
// [x, y]_ft position on the slab. Rotation comes from `rotation_deg`
// (0 = facing +z). Every top-level fixture group carries `userData`
// with fixture_id / fixture_index / sheet_id so the 3D editor's
// raycaster can identify picks and route to the right sheet.
function buildFixtures(fixtures) {
  const g = new THREE.Group();
  if (!Array.isArray(fixtures)) return g;
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    if (!f?.position || !Array.isArray(f.position) || f.position.length < 2) continue;
    const [x, z] = toWorld(f.position);
    const meshGroup = buildFixtureGroup(f);
    meshGroup.position.set(x, SLAB_THICK, z);
    meshGroup.rotation.y = THREE.MathUtils.degToRad(Number(f.rotation_deg) || 0);
    meshGroup.userData.pickable_fixture = true;
    meshGroup.userData.fixture_index = i;
    meshGroup.userData.fixture_id = f.id || null;
    meshGroup.userData.fixture_kind = String(f.kind || "other");
    meshGroup.userData.rotation_deg = Number(f.rotation_deg) || 0;
    meshGroup.userData.position_ft = f.position;
    meshGroup.userData.size_ft = Array.isArray(f.size) ? f.size : [2, 2];
    // Tag EVERY child mesh with pickable_fixture too so raycaster hits
    // any part of the model and we can walk up to the parent group.
    meshGroup.traverse((o) => {
      if (o.isMesh) {
        o.userData.pickable_fixture = true;
        o.userData._parent_group = meshGroup;
      }
    });
    g.add(meshGroup);
  }
  return g;
}

function buildTrim(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const corners = new Set();
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    [[s.sx, s.sz], [s.ex, s.ez]].forEach(([x, z]) => {
      const key = `${x.toFixed(2)}:${z.toFixed(2)}`;
      if (corners.has(key)) return;
      corners.add(key);
      const trim = makeBox(0.1, WALL_HEIGHT, 0.1, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
      trim.position.set(x, WALL_HEIGHT / 2 + SLAB_THICK, z);
      g.add(trim);
    });
  }
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const t = makeBox(s.length + 0.1, TRIM_THICKNESS, 0.18, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
    t.position.set(s.cx, WALL_HEIGHT + SLAB_THICK + 0.03, s.cz);
    t.rotation.y = -s.angle;
    g.add(t);
  }
  if (CFG.roof_type !== "flat" && CFG.roof_type !== "shed") {
    const ridgeAlongX = aabb.w >= aabb.d;
    const ph = pitchH(aabb);
    const ridge = makeBox(ridgeAlongX ? aabb.w + 0.4 : 0.25, 0.08, ridgeAlongX ? 0.25 : aabb.d + 0.4, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
    ridge.position.set(aabb.cx, WALL_HEIGHT + SLAB_THICK + ph + 0.05, aabb.cz);
    g.add(ridge);
  }
  return g;
}

function buildUnderground(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const yBelow = -FOOTING_DEPTH * 0.4;
  const runLen = Math.max(aabb.w, aabb.d) + 6;
  const mk = (color, len, roughness = 0.5) =>
    new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, len, 12),
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.3 })
    );
  const water = mk("#3a78d6", aabb.w + 6);
  water.rotation.z = Math.PI / 2;
  water.position.set(aabb.cx - 1, yBelow, aabb.cz - 0.6);
  g.add(water);
  const gas = mk("#FFCC00", aabb.w + 6, 0.6);
  gas.rotation.z = Math.PI / 2;
  gas.position.set(aabb.cx - 1, yBelow - 0.25, aabb.cz + 0.6);
  g.add(gas);
  const sewer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, runLen, 12),
    new THREE.MeshStandardMaterial({ color: "#5a5a5a", roughness: 0.85 })
  );
  sewer.rotation.z = Math.PI / 2;
  sewer.position.set(aabb.cx + 1, yBelow - 0.4, aabb.cz);
  g.add(sewer);
  const meter = makeBox(0.3, 0.5, 0.3, "#888", { roughness: 0.6, metalness: 0.6 });
  meter.position.set(aabb.minX - 2.5, 0.25, aabb.cz - 0.6);
  g.add(meter);
  return g;
}

function buildSeptic(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const tankW = 2.4, tankH = 1.4, tankD = 1.4;
  const tankX = aabb.maxX + 3.0;
  const tankZ = aabb.minZ - 1.2;
  const tank = makeBox(tankW, tankH, tankD, "#4d6b3a", { roughness: 0.9, metalness: 0 });
  tank.position.set(tankX, -tankH / 2 - 0.1, tankZ);
  g.add(tank);
  for (const dx of [-0.55, 0.55]) {
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16),
      new THREE.MeshStandardMaterial({ color: "#2f3d22", roughness: 0.9 })
    );
    lid.position.set(tankX + dx, 0.05, tankZ);
    g.add(lid);
  }
  const dbox = makeBox(0.6, 0.5, 0.6, "#5d7b4a", { roughness: 0.9 });
  dbox.position.set(tankX + 1.8, -0.4, tankZ);
  g.add(dbox);
  const outflow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.4, 10),
    new THREE.MeshStandardMaterial({ color: "#8a7a4a", roughness: 0.7 })
  );
  outflow.rotation.z = Math.PI / 2;
  outflow.position.set(tankX + 1.1, -0.5, tankZ);
  g.add(outflow);
  const fieldStartX = tankX + 2.3;
  const lateralLen = Math.max(4, aabb.d * 0.8);
  const lateralCount = 4;
  const spacing = 1.0;
  for (let i = 0; i < lateralCount; i++) {
    const zOff = tankZ + (i - (lateralCount - 1) / 2) * spacing;
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, lateralLen, 10),
      new THREE.MeshStandardMaterial({ color: "#a89a6a", roughness: 0.7 })
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(fieldStartX + lateralLen / 2, -0.55, zOff);
    g.add(pipe);
    const bed = makeBox(lateralLen + 0.3, 0.08, 0.55, "#7a7868", { roughness: 1, noShadow: true });
    bed.position.set(fieldStartX + lateralLen / 2, -0.72, zOff);
    g.add(bed);
  }
  return g;
}

function buildPlumbing(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const stackX = aabb.minX + 1.0, stackZ = aabb.minZ + 1.0;
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, WALL_HEIGHT + 0.8, 12),
    new THREE.MeshStandardMaterial({ color: "#cccccc", roughness: 0.6 })
  );
  stack.position.set(stackX, SLAB_THICK + (WALL_HEIGHT + 0.8) / 2, stackZ);
  g.add(stack);
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const nx = Math.sin(-s.angle) * -1, nz = Math.cos(-s.angle) * -1;
    const towardCenter = ((aabb.cx - s.cx) * nx + (aabb.cz - s.cz) * nz) > 0 ? 1 : -1;
    const inx = nx * towardCenter, inz = nz * towardCenter;
    const cold = makeBox(s.length * 0.95, 0.04, 0.04, "#3a78d6", { roughness: 0.4, metalness: 0.5, noShadow: true });
    cold.position.set(s.cx + inx * 0.12, SLAB_THICK + 0.45, s.cz + inz * 0.12);
    cold.rotation.y = -s.angle;
    g.add(cold);
    const hot = makeBox(s.length * 0.95, 0.04, 0.04, "#cc4422", { roughness: 0.4, metalness: 0.5, noShadow: true });
    hot.position.set(s.cx + inx * 0.18, SLAB_THICK + 0.55, s.cz + inz * 0.18);
    hot.rotation.y = -s.angle;
    g.add(hot);
    const drain = makeBox(s.length * 0.95, 0.07, 0.07, "#999", { roughness: 0.7, noShadow: true });
    drain.position.set(s.cx + inx * 0.14, SLAB_THICK + 0.18, s.cz + inz * 0.14);
    drain.rotation.y = -s.angle;
    g.add(drain);
  }
  return g;
}

function buildElectrical(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  const first = walls.length ? wallSegment(walls[0]) : null;
  if (first) {
    const nx = Math.sin(-first.angle) * -1, nz = Math.cos(-first.angle) * -1;
    const towardCenter = ((aabb.cx - first.cx) * nx + (aabb.cz - first.cz) * nz) > 0 ? 1 : -1;
    const inx = nx * towardCenter, inz = nz * towardCenter;
    const panel = makeBox(0.5, 0.7, 0.15, "#888888", { roughness: 0.5, metalness: 0.8 });
    panel.position.set(first.cx + inx * 0.25, SLAB_THICK + 1.4, first.cz + inz * 0.25);
    panel.rotation.y = -first.angle;
    g.add(panel);
    const face = makeBox(0.42, 0.62, 0.02, "#1f1f1f", { roughness: 0.3, metalness: 0.6 });
    face.position.set(first.cx + inx * 0.33, SLAB_THICK + 1.4, first.cz + inz * 0.33);
    face.rotation.y = -first.angle;
    g.add(face);
  }
  const condY = WALL_HEIGHT + SLAB_THICK - 0.25;
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const nx = Math.sin(-s.angle) * -1, nz = Math.cos(-s.angle) * -1;
    const towardCenter = ((aabb.cx - s.cx) * nx + (aabb.cz - s.cz) * nz) > 0 ? 1 : -1;
    const inx = nx * towardCenter, inz = nz * towardCenter;
    const cond = makeBox(s.length * 0.92, 0.04, 0.04, "#cc6622", { roughness: 0.4, metalness: 0.85, noShadow: true });
    cond.position.set(s.cx + inx * 0.28, condY, s.cz + inz * 0.28);
    cond.rotation.y = -s.angle;
    g.add(cond);
    const outletCount = Math.max(2, Math.floor(s.length / 2.5));
    for (let i = 0; i < outletCount; i++) {
      const t = (i + 0.5) / outletCount;
      const box = makeBox(0.12, 0.12, 0.08, "#FF6600", { roughness: 0.6, metalness: 0.3 });
      const x = s.sx + s.dx * t + inx * 0.09;
      const z = s.sz + s.dz * t + inz * 0.09;
      box.position.set(x, SLAB_THICK + 0.4, z);
      box.rotation.y = -s.angle;
      g.add(box);
    }
  }
  const jbox = makeBox(0.22, 0.1, 0.22, "#FF6600", { roughness: 0.6 });
  jbox.position.set(aabb.cx, condY + 0.1, aabb.cz);
  g.add(jbox);
  return g;
}

// ---------- Rooms (Session 4) ----------
// Each label (e.g. "MASTER BEDROOM") is treated as a room seed. We find
// the axis-aligned rectangle around each label by casting rays in ±x
// and ±z from the label center and finding the nearest wall crossing.
// Result: one floor tile per label with the user-selected material,
// plus (optionally) a semi-transparent ceiling plane if the room's
// ceiling_height_ft differs from the sheet-wide WALL_HEIGHT.
// Every room mesh is tagged with `userData.pickable_room = true` so
// the 3D wall-editor's raycaster can select rooms.
function _computeRoomRectFt(labelXy, walls, aabb) {
  // labelXy is in feet (blueprint local space). Walls: {start:[x,y], end:[x,y]}.
  // Returns { x0, y0, x1, y1 } bounding box in feet, clipped to the aabb.
  const [lx, ly] = labelXy;
  const PAD_FT = 0.25;   // shrink slightly so the tile doesn't Z-fight the wall
  // aabb is in scene units (meters, with the fixed 5-unit centering offset).
  // Convert aabb back to feet space for clipping.
  const bboxMinXFt = ((aabb.minX + 5) / SCALE);
  const bboxMaxXFt = ((aabb.maxX + 5) / SCALE);
  const bboxMinYFt = ((aabb.minZ + 5) / SCALE);
  const bboxMaxYFt = ((aabb.maxZ + 5) / SCALE);
  let x0 = bboxMinXFt, x1 = bboxMaxXFt, y0 = bboxMinYFt, y1 = bboxMaxYFt;
  const EPS = 0.05;
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    const [ax, ay] = w.start;
    const [bx, by] = w.end;
    const wminX = Math.min(ax, bx), wmaxX = Math.max(ax, bx);
    const wminY = Math.min(ay, by), wmaxY = Math.max(ay, by);
    // Horizontal ray (constant y = ly, sweeping ±x): wall must span ly
    if (wminY - EPS <= ly && ly <= wmaxY + EPS) {
      // Wall's x at y=ly. If wall is exactly horizontal (ay==by) skip.
      let wx;
      if (Math.abs(by - ay) < 1e-6) {
        // Fully horizontal wall — treat as blocker at min/max of its extent
        // only if ly is on the same y-line (already true from spanning test).
        wx = (wminX + wmaxX) / 2;  // won't tighten box meaningfully
        continue;
      } else {
        const t = (ly - ay) / (by - ay);
        wx = ax + t * (bx - ax);
      }
      if (wx > lx && wx < x1) x1 = wx;
      if (wx < lx && wx > x0) x0 = wx;
    }
    // Vertical ray (constant x = lx, sweeping ±y): wall must span lx
    if (wminX - EPS <= lx && lx <= wmaxX + EPS) {
      let wy;
      if (Math.abs(bx - ax) < 1e-6) {
        wy = (wminY + wmaxY) / 2;
        continue;
      } else {
        const t = (lx - ax) / (bx - ax);
        wy = ay + t * (by - ay);
      }
      if (wy > ly && wy < y1) y1 = wy;
      if (wy < ly && wy > y0) y0 = wy;
    }
  }
  // Reject degenerate rooms (<4 ft either direction)
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  return {
    x0: x0 + PAD_FT, y0: y0 + PAD_FT,
    x1: x1 - PAD_FT, y1: y1 - PAD_FT,
  };
}

function buildRooms(walls, aabb, labels) {
  const g = new THREE.Group();
  if (!aabb || !Array.isArray(labels) || labels.length === 0) return g;
  const wallTopY = WALL_HEIGHT + SLAB_THICK;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!label?.position || !Array.isArray(label.position) || label.position.length < 2) continue;
    const rect = _computeRoomRectFt(label.position, walls, aabb);
    if (!rect) continue;
    const wFt = rect.x1 - rect.x0;
    const dFt = rect.y1 - rect.y0;
    const wM = wFt * SCALE;
    const dM = dFt * SCALE;
    // Convert feet center back to scene meters (using the fixed 5-unit
    // centering offset that `toWorld` applies).
    const cx = ((rect.x0 + rect.x1) / 2) * SCALE - 5;
    const cz = ((rect.y0 + rect.y1) / 2) * SCALE - 5;
    const materialId = label.floor_material || DEFAULT_FLOOR_MATERIAL_ID;
    const mat = getFloorMaterial(materialId);
    const floor = makeBox(wM, 0.03, dM, mat.color, {
      roughness: mat.roughness,
      metalness: mat.metalness,
    });
    floor.position.set(cx, SLAB_THICK + 0.02, cz);
    floor.userData.pickable_room = true;
    floor.userData.label_index = i;
    floor.userData.room_center_ft = label.position;
    floor.userData.room_rect_ft = rect;
    floor.userData.floor_material = materialId;
    floor.userData.ceiling_height_ft = Number(label.ceiling_height_ft) || null;
    floor.userData.name = label.name_override || label.text || "Room";
    g.add(floor);

    // Optional ceiling plane if the room has an explicit ceiling height
    // AND that height is BELOW the current wall top (drop ceiling).
    const ceilFt = Number(label.ceiling_height_ft);
    if (ceilFt > 0) {
      const ceilY = ceilFt * SCALE + SLAB_THICK;
      // Only render if the ceiling is at least 0.15 m below the wall top
      // (avoids Z-fighting with the roof/wall top plate).
      if (ceilY < wallTopY - 0.15) {
        const ceilMat = new THREE.MeshStandardMaterial({
          color: 0xEEEBE1,
          roughness: 0.85,
          metalness: 0.02,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(wM * 0.98, dM * 0.98), ceilMat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(cx, ceilY, cz);
        ceil.receiveShadow = true;
        // Ceiling is NOT pickable_room — clicking the ceiling would be
        // confusing UX. Only the floor tile is the selectable target.
        g.add(ceil);
      }
    }
  }
  return g;
}


const BUILDERS = {
  excavation:  (aabb, walls) => buildExcavation(aabb),
  underground: (aabb)        => buildUnderground(aabb),
  septic:      (aabb)        => buildSeptic(aabb),
  foundation:  (aabb, walls) => buildFoundation(aabb, walls),
  columns:     (_, walls)    => buildColumns(walls),
  frame:       (aabb, walls) => buildFrame(walls, aabb),
  plumbing:    (aabb, walls) => buildPlumbing(walls, aabb),
  electrical:  (aabb, walls) => buildElectrical(walls, aabb),
  girts:       (_, walls)    => buildGirts(walls),
  purlins:     (aabb)        => buildPurlins(aabb),
  roofSheet:   (aabb)        => {
    const g = buildRoofSheeting(aabb);
    // Tag every mesh in the roof group as pickable so the 3D editor's
    // raycaster can identify roof clicks (used by roof-face editing).
    g.traverse((obj) => { if (obj.isMesh) obj.userData.pickable_roof = true; });
    return g;
  },
  wallSheet:   (_, walls)    => buildWallSheeting(walls),
  openings:    (_, walls, doors, windows) => buildOpenings(walls, doors, windows),
  trim:        (aabb, walls) => buildTrim(walls, aabb),
  rooms:       (aabb, walls, doors, windows, labels) => buildRooms(walls, aabb, labels),
  fixtures:    (_, walls, doors, windows, labels, fixtures) => buildFixtures(fixtures),
};

// ---------- Engine ----------
export function createSceneEngine(mount) {
  const w = mount.clientWidth || 800;
  const h = mount.clientHeight || 600;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);
  scene.fog = new THREE.Fog(0xf5f5f5, 35, 90);

  const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 300);
  camera.position.set(12, 10, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(8, 14, 6);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  Object.assign(dir.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xbfd2ff, 0.35);
  fill.position.set(-6, 8, -4);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -FOOTING_DEPTH * 1.2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(40, 40, 0x0055ff, 0xcccccc);
  grid.position.y = -FOOTING_DEPTH * 1.2 + 0.001;
  scene.add(grid);

  // ----- Site (satellite) ground plane: hidden until a site is supplied -----
  let siteMesh = null;
  let siteTexture = null;
  // The satellite image is in real-world meters; the building geometry is in
  // feet (1 unit = 1 ft). Convert so 1 scene unit = 1 ft everywhere.
  const M_TO_FT = 3.28083989501;

  function disposeSite() {
    if (siteMesh) {
      scene.remove(siteMesh);
      siteMesh.geometry.dispose();
      siteMesh.material.dispose();
      siteMesh = null;
    }
    if (siteTexture) {
      siteTexture.dispose();
      siteTexture = null;
    }
  }

  function setSite(site) {
    disposeSite();
    if (!site || !site.image_base64 || !site.world_meters) {
      ground.visible = true;
      grid.visible = true;
      camera.far = 300;
      camera.updateProjectionMatrix();
      scene.fog = new THREE.Fog(0xf5f5f5, 35, 90);
      controls.maxDistance = 60;
      return;
    }
    // Convert meters -> feet so the satellite plane matches building scale.
    const sideFt = site.world_meters * M_TO_FT;
    const loader = new THREE.TextureLoader();
    siteTexture = loader.load(`data:image/png;base64,${site.image_base64}`);
    siteTexture.colorSpace = THREE.SRGBColorSpace;
    siteTexture.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({
      map: siteTexture,
      roughness: 1.0,
      metalness: 0.0,
    });
    const geo = new THREE.PlaneGeometry(sideFt, sideFt);
    siteMesh = new THREE.Mesh(geo, mat);
    siteMesh.rotation.x = -Math.PI / 2;
    siteMesh.position.y = -FOOTING_DEPTH * 1.2 + 0.002;
    siteMesh.receiveShadow = true;
    siteMesh.name = "siteGroundPlane";
    scene.add(siteMesh);
    ground.visible = false;
    grid.visible = false;
    // Push fog and far plane out so the big plane is visible.
    scene.fog = new THREE.Fog(0xf5f5f5, sideFt * 0.5, sideFt * 2);
    camera.far = Math.max(300, sideFt * 4);
    camera.updateProjectionMatrix();
    controls.maxDistance = sideFt * 1.5;

    // Re-apply any existing 3D terrain (it depends on the satellite texture).
    if (site.terrain_3d) setSiteTerrain(site, site.terrain_3d);
    else clearSiteTerrain();
  }

  // ----- 3D Landscape (heightmap + AI feature objects) -----
  let terrain3dGroup = null;
  let terrainMesh = null;

  function _disposeTerrain3D() {
    if (terrain3dGroup) {
      scene.remove(terrain3dGroup);
      terrain3dGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
      terrain3dGroup = null;
      terrainMesh = null;
    }
  }

  function clearSiteTerrain() {
    _disposeTerrain3D();
    if (siteMesh) siteMesh.visible = true;
  }

  function setSiteTerrain(site, terrain3d, opts = {}) {
    _disposeTerrain3D();
    if (!site || !terrain3d || !Array.isArray(terrain3d.elevation_grid)
        || !siteTexture) {
      if (siteMesh) siteMesh.visible = true;
      return null;
    }
    const exaggeration = Number(opts.verticalExaggeration) > 0
      ? Number(opts.verticalExaggeration) : 3.0;
    const sideFt = site.world_meters * M_TO_FT;
    const elevGrid = terrain3d.elevation_grid;
    const n = elevGrid.length;
    if (n < 2) return null;

    // Baseline elevation (median) so the heightmap sits near ground level.
    const flat = [];
    for (const row of elevGrid) for (const v of row) flat.push(v);
    flat.sort((a, b) => a - b);
    const median = flat[Math.floor(flat.length / 2)];
    const minE = flat[0], maxE = flat[flat.length - 1];

    // Heightmap mesh — PlaneGeometry is XY (z up in plane local frame). After
    // rotation x = -PI/2 the plane lies on XZ with Y up. We displace local-Z
    // BEFORE rotation, which becomes world-Y after rotation.
    const geo = new THREE.PlaneGeometry(sideFt, sideFt, n - 1, n - 1);
    const pos = geo.attributes.position;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const elev_m = elevGrid[j][i] - median;
        const elev_ft = elev_m * M_TO_FT * exaggeration;
        const vIdx = j * n + i;
        pos.setZ(vIdx, elev_ft);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    const tmat = new THREE.MeshStandardMaterial({
      map: siteTexture,
      roughness: 1.0,
      metalness: 0.0,
    });
    terrainMesh = new THREE.Mesh(geo, tmat);
    terrainMesh.rotation.x = -Math.PI / 2;
    terrainMesh.position.y = (siteMesh ? siteMesh.position.y : -FOOTING_DEPTH * 1.2) + 0.001;
    terrainMesh.receiveShadow = true;
    terrainMesh.name = "siteTerrain";

    // Hide the flat plane behind the heightmap
    if (siteMesh) siteMesh.visible = false;

    terrain3dGroup = new THREE.Group();
    terrain3dGroup.name = "terrain3d";
    terrain3dGroup.userData.exaggeration = exaggeration;
    terrain3dGroup.add(terrainMesh);

    // Sample heightmap to position features at the terrain surface.
    const sampleY = (wx, wz) => {
      // Convert world (x, z) → grid (i, j)
      const u = (wx / sideFt) + 0.5;
      const v = (wz / sideFt) + 0.5;
      const i = Math.max(0, Math.min(n - 1, Math.round(u * (n - 1))));
      const j = Math.max(0, Math.min(n - 1, Math.round(v * (n - 1))));
      return ((elevGrid[j][i] - median) * M_TO_FT * exaggeration) + terrainMesh.position.y;
    };

    const STORY_FT = 10;
    const features = Array.isArray(terrain3d.features_3d) ? terrain3d.features_3d : [];
    for (const f of features) {
      if (f && f.hidden) continue;  // user has hidden this feature
      const wx = (f.x - 0.5) * sideFt;
      const wz = (f.y - 0.5) * sideFt;
      const rFt = Math.max(2, f.radius * sideFt);
      const yGround = sampleY(wx, wz);
      const obj = _buildFeatureObject(f, wx, wz, rFt, yGround, STORY_FT);
      if (obj) {
        obj.userData.kind = f.kind;
        obj.userData.label = f.label || "";
        terrain3dGroup.add(obj);
      }
    }

    scene.add(terrain3dGroup);
    return {
      elevation_min_m: minE,
      elevation_max_m: maxE,
      delta_m: maxE - minE,
      delta_ft: (maxE - minE) * M_TO_FT,
      exaggeration,
      feature_count: features.length,
    };
  }

  function setTerrainExaggeration(value, site, terrain3d) {
    return setSiteTerrain(site, terrain3d, { verticalExaggeration: value });
  }

  function tiltCameraOblique() {
    // Move camera to an oblique 35° angle so terrain elevation is visible.
    const target = controls.target.clone();
    const dist = camera.position.distanceTo(target);
    const r = Math.max(dist, 25);
    camera.position.set(target.x + r * 0.75, target.y + r * 0.55, target.z + r * 0.75);
    camera.lookAt(target);
    controls.update();
  }

  function _buildFeatureObject(f, wx, wz, rFt, yGround, STORY_FT) {
    switch ((f.kind || "").toLowerCase()) {
      case "tree":
      case "trees": {
        const trunkH = Math.max(3, rFt * 0.5);
        const foliageH = Math.max(5, rFt * 1.6);
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(Math.max(0.4, rFt * 0.12),
                                     Math.max(0.5, rFt * 0.15),
                                     trunkH, 8),
          new THREE.MeshStandardMaterial({ color: 0x5C3A1E, roughness: 0.9 }),
        );
        trunk.position.set(wx, yGround + trunkH / 2, wz);
        const foliage = new THREE.Mesh(
          new THREE.ConeGeometry(rFt, foliageH, 12),
          new THREE.MeshStandardMaterial({ color: 0x2D5C2D, roughness: 0.95 }),
        );
        foliage.position.set(wx, yGround + trunkH + foliageH / 2, wz);
        const g = new THREE.Group();
        g.add(trunk); g.add(foliage);
        return g;
      }
      case "building": {
        const stories = Math.max(1, Number(f.stories) || 1);
        const h = stories * STORY_FT;
        const w = Math.max(8, rFt * 1.8);
        const d = Math.max(8, rFt * 1.8);
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: 0xCCC8BD, roughness: 0.8 }),
        );
        box.position.set(wx, yGround + h / 2, wz);
        box.castShadow = true;
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(w * 1.05, 0.5, d * 1.05),
          new THREE.MeshStandardMaterial({ color: 0x4A5C6E, roughness: 0.9 }),
        );
        roof.position.set(wx, yGround + h + 0.25, wz);
        const g = new THREE.Group();
        g.add(box); g.add(roof);
        return g;
      }
      case "water": {
        const mat = new THREE.MeshStandardMaterial({
          color: 0x3A6FA0,
          transparent: true,
          opacity: 0.72,
          roughness: 0.2,
          metalness: 0.15,
        });
        const plane = new THREE.Mesh(new THREE.CircleGeometry(rFt, 24), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(wx, yGround - 0.5, wz);
        return plane;
      }
      case "road":
      case "driveway": {
        const mat = new THREE.MeshStandardMaterial({
          color: f.kind === "road" ? 0x2A2A2A : 0x6B6358,
          roughness: 0.85,
        });
        const plane = new THREE.Mesh(new THREE.CircleGeometry(rFt * 1.4, 24), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(wx, yGround + 0.05, wz);
        return plane;
      }
      case "vegetation": {
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(rFt, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshStandardMaterial({ color: 0x4D7C4D, roughness: 0.95 }),
        );
        dome.position.set(wx, yGround, wz);
        return dome;
      }
      case "rock": {
        const rock = new THREE.Mesh(
          new THREE.DodecahedronGeometry(Math.max(1, rFt * 0.7), 0),
          new THREE.MeshStandardMaterial({ color: 0x8A8A86, roughness: 0.9 }),
        );
        rock.position.set(wx, yGround + rFt * 0.35, wz);
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        return rock;
      }
      case "slope": {
        // Slope already represented in the heightmap; render a faint marker
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(rFt * 0.6, rFt * 0.7, 24),
          new THREE.MeshBasicMaterial({ color: 0xFFCC00, transparent: true, opacity: 0.4 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, yGround + 0.1, wz);
        return ring;
      }
      default:
        return null;
    }
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.target.set(0, 1.5, 0);

  // ---------- Model root (so the building can be moved / rotated as one) ----------
  const modelRoot = new THREE.Group();
  modelRoot.name = "modelRoot";
  scene.add(modelRoot);

  let groups = {};
  let animHandle = null;
  // Only auto-fit the camera the FIRST time the scene builds. Subsequent
  // rebuilds (e.g. from polling refresh) must NOT reset the camera —
  // otherwise the user's orbit gets snapped mid-drag. Users can re-fit
  // manually via the public fitCamera() method.
  let hasFitCamera = false;

  const animate = () => {
    animHandle = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  const onResize = () => {
    const w2 = mount.clientWidth, h2 = mount.clientHeight;
    if (w2 && h2) {
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    }
  };
  window.addEventListener("resize", onResize);
  // Wrap in rAF to prevent "ResizeObserver loop completed with undelivered
  // notifications" warning when the callback itself triggers layout changes.
  const ro = new ResizeObserver(() => {
    window.requestAnimationFrame(onResize);
  });
  ro.observe(mount);

  function disposeObject(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  function build(blueprint) {
    // ---------- Building assembly from all sheets ----------
    // Aggregate assembly_data from every elevation + roof_plan sheet in the
    // project so we can override defaults with data extracted by GPT-4o.
    const sheetsRaw = Array.isArray(blueprint.sheets) ? blueprint.sheets : [];
    const elevations = sheetsRaw.filter((s) => s.view_type === "elevation" && s.assembly_data);
    const roofPlans  = sheetsRaw.filter((s) => s.view_type === "roof_plan" && s.assembly_data);
    const manualOverride = !!blueprint.manual_override;

    // Wall height (feet → meters). Precedence:
    //   1. Manual override on blueprint.wall_height_ft (when manual_override=true)
    //   2. Median wall_top_ft across all elevation sheets
    //   3. Manual blueprint.wall_height_ft (when set, no elevations available)
    //   4. DEFAULT_WALL_HEIGHT (10 ft in meters)
    let wallTopFt = 0;
    if (elevations.length && !manualOverride) {
      const heights = elevations
        .map((s) => Number(s.assembly_data?.wall_top_ft || 0))
        .filter((v) => v > 3 && v < 100);
      if (heights.length) {
        heights.sort((a, b) => a - b);
        wallTopFt = heights[Math.floor(heights.length / 2)];
      }
    }
    if (!wallTopFt && blueprint.wall_height_ft) {
      wallTopFt = Number(blueprint.wall_height_ft) || 0;
    }
    WALL_HEIGHT = wallTopFt > 0 ? wallTopFt * SCALE : DEFAULT_WALL_HEIGHT;

    // Roof: precedence = manual_override > roof_plan > elevation median > blueprint defaults
    let roofType  = blueprint.roof_type || DEFAULT_CFG.roof_type;
    let roofPitch = blueprint.roof_pitch_deg ?? DEFAULT_CFG.roof_pitch_deg;
    if (!manualOverride) {
      if (roofPlans.length) {
        const rp = roofPlans[0].assembly_data;
        if (rp.roof_shape && rp.roof_shape !== "unknown") roofType = rp.roof_shape;
        const p = Number(rp.primary_slope_deg || 0);
        if (p > 0 && p < 60) roofPitch = p;
      } else if (elevations.length) {
        const pitches = elevations
          .map((s) => Number(s.assembly_data?.roof_pitch_deg || 0))
          .filter((v) => v > 0 && v < 60);
        if (pitches.length) {
          pitches.sort((a, b) => a - b);
          roofPitch = pitches[Math.floor(pitches.length / 2)];
        }
        const shapes = elevations
          .map((s) => s.assembly_data?.roof_shape)
          .filter((s) => s && s !== "unknown");
        if (shapes.length) roofType = shapes[0];
      }
    }

    CFG = {
      roof_type: roofType,
      roof_pitch_deg: roofPitch,
      wall_color: blueprint.wall_color || DEFAULT_CFG.wall_color,
      roof_color: blueprint.roof_color || DEFAULT_CFG.roof_color,
    };
    // Dispose previous
    for (const id of Object.keys(groups)) {
      modelRoot.remove(groups[id]);
      disposeObject(groups[id]);
    }
    groups = {};

    // Multi-sheet support: each sheet gets its own stack of layer groups
    // offset by `floor_level * (WALL_HEIGHT + SLAB_THICK + ~0.1 ft)`.  When
    // no sheets are present we fall back to legacy single-blueprint mode.
    // Reference-only sheets (framing plans, roof plans, elevations, MEP
    // overlays, details) are EXCLUDED from the 3D stack — they carry no
    // wall geometry and only serve as CAD-tab underlay references.
    const REF_ONLY = new Set([
      "framing_plan", "roof_plan", "sheathing_plan", "elevation",
      "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
    ]);
    const allSheets = Array.isArray(blueprint.sheets) && blueprint.sheets.length > 0
      ? blueprint.sheets
      : [{
          id: "__legacy__",
          walls: blueprint.walls || [],
          doors: blueprint.doors || [],
          windows: blueprint.windows || [],
          floor_level: 0,
          view_type: "floor_plan",
        }];
    const sheets = allSheets.filter((s) => !REF_ONLY.has(s.view_type || "floor_plan"));

    // Pre-create per-layer container groups so setVisibility toggles ALL sheets.
    for (const layer of ALL_LAYERS) {
      const g = new THREE.Group();
      g.name = layer.id;
      modelRoot.add(g);
      groups[layer.id] = g;
    }

    const FLOOR_STEP = WALL_HEIGHT + SLAB_THICK + 0.02; // meters between floors
    let globalAabb = null;
    for (const sheet of sheets) {
      const walls = sheet.walls || [];
      const doors = sheet.doors || [];
      const windows = sheet.windows || [];
      const labels = sheet.labels || [];
      const fixtures = sheet.fixtures || [];
      const yOffset = (sheet.floor_level || 0) * FLOOR_STEP;
      const aabb = footprintAabb(walls);
      if (aabb) {
        if (!globalAabb) globalAabb = { ...aabb };
        else {
          globalAabb.minX = Math.min(globalAabb.minX ?? aabb.minX, aabb.minX);
          globalAabb.maxX = Math.max(globalAabb.maxX ?? aabb.maxX, aabb.maxX);
          globalAabb.minZ = Math.min(globalAabb.minZ ?? aabb.minZ, aabb.minZ);
          globalAabb.maxZ = Math.max(globalAabb.maxZ ?? aabb.maxZ, aabb.maxZ);
          globalAabb.cx = (globalAabb.minX + globalAabb.maxX) / 2;
          globalAabb.cz = (globalAabb.minZ + globalAabb.maxZ) / 2;
          globalAabb.w  = globalAabb.maxX - globalAabb.minX;
          globalAabb.d  = globalAabb.maxZ - globalAabb.minZ;
        }
      }
      for (const layer of ALL_LAYERS) {
        const sheetLayer = BUILDERS[layer.id](aabb, walls, doors, windows, labels, fixtures);
        // Ground-only layers (excavation, foundation, underground, septic) skip
        // upper floors so we don't get stacked dirt / duplicate slabs.
        const groundOnly = ["excavation", "underground", "septic"].includes(layer.id);
        if (groundOnly && (sheet.floor_level || 0) !== 0) continue;
        // Rooms + fixtures + openings carry a sheet_id in their userData so
        // the picker knows which sheet's arrays to patch on edit.
        if (layer.id === "rooms" || layer.id === "fixtures" || layer.id === "openings") {
          sheetLayer.traverse((obj) => {
            if (obj.userData?.pickable_room || obj.userData?.pickable_fixture || obj.userData?.pickable_opening) {
              obj.userData.sheet_id = sheet.id;
            }
          });
        }
        sheetLayer.position.y += yOffset;
        groups[layer.id].add(sheetLayer);
      }
    }

    // Auto-fit camera — ONLY on the very first build. Subsequent
    // rebuilds (polling refresh, AI extract, layer toggle) must NEVER
    // snap the camera — that was resetting the user's orbit mid-drag.
    // Users can re-fit explicitly via the public fitCamera() method
    // (wired to the ⌂ FIT button in the UI).
    if (globalAabb && globalAabb.w > 0) {
      lastAabb = globalAabb;
      if (!hasFitCamera) {
        fitCameraToAabb(globalAabb);
        hasFitCamera = true;
      }
    }
    _rebuildPickTargets(sheets);
  }

  // Cache of the most-recent bounding box so fitCamera() can be called
  // from the outside (e.g., the ⌂ FIT button) without needing a rebuild.
  let lastAabb = null;

  function fitCameraToAabb(aabb) {
    if (!aabb || !(aabb.w > 0)) return;
    const size = Math.max(aabb.w, aabb.d, 4);
    const dist = size * 1.6 + 6;
    const cx = aabb.cx + modelRoot.position.x;
    const cz = aabb.cz + modelRoot.position.z;
    camera.position.set(cx + dist * 0.65, dist * 0.7, cz + dist * 0.85);
    controls.target.set(cx, WALL_HEIGHT * 0.5, cz);
    controls.update();
  }

  function fitCamera() { fitCameraToAabb(lastAabb); }

  // ---------- Wall Editor ----------
  // Invisible pick-target meshes live on `modelRoot` so they follow the
  // model's placement/rotation. Each mesh carries the wall id + its
  // in-feet start/end coordinates on `userData` so the editor hook can
  // reason about the wall without another lookup. This group is never
  // affected by setVisibility (it's a sibling of the layer groups) so
  // picking works even when all layers are hidden.
  const pickTargetsRoot = new THREE.Group();
  pickTargetsRoot.name = "wall_pick_targets";
  modelRoot.add(pickTargetsRoot);
  let wallPickables = [];
  let currentWallsSnapshot = [];  // full wall list from last build
  let selectionHighlight = null;
  let selectedWallId = null;

  function _clearPickTargets() {
    for (const m of pickTargetsRoot.children.slice()) {
      pickTargetsRoot.remove(m);
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    }
    wallPickables = [];
  }

  function _rebuildPickTargets(sheets) {
    _clearPickTargets();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.001, depthWrite: false,
    });
    currentWallsSnapshot = [];
    for (const sheet of sheets) {
      const walls = sheet.walls || [];
      // Only offer picking on floor-level sheets so 3D editing doesn't
      // conflict with elevation/reference views that live at floor_level < 0.
      if ((sheet.floor_level || 0) < 0) continue;
      const yOffset = (sheet.floor_level || 0) * (WALL_HEIGHT + SLAB_THICK + 0.02);
      for (const w of walls) {
        const s = wallSegment(w);
        if (!s) continue;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(s.length + 0.15, WALL_HEIGHT, 0.35),
          mat,
        );
        mesh.position.set(s.cx, WALL_HEIGHT / 2 + SLAB_THICK + yOffset, s.cz);
        mesh.rotation.y = -s.angle;
        mesh.userData = {
          wall_id: w.id,
          sheet_id: sheet.id,
          start: w.start,
          end: w.end,
          length_ft: s.length / SCALE,
          thickness: w.thickness || 0.5,
        };
        pickTargetsRoot.add(mesh);
        wallPickables.push(mesh);
        currentWallsSnapshot.push({ ...w, sheet_id: sheet.id, floor_level: sheet.floor_level || 0 });
      }
    }
    // Re-apply the selection highlight if the wall still exists in the
    // new snapshot — otherwise clear it. This keeps the editor UX stable
    // across auto-rebuilds triggered by the sheet PATCH.
    if (selectedWallId && wallPickables.some((m) => m.userData.wall_id === selectedWallId)) {
      setSelectedWall(selectedWallId);
    } else {
      setSelectedWall(null);
    }
    // Also refresh the roof-pickable list by walking the current scene.
    // Roof meshes live inside their layer groups (built per-sheet), so
    // rebuild picks them up implicitly. Same for room / fixture / opening.
    roofPickables.length = 0;
    roomPickables.length = 0;
    fixturePickables.length = 0;
    openingPickables.length = 0;
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      if (obj.userData?.pickable_roof) roofPickables.push(obj);
      if (obj.userData?.pickable_room) roomPickables.push(obj);
      if (obj.userData?.pickable_fixture) fixturePickables.push(obj);
      if (obj.userData?.pickable_opening) openingPickables.push(obj);
    });
  }

  const roofPickables = [];
  const roomPickables = [];
  const fixturePickables = [];
  const openingPickables = [];

  function _makeHighlightForWall(userData) {
    if (!userData) return null;
    const s = wallSegment({ start: userData.start, end: userData.end });
    if (!s) return null;
    const yOffset = 0; // highlight assumes floor 0; if we later support multi-floor edit, thread the sheet's yOffset
    const geo = new THREE.BoxGeometry(s.length + 0.2, WALL_HEIGHT + 0.1, 0.55);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcc00, transparent: true, opacity: 0.28,
      depthWrite: false, depthTest: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(s.cx, WALL_HEIGHT / 2 + SLAB_THICK + yOffset, s.cz);
    mesh.rotation.y = -s.angle;
    return mesh;
  }

  function setSelectedWall(wall_id) {
    if (selectionHighlight) {
      pickTargetsRoot.remove(selectionHighlight);
      selectionHighlight.geometry?.dispose?.();
      selectionHighlight.material?.dispose?.();
      selectionHighlight = null;
    }
    selectedWallId = wall_id || null;
    if (!wall_id) return;
    const target = wallPickables.find((m) => m.userData.wall_id === wall_id);
    if (!target) return;
    selectionHighlight = _makeHighlightForWall(target.userData);
    if (selectionHighlight) pickTargetsRoot.add(selectionHighlight);
  }

  // Selected-room highlight — a translucent orange plane over the room's
  // floor tile. Cleared when null is passed.
  let roomHighlight = null;
  function setSelectedRoom(label_index, sheet_id) {
    if (roomHighlight) {
      pickTargetsRoot.remove(roomHighlight);
      roomHighlight.geometry?.dispose?.();
      roomHighlight.material?.dispose?.();
      roomHighlight = null;
    }
    if (label_index === null || label_index === undefined) return;
    const room = roomPickables.find(
      (m) => m.userData.label_index === label_index && m.userData.sheet_id === sheet_id,
    );
    if (!room) return;
    // Room mesh is a BoxGeometry(wM, 0.03, dM). Extract w/d from its geometry.
    const params = room.geometry.parameters || {};
    const w = params.width  || 1;
    const d = params.depth  || 1;
    const geo = new THREE.PlaneGeometry(w * 0.96, d * 0.96);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xFFCC00, transparent: true, opacity: 0.30,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const hl = new THREE.Mesh(geo, mat);
    hl.rotation.x = -Math.PI / 2;
    // Position slightly above the floor tile so it doesn't Z-fight
    hl.position.set(room.position.x, room.position.y + 0.03, room.position.z);
    hl.renderOrder = 998;
    pickTargetsRoot.add(hl);
    roomHighlight = hl;
  }

  let wallEditorEnabled = false;
  let wallEditorCallback = null;
  let addOpeningMode = null;   // null | "door" | "window" — click a wall to place
  const _raycaster = new THREE.Raycaster();
  const _clickVec = new THREE.Vector2();

  function _onEditorClick(event) {
    if (!wallEditorEnabled) return;
    // Only respond to left click; ignore drags used by OrbitControls.
    if (event.button !== 0) return;
    // If we're mid-fixture-drag or mid-opening-drag, this click is the
    // release — swallow it so we don't reselect / deselect.
    if (activeFixtureDrag || activeOpeningDrag) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _clickVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _clickVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_clickVec, camera);
    // In add-opening mode, only walls are targets (place new door/window
    // at the click point on the wall).
    if (addOpeningMode) {
      const hits = _raycaster.intersectObjects(wallPickables, false);
      if (!hits.length) return;
      const ud = hits[0].object.userData;
      const s = wallSegment({ start: ud.start, end: ud.end });
      if (!s) return;
      const local = modelRoot.worldToLocal(hits[0].point.clone());
      const wx = local.x - s.sx;
      const wz = local.z - s.sz;
      const t = Math.max(0.05, Math.min(0.95, (wx * s.dx + wz * s.dz) / (s.length * s.length)));
      const point_ft = [
        ud.start[0] + t * (ud.end[0] - ud.start[0]),
        ud.start[1] + t * (ud.end[1] - ud.start[1]),
      ];
      wallEditorCallback?.("add-opening", {
        opening_type: addOpeningMode,
        wall_index: wallPickables.indexOf(hits[0].object),
        wall_id: ud.wall_id,
        sheet_id: ud.sheet_id,
        position_ft: point_ft,
      });
      return;
    }
    const hits = _raycaster.intersectObjects(
      [...wallPickables, ...roofPickables, ...roomPickables, ...fixturePickables, ...openingPickables],
      false,
    );
    if (!hits.length) {
      wallEditorCallback?.("deselect", null);
      return;
    }
    const hit = hits[0];
    const userData = hit.object.userData;
    if (userData.pickable_opening) {
      wallEditorCallback?.("opening-pick", {
        opening_type: userData.opening_type,
        opening_index: userData.opening_index,
        opening_id: userData.opening_id,
        wall_index: userData.wall_index,
        sheet_id: userData.sheet_id,
        width_ft: userData.width_ft,
      });
      return;
    }
    if (userData.pickable_fixture) {
      // Traverse up to the fixture Group (mesh children carry the flag too)
      const grp = userData._parent_group || hit.object;
      const gd = grp.userData;
      wallEditorCallback?.("fixture-pick", {
        fixture_index: gd.fixture_index,
        fixture_id: gd.fixture_id,
        kind: gd.fixture_kind,
        sheet_id: gd.sheet_id,
        position_ft: gd.position_ft,
        rotation_deg: gd.rotation_deg,
        size_ft: gd.size_ft,
      });
      return;
    }
    if (userData.pickable_roof) {
      wallEditorCallback?.("roof-pick", { via: "3d" });
      return;
    }
    if (userData.pickable_room) {
      wallEditorCallback?.("room-pick", {
        label_index: userData.label_index,
        sheet_id: userData.sheet_id,
        name: userData.name,
        floor_material: userData.floor_material,
        ceiling_height_ft: userData.ceiling_height_ft,
        room_center_ft: userData.room_center_ft,
        room_rect_ft: userData.room_rect_ft,
      });
      return;
    }
    // Compute the click point on the wall in feet so the CUT tool can
    // know exactly WHERE to split. Project the hit point onto the
    // wall's start→end line and return t in [0,1] plus the feet pos.
    const s = wallSegment({ start: userData.start, end: userData.end });
    let t = 0.5, cut_ft = null;
    if (s) {
      // Convert hit.point (world) → modelRoot-local space.
      const local = modelRoot.worldToLocal(hit.point.clone());
      const wx = local.x - s.sx;
      const wz = local.z - s.sz;
      const proj = (wx * s.dx + wz * s.dz) / (s.length * s.length);
      t = Math.max(0.02, Math.min(0.98, proj));
      cut_ft = [
        userData.start[0] + t * (userData.end[0] - userData.start[0]),
        userData.start[1] + t * (userData.end[1] - userData.start[1]),
      ];
    }
    wallEditorCallback?.("pick", {
      wall_id: userData.wall_id,
      sheet_id: userData.sheet_id,
      start: userData.start,
      end: userData.end,
      length_ft: userData.length_ft,
      thickness: userData.thickness,
      hit_t: t,
      hit_ft: cut_ft,
    });
  }

  function enableWallEditor(on, callback) {
    wallEditorEnabled = !!on;
    wallEditorCallback = callback || null;
    if (wallEditorEnabled) {
      renderer.domElement.style.cursor = "pointer";
      renderer.domElement.addEventListener("click", _onEditorClick);
    } else {
      renderer.domElement.style.cursor = "";
      renderer.domElement.removeEventListener("click", _onEditorClick);
      setSelectedWall(null);
      setSelectedRoom(null);
      setSelectedFixture(null);
      setSelectedOpening(null, null, null);
      enableEndpointDrag(false);
      enableFixtureDrag(false);
      enableOpeningDrag(false);
      addOpeningMode = null;
    }
  }

  // ---------- Endpoint drag (Session 2) ----------
  // Two draggable sphere handles at the selected wall's start/end. On
  // mousedown the OrbitControls are disabled so the drag doesn't fight
  // the camera. Ground-plane raycast during mousemove translates screen
  // motion into modelRoot-local (feet) coordinates, snapped to 0.5 ft.
  // On mouseup the callback fires with the final start/end so the hook
  // can persist. All handles live in `endpointGroup` — never rendered
  // when drag is off.
  const endpointGroup = new THREE.Group();
  endpointGroup.name = "wall_endpoint_handles";
  modelRoot.add(endpointGroup);
  let endpointDragEnabled = false;
  let endpointDragCallback = null;
  let endpointHandles = [];   // [{mesh, side: 'start'|'end', wall_id, other_ft}]
  let activeHandle = null;
  let dragMoved = false;
  const _dragGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SLAB_THICK);
  const _dragHitPt = new THREE.Vector3();
  const _dragRay = new THREE.Raycaster();
  const _dragNdc = new THREE.Vector2();

  function _clearEndpointHandles() {
    for (const h of endpointHandles) {
      endpointGroup.remove(h.mesh);
      h.mesh.geometry?.dispose?.();
      h.mesh.material?.dispose?.();
    }
    endpointHandles = [];
  }

  function _snap05Ft(v_ft) { return Math.round(v_ft * 2) / 2; }

  function _showEndpointHandles(wallUserData) {
    _clearEndpointHandles();
    if (!wallUserData) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0x00E5FF, depthTest: false });
    const geo = new THREE.SphereGeometry(0.28, 16, 12);
    for (const side of ["start", "end"]) {
      const ptFt = wallUserData[side];
      const [wx, wz] = toWorld(ptFt);
      const mesh = new THREE.Mesh(geo.clone(), mat.clone());
      mesh.position.set(wx, SLAB_THICK + 0.2, wz);
      mesh.renderOrder = 999;
      mesh.userData = {
        handle: true,
        side,
        wall_id: wallUserData.wall_id,
        other_ft: wallUserData[side === "start" ? "end" : "start"],
      };
      endpointGroup.add(mesh);
      endpointHandles.push({ mesh, side, wall_id: wallUserData.wall_id });
    }
  }

  function _screenToGroundFt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    if (!_dragRay.ray.intersectPlane(_dragGroundPlane, _dragHitPt)) return null;
    const local = modelRoot.worldToLocal(_dragHitPt.clone());
    // toWorld applies a fixed 5-unit centering offset, so we invert both
    // when converting the ground-plane hit back to blueprint feet.
    return [ _snap05Ft((local.x + 5) / SCALE), _snap05Ft((local.z + 5) / SCALE) ];
  }

  function _onDragDown(e) {
    if (!endpointDragEnabled) return;
    if (e.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    const hits = _dragRay.intersectObjects(endpointHandles.map((h) => h.mesh), false);
    if (!hits.length) return;
    activeHandle = hits[0].object;
    dragMoved = false;
    // Suspend OrbitControls so drag doesn't orbit the camera.
    controls.enabled = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function _onDragMove(e) {
    if (!activeHandle) return;
    const nextFt = _screenToGroundFt(e.clientX, e.clientY);
    if (!nextFt) return;
    dragMoved = true;
    const [wx, wz] = toWorld(nextFt);
    activeHandle.position.x = wx;
    activeHandle.position.z = wz;
    endpointDragCallback?.("dragging", {
      wall_id: activeHandle.userData.wall_id,
      side: activeHandle.userData.side,
      point_ft: nextFt,
      other_ft: activeHandle.userData.other_ft,
    });
  }

  function _onDragUp(e) {
    if (!activeHandle) return;
    const wallId = activeHandle.userData.wall_id;
    const side = activeHandle.userData.side;
    const other = activeHandle.userData.other_ft;
    const nextFt = _screenToGroundFt(e.clientX, e.clientY);
    activeHandle = null;
    controls.enabled = true;
    if (dragMoved && nextFt) {
      endpointDragCallback?.("commit", { wall_id: wallId, side, point_ft: nextFt, other_ft: other });
    }
    dragMoved = false;
  }

  function enableEndpointDrag(on, wallUserData, cb) {
    if (on && wallUserData) {
      endpointDragEnabled = true;
      endpointDragCallback = cb || null;
      _showEndpointHandles(wallUserData);
      renderer.domElement.addEventListener("pointerdown", _onDragDown);
      window.addEventListener("pointermove", _onDragMove);
      window.addEventListener("pointerup", _onDragUp);
    } else {
      endpointDragEnabled = false;
      endpointDragCallback = null;
      _clearEndpointHandles();
      renderer.domElement.removeEventListener("pointerdown", _onDragDown);
      window.removeEventListener("pointermove", _onDragMove);
      window.removeEventListener("pointerup", _onDragUp);
      controls.enabled = true;
    }
  }

  // ---------- Fixture drag (Session 5) ----------
  // Grab the selected fixture group and drag it across the ground plane.
  // Uses the same _dragGroundPlane / _dragRay + toWorld conversion as the
  // endpoint handles. Commit fires on mouseup with the final position_ft.
  let selectedFixtureIdx = null;
  let selectedFixtureSheetId = null;
  let fixtureHighlight = null;
  let fixtureDragEnabled = false;
  let fixtureDragCallback = null;
  let activeFixtureDrag = null;   // {group, startFt}

  function _resolveFixtureGroup(fixture_index, sheet_id) {
    const layerGroup = groups["fixtures"];
    if (!layerGroup) return null;
    // Layer contains one child Group per sheet; that group contains the
    // per-fixture sub-groups. Walk 2 levels down.
    let found = null;
    layerGroup.traverse((obj) => {
      if (found) return;
      if (obj.userData?.pickable_fixture &&
          obj.userData?.fixture_index === fixture_index &&
          obj.userData?.sheet_id === sheet_id &&
          obj.type === "Group") {
        found = obj;
      }
    });
    return found;
  }

  function _clearFixtureHighlight() {
    if (fixtureHighlight) {
      pickTargetsRoot.remove(fixtureHighlight);
      fixtureHighlight.geometry?.dispose?.();
      fixtureHighlight.material?.dispose?.();
      fixtureHighlight = null;
    }
  }

  function setSelectedFixture(fixture_index, sheet_id) {
    _clearFixtureHighlight();
    selectedFixtureIdx = (fixture_index === null || fixture_index === undefined) ? null : fixture_index;
    selectedFixtureSheetId = sheet_id || null;
    if (selectedFixtureIdx === null) return;
    const grp = _resolveFixtureGroup(selectedFixtureIdx, selectedFixtureSheetId);
    if (!grp) return;
    // Wireframe box around the fixture using its bounding box.
    const bbox = new THREE.Box3().setFromObject(grp);
    if (!Number.isFinite(bbox.min.x)) return;
    const sz = new THREE.Vector3();
    bbox.getSize(sz);
    const geo = new THREE.BoxGeometry(sz.x * 1.05, sz.y * 1.05, sz.z * 1.05);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xFFCC00, wireframe: true, transparent: true, opacity: 0.85, depthTest: false,
    });
    const hl = new THREE.Mesh(geo, mat);
    const ctr = new THREE.Vector3();
    bbox.getCenter(ctr);
    // Convert world center back to modelRoot-local so the highlight
    // follows model transform (placement rotation/scale).
    modelRoot.worldToLocal(ctr);
    hl.position.copy(ctr);
    hl.renderOrder = 998;
    pickTargetsRoot.add(hl);
    fixtureHighlight = hl;
  }

  function _snap025Ft(v) { return Math.round(v * 4) / 4; }

  function _onFixtureDragDown(e) {
    if (!fixtureDragEnabled || selectedFixtureIdx === null) return;
    if (e.button !== 0) return;
    // Only start drag if the pointer is over the SELECTED fixture (or its
    // highlight). Any other pointer-down should stay with orbit controls.
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    const grp = _resolveFixtureGroup(selectedFixtureIdx, selectedFixtureSheetId);
    if (!grp) return;
    // Test against ALL descendant meshes of the selected group.
    const meshes = [];
    grp.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const hits = _dragRay.intersectObjects(meshes, false);
    if (!hits.length) return;
    activeFixtureDrag = { group: grp };
    controls.enabled = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function _onFixtureDragMove(e) {
    if (!activeFixtureDrag) return;
    if (!_dragRay.ray.intersectPlane) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    if (!_dragRay.ray.intersectPlane(_dragGroundPlane, _dragHitPt)) return;
    const local = modelRoot.worldToLocal(_dragHitPt.clone());
    const ft = [_snap025Ft((local.x + 5) / SCALE), _snap025Ft((local.z + 5) / SCALE)];
    const [x, z] = toWorld(ft);
    activeFixtureDrag.group.position.x = x;
    activeFixtureDrag.group.position.z = z;
    activeFixtureDrag.lastFt = ft;
    // Move highlight to follow the fixture.
    if (fixtureHighlight) {
      fixtureHighlight.position.x = x;
      fixtureHighlight.position.z = z;
    }
    fixtureDragCallback?.("dragging", { position_ft: ft });
  }

  function _onFixtureDragUp() {
    if (!activeFixtureDrag) return;
    const finalFt = activeFixtureDrag.lastFt || null;
    activeFixtureDrag = null;
    controls.enabled = true;
    if (finalFt) fixtureDragCallback?.("commit", { position_ft: finalFt });
  }

  function enableFixtureDrag(on, cb) {
    fixtureDragEnabled = !!on;
    fixtureDragCallback = cb || null;
    if (on) {
      renderer.domElement.addEventListener("pointerdown", _onFixtureDragDown);
      window.addEventListener("pointermove", _onFixtureDragMove);
      window.addEventListener("pointerup", _onFixtureDragUp);
    } else {
      renderer.domElement.removeEventListener("pointerdown", _onFixtureDragDown);
      window.removeEventListener("pointermove", _onFixtureDragMove);
      window.removeEventListener("pointerup", _onFixtureDragUp);
      activeFixtureDrag = null;
      controls.enabled = true;
    }
  }

  function setFixtureRotation(fixture_index, sheet_id, deg) {
    const grp = _resolveFixtureGroup(fixture_index, sheet_id);
    if (!grp) return;
    grp.rotation.y = THREE.MathUtils.degToRad(Number(deg) || 0);
  }

  // ---------- Opening drag along wall (Session 6) ----------
  // Drag a door/window along its host wall. The drag is CONSTRAINED to
  // the wall's line segment (start→end). We compute t in [0.05, 0.95]
  // from the mouse hit projected onto the wall line, then set both the
  // opening's world position AND its rotation to match the wall.
  let selectedOpening = null;    // {type, index, sheet_id, wall_index, width_ft}
  let openingHighlight = null;
  let openingDragEnabled = false;
  let openingDragCallback = null;
  let activeOpeningDrag = null;  // {mesh, wall_index, wallSeg, sheet_id, opening_type, opening_index, width_ft, lastFt}

  function _resolveOpeningMesh(opening_type, opening_index, sheet_id) {
    let found = null;
    (groups["openings"] || new THREE.Group()).traverse((obj) => {
      if (found) return;
      if (obj.isMesh && obj.userData?.pickable_opening &&
          obj.userData.opening_type === opening_type &&
          obj.userData.opening_index === opening_index &&
          obj.userData.sheet_id === sheet_id) {
        found = obj;
      }
    });
    return found;
  }

  function _clearOpeningHighlight() {
    if (openingHighlight) {
      pickTargetsRoot.remove(openingHighlight);
      openingHighlight.geometry?.dispose?.();
      openingHighlight.material?.dispose?.();
      openingHighlight = null;
    }
  }

  function setSelectedOpening(opening_type, opening_index, sheet_id) {
    _clearOpeningHighlight();
    if (opening_index === null || opening_index === undefined) {
      selectedOpening = null;
      return;
    }
    selectedOpening = { type: opening_type, index: opening_index, sheet_id };
    const mesh = _resolveOpeningMesh(opening_type, opening_index, sheet_id);
    if (!mesh) return;
    const bbox = new THREE.Box3().setFromObject(mesh);
    if (!Number.isFinite(bbox.min.x)) return;
    const sz = new THREE.Vector3();
    bbox.getSize(sz);
    const ctr = new THREE.Vector3();
    bbox.getCenter(ctr);
    modelRoot.worldToLocal(ctr);
    const hl = new THREE.Mesh(
      new THREE.BoxGeometry(sz.x * 1.15, sz.y * 1.1, sz.z * 3),
      new THREE.MeshBasicMaterial({ color: 0x00E5FF, wireframe: true, transparent: true, opacity: 0.9, depthTest: false }),
    );
    hl.position.copy(ctr);
    hl.rotation.copy(mesh.rotation);
    hl.renderOrder = 998;
    pickTargetsRoot.add(hl);
    openingHighlight = hl;
  }

  function _wallFromIndex(idx) {
    if (idx === null || idx === undefined) return null;
    const walls = currentWallsSnapshot;
    if (idx < 0 || idx >= walls.length) return null;
    const w = walls[idx];
    return { wall: w, seg: wallSegment(w) };
  }

  function _projectMouseToWallFt(clientX, clientY, seg, wall) {
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    if (!_dragRay.ray.intersectPlane(_dragGroundPlane, _dragHitPt)) return null;
    const local = modelRoot.worldToLocal(_dragHitPt.clone());
    // Project local ground-plane hit onto the wall's line
    const wx = local.x - seg.sx;
    const wz = local.z - seg.sz;
    const t = Math.max(0.03, Math.min(0.97, (wx * seg.dx + wz * seg.dz) / (seg.length * seg.length)));
    return [
      wall.start[0] + t * (wall.end[0] - wall.start[0]),
      wall.start[1] + t * (wall.end[1] - wall.start[1]),
    ];
  }

  function _onOpeningDragDown(e) {
    if (!openingDragEnabled || !selectedOpening) return;
    if (e.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _dragNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _dragNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _dragRay.setFromCamera(_dragNdc, camera);
    const mesh = _resolveOpeningMesh(selectedOpening.type, selectedOpening.index, selectedOpening.sheet_id);
    if (!mesh) return;
    const hits = _dragRay.intersectObject(mesh, false);
    if (!hits.length) return;
    const wi = mesh.userData.wall_index;
    const wr = _wallFromIndex(wi);
    if (!wr?.seg) return;
    activeOpeningDrag = {
      mesh, wall: wr.wall, wallSeg: wr.seg,
      opening_type: selectedOpening.type,
      opening_index: selectedOpening.index,
      sheet_id: selectedOpening.sheet_id,
      wall_index: wi,
    };
    controls.enabled = false;
    e.stopPropagation();
    e.preventDefault();
  }

  function _onOpeningDragMove(e) {
    if (!activeOpeningDrag) return;
    const nextFt = _projectMouseToWallFt(e.clientX, e.clientY, activeOpeningDrag.wallSeg, activeOpeningDrag.wall);
    if (!nextFt) return;
    const [x, z] = toWorld(nextFt);
    activeOpeningDrag.mesh.position.x = x;
    activeOpeningDrag.mesh.position.z = z;
    if (openingHighlight) {
      openingHighlight.position.x = x;
      openingHighlight.position.z = z;
    }
    activeOpeningDrag.lastFt = nextFt;
    openingDragCallback?.("dragging", { position_ft: nextFt });
  }

  function _onOpeningDragUp() {
    if (!activeOpeningDrag) return;
    const finalFt = activeOpeningDrag.lastFt || null;
    const packet = { ...activeOpeningDrag };
    activeOpeningDrag = null;
    controls.enabled = true;
    if (finalFt) {
      openingDragCallback?.("commit", {
        opening_type: packet.opening_type,
        opening_index: packet.opening_index,
        sheet_id: packet.sheet_id,
        wall_index: packet.wall_index,
        position_ft: finalFt,
      });
    }
  }

  function enableOpeningDrag(on, cb) {
    openingDragEnabled = !!on;
    openingDragCallback = cb || null;
    if (on) {
      renderer.domElement.addEventListener("pointerdown", _onOpeningDragDown);
      window.addEventListener("pointermove", _onOpeningDragMove);
      window.addEventListener("pointerup", _onOpeningDragUp);
    } else {
      renderer.domElement.removeEventListener("pointerdown", _onOpeningDragDown);
      window.removeEventListener("pointermove", _onOpeningDragMove);
      window.removeEventListener("pointerup", _onOpeningDragUp);
      activeOpeningDrag = null;
      controls.enabled = true;
    }
  }

  function setAddOpeningMode(mode) {
    // mode: null | "door" | "window"
    addOpeningMode = (mode === "door" || mode === "window") ? mode : null;
    renderer.domElement.style.cursor = addOpeningMode ? "crosshair" : (wallEditorEnabled ? "pointer" : "");
  }

  function getWallSnapshot() {
    return currentWallsSnapshot.slice();
  }

  function setVisibility(map) {
    for (const id of Object.keys(groups)) {
      groups[id].visible = !!map[id];
    }
  }

  // ---------- Model transform: position + rotation + display scale ----------
  // Display scale is a visual-only multiplier applied while placing the model
  // on the satellite image. It does NOT change the underlying blueprint.
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10.0;

  function getModelTransform() {
    return {
      x: modelRoot.position.x,
      z: modelRoot.position.z,
      rotation_deg: THREE.MathUtils.radToDeg(modelRoot.rotation.y),
      scale: modelRoot.scale.x,  // uniform scale; x/y/z always equal
    };
  }

  function setModelTransform({ x = 0, z = 0, rotation_deg = 0, scale = 1 } = {}) {
    modelRoot.position.set(Number(x) || 0, 0, Number(z) || 0);
    modelRoot.rotation.y = THREE.MathUtils.degToRad(Number(rotation_deg) || 0);
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(scale) || 1));
    modelRoot.scale.set(s, s, s);
  }

  // ---------- Placement mode: drag the model on the satellite plane ----------
  let placementActive = false;
  let dragging = false;
  let dragStartXZ = null;
  let dragStartModelXZ = null;
  let placementCallback = null;
  const raycaster = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const placePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0),
                                     FOOTING_DEPTH * 1.2 - 0.002); // matches site Y

  function _worldFromPointer(evt) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ptr, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(placePlane, hit);
    return hit;
  }

  function _onPointerDown(evt) {
    if (!placementActive || evt.button !== 0) return;
    const hit = _worldFromPointer(evt);
    if (!Number.isFinite(hit.x)) return;
    dragging = true;
    dragStartXZ = { x: hit.x, z: hit.z };
    dragStartModelXZ = { x: modelRoot.position.x, z: modelRoot.position.z };
    renderer.domElement.style.cursor = "grabbing";
    evt.preventDefault();
  }

  function _onPointerMove(evt) {
    if (!placementActive || !dragging) return;
    const hit = _worldFromPointer(evt);
    if (!Number.isFinite(hit.x)) return;
    const dx = hit.x - dragStartXZ.x;
    const dz = hit.z - dragStartXZ.z;
    modelRoot.position.x = dragStartModelXZ.x + dx;
    modelRoot.position.z = dragStartModelXZ.z + dz;
    if (placementCallback) placementCallback(getModelTransform());
  }

  function _onPointerUp() {
    if (!placementActive) return;
    dragging = false;
    renderer.domElement.style.cursor = "grab";
  }

  function _onWheel(evt) {
    if (!placementActive) return;
    evt.preventDefault();
    // 5% per wheel tick, exponential for natural feel.
    const factor = evt.deltaY < 0 ? 1.05 : (1 / 1.05);
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, modelRoot.scale.x * factor));
    modelRoot.scale.set(next, next, next);
    if (placementCallback) placementCallback(getModelTransform());
  }

  function enablePlacement(on, onChange) {
    placementActive = !!on;
    placementCallback = onChange || null;
    controls.enabled = !on;
    renderer.domElement.style.cursor = on ? "grab" : "auto";
    if (on) {
      renderer.domElement.addEventListener("pointerdown", _onPointerDown);
      renderer.domElement.addEventListener("wheel", _onWheel, { passive: false });
      window.addEventListener("pointermove", _onPointerMove);
      window.addEventListener("pointerup", _onPointerUp);
    } else {
      renderer.domElement.removeEventListener("pointerdown", _onPointerDown);
      renderer.domElement.removeEventListener("wheel", _onWheel);
      window.removeEventListener("pointermove", _onPointerMove);
      window.removeEventListener("pointerup", _onPointerUp);
      dragging = false;
    }
  }

  // ---------- TAPE MEASURE TOOL ----------
  // Scene units → real-world feet conversion. The satellite plane is sized in
  // feet (1 unit = 1 ft) when present; without a site, the scene is metric
  // (1 unit = 1 m) so we convert.
  const M_TO_FT_LOCAL = 3.28083989501;
  function getFtPerUnit() { return siteMesh ? 1.0 : M_TO_FT_LOCAL; }

  const measureGroup = new THREE.Group();
  measureGroup.name = "measureGroup";
  scene.add(measureGroup);

  // Snap grid plane (1 ft spacing) — hidden until measure tool is active.
  let snapGrid = null;
  function _buildSnapGrid() {
    if (snapGrid) {
      scene.remove(snapGrid);
      snapGrid.geometry.dispose();
      snapGrid.material.dispose();
      snapGrid = null;
    }
    // Size grid to satellite if present, else 200 ft × 200 ft.
    const sizeFt = siteMesh
      ? (siteMesh.geometry.parameters.width || 200)
      : 200;
    const divisions = Math.min(400, Math.max(40, Math.round(sizeFt)));
    snapGrid = new THREE.GridHelper(sizeFt, divisions, 0xFFCC00, 0x335577);
    snapGrid.material.transparent = true;
    snapGrid.material.opacity = 0.35;
    snapGrid.position.y = (siteMesh ? siteMesh.position.y : -FOOTING_DEPTH * 1.2) + 0.005;
    snapGrid.visible = false;
    scene.add(snapGrid);
  }
  _buildSnapGrid();

  // Hover indicator (snap point)
  const snapDotGeo = new THREE.SphereGeometry(0.18, 16, 12);
  const snapDotMat = new THREE.MeshBasicMaterial({ color: 0xFFCC00, depthTest: false });
  const snapDot = new THREE.Mesh(snapDotGeo, snapDotMat);
  snapDot.name = "snapDot";
  snapDot.visible = false;
  snapDot.renderOrder = 999;
  scene.add(snapDot);

  // First-pick indicator (start point of pending measurement)
  const firstDotMat = new THREE.MeshBasicMaterial({ color: 0xFF66AA, depthTest: false });
  const firstDot = new THREE.Mesh(snapDotGeo, firstDotMat);
  firstDot.name = "firstDot";
  firstDot.visible = false;
  firstDot.renderOrder = 999;
  scene.add(firstDot);

  // Per-measurement persistent meshes keyed by id
  const measurementMeshes = new Map();

  let measureActive = false;
  let measurePending = null;       // {x,y,z} after first click
  let measureSnapEnabled = true;
  let measureCallback = null;      // (action, payload) => void  e.g. "created"
  const measureRaycaster = new THREE.Raycaster();
  const measurePtr = new THREE.Vector2();
  const groundPlane = new THREE.Plane(
    new THREE.Vector3(0, 1, 0),
    FOOTING_DEPTH * 1.2 - 0.002,
  );

  function _collectSnapTargets() {
    // Wall corners from current model
    const corners = [];
    const wallsGroup = groups["wallSheet"] || groups["frame"] || groups["foundation"];
    if (wallsGroup) {
      const box = new THREE.Box3();
      wallsGroup.traverse((o) => {
        if (!o.geometry) return;
        box.setFromObject(o);
        if (Number.isFinite(box.min.x)) {
          const y = snapGrid ? snapGrid.position.y : 0;
          corners.push(new THREE.Vector3(box.min.x, y, box.min.z));
          corners.push(new THREE.Vector3(box.min.x, y, box.max.z));
          corners.push(new THREE.Vector3(box.max.x, y, box.min.z));
          corners.push(new THREE.Vector3(box.max.x, y, box.max.z));
        }
      });
    }
    // Previous measurement endpoints
    const prevEnds = [];
    measurementMeshes.forEach((m) => {
      prevEnds.push(m.userData.start.clone());
      prevEnds.push(m.userData.end.clone());
    });
    return { corners, prevEnds };
  }

  const SNAP_THRESHOLD_FT = 1.5;

  function _snapPoint(hit) {
    if (!measureSnapEnabled || !hit) return hit;
    const fpu = getFtPerUnit();
    const thresholdUnits = SNAP_THRESHOLD_FT / fpu;

    let best = null;
    let bestDist = thresholdUnits;

    // 1) Grid intersection (1 ft spacing)
    const stepUnits = 1.0 / fpu;
    const gx = Math.round(hit.x / stepUnits) * stepUnits;
    const gz = Math.round(hit.z / stepUnits) * stepUnits;
    const gridPt = new THREE.Vector3(gx, hit.y, gz);
    const dGrid = gridPt.distanceTo(hit);
    if (dGrid <= bestDist) {
      best = gridPt; bestDist = dGrid;
    }

    // 2) Wall corners + 3) previous endpoints (tighter threshold = priority)
    const { corners, prevEnds } = _collectSnapTargets();
    for (const c of corners.concat(prevEnds)) {
      const d = c.distanceTo(hit);
      // Give corners/endpoints a 2× priority over grid
      if (d <= thresholdUnits * 2 && d < bestDist + thresholdUnits * 0.5) {
        best = c.clone(); bestDist = d;
      }
    }

    return best || hit;
  }

  function _worldFromMeasurePtr(evt) {
    const rect = renderer.domElement.getBoundingClientRect();
    measurePtr.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
    measurePtr.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
    measureRaycaster.setFromCamera(measurePtr, camera);
    const hit = new THREE.Vector3();
    if (!measureRaycaster.ray.intersectPlane(groundPlane, hit)) return null;
    return hit;
  }

  function _makeLabelSprite(text) {
    const canvas = document.createElement("canvas");
    const w = 256, h = 64;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#FFCC00";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.fillStyle = "#FFCC00";
    ctx.font = "bold 32px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 1000;
    // Scale sprite to ~6 ft wide in scene
    const widthUnits = 6.0 / getFtPerUnit();
    sprite.scale.set(widthUnits, widthUnits * (h / w), 1);
    return sprite;
  }

  function _renderMeasurement({ id, start, end, distance_ft, label }) {
    if (measurementMeshes.has(id)) {
      _removeMeasurementMesh(id);
    }
    const grp = new THREE.Group();
    grp.name = `measurement-${id}`;
    grp.userData.id = id;
    grp.userData.start = new THREE.Vector3(start.x, start.y, start.z);
    grp.userData.end = new THREE.Vector3(end.x, end.y, end.z);

    // Line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      grp.userData.start, grp.userData.end,
    ]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xFFCC00, depthTest: false });
    const line = new THREE.Line(lineGeo, lineMat);
    line.renderOrder = 998;
    grp.add(line);

    // Endpoint dots
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xFFCC00, depthTest: false });
    const dotA = new THREE.Mesh(snapDotGeo, dotMat);
    dotA.position.copy(grp.userData.start);
    dotA.renderOrder = 998;
    grp.add(dotA);
    const dotB = new THREE.Mesh(snapDotGeo, dotMat);
    dotB.position.copy(grp.userData.end);
    dotB.renderOrder = 998;
    grp.add(dotB);

    // Label at midpoint
    const mid = grp.userData.start.clone().add(grp.userData.end).multiplyScalar(0.5);
    mid.y += 1.2 / getFtPerUnit();   // float ~1.2 ft above ground
    const labelText = label || _formatFtIn(distance_ft);
    const sprite = _makeLabelSprite(labelText);
    sprite.position.copy(mid);
    grp.add(sprite);

    measureGroup.add(grp);
    measurementMeshes.set(id, grp);
  }

  function _removeMeasurementMesh(id) {
    const m = measurementMeshes.get(id);
    if (!m) return;
    measureGroup.remove(m);
    m.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        if (Array.isArray(o.material)) o.material.forEach((mm) => mm.dispose());
        else o.material.dispose();
      }
    });
    measurementMeshes.delete(id);
  }

  function _formatFtIn(ft) {
    const sign = ft < 0 ? -1 : 1;
    const abs = Math.abs(ft);
    let whole = Math.floor(abs);
    let inches = Math.round((abs - whole) * 12);
    if (inches === 12) { whole += 1; inches = 0; }
    return `${sign < 0 ? "-" : ""}${whole}' ${inches}"`;
  }

  function _onMeasurePointerMove(evt) {
    if (!measureActive) return;
    const hit = _worldFromMeasurePtr(evt);
    if (!hit) { snapDot.visible = false; return; }
    const snapped = _snapPoint(hit);
    snapDot.position.copy(snapped);
    snapDot.visible = true;
  }

  function _onMeasurePointerDown(evt) {
    if (!measureActive || evt.button !== 0) return;
    const hit = _worldFromMeasurePtr(evt);
    if (!hit) return;
    const snapped = _snapPoint(hit);
    if (!measurePending) {
      measurePending = snapped.clone();
      firstDot.position.copy(measurePending);
      firstDot.visible = true;
      if (measureCallback) measureCallback("first-pick", measurePending);
    } else {
      const start = measurePending.clone();
      const end = snapped.clone();
      const fpu = getFtPerUnit();
      const distance_ft = start.distanceTo(end) * fpu;
      measurePending = null;
      firstDot.visible = false;
      if (measureCallback) {
        measureCallback("measured", {
          start: { x: start.x, y: start.y, z: start.z },
          end: { x: end.x, y: end.y, z: end.z },
          distance_ft,
        });
      }
    }
  }

  function _onMeasureKeyDown(evt) {
    if (!measureActive) return;
    if (evt.key === "Escape") {
      measurePending = null;
      firstDot.visible = false;
      if (measureCallback) measureCallback("cancel-pick");
    }
  }

  function enableMeasureTool(on, callback) {
    measureActive = !!on;
    measureCallback = callback || null;
    controls.enabled = !on;
    renderer.domElement.style.cursor = on ? "crosshair" : "auto";
    if (snapGrid) snapGrid.visible = !!on;
    if (!on) {
      snapDot.visible = false;
      firstDot.visible = false;
      measurePending = null;
      renderer.domElement.removeEventListener("pointermove", _onMeasurePointerMove);
      renderer.domElement.removeEventListener("pointerdown", _onMeasurePointerDown);
      window.removeEventListener("keydown", _onMeasureKeyDown);
    } else {
      // Rebuild the grid in case site changed
      _buildSnapGrid();
      snapGrid.visible = true;
      renderer.domElement.addEventListener("pointermove", _onMeasurePointerMove);
      renderer.domElement.addEventListener("pointerdown", _onMeasurePointerDown);
      window.addEventListener("keydown", _onMeasureKeyDown);
    }
  }

  function setMeasurements(list) {
    // Replace all
    measurementMeshes.forEach((_, id) => _removeMeasurementMesh(id));
    (list || []).forEach((m) => _renderMeasurement(m));
  }

  function addMeasurement(m) { _renderMeasurement(m); }
  function removeMeasurement(id) { _removeMeasurementMesh(id); }
  function setSnapEnabled(b) { measureSnapEnabled = !!b; }
  function getMeasureFtPerUnit() { return getFtPerUnit(); }
  function formatFtIn(ft) { return _formatFtIn(ft); }

  /** Render a high-resolution PNG of the current scene + camera and return a Blob. */
  async function captureHiRes(width = 3840, height = 2160) {
    const target = new THREE.WebGLRenderTarget(width, height, {
      samples: 4,
      colorSpace: THREE.SRGBColorSpace,
    });
    const prevPR = renderer.getPixelRatio();
    const prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    const prevAspect = camera.aspect;

    // Snapshot golden-hour lighting for prettier output.
    const dirOrig = dir.intensity;
    const fillOrig = fill.intensity;
    dir.intensity = 1.6;
    fill.intensity = 0.5;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    // read pixels
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

    // restore
    renderer.setRenderTarget(null);
    renderer.setPixelRatio(prevPR);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    dir.intensity = dirOrig;
    fill.intensity = fillOrig;
    target.dispose();

    // Convert to PNG via offscreen canvas (Y-flip — WebGL is bottom-up).
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const imgData = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const src = (height - y - 1) * width * 4;
      const dst = y * width * 4;
      imgData.data.set(pixels.subarray(src, src + width * 4), dst);
    }
    ctx.putImageData(imgData, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  /** Camera-dolly animation. Provides a frame callback to update phase, etc. */
  function startDolly({ durationSec = 12, onProgress = null }) {
    const start = performance.now();
    const aabb = (() => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      scene.traverse((o) => {
        if (!o.visible || !o.geometry) return;
        const b = new THREE.Box3().setFromObject(o);
        if (Number.isFinite(b.min.x)) {
          minX = Math.min(minX, b.min.x);
          maxX = Math.max(maxX, b.max.x);
          minZ = Math.min(minZ, b.min.z);
          maxZ = Math.max(maxZ, b.max.z);
        }
      });
      if (!Number.isFinite(minX)) return { cx: 0, cz: 0, size: 8 };
      return {
        cx: (minX + maxX) / 2,
        cz: (minZ + maxZ) / 2,
        size: Math.max(maxX - minX, maxZ - minZ, 4),
      };
    })();

    const radius = aabb.size * 1.5 + 6;
    controls.enabled = false;

    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        const u = Math.min(1, t / durationSec);
        // Slow ease in/out
        const eased = 0.5 - 0.5 * Math.cos(u * Math.PI);
        // Orbit around the building
        const angle = eased * Math.PI * 1.6 - Math.PI / 4;
        const height = radius * (0.55 + Math.sin(eased * Math.PI) * 0.25);
        camera.position.set(
          aabb.cx + Math.cos(angle) * radius,
          height,
          aabb.cz + Math.sin(angle) * radius,
        );
        camera.lookAt(aabb.cx, WALL_HEIGHT * 0.5, aabb.cz);
        if (onProgress) onProgress(u);
        if (u < 1) {
          requestAnimationFrame(tick);
        } else {
          controls.enabled = true;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  /** Direct accessors for capture/video features. */
  function getDomElement() { return renderer.domElement; }

  function dispose() {
    cancelAnimationFrame(animHandle);
    window.removeEventListener("resize", onResize);
    ro.disconnect();
    controls.dispose();
    disposeSite();
    renderer.dispose();
    if (renderer.domElement?.parentNode === mount) mount.removeChild(renderer.domElement);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  return { build, setVisibility, setSite,
           setSiteTerrain, clearSiteTerrain, setTerrainExaggeration,
           tiltCameraOblique, fitCamera,
           setModelTransform, getModelTransform, enablePlacement,
           captureHiRes, startDolly, getDomElement, dispose,
           enableMeasureTool, setMeasurements, addMeasurement,
           removeMeasurement, setSnapEnabled, getMeasureFtPerUnit,
           formatFtIn,
           enableWallEditor, setSelectedWall, setSelectedRoom, getWallSnapshot,
           enableEndpointDrag,
           setSelectedFixture, enableFixtureDrag, setFixtureRotation,
           setSelectedOpening, enableOpeningDrag, setAddOpeningMode };
}
