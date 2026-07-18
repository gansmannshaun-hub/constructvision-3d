import { useCallback, useEffect, useRef, useState } from "react";

const HISTORY_LIMIT = 100;

/**
 * Undo/redo history for the CAD editor. Snapshots `{walls, doors, windows,
 * labels, fixtures}` whenever any of those arrays change reference, and
 * exposes `undo()` / `redo()` that restore prior snapshots into the caller's
 * setters.
 *
 * Callers pass:
 *   - the five arrays (`walls`, `doors`, `windows`, `labels`, `fixtures`)
 *   - the five corresponding setters
 *   - `blueprint` (from the store) — used to seed a fresh history when the
 *     store's blueprint reference changes (e.g. after sheet switch)
 *   - `onRestore` — an optional callback fired after undo/redo restores,
 *     used to clear tool-specific state (pendingStart, rectStart, etc.)
 *   - `savingRef` — a ref set to `true` immediately before Save & Sync so
 *     the blueprint refresh that follows doesn't clobber the undo stack.
 *
 * Returns:
 *   - `undo`, `redo`  — action callbacks
 *   - `canUndo`, `canRedo` — booleans for button disabled states
 *   - `noteDragStart()`, `noteDragEnd()` — suppress snapshots during a
 *     continuous drag; caller pushes one final snapshot via `noteDragEnd`.
 *   - `isRestoringRef` — ref exposed so the tracker effect can distinguish
 *     restoration-driven state changes from real edits (already handled).
 */
export function useCadHistory({
  blueprint,
  walls, doors, windows, labels, fixtures,
  setWalls, setDoors, setWindows, setLabels, setFixtures,
  onRestore,
  savingRef,
}) {
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const isRestoringRef = useRef(false);
  const dragInProgressRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const refreshFlags = useCallback(() => {
    setCanUndo(historyRef.current.length > 1);
    setCanRedo(redoRef.current.length > 0);
  }, []);

  // Seed / reset history on blueprint change (sheet switch or store rehydrate).
  // Skips the reset if the blueprint refresh was triggered by our own Save &
  // Sync — that path signals via `savingRef.current = true` so users can still
  // Ctrl+Z past a save.
  useEffect(() => {
    if (savingRef?.current) {
      savingRef.current = false;
      return;
    }
    isRestoringRef.current = true;
    setWalls(blueprint.walls || []);
    setDoors(blueprint.doors || []);
    setWindows(blueprint.windows || []);
    setLabels(blueprint.labels || []);
    setFixtures(blueprint.fixtures || []);
    historyRef.current = [{
      walls: blueprint.walls || [],
      doors: blueprint.doors || [],
      windows: blueprint.windows || [],
      labels: blueprint.labels || [],
      fixtures: blueprint.fixtures || [],
    }];
    redoRef.current = [];
    refreshFlags();
  }, [blueprint]);

  // Push a snapshot after user edits. React 18 batches state updates so
  // one effect run corresponds to one user action. We also skip during
  // continuous drags — the caller pushes one snapshot on drag end.
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    if (dragInProgressRef.current) return;
    const last = historyRef.current[historyRef.current.length - 1];
    if (
      last && last.walls === walls && last.doors === doors && last.windows === windows &&
      last.labels === labels && last.fixtures === fixtures
    ) return;
    historyRef.current.push({ walls, doors, windows, labels, fixtures });
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
    refreshFlags();
  }, [walls, doors, windows, labels, fixtures, refreshFlags]);

  const undo = useCallback(() => {
    if (historyRef.current.length < 2) return;
    const current = historyRef.current.pop();
    redoRef.current.push(current);
    if (redoRef.current.length > HISTORY_LIMIT) redoRef.current.shift();
    const prev = historyRef.current[historyRef.current.length - 1];
    isRestoringRef.current = true;
    setWalls(prev.walls);
    setDoors(prev.doors);
    setWindows(prev.windows);
    setLabels(prev.labels);
    setFixtures(prev.fixtures);
    onRestore?.();
    refreshFlags();
  }, [setWalls, setDoors, setWindows, setLabels, setFixtures, onRestore, refreshFlags]);

  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current.pop();
    historyRef.current.push(next);
    isRestoringRef.current = true;
    setWalls(next.walls);
    setDoors(next.doors);
    setWindows(next.windows);
    setLabels(next.labels);
    setFixtures(next.fixtures);
    onRestore?.();
    refreshFlags();
  }, [setWalls, setDoors, setWindows, setLabels, setFixtures, onRestore, refreshFlags]);

  const noteDragStart = useCallback(() => { dragInProgressRef.current = true; }, []);
  const noteDragEnd = useCallback(() => {
    dragInProgressRef.current = false;
    // Push one snapshot representing the drag's final state.
    const last = historyRef.current[historyRef.current.length - 1];
    if (
      last && last.walls === walls && last.doors === doors && last.windows === windows &&
      last.labels === labels && last.fixtures === fixtures
    ) return;
    historyRef.current.push({ walls, doors, windows, labels, fixtures });
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
    refreshFlags();
  }, [walls, doors, windows, labels, fixtures, refreshFlags]);

  return { undo, redo, canUndo, canRedo, noteDragStart, noteDragEnd, isRestoringRef };
}
