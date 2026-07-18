import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  createSceneEngine,
  PHASES,
  MAX_PHASE,
  ALL_LAYERS,
  DEFAULT_CFG,
} from "../lib/renderer/sceneBuilder";
import SitePickerModal from "./SitePickerModal";
import AutonomousExtractPanel from "./AutonomousExtractPanel";
import { useSiteTerrain } from "./renderer/useSiteTerrain";
import { useModelPlacement } from "./renderer/useModelPlacement";
import { useTapeMeasure } from "./renderer/useTapeMeasure";
import { useSceneExport } from "./renderer/useSceneExport";
import { TopActionBar } from "./renderer/TopActionBar";
import { PhaseControls } from "./renderer/PhaseControls";
import { PlacementPanel } from "./renderer/PlacementPanel";
import { AIMatchModal } from "./renderer/AIMatchModal";
import { TapeMeasurePanel } from "./renderer/TapeMeasurePanel";
import { ExportPreviewModal } from "./renderer/ExportPreviewModal";
import { SidebarSite } from "./renderer/SidebarSite";
import { SidebarAssembly } from "./renderer/SidebarAssembly";
import { SidebarLayers } from "./renderer/SidebarLayers";

export default function RendererTab() {
  const { blueprint, saveBlueprint, currentProjectId } = useStore();
  const walls = blueprint.walls || [];
  const doors = blueprint.doors || [];
  const windows = blueprint.windows || [];
  const roofType  = blueprint.roof_type      || DEFAULT_CFG.roof_type;
  const roofPitch = blueprint.roof_pitch_deg ?? DEFAULT_CFG.roof_pitch_deg;
  const wallColor = blueprint.wall_color     || DEFAULT_CFG.wall_color;
  const roofColor = blueprint.roof_color     || DEFAULT_CFG.roof_color;

  // Phase / layer state (drives scene visibility)
  const [phase, setPhase] = useState(MAX_PHASE);
  const [layerOverrides, setLayerOverrides] = useState({});
  const [autoMode, setAutoMode] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [showSitePicker, setShowSitePicker] = useState(false);

  const mountRef = useRef(null);
  const engineRef = useRef(null);

  const site = useSiteTerrain(engineRef, currentProjectId);
  const placement = useModelPlacement({
    engineRef, currentProjectId,
    site: site.site, setSite: site.setSite, walls,
  });
  const measure = useTapeMeasure({ engineRef, currentProjectId });
  const exporter = useSceneExport({ engineRef, setPhase, setAutoMode });

  const updateCfg = useCallback(async (patch) => {
    setSavingCfg(true);
    try {
      await saveBlueprint(walls, doors, windows, blueprint.labels || [], patch);
    } finally {
      setSavingCfg(false);
    }
  }, [saveBlueprint, walls, doors, windows, blueprint.labels]);

  const visibleLayers = useMemo(() => {
    if (autoMode) {
      const set = new Set(PHASES[phase].layers);
      return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, set.has(l.id) || (layerOverrides[l.id] === true)]));
    }
    return Object.fromEntries(ALL_LAYERS.map((l) => [l.id, !!layerOverrides[l.id]]));
  }, [phase, layerOverrides, autoMode]);

  // Mount/unmount the scene engine
  useEffect(() => {
    if (!mountRef.current) return;
    const engine = createSceneEngine(mountRef.current);
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
  }, []);

  // Build geometry ONLY when the blueprint's structural content actually
  // changes. Polling hands us fresh object refs on every tick even when
  // the walls/doors/windows are byte-identical — rebuilding on every
  // ref-change was causing visible flicker AND interfering with in-progress
  // orbit/pan gestures. Content hash gates the rebuild so identical data
  // is a no-op.
  const buildPayload = useMemo(() => ({
    walls, doors, windows,
    roof_type: roofType, roof_pitch_deg: roofPitch,
    wall_color: wallColor, roof_color: roofColor,
    sheets: blueprint.sheets || [],
    wall_height_ft: blueprint.wall_height_ft,
    manual_override: blueprint.manual_override,
  }), [walls, doors, windows, roofType, roofPitch, wallColor, roofColor, blueprint.sheets, blueprint.wall_height_ft, blueprint.manual_override]);
  const buildHash = useMemo(() => JSON.stringify(buildPayload), [buildPayload]);
  const lastBuildHashRef = useRef(null);
  useEffect(() => {
    if (!engineRef.current) return;
    if (lastBuildHashRef.current === buildHash) return;
    lastBuildHashRef.current = buildHash;
    engineRef.current.build(buildPayload);
    engineRef.current.setVisibility(visibleLayers);
    // visibleLayers is intentionally excluded — reasserted below.
  }, [buildHash]);

  // Apply visibility on phase/layer changes
  useEffect(() => {
    engineRef.current?.setVisibility(visibleLayers);
  }, [visibleLayers]);

  // Animate phases when playing
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPhase((p) => {
        if (p >= MAX_PHASE) { setPlaying(false); return MAX_PHASE; }
        return p + 1;
      });
    }, 850);
    return () => clearInterval(t);
  }, [playing]);

  const empty = walls.length === 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px] grid-rows-[1fr_auto] md:grid-rows-1 h-full" data-testid="renderer-tab">
      <section className="relative min-h-[60vh] md:min-h-0 border-b border-white/10 md:border-b-0">
        <div className="absolute top-4 left-4 z-10 bg-black/70 border border-white/10 px-4 py-2 backdrop-blur-sm pointer-events-none">
          <div className="label-mono">// CONSTRUCTION PHASE</div>
          <div className="font-display text-lg tracking-tighter">{PHASES[phase].label}</div>
        </div>

        <TopActionBar
          empty={empty}
          rendering={exporter.rendering}
          onRenderStudio={exporter.renderStudio}
          recording={exporter.recording}
          recProgress={exporter.recProgress}
          onRecordWalkthrough={exporter.recordWalkthrough}
          site={site.site}
          placing={placement.placing}
          onStartPlacement={placement.startPlacement}
          measuring={measure.measuring}
          onStartMeasure={measure.startMeasure}
          onStopMeasure={measure.stopMeasure}
          onFitCamera={() => engineRef.current?.fitCamera()}
        />

        {empty && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="text-center bg-black/60 px-6 py-4 border border-white/10">
              <div className="label-mono text-neutral-500 mb-2">// NO GEOMETRY</div>
              <div className="text-neutral-400 font-mono text-sm">Upload a floor plan or draw walls in the CAD editor.</div>
            </div>
          </div>
        )}
        <div ref={mountRef} data-testid="renderer-canvas-mount" className="w-full h-full bg-[#f5f5f5]" />

        {placement.placing && (
          <PlacementPanel
            transform={placement.transform}
            onRotationChange={placement.onRotationChange}
            onScaleChange={placement.onScaleChange}
            onReset={placement.resetTransform}
            onOpenAIMatch={placement.openAIMatch}
            savingTransform={placement.savingTransform}
            onSave={placement.savePlacement}
            onCancel={placement.cancelPlacement}
          />
        )}

        {placement.aiOpen && (
          <AIMatchModal
            onClose={() => placement.setAiOpen(false)}
            aiBusy={placement.aiBusy}
            aiResult={placement.aiResult}
            aiError={placement.aiError}
            refLabel={placement.aiRefLabel}
            setRefLabel={placement.setAiRefLabel}
            refFeet={placement.aiRefFeet}
            setRefFeet={placement.setAiRefFeet}
            onRun={placement.runAIMatch}
          />
        )}

        {measure.measuring && (
          <TapeMeasurePanel
            pickStatus={measure.pickStatus}
            snapEnabled={measure.snapEnabled}
            onToggleSnap={measure.toggleSnap}
            measurePreview={measure.measurePreview}
            measurements={measure.measurements}
            onDelete={measure.deleteMeasurement}
            fmtFtIn={measure.fmtFtIn}
          />
        )}

        <PhaseControls
          phase={phase}
          setPhase={setPhase}
          playing={playing}
          setPlaying={setPlaying}
          autoMode={autoMode}
          setAutoMode={setAutoMode}
        />
      </section>

      <aside className="border-l border-white/10 p-5 overflow-y-auto">
        <div className="label-mono mb-2">// SITE</div>
        {site.site?.captured ? (
          <SidebarSite
            site={site.site}
            onOpenPicker={() => setShowSitePicker(true)}
            terrainStats={site.terrainStats}
            verticalExag={site.verticalExag}
            onExagChange={site.onExagChange}
            buildingLandscape={site.buildingLandscape}
            landscapeError={site.landscapeError}
            onBuildLandscape={site.buildLandscape}
            onClearLandscape={site.clearLandscape}
            onToggleFeatureHidden={site.toggleFeatureHidden}
            onDeleteFeature={site.deleteFeature}
          />
        ) : (
          <button
            data-testid="renderer-site-pick"
            onClick={() => setShowSitePicker(true)}
            className="w-full mb-6 border border-[#5588FF]/60 bg-[#0055FF]/10 hover:bg-[#0055FF]/20 text-[#5588FF] label-mono px-3 py-3 flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-7.6-7-12a7 7 0 0 1 14 0c0 4.4-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>
            PICK SITE FROM MAP
          </button>
        )}

        {/* Autonomous validation-gated extraction pipeline. */}
        <div className="mb-6">
          <AutonomousExtractPanel
            onLayout={(layout) => {
              // Seed the current session with the validated walls so the
              // 3D scene rebuilds from the extracted layout. Non-persistent
              // — user can Save & Sync from the CAD tab to make it stick.
              if (!layout?.walls?.length) return;
              const nextWalls = layout.walls.map((w, i) => ({
                id: w.id || `auto-w${i + 1}`,
                start: w.start,
                end: w.end,
                thickness: w.thickness_ft,
              }));
              useStore.setState((s) => ({
                blueprint: { ...s.blueprint, walls: nextWalls, building_ft: layout.building_ft || s.blueprint.building_ft },
              }));
            }}
          />
        </div>

        <div className="label-mono mb-2">// ROOF & FINISH</div>
        <SidebarAssembly
          blueprint={blueprint}
          roofType={roofType}
          roofPitch={roofPitch}
          wallColor={wallColor}
          roofColor={roofColor}
          savingCfg={savingCfg}
          updateCfg={updateCfg}
        />

        <div className="label-mono mb-2">// LAYERS</div>
        <p className="text-xs text-neutral-500 leading-relaxed mb-4">
          Toggle individual layers to peel through the build. AUTO mode follows the phase slider; MANUAL gives you per-layer control.
        </p>
        <SidebarLayers
          visibleLayers={visibleLayers}
          setAutoMode={setAutoMode}
          setLayerOverrides={setLayerOverrides}
        />

        <div className="mt-6 label-mono mb-2">// CONTROLS</div>
        <div className="text-xs text-neutral-400 font-mono space-y-1.5 leading-relaxed">
          <div>· Left drag — orbit</div>
          <div>· Right drag — pan</div>
          <div>· Scroll — zoom</div>
          <div>· Slider — scrub phases</div>
        </div>

        <div className="mt-6 border border-[#0055FF]/40 bg-[#0055FF]/5 p-3">
          <div className="label-mono text-[#5588FF]">// PROCEDURAL</div>
          <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
            Structural framing, MEP rough-ins, and site utilities are auto-generated from the wall
            footprint with standard trade spacing. Edits in the CAD editor instantly update every layer.
          </p>
        </div>
      </aside>

      {showSitePicker && currentProjectId && (
        <SitePickerModal
          projectId={currentProjectId}
          currentSite={site.site}
          onClose={() => setShowSitePicker(false)}
          onCaptured={(s) => site.setSite(s?.captured ? s : null)}
        />
      )}

      <ExportPreviewModal
        pendingExport={exporter.pendingExport}
        onClose={exporter.closeExportPreview}
        onDownload={exporter.downloadPendingExport}
      />
    </div>
  );
}
