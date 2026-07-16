/* Public read-only project view. No auth required. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { formatFeetInches, wallsAabb } from "@/lib/dim";
import {
  createSceneEngine,
  ALL_LAYERS,
  PHASES,
  MAX_PHASE,
  DEFAULT_CFG,
} from "@/lib/renderer/sceneBuilder";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function SharedProject() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("3d");

  useEffect(() => {
    axios.get(`${API}/share/${token}`)
      .then((r) => setData(r.data))
      .catch(() => setError("This link is invalid or has been revoked."));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="label-mono text-[#FF6666] mb-2">// LINK UNAVAILABLE</div>
          <h1 className="font-display text-3xl mb-3">{error}</h1>
          <p className="text-neutral-400 text-sm">
            Ask the project owner for a new share link.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="font-mono text-sm text-neutral-500 animate-pulse">// LOADING SHARED PROJECT…</div>
      </div>
    );
  }

  const { project, owner, blueprint, materials, grand_total, branding } = data;
  const accent = branding?.accent_color || "#0055FF";
  const csvUrl = `${API}/share/${token}/takeoff.csv`;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-baseline gap-4 min-w-0">
          {branding?.logo_data_url ? (
            <img src={branding.logo_data_url} alt={branding?.company_name || "Logo"} className="h-9 object-contain" />
          ) : (
            <div className="font-display text-2xl tracking-tighter">ATLAS</div>
          )}
          {branding?.company_name && (
            <div className="font-display text-lg tracking-tighter truncate" style={{ color: accent }}>
              {branding.company_name}
            </div>
          )}
          <div className="hidden md:block label-mono text-neutral-500">// SHARED&nbsp;PROJECT</div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={csvUrl}
            data-testid="shared-download-csv"
            className="border bg-opacity-10 px-3 py-2 text-xs uppercase tracking-wider font-bold"
            style={{ borderColor: `${accent}66`, color: accent, backgroundColor: `${accent}1a` }}
          >
            Download CSV
          </a>
          <span className="label-mono text-neutral-500 text-xs">
            Prepared by <span className="text-white">{owner.name || owner.email || "—"}</span>
          </span>
        </div>
      </header>

      {branding?.tagline && (
        <div className="border-b border-white/10 px-6 py-3 text-sm text-neutral-300 italic" style={{ borderLeft: `4px solid ${accent}` }}>
          {branding.tagline}
        </div>
      )}

      {/* Project title block */}
      <section className="px-6 py-8 border-b border-white/10 grid md:grid-cols-3 gap-6 items-end">
        <div className="md:col-span-2 min-w-0">
          <div className="label-mono mb-2">// PROJECT</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tighter mb-2 truncate" data-testid="shared-project-name">
            {project.name}
          </h1>
          {project.description && (
            <p className="text-neutral-400 text-sm leading-relaxed">{project.description}</p>
          )}
        </div>
        <div className="border border-[#0055FF]/40 bg-[#0055FF]/10 p-5">
          <div className="label-mono text-[#5588FF] mb-1">// PROJECT COST</div>
          <div className="font-display text-3xl text-[#5588FF] tracking-tighter" data-testid="shared-grand-total">
            ${grand_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-neutral-400 mt-2">
            {materials.length} line items · {new Set(materials.map((m) => m.category)).size} categories
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="border-b border-white/10 flex px-6">
        {[
          { id: "3d", label: "3D Model" },
          { id: "plan", label: "Blueprint" },
          { id: "mats", label: "Materials" },
        ].map((t) => (
          <button
            key={t.id}
            data-testid={`shared-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-5 py-3 label-mono border-b-2 transition-colors ${tab === t.id ? "border-[#FFCC00] text-[#FFCC00]" : "border-transparent text-neutral-500 hover:text-white"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="min-h-[60vh]">
        {tab === "3d" && <Shared3D blueprint={blueprint} />}
        {tab === "plan" && <SharedBlueprint blueprint={blueprint} />}
        {tab === "mats" && <SharedMaterials materials={materials} grand_total={grand_total} />}
      </main>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-xs font-mono text-neutral-500">
        Built with <span className="text-[#FFCC00]">Atlas Construction OS</span> —
        <a href="/" className="ml-1 text-white hover:text-[#FFCC00]">atlas.app</a>
      </footer>
    </div>
  );
}

/* ─── 3D Renderer (slim, no MANUAL toggle) ───────────────────── */
function Shared3D({ blueprint }) {
  const mountRef = useRef(null);
  const engineRef = useRef(null);
  const [phase, setPhase] = useState(MAX_PHASE);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = createSceneEngine(mountRef.current);
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.build({
      walls: blueprint.walls,
      doors: blueprint.doors,
      windows: blueprint.windows,
      roof_type: blueprint.roof_type || DEFAULT_CFG.roof_type,
      roof_pitch_deg: blueprint.roof_pitch_deg ?? DEFAULT_CFG.roof_pitch_deg,
      wall_color: blueprint.wall_color || DEFAULT_CFG.wall_color,
      roof_color: blueprint.roof_color || DEFAULT_CFG.roof_color,
    });
  }, [blueprint]);

  useEffect(() => {
    if (!engineRef.current) return;
    const set = new Set(PHASES[phase].layers);
    const map = Object.fromEntries(ALL_LAYERS.map((l) => [l.id, set.has(l.id)]));
    engineRef.current.setVisibility(map);
  }, [phase]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPhase((p) => { if (p >= MAX_PHASE) { setPlaying(false); return MAX_PHASE; } return p + 1; });
    }, 850);
    return () => clearInterval(t);
  }, [playing]);

  const empty = !blueprint.walls?.length;

  return (
    <div className="relative h-[70vh] min-h-[480px]">
      <div ref={mountRef} data-testid="shared-3d-canvas" className="w-full h-full bg-[#f5f5f5]" />
      {empty && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/60 px-6 py-4 border border-white/10 text-center">
            <div className="label-mono text-neutral-500 mb-1">// NO GEOMETRY</div>
            <div className="text-sm text-neutral-400 font-mono">This project has no blueprint yet.</div>
          </div>
        </div>
      )}
      {!empty && (
        <div className="absolute bottom-3 left-3 right-3 bg-black/80 border border-white/10 backdrop-blur-sm p-3 z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="label-mono text-[#FFCC00]">// PHASE {phase} / {MAX_PHASE} · {PHASES[phase].label}</div>
            <button
              data-testid="shared-3d-play"
              onClick={() => {
                if (!playing && phase >= MAX_PHASE) setPhase(0);
                setPlaying((p) => !p);
              }}
              className={`label-mono px-3 py-1 border ${playing ? "bg-[#FF3333] text-white border-[#FF3333]" : "bg-[#00CC66] text-black border-[#00CC66]"}`}
            >
              {playing ? "■ STOP" : "▶ PLAY"}
            </button>
          </div>
          <input
            data-testid="shared-3d-slider"
            type="range" min={0} max={MAX_PHASE} value={phase}
            onChange={(e) => setPhase(Number(e.target.value))}
            className="w-full accent-[#FFCC00]"
          />
        </div>
      )}
    </div>
  );
}

/* ─── Blueprint (read-only SVG) ──────────────────────────────── */
function SharedBlueprint({ blueprint }) {
  const walls = blueprint.walls || [];
  const aabb = useMemo(() => wallsAabb(walls), [walls]);
  const VB_PAD = 8;
  const vbMin = -VB_PAD;
  const vbSize = 100 + VB_PAD * 2;

  if (!walls.length) {
    return (
      <div className="h-[60vh] flex items-center justify-center text-neutral-500 font-mono text-sm">
        No blueprint geometry available.
      </div>
    );
  }
  return (
    <div className="p-4 h-[70vh]">
      <div className="w-full h-full blueprint-canvas-bg relative">
        <svg viewBox={`${vbMin} ${vbMin} ${vbSize} ${vbSize}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
          {walls.map((w) => (
            <line key={w.id} x1={w.start[0]} y1={w.start[1]} x2={w.end[0]} y2={w.end[1]}
              stroke="#FFFFFF" strokeWidth={Math.max(0.4, (w.thickness || 0.2) * 2)} strokeLinecap="square" />
          ))}
          {(blueprint.doors || []).map((d) => (
            <circle key={d.id} cx={d.position[0]} cy={d.position[1]} r={(d.width || 3) / 4}
              fill="#FFCC00" stroke="#FFCC00" strokeWidth="0.3" />
          ))}
          {(blueprint.windows || []).map((w) => (
            <rect key={w.id} x={w.position[0] - (w.width || 4) / 2} y={w.position[1] - 0.4}
              width={w.width || 4} height={0.8} fill="#0055FF" />
          ))}
          {walls.map((w) => {
            const dx = w.end[0] - w.start[0]; const dy = w.end[1] - w.start[1];
            const len = Math.hypot(dx, dy); if (len < 1) return null;
            const mx = (w.start[0] + w.end[0]) / 2; const my = (w.start[1] + w.end[1]) / 2;
            const nx = -dy / len, ny = dx / len; const off = 1.8;
            const tx = mx + nx * off, ty = my + ny * off;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            const flip = angle > 90 || angle < -90 ? 180 : 0;
            return (
              <g key={`d-${w.id}`} pointerEvents="none">
                <text x={tx} y={ty} fontSize="1.6" fill="#7AB8FF" textAnchor="middle"
                  transform={`rotate(${angle + flip}, ${tx}, ${ty})`}
                  fontFamily="IBM Plex Mono, monospace" fontWeight="600">{formatFeetInches(len)}</text>
              </g>
            );
          })}
          {aabb && (
            <>
              <line x1={aabb.minX} y1={aabb.minY - 5.5} x2={aabb.maxX} y2={aabb.minY - 5.5} stroke="#FF6600" strokeWidth="0.14" />
              <text x={(aabb.minX + aabb.maxX) / 2} y={aabb.minY - 6.6} fontSize="2.4" fill="#FF6600" textAnchor="middle"
                fontFamily="IBM Plex Mono, monospace" fontWeight="700">{formatFeetInches(aabb.w)}</text>
              <line x1={aabb.minX - 5.5} y1={aabb.minY} x2={aabb.minX - 5.5} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.14" />
              <text x={aabb.minX - 6.6} y={(aabb.minY + aabb.maxY) / 2} fontSize="2.4" fill="#FF6600" textAnchor="middle"
                transform={`rotate(-90, ${aabb.minX - 6.6}, ${(aabb.minY + aabb.maxY) / 2})`}
                fontFamily="IBM Plex Mono, monospace" fontWeight="700">{formatFeetInches(aabb.h)}</text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

/* ─── Materials table ────────────────────────────────────────── */
function SharedMaterials({ materials, grand_total }) {
  const categories = useMemo(() => {
    const g = {};
    for (const m of materials) {
      const cat = m.category || "Other";
      (g[cat] = g[cat] || []).push(m);
    }
    return Object.keys(g).sort().map((cat) => ({
      name: cat,
      items: g[cat],
      subtotal: g[cat].reduce((s, m) => s + (m.quantity || 0) * (m.unit_price || 0), 0),
    }));
  }, [materials]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {categories.map(({ name: cat, items, subtotal }) => {
        return (
          <section key={cat} className="mb-8" data-testid={`shared-cat-${cat}`}>
            <h3 className="font-display text-xl mb-2 flex items-baseline justify-between gap-4">
              <span>{cat}</span>
              <span className="text-sm text-neutral-500 font-mono">{items.length} items · ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-neutral-500 label-mono">
                  <th className="py-2 pr-4">Material</th>
                  <th className="py-2 pr-4 text-right">Qty</th>
                  <th className="py-2 pr-4">Unit</th>
                  <th className="py-2 pr-4 text-right">Unit $</th>
                  <th className="py-2 pr-2 text-right">Line $</th>
                  <th className="py-2 pl-2 text-center w-12">Src</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const qty = m.quantity || 0; const price = m.unit_price || 0; const line = qty * price;
                  const src = m.auto_computed ? "AUTO" : (m.ai_extracted ? "AI" : "");
                  return (
                    <tr key={m.id || `${m.name}-${m.category}`} className="border-b border-white/5">
                      <td className="py-2 pr-4">{m.name}</td>
                      <td className="py-2 pr-4 text-right font-mono">{qty}</td>
                      <td className="py-2 pr-4 font-mono text-neutral-400">{m.unit}</td>
                      <td className="py-2 pr-4 text-right font-mono">${price.toFixed(2)}</td>
                      <td className="py-2 pr-2 text-right font-mono">${line.toFixed(2)}</td>
                      <td className={`py-2 pl-2 text-center font-mono text-xs font-bold ${src === "AUTO" ? "text-[#FF6600]" : src === "AI" ? "text-[#5588FF]" : "text-neutral-600"}`}>{src}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      <div className="border-t-2 border-[#0055FF] pt-4 mt-8 flex items-baseline justify-between">
        <div className="font-display text-2xl">GRAND TOTAL</div>
        <div className="font-display text-3xl text-[#5588FF]">
          ${grand_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
    </div>
  );
}
