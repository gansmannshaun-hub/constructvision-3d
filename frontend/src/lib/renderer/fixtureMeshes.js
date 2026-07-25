// Low-poly fixture meshes for the 3D renderer (Session 5).
// Each factory returns a THREE.Group positioned at origin with proper Y=0
// resting on the floor slab. The caller applies position/rotation.
//
// Sizes come from the AI extraction (fixture.size = [width_ft, depth_ft]).
// Heights are kind-specific defaults since the 2D extractor doesn't
// report Z. Everything is bounded so degenerate 0-size fixtures still
// render.
import * as THREE from "three";

const SCALE = 0.3048;   // ft → meters (mirrors sceneBuilder)

function _mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.1,
    emissive: opts.emissive ?? 0,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
}

function _box(w, h, d, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function _cyl(radius, height, mat, radialSegments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), mat);
  mesh.castShadow = true;
  return mesh;
}

// Kind → primary color palette
const KIND_COLORS = {
  toilet:       "#FCFCF7",
  sink:         "#F0F0EA",
  shower:       "#DAD6CC",
  tub:          "#F5F3EC",
  vanity:       "#8B7355",
  stove:        "#3A3A3A",
  oven:         "#3A3A3A",
  refrigerator: "#D0D0D0",
  dishwasher:   "#B0B0B0",
  washer:       "#E5E5E5",
  dryer:        "#E5E5E5",
  island:       "#7A6E5F",
  counter:      "#8B7355",
  closet:       "#C4A57B",
  stairs:       "#8B5A2B",
  bed:          "#5C7A8C",
  sofa:         "#4A5C6E",
  dining_table: "#8B5A2B",
  desk:         "#8B5A2B",
  fireplace:    "#3A3A3A",
  hvac_unit:    "#666",
  water_heater: "#888",
  column:       "#555",
  other:        "#9A9A9A",
};

const KIND_HEIGHTS_FT = {
  toilet:       2.5,
  sink:         3.0,
  shower:       7.0,
  tub:          2.0,
  vanity:       3.0,
  stove:        3.0,
  oven:         6.0,
  refrigerator: 6.0,
  dishwasher:   3.0,
  washer:       3.0,
  dryer:        3.0,
  island:       3.0,
  counter:      3.0,
  closet:       7.0,
  stairs:       7.0,
  bed:          2.0,
  sofa:         2.7,
  dining_table: 2.5,
  desk:         2.5,
  fireplace:    5.0,
  hvac_unit:    3.5,
  water_heater: 5.0,
  column:       10.0,
  other:        2.5,
};

