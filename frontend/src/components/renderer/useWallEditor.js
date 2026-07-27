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
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [selectedFixture, setSelectedFixture] = useState(null);
  const [selectedOpening, setSelectedOpening] = useState(null);
  const [addOpeningMode, setAddOpeningMode] = useState(null);   // null | "door" | "window"
  const [pushPullMode, setPushPullMode] = useState(false);
  const [cutMode, setCutMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const sheetsRef = useRef(sheetsFromStore);
  const createOpeningAtRef = useRef(null);
  useEffect(() => { sheetsRef.current = sheetsFromStore; }, [sheetsFromStore]);

  const setEngineSelected = useCallback((id) => {
    engineRef.current?.setSelectedWall?.(id || null);
  }, [engineRef]);

  const setEngineSelectedRoom = useCallback((labelIndex, sheetId) => {
    engineRef.current?.setSelectedRoom?.(
      labelIndex === null || labelIndex === undefined ? null : labelIndex,
      sheetId || null,
    );
  }, [engineRef]);

  const setEngineSelectedFixture = useCallback((idx, sheetId) => {
    engineRef.current?.setSelectedFixture?.(
      idx === null || idx === undefined ? null : idx,
      sheetId || null,
    );
  }, [engineRef]);

  const setEngineSelectedOpening = useCallback((type, idx, sheetId) => {
    engineRef.current?.setSelectedOpening?.(
      type || null,
      idx === null || idx === undefined ? null : idx,
      sheetId || null,
    );
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
      setSelectedRoof(false);
      setSelectedRoom(null);
      setSelectedFixture(null);
      setSelectedOpening(null);
      setAddOpeningMode(null);
      setPushPullMode(false);
      setCutMode(false);
      return;
    }
    engine.enableWallEditor(true, (action, payload) => {
      if (action === "pick") {
        setSelected(payload);
        setSelectedRoof(false);
        setSelectedRoom(null);
        setSelectedFixture(null);
        setSelectedOpening(null);
        setEngineSelected(payload.wall_id);
        setEngineSelectedRoom(null);
        setEngineSelectedFixture(null);
        setEngineSelectedOpening(null, null, null);
      } else if (action === "roof-pick") {
        setSelectedRoof(true);
        setSelected(null);
        setSelectedRoom(null);
        setSelectedFixture(null);
        setSelectedOpening(null);
        setEngineSelected(null);
        setEngineSelectedRoom(null);
        setEngineSelectedFixture(null);
        setEngineSelectedOpening(null, null, null);
      } else if (action === "room-pick") {
        setSelectedRoom(payload);
        setSelected(null);
        setSelectedRoof(false);
        setSelectedFixture(null);
        setSelectedOpening(null);
        setEngineSelected(null);
        setEngineSelectedRoom(payload.label_index, payload.sheet_id);
        setEngineSelectedFixture(null);
        setEngineSelectedOpening(null, null, null);
      } else if (action === "fixture-pick") {
        setSelectedFixture(payload);
        setSelected(null);
        setSelectedRoof(false);
        setSelectedRoom(null);
        setSelectedOpening(null);
        setEngineSelected(null);
        setEngineSelectedRoom(null);
        setEngineSelectedFixture(payload.fixture_index, payload.sheet_id);
        setEngineSelectedOpening(null, null, null);
      } else if (action === "opening-pick") {
        setSelectedOpening(payload);
        setSelected(null);
        setSelectedRoof(false);
        setSelectedRoom(null);
        setSelectedFixture(null);
        setEngineSelected(null);
        setEngineSelectedRoom(null);
        setEngineSelectedFixture(null);
        setEngineSelectedOpening(payload.opening_type, payload.opening_index, payload.sheet_id);
      } else if (action === "add-opening") {
        // Fire-and-forget: create the opening at the click point on the wall.
        createOpeningAtRef.current?.(payload).catch(() => {});
      } else if (action === "deselect") {
        setSelected(null);
        setSelectedRoof(false);
        setSelectedRoom(null);
        setSelectedFixture(null);
        setSelectedOpening(null);
        setEngineSelected(null);
        setEngineSelectedRoom(null);
        setEngineSelectedFixture(null);
        setEngineSelectedOpening(null, null, null);
      }
    });
    return () => engine.enableWallEditor(false);
  }, [editing, engineRef, setEngineSelected, setEngineSelectedRoom, setEngineSelectedFixture, setEngineSelectedOpening]);

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

  // Push/Pull — while active AND a wall is selected, dragging vertically
  // on the wall in the 3D viewport changes its height live. Commit on
  // release saves the new height to the sheet. This is a SketchUp-style
  // direct-manipulation alternative to the height slider — same effect,
  // more intuitive gesture.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.enablePushPullDrag) return;
    if (!pushPullMode || !selected) {
      engine.enablePushPullDrag(false);
      return;
    }
    engine.enablePushPullDrag(true, selected, async (kind, heightFt) => {
      if (kind === "preview") {
        // Live-update the selected height in-memory so the panel slider
        // reflects the drag. The actual mesh height isn't rebuilt until
        // the commit persists to the sheet.
        setSelected((prev) => prev ? { ...prev, height_ft: heightFt } : prev);
      } else if (kind === "commit") {
        try { await setWallHeight(heightFt); } catch { /* setError already handled */ }
      }
    });
    return () => engine.enablePushPullDrag(false);
  }, [pushPullMode, selected?.wall_id, selected?.sheet_id, engineRef, setWallHeight]);

  // ---------- Room editing (Session 4) ----------
  // Rooms are seeded by label positions. Persisting a change means
  // patching `sheet.labels[label_index]` with:
  //   floor_material     – palette id from FLOOR_MATERIALS
  //   ceiling_height_ft  – number, 7-14 ft (or null to clear)
  //   name_override      – user-typed name (falls back to label.text)
  // We use `_saveSheet` (PUT) so the labels array is re-saved as a whole.
  const _patchRoomLabel = useCallback(async (patch) => {
    if (!selectedRoom) return;
    const sheet = _getSheet(selectedRoom.sheet_id);
    if (!sheet) throw new Error("Sheet not found");
    const labels = Array.isArray(sheet.labels) ? sheet.labels : [];
    const idx = selectedRoom.label_index;
    if (idx < 0 || idx >= labels.length) throw new Error("Label not found");
    _pushUndo({
      sheet_id: sheet.id,
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels,
      fixtures: sheet.fixtures || [],
    });
    const nextLabels = [...labels];
    nextLabels[idx] = { ...nextLabels[idx], ...patch };
    await _saveSheet(sheet.id, {
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels:   nextLabels,
      fixtures: sheet.fixtures || [],
    });
    // Keep the in-panel state in sync so the sliders show the new value.
    setSelectedRoom((prev) => prev ? { ...prev, ...patch } : prev);
    await refreshBlueprint();
  }, [selectedRoom, _getSheet, _saveSheet, _pushUndo, refreshBlueprint]);

  const setRoomFloor = useCallback(async (material_id) => {
    setBusy(true); setError("");
    try { await _patchRoomLabel({ floor_material: material_id }); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Floor material update failed"); }
    finally { setBusy(false); }
  }, [_patchRoomLabel]);

  const setRoomCeilingHeight = useCallback(async (height_ft) => {
    setBusy(true); setError("");
    try {
      // null clears the override (falls back to wall height / no drop ceiling)
      const h = (height_ft === null || height_ft === undefined) ? null : Number(height_ft);
      await _patchRoomLabel({ ceiling_height_ft: h });
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Ceiling height update failed");
    } finally { setBusy(false); }
  }, [_patchRoomLabel]);

  const setRoomName = useCallback(async (name) => {
    setBusy(true); setError("");
    try { await _patchRoomLabel({ name_override: (name || "").slice(0, 80) }); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Room name update failed"); }
    finally { setBusy(false); }
  }, [_patchRoomLabel]);

  // ---------- Fixture editing (Session 5) ----------
  // Persist fixture position / rotation / delete by rewriting the sheet's
  // fixtures array through the same _saveSheet PUT.
  const _patchFixture = useCallback(async (patch, opts = {}) => {
    if (!selectedFixture) return;
    const sheet = _getSheet(selectedFixture.sheet_id);
    if (!sheet) throw new Error("Sheet not found");
    const fixtures = Array.isArray(sheet.fixtures) ? sheet.fixtures : [];
    const idx = selectedFixture.fixture_index;
    if (idx < 0 || idx >= fixtures.length) throw new Error("Fixture not found");
    if (!opts.skipUndo) {
      _pushUndo({
        sheet_id: sheet.id,
        walls:    sheet.walls    || [],
        doors:    sheet.doors    || [],
        windows:  sheet.windows  || [],
        labels:   sheet.labels   || [],
        fixtures,
      });
    }
    const nextFixtures = [...fixtures];
    if (patch === null) {
      nextFixtures.splice(idx, 1);
    } else {
      nextFixtures[idx] = { ...nextFixtures[idx], ...patch };
    }
    await _saveSheet(sheet.id, {
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels:   sheet.labels   || [],
      fixtures: nextFixtures,
    });
    if (patch === null) {
      setSelectedFixture(null);
    } else {
      setSelectedFixture((prev) => prev ? { ...prev, ...patch } : prev);
    }
    await refreshBlueprint();
  }, [selectedFixture, _getSheet, _saveSheet, _pushUndo, refreshBlueprint]);

  const setFixtureRotation = useCallback(async (deg) => {
    setBusy(true); setError("");
    try { await _patchFixture({ rotation_deg: Number(deg) || 0 }); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Fixture rotate failed"); }
    finally { setBusy(false); }
  }, [_patchFixture]);

  // Live preview: update engine rotation without saving; final commit is a
  // separate call once the slider is released.
  const previewFixtureRotation = useCallback((deg) => {
    if (!selectedFixture) return;
    engineRef.current?.setFixtureRotation?.(
      selectedFixture.fixture_index,
      selectedFixture.sheet_id,
      Number(deg) || 0,
    );
  }, [selectedFixture, engineRef]);

  const deleteFixture = useCallback(async () => {
    setBusy(true); setError("");
    try { await _patchFixture(null); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Fixture delete failed"); }
    finally { setBusy(false); }
  }, [_patchFixture]);

  // Enable fixture drag whenever a fixture is selected.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.enableFixtureDrag) return;
    if (!selectedFixture) {
      engine.enableFixtureDrag(false);
      return;
    }
    engine.enableFixtureDrag(true, async (kind, payload) => {
      if (kind !== "commit") return;
      setBusy(true); setError("");
      try { await _patchFixture({ position: payload.position_ft }); }
      catch (e) { setError(e?.response?.data?.detail || e?.message || "Fixture move failed"); }
      finally { setBusy(false); }
    });
    return () => engine.enableFixtureDrag(false);
  }, [selectedFixture?.fixture_index, selectedFixture?.sheet_id, engineRef, _patchFixture]);

  // ---------- Opening editing (Session 6) ----------
  const _patchOpening = useCallback(async (patch, opts = {}) => {
    if (!selectedOpening) return;
    const sheet = _getSheet(selectedOpening.sheet_id);
    if (!sheet) throw new Error("Sheet not found");
    const key = selectedOpening.opening_type === "door" ? "doors" : "windows";
    const arr = Array.isArray(sheet[key]) ? sheet[key] : [];
    const idx = selectedOpening.opening_index;
    if (idx < 0 || idx >= arr.length) throw new Error("Opening not found");
    if (!opts.skipUndo) {
      _pushUndo({
        sheet_id: sheet.id,
        walls:    sheet.walls    || [],
        doors:    sheet.doors    || [],
        windows:  sheet.windows  || [],
        labels:   sheet.labels   || [],
        fixtures: sheet.fixtures || [],
      });
    }
    const nextArr = [...arr];
    if (patch === null) {
      nextArr.splice(idx, 1);
    } else {
      nextArr[idx] = { ...nextArr[idx], ...patch };
    }
    const payload = {
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels:   sheet.labels   || [],
      fixtures: sheet.fixtures || [],
    };
    payload[key] = nextArr;
    await _saveSheet(sheet.id, payload);
    if (patch === null) {
      setSelectedOpening(null);
    } else {
      setSelectedOpening((prev) => prev ? { ...prev, ...patch, width_ft: patch.width ?? prev.width_ft } : prev);
    }
    await refreshBlueprint();
  }, [selectedOpening, _getSheet, _saveSheet, _pushUndo, refreshBlueprint]);

  const setOpeningWidth = useCallback(async (width_ft) => {
    setBusy(true); setError("");
    try { await _patchOpening({ width: Math.max(1.5, Math.min(12, Number(width_ft) || 3)) }); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Opening resize failed"); }
    finally { setBusy(false); }
  }, [_patchOpening]);

  const deleteOpening = useCallback(async () => {
    setBusy(true); setError("");
    try { await _patchOpening(null); }
    catch (e) { setError(e?.response?.data?.detail || e?.message || "Opening delete failed"); }
    finally { setBusy(false); }
  }, [_patchOpening]);

  // Enable opening drag whenever an opening is selected.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.enableOpeningDrag) return;
    if (!selectedOpening) {
      engine.enableOpeningDrag(false);
      return;
    }
    engine.enableOpeningDrag(true, async (kind, payload) => {
      if (kind !== "commit") return;
      setBusy(true); setError("");
      try { await _patchOpening({ position: payload.position_ft, wall_index: payload.wall_index }); }
      catch (e) { setError(e?.response?.data?.detail || e?.message || "Opening move failed"); }
      finally { setBusy(false); }
    });
    return () => engine.enableOpeningDrag(false);
  }, [selectedOpening?.opening_type, selectedOpening?.opening_index, selectedOpening?.sheet_id, engineRef, _patchOpening]);

  // Add-opening mode — clicking a wall in the 3D scene fires "add-opening"
  // which invokes _createOpeningAt below. Mode is toggled by the panel's
  // "+ DOOR" / "+ WINDOW" buttons; engine cursor changes to crosshair.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.setAddOpeningMode) return;
    engine.setAddOpeningMode(addOpeningMode);
  }, [addOpeningMode, engineRef]);

  const _createOpeningAt = useCallback(async (payload) => {
    // payload = { opening_type, wall_index, wall_id, sheet_id, position_ft }
    const sheet = _getSheet(payload.sheet_id);
    if (!sheet) return;
    const key = payload.opening_type === "door" ? "doors" : "windows";
    const arr = Array.isArray(sheet[key]) ? sheet[key] : [];
    _pushUndo({
      sheet_id: sheet.id,
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels:   sheet.labels   || [],
      fixtures: sheet.fixtures || [],
    });
    const newItem = {
      id: `${payload.opening_type[0]}-${Date.now()}`,
      position: payload.position_ft,
      width: payload.opening_type === "door" ? 3 : 4,
      wall_index: payload.wall_index,
    };
    const nextArr = [...arr, newItem];
    const patch = {
      walls:    sheet.walls    || [],
      doors:    sheet.doors    || [],
      windows:  sheet.windows  || [],
      labels:   sheet.labels   || [],
      fixtures: sheet.fixtures || [],
    };
    patch[key] = nextArr;
    setBusy(true); setError("");
    try {
      await _saveSheet(sheet.id, patch);
      await refreshBlueprint();
      // Exit add mode and select the freshly-created opening
      setAddOpeningMode(null);
      setSelectedOpening({
        opening_type: payload.opening_type,
        opening_index: nextArr.length - 1,
        opening_id: newItem.id,
        wall_index: payload.wall_index,
        sheet_id: payload.sheet_id,
        width_ft: newItem.width,
      });
      setEngineSelectedOpening(payload.opening_type, nextArr.length - 1, payload.sheet_id);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Add opening failed");
    } finally { setBusy(false); }
  }, [_getSheet, _saveSheet, _pushUndo, refreshBlueprint, setEngineSelectedOpening]);

  // Bind the ref so the enableWallEditor click handler (declared earlier)
  // can call the latest _createOpeningAt without a TDZ error.
  useEffect(() => { createOpeningAtRef.current = _createOpeningAt; }, [_createOpeningAt]);

  // ---------- Trim tags on walls (Session 7) ----------
  // Toggle boolean flags on the selected wall: trim_baseboard,
  // trim_crown, trim_chair_rail. Door/window casings are auto-derived
  // from openings on the wall — no per-wall toggle needed.
  const setWallTrim = useCallback(async (patch) => {
    if (!selected) return;
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
      nextWalls[idx] = { ...nextWalls[idx], ...patch };
      await _saveSheet(sheet.id, {
        walls: nextWalls,
        doors: sheet.doors || [],
        windows: sheet.windows || [],
        labels: sheet.labels || [],
        fixtures: sheet.fixtures || [],
      });
      setSelected((prev) => prev ? { ...prev, ...patch } : prev);
      await refreshBlueprint();
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Trim update failed");
    } finally { setBusy(false); }
  }, [selected, _getSheet, _saveSheet, _pushUndo, refreshBlueprint]);

  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null); setCutMode(false); setEngineSelected(null);
        setSelectedFixture(null); setEngineSelectedFixture(null);
        setSelectedOpening(null); setEngineSelectedOpening(null, null, null);
        setAddOpeningMode(null);
        setPushPullMode(false);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !busy) {
        if (selected) deleteSelected();
        else if (selectedFixture) deleteFixture();
        else if (selectedOpening) deleteOpening();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selected, selectedFixture, selectedOpening, busy, deleteSelected, deleteFixture, deleteOpening, undo, redo, setEngineSelected, setEngineSelectedFixture, setEngineSelectedOpening]);

  return {
    editing, setEditing,
    selected, cutMode, setCutMode,
    selectedRoof, setSelectedRoof,
    selectedRoom, setSelectedRoom,
    selectedFixture, setSelectedFixture,
    selectedOpening, setSelectedOpening,
    addOpeningMode, setAddOpeningMode,
    pushPullMode, setPushPullMode,
    busy, error,
    deleteSelected, undo, redo,
    setWallHeight,
    updateRoof,
    setRoomFloor, setRoomCeilingHeight, setRoomName,
    setFixtureRotation, previewFixtureRotation, deleteFixture,
    setOpeningWidth, deleteOpening,
    setWallTrim,
    blueprintRoof: {
      type:  blueprint?.roof_type      || "gable",
      pitch: blueprint?.roof_pitch_deg ?? 12,
      color: blueprint?.roof_color     || "#7A2E2E",
    },
    canUndo: () => undoRef.current.length > 0,
    canRedo: () => redoRef.current.length > 0,
  };
}
