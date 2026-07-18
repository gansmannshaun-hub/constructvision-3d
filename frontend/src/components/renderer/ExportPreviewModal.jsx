import React from "react";

/**
 * Modal that previews the last Studio Render / Walkthrough capture and
 * lets the user download or discard it.
 */
export function ExportPreviewModal({ pendingExport, onClose, onDownload }) {
  if (!pendingExport) return null;
  return (
    <div
      data-testid="export-preview-modal"
      className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0a0a0a] border border-[#FFCC00]/40 max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="label-mono text-[#FFCC00]">
              // {pendingExport.kind === "image" ? "STUDIO RENDER · READY" : "WALKTHROUGH · READY"}
            </div>
            <div className="text-[10px] font-mono text-neutral-500 mt-1">
              {pendingExport.kind === "image"
                ? `${pendingExport.width} × ${pendingExport.height} · ${pendingExport.sizeMb} MB · PNG`
                : `${pendingExport.duration}s · ${pendingExport.sizeMb} MB · WebM`}
            </div>
          </div>
          <button
            data-testid="export-preview-close"
            onClick={onClose}
            className="text-neutral-400 hover:text-white text-xl leading-none w-8 h-8 flex items-center justify-center border border-white/10 hover:border-white/30"
            title="Close without downloading"
          >✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-[#111] p-4 flex items-center justify-center">
          {pendingExport.kind === "image" ? (
            <img
              data-testid="export-preview-image"
              src={pendingExport.url}
              alt="Studio render preview"
              className="max-w-full max-h-[60vh] object-contain border border-white/10"
            />
          ) : (
            <video
              data-testid="export-preview-video"
              src={pendingExport.url}
              controls
              autoPlay
              loop
              className="max-w-full max-h-[60vh] border border-white/10"
            />
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
          <div className="text-xs font-mono text-neutral-500">
            {pendingExport.kind === "image"
              ? "Review the still. Download saves a 4K PNG to your computer."
              : "Review the walkthrough. Download saves the WebM to your computer."}
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="export-preview-discard"
              onClick={onClose}
              className="label-mono px-4 py-2 border border-white/15 hover:bg-white/5 text-xs"
            >DISCARD</button>
            <button
              data-testid="export-preview-download"
              onClick={onDownload}
              className="label-mono px-5 py-2 bg-[#FFCC00] hover:bg-[#E6B800] text-black text-xs flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 3v12M6 11l6 6 6-6M5 21h14"/>
              </svg>
              DOWNLOAD
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
