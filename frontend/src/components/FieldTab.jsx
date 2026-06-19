import React, { useEffect, useRef, useState } from "react";
import { apiClient, useStore, API } from "../store";

/** Coerce FastAPI's `detail` (string | array<{msg}>) to a single display string. */
function errText(err, fallback = "Something went wrong") {
  const d = err?.response?.data?.detail;
  if (!d) return err?.message || fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
  try { return JSON.stringify(d); } catch { return fallback; }
}

/**
 * Field tab — Daily Logs, Site Photos (AI progress %), Progress Summary, LiDAR.
 * Layout: left rail = sub-tabs · right = active panel.
 */
const SUBTABS = [
  { id: "log", label: "Daily Logs", hint: "01" },
  { id: "photos", label: "Site Photos", hint: "02" },
  { id: "progress", label: "Progress", hint: "03" },
  { id: "lidar", label: "LiDAR / 3D Scan", hint: "04" },
];

export default function FieldTab() {
  const { currentProjectId } = useStore();
  const [sub, setSub] = useState("log");

  if (!currentProjectId) return null;

  return (
    <div className="h-full grid grid-cols-[180px_1fr]" data-testid="field-tab">
      <aside className="border-r border-white/10 bg-[#0d0d0d] py-3">
        {SUBTABS.map((t) => {
          const active = sub === t.id;
          return (
            <button
              key={t.id}
              data-testid={`field-subtab-${t.id}`}
              onClick={() => setSub(t.id)}
              className={`w-full text-left px-5 py-3 transition-colors border-l-2 flex items-center gap-3 ${
                active
                  ? "border-[#FFCC00] bg-white/5 text-white"
                  : "border-transparent text-neutral-500 hover:text-white hover:bg-white/5"
              }`}
            >
              <span className={`label-mono ${active ? "text-[#FFCC00]" : ""}`}>{t.hint}</span>
              <span className="text-xs uppercase tracking-wider font-medium">{t.label}</span>
            </button>
          );
        })}
      </aside>
      <section className="overflow-auto">
        {sub === "log" && <DailyLogsPanel projectId={currentProjectId} />}
        {sub === "photos" && <SitePhotosPanel projectId={currentProjectId} />}
        {sub === "progress" && <ProgressPanel projectId={currentProjectId} />}
        {sub === "lidar" && <LidarPanel projectId={currentProjectId} />}
      </section>
    </div>
  );
}

// ============================== Daily Logs ==============================

