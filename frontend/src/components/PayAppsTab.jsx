import React, { useEffect, useState } from "react";
import { apiClient, useStore, API } from "../store";

/**
 * AIA G702/G703 pay-app generator.
 *
 * Layout:
 *   - Top form: New pay-app (contractor, owner, architect, retainage %)
 *   - List: existing pay-apps with app_number, period, status
 *   - Detail panel: edit line items (work_completed_this_period etc.),
 *     see aggregate, download G702 + G703 PDF.
 */
export default function PayAppsTab() {
  const { currentProjectId, token } = useStore();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    contractor: "",
    owner_name: "",
    architect_name: "",
    retainage_pct: 10,
  });

  const load = async () => {
    if (!currentProjectId) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/projects/${currentProjectId}/pay-apps`);
      setApps(data);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [currentProjectId]);

  const createApp = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const { data } = await apiClient.post(`/projects/${currentProjectId}/pay-apps`, form);
      setSelected(data.id);
      await load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      setError(typeof d === "string" ? d : (Array.isArray(d) ? d.map((x) => x.msg).join("; ") : "Failed"));
    } finally {
      setCreating(false);
    }
  };

  const removeApp = async (id) => {
    if (!window.confirm("Delete this payment application?")) return;
    try {
      await apiClient.delete(`/pay-apps/${id}`);
      if (selected === id) setSelected(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Delete failed");
    }
  };

  if (!currentProjectId) return null;

  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] text-white" data-testid="pay-apps-tab">
      <div className="p-6 space-y-6">
        <div>
          <div className="label-mono">// PAYMENT APPLICATIONS · AIA G702 / G703</div>
          <h1 className="font-display text-3xl tracking-tighter mt-1">Pay apps</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Industry-standard payment applications auto-populated from your latest bid.
          </p>
        </div>

        <form
          onSubmit={createApp}
          className="border border-white/10 bg-[#0f0f0f] p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end"
          data-testid="pay-app-form"
        >
          <label className="md:col-span-1">
            <div className="label-mono mb-1.5">Contractor</div>
            <input
              data-testid="pay-app-contractor"
              type="text"
              value={form.contractor}
              onChange={(e) => setForm({ ...form, contractor: e.target.value })}
              placeholder="Your company"
              maxLength={120}
              className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="md:col-span-1">
            <div className="label-mono mb-1.5">Owner</div>
            <input
              data-testid="pay-app-owner"
              type="text"
              value={form.owner_name}
              onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              placeholder="Building owner"
              maxLength={120}
              className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="md:col-span-1">
            <div className="label-mono mb-1.5">Architect</div>
            <input
              data-testid="pay-app-architect"
              type="text"
              value={form.architect_name}
              onChange={(e) => setForm({ ...form, architect_name: e.target.value })}
              placeholder="Architect firm"
              maxLength={120}
              className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="md:col-span-1">
            <div className="label-mono mb-1.5">Retainage %</div>
            <input
              data-testid="pay-app-retainage"
              type="number"
              step="0.5"
              min="0"
              max="20"
              value={form.retainage_pct}
              onChange={(e) => setForm({ ...form, retainage_pct: Number(e.target.value) || 0 })}
              className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
            />
          </label>
          <button
            data-testid="pay-app-create"
            type="submit"
            disabled={creating}
            className="md:col-span-1 bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2.5 text-xs uppercase tracking-wider"
          >
            {creating ? "Creating…" : "+ New pay app"}
          </button>
        </form>
        {error && (
          <div className="text-xs text-[#FF6666] font-mono border border-[#FF3333]/40 bg-[#FF3333]/10 px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-neutral-500 font-mono">Loading…</div>
        ) : apps.length === 0 ? (
          <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
            No payment applications yet. Save a bid first, then create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
            <ul className="space-y-2" data-testid="pay-app-list">
              {apps.map((a) => {
                const active = selected === a.id;
                return (
                  <li key={a.id}>
                    <button
                      data-testid={`pay-app-card-${a.app_number}`}
                      onClick={() => setSelected(a.id)}
                      className={`w-full text-left border px-4 py-3 transition-colors ${
                        active
                          ? "border-[#FFCC00] bg-[#FFCC00]/10"
                          : "border-white/10 bg-[#0f0f0f] hover:border-white/30"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-display text-xl tracking-tighter">
                          #{a.app_number}
                        </span>
                        <span className="label-mono text-neutral-500">{a.period_to}</span>
                      </div>
                      <div className="font-mono text-xs text-neutral-400 mt-1 truncate">
                        {a.contractor || "—"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div>
              {selected ? (
                <PayAppDetail
                  appId={selected}
                  token={token}
                  onDelete={() => removeApp(selected)}
                  onChanged={load}
                />
              ) : (
                <div className="text-sm text-neutral-500 font-mono border border-dashed border-white/10 p-6 text-center">
                  Select a pay app to edit line items and download the PDF.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PayAppDetail({ appId, token, onDelete, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await apiClient.get(`/pay-apps/${appId}`);
      setDoc(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Load failed");
    }
  };
  useEffect(() => { setDoc(null); load(); }, [appId]);

  const patchLineItem = (idx, key, val) => {
    setDoc((d) => ({
      ...d,
      line_items: d.line_items.map((li, i) => (i === idx ? { ...li, [key]: Number(val) || 0 } : li)),
    }));
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      // strip computed fields before sending
      const clean = doc.line_items.map((li) => ({
        item_no: li.item_no,
        description: li.description,
        scheduled_value: li.scheduled_value,
        work_completed_previous: li.work_completed_previous,
        work_completed_this_period: li.work_completed_this_period,
        materials_stored: li.materials_stored,
      }));
      const { data } = await apiClient.patch(`/pay-apps/${appId}`, {
        line_items: clean,
        retainage_pct: doc.retainage_pct,
      });
      setDoc(data);
      onChanged && onChanged();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const downloadPDF = () => {
    const url = `${API}/pay-apps/${appId}/pdf`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const u = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = u;
        a.download = `payapp_${doc?.app_number || appId}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(u);
      });
  };

  if (!doc) return <div className="text-sm text-neutral-500 font-mono">Loading…</div>;

  const fmt = (v) => `$${(Number(v) || 0).toFixed(2)}`;

  return (
    <div className="border border-white/10 bg-[#0f0f0f] p-5 space-y-4" data-testid="pay-app-detail">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="label-mono text-neutral-500">// Application No</div>
          <div className="font-display text-2xl tracking-tighter">#{doc.app_number}</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            data-testid="pay-app-save"
            onClick={save}
            disabled={saving}
            className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold px-4 py-2 text-xs uppercase tracking-wider"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            data-testid="pay-app-pdf"
            onClick={downloadPDF}
            className="border border-[#5588FF]/60 text-[#88AAFF] hover:bg-[#5588FF] hover:text-white px-4 py-2 text-xs uppercase tracking-wider"
          >
            ↓ Download G702 + G703
          </button>
          <button
            data-testid="pay-app-delete"
            onClick={onDelete}
            className="border border-[#FF3333]/60 text-[#FF6666] hover:bg-[#FF3333] hover:text-white px-4 py-2 text-xs uppercase tracking-wider"
          >
            delete
          </button>
        </div>
      </div>

      {/* Aggregate */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm" data-testid="pay-app-aggregate">
        <Stat label="Contract sum" value={fmt(doc.aggregate.original_contract_sum)} />
        <Stat label="Completed & stored" value={fmt(doc.aggregate.total_completed_and_stored)} />
        <Stat label={`Retainage (${doc.retainage_pct}%)`} value={fmt(doc.aggregate.total_retainage)} />
        <Stat label="Current due" value={fmt(doc.aggregate.total_less_retainage)} highlight />
      </div>

      {err && <div className="text-xs text-[#FF6666] font-mono">{err}</div>}

      {/* Line items table */}
      <div className="overflow-x-auto border border-white/10">
        <table className="w-full text-xs font-mono" data-testid="pay-app-items">
          <thead className="text-neutral-500 bg-black">
            <tr>
              <th className="text-left px-2 py-2">#</th>
              <th className="text-left px-2 py-2">Description</th>
              <th className="text-right px-2 py-2">Schedule value</th>
              <th className="text-right px-2 py-2">Previous</th>
              <th className="text-right px-2 py-2">This period</th>
              <th className="text-right px-2 py-2">Stored</th>
              <th className="text-right px-2 py-2">Total</th>
              <th className="text-right px-2 py-2">%</th>
              <th className="text-right px-2 py-2">Balance</th>
            </tr>
          </thead>
          <tbody>
            {doc.line_items.map((li, idx) => (
              <tr key={li.item_no} className="border-t border-white/5" data-testid={`pay-app-row-${li.item_no}`}>
                <td className="px-2 py-1 text-neutral-500">{li.item_no}</td>
                <td className="px-2 py-1 text-neutral-200 max-w-[220px] truncate" title={li.description}>{li.description}</td>
                <td className="px-2 py-1 text-right">{fmt(li.scheduled_value)}</td>
                <td className="px-2 py-1 text-right">
                  <input
                    data-testid={`pay-app-prev-${li.item_no}`}
                    type="number"
                    min="0"
                    value={li.work_completed_previous}
                    onChange={(e) => patchLineItem(idx, "work_completed_previous", e.target.value)}
                    className="w-24 bg-black border border-white/10 px-1 py-0.5 text-right"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <input
                    data-testid={`pay-app-this-${li.item_no}`}
                    type="number"
                    min="0"
                    value={li.work_completed_this_period}
                    onChange={(e) => patchLineItem(idx, "work_completed_this_period", e.target.value)}
                    className="w-24 bg-black border border-white/10 px-1 py-0.5 text-right"
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <input
                    data-testid={`pay-app-stored-${li.item_no}`}
                    type="number"
                    min="0"
                    value={li.materials_stored}
                    onChange={(e) => patchLineItem(idx, "materials_stored", e.target.value)}
                    className="w-24 bg-black border border-white/10 px-1 py-0.5 text-right"
                  />
                </td>
                <td className="px-2 py-1 text-right text-[#FFCC00]">{fmt(li.total_completed_and_stored)}</td>
                <td className="px-2 py-1 text-right">{li.percent_complete?.toFixed?.(1)}%</td>
                <td className="px-2 py-1 text-right">{fmt(li.balance_to_finish)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight = false }) {
  return (
    <div className={`border border-white/10 p-3 ${highlight ? "bg-[#FFCC00]/10 border-[#FFCC00]/40" : "bg-black"}`}>
      <div className="label-mono text-neutral-500 mb-1">{label}</div>
      <div className={`font-mono ${highlight ? "text-[#FFCC00] font-bold" : "text-white"} text-sm`}>{value}</div>
    </div>
  );
}
