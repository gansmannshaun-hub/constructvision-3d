import React, { useEffect, useState } from "react";
import { formatFeetInches } from "../../lib/dim";
import {
  FLOOR_MATERIALS,
  CEILING_MIN_FT,
  CEILING_MAX_FT,
  CEILING_STEP_FT,
  CEILING_DEFAULT_FT,
} from "../../lib/renderer/floorMaterials";
import { FIXTURE_KINDS } from "../../lib/renderer/fixtureMeshes";

const ROOF_TYPES = [
  { id: "gable",   label: "Gable" },
  { id: "hip",     label: "Hip" },
  { id: "shed",    label: "Shed" },
  { id: "flat",    label: "Flat" },
  { id: "gambrel", label: "Gambrel" },
];

/**
 * Floating panel shown while the 3D wall editor is active. Sits at the
 * bottom-center; shows the selected wall / roof / room / fixture /
 * opening stats and the mutating tools. Also hosts the "+ DOOR / +
 * WINDOW" add-mode entry points.
 */
export function WallEditorPanel({
  selected, cutMode, setCutMode, busy, error,
  onDelete, onUndo, onRedo, canUndo, canRedo,
  onSetHeight, onSetWallTrim,
  selectedRoof, blueprintRoof, onSetRoof,
  selectedRoom, onSetRoomFloor, onSetRoomCeiling, onSetRoomName,
  selectedFixture, onSetFixtureRotation, onPreviewFixtureRotation, onDeleteFixture,
  selectedOpening, onSetOpeningWidth, onDeleteOpening,
  addOpeningMode, onToggleAddMode,
  onExit,
}) {
  const status = addOpeningMode
    ? `ADD ${addOpeningMode.toUpperCase()} — click any wall to place. ESC cancels.`
    : cutMode
    ? "CUT — click any wall to split at that point. ESC cancels."
    : selectedRoof
    ? "Roof selected. Change type / pitch / color below."
    : selectedRoom
    ? "Room selected. Rename it, pick a floor material, or set a drop ceiling."
    : selectedFixture
    ? "Fixture selected. Drag to move · rotate · delete."
    : selectedOpening
    ? "Door/window selected. Drag along the wall to move · resize · delete."
    : selected
    ? "Wall selected. Toggle trim types, adjust height, DEL / CUT / drag endpoints."
    : "Click any wall / roof / floor / fixture / door / window in the 3D view.";

  return (
    <div
      data-testid="wall-editor-panel"
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 bg-black/90 border border-[#FFCC00]/50 backdrop-blur-sm px-5 py-4 w-[580px] max-w-[95%]"
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="label-mono text-[#FFCC00]">// EDIT · 3D</div>
          <div className="text-xs text-neutral-400 font-mono mt-1">{status}</div>
        </div>
        <button
          data-testid="wall-editor-exit"
          onClick={onExit}
          className="label-mono text-neutral-400 hover:text-white text-xs px-2 py-1 border border-white/15 hover:border-white/30"
          title="Exit edit mode"
        >EXIT</button>
      </div>

      {selected && !cutMode && (
        <WallCard selected={selected} busy={busy} onSetHeight={onSetHeight} onSetWallTrim={onSetWallTrim} />
      )}
      {selectedRoof && (
        <RoofCard busy={busy} blueprintRoof={blueprintRoof} onSetRoof={onSetRoof} />
      )}
      {selectedRoom && (
        <RoomCard
          busy={busy} selectedRoom={selectedRoom}
          onSetRoomFloor={onSetRoomFloor}
          onSetRoomCeiling={onSetRoomCeiling}
          onSetRoomName={onSetRoomName}
        />
      )}
      {selectedFixture && (
        <FixtureCard
          busy={busy} selectedFixture={selectedFixture}
          onSetFixtureRotation={onSetFixtureRotation}
          onPreviewFixtureRotation={onPreviewFixtureRotation}
          onDeleteFixture={onDeleteFixture}
        />
      )}
      {selectedOpening && (
        <OpeningCard
          busy={busy} selectedOpening={selectedOpening}
          onSetOpeningWidth={onSetOpeningWidth}
          onDeleteOpening={onDeleteOpening}
        />
      )}

      {error && (
        <div data-testid="wall-editor-error" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-[11px] font-mono px-3 py-2 mb-3">
          {typeof error === "string" ? error : (error?.msg || JSON.stringify(error))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          data-testid="wall-editor-add-door"
          onClick={() => onToggleAddMode?.(addOpeningMode === "door" ? null : "door")}
          disabled={busy}
          className={`label-mono px-3 py-2 border transition-colors disabled:opacity-30 ${
            addOpeningMode === "door"
              ? "bg-[#FFCC00] text-black border-[#FFCC00]"
              : "border-[#FFCC00]/50 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black"
          }`}
          title="Click a wall to place a new door"
        >{addOpeningMode === "door" ? "ADD · ESC" : "+ DOOR"}</button>
        <button
          data-testid="wall-editor-add-window"
          onClick={() => onToggleAddMode?.(addOpeningMode === "window" ? null : "window")}
          disabled={busy}
          className={`label-mono px-3 py-2 border transition-colors disabled:opacity-30 ${
            addOpeningMode === "window"
              ? "bg-[#3a78d6] text-white border-[#3a78d6]"
              : "border-[#3a78d6]/60 text-[#5588FF] hover:bg-[#3a78d6] hover:text-white"
          }`}
          title="Click a wall to place a new window"
        >{addOpeningMode === "window" ? "ADD · ESC" : "+ WINDOW"}</button>
        <button
          data-testid="wall-editor-delete"
          onClick={onDelete}
          disabled={!selected || busy || cutMode}
          className="flex-1 label-mono px-3 py-2 bg-[#FF3333] hover:bg-[#DD1111] text-white disabled:opacity-30 disabled:cursor-not-allowed"
          title="Delete selected wall (Del)"
        >{busy ? "…" : "✕ DELETE WALL"}</button>
        <button
          data-testid="wall-editor-cut"
          onClick={() => setCutMode((v) => !v)}
          disabled={busy || !selected}
          className={`flex-1 label-mono px-3 py-2 border transition-colors disabled:opacity-30 ${
            cutMode
              ? "bg-[#00E5FF] text-black border-[#00E5FF]"
              : "border-[#00E5FF]/50 text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black"
          }`}
          title="Toggle cut mode — click a wall to split at that point"
        >{cutMode ? "CUT MODE · ESC" : "✂ CUT"}</button>
        <button
          data-testid="wall-editor-undo"
          onClick={onUndo}
          disabled={!canUndo() || busy}
          className="label-mono px-3 py-2 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30"
          title="Undo last edit (Ctrl+Z)"
        >↺</button>
        <button
          data-testid="wall-editor-redo"
          onClick={onRedo}
          disabled={!canRedo() || busy}
          className="label-mono px-3 py-2 border border-white/15 text-neutral-300 hover:bg-white/5 disabled:opacity-30"
          title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
        >↻</button>
      </div>
    </div>
  );
}

// ---------- Cards ----------
function WallCard({ selected, busy, onSetHeight, onSetWallTrim }) {
  const heightFt = Number(selected?.height_ft) > 0 ? Number(selected.height_ft) : 10;
  return (
    <div className="border border-[#FFCC00]/30 bg-[#FFCC00]/5 p-3 mb-3 text-xs font-mono">
      <div className="label-mono text-neutral-500 mb-1">// SELECTED WALL</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-neutral-300">
        <div>id: <span className="text-[#FFCC00]">{String(selected.wall_id).slice(0, 10)}…</span></div>
        <div>length: <span className="text-[#FFCC00]">{formatFeetInches(selected.length_ft)}</span></div>
        <div>start: <span className="text-neutral-400">{selected.start[0].toFixed(1)}, {selected.start[1].toFixed(1)}</span></div>
        <div>end: <span className="text-neutral-400">{selected.end[0].toFixed(1)}, {selected.end[1].toFixed(1)}</span></div>
      </div>
      <div className="text-[10px] text-[#00E5FF] mt-2 font-mono">
        💡 Drag the cyan spheres on this wall&apos;s endpoints to reshape it.
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono text-neutral-500">HEIGHT</span>
          <span className="label-mono text-[#FFCC00]">{heightFt.toFixed(1)} ft</span>
        </div>
        <input
          data-testid="wall-editor-height"
          type="range" min="4" max="30" step="0.5"
          value={heightFt}
          disabled={busy}
          onChange={(e) => onSetHeight?.(Number(e.target.value))}
          className="w-full accent-[#FFCC00] disabled:opacity-40"
        />
        <div className="flex justify-between text-[9px] font-mono text-neutral-600">
          <span>4</span><span>10</span><span>20</span><span>30 ft</span>
        </div>
      </div>
      <div className="mt-3">
        <div className="label-mono text-neutral-500 mb-1">TRIM ON THIS WALL</div>
        <div className="grid grid-cols-3 gap-2">
          <TrimCheck testid="wall-editor-trim-baseboard" label="Baseboard"
                     checked={!!selected.trim_baseboard} disabled={busy}
                     onChange={(v) => onSetWallTrim?.({ trim_baseboard: v })} />
          <TrimCheck testid="wall-editor-trim-crown" label="Crown"
                     checked={!!selected.trim_crown} disabled={busy}
                     onChange={(v) => onSetWallTrim?.({ trim_crown: v })} />
          <TrimCheck testid="wall-editor-trim-chair-rail" label="Chair Rail"
                     checked={!!selected.trim_chair_rail} disabled={busy}
                     onChange={(v) => onSetWallTrim?.({ trim_chair_rail: v })} />
        </div>
        <div className="text-[9px] text-neutral-600 mt-1">
          Door / window casings auto-count from openings on this wall.
        </div>
      </div>
    </div>
  );
}

function TrimCheck({ testid, label, checked, disabled, onChange }) {
  return (
    <label className={`flex items-center gap-1.5 border border-white/10 px-2 py-1.5 cursor-pointer ${checked ? "bg-[#FFCC00]/10 border-[#FFCC00]/50" : "hover:bg-white/5"}`}>
      <input
        data-testid={testid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="accent-[#FFCC00]"
      />
      <span className="text-[10px]">{label}</span>
    </label>
  );
}

function RoofCard({ busy, blueprintRoof, onSetRoof }) {
  return (
    <div data-testid="roof-editor-card" className="border border-[#00E5FF]/40 bg-[#00E5FF]/5 p-3 mb-3 text-xs font-mono">
      <div className="label-mono text-neutral-500 mb-2">// SELECTED ROOF</div>
      <label className="block mb-2">
        <div className="label-mono text-neutral-500 mb-1">TYPE</div>
        <select
          data-testid="roof-editor-type"
          value={blueprintRoof.type}
          onChange={(e) => onSetRoof?.({ roof_type: e.target.value })}
          disabled={busy}
          className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs disabled:opacity-40"
        >
          {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label className="block mb-2">
        <div className="flex justify-between mb-1">
          <span className="label-mono text-neutral-500">PITCH</span>
          <span className="label-mono text-[#00E5FF]">{blueprintRoof.pitch}°</span>
        </div>
        <input
          data-testid="roof-editor-pitch"
          type="range" min="0" max="45" step="1"
          value={blueprintRoof.pitch}
          disabled={busy || blueprintRoof.type === "flat"}
          onChange={(e) => onSetRoof?.({ roof_pitch_deg: Number(e.target.value) })}
          className="w-full accent-[#00E5FF] disabled:opacity-40"
        />
      </label>
      <label className="block">
        <div className="label-mono text-neutral-500 mb-1">COLOR</div>
        <input
          data-testid="roof-editor-color"
          type="color"
          value={blueprintRoof.color}
          disabled={busy}
          onChange={(e) => onSetRoof?.({ roof_color: e.target.value })}
          className="w-full h-8 bg-black border border-white/15 cursor-pointer disabled:opacity-40"
        />
      </label>
    </div>
  );
}

function RoomCard({ busy, selectedRoom, onSetRoomFloor, onSetRoomCeiling, onSetRoomName }) {
  const [roomNameDraft, setRoomNameDraft] = useState("");
  useEffect(() => { setRoomNameDraft(selectedRoom?.name || ""); },
    [selectedRoom?.label_index, selectedRoom?.sheet_id, selectedRoom?.name]);
  const [ceilingDraft, setCeilingDraft] = useState(null);
  useEffect(() => { setCeilingDraft(null); },
    [selectedRoom?.label_index, selectedRoom?.sheet_id]);
  const ceilFt = ceilingDraft !== null
    ? ceilingDraft
    : (Number(selectedRoom?.ceiling_height_ft) > 0
        ? Number(selectedRoom.ceiling_height_ft)
        : CEILING_DEFAULT_FT);
  return (
    <div data-testid="room-editor-card" className="border border-[#FF9933]/40 bg-[#FF9933]/5 p-3 mb-3 text-xs font-mono">
      <div className="label-mono text-neutral-500 mb-2">// SELECTED ROOM</div>
      <label className="block mb-3">
        <div className="label-mono text-neutral-500 mb-1">NAME</div>
        <input
          data-testid="room-editor-name"
          type="text"
          value={roomNameDraft}
          disabled={busy}
          onChange={(e) => setRoomNameDraft(e.target.value)}
          onBlur={() => {
            const next = roomNameDraft.trim();
            if (next && next !== (selectedRoom.name || "")) onSetRoomName?.(next);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs text-[#FF9933] disabled:opacity-40"
          placeholder="Living Room"
          maxLength={80}
        />
      </label>
      <label className="block mb-3">
        <div className="label-mono text-neutral-500 mb-1">FLOOR MATERIAL</div>
        <select
          data-testid="room-editor-floor"
          value={selectedRoom.floor_material || "concrete"}
          disabled={busy}
          onChange={(e) => onSetRoomFloor?.(e.target.value)}
          className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs text-[#FF9933] disabled:opacity-40"
        >
          {FLOOR_MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <div className="flex justify-between mb-1">
          <span className="label-mono text-neutral-500">CEILING HEIGHT</span>
          <span className="label-mono text-[#FF9933]">
            {selectedRoom.ceiling_height_ft ? `${ceilFt.toFixed(1)} ft` : "— (use wall top)"}
          </span>
        </div>
        <input
          data-testid="room-editor-ceiling"
          type="range"
          min={CEILING_MIN_FT} max={CEILING_MAX_FT} step={CEILING_STEP_FT}
          value={ceilFt}
          disabled={busy}
          onChange={(e) => setCeilingDraft(Number(e.target.value))}
          onMouseUp={() => { if (ceilingDraft !== null) { onSetRoomCeiling?.(ceilingDraft); setCeilingDraft(null); } }}
          onTouchEnd={() => { if (ceilingDraft !== null) { onSetRoomCeiling?.(ceilingDraft); setCeilingDraft(null); } }}
          onKeyUp={(e) => {
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && ceilingDraft !== null) {
              onSetRoomCeiling?.(ceilingDraft); setCeilingDraft(null);
            }
          }}
          className="w-full accent-[#FF9933] disabled:opacity-40"
        />
        <div className="flex justify-between text-[9px] font-mono text-neutral-600 mb-1">
          <span>{CEILING_MIN_FT}</span><span>10</span><span>12</span><span>{CEILING_MAX_FT} ft</span>
        </div>
        {selectedRoom.ceiling_height_ft && (
          <button
            data-testid="room-editor-ceiling-clear"
            type="button"
            onClick={() => onSetRoomCeiling?.(null)}
            disabled={busy}
            className="text-[10px] text-neutral-500 hover:text-[#FF9933] underline disabled:opacity-40"
          >clear drop ceiling</button>
        )}
      </label>
    </div>
  );
}

function FixtureCard({ busy, selectedFixture, onSetFixtureRotation, onPreviewFixtureRotation, onDeleteFixture }) {
  const [rotDraft, setRotDraft] = useState(null);
  useEffect(() => { setRotDraft(null); },
    [selectedFixture?.fixture_index, selectedFixture?.sheet_id]);
  const rotDeg = rotDraft !== null ? rotDraft : (Number(selectedFixture?.rotation_deg) || 0);
  return (
    <div data-testid="fixture-editor-card" className="border border-[#5C7A8C]/50 bg-[#5C7A8C]/10 p-3 mb-3 text-xs font-mono">
      <div className="label-mono text-neutral-500 mb-2">// SELECTED FIXTURE</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-neutral-300 mb-2">
        <div>kind: <span data-testid="fixture-editor-kind" className="text-[#88AABB]">{selectedFixture.kind}</span></div>
        <div>size: <span className="text-neutral-400">
          {Array.isArray(selectedFixture.size_ft) ? `${selectedFixture.size_ft[0]}×${selectedFixture.size_ft[1]} ft` : "—"}
        </span></div>
        <div>x, y: <span className="text-neutral-400">
          {selectedFixture.position_ft ? `${selectedFixture.position_ft[0].toFixed(1)}, ${selectedFixture.position_ft[1].toFixed(1)}` : "—"}
        </span></div>
        <div>rotation: <span className="text-[#88AABB]">{rotDeg}°</span></div>
      </div>
      <div className="text-[10px] text-[#88AABB] mb-3">
        💡 Left-drag on the fixture to move (snaps to 3&quot;).
      </div>
      <label className="block mb-3">
        <div className="flex justify-between mb-1">
          <span className="label-mono text-neutral-500">ROTATION</span>
          <span className="label-mono text-[#88AABB]">{rotDeg}°</span>
        </div>
        <input
          data-testid="fixture-editor-rotation"
          type="range" min="0" max="360" step="15"
          value={rotDeg}
          disabled={busy}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRotDraft(v);
            onPreviewFixtureRotation?.(v);
          }}
          onMouseUp={() => { if (rotDraft !== null) { onSetFixtureRotation?.(rotDraft); setRotDraft(null); } }}
          onTouchEnd={() => { if (rotDraft !== null) { onSetFixtureRotation?.(rotDraft); setRotDraft(null); } }}
          onKeyUp={(e) => {
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && rotDraft !== null) {
              onSetFixtureRotation?.(rotDraft); setRotDraft(null);
            }
          }}
          className="w-full accent-[#88AABB] disabled:opacity-40"
        />
        <div className="flex justify-between text-[9px] font-mono text-neutral-600">
          <span>0°</span><span>90°</span><span>180°</span><span>270°</span><span>360°</span>
        </div>
      </label>
      <button
        data-testid="fixture-editor-delete"
        onClick={onDeleteFixture}
        disabled={busy}
        className="w-full label-mono px-3 py-2 bg-[#FF3333] hover:bg-[#DD1111] text-white disabled:opacity-30"
      >{busy ? "…" : "✕ DELETE FIXTURE"}</button>
    </div>
  );
}

function OpeningCard({ busy, selectedOpening, onSetOpeningWidth, onDeleteOpening }) {
  const [wDraft, setWDraft] = useState(null);
  useEffect(() => { setWDraft(null); },
    [selectedOpening?.opening_type, selectedOpening?.opening_index, selectedOpening?.sheet_id]);
  const wFt = wDraft !== null ? wDraft : (Number(selectedOpening?.width_ft) || (selectedOpening?.opening_type === "door" ? 3 : 4));
  const accent = selectedOpening.opening_type === "door" ? "#FFCC00" : "#5588FF";
  return (
    <div data-testid="opening-editor-card" className="border p-3 mb-3 text-xs font-mono"
         style={{ borderColor: `${accent}66`, background: `${accent}10` }}>
      <div className="label-mono text-neutral-500 mb-2">// SELECTED {selectedOpening.opening_type.toUpperCase()}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-neutral-300 mb-2">
        <div>wall: <span className="text-neutral-400">#{selectedOpening.wall_index ?? "?"}</span></div>
        <div>width: <span style={{ color: accent }}>{wFt.toFixed(1)} ft</span></div>
      </div>
      <div className="text-[10px] mb-3" style={{ color: accent }}>
        💡 Left-drag on the {selectedOpening.opening_type} to slide it along the wall.
      </div>
      <label className="block mb-3">
        <div className="flex justify-between mb-1">
          <span className="label-mono text-neutral-500">WIDTH</span>
          <span className="label-mono" style={{ color: accent }}>{wFt.toFixed(1)} ft</span>
        </div>
        <input
          data-testid="opening-editor-width"
          type="range" min="1.5" max="12" step="0.25"
          value={wFt}
          disabled={busy}
          onChange={(e) => setWDraft(Number(e.target.value))}
          onMouseUp={() => { if (wDraft !== null) { onSetOpeningWidth?.(wDraft); setWDraft(null); } }}
          onTouchEnd={() => { if (wDraft !== null) { onSetOpeningWidth?.(wDraft); setWDraft(null); } }}
          onKeyUp={(e) => {
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && wDraft !== null) {
              onSetOpeningWidth?.(wDraft); setWDraft(null);
            }
          }}
          className="w-full disabled:opacity-40"
          style={{ accentColor: accent }}
        />
        <div className="flex justify-between text-[9px] font-mono text-neutral-600">
          <span>1.5</span><span>3</span><span>6</span><span>12 ft</span>
        </div>
      </label>
      <button
        data-testid="opening-editor-delete"
        onClick={onDeleteOpening}
        disabled={busy}
        className="w-full label-mono px-3 py-2 bg-[#FF3333] hover:bg-[#DD1111] text-white disabled:opacity-30"
      >{busy ? "…" : `✕ DELETE ${selectedOpening.opening_type.toUpperCase()}`}</button>
    </div>
  );
}

// Small helper export in case consumers want the fixture kind list.
export { FIXTURE_KINDS };
