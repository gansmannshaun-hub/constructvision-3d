import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store";

const WALL_HEIGHT = 2.8; // architecturally sensible relative to 0-100 coord space
const SCALE = 0.1;        // 0..100 blueprint coords -> -5..5 world units (10x10 footprint)
const FLOOR_SIZE = 12;    // slightly larger than wall area

// Build a Three.js scene from blueprint data. Returns a group; caller adds to scene.
function buildModel(walls, doors, windows, shaded) {
  const group = new THREE.Group();
  group.name = "model";

  const wallMat = shaded
    ? new THREE.MeshStandardMaterial({ color: 0xeaeaea, roughness: 0.85, metalness: 0.05 })
    : new THREE.MeshBasicMaterial({ color: 0xffcc00, wireframe: true });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.4, metalness: 0.2 });
  const winMat = new THREE.MeshStandardMaterial({
    color: 0x0066ff,
    emissive: 0x0044cc,
    emissiveIntensity: 0.4,
    roughness: 0.1,
    metalness: 0.6,
    transparent: true,
    opacity: 0.85,
  });

  for (const w of walls || []) {
    if (!w.start || !w.end) continue;
    const sx = w.start[0] * SCALE - 5;
    const sz = w.start[1] * SCALE - 5;
    const ex = w.end[0] * SCALE - 5;
    const ez = w.end[1] * SCALE - 5;
    const dx = ex - sx;
    const dz = ez - sz;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) continue; // skip degenerate walls
    const angle = Math.atan2(dz, dx);
    const thickness = 0.12;
    const geom = new THREE.BoxGeometry(length, WALL_HEIGHT, thickness);
    const mesh = new THREE.Mesh(geom, wallMat);
    mesh.position.set((sx + ex) / 2, WALL_HEIGHT / 2, (sz + ez) / 2);
    mesh.rotation.y = -angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  for (const d of doors || []) {
    if (!d.position) continue;
    const x = d.position[0] * SCALE - 5;
    const z = d.position[1] * SCALE - 5;
    const w = Math.max(0.5, (d.width || 3) * SCALE * 0.6);
    const h = WALL_HEIGHT * 0.75;
    const geom = new THREE.BoxGeometry(w, h, 0.14);
    const mesh = new THREE.Mesh(geom, doorMat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  for (const wn of windows || []) {
    if (!wn.position) continue;
    const x = wn.position[0] * SCALE - 5;
    const z = wn.position[1] * SCALE - 5;
    const w = Math.max(0.5, (wn.width || 4) * SCALE * 0.6);
    const h = WALL_HEIGHT * 0.4;
    const geom = new THREE.BoxGeometry(w, h, 0.1);
    const mesh = new THREE.Mesh(geom, winMat);
    mesh.position.set(x, WALL_HEIGHT * 0.55, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  return group;
}

function buildFloor() {
  const geom = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 1 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.001;
  mesh.receiveShadow = true;
  return mesh;
}

function buildGrid() {
  const grid = new THREE.GridHelper(FLOOR_SIZE, FLOOR_SIZE * 2, 0x0055ff, 0x222222);
  grid.position.y = 0.002;
  return grid;
}

// Compute bounding box of all wall endpoints in world coords
function wallBounds(walls) {
  if (!walls || walls.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const w of walls) {
    if (!w.start || !w.end) continue;
    for (const p of [w.start, w.end]) {
      const x = p[0] * SCALE - 5;
      const z = p[1] * SCALE - 5;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const size = Math.max(maxX - minX, maxZ - minZ, 2);
  return { cx, cz, size };
}

export default function RendererTab() {
  const { blueprint } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];
  const [shaded, setShaded] = useState(true);

  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const animationRef = useRef(null);

  // One-time setup of the renderer + scene
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080808);
    scene.fog = new THREE.Fog(0x080808, 18, 45);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    camera.position.set(8, 9, 8);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(6, 12, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    scene.add(dir);
    // soft fill light from opposite side
    const fill = new THREE.DirectionalLight(0x99bbff, 0.35);
    fill.position.set(-6, 8, -4);
    scene.add(fill);

    scene.add(buildFloor());
    scene.add(buildGrid());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(0, WALL_HEIGHT / 2, 0);
    controlsRef.current = controls;

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    // Also observe container resize (tab switches)
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      // Dispose geometries/materials in scene
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    };
  }, []);

  // Rebuild model when blueprint or shading mode changes
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene) return;
    if (modelRef.current) {
      scene.remove(modelRef.current);
      modelRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      modelRef.current = null;
    }
    const model = buildModel(walls, doors, windows, shaded);
    scene.add(model);
    modelRef.current = model;

    // Auto-fit camera to wall bounds (or reset to default for empty)
    if (camera && controls) {
      const b = wallBounds(walls);
      if (b) {
        // True isometric-ish view: from above and corner so all 4 walls are visible
        const dist = Math.max(b.size * 2.2, 6);
        camera.position.set(b.cx + dist * 0.9, dist * 1.1, b.cz + dist * 0.9);
        controls.target.set(b.cx, WALL_HEIGHT * 0.4, b.cz);
      } else {
        camera.position.set(8, 9, 8);
        controls.target.set(0, WALL_HEIGHT * 0.4, 0);
      }
      controls.update();
    }
  }, [walls, doors, windows, shaded]);

  const stats = { walls: walls.length, doors: doors.length, windows: windows.length };
  const empty = walls.length === 0 && doors.length === 0 && windows.length === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] h-full" data-testid="renderer-tab">
      <section className="relative min-h-0">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm pointer-events-none">
          <div className="label-mono">// 3D MODEL</div>
          <div className="font-display text-lg tracking-tighter">Live Renderer</div>
        </div>
        <div className="absolute top-4 right-4 z-10 flex gap-1">
          <button
            data-testid="renderer-toggle-shaded"
            onClick={() => setShaded((s) => !s)}
            className="bg-black/70 border border-white/10 px-4 py-2 label-mono hover:bg-[#FFCC00] hover:text-black transition-all duration-150"
          >
            {shaded ? "SHADED" : "WIREFRAME"}
          </button>
        </div>

        {empty && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="text-center bg-black/60 px-6 py-4 border border-white/10">
              <div className="label-mono text-neutral-500 mb-2">// NO GEOMETRY</div>
              <div className="text-neutral-400 font-mono text-sm">
                Upload a floor plan or draw walls in the CAD editor.
              </div>
            </div>
          </div>
        )}

        <div
          ref={mountRef}
          data-testid="renderer-canvas-mount"
          className="w-full h-full bg-[#050505]"
        />
      </section>

      <aside className="border-l border-white/10 p-6 overflow-y-auto">
        <div className="label-mono mb-2">// MODEL STATS</div>
        <div className="border border-white/10 divide-y divide-white/10 mb-8">
          <StatRow label="Walls" v={stats.walls} />
          <StatRow label="Doors" v={stats.doors} />
          <StatRow label="Windows" v={stats.windows} />
          <StatRow label="Wall Height" v="2.8m" />
        </div>

        <div className="label-mono mb-2">// CONTROLS</div>
        <div className="text-xs text-neutral-400 font-mono space-y-2 leading-relaxed">
          <div>· Left drag — orbit</div>
          <div>· Right drag — pan</div>
          <div>· Scroll — zoom</div>
        </div>

        <div className="mt-8 border border-[#0055FF]/40 bg-[#0055FF]/5 p-4">
          <div className="label-mono text-[#5588FF]">// LIVE SYNC</div>
          <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
            This view rebuilds automatically when you upload a new blueprint or
            edit the 2D CAD canvas.
          </p>
        </div>
      </aside>
    </div>
  );
}

function StatRow({ label, v }) {
  return (
    <div className="flex items-center justify-between p-3">
      <span className="label-mono">{label}</span>
      <span className="font-mono text-lg">{v}</span>
    </div>
  );
}
