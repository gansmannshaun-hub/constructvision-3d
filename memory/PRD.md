# Construction Management & 3D Visualization Platform — PRD

## Original problem statement
Build a Construction Management + 3D Visualization SaaS from scratch:
- Auto-pipeline: upload docs → GPT-4 Vision analyzes blueprints/materials
- Real-time material extraction with cross-tab live state
- 2D CAD, 3D Renderer, Materials & Documents — all share state with no refresh

Evolved to: PDF takeoffs, Stripe SaaS, Admin, SketchUp-style 2D CAD, 15-phase
procedural 3D renderer, CSV/XLSX/PDF exports, white-label client portals,
Google Maps site integration, regional pricing with labor/O&P, B2B
collaboration, Field Execution, AI moats (text→floorplan, code compliance,
schedule/Gantt, studio render, walkthrough video), AIA pay-apps, and an
email digest with /invite landing.

## Architecture (production-ready)
```
/app
├── backend/                         FastAPI · Motor (async Mongo)
│   ├── server.py                    slim entry — registers all routers
│   ├── admin.py                     admin dashboard + audit + user mgmt
│   ├── pricing.py / pricing_data.py RSMeans multipliers (+ placeholder zip guard)
│   ├── models/                      Pydantic models per domain
│   ├── routes/
│   │   ├── auth.py                  JWT login / register
│   │   ├── projects.py              projects CRUD + blueprint
│   │   ├── documents.py             PDF/IMG upload + AI material extraction
│   │   ├── materials.py             CRUD + cross-doc dedupe
│   │   ├── takeoff.py               CSV / XLSX / PDF exports
│   │   ├── pricing.py               region, labor, markup, bids+diffs
│   │   ├── site.py                  Google Maps lat/lng + AI terrain
│   │   ├── collab.py                roles + activities + invites + branding
│   │   ├── share.py                 white-label /share/{token} portal
│   │   ├── billing.py               Stripe subscriptions
│   │   ├── field.py                 daily logs (NOAA), AI photos, LiDAR
│   │   ├── ai_tools.py              text→floorplan + schedule/Gantt
│   │   ├── notifications.py         ✨ Resend digests + scheduler
│   │   └── pay_apps.py              ✨ AIA G702/G703 generator
│   └── tests/                       pytest — 235+ tests, 100% green
└── frontend/                        React + Tailwind + Zustand + Three.js
    ├── src/App.js                   router (now includes /invite/:token)
    ├── src/store.js                 zustand global state + apiClient
    ├── src/lib/
    │   ├── dim.js                   ft-in formatting + AABB
    │   ├── compliance.js            IBC/IRC live code-compliance engine
    │   └── renderer/sceneBuilder.js Three.js engine + captureHiRes + dolly
    ├── src/components/
    │   ├── DocumentsTab.jsx / MaterialsTab.jsx / BlueprintTab.jsx
    │   ├── CadEditorTab.jsx + CadAIPanel.jsx (AI sketch + compliance)
    │   ├── RendererTab.jsx (Studio Render 4K + Walkthrough .webm)
    │   ├── FieldTab.jsx (Daily logs + Photos + Progress + LiDAR)
    │   ├── ScheduleTab.jsx (Gantt SVG with critical path)
    │   ├── PayAppsTab.jsx ✨ (G702/G703 line items + PDF download)
    │   ├── CollabModal.jsx / SitePickerModal.jsx / PricingPanel.jsx
    └── src/pages/
        ├── Dashboard.jsx (8 tabs)
        ├── Auth.jsx / Settings.jsx (NotificationsTab with digest toggle)
        ├── SharedProject.jsx
        └── AcceptInvite.jsx ✨ (/invite/:token landing)
```

## What ships now (as of Feb 2026)
### Construction estimating core
- JWT auth + admin + Stripe billing.
- Multi-page PDF AI extraction with cross-doc material dedupe.
- SketchUp-style 2D CAD editor with ft-in dimension chains.
- Procedural 3D renderer with 15 phases (incl. MEP/Utilities).
- CSV / XLSX / PDF takeoff exports.
- Google Maps interactive site picker + AI terrain + 3D ground plane.
- Regional pricing (RSMeans-style), labor lines, O&P sliders, bid versioning.
- B2B Collaboration: roles, activity feed, white-labeled /share/{token} portal.

### AI moats
- Field Execution: daily logs + NOAA weather + AI photo progress + LiDAR.
- AI text-to-floorplan (GPT-4o → walls/doors/windows/labels).
- Live IBC/IRC code-compliance overlay in CAD.
- Schedule/Gantt with forward+backward-pass critical path.
- Studio Render (4K still PNG) + Walkthrough Video (16s .webm with dolly).

### New this session (iter14 + iter15 + iter16) ✨
- **Resend email digests**: 8am UTC daily summary of activity feed (owner/PM
  scope, excluding self-actions). Preview + Send-Test buttons in Settings.
  Per-user toggle (`email_daily_digest`). Sandbox-safe (503 when key empty).
- **AIA G702/G703 pay apps**: auto-populated from latest bid, editable line
  items, ReportLab PDF export with G702 cover + G703 continuation sheet.
- **/invite/:token landing**: public preview of project invitation, with
  signup-or-login modes for non-customers. Idempotent accept.
- **Zip-99999 fallback fix**: placeholder/repdigit zips (00000–99999) now
  correctly return regional_multiplier=1.0 instead of bleeding to AK average.

### Deployment health (Feb 2026)
- **deployment_agent: PASS** — no hardcoded secrets, env vars correct, CORS
  open, supervisor config valid. All 3 N+1 query patterns fixed this session.

## Test coverage
| Suite                          | Status                         |
| ------------------------------ | ------------------------------ |
| test_iter16_placeholder_zips   | 4/4 (created by testing agent) |
| test_iter15_payapps_invites    | 9/9 + 1 intentional skip       |
| test_iter14_digest             | 9/9 + 1 RESEND-gated skip      |
| test_iter13_ai_tools           | 11/11 + 1 LLM-gated            |
| test_iter12_field              | 17/17                          |
| test_iter11_collab             | 23/23                          |
| test_iter10_pricing_bids       | 23/23 (zip-99999 now passing)  |
| test_iter8_pdf_share_export    | 9/9 (header updated)           |
| test_admin_user_settings       | 37/37                          |
| Older iters (5-9)              | all green                      |
| Frontend e2e (iter16 report)   | 100% (4/4 critical flows)      |

## Recently shipped
- **2026-02-18 · RendererTab refactor (1458 → 309 lines)** — Extracted the 3D
  Renderer monolith into 4 hooks + 9 subcomponents under
  `frontend/src/components/renderer/`. Hooks: `useSiteTerrain`,
  `useModelPlacement`, `useTapeMeasure`, `useSceneExport`. Components:
  `TopActionBar`, `PhaseControls`, `PlacementPanel`, `AIMatchModal`,
  `TapeMeasurePanel`, `ExportPreviewModal`, `SidebarSite`,
  `SidebarAssembly`, `SidebarLayers`. Behaviorally identical — verified via
  `testing_agent_v3_fork` iter_49 (100% frontend pass, 0 console errors,
  0 regressions). All existing data-testids preserved.


## Recently shipped
- **2026-02-01 · Code-compliance backlog: smoke alarms, stairs, append-mode, zoning** —
  Extended `_check_compliance()` in `ai_tools.py` with **IRC R314.3 smoke
  alarm coverage** (expects ≥ one `SMOKE` label per bedroom) and **IRC R311.7
  stair sanity-check** (any `STAIR` label emits an info note about rise/run
  /headroom that must be confirmed in 3D detail). Compliance now also runs on
  the **merged blueprint** in AI-edit / append mode (not just the new chunk).
  Added **zoning compliance to `POST /api/projects/{id}/site/build-3d`** — warns
  if any AI-detected building exceeds R-zone defaults (3 stories / 35 ft) and
  if a structure sits within ~5 ft of the satellite-frame edge (proxy for
  side/rear setbacks). UI: new `terrain-compliance` panel in `RendererTab`
  showing green ✓ or amber warning list with code refs.

