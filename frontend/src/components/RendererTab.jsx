import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store";

const WALL_HEIGHT = 3.0;       // m
const SCALE = 0.1;             // blueprint 0-100 -> world -5..5 (10m)
const SLAB_THICK = 0.18;
const FOOTING_DEPTH = 0.45;
const EAVE_OVERHANG = 0.3;
const COLUMN_SIZE = 0.18;
const GIRT_SIZE = 0.12;
const GIRT_HEIGHTS = [0.6, 1.5, 2.4];
const PURLIN_SPACING = 1.2;
const PURLIN_SIZE = 0.12;
const PANEL_THICKNESS = 0.04;
const TRIM_THICKNESS = 0.06;
const COLUMN_MAX_SPACING = 4.0;
const ROOF_TYPES = [
  { id: "gable", label: "Gable" },
  { id: "shed",  label: "Shed (Mono)" },
  { id: "flat",  label: "Flat" },
  { id: "hip",   label: "Hip" },
];

const PHASES = [
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
const MAX_PHASE = PHASES.length - 1;

const ALL_LAYERS = [
  { id: "excavation",  label: "Excavation",           color: "#5C3A1E" },
  { id: "underground", label: "Underground Utilities", color: "#3a78d6" },
  { id: "septic",      label: "Septic / Drain Field",  color: "#4d6b3a" },
  { id: "foundation",  label: "Foundation",           color: "#B0B0B0" },
  { id: "columns",     label: "Columns",              color: "#444444" },
  { id: "frame",       label: "Primary Frame",        color: "#555555" },
  { id: "plumbing",    label: "Plumbing",             color: "#3a9ed6" },
  { id: "electrical",  label: "Electrical",           color: "#FF6600" },
  { id: "girts",       label: "Wall Girts",           color: "#8C9499" },
  { id: "purlins",     label: "Roof Purlins",         color: "#8C9499" },
  { id: "roofSheet",   label: "Roof Sheeting",        color: "#4A5C6E" },
  { id: "wallSheet",   label: "Wall Sheeting",        color: "#D8D4CC" },
  { id: "openings",    label: "Doors & Windows",      color: "#FFCC00" },
  { id: "trim",        label: "Trim & Flashing",      color: "#FFFFFF" },
];

// Mutable config used by procedural builders (set by component before building)
let CFG = { roof_type: "gable", roof_pitch_deg: 12, wall_color: "#D8D4CC", roof_color: "#4A5C6E" };
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
  return {
    sx, sz, ex, ez, dx, dz, length,
    angle: Math.atan2(dz, dx),
    cx: (sx + ex) / 2,
    cz: (sz + ez) / 2,
  };
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

// ---------- Builders ----------
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
  const geom = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = !opts.noShadow;
  mesh.receiveShadow = true;
  return mesh;
}

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
  // slab
  const slab = makeBox(aabb.w + 0.2, SLAB_THICK, aabb.d + 0.2, "#B8B5A8", { roughness: 0.9, metalness: 0 });
  slab.position.set(aabb.cx, SLAB_THICK / 2, aabb.cz);
  g.add(slab);
  // footings under each wall
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
    // intermediate columns along long walls
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
    // single sloped beam at high end
    const len = ridgeAlongX ? aabb.w : aabb.d;
    const ridge = makeBox(len, 0.2, 0.2, "#444", { roughness: 0.4, metalness: 0.85 });
    if (ridgeAlongX) ridge.position.set(aabb.cx, ridgeY, aabb.minZ);
    else { ridge.position.set(aabb.minX, ridgeY, aabb.cz); ridge.rotation.y = Math.PI / 2; }
    g.add(ridge);
    return g;
  }
  // gable / hip (hip approximated as gable with shorter ridge)
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

