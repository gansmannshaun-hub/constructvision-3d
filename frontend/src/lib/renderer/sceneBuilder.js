// Pure Three.js scene engine for the 3D renderer.
// No React, no DOM ops other than what the caller supplies (a mount element).
// Public API:
//   createSceneEngine(mountEl) -> {
//     build(blueprint), setVisibility(map), dispose()
//   }
//   PHASES, ALL_LAYERS, MAX_PHASE, ROOF_TYPES, DEFAULT_CFG
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ---------- Constants ----------
export const WALL_HEIGHT = 3.05;   // ~10 ft default
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
  { id: 14, label: "Finished",    layers: ["foundation", "wallSheet", "roofSheet", "openings", "trim"] },
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
    const nx = -Math.sin(-s.angle), nz = Math.cos(-s.angle);
    const panel = makeBox(s.length, WALL_HEIGHT, PANEL_THICKNESS, CFG.wall_color, { roughness: 0.5, metalness: 0.6 });
    panel.position.set(s.cx + nx * (PANEL_THICKNESS / 2 + 0.05),
                       WALL_HEIGHT / 2 + SLAB_THICK,
                       s.cz + nz * (PANEL_THICKNESS / 2 + 0.05));
    panel.rotation.y = -s.angle;
    g.add(panel);
    const ribCount = Math.max(2, Math.floor(s.length / 0.6));
    for (let i = 0; i < ribCount; i++) {
      const t = (i + 0.5) / ribCount;
      const rib = makeBox(0.04, WALL_HEIGHT * 0.98, 0.02, "#C6C2BA", { roughness: 0.6, metalness: 0.5, noShadow: true });
      const x = s.sx + s.dx * t + nx * (PANEL_THICKNESS / 2 + 0.07);
      const z = s.sz + s.dz * t + nz * (PANEL_THICKNESS / 2 + 0.07);
      rib.position.set(x, WALL_HEIGHT / 2 + SLAB_THICK, z);
      rib.rotation.y = -s.angle;
      g.add(rib);
    }
  }
  return g;
}

function buildRoofSheeting(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
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
  for (const d of doors || []) {
    if (!d.position) continue;
    const [x, z] = toWorld(d.position);
    const w = Math.max(0.7, (d.width || 3) * SCALE * 0.5);
    const h = 2.1;
    const mesh = makeBox(w, h, 0.06, "#FFCC00", { roughness: 0.45, metalness: 0.3 });
    mesh.position.set(x, h / 2 + SLAB_THICK, z);
    g.add(mesh);
  }
  for (const w of windows || []) {
    if (!w.position) continue;
    const [x, z] = toWorld(w.position);
    const ww = Math.max(0.6, (w.width || 4) * SCALE * 0.5);
    const wh = 1.0;
    const m = makeBox(ww, wh, 0.05, "#3a78d6", {
      roughness: 0.1, metalness: 0.5, opacity: 0.7,
      emissive: 0x1133aa, emissiveIntensity: 0.25,
    });
    m.position.set(x, 1.2 + SLAB_THICK, z);
    g.add(m);
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
  roofSheet:   (aabb)        => buildRoofSheeting(aabb),
  wallSheet:   (_, walls)    => buildWallSheeting(walls),
  openings:    (_, walls, doors, windows) => buildOpenings(walls, doors, windows),
  trim:        (aabb, walls) => buildTrim(walls, aabb),
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

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.target.set(0, 1.5, 0);

  let groups = {};
  let animHandle = null;

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
  const ro = new ResizeObserver(onResize);
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
    const walls = blueprint.walls || [];
    const doors = blueprint.doors || [];
    const windows = blueprint.windows || [];
    CFG = {
      roof_type: blueprint.roof_type || DEFAULT_CFG.roof_type,
      roof_pitch_deg: blueprint.roof_pitch_deg ?? DEFAULT_CFG.roof_pitch_deg,
      wall_color: blueprint.wall_color || DEFAULT_CFG.wall_color,
      roof_color: blueprint.roof_color || DEFAULT_CFG.roof_color,
    };
    // dispose previous
    for (const id of Object.keys(groups)) {
      scene.remove(groups[id]);
      disposeObject(groups[id]);
    }
    groups = {};
    const aabb = footprintAabb(walls);
    for (const layer of ALL_LAYERS) {
      const g = BUILDERS[layer.id](aabb, walls, doors, windows);
      g.name = layer.id;
      scene.add(g);
      groups[layer.id] = g;
    }
    // Auto-fit camera
    if (aabb) {
      const size = Math.max(aabb.w, aabb.d, 4);
      const dist = size * 1.6 + 6;
      camera.position.set(aabb.cx + dist * 0.65, dist * 0.7, aabb.cz + dist * 0.85);
      controls.target.set(aabb.cx, WALL_HEIGHT * 0.5, aabb.cz);
      controls.update();
    }
  }

  function setVisibility(map) {
    for (const id of Object.keys(groups)) {
      groups[id].visible = !!map[id];
    }
  }

  function dispose() {
    cancelAnimationFrame(animHandle);
    window.removeEventListener("resize", onResize);
    ro.disconnect();
    controls.dispose();
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

  return { build, setVisibility, dispose };
}
