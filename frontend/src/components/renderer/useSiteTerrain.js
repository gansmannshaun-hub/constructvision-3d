import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { RENDERER_API as API } from "./format";

/**
 * Owns satellite-site + 3D-terrain state and API interactions.
 * The scene engine is a side-effect target: whenever site or exaggeration
 * changes, the engine is re-synced.
 */
export function useSiteTerrain(engineRef, currentProjectId) {
  const [site, setSite] = useState(null);
  const [buildingLandscape, setBuildingLandscape] = useState(false);
  const [landscapeError, setLandscapeError] = useState("");
  const [terrainStats, setTerrainStats] = useState(null);
  const [verticalExag, setVerticalExag] = useState(3);

  // Load the project's site whenever the project changes.
  useEffect(() => {
    if (!currentProjectId) { setSite(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem("cm_token");
        const { data } = await axios.get(`${API}/projects/${currentProjectId}/site`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setSite(data?.captured ? data : null);
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
  }, [currentProjectId]);

  // Push site (and any saved terrain) into the engine when it changes.
  useEffect(() => {
    engineRef.current?.setSite(site);
    if (site?.terrain_3d && engineRef.current?.setSiteTerrain) {
      const stats = engineRef.current.setSiteTerrain(site, site.terrain_3d,
        { verticalExaggeration: verticalExag });
      setTerrainStats(stats || null);
    } else {
      setTerrainStats(null);
    }
    // Intentionally omit verticalExag: exag changes are handled by onExagChange.
  }, [site]);

  const buildLandscape = useCallback(async () => {
    if (!currentProjectId || !site) return;
    setBuildingLandscape(true);
    setLandscapeError("");
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/site/build-3d`,
        {},
        { headers: { Authorization: `Bearer ${token}` }, timeout: 90_000 },
      );
      setSite((s) => s ? { ...s, terrain_3d: data } : s);
      const stats = engineRef.current?.setSiteTerrain(
        { ...site, terrain_3d: data }, data, { verticalExaggeration: verticalExag },
      );
      setTerrainStats(stats || null);
      engineRef.current?.tiltCameraOblique();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setLandscapeError(typeof d === "string" ? d : (e?.message || "Build 3D landscape failed"));
    } finally {
      setBuildingLandscape(false);
    }
  }, [currentProjectId, site, verticalExag, engineRef]);

  const onExagChange = useCallback((v) => {
    const value = Math.max(1, Math.min(10, Number(v) || 1));
    setVerticalExag(value);
    if (site?.terrain_3d && engineRef.current?.setTerrainExaggeration) {
      const stats = engineRef.current.setTerrainExaggeration(value, site, site.terrain_3d);
      setTerrainStats(stats || null);
    }
  }, [site, engineRef]);

  const persistFeatures = useCallback(async (newFeatures) => {
    if (!currentProjectId || !site?.terrain_3d) return;
    const nextTerrain = { ...site.terrain_3d, features_3d: newFeatures };
    const nextSite = { ...site, terrain_3d: nextTerrain };
    setSite(nextSite);
    const stats = engineRef.current?.setSiteTerrain(
      nextSite, nextTerrain, { verticalExaggeration: verticalExag },
    );
    setTerrainStats(stats || null);
    try {
      const token = localStorage.getItem("cm_token");
      await axios.patch(
        `${API}/projects/${currentProjectId}/site/terrain/features`,
        { features_3d: newFeatures },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (e) {
      alert("Failed to save: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, site, verticalExag, engineRef]);

  const toggleFeatureHidden = useCallback((idx) => {
    const list = site?.terrain_3d?.features_3d || [];
    const next = list.map((f, i) => i === idx ? { ...f, hidden: !f.hidden } : f);
    persistFeatures(next);
  }, [site, persistFeatures]);

  const deleteFeature = useCallback((idx) => {
    const list = site?.terrain_3d?.features_3d || [];
    const next = list.filter((_, i) => i !== idx);
    persistFeatures(next);
  }, [site, persistFeatures]);

  const clearLandscape = useCallback(async () => {
    if (!currentProjectId || !site) return;
    try {
      const token = localStorage.getItem("cm_token");
      await axios.delete(
        `${API}/projects/${currentProjectId}/site/build-3d`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setSite((s) => {
        if (!s) return s;
        const next = { ...s };
        delete next.terrain_3d;
        return next;
      });
      setTerrainStats(null);
      engineRef.current?.clearSiteTerrain();
    } catch (e) {
      alert("Failed to clear landscape: " + (e?.response?.data?.detail || e?.message));
    }
  }, [currentProjectId, site, engineRef]);

  return {
    site, setSite,
    terrainStats,
    verticalExag,
    buildingLandscape, landscapeError,
    buildLandscape, clearLandscape,
    onExagChange,
    toggleFeatureHidden, deleteFeature,
  };
}
