import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/** Interactive 2D CAD editor.
 *  - Tools: select | wall | door | window
 *  - Click two points to draw a wall, click once for door/window
 *  - Delete selected with Backspace
 *  - Save persists to backend, which makes the 3D renderer + blueprint refresh
 */
export default function CadEditorTab() {
  const { blueprint, saveBlueprint } = useStore();
  const svgRef = useRef(null);
  const [tool, setTool] = useState("select");
  const [walls, setWalls] = useState(blueprint.walls || []);
  const [doors, setDoors] = useState(blueprint.doors || []);
  const [windows, setWindows] = useState(blueprint.windows || []);
  const [pendingStart, setPendingStart] = useState(null);
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null); // {type, id}
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // sync from store when blueprint changes externally (e.g. new upload analyzed)
  useEffect(() => {
    setWalls(blueprint.walls || []);
    setDoors(blueprint.doors || []);
    setWindows(blueprint.windows || []);
    setDirty(false);
  }, [blueprint]);

  const markDirty = () => setDirty(true);

  const toSvgCoord = (e) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    // snap to 1
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };

  const onCanvasClick = (e) => {
    const [x, y] = toSvgCoord(e);
    if (tool === "wall") {
      if (!pendingStart) {
        setPendingStart([x, y]);
      } else {
        const newWall = {
          id: cryptoId(),
          start: pendingStart,
          end: [x, y],
          thickness: 0.2,
        };
        setWalls((arr) => [...arr, newWall]);
        setPendingStart(null);
        markDirty();
      }
    } else if (tool === "door") {
      const newDoor = { id: cryptoId(), position: [x, y], width: 3, wall_index: 0 };
      setDoors((arr) => [...arr, newDoor]);
      markDirty();
    } else if (tool === "window") {
      const newWin = { id: cryptoId(), position: [x, y], width: 4, wall_index: 0 };
      setWindows((arr) => [...arr, newWin]);
      markDirty();
    } else {
      setSelected(null);
    }
  };

  // keyboard delete
  useEffect(() => {
    const h = (e) => {
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        if (selected.type === "wall") setWalls((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "door") setDoors((a) => a.filter((w) => w.id !== selected.id));
        if (selected.type === "window") setWindows((a) => a.filter((w) => w.id !== selected.id));
        setSelected(null);
        markDirty();
      }
      if (e.key === "Escape") {
        setPendingStart(null);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected]);

  const save = async () => {
    setSaving(true);
    try {
      await saveBlueprint(walls, doors, windows);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const clearAll = () => {
    if (!window.confirm("Remove all walls/doors/windows?")) return;
    setWalls([]);
    setDoors([]);
    setWindows([]);
    markDirty();
  };

  return (
    <div className="grid grid-cols-[80px_1fr_280px] h-full" data-testid="cad-editor-tab">
      {/* Toolbar */}
      <div className="border-r border-white/10 flex flex-col">
        {[
          { id: "select", label: "Select", icon: "↖" },
          { id: "wall", label: "Wall", icon: "▬" },
          { id: "door", label: "Door", icon: "⊟" },
          { id: "window", label: "Window", icon: "▢" },
        ].map((t) => (
          <button
            key={t.id}
            data-testid={`cad-tool-${t.id}`}
            onClick={() => {
              setTool(t.id);
              setPendingStart(null);
            }}
            className={`aspect-square flex flex-col items-center justify-center border-b border-white/10 transition-all duration-150 ${
              tool === t.id ? "bg-[#FFCC00] text-black" : "text-neutral-400 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className="text-2xl leading-none">{t.icon}</span>
            <span className="text-[9px] uppercase tracking-wider font-mono mt-1">{t.label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button
          data-testid="cad-clear-button"
          onClick={clearAll}
          className="aspect-square flex flex-col items-center justify-center border-t border-white/10 text-neutral-500 hover:bg-[#FF3333]/20 hover:text-[#FF6666] transition-all duration-150"
        >
          <span className="text-xl">✕</span>
          <span className="text-[9px] uppercase tracking-wider font-mono mt-1">Clear</span>
        </button>
      </div>

      {/* Canvas */}
      <div className="relative flex flex-col">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="label-mono">// EDITOR</div>
            <div className="font-display text-xl tracking-tighter">
              2D CAD · <span className="text-[#FFCC00]">{tool.toUpperCase()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="label-mono">{dirty ? "● UNSAVED" : "○ SAVED"}</span>
            <button
              data-testid="cad-save-button"
              onClick={save}
              disabled={saving || !dirty}
              className="bg-[#FFCC00] disabled:bg-white/10 disabled:text-neutral-500 text-black font-bold px-5 py-2 text-sm uppercase tracking-wider transition-colors"
            >
              {saving ? "Saving..." : "Save & Sync"}
            </button>
          </div>
        </div>

        <div className="flex-1 p-4 min-h-0">
          <div className="w-full h-full blueprint-canvas-bg relative cursor-crosshair">
            <svg
              ref={svgRef}
              viewBox="0 0 100 100"
              className="w-full h-full"
              preserveAspectRatio="xMidYMid meet"
              onClick={onCanvasClick}
              onMouseMove={(e) => setHover(toSvgCoord(e))}
              onMouseLeave={() => setHover(null)}
              data-testid="cad-canvas"
            >
              {/* Walls */}
              {walls.map((w) => {
                const isSel = selected?.type === "wall" && selected.id === w.id;
                return (
                  <line
                    key={w.id}
                    x1={w.start[0]}
                    y1={w.start[1]}
                    x2={w.end[0]}
                    y2={w.end[1]}
                    stroke={isSel ? "#FFCC00" : "#FFFFFF"}
                    strokeWidth={Math.max(0.6, (w.thickness || 0.2) * 2)}
                    strokeLinecap="square"
                    style={{ cursor: tool === "select" ? "pointer" : "crosshair" }}
                    onClick={(e) => {
                      if (tool === "select") {
                        e.stopPropagation();
                        setSelected({ type: "wall", id: w.id });
                      }
                    }}
                  />
                );
              })}
              {/* Pending wall preview */}
              {tool === "wall" && pendingStart && hover && (
                <line
                  x1={pendingStart[0]}
                  y1={pendingStart[1]}
                  x2={hover[0]}
                  y2={hover[1]}
                  stroke="#FFCC00"
                  strokeWidth="0.6"
                  strokeDasharray="1 1"
                />
              )}
              {pendingStart && (
                <circle cx={pendingStart[0]} cy={pendingStart[1]} r="0.8" fill="#FFCC00" />
              )}

              {/* Doors */}
              {doors.map((d) => {
                const isSel = selected?.type === "door" && selected.id === d.id;
                return (
                  <circle
                    key={d.id}
                    cx={d.position[0]}
                    cy={d.position[1]}
                    r={(d.width || 3) / 4}
                    fill={isSel ? "#FF8800" : "#FFCC00"}
                    onClick={(e) => {
                      if (tool === "select") {
                        e.stopPropagation();
                        setSelected({ type: "door", id: d.id });
                      }
                    }}
                  />
                );
              })}

              {/* Windows */}
              {windows.map((w) => {
                const isSel = selected?.type === "window" && selected.id === w.id;
                return (
                  <rect
                    key={w.id}
                    x={w.position[0] - (w.width || 4) / 2}
                    y={w.position[1] - 0.4}
                    width={w.width || 4}
                    height={0.8}
                    fill={isSel ? "#00CCFF" : "#0055FF"}
                    onClick={(e) => {
                      if (tool === "select") {
                        e.stopPropagation();
                        setSelected({ type: "window", id: w.id });
                      }
                    }}
                  />
                );
              })}
            </svg>

            {/* Cursor coords */}
            {hover && (
              <div className="absolute bottom-2 right-2 bg-black/80 border border-white/10 px-3 py-1 label-mono">
                X {hover[0].toFixed(1)} · Y {hover[1].toFixed(1)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Layers panel */}
      <aside className="border-l border-white/10 p-4 overflow-y-auto">
        <div className="label-mono mb-2">// HINT</div>
        <div className="text-xs text-neutral-400 mb-6 leading-relaxed">
          {tool === "wall" && "Click to set start, click again to finish wall. ESC cancels."}
          {tool === "door" && "Click on a wall to drop a door."}
          {tool === "window" && "Click on a wall to drop a window."}
          {tool === "select" && "Click an element to select. Backspace to delete."}
        </div>

        <Section label="Walls" count={walls.length} />
        <Section label="Doors" count={doors.length} />
        <Section label="Windows" count={windows.length} />

        {selected && (
          <div className="mt-6 border border-[#FFCC00]/40 bg-[#FFCC00]/5 p-3">
            <div className="label-mono text-[#FFCC00] mb-1">SELECTED</div>
            <div className="font-mono text-sm">{selected.type} · {selected.id.slice(0, 8)}</div>
            <div className="text-xs text-neutral-400 mt-2">Press Backspace to delete</div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ label, count }) {
  return (
    <div className="border border-white/10 p-3 mb-1 flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <span className="label-mono">{count}</span>
    </div>
  );
}

function cryptoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
