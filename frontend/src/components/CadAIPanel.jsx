import React, { useEffect, useMemo, useState } from "react";
import { apiClient, useStore } from "../store";
import { runCompliance } from "../lib/compliance";

/**
 * Floating overlay panel for the CAD editor.
 * - AI prompt → generate floor plan from text.
 * - Live compliance check (IBC + IRC) against current blueprint.
 */
export default function CadAIPanel({ projectId, onPlanLoaded }) {
  const blueprint = useStore((s) => s.blueprint);
  const [tab, setTab] = useState("ai");
  const [collapsed, setCollapsed] = useState(false);

  // -- AI form state
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [replace, setReplace] = useState(true);
  const examples = [
    "1,200 sqft 3-bed 2-bath ADU on a 40×80 lot, garage on the east side.",
    "800 sqft studio cabin 24×34, one bathroom, kitchenette, sleeping loft.",
    "2,000 sqft 4-bed ranch home, 50×40, attached 2-car garage.",
  ];

  // -- Compliance state
  const [occupancy, setOccupancy] = useState("residential");
  const [ceilingFt, setCeilingFt] = useState(9);
  const compliance = useMemo(
    () => runCompliance(blueprint, { occupancy, ceilingFt }),
    [blueprint, occupancy, ceilingFt],
  );

  const generate = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const { data } = await apiClient.post(
        `/projects/${projectId}/ai/floorplan`,
        { prompt, replace },
      );
      setResult(data);
      if (onPlanLoaded) await onPlanLoaded();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === "string" ? d : (Array.isArray(d) ? d.map((x) => x.msg).join("; ") : (e.message || "AI failed")));
    } finally {
      setBusy(false);
    }
  };

  if (collapsed) {
    return (
      <button
        data-testid="cad-ai-expand"
        onClick={() => setCollapsed(false)}
        className="absolute right-4 top-4 z-20 bg-[#0a0a0a] text-white border border-[#FFCC00]/60 px-3 py-2 label-mono hover:bg-[#FFCC00] hover:text-black transition-colors flex items-center gap-2"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3 7h7l-5.5 4 2 8L12 16l-6.5 5 2-8L2 9h7z" /></svg>
        AI / CODE
      </button>
    );
  }

  return (
    <div
      data-testid="cad-ai-panel"
      className="absolute right-4 top-4 bottom-4 z-20 w-[340px] bg-[#0a0a0a] text-white border border-white/15 shadow-2xl flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black">
        <div className="flex items-center gap-2">
          <button
            data-testid="cad-ai-tab-ai"
            onClick={() => setTab("ai")}
            className={`label-mono px-2 py-1 ${tab === "ai" ? "bg-[#FFCC00] text-black" : "text-neutral-400 hover:text-white"}`}
          >AI SKETCH</button>
          <button
            data-testid="cad-ai-tab-code"
            onClick={() => setTab("code")}
            className={`label-mono px-2 py-1 flex items-center gap-1 ${tab === "code" ? "bg-[#FFCC00] text-black" : "text-neutral-400 hover:text-white"}`}
          >
            CODE
            {compliance.counts.errors > 0 && (
              <span data-testid="cad-ai-err-badge" className="bg-[#FF3333] text-white text-[9px] px-1.5 py-0.5 rounded-full leading-none">
                {compliance.counts.errors}
              </span>
            )}
            {compliance.counts.errors === 0 && compliance.counts.warnings > 0 && (
              <span className="bg-[#FFAA00] text-black text-[9px] px-1.5 py-0.5 rounded-full leading-none">
                {compliance.counts.warnings}
              </span>
            )}
          </button>
        </div>
        <button
          data-testid="cad-ai-collapse"
          onClick={() => setCollapsed(true)}
          className="text-neutral-500 hover:text-white text-lg leading-none"
          title="Collapse"
        >→</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "ai" ? (
          <>
            <div className="label-mono mb-2 text-neutral-500">// TEXT → FLOOR PLAN</div>
            <p className="text-xs text-neutral-400 mb-3 leading-relaxed">
              Describe a building. GPT-4o sketches rectangular rooms with doors, windows, and labels — refine in CAD.
            </p>
            <textarea
              data-testid="cad-ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={600}
              placeholder="e.g. 1,200 sqft 3-bed ADU on a 40×80 lot"
              className="w-full h-24 bg-black border border-white/15 text-sm font-mono p-2 outline-none focus:border-[#FFCC00]"
            />
            <div className="text-[10px] text-neutral-500 mb-2 mt-1 font-mono">
              {prompt.length}/600
            </div>
            <label className="flex items-center gap-2 text-xs mb-3">
              <input
                data-testid="cad-ai-replace"
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />
              <span className="text-neutral-300">
                {replace ? "Replace existing geometry" : "Append to current layout"}
              </span>
            </label>
            <button
              data-testid="cad-ai-submit"
              onClick={generate}
              disabled={busy || !prompt.trim()}
              className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2.5 text-xs uppercase tracking-wider mb-3"
            >
              {busy ? "Sketching…" : "✦ Generate floor plan"}
            </button>

            {err && (
              <div data-testid="cad-ai-err" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-xs font-mono p-3 mb-3">
                {err}
              </div>
            )}

            {result && (
              <div data-testid="cad-ai-result" className="border border-[#00CC66]/40 bg-[#00CC66]/10 text-xs font-mono p-3 mb-3 space-y-1">
                <div className="text-[#00CC66] font-bold">AI sketched a floor plan</div>
                {result.summary && <div className="text-neutral-300">{result.summary}</div>}
                <div className="text-neutral-400">
                  walls {result.counts.walls} · doors {result.counts.doors} · windows {result.counts.windows} · labels {result.counts.labels}
                </div>
                {result.lot?.w && (
                  <div className="text-neutral-500">
                    lot {result.lot.w}×{result.lot.h}ft · building {result.building?.w}×{result.building?.h}ft
                  </div>
                )}
                {result.compliance && (
                  <div data-testid="cad-ai-compliance" className="mt-2 pt-2 border-t border-white/10">
                    {result.compliance.clean ? (
                      <div className="text-[#00CC66] flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>
                        Code-compliant — no IBC/IRC violations detected.
                      </div>
                    ) : (
                      <>
                        <div className={`font-bold ${result.compliance.critical_count > 0 ? "text-[#FF6666]" : "text-[#FFCC00]"}`}>
                          {result.compliance.critical_count > 0
                            ? `${result.compliance.critical_count} CODE VIOLATION${result.compliance.critical_count === 1 ? "" : "S"}`
                            : `${result.compliance.warn_count} warning${result.compliance.warn_count === 1 ? "" : "s"}`}
                          {result.compliance.retried && (
                            <span className="ml-2 text-[10px] text-neutral-500 font-normal">(AI auto-retried once)</span>
                          )}
                        </div>
                        <ul className="mt-1 space-y-1 text-[11px]">
                          {result.compliance.warnings.slice(0, 6).map((w, i) => (
                            <li key={i} className={w.severity === "critical" ? "text-[#FF8888]" : "text-[#FFCC00]"}>
                              <span className="font-mono opacity-70">[{w.code}]</span> {w.message}
                            </li>
                          ))}
                          {result.compliance.warnings.length > 6 && (
                            <li className="text-neutral-500">… +{result.compliance.warnings.length - 6} more in CODE tab</li>
                          )}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-2">
              <div className="label-mono mb-1 text-neutral-500">// EXAMPLES</div>
              {examples.map((ex, i) => (
                <button
                  key={i}
                  data-testid={`cad-ai-example-${i}`}
                  onClick={() => setPrompt(ex)}
                  className="block w-full text-left text-xs text-neutral-400 hover:text-[#FFCC00] hover:bg-white/5 px-2 py-1.5 border border-white/5 mb-1"
                >
                  {ex}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="label-mono mb-2 text-neutral-500">// LIVE COMPLIANCE</div>
            <div className="text-xs text-neutral-400 mb-3 leading-relaxed">
              Runs against the current blueprint. References IBC 2021 + IRC.
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <label className="block">
                <div className="label-mono mb-1">Occupancy</div>
                <select
                  data-testid="cad-code-occupancy"
                  value={occupancy}
                  onChange={(e) => setOccupancy(e.target.value)}
                  className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono"
                >
                  <option value="residential">Residential (IRC)</option>
                  <option value="commercial">Commercial (IBC)</option>
                </select>
              </label>
              <label className="block">
                <div className="label-mono mb-1">Ceiling ft</div>
                <input
                  data-testid="cad-code-ceiling"
                  type="number"
                  step="0.5" min="6" max="20"
                  value={ceilingFt}
                  onChange={(e) => setCeilingFt(Number(e.target.value) || 9)}
                  className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono"
                />
              </label>
            </div>

            <div
              data-testid="cad-code-summary"
              className={`border px-3 py-2 mb-3 text-sm font-mono ${
                compliance.counts.errors > 0
                  ? "border-[#FF3333]/50 bg-[#FF3333]/10 text-[#FF6666]"
                  : compliance.counts.warnings > 0
                  ? "border-[#FFAA00]/50 bg-[#FFAA00]/10 text-[#FFCC00]"
                  : "border-[#00CC66]/50 bg-[#00CC66]/10 text-[#88EEAA]"
              }`}
            >
              {compliance.summary}
            </div>

            {compliance.warnings.length > 0 ? (
              <ul data-testid="cad-code-list" className="space-y-2">
                {compliance.warnings.map((w, i) => (
                  <li
                    key={i}
                    data-testid={`cad-code-item-${i}`}
                    className={`border-l-4 px-3 py-2 text-xs ${
                      w.severity === "error"
                        ? "border-[#FF3333] bg-[#FF3333]/5"
                        : w.severity === "warning"
                        ? "border-[#FFAA00] bg-[#FFAA00]/5"
                        : "border-[#5588FF] bg-[#5588FF]/5"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold uppercase tracking-wider text-[10px]">
                        {w.severity}
                      </span>
                      <span className="label-mono text-neutral-500">{w.code}</span>
                    </div>
                    <div className="text-neutral-200 leading-snug">{w.message}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-neutral-500 font-mono p-4 text-center border border-dashed border-white/10">
                Nothing to flag.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
