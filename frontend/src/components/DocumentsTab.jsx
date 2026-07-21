import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, useStore, API } from "../store";
import ManualTraceOverlay from "./ManualTraceOverlay";

const SHEET_TYPE_OPTIONS = [
  { value: "", label: "Auto-detect (recommended)" },
  { value: "floor_plan", label: "Floor Plan" },
  { value: "blueprint", label: "Blueprint" },
  { value: "site_plan", label: "Site Plan" },
  { value: "foundation_plan", label: "Foundation Plan" },
  { value: "framing_plan", label: "Framing Plan" },
  { value: "roof_plan", label: "Roof Plan" },
  { value: "sheathing_plan", label: "Sheathing Plan" },
  { value: "elevation", label: "Elevation" },
  { value: "electrical_plan", label: "Electrical Plan" },
  { value: "plumbing_plan", label: "Plumbing Plan" },
  { value: "hvac_plan", label: "HVAC Plan" },
  { value: "detail", label: "Detail" },
];

const STATUS_LABEL = {
  uploaded: "Uploading",
  analyzing: "Analyzing",
  saving: "Saving",
  syncing: "Syncing 3D",
  done: "Complete",
  error: "Error",
};
const STAGES = ["uploaded", "analyzing", "saving", "syncing", "done"];

function ProgressBar({ status }) {
  if (status === "error") {
    return (
      <div className="h-1 bg-[#FF3333]" />
    );
  }
  const idx = STAGES.indexOf(status);
  const pct = idx < 0 ? 5 : ((idx + 1) / STAGES.length) * 100;
  const animating = status !== "done";
  return (
    <div className="h-1 bg-white/5 relative overflow-hidden">
      <div
        className={`h-full bg-[#FFCC00] transition-all duration-500 ease-out ${animating ? "progress-pulse" : ""}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function DocumentsTab() {
  const { currentProjectId, documents, refreshDocuments, refreshMaterials, refreshBlueprint, refreshBilling } = useStore();
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [paywall, setPaywall] = useState(null);
  // Batch tracker: list of {name, docId?, status: "queued"|"uploading"|"uploaded"|"failed", error?}
  const [batch, setBatch] = useState([]);
  // Sheet-type hint sent to the AI on upload — empty = auto-detect.
  const [sheetLabelHint, setSheetLabelHint] = useState("");
  // Manual-trace overlay state — { doc, sheet } when open.
  const [traceTarget, setTraceTarget] = useState(null);

  // Auto-refresh whenever any document is still analyzing so users see progress
  // without needing to reload the page. Stops polling once everything settles.
  // Errors are swallowed so a transient network blip doesn't crash the UI.
  React.useEffect(() => {
    if (!currentProjectId) return;
    const active = (documents || []).some(
      (d) => d.status && !["done", "error"].includes(d.status)
    );
    if (!active) return;
    let cancelled = false;
    const t = setInterval(async () => {
      if (cancelled) return;
      try { await refreshDocuments(); } catch (_) { /* transient */ }
      if (cancelled) return;
      try { await refreshMaterials(); } catch (_) { /* transient */ }
      if (cancelled) return;
      try { await refreshBlueprint(); } catch (_) { /* transient */ }
    }, 3500);
    return () => { cancelled = true; clearInterval(t); };
  }, [currentProjectId, documents, refreshDocuments, refreshMaterials, refreshBlueprint]);

  // Accept common blueprint / plan formats when reading a folder. Other files
  // in the folder (README.txt, .DS_Store, .dwg, etc.) are silently skipped.
  const ALLOWED_MIME = /^(image\/(png|jpe?g|webp)|application\/pdf)$/i;
  const ALLOWED_EXT = /\.(png|jpe?g|webp|pdf)$/i;
  const isBlueprintFile = (f) =>
    ALLOWED_MIME.test(f.type || "") || ALLOWED_EXT.test(f.name || "");

  const onFiles = async (rawFiles, { fromFolder = false } = {}) => {
    if (!rawFiles?.length || !currentProjectId) return;
    const files = fromFolder ? rawFiles.filter(isBlueprintFile) : rawFiles;
    if (!files.length) {
      alert("No blueprint files found in that folder (PNG / JPG / WEBP / PDF).");
      return;
    }
    setUploading(true);
    setPaywall(null);
    // Seed the batch tracker so users see the queue immediately.
    const initial = files.map((f, i) => ({
      key: `${Date.now()}_${i}`,
      name: f.name,
      status: "queued",
    }));
    setBatch(initial);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBatch((b) => b.map((x, idx) => idx === i ? { ...x, status: "uploading" } : x));
        // Retry once on transient network error (ingress hiccup, TCP reset).
        let lastErr = null;
        let uploaded = false;
        for (let attempt = 0; attempt < 2 && !uploaded; attempt++) {
          try {
            const fd = new FormData();
            fd.append("file", file);
            if (sheetLabelHint) fd.append("sheet_label_hint", sheetLabelHint);
            const { data } = await apiClient.post(
              `/projects/${currentProjectId}/documents/upload`, fd,
              {
                headers: { "Content-Type": "multipart/form-data" },
                // 5-minute timeout — huge PDFs can take a bit to upload over
                // slow connections. The server itself now returns 200 fast
                // (heavy work is background), so this is only for the transfer.
                timeout: 300_000,
              },
            );
            setBatch((b) => b.map((x, idx) => idx === i ? { ...x, status: "uploaded", docId: data.id } : x));
            uploaded = true;
          } catch (e) {
            lastErr = e;
            const status = e.response?.status;
            if (status === 402) break;  // paywall — don't retry
            if (status && status >= 400 && status < 500) break;  // client error, don't retry
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        if (!uploaded) {
          const detail = lastErr?.response?.data?.detail;
          if (lastErr?.response?.status === 402) {
            setPaywall(typeof detail === "string" ? detail : "Quota reached — upgrade your plan.");
            setBatch((b) => b.map((x, idx) => idx === i ? { ...x, status: "failed", error: "quota" } : x));
            break;
          }
          setBatch((b) => b.map((x, idx) => idx === i ? { ...x, status: "failed", error: typeof detail === "string" ? detail : (lastErr?.message || "upload failed") } : x));
        }
      }
      await refreshDocuments();
      await refreshMaterials();
      await refreshBlueprint();
      await refreshBilling();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
  };

  // Derive live per-batch stats from the current documents array.
  const batchStats = React.useMemo(() => {
    const idSet = new Set(batch.map((b) => b.docId).filter(Boolean));
    // "Uploaded" = files that succeeded the POST (excluding failures).
    const uploadedOk = batch.filter((b) => b.docId).length;
    const failedCount = batch.filter((b) => b.status === "failed").length;
    const docsInBatch = (documents || []).filter((d) => idSet.has(d.id));
    const analyzing = docsInBatch.filter((d) => !["done", "error"].includes(d.status)).length;
    const done = docsInBatch.filter((d) => d.status === "done").length;
    const backendErrored = docsInBatch.filter((d) => d.status === "error").length;
    const sheetsCreated = docsInBatch.filter(
      (d) => d.status === "done" && d.synced_3d,
    ).length;
    return {
      total: batch.length,
      uploadedOk,
      analyzing,
      done,
      errored: failedCount + backendErrored,
      sheetsCreated,
      allSettled: batch.length > 0 && analyzing === 0 && batch.every((b) => b.status !== "queued" && b.status !== "uploading"),
    };
  }, [batch, documents]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] h-full" data-testid="documents-tab">
      {/* Upload zone */}
      <section className="border-r border-white/10 p-8 flex flex-col">
        <div className="label-mono mb-2">// STEP 01</div>
        <h2 className="font-display text-3xl tracking-tighter mb-2">Drop a blueprint.</h2>
        <p className="text-neutral-500 text-sm mb-6 leading-relaxed">
          PNG, JPG, WEBP, or <span className="text-[#FFCC00] font-bold">multi-page PDF</span> (up to 20 sheets). Atlas AI will detect walls, extract materials with cross-page deduplication, and sync every tab automatically.
        </p>

        {paywall && (
          <div
            data-testid="upload-paywall"
            className="mb-4 border border-[#FFCC00] bg-[#FFCC00]/10 text-[#FFCC00] px-4 py-3 text-sm"
          >
            <div className="font-bold mb-1">Upload quota reached</div>
            <div className="text-xs text-neutral-300 mb-2">{paywall}</div>
            <button
              onClick={() => navigate("/billing")}
              className="bg-[#FFCC00] text-black font-bold px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-[#E6B800]"
            >
              View plans →
            </button>
          </div>
        )}

        <label
          data-testid="upload-dropzone"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFiles(Array.from(e.dataTransfer.files));
          }}
          className={`block border-2 border-dashed p-10 text-center cursor-pointer transition-all duration-150 ${
            dragOver ? "border-[#FFCC00] bg-[#FFCC00]/5" : "border-white/15 hover:border-white/30 bg-[#0F0F0F]"
          }`}
        >
          <input
            ref={fileRef}
            data-testid="upload-file-input"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => onFiles(Array.from(e.target.files))}
          />
          <div className="w-16 h-16 mx-auto mb-4 border border-[#FFCC00] flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-[#FFCC00]" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4v16m-8-8h16" />
            </svg>
          </div>
          <div className="font-display text-xl">
            {uploading ? "Uploading..." : "Drop or browse"}
          </div>
          <div className="label-mono mt-2 text-neutral-500">PNG · JPG · WEBP · PDF · MAX 16MB</div>
        </label>

        {/* Sheet-type hint dropdown — tells the AI what kind of drawing this is */}
        <div className="mt-3">
          <label className="block text-[10px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
            Sheet type hint <span className="text-neutral-600">· helps AI classify</span>
          </label>
          <select
            data-testid="upload-sheet-label-hint"
            value={sheetLabelHint}
            onChange={(e) => setSheetLabelHint(e.target.value)}
            disabled={uploading}
            className="w-full bg-black border border-white/15 text-neutral-200 text-xs px-3 py-2 font-mono disabled:opacity-40"
          >
            {SHEET_TYPE_OPTIONS.map((o) => (
              <option key={o.value || "auto"} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Folder upload — pick an entire directory of blueprints */}
        <div className="mt-3">
          <input
            ref={folderRef}
            data-testid="upload-folder-input"
            type="file"
            className="hidden"
            multiple
            // Non-standard but widely supported (Chrome, Edge, Safari, Firefox 111+).
            // React doesn't know these attributes; suppress the ESLint check.
            /* eslint-disable react/no-unknown-property */
            webkitdirectory=""
            directory=""
            /* eslint-enable react/no-unknown-property */
            onChange={(e) => onFiles(Array.from(e.target.files), { fromFolder: true })}
          />
          <button
            data-testid="upload-folder-btn"
            type="button"
            onClick={() => folderRef.current?.click()}
            className="w-full text-xs uppercase tracking-wider font-bold border border-white/15 text-neutral-400 hover:text-[#FFCC00] hover:border-[#FFCC00] py-2.5 transition-colors flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Upload entire folder
          </button>
        </div>

        {/* Retry all errored — visible only when at least one doc is in error state */}
        {(documents || []).some((d) => d.status === "error") && (
          <button
            data-testid="upload-retry-all-errored"
            type="button"
            onClick={async () => {
              try {
                const { data } = await apiClient.post(`/projects/${currentProjectId}/documents/retry-all-errored`);
                let msg = `Retrying ${data.retried} document${data.retried === 1 ? "" : "s"}.`;
                if (data.skipped_no_thumb > 0) {
                  msg += `\n\n${data.skipped_no_thumb} document${data.skipped_no_thumb === 1 ? " was" : "s were"} skipped because the original page data is no longer cached — please re-upload those files.`;
                }
                if (data.skipped_error > 0) {
                  msg += `\n\n${data.skipped_error} document${data.skipped_error === 1 ? "" : "s"} skipped due to a load error — try again shortly.`;
                }
                if (data.batch_capped) {
                  msg += `\n\nBatch capped at 25 to keep the AI queue healthy — click Retry-all again after these finish for the next batch.`;
                }
                alert(msg);
                await refreshDocuments();
              } catch (e) {
                alert(`Retry-all failed: ${e?.response?.data?.detail || e?.message || "unknown"}`);
              }
            }}
            className="mt-3 w-full text-xs uppercase tracking-wider font-bold bg-[#FFCC00]/10 border border-[#FFCC00] text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black py-2.5 transition-colors flex items-center justify-center gap-2"
          >
            ↻ Retry all errored documents
          </button>
        )}

        {/* Live batch progress — appears while a multi-file upload is in flight */}
        {batch.length > 0 && (
          <div
            data-testid="upload-batch-progress"
            className="mt-4 border border-[#FFCC00]/30 bg-black/50 p-3 font-mono text-xs"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="label-mono text-[#FFCC00]">// BATCH</div>
              {batchStats.allSettled && (
                <button
                  data-testid="upload-batch-clear"
                  onClick={() => setBatch([])}
                  className="text-[10px] text-neutral-500 hover:text-white uppercase tracking-wider"
                >
                  clear
                </button>
              )}
            </div>
            <div
              data-testid="upload-batch-headline"
              className="text-white text-sm mb-2 font-medium"
            >
              {batchStats.uploadedOk} of {batchStats.total} uploaded ·{" "}
              {batchStats.done} traced ·{" "}
              <span className="text-[#00CC66]">{batchStats.sheetsCreated} sheets</span>
              {batchStats.errored > 0 && (
                <> · <span className="text-[#FF6666]">{batchStats.errored} failed</span></>
              )}
            </div>
            {/* Progress bar */}
            <div className="h-1 bg-white/5 mb-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  batchStats.allSettled ? "bg-[#00CC66]" : "bg-[#FFCC00] progress-pulse"
                }`}
                style={{
                  width: `${Math.max(2, Math.round(
                    ((batchStats.done + batchStats.errored) / Math.max(1, batchStats.total)) * 100
                  ))}%`,
                }}
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {batch.map((b, i) => {
                const doc = b.docId ? (documents || []).find((d) => d.id === b.docId) : null;
                let label = b.status;
                let color = "text-neutral-500";
                if (b.status === "queued") { label = "queued"; }
                else if (b.status === "uploading") { label = "uploading…"; color = "text-[#FFCC00]"; }
                else if (b.status === "failed") { label = `failed · ${b.error || ""}`; color = "text-[#FF6666]"; }
                else if (doc) {
                  if (doc.status === "done") { label = doc.synced_3d ? "sheet created ✓" : "analyzed ✓"; color = "text-[#00CC66]"; }
                  else if (doc.status === "error") { label = "error"; color = "text-[#FF6666]"; }
                  else { label = `${doc.status}${doc.pages_total > 1 ? ` (${doc.pages_done || 0}/${doc.pages_total})` : ""}`; color = "text-[#FFCC00]"; }
                }
                return (
                  <div
                    key={b.key}
                    data-testid={`upload-batch-item-${i}`}
                    className="flex items-center justify-between gap-2 text-[10px]"
                  >
                    <span className="truncate text-neutral-300 flex-1 min-w-0">{b.name}</span>
                    <span className={`${color} tabular-nums uppercase tracking-wider whitespace-nowrap`}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-8 space-y-4 text-sm">
          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 border border-white/10 flex items-center justify-center label-mono">1</div>
            <div>
              <div className="font-medium">Upload</div>
              <div className="text-neutral-500 text-xs">File hits storage, card appears.</div>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 border border-white/10 flex items-center justify-center label-mono">2</div>
            <div>
              <div className="font-medium">AI Vision Analyzes</div>
              <div className="text-neutral-500 text-xs">GPT-4o reads materials, rooms, and structure.</div>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 border border-white/10 flex items-center justify-center label-mono">3</div>
            <div>
              <div className="font-medium">Materials Saved</div>
              <div className="text-neutral-500 text-xs">Inserted by category in Materials tab.</div>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <div className="w-6 h-6 border border-white/10 flex items-center justify-center label-mono">4</div>
            <div>
              <div className="font-medium">Blueprint + 3D Sync</div>
              <div className="text-neutral-500 text-xs">Walls, doors, windows merged across all tabs.</div>
            </div>
          </div>
        </div>
      </section>

      {/* Documents list */}
      <section className="p-8 overflow-y-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="label-mono mb-1">// LIBRARY</div>
            <h2 className="font-display text-3xl tracking-tighter">
              {documents.length} Document{documents.length === 1 ? "" : "s"}
            </h2>
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="border border-white/10 p-12 text-center text-neutral-500 font-mono text-sm">
            No documents yet. Drop your first blueprint to begin.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {documents.map((d) => (
              <DocCard key={d.id} doc={d} onTrace={setTraceTarget} />
            ))}
          </div>
        )}
      </section>

      {traceTarget && (
        <ManualTraceOverlay
          doc={traceTarget.doc}
          sheet={traceTarget.sheet}
          onClose={() => setTraceTarget(null)}
          onSaved={async () => {
            await refreshDocuments();
            await refreshBlueprint();
          }}
        />
      )}
    </div>
  );
}

function DocCard({ doc, onTrace }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [loadingTrace, setLoadingTrace] = useState(false);
  const { currentProjectId, refreshDocuments, refreshMaterials, refreshBlueprint } = useStore();

  React.useEffect(() => {
    let alive = true;
    if (doc.mime_type?.startsWith("image/")) {
      apiClient.get(`/documents/${doc.id}/image`).then(({ data }) => {
        if (alive && data.image_base64) {
          setImgUrl(`data:${data.mime_type};base64,${data.image_base64}`);
        }
      }).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [doc.id, doc.mime_type]);

  const onDelete = async () => {
    const warn = (doc.materials_merged || 0) > 0
      ? `Delete "${doc.filename}"?\n\nThis removes ${doc.materials_count || 0} material item(s) extracted from this document. The ${doc.materials_merged} item(s) that were merged into existing materials will keep their accumulated quantities (those can't be reversed automatically — adjust them manually in the Materials tab if needed).\n\nThis cannot be undone.`
      : `Delete "${doc.filename}"?\n\nThis will remove the document and any ${doc.materials_count || 0} materials extracted from it. This cannot be undone.`;
    if (!window.confirm(warn)) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/documents/${doc.id}`);
      await Promise.all([refreshDocuments(), refreshMaterials(), refreshBlueprint()]);
    } catch (e) {
      alert(e.response?.data?.detail || e.message || "Failed to delete document");
      setDeleting(false);
    }
  };

  const openTrace = async () => {
    if (!onTrace) return;
    setLoadingTrace(true);
    try {
      // Find the sheet created from this doc so we can pre-load its walls.
      const { data: sheets } = await apiClient.get(
        `/projects/${currentProjectId}/blueprint/sheets`,
      );
      const sheet = (sheets || []).find(
        (s) => s.source_document_id === doc.id,
      );
      if (!sheet) {
        alert("No blueprint sheet linked to this document yet. Wait for analysis to finish, then try again.");
        return;
      }
      onTrace({ doc, sheet });
    } catch (e) {
      const msg = typeof e?.response?.data?.detail === "string"
        ? e.response.data.detail
        : Array.isArray(e?.response?.data?.detail)
        ? e.response.data.detail.map((d) => d?.msg || JSON.stringify(d)).join("; ")
        : e?.message || "Failed to open trace";
      alert(`Failed to open trace: ${msg}`);
    } finally {
      setLoadingTrace(false);
    }
  };

  const done = doc.status === "done";
  const error = doc.status === "error";

  return (
    <article
      data-testid={`document-card-${doc.id}`}
      className="border border-white/10 bg-[#141414] hover:bg-[#1A1A1A] transition-all duration-150 fade-up group"
    >
      <div className="aspect-video bg-black border-b border-white/10 relative overflow-hidden">
        {imgUrl ? (
          <img src={imgUrl} alt={doc.filename} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-neutral-700 font-mono text-xs">
            {doc.mime_type}
          </div>
        )}
        {doc.doc_type && (
          <div className="absolute top-2 left-2 bg-black/80 border border-[#0055FF] text-[#0055FF] label-mono px-2 py-1">
            {doc.doc_type}
          </div>
        )}
        <button
          data-testid={`document-delete-${doc.id}`}
          onClick={onDelete}
          disabled={deleting}
          title="Delete this document"
          className="absolute top-2 right-2 bg-black/80 border border-[#FF3333]/40 text-[#FF6666] hover:bg-[#FF3333] hover:text-white disabled:opacity-50 w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {deleting ? (
            <span className="font-mono text-xs">…</span>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
            </svg>
          )}
        </button>
      </div>

      <ProgressBar status={doc.status} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" title={doc.filename}>{doc.filename}</div>
            <div className="label-mono mt-1">
              {(doc.size / 1024).toFixed(1)} KB · {new Date(doc.created_at).toLocaleString()}
            </div>
          </div>
          <span
            className={`label-mono whitespace-nowrap px-2 py-1 ${
              error
                ? "bg-[#FF3333]/20 text-[#FF6666] border border-[#FF3333]/40"
                : done
                ? "bg-[#00CC66]/20 text-[#00CC66] border border-[#00CC66]/40"
                : "bg-[#FFCC00]/20 text-[#FFCC00] border border-[#FFCC00]/40"
            }`}
          >
            {STATUS_LABEL[doc.status] || doc.status}
            {doc.pages_total > 1 && !done && !error && (
              <span className="ml-1 text-neutral-400">
                · pg {doc.pages_done || 0}/{doc.pages_total}
              </span>
            )}
          </span>
        </div>

        {doc.analysis?.summary && (
          <p className="text-xs text-neutral-400 mt-3 leading-relaxed line-clamp-3">
            {doc.analysis.summary}
          </p>
        )}

        {error && (
          <button
            data-testid={`document-retry-${doc.id}`}
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await apiClient.post(`/documents/${doc.id}/retry`);
                // status update handled by the tab's polling loop
              } catch (err) {
                const msg = err?.response?.data?.detail || err?.message || "Retry failed";
                alert(`Retry failed: ${msg}${msg.includes("re-upload") ? "\n\nTip: for multi-page PDFs, please re-upload the file." : ""}`);
              }
            }}
            className="mt-3 label-mono px-3 py-1.5 bg-[#FFCC00] text-black hover:bg-[#E6B800] transition-colors"
            title="Re-run the AI analysis pipeline on this document"
          >
            ↻ RETRY
          </button>
        )}

        {done && (
          <div className="flex flex-wrap gap-1 mt-3">
            <Badge>✓ Analyzed</Badge>
            {doc.pages_total > 1 && <Badge variant="blue">{doc.pages_total} pages</Badge>}
            <Badge>{doc.materials_count || 0} new</Badge>
            {(doc.materials_merged || 0) > 0 && (
              <Badge variant="orange" title="Merged into existing materials">
                +{doc.materials_merged} merged
              </Badge>
            )}
            {(doc.materials_skipped || 0) > 0 && (
              <Badge variant="gray" title="Skipped — same as existing materials">
                {doc.materials_skipped} skipped
              </Badge>
            )}
            {doc.synced_3d && <Badge variant="blue">🏗 3D synced</Badge>}
          </div>
        )}
        {done && doc.synced_3d && (
          <button
            data-testid={`document-trace-${doc.id}`}
            onClick={openTrace}
            disabled={loadingTrace}
            className="mt-3 w-full label-mono px-3 py-2 border border-[#00E5FF]/50 bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
            title="Open manual wall tracer — draw walls over the blueprint, AI re-extracts doors, windows, labels"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 20l16-16M8 4h12v12" />
            </svg>
            {loadingTrace ? "OPENING…" : "TRACE WALLS MANUALLY"}
          </button>
        )}
        {done && doc.dedup_audit?.some?.((a) => a.decision !== "new") && (
          <details className="mt-2">
            <summary className="text-xs font-mono text-neutral-500 cursor-pointer hover:text-neutral-300">
              dedup details
            </summary>
            <ul className="mt-2 space-y-1 text-xs font-mono text-neutral-400">
              {doc.dedup_audit.filter((a) => a.decision !== "new").map((a, i) => (
                <li key={i} className="flex gap-2">
                  <span className={a.decision === "merge" ? "text-[#FF6600]" : "text-neutral-500"}>
                    {a.decision === "merge" ? `+${a.added_quantity ?? 0}` : "skip"}
                  </span>
                  <span className="truncate">{a.name}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {error && doc.error && (
          <div className="text-[#FF6666] text-xs mt-2 font-mono">{doc.error}</div>
        )}
      </div>
    </article>
  );
}

function Badge({ children, variant, title }) {
  const cls =
    variant === "blue"
      ? "bg-[#0055FF]/15 text-[#5588FF] border-[#0055FF]/40"
      : variant === "orange"
      ? "bg-[#FF6600]/15 text-[#FF8844] border-[#FF6600]/40"
      : variant === "gray"
      ? "bg-neutral-500/10 text-neutral-400 border-neutral-500/30"
      : "bg-white/5 text-neutral-300 border-white/10";
  return (
    <span className={`label-mono px-2 py-1 border ${cls}`} title={title}>{children}</span>
  );
}
