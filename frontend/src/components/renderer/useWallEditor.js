import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useStore } from "../../store";

const API = process.env.REACT_APP_BACKEND_URL + "/api";

/**
 * Owns the 3D wall-editor tool. Once toggled on, clicks in the 3D view
 * pick walls via the engine's raycaster; the panel then offers DELETE
 * and CUT actions. Every edit auto-saves to the sheet the wall belongs
 * to, and an in-memory undo stack lets the user step back through recent
 * edits (Ctrl+Z or the ↺ UNDO button).
 */
export function useWallEditor({ engineRef, refreshBlueprint, updateBlueprint }) {
  const currentProjectId = useStore((s) => s.currentProjectId);
  const sheetsFromStore = useStore((s) => s.blueprint?.sheets || []);
  const blueprint = useStore((s) => s.blueprint);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedRoof, setSelectedRoof] = useState(false);
  const [cutMode, setCutMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const sheetsRef = useRef(sheetsFromStore);
  useEffect(() => { sheetsRef.current = sheetsFromStore; }, [sheetsFromStore]);

  const setEngineSelected = useCallback((id) => {
    engineRef.current?.setSelectedWall?.(id || null);
  }, [engineRef]);

  const _getSheet = useCallback((sheet_id) => {
    return sheetsRef.current.find((s) => s.id === sheet_id) || null;
  }, []);

  const _saveSheet = useCallback(async (sheet_id, next) => {
    if (!currentProjectId) throw new Error("No active project");
    const token = localStorage.getItem("cm_token");
    await axios.put(
      `${API}/projects/${currentProjectId}/blueprint/sheets/${sheet_id}`,
      {
        walls:    next.walls    || [],
        doors:    next.doors    || [],
        windows:  next.windows  || [],
        labels:   next.labels   || [],
        fixtures: next.fixtures || [],
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }, [currentProjectId]);

  const _pushUndo = useCallback((snap) => {
    undoRef.current.push(snap);
    if (undoRef.current.length > 20) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.enableWallEditor) return;
    if (!editing) {
      engine.enableWallEditor(false);
      setSelected(null);
      setCutMode(false);
      return;
    }
    engine.enableWallEditor(true, (action, payload) => {
      if (action === "pick") {
        setSelected(payload);
        setSelectedRoof(false);
        setEngineSelected(payload.wall_id);
      } else if (action === "roof-pick") {
        setSelectedRoof(true);
        setSelected(null);
        setEngineSelected(null);
      } else if (action === "deselect") {
        setSelected(null);
        setSelectedRoof(false);
        setEngineSelected(null);
      }
    });
    return () => engine.enableWallEditor(false);
  }, [editing, engineRef, setEngineSelected]);

  const deleteSelected = useCallback(async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const sheet = _getSheet(selected.sheet_id);
      if (!sheet) throw new Error("Sheet not found in state");
      const walls = sheet.walls || [];
      const idx = walls.findIndex((w) => w.id === selected.wall_id);
      if (idx < 0) throw new Error("Wall not found");
      _pushUndo({
        sheet_id: sheet.id,
        walls, doors: sheet.doors || [], windows: sheet.windows || [],
        labels: sheet.labels || [], fixtures: sheet.fixtures || [],
      });
      const nextWalls = walls.filter((_, i) => i !== idx);
      const remap = (arr) => (arr || []).map((el) => {
        if (typeof el.wall_index !== "number") return el;
        if (el.wall_index === idx) return null;
        if (el.wall_index > idx) return { ...el, wall_index: el.wall_index - 1 };
        return el;
      }).filter(Boolean);
      await _saveSheet(sheet.id, {
        walls: nextWalls,
        doors: remap(sheet.doors),
        windows: remap(sheet.windows),
        labels: sheet.labels || [],
        fixtures: sheet.fixtures || [],
      });
      setSelected(null);
      setEngineSelected(null);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Delete failed");
    } finally { setBusy(false); }
  }, [selected, _getSheet, _saveSheet, _pushUndo, refreshBlueprint, setEngineSelected]);

  const executeCut = useCallback(async () => {
    if (!selected?.hit_ft) return;
    setBusy(true); setError("");
    try {
      const sheet = _getSheet(selected.sheet_id);
      if (!sheet) throw new Error("Sheet not found in state");
      const walls = sheet.walls || [];
      const idx = walls.findIndex((w) => w.id === selected.wall_id);
      if (idx < 0) throw new Error("Wall not found");
      _pushUndo({
        sheet_id: sheet.id,
        walls, doors: sheet.doors || [], windows: sheet.windows || [],
        labels: sheet.labels || [], fixtures: sheet.fixtures || [],
      });
      const orig = walls[idx];
      const mid = selected.hit_ft;
      const partA = { ...orig, id: `${orig.id}-a-${Date.now()}`, end: mid };
      const partB = { ...orig, id: `${orig.id}-b-${Date.now()}`, start: mid };
      const nextWalls = [...walls.slice(0, idx), partA, partB, ...walls.slice(idx + 1)];
      const relocate = (arr) => (arr || []).map((el) => {
        if (el.wall_index !== idx) {
          if (el.wall_index > idx) return { ...el, wall_index: el.wall_index + 1 };
          return el;
        }
        const [sx, sy] = orig.start; const [ex, ey] = orig.end;
        const dx = ex - sx; const dy = ey - sy;
        const [px, py] = el.position || [mid[0], mid[1]];
        const len2 = dx * dx + dy * dy || 1;
        const t = ((px - sx) * dx + (py - sy) * dy) / len2;
        const tMid = ((mid[0] - sx) * dx + (mid[1] - sy) * dy) / len2;
        return t < tMid
          ? { ...el, wall_index: idx }
          : { ...el, wall_index: idx + 1 };
      });
      await _saveSheet(sheet.id, {
        walls: nextWalls,
        doors: relocate(sheet.doors),
        windows: relocate(sheet.windows),
        labels: sheet.labels || [],
        fixtures: sheet.fixtures || [],
      });
      setSelected(null);
      setEngineSelected(null);
      setCutMode(false);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Cut failed");
    } finally { setBusy(false); }
  }, [selected, _getSheet, _saveSheet, _pushUndo, refreshBlueprint, setEngineSelected]);

  useEffect(() => {
    if (!cutMode || !selected?.hit_ft || busy) return;
    executeCut();
  }, [selected, cutMode, busy, executeCut]);

  const undo = useCallback(async () => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    setBusy(true); setError("");
    try {
      const current = _getSheet(snap.sheet_id);
      if (current) {
        redoRef.current.push({
          sheet_id: snap.sheet_id,
          walls: current.walls || [], doors: current.doors || [], windows: current.windows || [],
          labels: current.labels || [], fixtures: current.fixtures || [],
        });
      }
      await _saveSheet(snap.sheet_id, snap);
      setSelected(null);
      setEngineSelected(null);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Undo failed");
    } finally { setBusy(false); }
  }, [_getSheet, _saveSheet, refreshBlueprint, setEngineSelected]);

  const redo = useCallback(async () => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    setBusy(true); setError("");
    try {
      const current = _getSheet(snap.sheet_id);
      if (current) {
        undoRef.current.push({
          sheet_id: snap.sheet_id,
          walls: current.walls || [], doors: current.doors || [], windows: current.windows || [],
          labels: current.labels || [], fixtures: current.fixtures || [],
        });
      }
      await _saveSheet(snap.sheet_id, snap);
      setSelected(null);
      setEngineSelected(null);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Redo failed");
    } finally { setBusy(false); }
  }, [_getSheet, _saveSheet, refreshBlueprint, setEngineSelected]);

  // Endpoint drag: enable engine handles whenever a wall is selected.
  // `commit` fires on mouseup with the final feet position; we write
  // it into the sheet and refresh. Placed AFTER _saveSheet + _pushUndo
  // to avoid TDZ errors in the useEffect closure.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.enableEndpointDrag) return;
    if (!selected || cutMode) {
      engine.enableEndpointDrag(false);
      return;
    }
    engine.enableEndpointDrag(true, {
      wall_id: selected.wall_id,
      start: selected.start,
      end: selected.end,
    }, async (kind, payload) => {
      if (kind !== "commit") return;
      const sheet = sheetsRef.current.find((s) => s.id === selected.sheet_id);
      if (!sheet) return;
      const walls = sheet.walls || [];
      const idx = walls.findIndex((w) => w.id === selected.wall_id);
      if (idx < 0) return;
      const orig = walls[idx];
      const nextWall = payload.side === "start"
        ? { ...orig, start: payload.point_ft }
        : { ...orig, end:   payload.point_ft };
      if (JSON.stringify(nextWall.start) === JSON.stringify(orig.start) &&
          JSON.stringify(nextWall.end)   === JSON.stringify(orig.end)) return;
      _pushUndo({
        sheet_id: sheet.id,
        walls, doors: sheet.doors || [], windows: sheet.windows || [],
        labels: sheet.labels || [], fixtures: sheet.fixtures || [],
      });
      const nextWalls = [...walls.slice(0, idx), nextWall, ...walls.slice(idx + 1)];
      try {
        setBusy(true);
        await _saveSheet(sheet.id, {
          walls: nextWalls,
          doors: sheet.doors || [],
          windows: sheet.windows || [],
          labels: sheet.labels || [],
          fixtures: sheet.fixtures || [],
        });
        setSelected((prev) => prev ? { ...prev, start: nextWall.start, end: nextWall.end } : prev);
        await refreshBlueprint();
      } catch (e) {
        setError(e?.response?.data?.detail || e?.message || "Move failed");
      } finally { setBusy(false); }
    });
    return () => { engine.enableEndpointDrag(false); };
  }, [selected?.wall_id, cutMode, engineRef, _pushUndo, _saveSheet, refreshBlueprint]);

  const setWallHeight = useCallback(async (heightFt) => {
    if (!selected) return;
    const h = Math.max(4, Math.min(40, Number(heightFt) || 10));
    setBusy(true); setError("");
    try {
      const sheet = _getSheet(selected.sheet_id);
      if (!sheet) throw new Error("Sheet not found");
      const walls = sheet.walls || [];
      const idx = walls.findIndex((w) => w.id === selected.wall_id);
      if (idx < 0) throw new Error("Wall not found");
      _pushUndo({
        sheet_id: sheet.id,
        walls, doors: sheet.doors || [], windows: sheet.windows || [],
        labels: sheet.labels || [], fixtures: sheet.fixtures || [],
      });
      const nextWalls = [...walls];
      nextWalls[idx] = { ...nextWalls[idx], height_ft: h };
      await _saveSheet(sheet.id, {
        walls: nextWalls,
        doors: sheet.doors || [],
        windows: sheet.windows || [],
        labels: sheet.labels || [],
        fixtures: sheet.fixtures || [],
      });
      setSelected((prev) => prev ? { ...prev, height_ft: h } : prev);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Height update failed");
    } finally { setBusy(false); }
  }, [selected, _getSheet, _saveSheet, _pushUndo, refreshBlueprint]);

  const updateRoof = useCallback(async (patch) => {
    setBusy(true); setError("");
    try {
      await updateBlueprint(patch);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Roof update failed");
    } finally { setBusy(false); }
  }, [updateBlueprint]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => {
      if (e.key === "Escape") { setSelected(null); setCutMode(false); setEngineSelected(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected && !busy) deleteSelected();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selected, busy, deleteSelected, undo, redo, setEngineSelected]);

  return {
    editing, setEditing,
    selected, cutMode, setCutMode,
    selectedRoof, setSelectedRoof,
    busy, error,
    deleteSelected, undo, redo,
    setWallHeight,
    updateRoof,
    blueprintRoof: {
      type:  blueprint?.roof_type      || "gable",
      pitch: blueprint?.roof_pitch_deg ?? 12,
      color: blueprint?.roof_color     || "#7A2E2E",
    },
    canUndo: () => undoRef.current.length > 0,
    canRedo: () => redoRef.current.length > 0,
  };
}