function buildWallSheeting(walls, doors, windows, openings) {
  const g = new THREE.Group();
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    // sheet positioned slightly outside wall (offset along normal)
    const nx = -Math.sin(-s.angle), nz = Math.cos(-s.angle);
    const panel = makeBox(s.length, WALL_HEIGHT, PANEL_THICKNESS, CFG.wall_color || "#D8D4CC", { roughness: 0.5, metalness: 0.6 });
    panel.position.set(s.cx + nx * (PANEL_THICKNESS / 2 + 0.05),
                       WALL_HEIGHT / 2 + SLAB_THICK,
                       s.cz + nz * (PANEL_THICKNESS / 2 + 0.05));
    panel.rotation.y = -s.angle;
    g.add(panel);
    // subtle ribs (5 vertical ribs per panel) — for visual texture
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
  const color = CFG.roof_color || "#4A5C6E";
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
  // gable / hip (hip approximated as gable)
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
  // doors render in front of wall sheeting
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
  // Water main — blue, enters from west
  const water = mk("#3a78d6", aabb.w + 6);
  water.rotation.z = Math.PI / 2;
  water.position.set(aabb.cx - 1, yBelow, aabb.cz - 0.6);
  g.add(water);
  // Gas line — yellow, enters from west
  const gas = mk("#FFCC00", aabb.w + 6, 0.6);
  gas.rotation.z = Math.PI / 2;
  gas.position.set(aabb.cx - 1, yBelow - 0.25, aabb.cz + 0.6);
  g.add(gas);
  // Sewer — gray, exits east
  const sewer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, runLen, 12),
    new THREE.MeshStandardMaterial({ color: "#5a5a5a", roughness: 0.85 })
  );
  sewer.rotation.z = Math.PI / 2;
  sewer.position.set(aabb.cx + 1, yBelow - 0.4, aabb.cz);
  g.add(sewer);
  // Meter/curb stops at edge (small markers)
  const meter = makeBox(0.3, 0.5, 0.3, "#888", { roughness: 0.6, metalness: 0.6 });
  meter.position.set(aabb.minX - 2.5, 0.25, aabb.cz - 0.6);
  g.add(meter);
  return g;
}

function buildSeptic(aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  // Septic tank offset from the building
  const tankW = 2.4, tankH = 1.4, tankD = 1.4;
  const tankX = aabb.maxX + 3.0;
  const tankZ = aabb.minZ - 1.2;
  const tank = makeBox(tankW, tankH, tankD, "#4d6b3a", { roughness: 0.9, metalness: 0 });
  tank.position.set(tankX, -tankH / 2 - 0.1, tankZ);
  g.add(tank);
  // Lid/access ports (two small risers on top)
  for (const dx of [-0.55, 0.55]) {
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.3, 16),
      new THREE.MeshStandardMaterial({ color: "#2f3d22", roughness: 0.9 })
    );
    lid.position.set(tankX + dx, 0.05, tankZ);
    g.add(lid);
  }
  // Distribution box
  const dbox = makeBox(0.6, 0.5, 0.6, "#5d7b4a", { roughness: 0.9 });
  dbox.position.set(tankX + 1.8, -0.4, tankZ);
  g.add(dbox);
  // Outflow pipe (tank -> distribution box)
  const outflow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.4, 10),
    new THREE.MeshStandardMaterial({ color: "#8a7a4a", roughness: 0.7 })
  );
  outflow.rotation.z = Math.PI / 2;
  outflow.position.set(tankX + 1.1, -0.5, tankZ);
  g.add(outflow);
  // Leach field laterals (parallel perforated pipes in gravel beds)
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
    // Gravel bed under each pipe
    const bed = makeBox(lateralLen + 0.3, 0.08, 0.55, "#7a7868", { roughness: 1, noShadow: true });
    bed.position.set(fieldStartX + lateralLen / 2, -0.72, zOff);
    g.add(bed);
  }
  return g;
}

function buildPlumbing(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  // Vertical drain stack rising through roof near corner
  const stackX = aabb.minX + 1.0, stackZ = aabb.minZ + 1.0;
  const stack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, WALL_HEIGHT + 0.8, 12),
    new THREE.MeshStandardMaterial({ color: "#cccccc", roughness: 0.6 })
  );
  stack.position.set(stackX, SLAB_THICK + (WALL_HEIGHT + 0.8) / 2, stackZ);
  g.add(stack);
  // Supply lines & drain lines following inside of walls
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    // inside-facing normal (perpendicular, pointing toward center)
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
  // Panel mounted on first wall
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
  // Conduit along ceiling + outlet boxes on walls
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
  // Center ceiling junction box
  const jbox = makeBox(0.22, 0.1, 0.22, "#FF6600", { roughness: 0.6 });
  jbox.position.set(aabb.cx, condY + 0.1, aabb.cz);
  g.add(jbox);
  return g;
}