// ---------- Individual fixture builders ----------
function _makeToilet(wM, dM, hM, color) {
  const g = new THREE.Group();
  const tank = _box(wM * 0.55, hM * 0.6, dM * 0.4, _mat(color, { roughness: 0.35 }));
  tank.position.set(0, hM * 0.3, -dM * 0.3);
  g.add(tank);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(wM * 0.28, wM * 0.32, hM * 0.35, 20),
    _mat(color, { roughness: 0.35 }),
  );
  bowl.position.set(0, hM * 0.175, dM * 0.1);
  g.add(bowl);
  const seat = _box(wM * 0.6, 0.02, dM * 0.55, _mat("#2A2A2A", { roughness: 0.8 }));
  seat.position.set(0, hM * 0.35, dM * 0.05);
  g.add(seat);
  return g;
}
function _makeTub(wM, dM, hM, color) {
  const g = new THREE.Group();
  const shell = _box(wM, hM, dM, _mat(color, { roughness: 0.25 }));
  shell.position.set(0, hM / 2, 0);
  g.add(shell);
  const inset = _box(wM * 0.85, 0.05, dM * 0.75, _mat("#B0C7CC", { roughness: 0.2 }));
  inset.position.set(0, hM - 0.02, 0);
  g.add(inset);
  return g;
}
function _makeShower(wM, dM, hM, color) {
  const g = new THREE.Group();
  const base = _box(wM, 0.1, dM, _mat("#B0B0B0", { roughness: 0.9 }));
  base.position.set(0, 0.05, 0);
  g.add(base);
  // Three glass walls (transparent)
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88bbcc, transparent: true, opacity: 0.35,
    roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide,
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(wM, hM - 0.1), glassMat);
  back.position.set(0, (hM - 0.1) / 2 + 0.05, -dM / 2);
  g.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(dM, hM - 0.1), glassMat);
  left.position.set(-wM / 2, (hM - 0.1) / 2 + 0.05, 0);
  left.rotation.y = Math.PI / 2;
  g.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(dM, hM - 0.1), glassMat);
  right.position.set(wM / 2, (hM - 0.1) / 2 + 0.05, 0);
  right.rotation.y = Math.PI / 2;
  g.add(right);
  return g;
}
function _makeSink(wM, dM, hM, color) {
  const g = new THREE.Group();
  const base = _box(wM, hM, dM, _mat("#F5F1E8", { roughness: 0.4 }));
  base.position.set(0, hM / 2, 0);
  g.add(base);
  const basin = _box(wM * 0.7, 0.06, dM * 0.7, _mat("#8FA3B0", { roughness: 0.2, metalness: 0.3 }));
  basin.position.set(0, hM - 0.02, 0);
  g.add(basin);
  const faucet = _cyl(0.03, 0.3, _mat("#B0B0B0", { roughness: 0.1, metalness: 0.8 }));
  faucet.position.set(0, hM + 0.15, -dM * 0.3);
  g.add(faucet);
  return g;
}
function _makeVanity(wM, dM, hM, color) {
  const g = new THREE.Group();
  const base = _box(wM, hM * 0.9, dM, _mat(color, { roughness: 0.6 }));
  base.position.set(0, hM * 0.45, 0);
  g.add(base);
  const top = _box(wM, 0.05, dM, _mat("#3A3A3A", { roughness: 0.3, metalness: 0.4 }));
  top.position.set(0, hM * 0.9 + 0.025, 0);
  g.add(top);
  const basin = _box(wM * 0.5, 0.04, dM * 0.6, _mat("#B0B0B0", { roughness: 0.2, metalness: 0.5 }));
  basin.position.set(0, hM * 0.9 + 0.03, 0);
  g.add(basin);
  return g;
}
function _makeStove(wM, dM, hM, color) {
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.3, metalness: 0.6 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const top = _box(wM * 0.95, 0.02, dM * 0.95, _mat("#1A1A1A", { roughness: 0.15, metalness: 0.7 }));
  top.position.set(0, hM + 0.01, 0);
  g.add(top);
  // 4 burners
  const bMat = _mat("#8B0000", { roughness: 0.5 });
  const off = wM * 0.25;
  const zff = dM * 0.25;
  for (const [xx, zz] of [[-off, -zff], [off, -zff], [-off, zff], [off, zff]]) {
    const burner = new THREE.Mesh(new THREE.CylinderGeometry(wM * 0.14, wM * 0.14, 0.01, 20), bMat);
    burner.position.set(xx, hM + 0.02, zz);
    g.add(burner);
  }
  return g;
}
function _makeOven(wM, dM, hM, color) {
  // Wall-oven — taller box with a door line
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.4, metalness: 0.5 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const door = _box(wM * 0.85, hM * 0.4, 0.02, _mat("#1A1A1A", { roughness: 0.2, metalness: 0.7 }));
  door.position.set(0, hM * 0.35, dM / 2 + 0.01);
  g.add(door);
  return g;
}
function _makeFridge(wM, dM, hM, color) {
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.25, metalness: 0.6 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const seam = _box(0.02, hM * 0.95, 0.01, _mat("#606060", { roughness: 0.6 }));
  seam.position.set(0, hM / 2, dM / 2 + 0.005);
  g.add(seam);
  const handle = _box(0.03, 0.25, 0.05, _mat("#404040", { roughness: 0.3, metalness: 0.5 }));
  handle.position.set(wM * 0.35, hM * 0.7, dM / 2 + 0.03);
  g.add(handle);
  return g;
}
function _makeDishwasher(wM, dM, hM, color) {
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.35, metalness: 0.5 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const front = _box(wM * 0.9, hM * 0.85, 0.02, _mat("#909090", { roughness: 0.2, metalness: 0.7 }));
  front.position.set(0, hM * 0.45, dM / 2 + 0.01);
  g.add(front);
  return g;
}
function _makeLaundry(wM, dM, hM, color, isDryer) {
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.4, metalness: 0.4 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const drum = new THREE.Mesh(
    new THREE.CircleGeometry(Math.min(wM, hM) * 0.28, 20),
    _mat(isDryer ? "#404040" : "#88a0b0", { roughness: 0.3, metalness: 0.4 }),
  );
  drum.position.set(0, hM * 0.55, dM / 2 + 0.005);
  g.add(drum);
  return g;
}
function _makeBed(wM, dM, hM, color) {
  const g = new THREE.Group();
  const frame = _box(wM, hM * 0.4, dM, _mat("#3A2A1A", { roughness: 0.85 }));
  frame.position.set(0, hM * 0.2, 0);
  g.add(frame);
  const mattress = _box(wM * 0.95, hM * 0.5, dM * 0.98, _mat(color, { roughness: 0.9 }));
  mattress.position.set(0, hM * 0.65, 0);
  g.add(mattress);
  const pillow = _box(wM * 0.85, hM * 0.15, dM * 0.2, _mat("#FFFFFF", { roughness: 0.9 }));
  pillow.position.set(0, hM * 0.98, -dM * 0.35);
  g.add(pillow);
  return g;
}
function _makeSofa(wM, dM, hM, color) {
  const g = new THREE.Group();
  const base = _box(wM, hM * 0.45, dM, _mat(color, { roughness: 0.9 }));
  base.position.set(0, hM * 0.225, 0);
  g.add(base);
  const back = _box(wM, hM * 0.55, dM * 0.3, _mat(color, { roughness: 0.9 }));
  back.position.set(0, hM * 0.725, -dM * 0.35);
  g.add(back);
  return g;
}
function _makeTable(wM, dM, hM, color) {
  const g = new THREE.Group();
  const top = _box(wM, 0.05, dM, _mat(color, { roughness: 0.6 }));
  top.position.set(0, hM - 0.025, 0);
  g.add(top);
  // 4 legs
  const legMat = _mat(color, { roughness: 0.7 });
  const legH = hM - 0.05;
  const off = { x: wM * 0.45, z: dM * 0.45 };
  for (const [x, z] of [[-off.x, -off.z], [off.x, -off.z], [-off.x, off.z], [off.x, off.z]]) {
    const leg = _box(0.06, legH, 0.06, legMat);
    leg.position.set(x, legH / 2, z);
    g.add(leg);
  }
  return g;
}
function _makeFireplace(wM, dM, hM, color) {
  const g = new THREE.Group();
  const body = _box(wM, hM, dM, _mat(color, { roughness: 0.9 }));
  body.position.set(0, hM / 2, 0);
  g.add(body);
  const opening = _box(wM * 0.55, hM * 0.4, 0.05, _mat("#000000", { roughness: 1 }));
  opening.position.set(0, hM * 0.3, dM / 2 + 0.01);
  g.add(opening);
  const mantle = _box(wM * 1.05, 0.08, dM * 0.3, _mat("#8B5A2B", { roughness: 0.85 }));
  mantle.position.set(0, hM * 0.55, dM / 2);
  g.add(mantle);
  return g;
}
function _makeGeneric(wM, dM, hM, color) {
  const g = new THREE.Group();
  const box = _box(wM, hM, dM, _mat(color, { roughness: 0.6 }));
  box.position.set(0, hM / 2, 0);
  g.add(box);
  return g;
}
function _makeColumn(wM, dM, hM, color) {
  const g = new THREE.Group();
  const col = _cyl(Math.min(wM, dM) * 0.4, hM, _mat(color, { roughness: 0.7 }), 12);
  col.position.set(0, hM / 2, 0);
  g.add(col);
  return g;
}
function _makeStairs(wM, dM, hM, color) {
  const g = new THREE.Group();
  const stepCount = Math.max(6, Math.min(14, Math.floor(dM / 0.28)));
  const stepH = hM / stepCount;
  const stepD = dM / stepCount;
  const mat = _mat(color, { roughness: 0.75 });
  for (let i = 0; i < stepCount; i++) {
    const step = _box(wM, stepH * (i + 1), stepD, mat);
    step.position.set(0, (stepH * (i + 1)) / 2, -dM / 2 + stepD * (i + 0.5));
    g.add(step);
  }
  return g;
}

