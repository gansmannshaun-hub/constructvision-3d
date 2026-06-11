import React, { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment } from "@react-three/drei";
import * as THREE from "three";
import { useStore } from "../store";

const WALL_HEIGHT = 8;
const SCALE = 0.1; // 1 unit blueprint = 0.1 world unit (100x100 -> 10x10)

function Wall({ start, end, thickness = 0.2 }) {
  const sx = start[0] * SCALE - 5;
  const sz = start[1] * SCALE - 5;
  const ex = end[0] * SCALE - 5;
  const ez = end[1] * SCALE - 5;
  const dx = ex - sx;
  const dz = ez - sz;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return null;
  const angle = Math.atan2(dz, dx);
  const cx = (sx + ex) / 2;
  const cz = (sz + ez) / 2;
  return (
    <mesh position={[cx, WALL_HEIGHT / 2, cz]} rotation={[0, -angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, WALL_HEIGHT, Math.max(0.1, thickness * 0.6)]} />
      <meshStandardMaterial color="#EAEAEA" roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

function Door({ pos, width = 3 }) {
  const x = pos[0] * SCALE - 5;
  const z = pos[1] * SCALE - 5;
  return (
    <mesh position={[x, 1.6, z]} castShadow>
      <boxGeometry args={[width * SCALE * 1.5, 3.2, 0.18]} />
      <meshStandardMaterial color="#FFCC00" roughness={0.4} metalness={0.2} />
    </mesh>
  );
}

function Win({ pos, width = 4 }) {
  const x = pos[0] * SCALE - 5;
  const z = pos[1] * SCALE - 5;
  return (
    <mesh position={[x, 4, z]} castShadow>
      <boxGeometry args={[width * SCALE * 1.5, 1.5, 0.12]} />
      <meshStandardMaterial color="#0066FF" emissive="#0044CC" emissiveIntensity={0.4} roughness={0.1} metalness={0.6} transparent opacity={0.85} />
    </mesh>
  );
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial color="#1A1A1A" roughness={1} />
    </mesh>
  );
}

export default function RendererTab() {
  const { blueprint } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];
  const [shaded, setShaded] = useState(true);

  const stats = useMemo(
    () => ({
      walls: walls.length,
      doors: doors.length,
      windows: windows.length,
    }),
    [walls, doors, windows]
  );

  const empty = walls.length === 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] h-full" data-testid="renderer-tab">
      <section className="relative">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm">
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

        {empty ? (
          <div className="w-full h-full bg-[#050505] flex items-center justify-center">
            <div className="text-center">
              <div className="label-mono text-neutral-500 mb-2">// NO GEOMETRY</div>
              <div className="text-neutral-600 font-mono text-sm">
                Upload a floor plan to see the 3D model rendered here.
              </div>
            </div>
          </div>
        ) : (
          <Canvas shadows camera={{ position: [10, 12, 14], fov: 50 }} className="!w-full !h-full" data-testid="renderer-canvas">
            <color attach="background" args={["#050505"]} />
            <fog attach="fog" args={["#050505", 25, 60]} />
            <ambientLight intensity={0.5} />
            <directionalLight
              position={[10, 18, 10]}
              intensity={1.4}
              castShadow
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
            />
            <Suspense fallback={null}>
              <Floor />
              <Grid
                args={[20, 20]}
                cellColor="#222"
                sectionColor="#0055FF"
                sectionThickness={1.2}
                cellThickness={0.6}
                fadeDistance={30}
                infiniteGrid
              />
              <group visible={shaded}>
                {walls.map((w) => (
                  <Wall key={w.id} start={w.start} end={w.end} thickness={w.thickness} />
                ))}
              </group>
              {!shaded &&
                walls.map((w) => (
                  <WireWall key={w.id} start={w.start} end={w.end} thickness={w.thickness} />
                ))}
              {doors.map((d) => (
                <Door key={d.id} pos={d.position} width={d.width} />
              ))}
              {windows.map((w) => (
                <Win key={w.id} pos={w.position} width={w.width} />
              ))}
            </Suspense>
            <OrbitControls makeDefault enableDamping />
          </Canvas>
        )}
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

function WireWall({ start, end, thickness = 0.2 }) {
  const sx = start[0] * SCALE - 5;
  const sz = start[1] * SCALE - 5;
  const ex = end[0] * SCALE - 5;
  const ez = end[1] * SCALE - 5;
  const dx = ex - sx;
  const dz = ez - sz;
  const length = Math.hypot(dx, dz);
  if (length < 0.001) return null;
  const angle = Math.atan2(dz, dx);
  const cx = (sx + ex) / 2;
  const cz = (sz + ez) / 2;
  return (
    <mesh position={[cx, WALL_HEIGHT / 2, cz]} rotation={[0, -angle, 0]}>
      <boxGeometry args={[length, WALL_HEIGHT, Math.max(0.1, thickness * 0.6)]} />
      <meshBasicMaterial color="#FFCC00" wireframe />
    </mesh>
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
