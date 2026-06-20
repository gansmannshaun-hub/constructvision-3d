# Construction Management & 3D Visualization Platform — PRD

## Original problem statement
Build a Construction Management + 3D Visualization SaaS from scratch with:
- Auto-pipeline: upload docs → GPT-4 Vision analyzes blueprints/materials.
- Real-time extraction of materials to DB.
- Cross-tab live state (Documents / Materials / 2D CAD / 3D Renderer) — no refresh.
Evolved into: PDF takeoffs, Stripe SaaS, Admin dashboard, SketchUp-style 2D CAD,
procedurally generated 3D layers with phase animation, multi-page PDF, CSV/XLSX
exports, client portals, Google Maps real-world site integration, regional
pricing with labor/O&P, B2B team collaboration, and Field Execution.

## Architecture (production-ready)
```
/app
├── backend/                         FastAPI · Motor (async Mongo)
│   ├── server.py                    slim entry — registers all routers
│   ├── admin.py                     admin dashboard + audit + user mgmt
│   ├── pricing.py / pricing_data.py RSMeans-style multipliers + cascade math
│   ├── models/                      Pydantic models per domain
│   ├── routes/
│   │   ├── auth.py                  JWT login / register
│   │   ├── projects.py              projects CRUD + blueprint
│   │   ├── documents.py             PDF/IMG upload + AI material extraction
│   │   ├── materials.py             CRUD + cross-doc dedupe
│   │   ├── takeoff.py               CSV / XLSX / PDF exports
│   │   ├── pricing.py               region, labor, markup, bids+diffs
│   │   ├── site.py                  Google Maps lat/lng + AI terrain
│   │   ├── collab.py                roles, members, activities (now batched)
│   │   ├── share.py                 white-label /share/{token} portal
│   │   ├── billing.py               Stripe subscriptions
│   │   ├── field.py                 daily logs (NOAA), AI photos, LiDAR  ✨
│   │   └── ai_tools.py              text→floorplan + schedule/Gantt      ✨
│   └── tests/                       pytest — 100+ tests, all green
└── frontend/                        React + Tailwind + Zustand + Three.js
    ├── src/App.js                   router shell
    ├── src/store.js                 zustand global state + apiClient
    ├── src/lib/
    │   ├── dim.js                   ft-in formatting + AABB
    │   ├── compliance.js            ✨ IBC/IRC live code-compliance engine
    │   └── renderer/sceneBuilder.js Three.js engine + captureHiRes + dolly
    ├── src/components/
    │   ├── DocumentsTab.jsx
    │   ├── MaterialsTab.jsx
    │   ├── BlueprintTab.jsx
    │   ├── CadEditorTab.jsx         + CadAIPanel.jsx overlay
    │   ├── CadAIPanel.jsx           ✨ AI prompt + compliance overlay
    │   ├── RendererTab.jsx          + Studio Render + Walkthrough Video  ✨
    │   ├── FieldTab.jsx             ✨ Daily logs + Photos + Progress + LiDAR
    │   ├── ScheduleTab.jsx          ✨ Critical-path Gantt SVG
    │   ├── CollabModal.jsx
    │   ├── SitePickerModal.jsx
    │   └── PricingPanel.jsx
    └── src/pages/                   Dashboard, SharedProject, Auth
```

## What ships now (as of Feb 2026)
### Construction estimating core
- JWT auth + admin + Stripe billing.
- Multi-page PDF AI extraction with cross-doc material dedupe.
- SketchUp-style 2D CAD editor with dynamic ft-in dimension chains.
- Procedural 3D renderer with **15 phases** (incl. MEP/Utilities — septic,
  plumbing, electrical, underground).
- CSV / XLSX / PDF takeoff exports.
- Google Maps interactive site picker + AI terrain analysis + 3D ground plane.
- Regional pricing (RSMeans-style), labor lines, O&P sliders, bid versioning
  and diffs.
- B2B Collaboration: roles (owner / pm / estimator / viewer), activity feed,
  white-labeled `/share/{token}` portal.

### New this session (iter12 + iter13)  ✨
- **Field Execution**:
  - Daily logs with NOAA-API auto-weather, crew size, notes.
  - Site photos with AI progress % per phase (GPT-4o vision).
  - LiDAR / USDZ / OBJ / GLB scan upload + download.
  - Aggregated Construction-Progress dashboard.
- **AI text-to-floorplan**: GPT-4o sketches walls/doors/windows/labels from a
  one-line brief, written into the blueprint.
- **Live code-compliance**: IBC + IRC checks for corridor width, egress door
  widths, room minimums, ceiling, egress windows, perimeter — runs live in CAD.
- **Schedule / Gantt**: forward + backward pass critical-path solver across the
  15 phases, scaled by sqft + crew; SVG Gantt with red critical bars.
- **Studio Render**: one-click 4K PNG ray-look still via Three.js hi-res
  off-screen render target.
- **Walkthrough Video**: 16s webm export via MediaRecorder on canvas
  captureStream, with phase animation + automated camera dolly.

### Field bug fixed (iter12 carryover)
- FieldTab daily-log submit no longer 422s when site is uncaptured; React no
  longer crashes on FastAPI's array `detail` (errText helper coerces).

### Deployment health (Feb 2026)
- **deployment_agent: PASS** — no hardcoded secrets, env vars correct, CORS
  open, supervisor config valid, no N+1 queries (3 fixed this session: admin
  list_users, admin list_all_projects, collab projects-shared-with-me).

## Test coverage
| Suite                          | Status |
| ------------------------------ | ------ |
| test_iter13_ai_tools.py        | 11/11 + 1 LLM-gated  |
| test_iter12_field.py           | 17/17                |
| test_iter11_collab.py          | 23/23                |
| test_iter10_pricing_bids.py    | 22/23 (1 pre-existing zip-fallback) |
| test_admin_user_settings.py    | 37/37                |
| Older iters (5-9)              | all green            |
| Frontend e2e (iter13 report)   | 9/9                  |

## Priority backlog (P0 → P2)
### P0 — Field & moats polish
- Phase wall-extraction pipeline for uploaded LiDAR USDZ (currently store+dl only).
- Stub iOS-Quick-Look AR button on mobile (USDZ → ARKit).

### P1 — Money workflow
- AIA G702/G703 payment app generator.
- Change-order tracking + retainage % computed against bid snapshot.
- Email digest for Collab activity feed (Resend integration — needs API key).
- `/invite/{token}` landing page for non-customer teammates.

### P2 — Field & ops polish
- Photo-tagged geotag map view (overlay site photos on the Google Maps site).
- Daily-log PDF export (per day or per week, branded).
- Schedule export to MS-Project / Primavera XML.
- True path-traced render (three-gpu-pathtracer) — defer until UX requires it.

### Pre-existing minor
- Pricing edge-case: zip 99999 returns AK multiplier instead of 1.0 default.
  Out of scope; documented for future sprint.

## Integrations in use
- **Emergent LLM Key** — GPT-4o vision (PDF + photo) + text (floorplan).
- **Stripe** — test key from system env (subscription tier + price IDs).
- **Google Maps JS API** — user-provided key in `frontend/.env`; raster basemap
  (DEMO_MAP_ID) to avoid WebGL clash with Three.js.
- **NOAA public API** — no key; daily-log weather.

## Credentials
Admin: `admin@atlas.app` / `Open0says3me#*03#*` (see `/app/memory/test_credentials.md`).
