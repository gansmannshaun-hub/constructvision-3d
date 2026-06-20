import React, { useEffect, useMemo, useState } from "react";
import { apiClient, useStore } from "../store";
import { wallsAabb } from "../lib/dim";

/**
 * Construction Schedule + Gantt chart.
 * Inputs: project sqft (auto from blueprint AABB or manual), crew size, start date.
 * Renders a horizontal SVG Gantt with critical-path highlight.
 */
export default function ScheduleTab() {
  const { blueprint, currentProjectId } = useStore();
  const [sqft, setSqft] = useState(1500);
  const [crew, setCrew] = useState(4);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  // Estimate sqft from blueprint AABB (1 unit = 1 ft).
  useEffect(() => {
    const aabb = wallsAabb(blueprint?.walls || []);
    if (aabb && aabb.w > 1 && aabb.h > 1) {
      const est = Math.round(aabb.w * aabb.h);
      if (est >= 100 && est <= 200_000) setSqft(est);
    }
  }, [blueprint?.walls]);

  // Auto-load saved schedule on mount
  useEffect(() => {
    if (!currentProjectId) return;
    (async () => {
      try {
        const { data } = await apiClient.get(`/projects/${currentProjectId}/ai/schedule`);
        if (data?.result) {
          setResult(data.result);
          if (data.sqft) setSqft(data.sqft);
          if (data.crew_size) setCrew(data.crew_size);
          if (data.start_date) setStartDate(data.start_date);
        }
      } catch { /* ignore */ }
    })();
  }, [currentProjectId]);

  const generate = async () => {
    if (!currentProjectId) return;
    setBusy(true);
    setErr("");
    try {
      const { data } = await apiClient.post(
        `/projects/${currentProjectId}/ai/schedule`,
        { sqft, crew_size: crew, start_date: startDate },
      );
      setResult(data);
    } catch (e) {
      const d = e?.response?.data?.detail;
      let msg = "Failed";
      if (typeof d === "string") msg = d;
      else if (Array.isArray(d)) msg = d.map((x) => x?.msg || JSON.stringify(x)).join("; ");
      else if (d) { try { msg = JSON.stringify(d); } catch { msg = "Failed"; } }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] text-white" data-testid="schedule-tab">
      <div className="p-6 space-y-6">
        <div>
          <div className="label-mono">// SCHEDULE · GANTT</div>
          <h1 className="font-display text-3xl tracking-tighter mt-1">Project schedule</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Critical-path scheduling across the 15 construction phases — adjusts to building size and crew.
          </p>
        </div>

        <div className="border border-white/10 bg-[#0f0f0f] p-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <label>
              <div className="label-mono mb-1.5">Square footage</div>
              <input
                data-testid="sched-sqft"
                type="number" min="100" max="200000"
                value={sqft}
                onChange={(e) => setSqft(Number(e.target.value) || 0)}
                className="w-full bg-black border border-white/15 px-3 py-2 font-mono"
              />
            </label>
            <label>
              <div className="label-mono mb-1.5">Crew size</div>
              <input
                data-testid="sched-crew"
                type="number" min="1" max="50"
                value={crew}
                onChange={(e) => setCrew(Number(e.target.value) || 1)}
                className="w-full bg-black border border-white/15 px-3 py-2 font-mono"
              />
            </label>
            <label>
              <div className="label-mono mb-1.5">Start date</div>
              <input
                data-testid="sched-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-black border border-white/15 px-3 py-2 font-mono"
              />
            </label>
            <button
              data-testid="sched-generate"
              onClick={generate}
              disabled={busy || sqft < 100}
              className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold px-5 py-2.5 uppercase tracking-wider text-xs"
            >
              {busy ? "Computing…" : "Build schedule"}
            </button>
          </div>
          {err && <div className="mt-3 text-xs text-[#FF6666] font-mono">{err}</div>}
        </div>

        {result ? (
          <ScheduleResult result={result} startDate={startDate} />
        ) : (
          <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
            Fill in the inputs and hit <b className="text-white">Build schedule</b>.
          </div>
        )}
      </div>
    </div>
  );
}

