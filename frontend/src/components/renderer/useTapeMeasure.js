import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { RENDERER_API as API, fallbackFmtFtIn } from "./format";

/**
 * Owns tape-measure state: measurements list, tool activation, snap
 * preference, live pick status/preview, and CRUD against the backend.
 */
export function useTapeMeasure({ engineRef, currentProjectId }) {
  const [measuring, setMeasuring] = useState(false);
  const [measurements, setMeasurements] = useState([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [pickStatus, setPickStatus] = useState("idle");
  const [measurePreview, setMeasurePreview] = useState(null);

  // Load saved measurements for this project.
  useEffect(() => {
    if (!currentProjectId) { setMeasurements([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("cm_token");
        const { data } = await axios.get(
          `${API}/projects/${currentProjectId}/measurements`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!cancelled) {
          setMeasurements(data || []);
          engineRef.current?.setMeasurements(data || []);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [currentProjectId, engineRef]);

  useEffect(() => {
    engineRef.current?.setMeasurements(measurements);
  }, [measurements, engineRef]);

  const persistMeasurement = useCallback(async ({ start, end, distance_ft }) => {
    if (!currentProjectId) return;
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/measurements`,
        { start, end, distance_ft },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMeasurements((prev) => [...prev, data]);
      engineRef.current?.addMeasurement(data);
      return data;
    } catch (e) {
      alert("Failed to save measurement: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, engineRef]);

  const deleteMeasurement = useCallback(async (id) => {
    if (!currentProjectId) return;
    try {
      const token = localStorage.getItem("cm_token");
      await axios.delete(
        `${API}/projects/${currentProjectId}/measurements/${id}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setMeasurements((prev) => prev.filter((m) => m.id !== id));
      engineRef.current?.removeMeasurement(id);
    } catch (e) {
      alert("Failed to delete: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, engineRef]);

  const startMeasure = useCallback(() => {
    if (!engineRef.current) return;
    setMeasuring(true);
    setPickStatus("idle");
    setMeasurePreview(null);
    engineRef.current.setSnapEnabled(snapEnabled);
    engineRef.current.enableMeasureTool(true, (action, payload) => {
      if (action === "first-pick") {
        setPickStatus("first");
        setMeasurePreview(null);
      } else if (action === "cancel-pick") {
        setPickStatus("idle");
      } else if (action === "measured") {
        setPickStatus("measured");
        setMeasurePreview(payload);
        persistMeasurement(payload);
        setTimeout(() => setPickStatus("idle"), 200);
      }
    });
  }, [snapEnabled, persistMeasurement, engineRef]);

  const stopMeasure = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.enableMeasureTool(false);
    setMeasuring(false);
    setPickStatus("idle");
    setMeasurePreview(null);
  }, [engineRef]);

  const toggleSnap = useCallback(() => {
    setSnapEnabled((prev) => {
      const next = !prev;
      engineRef.current?.setSnapEnabled(next);
      return next;
    });
  }, [engineRef]);

  const fmtFtIn = useCallback((ft) => {
    if (engineRef.current?.formatFtIn) return engineRef.current.formatFtIn(ft);
    return fallbackFmtFtIn(ft);
  }, [engineRef]);

  return {
    measuring, measurements, snapEnabled, pickStatus, measurePreview,
    startMeasure, stopMeasure, toggleSnap, deleteMeasurement, fmtFtIn,
  };
}
