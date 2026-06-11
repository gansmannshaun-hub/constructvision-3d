import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../store";

const WALL_HEIGHT = 8;
const SCALE = 0.1;

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
    if (length < 0.001) continue;
    const angle = Math.atan2(dz, dx);
    const thickness = Math.max(0.1, (w.thickness || 0.2) * 0.6);
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
    const w = (d.width || 3) * SCALE * 1.5;
    const geom = new THREE.BoxGeometry(w, 3.2, 0.18);
    const mesh = new THREE.Mesh(geom, doorMat);
    mesh.position.set(x, 1.6, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  for (const wn of windows || []) {
    if (!wn.position) continue;
    const x = wn.position[0] * SCALE - 5;
    const z = wn.position[1] * SCALE - 5;
    const w = (wn.width || 4) * SCALE * 1.5;
    const geom = new THREE.BoxGeometry(w, 1.5, 0.12);
    const mesh = new THREE.Mesh(geom, winMat);
    mesh.position.set(x, 4, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  return group;
}

function buildFloor() {
  const geom = new THREE.PlaneGeometry(20, 20);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function buildGrid() {
  const grid = new THREE.GridHelper(40, 40, 0x0055ff, 0x222222);
  grid.position.y = 0.001;
  return grid;
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
    scene.background = new THREE.Color(0x050505);
    scene.fog = new THREE.Fog(0x050505, 25, 60);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
    camera.position.set(10, 12, 14);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(10, 18, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    scene.add(dir);

    scene.add(buildFloor());
    scene.add(buildGrid());

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);
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
          <StatRow label="Wall Height" v={`${WALL_HEIGHT} ft`} />
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