function buildTrim(walls, aabb) {
  const g = new THREE.Group();
  if (!aabb) return g;
  // corner trim at every wall endpoint
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
  // eave trim along each wall top
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const t = makeBox(s.length + 0.1, TRIM_THICKNESS, 0.18, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
    t.position.set(s.cx, WALL_HEIGHT + SLAB_THICK + 0.03, s.cz);
    t.rotation.y = -s.angle;
    g.add(t);
  }
  // ridge cap
  if (CFG.roof_type !== "flat" && CFG.roof_type !== "shed") {
    const ridgeAlongX = aabb.w >= aabb.d;
    const ph = pitchH(aabb);
    const ridge = makeBox(ridgeAlongX ? aabb.w + 0.4 : 0.25, 0.08, ridgeAlongX ? 0.25 : aabb.d + 0.4, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
    ridge.position.set(aabb.cx, WALL_HEIGHT + SLAB_THICK + ph + 0.05, aabb.cz);
    g.add(ridge);
  }
  return g;
}

// ---------- React component ----------
export default function RendererTab() {
  const { blueprint, saveBlueprint } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];
  const roofType   = blueprint.roof_type || "gable";
  const roofPitch  = blueprint.roof_pitch_deg ?? 12;
  const wallColor  = blueprint.wall_color || "#D8D4CC";
  const roofColor  = blueprint.roof_color || "#4A5C6E";

  const [phase, setPhase] = useState(MAX_PHASE);
  const [layerOverrides, setLayerOverrides] = useState({});
  const [autoMode, setAutoMode] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);

  const updateCfg = useCallback(async (patch) => {
    setSavingCfg(true);
    try {
      await saveBlueprint(walls, doors, windows, blueprint.labels || [], patch);
    } finally {
      setSavingCfg(false);
    }
  }, [saveBlueprint, walls, doors, windows, blueprint.labels]);

  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const groupsRef = useRef({});
  const animRef = useRef(null);

  // Phase determines which layers are visible by default
  const visibleLayers = useMemo(() => {
    if (autoMode) {
      const set = new Set(PHASES[phase].layers);
      return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, set.has(l.id) || (layerOverrides[l.id] === true)]));
    }
    return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, !!layerOverrides[l.id]]));
  }, [phase, layerOverrides, autoMode]);

  // 1) Init scene once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const w = mount.clientWidth || 800;
    const h = mount.clientHeight || 600;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.Fog(0x0a0a0a, 30, 80);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 300);
    camera.position.set(12, 10, 14);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(8, 14, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    Object.assign(dir.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x99bbff, 0.35);
    fill.position.set(-6, 8, -4);
    scene.add(fill);

    // ground reference (a darker disc surrounding excavation)
    const groundGeom = new THREE.CircleGeometry(40, 64);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -FOOTING_DEPTH * 1.2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(40, 40, 0x0055ff, 0x1f1f1f);
    grid.position.y = -FOOTING_DEPTH * 1.2 + 0.001;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 3;
    controls.maxDistance = 60;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(0, 1.5, 0);
    controlsRef.current = controls;

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
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

    return () => {
      cancelAnimationFrame(animRef.current);
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
    };
  }, []);

  // 2) Rebuild all groups when walls/doors/windows or roof config change
  useEffect(() => {
    CFG = { roof_type: roofType, roof_pitch_deg: roofPitch, wall_color: wallColor, roof_color: roofColor };
    const scene = sceneRef.current;
    if (!scene) return;
    // dispose previous
    for (const id of Object.keys(groupsRef.current)) {
      const g = groupsRef.current[id];
      scene.remove(g);
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
    groupsRef.current = {};

    const aabb = footprintAabb(walls);
    const builds = {
      excavation:  () => buildExcavation(aabb),
      underground: () => buildUnderground(aabb),
      septic:      () => buildSeptic(aabb),
      foundation:  () => buildFoundation(aabb, walls),
      columns:     () => buildColumns(walls),
      frame:       () => buildFrame(walls, aabb),
      plumbing:    () => buildPlumbing(walls, aabb),
      electrical:  () => buildElectrical(walls, aabb),
      girts:       () => buildGirts(walls),
      purlins:     () => buildPurlins(aabb),
      roofSheet:   () => buildRoofSheeting(aabb),
      wallSheet:   () => buildWallSheeting(walls, doors, windows),
      openings:    () => buildOpenings(walls, doors, windows),
      trim:        () => buildTrim(walls, aabb),
    };
    for (const layer of ALL_LAYERS) {
      const g = builds[layer.id]();
      g.name = layer.id;
      scene.add(g);
      groupsRef.current[layer.id] = g;
    }

    // Auto-fit camera
    const cam = cameraRef.current, ctl = controlsRef.current;
    if (cam && ctl && aabb) {
      const size = Math.max(aabb.w, aabb.d, 4);
      const dist = size * 1.6 + 6;
      cam.position.set(aabb.cx + dist * 0.65, dist * 0.7, aabb.cz + dist * 0.85);
      ctl.target.set(aabb.cx, WALL_HEIGHT * 0.5, aabb.cz);
      ctl.update();
    }
  }, [walls, doors, windows]);

  // 3) Apply visibility
  useEffect(() => {
    for (const id of Object.keys(groupsRef.current)) {
      const g = groupsRef.current[id];
      if (g) g.visible = !!visibleLayers[id];
    }
  }, [visibleLayers]);

  // 4) Animate phases when playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPhase((p) => {
        if (p >= MAX_PHASE) {
          setPlaying(false);
          return MAX_PHASE;
        }
        return p + 1;
      });
    }, 850);
    return () => clearInterval(t);
  }, [playing]);

  const empty = walls.length === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] grid-rows-[1fr_auto] lg:grid-rows-1 h-full" data-testid="renderer-tab">
      <section className="relative min-h-[60vh] lg:min-h-0 border-b border-white/10 lg:border-b-0">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm pointer-events-none">
          <div className="label-mono">// CONSTRUCTION PHASE</div>
          <div className="font-display text-lg tracking-tighter">{PHASES[phase].label}</div>
        </div>
        {empty && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="text-center bg-black/60 px-6 py-4 border border-white/10">
              <div className="label-mono text-neutral-500 mb-2">// NO GEOMETRY</div>
              <div className="text-neutral-400 font-mono text-sm">Upload a floor plan or draw walls in the CAD editor.</div>
            </div>
          </div>
        )}
        <div ref={mountRef} data-testid="renderer-canvas-mount" className="w-full h-full bg-[#0a0a0a]" />

        {/* Phase slider at bottom */}
        <div className="absolute bottom-3 left-3 right-3 z-10 bg-black/80 border border-white/10 backdrop-blur-sm p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="label-mono text-[#FFCC00]">// PHASE {phase} / {MAX_PHASE} · {PHASES[phase].label}</div>
            <div className="flex items-center gap-2">
              <button
                data-testid="renderer-play"
                onClick={() => {
                  if (!playing && phase >= MAX_PHASE) setPhase(0);
                  setPlaying((p) => !p);
                  setAutoMode(true);
                }}
                className={`label-mono px-2 py-1 border ${playing ? "bg-[#FF3333] text-white border-[#FF3333]" : "bg-[#00CC66] text-black border-[#00CC66]"}`}
                title="Animate construction phases"
              >
                {playing ? "■ STOP" : "▶ PLAY"}
              </button>
              <button
                data-testid="renderer-auto-toggle"
                onClick={() => setAutoMode((a) => !a)}
                className={`label-mono px-2 py-1 border ${autoMode ? "bg-[#FFCC00] text-black border-[#FFCC00]" : "border-white/20 text-white hover:bg-white/10"}`}
              >
                {autoMode ? "AUTO" : "MANUAL"}
              </button>
              <button
                data-testid="renderer-prev"
                onClick={() => { setPhase((p) => Math.max(0, p - 1)); setAutoMode(true); }}
                className="label-mono px-2 py-1 border border-white/20 hover:bg-white/10"
                disabled={phase === 0}
              >
                ◀
              </button>
              <button
                data-testid="renderer-next"
                onClick={() => { setPhase((p) => Math.min(MAX_PHASE, p + 1)); setAutoMode(true); }}
                className="label-mono px-2 py-1 border border-white/20 hover:bg-white/10"
                disabled={phase === MAX_PHASE}
              >
                ▶
              </button>
            </div>
          </div>
          <input
            data-testid="renderer-phase-slider"
            type="range"
            min={0}
            max={MAX_PHASE}
            value={phase}
            onChange={(e) => { setPhase(Number(e.target.value)); setAutoMode(true); }}
            className="w-full accent-[#FFCC00]"
          />
          <div className="flex justify-between mt-1 text-[9px] font-mono text-neutral-500 gap-0.5 overflow-hidden">
            {PHASES.map((p) => (
              <span key={p.id} className={`truncate ${p.id === phase ? "text-[#FFCC00]" : ""}`}>{p.label.slice(0, 5)}</span>
            ))}
          </div>
        </div>
      </section>

      <aside className="border-l border-white/10 p-5 overflow-y-auto">
        <div className="label-mono mb-2">// ROOF & FINISH</div>
        <div className="space-y-3 mb-6">
          <label className="block">
            <div className="label-mono mb-1">Roof type</div>
            <select
              data-testid="renderer-roof-type"
              value={roofType}
              onChange={(e) => updateCfg({ roof_type: e.target.value })}
              className="w-full bg-black border border-white/15 px-3 py-2 text-sm"
            >
              {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="label-mono mb-1 flex justify-between">
              <span>Roof pitch</span><span className="text-[#FFCC00]">{roofPitch}°</span>
            </div>
            <input
              data-testid="renderer-roof-pitch"
              type="range" min="0" max="45" step="1"
              value={roofPitch}
              onChange={(e) => updateCfg({ roof_pitch_deg: Number(e.target.value) })}
              disabled={roofType === "flat"}
              className="w-full accent-[#FFCC00]"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="label-mono mb-1">Wall color</div>
              <input
                data-testid="renderer-wall-color"
                type="color" value={wallColor}
                onChange={(e) => updateCfg({ wall_color: e.target.value })}
                className="w-full h-9 bg-black border border-white/15 cursor-pointer"
              />
            </label>
            <label className="block">
              <div className="label-mono mb-1">Roof color</div>
              <input
                data-testid="renderer-roof-color"
                type="color" value={roofColor}
                onChange={(e) => updateCfg({ roof_color: e.target.value })}
                className="w-full h-9 bg-black border border-white/15 cursor-pointer"
              />
            </label>
          </div>
          {savingCfg && <div className="label-mono text-[#FFCC00]">SAVING…</div>}
        </div>

        <div className="label-mono mb-2">// LAYERS</div>
        <p className="text-xs text-neutral-500 leading-relaxed mb-4">
          Toggle individual layers to peel through the build. AUTO mode follows the phase slider; MANUAL gives you per-layer control.
        </p>
        <div className="space-y-1">
          {ALL_LAYERS.map((l) => {
            const on = !!visibleLayers[l.id];
            return (
              <label key={l.id}
                data-testid={`renderer-layer-${l.id}`}
                className={`flex items-center gap-3 p-2 border border-white/5 cursor-pointer hover:bg-white/[0.03] transition-colors ${on ? "bg-white/[0.04]" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    setAutoMode(false);
                    setLayerOverrides((o) => ({ ...o, [l.id]: e.target.checked }));
                  }}
                  className="accent-[#FFCC00]"
                />
                <span className="w-3 h-3 flex-shrink-0" style={{ background: l.color }} />
                <span className="text-sm">{l.label}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-6 label-mono mb-2">// CONTROLS</div>
        <div className="text-xs text-neutral-400 font-mono space-y-1.5 leading-relaxed">
          <div>· Left drag — orbit</div>
          <div>· Right drag — pan</div>
          <div>· Scroll — zoom</div>
          <div>· Slider — scrub phases</div>
        </div>

        <div className="mt-6 border border-[#0055FF]/40 bg-[#0055FF]/5 p-3">
          <div className="label-mono text-[#5588FF]">// PROCEDURAL</div>
          <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
            Structural framing (columns, girts, purlins, sheeting, trim) is auto-generated
            from the wall footprint with standard metal-building spacing. Edits in the CAD editor
            instantly update every layer.
          </p>
        </div>
      </aside>
    </div>
  );
}
