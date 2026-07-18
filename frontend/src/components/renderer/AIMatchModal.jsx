import React from "react";

/**
 * Modal that runs the GPT-4o "AI Match" flow — sizes the 3D model to the
 * building visible in the site's satellite tile.
 */
export function AIMatchModal({
  onClose, aiBusy, aiResult, aiError,
  refLabel, setRefLabel, refFeet, setRefFeet, onRun,
}) {
  return (
    <div
      data-testid="ai-match-modal"
      className="fixed inset-0 z-30 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0a0a0a] border border-white/10 max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black">
          <div>
            <div className="label-mono text-[#FFCC00]">// AI MATCH · GPT-4o VISION</div>
            <div className="font-display text-lg tracking-tighter mt-1">Match satellite scale</div>
          </div>
          <button
            data-testid="ai-match-close"
            onClick={onClose}
            className="text-neutral-500 hover:text-white text-2xl leading-none"
          >✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-neutral-400 leading-relaxed">
            GPT-4o will detect the building in your satellite tile and size your 3D model
            to match. Optionally hint a known reference dimension to lock the scale exactly.
          </p>

          <div className="space-y-3">
            <label className="block">
              <div className="label-mono mb-1.5 text-neutral-500">Building hint (optional)</div>
              <input
                data-testid="ai-match-label"
                type="text"
                value={refLabel}
                onChange={(e) => setRefLabel(e.target.value)}
                placeholder="e.g. 'the white house with gable roof'"
                maxLength={80}
                className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block">
              <div className="label-mono mb-1.5 text-neutral-500">
                Known dimension (optional) — feet
              </div>
              <input
                data-testid="ai-match-feet"
                type="number"
                min="1"
                max="10000"
                value={refFeet}
                onChange={(e) => setRefFeet(e.target.value)}
                placeholder='e.g. 32 (front wall length)'
                className="w-full bg-black border border-white/15 px-3 py-2 font-mono text-sm"
              />
              <div className="text-[10px] text-neutral-600 font-mono mt-1">
                Locks AI&apos;s estimate to your known size — most accurate.
              </div>
            </label>
          </div>

          {aiError && (
            <div data-testid="ai-match-error" className="border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-xs font-mono px-3 py-2">
              {aiError}
            </div>
          )}

          {aiResult && (
            <div data-testid="ai-match-result"
                 className={`border px-3 py-3 text-xs font-mono space-y-1 ${
                   aiResult.applied
                     ? "border-[#00CC66]/50 bg-[#00CC66]/10"
                     : "border-[#FF8866]/40 bg-[#FF8866]/10"
                 }`}>
              <div className={`font-bold ${aiResult.applied ? "text-[#88EEAA]" : "text-[#FFB8A0]"}`}>
                {aiResult.applied
                  ? `✓ Applied scale ${aiResult.scale.toFixed(3)}×`
                  : `✗ No building detected`}
              </div>
              {aiResult.detection?.found && (
                <>
                  <div className="text-neutral-300">
                    Detected: ~{Math.round(aiResult.detection.width_ft)} × {Math.round(aiResult.detection.depth_ft)} ft
                    <span className="text-neutral-500 ml-2">
                      (confidence {(aiResult.detection.confidence * 100).toFixed(0)}%)
                    </span>
                  </div>
                  {aiResult.detection.rationale && (
                    <div className="text-neutral-500 italic">&ldquo;{aiResult.detection.rationale}&rdquo;</div>
                  )}
                </>
              )}
              {aiResult.message && !aiResult.detection?.rationale && (
                <div className="text-neutral-400">{aiResult.message}</div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              data-testid="ai-match-run"
              onClick={onRun}
              disabled={aiBusy}
              className="flex-1 bg-[#FFCC00] hover:bg-[#E6B800] disabled:opacity-40 text-black font-bold py-2.5 text-xs uppercase tracking-wider"
            >
              {aiBusy ? "Analyzing…" : (aiResult ? "Re-run" : "Detect & match")}
            </button>
            <button
              data-testid="ai-match-done"
              onClick={onClose}
              className="px-4 py-2.5 text-xs uppercase tracking-wider border border-white/15 text-neutral-300 hover:bg-white/5"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