const KIND_BUILDERS = {
  toilet: _makeToilet,
  tub: _makeTub,
  shower: _makeShower,
  sink: _makeSink,
  vanity: _makeVanity,
  stove: _makeStove,
  oven: _makeOven,
  refrigerator: _makeFridge,
  dishwasher: _makeDishwasher,
  washer: (w, d, h, c) => _makeLaundry(w, d, h, c, false),
  dryer: (w, d, h, c) => _makeLaundry(w, d, h, c, true),
  island: _makeGeneric,
  counter: _makeGeneric,
  closet: _makeGeneric,
  stairs: _makeStairs,
  bed: _makeBed,
  sofa: _makeSofa,
  dining_table: _makeTable,
  desk: _makeTable,
  fireplace: _makeFireplace,
  hvac_unit: _makeGeneric,
  water_heater: (w, d, h, c) => _makeGeneric(w, d, h, c),
  column: _makeColumn,
  other: _makeGeneric,
};

/**
 * Build a Group representing a single fixture.
 * @param {Object} f - {kind, position, rotation_deg, size:[w,d]}
 * @returns THREE.Group with children castShadow-ready. Y=0 at floor.
 */
export function buildFixtureGroup(f) {
  const kind = String(f.kind || "other").toLowerCase();
  const [wFt = 2, dFt = 2] = Array.isArray(f.size) ? f.size : [2, 2];
  const hFt = KIND_HEIGHTS_FT[kind] ?? 2.5;
  const wM = Math.max(0.3, wFt * SCALE);
  const dM = Math.max(0.3, dFt * SCALE);
  const hM = hFt * SCALE;
  const color = KIND_COLORS[kind] || KIND_COLORS.other;
  const builder = KIND_BUILDERS[kind] || _makeGeneric;
  const group = builder(wM, dM, hM, color);
  group.userData.kind = kind;
  group.userData.size_ft = [wFt, dFt];
  group.userData.height_ft = hFt;
  return group;
}

export const FIXTURE_KINDS = Object.keys(KIND_BUILDERS);
