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

## Implemented Features (v1.1 — Jan 2026)
| Feature | Status |
| --- | --- |
| Email + password auth (register/login/me) | ✅ Done |
| Default project auto-created on signup | ✅ Done |
| Multi-project switching | ✅ Done |
| Image upload (PNG/JPG/WEBP, 8MB cap) | ✅ Done |
| Async AI pipeline: uploaded → analyzing → saving → syncing → done | ✅ Done |
| Progress bar + status badge per document card | ✅ Done |
| Materials auto-insertion grouped by category | ✅ Done |
| Materials stats (Total / Categories / AI Extracted / Project Cost) | ✅ Done |
| **Per-material unit_price (AI-estimated USD) + editable** | ✅ Done (v1.1) |
| **Live line totals + category subtotals + grand total bar** | ✅ Done (v1.1) |
| **One-click branded PDF takeoff report (reportlab)** | ✅ Done (v1.1) |
| Live 2D Blueprint view (SVG) | ✅ Done |
| Interactive 2D CAD Editor (wall/door/window tools, select, delete, save) | ✅ Done |
| 3D Renderer (vanilla three.js) with shaded / wireframe toggle, orbit controls, grid | ✅ Done |
| Cross-tab live sync (Zustand + polling) | ✅ Done |
| 39/39 backend pytest suite green | ✅ Done |

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