function addBusinessDays(start, days) {
  const d = new Date(start + "T00:00:00");
  let n = Math.round(days);
  while (n > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n--;
  }
  return d;
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function ScheduleResult({ result, startDate }) {
  // chart layout
  const total = result.project_duration_days || 1;
  const phases = result.phases || [];
  const rowH = 26;
  const labelW = 170;
  const chartW = 760;
  const dayPx = chartW / total;

  // Build dependency arrow paths
  const arrows = useMemo(() => {
    const out = [];
    phases.forEach((ph, idx) => {
      for (const depId of ph.depends_on || []) {
        const dep = phases.find((p) => p.id === depId);
        if (!dep) continue;
        const fromX = labelW + dep.end_day * dayPx;
        const fromY = phases.indexOf(dep) * rowH + rowH / 2;
        const toX = labelW + ph.start_day * dayPx;
        const toY = idx * rowH + rowH / 2;
        out.push({ fromX, fromY, toX, toY });
      }
    });
    return out;
  }, [phases]);

  const startDt = startDate ? new Date(startDate + "T00:00:00") : new Date();
  const endDt = addBusinessDays(startDate || fmt(startDt), total);

  return (
    <div className="border border-white/10 bg-[#0f0f0f] p-5 space-y-4" data-testid="schedule-result">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <div className="label-mono text-neutral-500">Duration</div>
          <div className="font-display text-2xl tracking-tighter">
            {result.project_duration_days} <span className="text-base text-neutral-400">work days</span>
            <span className="ml-2 text-base text-[#FFCC00]">≈ {result.project_duration_weeks} wks</span>
          </div>
        </div>
        <div>
          <div className="label-mono text-neutral-500">Window</div>
          <div className="font-mono text-sm">{startDate} → {fmt(endDt)}</div>
        </div>
        <div>
          <div className="label-mono text-neutral-500">Critical path</div>
          <div className="font-mono text-sm text-[#FF6666]">
            {(result.critical_path || []).map((id) => phases[id]?.label || id).join(" → ")}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border border-white/5">
        <svg
          width={labelW + chartW + 40}
          height={phases.length * rowH + 40}
          className="bg-[#0c0c0c]"
          data-testid="schedule-svg"
        >
          {/* Day axis */}
          {[...Array(Math.min(20, Math.ceil(total / Math.max(1, Math.floor(total / 12)))) + 1)].map((_, i) => {
            const step = Math.max(1, Math.floor(total / 12));
            const day = i * step;
            if (day > total) return null;
            const x = labelW + day * dayPx;
            return (
              <g key={i}>
                <line x1={x} y1={20} x2={x} y2={phases.length * rowH + 20} stroke="#222" strokeWidth="0.5" />
                <text x={x} y={14} fontSize="10" fill="#666" textAnchor="middle" fontFamily="monospace">d{day}</text>
              </g>
            );
          })}

          {/* Dependency arrows */}
          {arrows.map((a, i) => (
            <path
              key={i}
              d={`M ${a.fromX} ${a.fromY + 20} L ${a.fromX + 8} ${a.fromY + 20} L ${a.fromX + 8} ${a.toY + 20} L ${a.toX} ${a.toY + 20}`}
              fill="none" stroke="#333" strokeWidth="0.8"
            />
          ))}

          {/* Bars */}
          {phases.map((ph, idx) => {
            const x = labelW + ph.start_day * dayPx;
            const w = Math.max(2, ph.duration_days * dayPx);
            const y = idx * rowH + 20;
            const isCrit = ph.critical;
            return (
              <g key={ph.id} data-testid={`sched-bar-${ph.id}`}>
                <text x={labelW - 6} y={y + 17} fontSize="11" fill="#ddd" textAnchor="end" fontFamily="monospace">
                  {ph.label}
                </text>
                <rect
                  x={x} y={y + 4}
                  width={w} height={rowH - 8}
                  fill={isCrit ? "#FF3333" : "#FFCC00"}
                  opacity={isCrit ? 0.9 : 0.75}
                />
                <text
                  x={x + w + 4} y={y + 17}
                  fontSize="10"
                  fill={isCrit ? "#FF6666" : "#FFCC00"}
                  fontFamily="monospace"
                >
                  {ph.duration_days}d
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono">
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-[#FF3333]" /> critical path</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 bg-[#FFCC00]" /> with float</span>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-neutral-400 hover:text-white font-mono">Phase details table</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs font-mono" data-testid="sched-table">
            <thead className="text-neutral-500">
              <tr className="border-b border-white/10">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Phase</th>
                <th className="text-right py-2 px-2">Start (d)</th>
                <th className="text-right py-2 px-2">End (d)</th>
                <th className="text-right py-2 px-2">Dur</th>
                <th className="text-right py-2 px-2">Slack</th>
                <th className="text-center py-2 px-2">Crit</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p, i) => (
                <tr key={p.id} className="border-b border-white/5">
                  <td className="py-1.5 px-2 text-neutral-500">{i}</td>
                  <td className="py-1.5 px-2 text-neutral-200">{p.label}</td>
                  <td className="py-1.5 px-2 text-right">{p.start_day}</td>
                  <td className="py-1.5 px-2 text-right">{p.end_day}</td>
                  <td className="py-1.5 px-2 text-right">{p.duration_days}</td>
                  <td className="py-1.5 px-2 text-right">{p.slack_days}</td>
                  <td className="py-1.5 px-2 text-center">{p.critical ? "●" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
