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
