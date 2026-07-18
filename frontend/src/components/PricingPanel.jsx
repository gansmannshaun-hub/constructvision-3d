/* Pricing & bid management panel for the Materials tab.
 * - ZIP + regional multiplier
 * - Waste / Overhead / Profit / Contingency sliders
 * - Live grand-total cascade
 * - Save Bid + history + diff modal
 */
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("cm_token")}` } });

export default function PricingPanel({ projectId }) {
  const [cfg, setCfg] = useState(null);
  const [totals, setTotals] = useState(null);
  const [bids, setBids] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffA, setDiffA] = useState("");
  const [diffB, setDiffB] = useState("");
  const [diff, setDiff] = useState(null);

  // Local slider state — updates instantly on drag; the server PATCH is debounced.
  const [localCfg, setLocalCfg] = useState(null);
  // Per-key debounce timer + abort controller so each slider has its own
  // independent pipeline (dragging slider A then B within 200ms must NOT cancel
  // A's pending PATCH — that was the original bug).
  const patchTimersRef = useRef({});
  const patchAbortsRef = useRef({});

  const load = async () => {
    if (!projectId) return;
    const [p, b] = await Promise.all([
      axios.get(`${API}/projects/${projectId}/pricing`, auth()),
      axios.get(`${API}/projects/${projectId}/bids`, auth()),
    ]);
    setCfg(p.data.config);
    setTotals(p.data.totals);
    setBids(b.data);
  };

  useEffect(() => { load(); }, [projectId]);

  // Sync local slider state whenever the canonical cfg changes — but only if
  // there are no pending in-flight changes (otherwise a slow server response
  // could overwrite the user's mid-drag value).
  useEffect(() => {
    if (!cfg) return;
    const anyPending = Object.keys(patchTimersRef.current).length > 0
      || Object.keys(patchAbortsRef.current).length > 0;
    if (!anyPending) setLocalCfg(cfg);
  }, [cfg]);

  // Clean up any pending timers / aborts on unmount
  useEffect(() => () => {
    Object.values(patchTimersRef.current).forEach((t) => clearTimeout(t));
    Object.values(patchAbortsRef.current).forEach((c) => c.abort());
  }, []);

  const patch = async (patchBody, signal) => {
    const { data } = await axios.patch(
      `${API}/projects/${projectId}/pricing`,
      patchBody,
      { ...auth(), signal },
    );
    setCfg(data.config);
    setTotals(data.totals);
  };

  // Slider drag handler — instant local update, per-key debounced backend sync.
  const onSliderChange = (key, value) => {
    setLocalCfg((prev) => prev ? { ...prev, [key]: value } : prev);
    // Reset this key's debounce timer
    if (patchTimersRef.current[key]) clearTimeout(patchTimersRef.current[key]);
    patchTimersRef.current[key] = setTimeout(async () => {
      delete patchTimersRef.current[key];
      // Cancel only THIS key's previous in-flight patch
      if (patchAbortsRef.current[key]) patchAbortsRef.current[key].abort();
      const controller = new AbortController();
      patchAbortsRef.current[key] = controller;
      try {
        await patch({ [key]: value }, controller.signal);
      } catch (e) {
        if (e?.name !== "CanceledError" && e?.code !== "ERR_CANCELED") {
          console.error("pricing patch failed", e);
        }
      } finally {
        // Clear ref only if it's still our controller (a newer one may have replaced it)
        if (patchAbortsRef.current[key] === controller) {
          delete patchAbortsRef.current[key];
        }
      }
    }, 200);
  };

  const saveBid = async () => {
    const name = window.prompt(`Save bid snapshot — give it a name:`, `V${bids.length + 1} — ${new Date().toLocaleDateString()}`);
    if (!name) return;
    setSaving(true);
    try {
      await axios.post(`${API}/projects/${projectId}/bids`, { name }, auth());
      await load();
    } finally { setSaving(false); }
  };

  const openDiff = async () => {
    if (!diffA || !diffB || diffA === diffB) { alert("Pick two different bids to compare."); return; }
    const { data } = await axios.get(`${API}/projects/${projectId}/bids-diff`, { ...auth(), params: { a: diffA, b: diffB } });
    setDiff(data); setShowDiff(true);
  };

  if (!cfg || !totals) return null;

  return (
    <section className="border border-white/10 bg-[#0d0d0d] p-5 mb-6" data-testid="pricing-panel">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.2fr] gap-6">
        {/* ---- Region ---- */}
        <div>
          <div className="label-mono text-[#5588FF] mb-2">// REGION</div>
          <label className="block">
            <span className="label-mono">ZIP code</span>
            <input
              data-testid="pricing-zip"
              type="text" maxLength={10} placeholder="e.g. 10001"
              defaultValue={cfg.zip}
              onBlur={(e) => { if (e.target.value !== cfg.zip) patch({ zip: e.target.value }); }}
              className="mt-1 w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
            />
          </label>
          <div className="mt-2 text-xs font-mono text-neutral-400">
            {cfg.city || cfg.state || "US average"}
          </div>
          <div className="mt-1 text-[#FFCC00] font-display text-2xl">
            ×{cfg.regional_multiplier.toFixed(3)}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">
            {cfg.regional_source.replace(/_/g, " ")}
          </div>
        </div>

        {/* ---- Sliders ---- */}
        <div>
          <div className="label-mono text-[#5588FF] mb-2">// MARKUPS</div>
          {[
            ["waste_pct",      "Waste",       0, 20],
            ["overhead_pct",   "Overhead",    0, 30],
            ["profit_pct",     "Profit",      0, 30],
            ["contingency_pct","Contingency", 0, 20],
          ].map(([key, label, mn, mx]) => (
            <label key={key} className="block mb-2.5">
              <div className="flex justify-between label-mono">
                <span>{label}</span>
                <span className="text-[#FFCC00]">{Number((localCfg || cfg)[key]).toFixed(1)}%</span>
              </div>
              <input
                data-testid={`pricing-${key}`}
                type="range" min={mn} max={mx} step="0.5"
                value={(localCfg || cfg)[key]}
                onChange={(e) => onSliderChange(key, Number(e.target.value))}
                className="w-full accent-[#FFCC00]"
              />
            </label>
          ))}
        </div>

        {/* ---- Totals ---- */}
        <div>
          <div className="label-mono text-[#5588FF] mb-2">// BID CASCADE</div>
          <CascadeRow label="Materials"   value={totals.materials_subtotal} />
          <CascadeRow label="Labor"       value={totals.labor_subtotal} />
          <CascadeRow label="Subtotal"    value={totals.base_subtotal} bold />
          <CascadeRow label={`+ Waste ${cfg.waste_pct}%`}    value={totals.waste_amount} dim />
          <CascadeRow label={`+ Overhead ${cfg.overhead_pct}%`} value={totals.overhead_amount} dim />
          <CascadeRow label={`+ Profit ${cfg.profit_pct}%`}    value={totals.profit_amount} dim />
          <CascadeRow label={`+ Contingency ${cfg.contingency_pct}%`} value={totals.contingency_amount} dim />
          <div className="border-t-2 border-[#0055FF] mt-2 pt-2 flex items-baseline justify-between">
            <span className="font-display text-lg">GRAND TOTAL</span>
            <span data-testid="pricing-grand-total" className="font-display text-2xl text-[#5588FF]">
              ${totals.grand_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* ---- Bid history / actions ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 mt-6 pt-5 border-t border-white/10">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono text-neutral-500 mr-2">BIDS</span>
          <select
            data-testid="pricing-diff-a"
            value={diffA} onChange={(e) => setDiffA(e.target.value)}
            className="bg-black border border-white/15 px-2 py-1.5 text-xs font-mono"
          >
            <option value="">— from —</option>
            {bids.map((b) => <option key={b.id} value={b.id}>V{b.version}: {b.name}</option>)}
          </select>
          <span className="text-neutral-500">→</span>
          <select
            data-testid="pricing-diff-b"
            value={diffB} onChange={(e) => setDiffB(e.target.value)}
            className="bg-black border border-white/15 px-2 py-1.5 text-xs font-mono"
          >
            <option value="">— to —</option>
            {bids.map((b) => <option key={b.id} value={b.id}>V{b.version}: {b.name}</option>)}
          </select>
          <button
            data-testid="pricing-diff-open"
            onClick={openDiff}
            disabled={!diffA || !diffB || diffA === diffB}
            className="border border-[#5588FF] text-[#5588FF] px-3 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-[#0055FF]/20 disabled:opacity-40"
          >Compare</button>
        </div>
        <button
          data-testid="pricing-save-bid"
          onClick={saveBid}
          disabled={saving}
          className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-5 py-2 text-xs uppercase tracking-wider disabled:opacity-50"
        >
          {saving ? "Saving…" : `▼ Save Bid V${bids.length + 1}`}
        </button>
      </div>

      {showDiff && diff && <DiffModal diff={diff} onClose={() => setShowDiff(false)} />}
    </section>
  );
}

function CascadeRow({ label, value, bold, dim }) {
  return (
    <div className={`flex justify-between text-sm py-0.5 ${bold ? "font-bold" : ""} ${dim ? "text-neutral-400" : ""}`}>
      <span className="font-mono">{label}</span>
      <span className="font-mono">${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

function DiffModal({ diff, onClose }) {
  const delta = diff.totals_delta.grand_total;
  const sign = delta >= 0 ? "+" : "−";
  return (
    <div
      data-testid="pricing-diff-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0f0f0f] border border-white/10 w-full max-w-5xl max-h-[85vh] flex flex-col">
        <div className="flex items-baseline justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="label-mono text-[#5588FF]">// BID DIFF</div>
            <div className="font-display text-xl mt-1">
              V{diff.a.version}: {diff.a.name} <span className="text-neutral-500 mx-2">→</span> V{diff.b.version}: {diff.b.name}
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white text-2xl">✕</button>
        </div>
        <div className="grid grid-cols-3 gap-4 px-6 py-4 border-b border-white/10">
          <div>
            <div className="label-mono text-neutral-500">V{diff.a.version} Grand Total</div>
            <div className="font-display text-2xl">${diff.a.totals.grand_total.toLocaleString()}</div>
          </div>
          <div>
            <div className="label-mono text-neutral-500">V{diff.b.version} Grand Total</div>
            <div className="font-display text-2xl">${diff.b.totals.grand_total.toLocaleString()}</div>
          </div>
          <div>
            <div className="label-mono text-neutral-500">Δ</div>
            <div className={`font-display text-2xl ${delta >= 0 ? "text-[#00CC66]" : "text-[#FF6666]"}`}>
              {sign}${Math.abs(delta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-[#0a0a0a]">
              <tr className="border-b border-white/10 text-neutral-500">
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-right">V{diff.a.version} Qty</th>
                <th className="px-3 py-2 text-right">V{diff.a.version} $</th>
                <th className="px-3 py-2 text-right">V{diff.b.version} Qty</th>
                <th className="px-3 py-2 text-right">V{diff.b.version} $</th>
                <th className="px-3 py-2 text-right">Δ</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {diff.rows.filter((r) => r.status !== "same").map((r, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="px-3 py-2"><span className="text-neutral-500">{r.category}/</span>{r.name}</td>
                  <td className="px-3 py-2 text-right">{r.a.quantity || "—"}</td>
                  <td className="px-3 py-2 text-right">${r.a.total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{r.b.quantity || "—"}</td>
                  <td className="px-3 py-2 text-right">${r.b.total.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right ${r.delta >= 0 ? "text-[#00CC66]" : "text-[#FF6666]"}`}>
                    {r.delta >= 0 ? "+" : "−"}${Math.abs(r.delta).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`label-mono px-2 py-0.5 ${
                      r.status === "added"   ? "bg-[#00CC66]/20 text-[#00CC66]" :
                      r.status === "removed" ? "bg-[#FF3333]/20 text-[#FF6666]" :
                                               "bg-[#FFCC00]/20 text-[#FFCC00]"
                    }`}>{r.status}</span>
                  </td>
                </tr>
              ))}
              {diff.rows.filter((r) => r.status !== "same").length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">
                  No line-item changes — only pricing config differs.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