function DailyLogsPanel({ projectId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [notes, setNotes] = useState("");
  const [crew, setCrew] = useState(0);
  const [fetchWx, setFetchWx] = useState(true);
  const [siteCaptured, setSiteCaptured] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/daily-logs`);
      setLogs(data);
      const { data: site } = await apiClient.get(`/projects/${projectId}/site`);
      setSiteCaptured(!!site?.captured);
    } catch (e) {
      setErr(errText(e, "Failed to load"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [projectId]);

  const submit = async (e) => {
    e.preventDefault();
    setCreating(true);
    setErr("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      await apiClient.post(`/projects/${projectId}/daily-logs`, {
        log_date: today,
        notes,
        crew_size: Number(crew) || 0,
        fetch_weather: Boolean(fetchWx && siteCaptured),
      });
      setNotes("");
      setCrew(0);
      await load();
    } catch (e) {
      setErr(errText(e, "Failed to save log"));
    } finally {
      setCreating(false);
    }
  };

  const removeLog = async (id) => {
    if (!window.confirm("Delete this log and its attached photos?")) return;
    try {
      await apiClient.delete(`/daily-logs/${id}`);
      await load();
    } catch (e) {
      alert(errText(e, "Failed to delete"));
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="label-mono">// FIELD · 01</div>
        <h1 className="font-display text-3xl tracking-tighter mt-1">Daily logs</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Capture crew, weather (NOAA), and a narrative from the jobsite each day.
        </p>
      </div>

      <form
        onSubmit={submit}
        data-testid="daily-log-form"
        className="border border-white/10 bg-[#0f0f0f] p-5 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4 items-start">
          <div>
            <label className="label-mono block mb-1.5">Crew size</label>
            <input
              type="number"
              min="0"
              max="200"
              value={crew}
              onChange={(e) => setCrew(e.target.value)}
              data-testid="daily-log-crew"
              className="w-full bg-black border border-white/10 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="label-mono block mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="What got done today, blockers, deliveries, inspections…"
              data-testid="daily-log-notes"
              className="w-full bg-black border border-white/10 px-3 py-2 font-mono text-sm h-24"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fetchWx}
              onChange={(e) => setFetchWx(e.target.checked)}
              disabled={!siteCaptured}
              data-testid="daily-log-fetch-weather"
            />
            <span className={siteCaptured ? "text-neutral-300" : "text-neutral-600"}>
              Auto-fetch NOAA weather
              {!siteCaptured && (
                <span className="ml-1 text-[#FF8866]">· capture a site first</span>
              )}
            </span>
          </label>
          <button
            type="submit"
            disabled={creating}
            data-testid="daily-log-submit"
            className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-50 text-black font-bold px-5 py-2 uppercase tracking-wider text-sm"
          >
            {creating ? "Saving…" : "Save log"}
          </button>
        </div>
        {err && <div className="text-xs text-[#FF6666] font-mono">{err}</div>}
      </form>

      {loading ? (
        <div className="text-sm text-neutral-500 font-mono">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
          No logs yet. The first one writes today&apos;s date and pulls weather automatically.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="daily-log-list">
          {logs.map((l) => (
            <li key={l.id} className="border border-white/10 bg-[#0f0f0f] p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-display text-xl tracking-tighter">{l.log_date}</span>
                  <span className="label-mono text-neutral-500">
                    by {l.author_name || l.author_email}
                  </span>
                  <span className="label-mono text-[#5588FF]">crew: {l.crew_size}</span>
                </div>
                <button
                  onClick={() => removeLog(l.id)}
                  data-testid={`daily-log-delete-${l.id}`}
                  className="label-mono text-[#FF6666] hover:text-[#FF3333]"
                >
                  delete
                </button>
              </div>
              {l.weather && !l.weather.error && (
                <div className="mt-2 text-xs font-mono text-neutral-300 flex items-center gap-3 flex-wrap">
                  <span>{l.weather.temperature_f}°F</span>
                  <span>{l.weather.short_forecast}</span>
                  <span className="text-neutral-500">
                    wind {l.weather.wind} {l.weather.wind_direction}
                  </span>
                  <span className="text-neutral-600">via NOAA</span>
                </div>
              )}
              {l.weather?.error && (
                <div className="mt-2 text-xs font-mono text-[#FF8866]">
                  weather unavailable: {l.weather.error}
                </div>
              )}
              {l.notes && (
                <div className="mt-3 text-sm text-neutral-200 whitespace-pre-wrap">{l.notes}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================== Site Photos ==============================

function SitePhotosPanel({ projectId }) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState("");
  const [selected, setSelected] = useState(null);
  const inputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/site-photos`);
      setPhotos(data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [projectId]);

  const onFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("caption", caption);
      await apiClient.post(`/projects/${projectId}/site-photos`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setCaption("");
      await load();
    } catch (e) {
      alert(errText(e, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="label-mono">// FIELD · 02</div>
        <h1 className="font-display text-3xl tracking-tighter mt-1">Site progress photos</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Drop a jobsite photo — GPT-4o vision estimates % complete for each construction phase.
        </p>
      </div>

      <div className="border border-white/10 bg-[#0f0f0f] p-5 space-y-3">
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional, e.g. 'East wall framing — Day 12')"
          maxLength={240}
          data-testid="photo-caption"
          className="w-full bg-black border border-white/10 px-3 py-2 font-mono text-sm"
        />
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            data-testid="photo-input"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            data-testid="photo-upload-btn"
            className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-50 text-black font-bold px-5 py-2 uppercase tracking-wider text-sm"
          >
            {uploading ? "Analyzing…" : "+ Upload photo"}
          </button>
          <span className="label-mono text-neutral-500">
            JPG/PNG up to 8MB · AI tags phases automatically
          </span>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500 font-mono">Loading…</div>
      ) : photos.length === 0 ? (
        <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
          No site photos yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="photo-grid">
          {photos.map((p) => (
            <button
              key={p.id}
              data-testid={`photo-card-${p.id}`}
              onClick={() => setSelected(p)}
              className="text-left border border-white/10 bg-[#0f0f0f] hover:border-[#FFCC00] transition-colors p-3 space-y-2"
            >
              <div className="font-mono text-xs text-neutral-400 truncate">
                {p.filename || "(photo)"}
              </div>
              {p.caption && (
                <div className="text-sm text-neutral-200 line-clamp-2">{p.caption}</div>
              )}
              <div className="text-xs text-neutral-300">
                {p.analysis?.summary || "—"}
              </div>
              <div className="flex flex-wrap gap-1 pt-1">
                {(p.analysis?.phases || []).slice(0, 4).map((ph, idx) => (
                  <span
                    key={idx}
                    className="label-mono bg-[#0055FF]/20 text-[#88AAFF] px-2 py-0.5 border border-[#0055FF]/40"
                  >
                    {ph.phase} · {ph.percent}%
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <PhotoModal photo={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function PhotoModal({ photo, onClose }) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiClient.get(`/site-photos/${photo.id}/image`);
        setImg(`data:${data.mime_type};base64,${data.image_base64}`);
      } catch (_) { /* photo image fetch failed */ }
    })();
  }, [photo.id]);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="photo-modal"
    >
      <div className="bg-[#0f0f0f] border border-white/10 max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="label-mono text-[#FFCC00]">// PHOTO ANALYSIS</div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white text-2xl">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {img && <img src={img} alt="" className="w-full object-contain max-h-[50vh]" />}
          {photo.caption && <div className="text-sm text-neutral-200">{photo.caption}</div>}
          <div className="border-t border-white/10 pt-4">
            <div className="label-mono mb-2">AI summary</div>
            <div className="text-sm text-neutral-300">{photo.analysis?.summary || "—"}</div>
          </div>
          <div>
            <div className="label-mono mb-2">Phase estimates</div>
            <ul className="space-y-2">
              {(photo.analysis?.phases || []).map((ph, i) => (
                <li key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span>{ph.phase}</span>
                    <span className="text-[#FFCC00]">{ph.percent}%</span>
                  </div>
                  <div className="h-1.5 bg-white/5">
                    <div className="h-full bg-[#FFCC00]" style={{ width: `${ph.percent}%` }} />
                  </div>
                  {ph.evidence && (
                    <div className="text-[11px] font-mono text-neutral-500">{ph.evidence}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {(photo.analysis?.issues || []).length > 0 && (
            <div className="border-t border-white/10 pt-4">
              <div className="label-mono text-[#FF8866] mb-2">Issues detected</div>
              <ul className="list-disc pl-5 text-sm text-[#FFB8A0] space-y-1">
                {photo.analysis.issues.map((iss, i) => <li key={i}>{iss}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================== Progress Summary ==============================

function ProgressPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await apiClient.get(`/projects/${projectId}/progress-summary`);
        setData(data);
      } finally { setLoading(false); }
    })();
  }, [projectId]);
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="label-mono">// FIELD · 03</div>
        <h1 className="font-display text-3xl tracking-tighter mt-1">Construction progress</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Rolled up from every site photo&apos;s AI analysis — max % per phase wins.
        </p>
      </div>
      {loading ? (
        <div className="text-sm text-neutral-500 font-mono">Loading…</div>
      ) : !data || data.photos_analyzed === 0 ? (
        <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
          Upload site photos to see live progress estimates.
        </div>
      ) : (
        <div className="border border-white/10 bg-[#0f0f0f] p-6 space-y-4" data-testid="progress-summary">
          <div className="label-mono text-neutral-500">
            Aggregated from {data.photos_analyzed} photo{data.photos_analyzed === 1 ? "" : "s"}
          </div>
          <ul className="space-y-3">
            {data.phases.map((ph) => (
              <li key={ph.phase}>
                <div className="flex items-center justify-between text-sm font-mono">
                  <span className="text-neutral-200">{ph.phase}</span>
                  <span className="text-[#FFCC00]">{ph.percent}%</span>
                </div>
                <div className="h-2 bg-white/5 mt-1">
                  <div className="h-full bg-[#FFCC00] transition-all" style={{ width: `${ph.percent}%` }} />
                </div>
                {ph.evidence && (
                  <div className="text-[11px] font-mono text-neutral-500 mt-0.5">{ph.evidence}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================== LiDAR ==============================

function LidarPanel({ projectId }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/projects/${projectId}/lidar`);
      setScans(data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId]);

  const onFile = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await apiClient.post(`/projects/${projectId}/lidar`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
    } catch (e) {
      alert(errText(e, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const download = async (scan) => {
    try {
      const resp = await apiClient.get(`/lidar/${scan.id}/download`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = scan.filename || `scan.${scan.format}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed");
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="label-mono">// FIELD · 04</div>
        <h1 className="font-display text-3xl tracking-tighter mt-1">LiDAR / 3D scans</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Upload an iPhone/iPad LiDAR room scan (USDZ) or any reference mesh (OBJ, GLB, GLTF).
          Stored alongside the project — wall-extraction pipeline ships in a follow-up sprint.
        </p>
      </div>

      <div className="border border-white/10 bg-[#0f0f0f] p-5 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".usdz,.usd,.obj,.gltf,.glb"
          className="hidden"
          data-testid="lidar-input"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          data-testid="lidar-upload-btn"
          className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-50 text-black font-bold px-5 py-2 uppercase tracking-wider text-sm"
        >
          {uploading ? "Uploading…" : "+ Upload scan"}
        </button>
        <span className="label-mono text-neutral-500">
          .usdz · .usd · .obj · .gltf · .glb · 50MB max
        </span>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500 font-mono">Loading…</div>
      ) : scans.length === 0 ? (
        <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
          No scans uploaded yet.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="lidar-list">
          {scans.map((s) => (
            <li
              key={s.id}
              className="border border-white/10 bg-[#0f0f0f] px-4 py-3 flex items-center justify-between"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm truncate">{s.filename}</div>
                <div className="label-mono text-neutral-500">
                  {s.format?.toUpperCase()} · {Math.round((s.size || 0) / 1024)} KB · uploaded by {s.uploaded_by}
                </div>
              </div>
              <button
                onClick={() => download(s)}
                data-testid={`lidar-download-${s.id}`}
                className="label-mono px-3 py-1.5 border border-[#5588FF]/60 text-[#88AAFF] hover:bg-[#5588FF] hover:text-white"
              >
                download ↓
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
