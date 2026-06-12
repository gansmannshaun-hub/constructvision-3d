# PRD — Atlas Construction Management & 3D Visualization App

## Original Problem Statement
> "Construction Management and 3D Visualization App. When a user uploads an image, after AI analyzes it the result should be used in all tabs — the renderer, the 2D CAD editor and blueprints."

The auto-pipeline (no clicks needed):
1. **Upload** — file goes to storage, card appears in Documents tab with real-time progress bar (Uploading → Analyzing → Saving → Syncing 3D)
2. **AI Analyzes** — GPT-4o Vision runs automatically on any image, reading materials, rooms, structural notes
3. **Materials extracted** — auto-inserted into Materials tab, grouped by category with "AI extracted" badge
4. **Blueprint sync** — if doc is floor_plan / blueprint / site_plan, walls/doors/windows are merged into the live blueprint, and the 3D viewer + CAD editor update immediately (no tab switching)

## User Personas
- **Construction PM / Architect**: Uploads scanned floor plans, gets instant 3D + material take-off
- **Estimator**: Uses auto-extracted material list grouped by category for quick BOM
- **Field Foreman**: Reviews live blueprint and 3D model on-site

## Tech Stack
- **Backend**: FastAPI · MongoDB (motor async) · JWT auth (PyJWT + bcrypt) · `emergentintegrations.LlmChat` → GPT-4o vision
- **Frontend**: React 19 · React Router · Zustand state · Tailwind CSS · `@react-three/fiber` + `@react-three/drei` for 3D · IBM Plex / Chivo fonts
- **Pipeline**: `asyncio.create_task` background analysis, frontend polls Documents endpoint every 1.5s while any doc is in-flight

## Implemented Features (v1.3 — Jan 2026)
| Feature | Status |
| --- | --- |
| Email + password auth (register/login/me) — login response now includes `is_admin` | ✅ Done |
| Suspended account login is blocked (403) | ✅ Done (v1.3) |
| Default project auto-created on signup | ✅ Done |
| Multi-project switching (Pro/Studio unlimited) | ✅ Done |
| AI Pipeline (Upload → GPT-4o → materials + walls) | ✅ Done |
| Materials with editable pricing + grand total | ✅ Done |
| One-click branded PDF takeoff | ✅ Done |
| Live 2D Blueprint + interactive CAD editor | ✅ Done |
| Three.js 3D renderer with auto-fit isometric camera | ✅ Done |
| 3 subscription tiers + 7-day Pro trial + 3 add-ons | ✅ Done |
| Stripe Checkout (test mode) with idempotent entitlements | ✅ Done |
| **Seeded admin account (`ADMIN_EMAIL` env, auto-generated password)** | ✅ Done (v1.3) |
| **`/admin` dashboard (sidebar nav with 7 sections)** | ✅ Done (v1.3) |
| **Admin Overview — users/projects/docs/revenue KPIs** | ✅ Done (v1.3) |
| **Admin Users — list, search, edit plan/credits/admin/suspend, delete with cascade** | ✅ Done (v1.3) |
| **Admin Projects — all projects with owner email + doc/material counts** | ✅ Done (v1.3) |
| **Admin Billing — MRR / trial-conversion / transactions list** | ✅ Done (v1.3) |
| **Admin System — JSON-editable catalog & plan-limits overrides** | ✅ Done (v1.3) |
| **Admin AI Engine — switch GPT-4o / GPT-5.2 / Gemini / Claude + custom system prompt** | ✅ Done (v1.3) |
| **Admin Audit Log — `audit()` helper writes events on every admin write** | ✅ Done (v1.3) |
| **User `/settings` page (5 tabs)** | ✅ Done (v1.3) |
| **Settings → Profile (name/email + password change)** | ✅ Done (v1.3) |
| **Settings → Preferences (currency, units, date format, theme)** | ✅ Done (v1.3) |
| **Settings → Notifications (4 email toggles, stored)** | ✅ Done (v1.3) |
| **Settings → Sessions (revoke-all stub)** | ✅ Done (v1.3) |
| **Settings → Danger Zone (JSON data export, account self-delete)** | ✅ Done (v1.3) |
| 96/96 backend pytest suite green (37 new + 59 regression) | ✅ Done |

## Backlog (P1)
| Feature | Status |
| --- | --- |
| Email + password auth (register/login/me) | ✅ Done |
| Default project auto-created on signup | ✅ Done |
| Multi-project switching (Pro/Studio unlimited) | ✅ Done |
| Image upload (PNG/JPG/WEBP, 8MB cap) | ✅ Done |
| Async AI pipeline: uploaded → analyzing → saving → syncing → done | ✅ Done |
| Progress bar + status badge per document card | ✅ Done |
| Materials auto-insertion grouped by category | ✅ Done |
| AI-estimated unit prices + editable | ✅ Done |
| Live line totals + category subtotals + grand total bar | ✅ Done |
| One-click branded PDF takeoff report (reportlab) | ✅ Done |
| Live 2D Blueprint view (SVG) | ✅ Done |
| Interactive 2D CAD Editor (wall/door/window tools, select, delete, save) | ✅ Done |
| 3D Renderer (vanilla three.js) with shaded / wireframe toggle, orbit controls, grid | ✅ Done |
| Cross-tab live sync (Zustand + polling) | ✅ Done |
| **3 subscription tiers: Free / Pro $49 / Studio $149** | ✅ Done (v1.2) |
| **7-day Pro free trial (one-shot per user)** | ✅ Done (v1.2) |
| **3 a-la-carte add-ons: $9 / $19 / $4 (uploads / pdf branding / rush)** | ✅ Done (v1.2) |
| **Plan-gated upload + project + PDF endpoints (402 on quota)** | ✅ Done (v1.2) |
| **Monthly usage counters + bonus credits** | ✅ Done (v1.2) |
| **Stripe Checkout (test mode `sk_test_emergent`) wired up** | ✅ Done (v1.2) |
| **Idempotent entitlement application (status poll + webhook)** | ✅ Done (v1.2) |
| **Premium PDF branding flag (header with user name/email)** | ✅ Done (v1.2) |
| **/billing page with plan/usage/add-ons + Stripe redirect handling** | ✅ Done (v1.2) |
| 59/59 backend pytest suite green | ✅ Done |

## Backlog (P1)
- Persist user-edited walls when a new image is uploaded (currently appended, may want replace mode toggle)
- Export 3D model to GLB / OBJ
- Material cost rollup (price per unit → project total)
- Multi-user project collaboration (invite teammates)
- Document image hover-zoom & inline annotation
- PDF blueprint support (currently images only)

## Backlog (P2)
- Construction phase tracking / Gantt
- Mobile field app (PWA)
- Versioning of blueprint revisions
- Email reports
- Stripe billing for paid tiers

## Architecture Highlights
```
React (Zustand) ─┐
                 ├─► /api (JWT) ──► FastAPI ──► MongoDB
                 │                       │
                 │                       └─► emergentintegrations → GPT-4o Vision
                 │
                 └─► three.js + react-three-fiber (3D renderer rebuilt from store)
```

The single source of truth for cross-tab sync is the `blueprint` field in the Zustand store, populated from `/api/projects/{id}/blueprint`. The AI pipeline writes to it; the 2D CAD Editor reads & writes; the 3D Renderer reads it.

## Next Action Items
1. (Optional) Replace blueprint-append logic with replace-on-new-upload toggle
2. (Optional) Add P1 features above per user priority
3. Consider rolling out to invite-only beta users
