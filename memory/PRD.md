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
