import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store";

const WALL_HEIGHT = 3.0;       // m
const SCALE = 0.1;             // blueprint 0-100 -> world -5..5 (10m)
const SLAB_THICK = 0.18;
const FOOTING_DEPTH = 0.45;
const EAVE_OVERHANG = 0.3;
const ROOF_PITCH_DEG = 12;     // shallow gable pitch
const COLUMN_SIZE = 0.18;
const GIRT_SIZE = 0.12;
const GIRT_HEIGHTS = [0.6, 1.5, 2.4];
const PURLIN_SPACING = 1.2;
const PURLIN_SIZE = 0.12;
const PANEL_THICKNESS = 0.04;
const TRIM_THICKNESS = 0.06;
const COLUMN_MAX_SPACING = 4.0;

const PHASES = [
  { id: 0,  label: "Site",        layers: ["excavation"] },
  { id: 1,  label: "Foundation",  layers: ["excavation", "foundation"] },
  { id: 2,  label: "Columns",     layers: ["foundation", "columns"] },
  { id: 3,  label: "Frame",       layers: ["foundation", "columns", "frame"] },
  { id: 4,  label: "Wall Girts",  layers: ["foundation", "columns", "frame", "girts"] },
  { id: 5,  label: "Roof Purlins",layers: ["foundation", "columns", "frame", "girts", "purlins"] },
  { id: 6,  label: "Roof Sheet",  layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet"] },
  { id: 7,  label: "Wall Sheet",  layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet"] },
  { id: 8,  label: "Openings",    layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet", "openings"] },
  { id: 9,  label: "Trim",        layers: ["foundation", "columns", "frame", "girts", "purlins", "roofSheet", "wallSheet", "openings", "trim"] },
  { id: 10, label: "Finished",    layers: ["foundation", "wallSheet", "roofSheet", "openings", "trim"] },
];

const ALL_LAYERS = [
  { id: "excavation", label: "Excavation",   color: "#5C3A1E" },
  { id: "foundation", label: "Foundation",   color: "#B0B0B0" },
  { id: "columns",    label: "Columns",      color: "#444444" },
  { id: "frame",      label: "Primary Frame",color: "#555555" },
  { id: "girts",      label: "Wall Girts",   color: "#8C9499" },
  { id: "purlins",    label: "Roof Purlins", color: "#8C9499" },
  { id: "roofSheet",  label: "Roof Sheeting",color: "#4A5C6E" },
  { id: "wallSheet",  label: "Wall Sheeting",color: "#D8D4CC" },
  { id: "openings",   label: "Doors & Windows", color: "#FFCC00" },
  { id: "trim",       label: "Trim & Flashing", color: "#FFFFFF" },
];

// ---------- Coord helpers ----------
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
  // Eave beams (horizontal beams along the top of each wall)
  for (const w of walls) {
    const s = wallSegment(w);
    if (!s) continue;
    const beam = makeBox(s.length, 0.22, 0.18, "#444", { roughness: 0.4, metalness: 0.85 });
    beam.position.set(s.cx, WALL_HEIGHT + SLAB_THICK - 0.11, s.cz);
    beam.rotation.y = -s.angle;
    g.add(beam);
  }
  // Ridge beam along longer axis
  const ridgeAlongX = aabb.w >= aabb.d;
  const pitchH = Math.tan(THREE.MathUtils.degToRad(ROOF_PITCH_DEG)) * (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  const ridgeY = WALL_HEIGHT + SLAB_THICK + pitchH;
  const ridgeLen = ridgeAlongX ? aabb.w : aabb.d;
  const ridge = makeBox(ridgeLen, 0.2, 0.2, "#444", { roughness: 0.4, metalness: 0.85 });
  ridge.position.set(aabb.cx, ridgeY, aabb.cz);
  if (!ridgeAlongX) ridge.rotation.y = Math.PI / 2;
  g.add(ridge);
  // Rafters: from eave to ridge, spaced
  const rafterCount = Math.max(2, Math.floor(ridgeLen / 2.0));
  for (let i = 0; i <= rafterCount; i++) {
    const t = rafterCount === 0 ? 0 : i / rafterCount;
    if (ridgeAlongX) {
      const x = aabb.minX + t * aabb.w;
      // two rafters per slice (left & right slopes)
      [aabb.minZ, aabb.maxZ].forEach((zEnd) => {
        const dz = aabb.cz - zEnd;
        const len = Math.hypot(dz, pitchH);
        const r = makeBox(len, 0.14, 0.18, "#555", { roughness: 0.5, metalness: 0.85 });
        r.position.set(x, (WALL_HEIGHT + SLAB_THICK + ridgeY) / 2, (zEnd + aabb.cz) / 2);
        r.rotation.x = Math.atan2(pitchH, dz);
        g.add(r);
      });
    } else {
      const z = aabb.minZ + t * aabb.d;
      [aabb.minX, aabb.maxX].forEach((xEnd) => {
        const dx = aabb.cx - xEnd;
        const len = Math.hypot(dx, pitchH);
        const r = makeBox(len, 0.14, 0.18, "#555", { roughness: 0.5, metalness: 0.85 });
        r.position.set((xEnd + aabb.cx) / 2, (WALL_HEIGHT + SLAB_THICK + ridgeY) / 2, z);
        r.rotation.z = -Math.atan2(pitchH, dx);
        g.add(r);
      });
    }
  }
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
  if (!aabb) return g;
  const ridgeAlongX = aabb.w >= aabb.d;
  const pitchH = Math.tan(THREE.MathUtils.degToRad(ROOF_PITCH_DEG)) * (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  const ridgeY = WALL_HEIGHT + SLAB_THICK + pitchH;
  const sideLen = ridgeAlongX ? aabb.w + EAVE_OVERHANG * 2 : aabb.d + EAVE_OVERHANG * 2;
  const slopeRun = ridgeAlongX ? aabb.d / 2 : aabb.w / 2;
  const slopeLen = Math.hypot(slopeRun, pitchH);
  const purlinCount = Math.max(2, Math.floor(slopeLen / PURLIN_SPACING));
  for (let i = 0; i <= purlinCount; i++) {
    const t = purlinCount === 0 ? 0 : i / purlinCount;
    const yAtSlope = WALL_HEIGHT + SLAB_THICK + pitchH * (1 - t);
    const offRun = slopeRun * t;
    if (ridgeAlongX) {
      [-1, 1].forEach((side) => {
        const p = makeBox(sideLen, PURLIN_SIZE, PURLIN_SIZE, "#A4ACB0", { roughness: 0.4, metalness: 0.85 });
        p.position.set(aabb.cx, yAtSlope, aabb.cz + side * offRun);
        g.add(p);
      });
    } else {
      [-1, 1].forEach((side) => {
        const p = makeBox(PURLIN_SIZE, PURLIN_SIZE, sideLen, "#A4ACB0", { roughness: 0.4, metalness: 0.85 });
        p.position.set(aabb.cx + side * offRun, yAtSlope, aabb.cz);
        g.add(p);
      });
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
    const panel = makeBox(s.length, WALL_HEIGHT, PANEL_THICKNESS, "#D8D4CC", { roughness: 0.5, metalness: 0.6 });
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
  const ridgeAlongX = aabb.w >= aabb.d;
  const pitchH = Math.tan(THREE.MathUtils.degToRad(ROOF_PITCH_DEG)) * (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  const slopeRun = ridgeAlongX ? aabb.d / 2 : aabb.w / 2;
  const slopeLen = Math.hypot(slopeRun, pitchH);
  const sideLen = (ridgeAlongX ? aabb.w : aabb.d) + EAVE_OVERHANG * 2;
  for (const side of [-1, 1]) {
    const panel = makeBox(sideLen, PANEL_THICKNESS, slopeLen + EAVE_OVERHANG * 2, "#4A5C6E", { roughness: 0.4, metalness: 0.7 });
    const midY = WALL_HEIGHT + SLAB_THICK + pitchH / 2;
    if (ridgeAlongX) {
      panel.position.set(aabb.cx, midY, aabb.cz + side * slopeRun / 2);
      panel.rotation.x = side * Math.atan2(pitchH, slopeRun);
    } else {
      panel.position.set(aabb.cx + side * slopeRun / 2, midY, aabb.cz);
      panel.rotation.z = -side * Math.atan2(pitchH, slopeRun);
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
  const ridgeAlongX = aabb.w >= aabb.d;
  const pitchH = Math.tan(THREE.MathUtils.degToRad(ROOF_PITCH_DEG)) * (ridgeAlongX ? aabb.d / 2 : aabb.w / 2);
  const ridge = makeBox(ridgeAlongX ? aabb.w + 0.4 : 0.25, 0.08, ridgeAlongX ? 0.25 : aabb.d + 0.4, "#FFFFFF", { roughness: 0.3, metalness: 0.4 });
  ridge.position.set(aabb.cx, WALL_HEIGHT + SLAB_THICK + pitchH + 0.05, aabb.cz);
  g.add(ridge);
  return g;
}

// ---------- React component ----------
export default function RendererTab() {
  const { blueprint } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];

  const [phase, setPhase] = useState(10);
  const [layerOverrides, setLayerOverrides] = useState({}); // {layerId: true/false}
  const [autoMode, setAutoMode] = useState(true);

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

  // 2) Rebuild all groups when walls/doors/windows change
  useEffect(() => {
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
      excavation: () => buildExcavation(aabb),
      foundation: () => buildFoundation(aabb, walls),
      columns:    () => buildColumns(walls),
      frame:      () => buildFrame(walls, aabb),
      girts:      () => buildGirts(walls),
      purlins:    () => buildPurlins(aabb),
      roofSheet:  () => buildRoofSheeting(aabb),
      wallSheet:  () => buildWallSheeting(walls, doors, windows),
      openings:   () => buildOpenings(walls, doors, windows),
      trim:       () => buildTrim(walls, aabb),
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
            <div className="label-mono text-[#FFCC00]">// PHASE {phase} / 10 · {PHASES[phase].label}</div>
            <div className="flex items-center gap-2">
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
                onClick={() => { setPhase((p) => Math.min(10, p + 1)); setAutoMode(true); }}
                className="label-mono px-2 py-1 border border-white/20 hover:bg-white/10"
                disabled={phase === 10}
              >
                ▶
              </button>
            </div>
          </div>
          <input
            data-testid="renderer-phase-slider"
            type="range"
            min={0}
            max={10}
            value={phase}
            onChange={(e) => { setPhase(Number(e.target.value)); setAutoMode(true); }}
            className="w-full accent-[#FFCC00]"
          />
          <div className="flex justify-between mt-1 text-[10px] font-mono text-neutral-500">
            {PHASES.map((p) => (
              <span key={p.id} className={p.id === phase ? "text-[#FFCC00]" : ""}>{p.label.slice(0, 6)}</span>
            ))}
          </div>
        </div>
      </section>

      <aside className="border-l border-white/10 p-5 overflow-y-auto">
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