- **2026-02-01 · AI renders are code-compliant** — Beefed up
  `FLOORPLAN_PROMPT` in `routes/ai_tools.py` with explicit IBC/IRC rules
  (door widths ≥ 2'-8" / 3'-0" front, bedroom egress windows on exterior
  walls ≥ 3 ft, min room areas R304, hallway widths R311.6, corner-jamb
  clearance, mandatory living room ≥ 120 sqft). Added Python-side
  `_check_compliance()` mirroring frontend `compliance.js`, runs after
  generation, **auto-retries ONCE** with violations pasted into the
  prompt, keeps whichever has fewer critical violations. Response now
  includes `compliance: {warnings, critical_count, warn_count, retried,
  clean}`. UI surfaces a green `✓ Code-compliant` or red/amber
  per-rule bullets in the AI panel.

- **2026-02-01 · CAD editor zoom "scrolls and zooms" fix** — Wheel handler in
  `CadEditorTab.jsx` was attached via React's `onWheel` prop which is
  registered as a **passive** listener since React 17, so `e.preventDefault()`
  was silently ignored — the page scrolled AND the zoom fired at the same
  time. Fix: removed the React prop, attach the wheel listener manually with
  `svg.addEventListener("wheel", handler, { passive: false })` via a useEffect
  + onWheelRef pattern (latest closure without re-attaching). Added
  `touch-action: none` + `overscroll-behavior: contain` on the SVG as
  belt-and-suspenders for trackpads/touch. iter30: 100% pass — single events
  +deltaY/-deltaY and 5-event rapid bursts both keep window.scrollY at 0
  while viewBox grows/shrinks correctly. No passive-listener console warnings.

- **2026-02-01 · Pricing-slider race fix (Materials tab)** — Sliders no longer
  glitch / oscillate / lose values. Two-part fix in `PricingPanel.jsx`:
  (1) Optimistic `localCfg` state so the slider updates instantly on drag
  instead of waiting for the server PATCH round-trip; (2) Per-key debounce
  timers + AbortControllers (200ms) so each of the four sliders (waste,
  overhead, profit, contingency) has an independent cancel pipeline.
  `cfg → localCfg` sync useEffect guards against slow-network clobber by
  refusing to overwrite localCfg while any key has a pending timer or abort.
  iter28 verified the primary single-slider fix; iter29 verified the
  multi-slider regression fix (4 sliders dragged in 370ms all persist
  correctly).

- **2026-02-01 · Legal Terms + Privacy gate** — Post-login users (new and
  existing) must accept versioned **Terms of Service** + **Privacy & Data Use
  Policy** before any protected route. New `/app/backend/routes/legal.py` with
  `GET /api/legal/current` (public), `GET /api/legal/status` (auth),
  `POST /api/legal/accept` recording `{terms_version, privacy_version,
  accepted_at, ip}` on the user doc. `Protected` wrapper bounces unaccepted
  users to `/accept-terms`. UI: side-by-side scrollable Terms + Privacy panels,
  scroll-to-enable checkboxes, "I AGREE & CONTINUE" CTA. Public pages at
  `/terms` and `/privacy`. Bump `CURRENT_TERMS_VERSION` /
  `CURRENT_PRIVACY_VERSION` in both `/app/backend/routes/legal.py` AND
  `/app/frontend/src/legal/documents.js` to force re-acceptance.
  **Boilerplate text generated** — has `[STATE PLACEHOLDER]` and
  `[CITY, STATE]` markers in section 11 that you should fill in before
  shipping to production. iter27: 11/11 backend pytest + full frontend
  flow pass.

- **2026-02-01 · In-app support messaging** — Two-way chat between end-users
  and admin, with email notifications via Resend (when configured) and image/PDF
  attachments. New collection `support_threads` (one open thread per user) +
  `support_messages` (sender, body, attachments[]). Endpoints under `/api/support/*`:
  `GET /me/thread`, `GET /me/unread`, `GET /threads/{id}/messages`,
  `POST /threads/{id}/messages`, `POST /threads/{id}/read`,
  `POST /threads/{id}/attachments` (multipart, 5MB cap, PNG/JPEG/WebP/GIF/PDF),
  `GET /attachments/{id}` (base64 stream), `GET /admin/inbox`, `GET /admin/unread`,
  `PATCH /threads/{id}` (admin close/reopen/subject). UI: floating bottom-right
  bubble (`SupportBubble`) for users, `Support` tab in Dashboard,
  `AdminSupportInbox` page at `/admin/support` with thread list + filters
  (all/unread/open/closed). Admin header gets `SUPPORT` link with red unread
  badge. Email templates HTML-styled with Atlas branding. iter26: 19/19 backend
  tests + frontend flows pass.

- **2026-02-01 · Deployment blocker fix** — Removed malformed `whsec_=…` env var
  from `/app/backend/.env` (line 12, originally a bad variable name that broke
  the production Kubernetes secret mount and caused a backend restart loop).
  Replaced with properly-named `STRIPE_WEBHOOK_SECRET=whsec_…`. Deployment
  agent now reports **PASS**. 100% backend regression (31/31 + 6/6 smoke) via
  `iter25` after the fix.

- **2026-02-01 · Stripe diagnostic + "not configured" banner** — `_ensure_key()` in
  `routes/subscriptions.py` now distinguishes missing vs malformed `STRIPE_API_KEY`
  and tells admins exactly which env var to set / where. Billing page surfaces a
  user-friendly amber banner ("Billing temporarily unavailable") when the server
  reports `configured: false` from `GET /api/subscriptions/plans`, so non-admin
  users get context before clicking a plan. 100% backend regression (18/18) on
  iter24. **Production action**: user must add `STRIPE_API_KEY` to Emergent prod
  env vars and redeploy.

- **2026-02-01 · 3D Landscape from satellite + AI** — New `POST /api/projects/{id}/site/build-3d`
  (with `DELETE` to clear) generates a 32×32 elevation heightmap via Google
  Maps Elevation API and extrudes AI-detected features (trees as
  cone-and-trunk, buildings as boxes with AI-estimated stories, water as
  translucent planes, roads/driveways as decals, vegetation as domes,
  rocks as dodecahedrons, slopes as ring markers) onto the heightmap.
  Sample heightmap surface for object grounding. Engine: `setSiteTerrain()`
  + `clearSiteTerrain()` in `sceneBuilder.js`. UI: "✦ BUILD 3D LANDSCAPE"
  button in site panel with clear/rebuild controls and graceful error
  (telling user to enable the Elevation API in Google Cloud).
  6/6 backend contract tests pass (auth, 404, cross-user isolation,
  idempotent clear, requires-captured-site).
  **Requires the user to enable "Maps Elevation API" in Google Cloud
  Console** (separate from Maps JavaScript) — already returns a
  user-actionable error message if not enabled.

- **2026-02-01 · Tape measure tool (3D renderer)** — Click-to-measure on
  the satellite ground plane and model walls, locked to real-world feet
  (1 ft = 1 ft matching the Google Maps capture). Snaps to 1 ft grid +
  existing wall corners + previous measurement endpoints (SketchUp-style
  inference). Persistent annotations stored per-project with ft-in
  display (e.g. `24' 6"`). Grid visible only when tool active.
  New endpoints: `GET/POST /api/projects/{id}/measurements`,
  `DELETE /api/projects/{id}/measurements/{measurement_id}`. Engine
  additions: `enableMeasureTool`, `setMeasurements`, `addMeasurement`,
  `removeMeasurement`, `setSnapEnabled`, `formatFtIn`. Tested 15/15 backend
  + full frontend flow (iter22).

