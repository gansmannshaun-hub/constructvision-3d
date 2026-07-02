import React, { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { formatFeetInches, wallsAabb } from "../lib/dim";
import { SheetTabBar } from "./SheetTabBar";

/** Read-only blueprint view: draws walls/doors/windows on the blueprint grid */
export default function BlueprintTab() {
  const { blueprint, documents, createSheet, renameSheet, deleteSheet,
          activateSheet, fetchDocumentImage } = useStore();
  const sheets = blueprint?.sheets || [];
  const activeSheetId = blueprint?.active_sheet_id;
  const activeSheet = sheets.find((s) => s.id === activeSheetId) || null;
  const walls = blueprint?.walls || [];
  const doors = blueprint?.doors || [];
  const windows = blueprint?.windows || [];

  const [underlayUrl, setUnderlayUrl] = useState(null);
  const [underlayOpacity, setUnderlayOpacity] = useState(0.65);
  useEffect(() => {
    let cancelled = false;
    const docId = activeSheet?.source_document_id;
    if (!docId) { setUnderlayUrl(null); return; }
    (async () => {
      const url = await fetchDocumentImage(docId);
      if (!cancelled) setUnderlayUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeSheet?.source_document_id, fetchDocumentImage]);

  const [showDimensions, setShowDimensions] = useState(true);

  const lastSourceDoc = useMemo(() => {
    const id = blueprint?.last_source_document_id;
    if (!id) return null;
    return documents.find((d) => d.id === id) || null;
  }, [blueprint, documents]);

  const aabb = useMemo(() => wallsAabb(walls), [walls]);

  // Expand SVG viewBox to accommodate outer dimension chains
  const VB_PAD = 8;
  const vbMin = -VB_PAD;
  const vbSize = 100 + VB_PAD * 2;

  return (
    <div className="flex flex-col h-full" data-testid="blueprint-tab">
      <SheetTabBar
        sheets={sheets}
        activeSheetId={activeSheetId}
        dirty={false}
        onActivate={activateSheet}
        onCreate={async () => {
          const name = window.prompt("New sheet name:", `Sheet ${sheets.length + 1}`);
          if (!name || !name.trim()) return;
          const fl = parseInt(window.prompt("Floor level (0 = ground, 1 = 2nd floor, -1 = basement):", "0"), 10) || 0;
          const s = await createSheet({ name: name.trim(), floor_level: fl });
          if (s) await activateSheet(s.id);
        }}
        onRename={async (id, currentName) => {
          const name = window.prompt("Rename sheet:", currentName);
          if (name && name.trim() && name !== currentName) await renameSheet(id, { name: name.trim() });
        }}
        onDelete={async (id, name) => {
          if (sheets.length <= 1) { alert("You must keep at least one sheet."); return; }
          if (!window.confirm(`Delete sheet "${name}"? This cannot be undone.`)) return;
          await deleteSheet(id);
        }}
        onChangeFloor={async (id, currentFloor) => {
          const raw = window.prompt("Floor level (-5..50):", String(currentFloor));
          if (raw === null) return;
          const n = parseInt(raw, 10);
          if (Number.isFinite(n)) await renameSheet(id, { floor_level: n });
        }}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] flex-1 min-h-0">
      <section className="relative flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-baseline justify-between">
          <div>
            <div className="label-mono">// VIEW</div>
            <h2 className="font-display text-2xl tracking-tighter">Live Blueprint</h2>
          </div>
          <div className="flex items-center gap-4">
            <button
              data-testid="blueprint-dims-toggle"
              onClick={() => setShowDimensions((d) => !d)}
              className={`label-mono px-2 py-1 border ${showDimensions ? "bg-[#FF6600] text-black border-[#FF6600]" : "border-white/20 hover:bg-white/10"}`}
            >DIMS {showDimensions ? "ON" : "OFF"}</button>
            <div className="label-mono">
              {walls.length} walls · {doors.length} doors · {windows.length} windows
              {aabb && showDimensions && (
                <span className="text-[#FF6600] ml-3">
                  {formatFeetInches(aabb.w)} × {formatFeetInches(aabb.h)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 p-4 min-h-0">
          <div className="w-full h-full blueprint-canvas-bg relative">
            {underlayUrl && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-black/70 border border-white/20 rounded px-2 py-1 text-white text-[10px] font-mono uppercase tracking-wider">
                <span>UNDERLAY</span>
                <input
                  data-testid="blueprint-underlay-opacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={underlayOpacity}
                  onChange={(e) => setUnderlayOpacity(parseFloat(e.target.value))}
                  className="w-24 accent-[#FFCC00]"
                />
                <span className="tabular-nums w-9 text-right">{Math.round(underlayOpacity * 100)}%</span>
              </div>
            )}
            {walls.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-blue-200/40 font-mono">
                  <div className="label-mono text-blue-200/60 mb-2">// AWAITING ANALYSIS</div>
                  <div>Upload a blueprint to populate this view.</div>
                </div>
              </div>
            ) : (
              <svg viewBox={`${vbMin} ${vbMin} ${vbSize} ${vbSize}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" data-testid="blueprint-svg">
                {/* Blueprint underlay */}
                {underlayUrl && (() => {
                  const bf = activeSheet?.building_ft;
                  let x = 0, y = 0, w = 0, h = 0;
                  if (bf?.w > 0 && bf?.h > 0) {
                    w = bf.w; h = bf.h;
                  } else if (aabb) {
                    x = aabb.minX; y = aabb.minY; w = aabb.w; h = aabb.h;
                  }
                  if (w <= 0 || h <= 0) return null;
                  return (
                    <image
                      data-testid="blueprint-underlay"
                      href={underlayUrl}
                      x={x} y={y} width={w} height={h}
                      preserveAspectRatio="none"
                      opacity={underlayOpacity}
                    />
                  );
                })()}
                {/* Walls */}
                {walls.map((w) => (
                  <line
                    key={w.id}
                    x1={w.start[0]}
                    y1={w.start[1]}
                    x2={w.end[0]}
                    y2={w.end[1]}
                    stroke="#FFFFFF"
                    strokeWidth={Math.max(0.4, (w.thickness || 0.2) * 2)}
                    strokeLinecap="square"
                  />
                ))}
                {/* Doors */}
                {doors.map((d) => (
                  <circle
                    key={d.id}
                    cx={d.position[0]}
                    cy={d.position[1]}
                    r={(d.width || 3) / 4}
                    fill="#FFCC00"
                    stroke="#FFCC00"
                    strokeWidth="0.3"
                  />
                ))}
                {/* Windows */}
                {windows.map((w) => (
                  <rect
                    key={w.id}
                    x={w.position[0] - (w.width || 4) / 2}
                    y={w.position[1] - 0.4}
                    width={w.width || 4}
                    height={0.8}
                    fill="#0055FF"
                  />
                ))}

                {/* Per-wall dimensions */}
                {showDimensions && walls.map((w) => {
                  if (!w.start || !w.end) return null;
                  const dx = w.end[0] - w.start[0];
                  const dy = w.end[1] - w.start[1];
                  const len = Math.hypot(dx, dy);
                  if (len < 1) return null;
                  const mx = (w.start[0] + w.end[0]) / 2;
                  const my = (w.start[1] + w.end[1]) / 2;
                  const nx = -dy / len, ny = dx / len;
                  const off = 1.8;
                  const tx = mx + nx * off;
                  const ty = my + ny * off;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  const flip = angle > 90 || angle < -90 ? 180 : 0;
                  return (
                    <g key={`dim-${w.id}`} pointerEvents="none">
                      <line x1={w.start[0]} y1={w.start[1]} x2={w.start[0] + nx * off * 0.9} y2={w.start[1] + ny * off * 0.9} stroke="#7AB8FF" strokeWidth="0.08" />
                      <line x1={w.end[0]} y1={w.end[1]} x2={w.end[0] + nx * off * 0.9} y2={w.end[1] + ny * off * 0.9} stroke="#7AB8FF" strokeWidth="0.08" />
                      <line x1={w.start[0] + nx * off} y1={w.start[1] + ny * off} x2={w.end[0] + nx * off} y2={w.end[1] + ny * off} stroke="#7AB8FF" strokeWidth="0.08" />
                      <text x={tx} y={ty} fontSize="1.6" fill="#7AB8FF" textAnchor="middle"
                        transform={`rotate(${angle + flip}, ${tx}, ${ty})`}
                        fontFamily="IBM Plex Mono, monospace" fontWeight="600">
                        {formatFeetInches(len)}
                      </text>
                    </g>
                  );
                })}

                {/* Overall outer dimension chain */}
                {showDimensions && aabb && aabb.w >= 1 && aabb.h >= 1 && (() => {
                  const outer = 5.5;
                  const tick = 0.9;
                  return (
                    <g pointerEvents="none">
                      <line x1={aabb.minX} y1={aabb.minY - outer} x2={aabb.maxX} y2={aabb.minY - outer} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.minX} y1={aabb.minY - outer - tick / 2} x2={aabb.minX} y2={aabb.minY - outer + tick / 2} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.maxX} y1={aabb.minY - outer - tick / 2} x2={aabb.maxX} y2={aabb.minY - outer + tick / 2} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.minX} y1={aabb.minY} x2={aabb.minX} y2={aabb.minY - outer + tick} stroke="#FF6600" strokeWidth="0.07" strokeDasharray="0.5 0.5" />
                      <line x1={aabb.maxX} y1={aabb.minY} x2={aabb.maxX} y2={aabb.minY - outer + tick} stroke="#FF6600" strokeWidth="0.07" strokeDasharray="0.5 0.5" />
                      <text x={(aabb.minX + aabb.maxX) / 2} y={aabb.minY - outer - 1.1} fontSize="2.4" fill="#FF6600" textAnchor="middle"
                        fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                        {formatFeetInches(aabb.w)}
                      </text>
                      <line x1={aabb.minX - outer} y1={aabb.minY} x2={aabb.minX - outer} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.minX - outer - tick / 2} y1={aabb.minY} x2={aabb.minX - outer + tick / 2} y2={aabb.minY} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.minX - outer - tick / 2} y1={aabb.maxY} x2={aabb.minX - outer + tick / 2} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.14" />
                      <line x1={aabb.minX} y1={aabb.minY} x2={aabb.minX - outer + tick} y2={aabb.minY} stroke="#FF6600" strokeWidth="0.07" strokeDasharray="0.5 0.5" />
                      <line x1={aabb.minX} y1={aabb.maxY} x2={aabb.minX - outer + tick} y2={aabb.maxY} stroke="#FF6600" strokeWidth="0.07" strokeDasharray="0.5 0.5" />
                      <text x={aabb.minX - outer - 1.1} y={(aabb.minY + aabb.maxY) / 2} fontSize="2.4" fill="#FF6600" textAnchor="middle"
                        transform={`rotate(-90, ${aabb.minX - outer - 1.1}, ${(aabb.minY + aabb.maxY) / 2})`}
                        fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                        {formatFeetInches(aabb.h)}
                      </text>
                    </g>
                  );
                })()}
              </svg>
            )}
          </div>
        </div>
      </section>

      {/* Right side panel */}
      <aside className="border-l border-white/10 p-6 overflow-y-auto">
        <div className="label-mono mb-2">// LEGEND</div>
        <div className="space-y-2 mb-8">
          <LegendRow color="#FFFFFF" label="Walls" />
          <LegendRow color="#FFCC00" label="Doors" />
          <LegendRow color="#0055FF" label="Windows" />
          <LegendRow color="#7AB8FF" label="Wall dimensions" />
          <LegendRow color="#FF6600" label="Overall dimensions" />
        </div>

        <div className="label-mono mb-2">// LAST SYNC</div>
        {lastSourceDoc ? (
          <div className="border border-white/10 p-4 bg-[#141414]">
            <div className="font-medium truncate">{lastSourceDoc.filename}</div>
            <div className="label-mono mt-2">{lastSourceDoc.doc_type}</div>
            {lastSourceDoc.analysis?.summary && (
              <p className="text-xs text-neutral-400 mt-3 leading-relaxed">
                {lastSourceDoc.analysis.summary}
              </p>
            )}
            {lastSourceDoc.analysis?.rooms?.length > 0 && (
              <>
                <div className="label-mono mt-4 mb-2">ROOMS</div>
                <div className="space-y-1">
                  {lastSourceDoc.analysis.rooms.slice(0, 8).map((r, i) => (
                    <div key={i} className="flex justify-between text-xs font-mono">
                      <span className="text-neutral-300">{r.name}</span>
                      <span className="text-neutral-500">{r.approx_area_sqft || "—"} ft²</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="text-neutral-500 text-sm font-mono">No analysis yet.</div>
        )}
      </aside>
      </div>
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-4 h-4" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
