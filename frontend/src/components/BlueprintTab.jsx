import React, { useMemo } from "react";
import { useStore } from "../store";

/** Read-only blueprint view: draws walls/doors/windows on the blueprint grid */
export default function BlueprintTab() {
  const { blueprint, documents } = useStore();
  const walls = blueprint?.walls || [];
  const doors = blueprint?.doors || [];
  const windows = blueprint?.windows || [];

  const lastSourceDoc = useMemo(() => {
    const id = blueprint?.last_source_document_id;
    if (!id) return null;
    return documents.find((d) => d.id === id) || null;
  }, [blueprint, documents]);

  const VB = 100; // viewbox 0..100

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] h-full" data-testid="blueprint-tab">
      <section className="relative flex flex-col">
        <div className="p-6 border-b border-white/10 flex items-baseline justify-between">
          <div>
            <div className="label-mono">// VIEW</div>
            <h2 className="font-display text-2xl tracking-tighter">Live Blueprint</h2>
          </div>
          <div className="label-mono">
            {walls.length} walls · {doors.length} doors · {windows.length} windows
          </div>
        </div>

        <div className="flex-1 p-4 min-h-0">
          <div className="w-full h-full blueprint-canvas-bg relative">
            {walls.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-blue-200/40 font-mono">
                  <div className="label-mono text-blue-200/60 mb-2">// AWAITING ANALYSIS</div>
                  <div>Upload a blueprint to populate this view.</div>
                </div>
              </div>
            ) : (
              <svg viewBox={`0 0 ${VB} ${VB}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" data-testid="blueprint-svg">
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