- **2026-02-01 · SEO discoverability** — Added comprehensive meta tags
  (title, description, keywords, canonical), Open Graph + Twitter card,
  JSON-LD `SoftwareApplication` & `Organization` structured data,
  `robots.txt`, `sitemap.xml`, PWA `manifest.json`, branded `favicon.svg`
  and 1200×630 `og-image.png`, plus a crawlable `<noscript>` marketing
  fallback. GSC verification meta tag stubbed (`REPLACE_WITH_YOUR_GSC_VERIFICATION_CODE`).

## Priority backlog (P0 → P2)
### P0 — Polish
- Resend production key configuration & domain DNS verification (when user
  is ready). Sandbox sender works for verified addresses now.
- Replace GSC verification placeholder in `frontend/public/index.html` with
  the user's real `google-site-verification` code, then redeploy.

### P1 — Money workflow expansion
- Change-order tracking + retainage % computed against bid snapshot (foundation
  laid — pay-apps already support multi-application sequencing).
- AIA G702 + G703 enhancements: change-order section, stored materials column,
  digital signatures.

### P2 — Field & ops polish
- LiDAR USDZ → wall extraction pipeline (currently store+download only).
- iOS Quick-Look AR button on Field tab.
- Photo-tagged geotag overlay on Google Maps site.
- Daily-log PDF export (per day / per week, branded).
- Schedule export to MS-Project / Primavera XML.
- True path-traced render via three-gpu-pathtracer (current is hi-res raster).

## Recent changes — 2026-07-02 (iter 39 — SIMPLIFY button)
### One-click CAD cleanup (Complete)
- New "SIMPLIFY" button in the CAD editor toolbar (`cad-simplify`).
- `lib/simplifyWalls.js` merges near-parallel walls, snaps endpoints to a
  6-inch grid, drops sub-1 ft slivers, and remaps doors/windows to the
  nearest surviving wall so nothing dangles.
- After a click the user sees a toast with the delta:
  `Walls: 34 → 12 · 22 merged · 4 slivers dropped · 8 endpoints snapped`.
- Perfect for cleaning up Hough-noise from phone photos and hand-drawn
  sketches after the AI+OpenCV pipeline runs.
- Verified: 6 test walls (3 collinear, 1 sliver, 2 duplicates, 1 unique)
  → 2 clean walls with correct merge / snap / drop counts.

## Recent changes — 2026-07-02 (iter 38 — dense OpenCV wall tracing)
### AI now actually draws what it sees (P0 — Complete)
- Root cause: GPT-4o Vision alone is poor at dense line tracing — a residential
  floor plan often came back with 0-4 walls even when 40+ segments were visible.
- Solution: new `/app/backend/routes/opencv_tracer.py` runs a classical CV
  pipeline (Gaussian blur → Canny edges → probabilistic Hough transform →
  collinear-segment merging) that extracts EVERY visible wall / dimension
  line. Auto-scales to the AI-provided `building_ft`, or falls back to a
  60 ft long-side estimate when no scale callout is legible.
- Integrated into BOTH the initial upload pipeline (`documents.py`) and
  the manual re-trace endpoint (`ai_tools.py trace-blueprint`). OpenCV
  runs in a worker thread (`asyncio.to_thread`) so it never blocks the
  async event loop.
- Each OpenCV-derived wall is tagged with `source: "opencv"` so the CAD
  editor can style / filter them independently in the future.
- Verified on a synthetic 60×40 ft floor plan: extracted 35 clean segments
  with correct real-world coordinates.
- Requirements: `opencv-python-headless==4.10.0.84`, `numpy==2.4.6`
  (pip-frozen in `/app/backend/requirements.txt`).

## Recent changes — 2026-07-02 (iter 37 — async upload + timeout hardening)
### Ingress timeout / Network Error fix (P0 — Complete)
- Root cause of "18 of 34 · 18 failed" batch upload: PDF rasterize +
  image downscale ran SYNCHRONOUSLY inside the upload request handler,
  blocking the async event loop and often exceeding the Kubernetes
  ingress request timeout → client saw generic Network Error even though
  the backend eventually completed.
- Fix: upload endpoint now inserts a `status: queued` doc and returns 200
  in ~100 ms. All CPU-heavy work (`_rasterize_pdf_pages`,
  `_shrink_image_bytes_to_b64`) runs in a background `_prepare_and_run`
  task via `asyncio.to_thread` — never blocks the event loop.
- Frontend now retries once on transient network error (1.5 s backoff),
  uses a 5-minute axios timeout for the transfer itself, and correctly
  counts only successful uploads in "N of M uploaded" (was double-counting
  failures).
- Max file size raised 16 MB → 32 MB. Unsupported-file error message now
  mentions HEIC.

## Recent changes — 2026-07-02 (iter 36 — bug fixes: BSON size + photo classification)
### DocumentTooLarge fix (P0 — Complete)
- Root cause of batch upload failures: raw rasterized PDFs / high-res
  blueprints were stored as PNG base64 exceeding MongoDB's 16 MB BSON
  document limit → uploads silently threw `DocumentTooLarge` and got
  marked as network errors on the client.
- Fix: `_shrink_and_encode` downscales every page to a max dimension of
  1600 px and re-encodes as JPEG q85 (auto-drops quality if still over the
  6 MB safety cap). Applied to BOTH pipeline paths (PDF rasterization AND
  direct image uploads). A 4000×3000 photo now serializes to ~15 KB.
- `get_document_image` returns `mime_type: image/jpeg` since blueprints are
  always JPEG after storage.
- Frontend polling in DocumentsTab now catches errors per-request so a
  transient network blip doesn't crash the UI with a red overlay.

### Photo-as-blueprint classification (P0 — Complete)
- Analysis prompt now includes explicit `doc_type` classification rules:
  a phone photo of a printed floor plan is `floor_plan` (not `photo`).
  Applies to hand-drawn sketches, whiteboard shots, CAD screenshots too.
- Trace tab (CAD editor) no longer filters by `doc_type` — it lists every
  DONE / ERROR document so users can re-trace anything the pre-classifier
  got wrong.

## Recent changes — 2026-07-02 (iter 35 — Upload folder + live batch progress)
### Upload folder mode (P0 — Complete)
- New "Upload entire folder" button below the standard drop zone. Uses
  `webkitdirectory` on a hidden input to open a native folder picker. All
  common blueprint formats (PNG / JPG / WEBP / PDF) inside the folder are
  queued; other files (README, DS_Store, DWG) are silently skipped.
- Live batch progress panel (`upload-batch-progress`) shows:
  - "N of M uploaded · X traced · Y sheets created"
  - Yellow-pulsing progress bar that turns green when settled
  - Per-file row with running status (queued → uploading → analyzing → done)
  - Clear button appears once every item has settled.
- New testids: `upload-folder-btn`, `upload-folder-input`,
  `upload-batch-progress`, `upload-batch-headline`, `upload-batch-item-<i>`,
  `upload-batch-clear`.

## Recent changes — 2026-07-02 (iter 34 — concurrency hardening)
### Batch upload / multi-doc pipeline stability (P0 — Complete)
- Per-project `asyncio.Lock` inside `_build_pipeline` — all pipelines targeting
  the same project now serialize, eliminating races on:
    • sheet order_index / floor_level computation
    • parent blueprint doc's active_sheet_id mirror
    • the "existing materials" read for cross-doc dedup
- Global `asyncio.Semaphore(3)` caps concurrent GPT-4o vision calls to prevent
  OpenAI 429 rate-limit failures that would silently error out docs.
- `_ai_with_retry` wraps every AI call with a 90 s timeout and up to 3 retries
  on transient errors (429/timeout/502/503) with 1-2-4 s backoff.
- DocumentsTab auto-polls every 3.5 s while any doc is still analyzing so users
  see live status without a manual refresh.
- `tests/test_iter34_batch_upload.py` — 5-concurrent-upload smoke test that
  asserts (a) no lost docs and (b) unique sheet.order_index values.

