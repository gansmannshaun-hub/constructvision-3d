import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { wallsAabb } from "../../lib/dim";
import { RENDERER_API as API } from "./format";

/**
 * Owns the 3D model's placement transform on the satellite plane, plus
 * the AI Match (GPT-4o vision) sizing flow.
 */
export function useModelPlacement({ engineRef, currentProjectId, site, setSite, walls }) {
  const [placing, setPlacing] = useState(false);
  const [transform, setTransform] = useState({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
  const [savingTransform, setSavingTransform] = useState(false);
  const transformBackupRef = useRef(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiRefLabel, setAiRefLabel] = useState("");
  const [aiRefFeet, setAiRefFeet] = useState("");

  // Sync transform to the engine whenever the site's saved transform changes.
  useEffect(() => {
    if (site?.model_transform) {
      engineRef.current?.setModelTransform(site.model_transform);
      setTransform({
        x: site.model_transform.x || 0,
        z: site.model_transform.z || 0,
        rotation_deg: site.model_transform.rotation_deg || 0,
        scale: site.model_transform.scale || 1,
      });
    } else {
      engineRef.current?.setModelTransform({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
      setTransform({ x: 0, z: 0, rotation_deg: 0, scale: 1 });
    }
  }, [site, engineRef]);

  const startPlacement = useCallback(() => {
    if (!engineRef.current || !site) return;
    transformBackupRef.current = engineRef.current.getModelTransform();
    setPlacing(true);
    engineRef.current.enablePlacement(true, (t) => setTransform(t));
    setTransform(engineRef.current.getModelTransform());
  }, [site, engineRef]);

  const cancelPlacement = useCallback(() => {
    if (!engineRef.current) return;
    engineRef.current.enablePlacement(false);
    if (transformBackupRef.current) {
      engineRef.current.setModelTransform(transformBackupRef.current);
      setTransform(transformBackupRef.current);
    }
    setPlacing(false);
  }, [engineRef]);

  const onRotationChange = useCallback((deg) => {
    if (!engineRef.current) return;
    const next = { ...transform, rotation_deg: Number(deg) || 0 };
    setTransform(next);
    engineRef.current.setModelTransform(next);
  }, [transform, engineRef]);

  const onScaleChange = useCallback((s) => {
    if (!engineRef.current) return;
    const next = { ...transform, scale: Math.max(0.1, Math.min(10, Number(s) || 1)) };
    setTransform(next);
    engineRef.current.setModelTransform(next);
  }, [transform, engineRef]);

  const resetTransform = useCallback(() => {
    if (!engineRef.current) return;
    const zero = { x: 0, z: 0, rotation_deg: 0, scale: 1 };
    setTransform(zero);
    engineRef.current.setModelTransform(zero);
  }, [engineRef]);

  const savePlacement = useCallback(async () => {
    if (!engineRef.current || !currentProjectId) return;
    setSavingTransform(true);
    try {
      const t = engineRef.current.getModelTransform();
      const token = localStorage.getItem("cm_token");
      await axios.patch(
        `${API}/projects/${currentProjectId}/site/transform`,
        t, { headers: { Authorization: `Bearer ${token}` } },
      );
      setSite((s) => s ? { ...s, model_transform: t } : s);
      transformBackupRef.current = t;
      engineRef.current.enablePlacement(false);
      setPlacing(false);
    } catch (e) {
      alert("Failed to save placement: " + (e?.response?.data?.detail || e?.message));
    } finally {
      setSavingTransform(false);
    }
  }, [currentProjectId, engineRef, setSite]);

  const openAIMatch = useCallback(() => {
    setAiOpen(true);
    setAiResult(null);
    setAiError("");
  }, []);

  const runAIMatch = useCallback(async () => {
    if (!engineRef.current || !currentProjectId) return;
    const aabb = wallsAabb(walls);
    if (!aabb || aabb.w < 0.5 || aabb.h < 0.5) {
      setAiError("Need a blueprint with walls before AI Match can run.");
      return;
    }
    setAiBusy(true);
    setAiError("");
    setAiResult(null);
    try {
      const token = localStorage.getItem("cm_token");
      const refFeet = Number(aiRefFeet);
      const { data } = await axios.post(
        `${API}/projects/${currentProjectId}/site/auto-scale`,
        {
          blueprint_width_ft: aabb.w,
          blueprint_depth_ft: aabb.h,
          reference_label: aiRefLabel.trim() || null,
          reference_feet: Number.isFinite(refFeet) && refFeet > 0 ? refFeet : null,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setAiResult(data);
      if (data.applied) {
        const next = { ...transform, scale: data.scale };
        setTransform(next);
        engineRef.current.setModelTransform(next);
      }
    } catch (e) {
      const d = e?.response?.data?.detail;
      setAiError(typeof d === "string" ? d : (Array.isArray(d) ? d.map(x => x.msg).join("; ") : "AI Match failed"));
    } finally {
      setAiBusy(false);
    }
  }, [currentProjectId, walls, aiRefLabel, aiRefFeet, transform, engineRef]);

  return {
    placing, transform, savingTransform,
    startPlacement, cancelPlacement,
    onRotationChange, onScaleChange, resetTransform, savePlacement,
    aiOpen, setAiOpen, aiBusy, aiResult, aiError,
    aiRefLabel, setAiRefLabel, aiRefFeet, setAiRefFeet,
    openAIMatch, runAIMatch,
  };
}
