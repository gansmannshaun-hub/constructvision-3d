import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, useStore, API } from "../store";

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
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [paywall, setPaywall] = useState(null);

  const onFiles = async (files) => {
    if (!files?.length || !currentProjectId) return;
    setUploading(true);
    setPaywall(null);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        await apiClient.post(`/projects/${currentProjectId}/documents/upload`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      await refreshDocuments();
      await refreshMaterials();
      await refreshBlueprint();
      await refreshBilling();
    } catch (e) {
      if (e.response?.status === 402) {
        setPaywall(e.response.data?.detail || "Quota reached — upgrade your plan.");
      } else {
        alert(e.response?.data?.detail || "Upload failed");
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
              <DocCard key={d.id} doc={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DocCard({ doc }) {
  const [imgUrl, setImgUrl] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { refreshDocuments, refreshMaterials, refreshBlueprint } = useStore();

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