## Recent changes — 2026-07-02 (iter 33)
### Multi-sheet architecture (P0 — Complete)
- Each uploaded blueprint now gets its OWN sheet (walls/doors/windows/labels/
  fixtures) with a source_document_id. Users can also create hand-drawn blank
  sheets from the "+" button.
- `blueprint_sheets` collection stores per-sheet geometry. Legacy blueprints
  doc auto-migrates to Sheet 1 on first read (via `_migrate_legacy_blueprint`).
- 5 new endpoints: GET list, POST create, PATCH rename/reorder, PUT geometry,
  DELETE (rejects deleting the only sheet), POST activate.
- Documents pipeline: on upload, spawns a NEW sheet with the traced geometry
  and auto-activates it. Materials get stamped with sheet_id for per-sheet
  filtering (`GET /materials?sheet_id=…`).
- CAD editor + Blueprint tab render a `SheetTabBar` at the top with the
  active sheet highlighted, rename ✎ / delete ✕ / floor ⇅ actions per tab.
- 3D renderer (sceneBuilder.js) now stacks all sheets by `floor_level × ~10 ft`
  so ground floor + 2nd floor render together as a multi-story building.
  Ground-only layers (excavation, underground, septic) render only on level 0.

### Exact-copy blueprint underlay (P0 — Complete)
- New tracing prompt uses TOP-LEFT origin (matching SVG/image conventions) so
  AI-traced vectors align pixel-for-pixel with the source drawing.
- Wall extraction cap raised from 60 → 200 (labels 60 → 150, fixtures 80 → 200)
  for denser fidelity. Snap resolution 0.5 ft → 0.25 ft.
- CAD editor + Blueprint tab render the source blueprint image as a
  semi-transparent underlay sized to `building_ft` (or walls AABB fallback).
- Toolbar controls: `cad-toggle-underlay`, `cad-underlay-opacity` (slider),
  `blueprint-underlay-opacity` (Blueprint tab slider).
- On-demand image fetch via `GET /api/documents/{doc_id}/image` + client-side
  base64 cache in the store.

### CAD Undo/Redo + Sheet-tab overflow (2026-02-03 — Complete)
- CadEditorTab now captures per-sheet history snapshots of
  `{walls, doors, windows, labels, fixtures}` (limit 100 entries). History
  resets when the active sheet changes.
- Toolbar has `cad-undo` and `cad-redo` buttons plus Ctrl+Z / Ctrl+Shift+Z /
  Ctrl+Y keyboard shortcuts. `canUndo`/`canRedo` are useState-backed to stay
  correct across sheet switches.
- SheetTabBar rewritten to gracefully handle many sheets: horizontal scroller
  with left/right arrow buttons (`cad-sheet-scroll-left/right`), auto-scroll
  the active tab into view, compact-mode min-widths when >8 sheets, and a
  `cad-sheet-count` badge when >3 sheets. The `+` add-sheet button lives
  outside the scroller so it's always reachable.
- Verified via testing agent iter37 (initial) + iter38 (retest after redo-
  reset fix) — 100% state assertions pass.

### OpenCV traces all drawing view-types (2026-02-03 — Verified)
- `documents.py` DRAWING_TYPES expanded to include framing/roof/sheathing/
  MEP/elevation/detail so the OpenCV Hough-line tracer runs on every drawing
  regardless of `view_type`. Reference-only sheets (non floor plans) still
  land with `floor_level=-99` and are filtered by `sceneBuilder.js` REF_ONLY
  set, so they render vector geometry in the CAD tab but do NOT extrude as
  building stories in 3D. Verified via 5/5 backend tests in iter34.

### Admin bulk-delete users + Blueprint wheel-zoom + Manual refresh (2026-02-03 — Complete)
- **Admin panel**: `POST /api/admin/users/bulk-delete` accepts
  `{user_ids: [...], include_admins: bool}`; refactored the cascade-delete
  path into `_cascade_delete_user()` shared by both endpoints. Admin UI
  gained a checkbox column, header select-all (with indeterminate), a red
  bulk-action bar (`admin-users-bulk-bar`) that appears on selection with
  count / include-admins toggle / delete / clear controls. Self-protection
  and admin-skip logic verified 6/6 backend tests.
- **Blueprint tab**: independent zoom+pan state driven by the SVG viewBox.
  Mouse-wheel zooms toward the cursor (20× in, 3× beyond fit out); click-
  drag pans; double-click and the FIT button reset to the auto-fit view;
  `+` / `−` overlay buttons do centred stepped zoom; zoom-% badge live.
  State auto-resets when the active sheet changes.
- **User manual (ManualTab)**: refreshed Documents (batch/folder upload,
  photo-as-blueprint), Blueprint (multi-sheet tabs, pan/zoom/fit, underlay
  opacity), CAD Editor (undo/redo, Simplify+Straighten, sheet tabs, full
  tool table with shortcuts), Shortcuts (new Blueprint-tab keys), and a
  new **Admin panel** section covering user management + the bulk-delete
  flow.
- Small defensive fix: `walls.map` in BlueprintTab now skips walls missing
  `start`/`end` (would otherwise crash on legacy schema writes).
- Verified via testing agent iter39 — 6/6 backend + 3/3 frontend features
  pass 100%.

### CAD label editing / resizing (2026-02-03 — Complete)
- Labels now carry an optional `font_size` field (default 1.5 ft, clamped 0.6–6).
  The rendered white bounding box auto-fits text length × font_size.
- New floating toolbar (`cad-label-toolbar-<id>`) appears above a selected
  label with Select tool active: **Edit** (opens inline editor pre-filled),
  **A−** / **A+** buttons to shrink/grow the font by 0.25 ft with the
  current size shown, and **✕** to delete.
- Double-clicking any label opens the inline editor pre-filled. Submitting
  empty text deletes the label. Undo/redo captures all label mutations.
- `font_size` persists through the existing blueprint save endpoint (labels
  are `List[dict]` so the extra field passes through unchanged). Manual
  updated with an "Editing labels" subsection. Testing agent iter40: 100%
  pass, verified `font_size=2.1` persists across a full page reload.

### CAD label drag-to-move + undo hardening (2026-02-04 — Complete)
- Labels can now be dragged with the mouse when the Select tool is active
  (mousedown on label → drag → release). Short click without movement still
  selects and opens the floating toolbar.
- Undo/redo hardening: introduced `dragInProgressRef` that suppresses the
  per-mousemove history snapshots during a continuous drag, and pushes
  exactly one snapshot on drag end. This means one Ctrl+Z fully reverts a
  drag (iter41 residual: 230 px → iter42 residual: 0 px).
- Added `savingRef` so the blueprint-prop sync effect no longer clobbers
  the undo stack when the parent refreshes the blueprint after a Save &
  Sync. Users can now Ctrl+Z past a save. Iter42 flagged this as a
  MEDIUM-priority follow-up, fixed in the same session.

### Landing page + apps hub — Gonzo Labs (2026-02-04 — Complete)
- New public marketing page at `/` (previously the sign-in page). The
  sign-in flow moved to `/signin` (+ `?mode=register` support).
