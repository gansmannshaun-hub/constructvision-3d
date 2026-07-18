import React from "react";

const FEATURE_ICONS = {
  tree: "🌲", trees: "🌲", building: "▣",
  water: "≋", road: "═", driveway: "═",
  vegetation: "♣", rock: "◆", slope: "△",
};

/**
 * Right sidebar top block: site thumbnail + 3D landscape controls +
 * per-feature list. Rendered only when a site has been captured; the
 * "PICK SITE FROM MAP" CTA is rendered separately in the parent.
 */
export function SidebarSite({
  site, onOpenPicker,
  terrainStats, verticalExag, onExagChange,
  buildingLandscape, landscapeError,
  onBuildLandscape, onClearLandscape,
  onToggleFeatureHidden, onDeleteFeature,
}) {
  return (
    <div className="border border-white/10 mb-6 overflow-hidden">
      <img
        data-testid="renderer-site-thumb"
        src={`data:image/png;base64,${site.image_base64}`}
        alt="Site satellite view"
        className="w-full h-32 object-cover"
      />
      <div className="p-3">
        <div className="text-xs font-mono text-neutral-300 truncate">
          {site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`}
        </div>
        <div className="label-mono text-neutral-500 mt-1">
          {Math.round((site.world_meters || 0) * 3.28084)} ft × {Math.round((site.world_meters || 0) * 3.28084)} ft
        </div>
        {site.analysis?.summary && (
          <p className="text-xs text-neutral-400 leading-relaxed mt-2 line-clamp-3">
            {site.analysis.summary}
          </p>
        )}
        {site.analysis?.lot_estimate_sqft && (
          <div className="label-mono text-[#FFCC00] mt-2">
            ≈ {site.analysis.lot_estimate_sqft.toLocaleString()} sqft
          </div>
        )}
        <button
          data-testid="renderer-site-edit"
          onClick={onOpenPicker}
          className="mt-3 w-full label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5"
        >Change site</button>

        <div className="mt-3 border-t border-white/10 pt-3">
          {site?.terrain_3d ? (
            <TerrainActive
              site={site}
              terrainStats={terrainStats}
              verticalExag={verticalExag}
              onExagChange={onExagChange}
              buildingLandscape={buildingLandscape}
              onBuildLandscape={onBuildLandscape}
              onClearLandscape={onClearLandscape}
              onToggleFeatureHidden={onToggleFeatureHidden}
              onDeleteFeature={onDeleteFeature}
            />
          ) : (
            <button
              data-testid="renderer-landscape-build"
              onClick={onBuildLandscape}
              disabled={buildingLandscape}
              className="w-full label-mono px-3 py-2 bg-gradient-to-r from-[#2D5C2D]/30 to-[#FFCC00]/20 border border-[#88EEAA]/50 text-[#88EEAA] hover:from-[#2D5C2D] hover:to-[#FFCC00] hover:text-black disabled:opacity-40 transition-all flex items-center justify-center gap-2"
              title="Generate 3D heightmap terrain + extrude AI-detected trees, buildings, water, etc."
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 19l5-7 4 3 3-5 6 9z"/>
                <circle cx="7" cy="7" r="2"/>
              </svg>
              {buildingLandscape ? "BUILDING 3D…" : "✦ BUILD 3D LANDSCAPE"}
            </button>
          )}
          {landscapeError && (
            <div data-testid="renderer-landscape-error" className="mt-2 border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666] text-[11px] font-mono px-3 py-2 leading-relaxed">
              {landscapeError}
            </div>
          )}
          {!site?.terrain_3d && !buildingLandscape && !landscapeError && (
            <p className="text-[10px] font-mono text-neutral-500 mt-2 leading-relaxed">
              Generates real terrain elevation (Google Elevation API) + extrudes AI-detected
              trees, buildings, water, roads, rocks, and vegetation as 3D objects.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TerrainActive({
  site, terrainStats, verticalExag, onExagChange,
  buildingLandscape, onBuildLandscape, onClearLandscape,
  onToggleFeatureHidden, onDeleteFeature,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label-mono text-[#88EEAA]">// 3D LANDSCAPE · ACTIVE</span>
        <button
          data-testid="renderer-landscape-clear"
          onClick={onClearLandscape}
          className="label-mono text-neutral-500 hover:text-[#FF6666] text-[10px] px-2 py-0.5 border border-white/10"
          title="Remove the 3D landscape and return to flat satellite plane"
        >✕ CLEAR</button>
      </div>
      <div className="text-[10px] font-mono text-neutral-500">
        Heightmap: {site.terrain_3d.grid_n}×{site.terrain_3d.grid_n} ·{" "}
        {site.terrain_3d.features_3d?.length || 0} feature{(site.terrain_3d.features_3d?.length||0) === 1 ? "" : "s"}
      </div>
      {terrainStats && (
        <div data-testid="terrain-elev-readout" className="text-[10px] font-mono text-neutral-400 border border-white/10 px-2 py-1.5 bg-white/[0.02]">
          <div className="flex justify-between">
            <span>Elevation Δ:</span>
            <span className="text-[#88EEAA]">{terrainStats.delta_ft.toFixed(1)} ft</span>
          </div>
          <div className="flex justify-between">
            <span>Range:</span>
            <span className="text-neutral-300">{terrainStats.elevation_min_m.toFixed(0)}–{terrainStats.elevation_max_m.toFixed(0)} m ASL</span>
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono text-neutral-500">VERTICAL EXAGGERATION</span>
          <span className="label-mono text-[#FFCC00]">{verticalExag.toFixed(1)}×</span>
        </div>
        <input
          data-testid="terrain-exaggeration"
          type="range"
          min="1"
          max="10"
          step="0.5"
          value={verticalExag}
          onChange={(e) => onExagChange(e.target.value)}
          className="w-full accent-[#FFCC00]"
        />
        <div className="flex justify-between text-[9px] font-mono text-neutral-600">
          <span>1× real</span><span>3× dramatic</span><span>10× extreme</span>
        </div>
      </div>
      <button
        data-testid="renderer-landscape-rebuild"
        onClick={onBuildLandscape}
        disabled={buildingLandscape}
        className="w-full label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5 disabled:opacity-40"
      >
        {buildingLandscape ? "REBUILDING…" : "↻ REBUILD 3D"}
      </button>

      {site.terrain_3d.compliance && (
        <div data-testid="terrain-compliance" className="mt-2 border border-white/10 p-2 text-[11px] font-mono">
          {site.terrain_3d.compliance.clean ? (
            <div className="text-[#88EEAA] flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7"/></svg>
              No zoning red flags detected.
            </div>
          ) : (
            <>
              <div className="font-bold text-[#FFCC00] mb-1">
                {site.terrain_3d.compliance.warn_count} zoning warning{site.terrain_3d.compliance.warn_count === 1 ? "" : "s"}
              </div>
              <ul className="space-y-1">
                {site.terrain_3d.compliance.warnings.slice(0, 4).map((w, i) => (
                  <li key={i} className="text-[#FFCC00]">
                    <span className="opacity-70">[{w.code}]</span> {w.message}
                  </li>
                ))}
                {site.terrain_3d.compliance.warnings.length > 4 && (
                  <li className="text-neutral-500">… +{site.terrain_3d.compliance.warnings.length - 4} more</li>
                )}
              </ul>
              <div className="text-[10px] text-neutral-500 mt-1.5">Verify against local zoning — limits vary by jurisdiction.</div>
            </>
          )}
        </div>
      )}

      {(site.terrain_3d.features_3d?.length || 0) > 0 && (
        <div data-testid="terrain-features-list" className="mt-2 border border-white/10 max-h-[220px] overflow-y-auto">
          <div className="label-mono text-neutral-500 px-2 pt-2 pb-1 sticky top-0 bg-black/80 backdrop-blur-sm">
            // FEATURES ({site.terrain_3d.features_3d.length})
          </div>
          <ul>
            {site.terrain_3d.features_3d.map((f, i) => {
              const icon = FEATURE_ICONS[String(f.kind || "").toLowerCase()] || "●";
              return (
                <li
                  key={i}
                  data-testid={`terrain-feature-row-${i}`}
                  className={`flex items-center gap-2 px-2 py-1.5 border-b border-white/5 last:border-b-0 hover:bg-white/[0.03] ${f.hidden ? "opacity-50" : ""}`}
                >
                  <span className="font-mono text-base w-5 text-center text-neutral-400">{icon}</span>
                  <span className="text-[11px] font-mono text-neutral-300 flex-1 truncate">
                    {f.label || f.kind}
                    {f.stories ? <span className="text-neutral-500"> · {f.stories}st</span> : null}
                  </span>
                  <button
                    data-testid={`terrain-feature-hide-${i}`}
                    onClick={() => onToggleFeatureHidden(i)}
                    className="label-mono text-neutral-500 hover:text-[#FFCC00] text-[10px] px-1.5 py-0.5 border border-white/10"
                    title={f.hidden ? "Show this feature" : "Hide this feature (kept in DB)"}
                  >
                    {f.hidden ? "show" : "hide"}
                  </button>
                  <button
                    data-testid={`terrain-feature-delete-${i}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${f.label || f.kind}"?`)) onDeleteFeature(i);
                    }}
                    className="label-mono text-neutral-500 hover:text-[#FF6666] text-[10px] px-1.5 py-0.5 border border-white/10"
                    title="Permanently delete this feature"
                  >✕</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
