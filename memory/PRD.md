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