- Design language: Instrument Serif editorial headlines paired with IBM
  Plex Mono utility labels, deep-black base (#0A0A0A) with primary yellow
  (#FFCC00) and cyan (#00E5FF) accents. Framer-motion driven stagger
  reveals + scroll-triggered card entries.
- Sections: fixed glass nav, cinematic hero (with animated canvas backdrop
  in `HeroCanvas.jsx`), 4-tile stats band, bento "Atlas features" grid
  showing 7 major capabilities with hand-authored SVG mocks (CAD, 3D
  render, blueprint AI, map placement, pay-app, field, collab), apps hub
  grid (Atlas live + 3 wireframe "coming soon" slots designed to look
  intentional at 1 or 12 apps), pricing tease, and a massive brand-mark
  footer.
- Signed-in users see a "Welcome back → Enter Atlas" pill at the top of
  the hero.
- Testing agent iter41 verified all landing structure + routing (11/12
  sub-tests pass) and iter42 verified the label drag-undo fix (5/6 pass +
  the save-undo fix applied post-report).

### /apps/:id case-study microsites (2026-02-04 — Complete)
- New route `/apps/:id` renders a per-app case-study page. Landing hub
  cards now navigate to `/apps/atlas` (not `/signin`) so each app has its
  own marketing surface. **NOTE: notify form is CLIENT-ONLY (MOCKED)** —
  no backend endpoint yet.
- App catalog lives in `/app/frontend/src/data/apps.js` — Landing + AppDetail
  both read from it. Adding a new app = one entry in that file.
- Atlas detail page: hero with brand-mark + headline + 6 bullets + dual
  CTA, stats band (1200+/94%/8hrs/$0), 7 alternating chapter rows (each
  with a hand-authored SVG visual — CAD editor, blueprint AI, 3D render,
  map placement, pay-app, field logs, activity feed), CTA strip, and a
  "Also in the studio" related grid at the bottom.
- Coming-soon variant: massive muted brandmark, tagline, notify-me form
  (email → success pill client-side), plus the same related-apps grid.
- Invalid slug (`/apps/nonexistent`) redirects to `/#apps` — no white
  screen. Verified 100% by testing agent iter43.

### Real Atlas UI screenshots on marketing surfaces (2026-02-04 — Complete)
- Seeded a "Demo · Villa Atlas" project via `/app/backend/tests/seed_demo_villa.py`
  (10 walls, 6 doors, 6 windows, 7 labels, 4 fixtures — a tidy 3BR/2BA
  40x28 floor plan). Idempotent — re-running just refreshes it.
- Captured screenshots via `/app/backend/tests/capture_screenshots.py`
  (playwright) into `/app/frontend/public/screenshots/`:
  atlas-blueprint.jpg, atlas-cad.jpg, atlas-3d.jpg, atlas-materials.jpg,
  atlas-field.jpg, atlas-payapps.jpg.
- Created `AppScreenshot` framed image component that renders the real
  UI with a dark top gradient (hides the header chrome) and a small
  monochrome caption.
- Landing FeatureVisual + AppDetail ChapterVisual now use real screenshots
  for INGEST / EDIT / RENDER / PAY / FIELD. Kept the map + collab SVG
  mocks since those surfaces don't have a stand-alone in-app view yet.
- Deleted the now-unused MockAtlasCad.jsx and MockAtlas3D.jsx mocks.

### Multi-view AI assembly (Phase 1 + 2) + upload retry (2026-02-05 — Complete backend + partial frontend)
- Backend: new GPT-4o targeted extraction for `elevation` and `roof_plan`
  view types (`ELEVATION_PROMPT` / `ROOF_PLAN_PROMPT` / `_analyze_view_structure`
  in `documents.py`). Returns structured `{wall_top_ft, roof_pitch_deg,
  roof_shape, openings, facing_hint, ...}` and stores on the sheet as
  `assembly_data`.
- Backend: auto-facing detection compares elevation width to the floor
  plan's building_ft.w/h with 15% tolerance → tags `auto_facing` as
  "front" or "left". User can override via `facing_override` on the sheet.
- Backend: `Sheet.SheetPatchIn` accepts `facing_override` + `assembly_data`;
  `BlueprintIn` accepts `wall_height_ft` + `manual_override` for manual
  building shape override.
- Renderer: `sceneBuilder.WALL_HEIGHT` is now module-level `let`, computed
  each build from median elevation `wall_top_ft` (unless manual_override).
  Roof type + pitch derived from roof_plan → elevation median → blueprint
  defaults.
- 3D tab: new **Assembly** panel (`renderer-assembly-panel`) shows which
  sheets contribute + a `Force manual values` checkbox + a **Wall height**
  slider (`renderer-wall-height`, 6–30 ft).

### Frozen-upload recovery (2026-02-05 — Complete)
- On boot, any doc left in `queued` / `uploaded` / `analyzing` / `syncing`
  from a previous pod is auto-flagged as `error` with the summary
  "Processing was interrupted. Click RETRY to re-run the AI pipeline."
  Prevents documents from hanging forever if the container is recycled.
- New endpoint `POST /api/documents/{id}/retry` re-runs the pipeline
  against the cached page thumbnail. Multi-page PDFs re-process only the
  first page (raw bytes aren't retained past upload — surfaced as a warning).
- Documents tab now shows a **↻ RETRY** button (`document-retry-<id>`) on
  any error card. One click resubmits the pipeline; the existing polling
  loop takes over.
- Verified endpoint: HTTP 200 with `{ok, retrying, doc_id}` on real docs;
  404 on unknown ids; 400 on active pipelines.

### Autonomous validation-gated pipeline (2026-02-05 — Complete)
- New module `/app/backend/autonomous.py` implements the full loop:
  1. **Strict-schema extraction** — GPT-4o vision call with a hard JSON
     schema (walls, excavation_zones, building_ft, labels).
  2. **Validation layer** — checks zero-length walls, zero thickness,
     endpoint connectivity, polygon vertex count, positive depth,
     positive building dimensions. Returns human-readable errors.
  3. **Self-correcting loop** — up to 3 attempts. On failure, sends the
     original image + faulty JSON + validation errors back to GPT-4o
     with a targeted correction prompt. Raises HTTPException(422) with
     the final error list if all 3 attempts fail.
  4. **Earthwork engine** — shoelace polygon area × depth → cu-ft →
     cu-yards. Applies 1.25 swell (loose/haul) and 0.85 shrinkage
     (compacted/fill) multipliers per industry standard for common earth.
- Endpoints (wired via `server.py`):
  - `POST /api/projects/{id}/autonomous/extract` — runs the loop, persists
    to `db.autonomous_extractions`, returns `{attempts, layout, earthwork, validation_errors}`.
  - `GET /api/projects/{id}/autonomous/latest` — hydrates the last saved
    result on load.
- Frontend `AutonomousExtractPanel` component in the 3D tab sidebar
  (`autonomous-panel`, `autonomous-run`, `autonomous-file-input`, `autonomous-attempts`,
  `autonomous-error`, `autonomous-earthwork`, `earthwork-bank`, `earthwork-loose`,
  `earthwork-compacted`). Client-side downscales the image to 1600px @ q0.85
  to stay under Mongo's 16MB doc cap.
- On successful extraction, walls are pushed into `blueprint.walls` in the
  Zustand store, which triggers the existing sceneBuilder rebuild — the
  3D scene renders immediately with the validated coordinates.
- Unit-tested locally: validation catches 3+ error types on a bad
  layout; math is exact (20×10×4 = 29.63 bank / 37.04 loose / 25.19
  compacted cu-yards). Endpoints return 404 on unknown projects.
- **Note**: user asked for React Three Fiber. Existing app uses vanilla
  Three.js via `sceneBuilder.js`. The autonomous pipeline plugs into
  that engine — walls flow through the same store, so no rewrite
  needed. If a full R3F migration is desired later, it's a separate
  refactor.

### Autonomous auto-save toggle (2026-02-05 — Complete)
- Added **"Auto-save to active sheet"** checkbox (`autonomous-autosave-toggle`)
  in the AutonomousExtractPanel. When enabled, a successful validation
  calls `saveBlueprint(walls, ...)` immediately after the layout resolves,
  writing the AI-extracted walls straight into the active blueprint sheet
  — no manual Save & Sync needed. Toggle persists per browser via
  `localStorage['atlas-autonomous-autosave']`.
- On successful auto-save, a cyan `● Saved to active sheet · HH:MM:SS`
  indicator (`autonomous-saved-indicator`) appears below the button.
  Save failures are silent (logged to console) so the extract result
  isn't clobbered by a persistence hiccup.

### Batch-upload freeze fix + lock timeouts + retry-all (2026-02-05)
- **Root cause of the batch-upload freeze on production**: the per-project
  `_project_locks[project_id]` had NO timeout. If ONE doc's pipeline hung
  (AI call stall, cancelled task not releasing, etc.), every subsequent
  doc uploaded to the same project waited forever inside `async with
  _project_lock(project_id)`. That's why the user saw 2 docs in
  UPLOADING and 2 in QUEUED with none progressing — the queue was
  behind a phantom lock.
- **Fix in `documents.py` `run()`**: (1) `await asyncio.wait_for(lock.acquire(),
  timeout=180)` — max 3 min queue wait, then error. (2) Total pipeline
  runtime capped at `asyncio.wait_for(_run_locked(...), timeout=15*60)` —
  no single doc can block indefinitely. (3) `try/finally` guarantees
  lock.release() even on cancellation or top-level exception.
- New endpoint `POST /api/projects/{id}/documents/retry-all-errored` —
  bulk-retries every errored doc in a project that still has a cached
  thumbnail. Returns `{retried, skipped_no_thumb, total_errored}`.
- New "↻ Retry all errored documents" button (`upload-retry-all-errored`)
  appears in Documents tab whenever at least one doc is in error state.
  Reports skipped-no-thumb docs so the user knows which to re-upload.
- Verified end-to-end via curl (200 + payload; 404 on unknown project).

### CAD grid spacing + zoom −/+ buttons (2026-02-04 — Complete)
- New **STEP** dropdown (`cad-grid-step`) in the CAD toolbar offers grid
  spacing options 6", 1', 2', 5', 10'. Selection persists per browser via
  `localStorage['atlas-cad-grid-step']`. Grid density updates instantly;
  every draw / snap uses the current step. At extreme zoom the visual grid
  auto-coarsens ×5 so we never render thousands of hair lines.
- New **⊞ FIT GRID** button (`cad-snap-to-grid`) one-click snaps every
  wall endpoint, door, window, label and fixture to the current step —
  useful for aligning AI-traced blueprints. Undo/redo captures it as a
  single snapshot.
- New **−** and **+** buttons (`cad-zoom-out` / `cad-zoom-in`) sit next to
  the existing ⌂ FIT button. Zoom is clamped to viewBox width [2, 400] and
  preserves center. Scroll-wheel + drag pan + double-click reset all still
  work.
- Verified 11/11 by testing agent iter44.

### 2026-02 · Project selection now persists across refresh (P0 bug fix)
- Root cause: `store.js` `currentProjectId` was initialized to `null` on every
  page load; `loadProjects()` then set it to `data[0].id`, so users kept
  snapping back to the first project in the DB list (reported as "always
  reverts to project 121").
- Fix: `currentProjectId` is now hydrated from `localStorage['cm_current_project_id']`,
  `selectProject()` writes it, `logout()` clears it, and `loadProjects()`
  keeps the persisted id if it still exists — otherwise falls back to
  `data[0].id` and rewrites localStorage so the fallback is remembered.
- Verified by testing agent iter45 (persist across refresh, stale-id fallback,
  logout clears key — all PASS).

### 2026-02 · Autonomous auto-save now creates a dedicated AI sheet
- Safety guard: `AutonomousExtractPanel` no longer overwrites the currently
  active blueprint sheet when `Auto-save` is ON. Instead it creates a new
  sheet named `AI · <filename>` via `createSheet`, writes walls with
  `saveSheetGeometry`, then activates it. If sheet creation fails the
  auto-save is skipped entirely (no clobber). Saved-indicator now shows
  the new sheet name.
- Verified by testing agent iter45 (error branch renders without crashing;
  happy-path verified by code inspection).



### 2026-02 · Retry-all endpoint hardened against 500s (P0)
- Reported by user: on production, clicking "Retry all errored documents"
  returned 500. Root cause: the endpoint fetched every errored doc's
  `image_base64` thumb into memory in one `to_list(500)` — a project with
  dozens of ~1-3 MB thumbs blew past the ingress response budget.
- Fix (`/app/backend/routes/documents.py::retry_all_errored_docs`):
  1. First pass fetches only doc IDs — small payload.
  2. Loops each ID and fetches the thumb one-at-a-time (never >1 in memory).
  3. Per-doc try/except so a single corrupted doc doesn't kill the batch;
     returns a `skipped_error` count in the response.
  4. Hard cap of 25 retries per call (`batch_capped=true` in response) so
     users get a fast response and can click again for the next wave.
- Frontend (`DocumentsTab.jsx`) surfaces `skipped_error` + `batch_capped`
  in the confirmation dialog so the user knows to click again.
- Note: fix will take effect in production after redeploy.



### 2026-02 · 3D camera no longer snaps mid-orbit (P0)
- Reported by user: "in the 3D render when using orbit the rendered image
  resets itself mid-orbit" (production).
- Root cause: `sceneBuilder.js::build()` called `camera.position.set(...)`
  + `controls.target.set(...)` on EVERY rebuild. Because
  `RendererTab.jsx` triggers `build()` whenever `blueprint.*` changes
  (via polling / doc-refresh / any auto-refresh), the camera was being
  yanked back to the auto-fit view mid-drag.
- Fix (`sceneBuilder.js`):
  1. Added a `hasFitCamera` flag — auto-fit runs ONCE on the first
     successful build. Subsequent rebuilds (polling refresh, AI extract,
     layer toggle) never touch the camera.
  2. Extracted the fit math into `fitCameraToAabb()` + a public
     `fitCamera()` method exposed on the engine's return object.
  3. Cached the most-recent `globalAabb` as `lastAabb` so `fitCamera()`
     can be called from the UI without a rebuild.
- UI: Added a new `⌂ FIT` button (data-testid `renderer-fit-camera`)
  next to Tape Measure so users can explicitly re-center whenever they
  want. Disabled while the scene is empty.
- Note: fix takes effect on production after redeploy.


### 2026-02 · 3D render no longer flickers on polling refresh (P0 follow-up)
- Reported after previous fix: "now the model resets itself in preview" —
  even after gating the camera-fit, the geometry itself was flashing and
  the model appeared to jump during orbit/pan.
- Root cause: `refreshBlueprint()` (called every 1.5s during doc polling
  in `Dashboard.jsx`) returns FRESH object references every tick, even
  when the walls/doors/windows arrays are byte-identical. The renderer's
  build `useEffect` depends on those references → `engine.build()` was
  disposing and re-creating every THREE.Group on every poll tick,
  causing the visible flicker and destabilising the OrbitControls
  interaction.
- Fix (`RendererTab.jsx`):
  1. Wrap the build payload in `useMemo`.
  2. Compute a `JSON.stringify()` hash of the payload.
  3. Store the last-built hash in a `useRef`.
  4. The build effect now skips execution when the hash is unchanged —
     polling refreshes with identical content are a true no-op.
- Result: geometry stops being rebuilt during polling → no more flicker,
  and the OrbitControls' internal state is preserved end-to-end.

### 2026-02 · Code review remediation batch (1 HIGH + 2 MED + 4 LOW)
Verified via testing agent iter46 — 6/6 backend tests pass. Frontend
changes verified via lint + inspection.

**HIGH — Stripe entitlement double-grant race (`billing.py`)**
- Before: status-poll and webhook both did `if not entitlements_applied:
  _apply_entitlements(); update({entitlements_applied:true})`. The two
  yielded control between check and update → race → add-on credits
  granted twice.
- After: BOTH paths compare-and-set the flag FIRST
  `{session_id, entitlements_applied:{$ne:true}} → {$set:{applied:true}}`
  and only invoke `_apply_entitlements` when `modified_count == 1`.
  Added a `WARNING` docstring on `_apply_entitlements` documenting the
  contract so future callers can't reintroduce the race.

**MED — Retry double-counts materials + spawns duplicate sheets
(`routes/documents.py`)**
- Added `_purge_prior_run_artifacts(doc_id)` helper that (1) deletes
  materials with `document_id == doc_id`, (2) $pulls doc_id from any
  merged materials' `source_documents` arrays, (3) deletes any
  `blueprint_sheets` with `source_document_id == doc_id`.
- Wired into both `retry_document` (single) and `retry_all_errored_docs`
  (bulk) before re-queueing the pipeline. Retries are now correct.

**MED — Autonomous AI endpoint had no cost gating (`autonomous.py`)**
- Added `import billing as billing_mod` + `ensure_user_subscription` +
  `can_upload` guard at the top of `autonomous_extract`. Returns HTTP 402
  when the user is out of upload credits. Consumes exactly ONE upload
  credit per SUCCESSFUL extraction (not per attempt in the self-
  correcting loop). Admin/unlimited tier unaffected.

**LOW — Frontend / infra hardening**
- `store.js` — `REACT_APP_BACKEND_URL` now fails fast with a console
  error if missing; `loadProjectData` uses `Promise.allSettled` so one
  flaky endpoint doesn't leave the dashboard stuck loading.
- `AutonomousExtractPanel.jsx` — restricted `accept` to `image/*` (was
  `image/*,application/pdf` but `downscaleToBase64` uses `<img>` which
  chokes on PDFs).
- `RendererTab.jsx` — `setMeasurements` sync effect now depends on
  `[measurements]` instead of `[]` (was dead code).
- `server.py` — CORS `allow_credentials=false` (was invalid `true` + `*`
  combo; harmless because we're on Bearer auth, but spec-correct now).



### 2026-02 · Multi-page PDF now creates one sheet per page (P0 user bug)
- **Reported**: "when I upload a multi-page pdf. after analyzing it only
  shows one of the pages."
- **Root cause**: `documents.py::_run_locked` iterated the pages and
  appended each page's walls/doors/windows/labels/fixtures into a single
  set of accumulators (`walls_all`, `doors_all`, …), then created ONE
  sheet at the end using the merged arrays with `first_doc_type`. The
  UI only ever saw the first page's `view_type` and a jumble of every
  page's walls stacked on top of each other.
- **Fix**: added a `per_page_geometry: list[dict]` accumulator that
  snapshots each page's contribution (using `walls_start` etc offsets
  captured BEFORE that page's extraction), then after the loop creates
  **one sheet per page** for multi-page uploads (`use_per_page = True`
  when `len(per_page_geometry) > 1`). Single-page uploads keep the
  original single-sheet code path (verified by regression test). Each
  per-page sheet gets `source_page` (1-based), a `p{N}/{M}` name suffix,
  and its own per-page assembly extraction if it's an elevation or
  roof_plan.
- **Verified by testing_agent iter47** — 3-page PDF ⇒ 3 sheets (source_page
  1/2/3, correct names, first sheet active), single-page regression
  passes, retry-after-multi-page produces no stale duplicates thanks
  to `_purge_prior_run_artifacts`.
- **Follow-on backlog surfaced by the testing agent**:
  1. Materials from multi-page docs currently all tag to the first
     sheet_id — the `db.materials.update_many` at the end still uses
     one `sheet_id`. Per-page material tagging would need `source_page`
     on inserts too.
  2. Retry only re-analyzes the cached first-page thumbnail. Retrying
     a multi-page doc after a transient failure will drop pages 2..N.
     Preserving raw upload bytes for retry (or documenting the caveat)
     is a follow-on enhancement.
  3. `per_page_geometry` holds full b64 for every page — memory-heavy
     for 20+ page PDFs. Lazy-keep only pages that need per-page assembly.


**Item #3 — Type hints on server.py**
- `root_info()`, `_on_startup()`, `_shutdown()` now have full type
  annotations. Lint clean.

**Item #4 — React hooks / lint audit**
- Stripped 12 stale "Unused eslint-disable directive" warnings across
  `RendererTab.jsx`, `SupportBubble.jsx`, `useCadHistory.js`,
  `Admin.jsx`, `Billing.jsx`, `Dashboard.jsx`, `store.js`, `CollabModal.jsx`,
  `PricingPanel.jsx`. The reviewer's original "missing hook deps"
  finding was based on an older commit — the current tree lints clean
  (only 3 remaining warnings are inside `components/ui/` third-party
  Shadcn code which we don't modify).
- Escaped 7 raw `'` characters in JSX text (SupportTab, Auth, Billing×2,
  Dashboard×2, Settings) → `&apos;`. Renders unchanged; no more
  `react/no-unescaped-entities` errors.
- Result: **28 → 3 lint issues** (the 3 remaining are third-party UI code).

**Item #5 — RendererTab.jsx (partial extract)**
- Created `/app/frontend/src/components/renderer/format.js` with the
  `RENDERER_API` constant + `fallbackFmtFtIn` helper. Small progress
  but the full split (30+ interlinked useCallback handlers → sub-
  components with prop threading) genuinely needs its own dedicated
  iteration with testing-agent regression on every 3D flow. Deferred
  with an honest scope estimate rather than shipping a partial rewrite.

**Item #6 — httpOnly cookie auth rewrite — STILL DEFERRED**
- Genuinely a 4–6 hour undertaking: touches every API call, all share-
  link flows, requires CORS credentials mode, requires
  `axios.defaults.withCredentials = true`, requires a new
  `GET /api/auth/me` hydration flow on frontend mount, and needs the
  testing-agent to regression every login / logout / share / mobile
  webview path. Not safely doable in a single iteration alongside
  other work.


### 2026-02 · Multi-page PDF underlay per-page fix (P0 user bug follow-up)
- **Reported**: After iter47 fixed sheet counts, "every sheet shows the
  same exact sheet" — all N sheet tabs displayed page 1's underlay.
- **Root cause**: every sheet had the same `source_document_id`, and the
  frontend fetched the doc-level thumbnail (only page 1 stored) for
  every sheet.
- **Fix**:
  - `_create_sheet` (`routes/projects.py`) now accepts `page_image_base64`
    and stores it on the sheet.
  - Multi-page loop in `_run_locked` passes each page's `b64` when
    creating its sheet.
  - `_list_sheets` excludes the field from list responses (keeps payload
    lean — image can be ~500KB per sheet).
  - `GET /api/documents/{doc_id}/image?page=N` reads per-page image from
    `blueprint_sheets` where `source_page = N`; falls back to
    `doc.image_base64` if no per-page image exists. Returns
    `fallback: true` in the response so the client can tell.
  - Frontend `fetchDocumentImage(docId, page)` (store.js) — cache key
    now includes page number.
  - `CadEditorTab.jsx` + `BlueprintTab.jsx` — underlay effect now
    depends on `activeSheet.source_page` so switching sheets re-fetches
    the correct page's image.
- **Verified by testing_agent iter48** — 3-page PDF with visually-
  distinct pages produced 3 sheets with DIFFERENT SHA256 image hashes
  per page (a265ec01, ed97a258, fb75b6e1). Regressions pass.
- Addressed reviewer's follow-on: page-1 also does the per-page lookup
  now so retries that regenerate page 1 don't silently serve the stale
  doc thumbnail.



### 2026-02 · Deferred code-review batch — additional wins
- **server.py type hints**: `root_info()`, `_on_startup()`, `_shutdown()`
  now fully annotated.
- **React hooks / lint audit**: **28 → 3 lint issues** (the 3 remaining
  are inside `components/ui/` third-party Shadcn code we don't modify).
  Stripped 12 stale `eslint-disable-next-line` directives across
  9 files; escaped 7 raw `'` characters in JSX text (Auth, Billing×2,
  Dashboard×2, Settings, SupportTab) → `&apos;`. The reviewer's
  "missing hook deps" finding was stale — current tree lints clean.
- **RendererTab.jsx (partial extract)**: created
  `/app/frontend/src/components/renderer/format.js` with
  `RENDERER_API` + `fallbackFmtFtIn`. Full split of the 1440-line
  component honestly needs a dedicated iteration + testing-agent
  regression on every 3D flow (30+ interlinked callbacks).
- **httpOnly cookie auth rewrite — STILL DEFERRED**: genuinely a
  4–6 hour architectural change (Set-Cookie on login, CORS
  credentials mode, remove all `Authorization: Bearer` headers,
  new `/api/auth/me` hydration on mount, regression on every login
  / share / mobile webview flow). Scheduled as its own iteration.


### 2026-02 · admin.py::build_admin_router split (P2 of deferred code-review batch)
- The 288-line `build_admin_router` (cyclomatic complexity 63, flagged
  by the code review) is now a 10-line orchestrator that delegates to
  six per-resource registration helpers. Each helper handles a single
  logical group of routes:
  - `_register_overview_route`      — `/api/admin/overview`
  - `_register_user_routes`         — list, get, update, delete, bulk-delete
  - `_register_project_routes`      — `/api/admin/projects`
  - `_register_billing_routes`      — billing summary + transactions
  - `_register_settings_routes`     — system settings + AI settings
  - `_register_audit_route`         — `/api/admin/audit-log`
- Adding a new admin route now means editing one focused helper (or
  adding a new one + wiring it into `build_admin_router`) — no more
  scrolling through a 288-line closure.
- Verified via curl: all 8 admin endpoints return 200, `PATCH /users/{id}`
  happy + edge-case paths return correct shapes (200 on real update,
  400 "Nothing to update" on empty patch), `POST /users/bulk-delete`
  with empty list returns `{ok:true, deleted:0}`.

### 2026-02 · CadEditorTab.jsx refactor (P1 of deferred code-review batch)
- **File shrunk 1795 → 1590 lines** (–205). Extracted 4 focused files
  under `/app/frontend/src/components/cad/`:
  - `constants.js` (90 lines) — style catalogs + tool config
  - `geometry.js` (32 lines) — pure `cryptoId`, `dist`, `nearestOnSegment`
  - `ToolIcon.jsx` (30 lines) — inline-SVG tool glyphs
  - `useCadHistory.js` (141 lines) — undo/redo hook, documented contract
- Smoke-tested — 13 tools render, undo/redo present, zero console errors.


- **File shrunk 1795 → 1590 lines** (11% reduction, more once RendererTab
  and admin.py follow the same pattern).
- Extracted 4 focused files under `/app/frontend/src/components/cad/`:
  - `constants.js` (90 lines) — style catalogs (`DOOR_STYLES`,
    `WINDOW_STYLES`, `WALL_STYLES`, `FIXTURE_META`), tool config
    (`TOOL_INPUT`, `TOOLS`), and layout constants (`VIEWBOX_*`,
    `GRID_STEP_*`, `SNAP_THRESHOLD`, `CIRCLE_SEGMENTS`). Zero React
    dependency — pure data.
  - `geometry.js` (32 lines) — pure helpers `cryptoId`, `dist`,
    `nearestOnSegment`. Unit-testable in isolation.
  - `ToolIcon.jsx` (30 lines) — the inline-SVG tool glyph switch,
    reusable anywhere.
  - `useCadHistory.js` (141 lines) — undo/redo hook. Owns snapshot
    stacking, drag suppression, blueprint-seed logic, and exposes
    `undo`, `redo`, `canUndo`, `canRedo`, `noteDragStart`, `noteDragEnd`.
    Contract documented in the header comment.
- Smoke-tested — CAD Editor loads clean, 13 tool buttons render,
  undo/redo present, zero console errors.


- Flipped `apps.js` for both apps from `status: "preview"` → `"live"`.
- Vision CAD CTA now points to `https://vision-cad-platform.emergent.host`,
  Site Vision to `https://site-vision-platform.emergent.host`. Both open in
  a new tab (target=_blank, rel=noopener noreferrer).
- Added a shared `<CtaButton>` helper in `AppDetail.jsx` that auto-detects
  external URLs (http/https) and renders `<a target="_blank">`, hash
  anchors as `<a href="#…">`, and internal paths as `<Link>`. Applied to
  both hero + footer CTAs.
- `PreviewPanel` chapter placeholders now show a status-aware caption —
  "Studio · Chapter" for live apps (was hardcoded "Concept · Not yet
  shipped").
- Landing card badge + hover glow now derive from each app's `accent`
  hex (Atlas yellow, Vision CAD cyan, Site Vision orange) instead of the
  previous hardcoded LIVE-vs-PREVIEW binary.
- Waitlist section only renders for `status === "preview"` apps — Vision
  CAD and Site Vision no longer show it.


- New Admin sidebar section: **Waitlist** (`data-testid="admin-nav-waitlist"`)
- Reads `GET /api/admin/waitlist` and renders:
  - Summary stat cards (total + per-app counts)
  - Search-by-email + per-app dropdown filter
  - Full signups table (email, app, joined timestamp, optional note)
  - One-click CSV export of the current filtered view (client-side blob)
- Renumbered downstream sections (System=06, AI=07, Audit=08).

### 2026-02 · Multi-app Studio Hub — 2 preview microsites + waitlist
The Gonzo Labs landing already had an Apps grid with Atlas (live) plus
three "coming soon" placeholders. Wired the two named apps
(Vision CAD, Site Vision) into full case-study microsites and hooked
their CTAs into a real waitlist backend.

**New app microsites**
- `/apps/vision-cad` — Vision CAD (SketchUp-style browser CAD). Cyan
  accent. 5 chapter case-study, editorial preview panels, waitlist CTA.
- `/apps/site-vision` — Site Vision (photoreal 3D rendering). Orange
  accent. 5 chapter case-study, same layout, tailored copy.
- `/apps/app-04` — TBD placeholder (unchanged, keeps `SoonDetail`).
- Landing card grid renders `preview` apps at the same big card size as
  `live` (col-span-6) — Atlas and Vision CAD share row 1, Site Vision +
  TBD share row 2.

**Waitlist backend (`routes/waitlist.py`)**
- `POST /api/waitlist/join` (public, no auth) — validates email, dedupes
  on `(email, app_id)` via upsert.
- `GET /api/admin/waitlist` (admin only) — returns all signups with
  per-app counts. Ready for a future admin panel widget.
- Wired into `server.py` alongside the other feature routers.

**Data model (`data/apps.js`)**
- New `status: "preview"` (between `live` and `soon`). Preview apps must
  provide the same `detail` block as Atlas (role, headline, lede,
  hero_bullets, cta_primary/secondary, chapters, stats). An `accent`
  hex controls per-app color theming across cards, headers, chapter
  numerals, corner brackets, CTA buttons, and the waitlist form focus.

**Shared UI (`pages/AppDetail.jsx`)**
- Renamed `LiveDetail` → `FeatureDetail`; now handles both live + preview
  based on `app.status`. Preview apps swap the primary CTA for an
  `#waitlist` anchor and render a `<WaitlistSection>` at the bottom
  instead of the "Ready when you are" strip.
- Non-Atlas chapter visuals fall back to a stylised `<PreviewPanel>`
  (oversized chapter numeral + dot-grid + accent flare) so each panel
  still looks intentional without needing real product screenshots.
- `RelatedApps` now shows a `· PREVIEW ·` badge in cyan for preview
  status.








## Integrations
- **Emergent LLM Key** — GPT-4o vision (PDF + photo) + text (floorplan).
- **Stripe** — test key from system env.
- **Google Maps JS API** — user-provided key (raster basemap via DEMO_MAP_ID
  to avoid WebGL clash with Three.js).
- **NOAA public API** — no key; daily-log weather.
- **Resend** — sandbox sender `onboarding@resend.dev`; user supplies `re_...`
  key in `backend/.env` when ready for real sends.

## Credentials
Admin: `admin@atlas.app` / `Open0says3me#*03#*` (see `/app/memory/test_credentials.md`).
