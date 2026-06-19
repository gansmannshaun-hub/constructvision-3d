import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, apiClient, API } from "../store";
import PricingPanel from "./PricingPanel";

const CATEGORY_COLORS = {
  Structural: "#0055FF",
  Framing: "#FFCC00",
  Electrical: "#FF8800",
  Plumbing: "#00CCFF",
  Finishes: "#CC66FF",
  HVAC: "#00CC66",
  Insulation: "#FFAA88",
  Roofing: "#FF5577",
  "Doors & Windows": "#88FF66",
  Other: "#888888",
};

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n || 0);

export default function MaterialsTab() {
  const { materials, refreshMaterials, currentProjectId, projects } = useStore();
  const project = projects.find((p) => p.id === currentProjectId);
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  const grouped = useMemo(() => {
    const m = {};
    for (const mat of materials) {
      const k = mat.category || "Other";
      (m[k] ||= []).push(mat);
    }
    return m;
  }, [materials]);

  const categories = Object.keys(grouped);
  const aiCount = materials.filter((m) => m.ai_extracted).length;

  const { subtotals, grandTotal } = useMemo(() => {
    const subs = {};
    let total = 0;
    for (const cat of categories) {
      const s = grouped[cat].reduce(
        (acc, m) => acc + (Number(m.quantity) || 0) * (Number(m.unit_price) || 0),
        0
      );
      subs[cat] = s;
      total += s;
    }
    return { subtotals: subs, grandTotal: total };
  }, [grouped, categories]);

  const downloadTakeoff = async (kind) => {
    if (!currentProjectId) return;
    setDownloading(true);
    try {
      const token = localStorage.getItem("cm_token");
      const res = await fetch(`${API}/projects/${currentProjectId}/takeoff.${kind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 402) {
        const j = await res.json().catch(() => ({}));
        if (window.confirm(`${j.detail || "Export is a Pro feature."}\n\nGo to Billing now?`)) {
          navigate("/billing");
        }
        return;
      }
      if (!res.ok) throw new Error(`${kind.toUpperCase()} generation failed`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (project?.name || "project").replace(/[^a-z0-9_-]+/gi, "_");
      a.download = `atlas_takeoff_${safe}.${kind}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const downloadPdf = () => downloadTakeoff("pdf");

  return (
    <div className="h-full overflow-y-auto p-8" data-testid="materials-tab">
      <div className="flex items-baseline justify-between mb-6 gap-4">
        <div>
          <div className="label-mono mb-1">// AUTO-EXTRACTED · LIVE PRICING</div>
          <h2 className="font-display text-3xl tracking-tighter">Materials & Takeoff</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            data-testid="download-csv-button"
            onClick={() => downloadTakeoff("csv")}
            disabled={downloading || materials.length === 0}
            className="border border-white/15 hover:bg-white/5 disabled:opacity-40 text-white font-bold px-3 py-3 text-xs uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-1.5"
            title="Download takeoff as CSV (Excel-compatible, opens directly in QuickBooks/Sage/Procore)"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /><path d="M8 13h8M8 17h8" /></svg>
            CSV
          </button>
          <button
            data-testid="download-xlsx-button"
            onClick={() => downloadTakeoff("xlsx")}
            disabled={downloading || materials.length === 0}
            className="border border-[#00CC66]/40 bg-[#00CC66]/10 hover:bg-[#00CC66]/20 disabled:opacity-40 text-[#00CC66] font-bold px-3 py-3 text-xs uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-1.5"
            title="Download takeoff as Excel (.xlsx) with grouped categories and formulas"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 8l8 8M16 8l-8 8" /></svg>
            XLSX
          </button>
          <button
            data-testid="download-pdf-button"
            onClick={downloadPdf}
            disabled={downloading || materials.length === 0}
            className="bg-[#FFCC00] hover:bg-[#E6B800] disabled:bg-white/10 disabled:text-neutral-500 text-black font-bold px-5 py-3 text-xs uppercase tracking-wider transition-colors whitespace-nowrap flex items-center gap-2"
            title={materials.length === 0 ? "Add materials first" : "Download takeoff PDF"}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 3v12m0 0l-5-5m5 5l5-5M3 21h18" />
            </svg>
            {downloading ? "Generating..." : "PDF"}
          </button>
        </div>
      </div>

      {/* Pricing & bid panel (regional multiplier, sliders, bid versions) */}
      {currentProjectId && <PricingPanel projectId={currentProjectId} />}

      {/* Stats — now 4 cards including Project Cost */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1 mb-8 border border-white/10">
        <Stat label="TOTAL ITEMS" value={materials.length} testId="materials-total" />
        <Stat label="CATEGORIES" value={categories.length} testId="materials-categories" />
        <Stat label="AI EXTRACTED" value={aiCount} testId="materials-ai-count" highlight />
        <Stat
          label="PROJECT COST"
          value={fmtUSD(grandTotal)}
          testId="materials-grand-total"
          accent
        />
      </div>

      {materials.length === 0 ? (
        <div className="border border-white/10 p-12 text-center text-neutral-500 font-mono text-sm">
          No materials yet. Upload a blueprint and AI will auto-populate this list with estimated unit prices.
        </div>
      ) : (
        <div className="space-y-8">
          {categories.map((cat) => (
            <CategorySection
              key={cat}
              category={cat}
              items={grouped[cat]}
              subtotal={subtotals[cat]}
              onChanged={refreshMaterials}
            />
          ))}

          {/* Grand total bar */}
          <div
            data-testid="grand-total-bar"
            className="border border-[#0055FF] bg-[#0055FF] flex items-center justify-between px-6 py-5"
          >
            <div>
              <div className="label-mono text-white/70">// PROJECT TOTAL</div>
              <div className="font-mono text-xs text-white/80 mt-1">
                {materials.length} items across {categories.length} categories
              </div>
            </div>
            <div className="font-mono text-3xl font-bold text-white tracking-tight">
              {fmtUSD(grandTotal)}
            </div>
          </div>

          <div className="text-xs text-neutral-500 font-mono">
            * Unit prices are AI-estimated US 2026 trade rates. Click any price to override.
            Verify with vendors before final bidding.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, testId, highlight, accent }) {
  return (
    <div className="p-5 border-r border-white/10 last:border-r-0">
      <div className={`label-mono ${highlight ? "text-[#FFCC00]" : accent ? "text-[#5588FF]" : ""}`}>
        {label}
      </div>
      <div
        data-testid={testId}
        className={`font-mono text-3xl mt-2 ${highlight ? "text-[#FFCC00]" : accent ? "text-[#5588FF]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function CategorySection({ category, items, subtotal, onChanged }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-3 h-3"
          style={{ background: CATEGORY_COLORS[category] || "#888" }}
        />
        <div className="label-mono">{category}</div>
        <div className="flex-1 border-b border-white/10" />
        <div className="label-mono">{items.length} items</div>
        <div className="label-mono text-[#5588FF]">{fmtUSD(subtotal)}</div>
      </div>

      <div className="border border-white/10 divide-y divide-white/10">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_120px_120px_140px_60px] gap-3 px-4 py-2 bg-[#0F0F0F] label-mono">
          <span>Material</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Unit Price</span>
          <span className="text-right">Line Total</span>
          <span className="text-right">·</span>
        </div>
        {items.map((m) => (
          <MaterialRow key={m.id} mat={m} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function MaterialRow({ mat, onChanged }) {
  const [price, setPrice] = useState(String(mat.unit_price ?? 0));
  const [qty, setQty] = useState(String(mat.quantity ?? 0));
  const [savingField, setSavingField] = useState(null);
  const [deleting, setDeleting] = useState(false);

  React.useEffect(() => {
    setPrice(String(mat.unit_price ?? 0));
    setQty(String(mat.quantity ?? 0));
  }, [mat.unit_price, mat.quantity]);

  const save = async (field, value) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric) || numeric < 0) return;
    if (
      (field === "unit_price" && numeric === Number(mat.unit_price)) ||
      (field === "quantity" && numeric === Number(mat.quantity))
    ) {
      return;
    }
    setSavingField(field);
    try {
      await apiClient.patch(`/materials/${mat.id}`, { [field]: numeric });
      await onChanged();
    } catch (e) {
      // revert
      if (field === "unit_price") setPrice(String(mat.unit_price ?? 0));
      if (field === "quantity") setQty(String(mat.quantity ?? 0));
    } finally {
      setSavingField(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${mat.name}"?`)) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/materials/${mat.id}`);
      await onChanged();
    } finally {
      setDeleting(false);
    }
  };

  const lineTotal = (Number(qty) || 0) * (Number(price) || 0);

  return (
    <div
      data-testid={`material-row-${mat.id}`}
      className="grid grid-cols-[1fr_120px_120px_140px_60px] gap-3 px-4 py-3 items-center hover:bg-white/[0.02] transition-colors"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate" title={mat.name}>{mat.name}</span>
          {mat.ai_extracted && (
            <span className="label-mono bg-[#FFCC00]/15 border border-[#FFCC00]/40 text-[#FFCC00] px-1.5 py-0.5 whitespace-nowrap">
              AI
            </span>
          )}
        </div>
        <div className="label-mono mt-0.5 text-neutral-500">{mat.unit}</div>
      </div>
      <input
        data-testid={`material-qty-${mat.id}`}
        type="number"
        min="0"
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        onBlur={() => save("quantity", qty)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`w-full bg-[#0F0F0F] border border-white/10 px-2 py-1.5 text-right font-mono text-sm focus:border-[#0055FF] ${
          savingField === "quantity" ? "border-[#FFCC00]" : ""
        }`}
      />
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 font-mono text-xs pointer-events-none">
          $
        </span>
        <input
          data-testid={`material-price-${mat.id}`}
          type="number"
          min="0"
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => save("unit_price", price)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className={`w-full bg-[#0F0F0F] border border-white/10 pl-5 pr-2 py-1.5 text-right font-mono text-sm focus:border-[#0055FF] ${
            savingField === "unit_price" ? "border-[#FFCC00]" : ""
          }`}
        />
      </div>
      <div
        data-testid={`material-total-${mat.id}`}
        className="text-right font-mono text-sm tabular-nums"
      >
        {fmtUSD(lineTotal)}
      </div>
      <button
        data-testid={`material-delete-${mat.id}`}
        onClick={remove}
        disabled={deleting}
        className="text-neutral-600 hover:text-[#FF6666] text-xs font-mono uppercase tracking-wider disabled:opacity-50"
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}
