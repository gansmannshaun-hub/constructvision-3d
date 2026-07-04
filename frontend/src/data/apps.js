/**
 * Central catalog of Gonzo Labs apps. Consumed by:
 *   - /app/frontend/src/pages/Landing.jsx        (Apps Hub grid)
 *   - /app/frontend/src/pages/AppDetail.jsx     (per-app case-study page)
 *
 * To add a new app: append a new entry with id, status ("live" | "soon"),
 * copy, and (for live apps) a `sections` array driving the case-study body.
 */

export const APPS = [
  {
    id: "atlas",
    status: "live",
    number: "01",
    name: "Atlas",
    tag: "Construction OS",
    tagline: "Blueprints, 3D models, pay apps, field ops — one workspace.",
    // Landing-hub short blurb
    hub_tagline: "Blueprints, 3D models, pay apps, field ops — one workspace.",
    // Case-study page copy
    detail: {
      role: "// FLAGSHIP · 01",
      headline: "The construction stack, condensed to one workspace.",
      lede:
        "Atlas turns a scanned floor plan into a 3D-buildable, biddable, trackable project — in the browser, in under a minute. Built for GCs, ADU builders, and the operator who doesn't want to babysit ten tools.",
      hero_bullets: [
        "GPT-4o + OpenCV blueprint tracing",
        "SketchUp-style 2D CAD editor",
        "15-phase 3D construction render",
        "AIA G702 / G703 pay-app generator",
        "Field logs · weather · AI-graded jobsite photos",
        "White-label /share portals for clients",
      ],
      cta_primary: { label: "Open Atlas", to: "/signin?mode=register" },
      cta_secondary: { label: "Sign in", to: "/signin" },
      chapters: [
        {
          n: "01",
          tag: "// INGEST",
          title: "Drop a plan. Get a building.",
          body:
            "Upload a PDF, a phone photo, or a whiteboard sketch. GPT-4o Vision reads materials, labels, and fixtures. OpenCV traces the walls, doors, and windows in parallel. You get an editable CAD sheet and a takeoff list ready to price. Photos, batch uploads, and folder drops all supported.",
        },
        {
          n: "02",
          tag: "// EDIT",
          title: "SketchUp fluency, in the browser.",
          body:
            "A real CAD editor — wall / rectangle / circle / door / window / label / eraser / move / offset / tape. Snap-to-grid, dimension chains, exact-typed lengths in feet or inches. Simplify + Straighten to clean up messy phone-photo traces. Full undo/redo, drag-to-move labels, live label resize, and multi-sheet tabs per project.",
        },
        {
          n: "03",
          tag: "// RENDER",
          title: "Fifteen construction phases. One click.",
          body:
            "Watch your building rise from site prep through finishing in a real Three.js scene. Toggle any of 15 phase layers — foundation, framing, MEP rough-ins, roof, wall sheet, trim. Export 4K studio-quality PNGs or cinematic walkthrough videos.",
        },
        {
          n: "04",
          tag: "// MAP",
          title: "Real coordinates. Real terrain.",
          body:
            "Pick a lot on Google Maps. AI reads soil type, slope, vegetation. Place the 3D model on the actual satellite tile with an AI-matched scale — nudge, rotate, save. Blueprints stay in feet; the world stays in latitude.",
        },
        {
          n: "05",
          tag: "// PAY",
          title: "AIA G702 / G703 that owners actually accept.",
          body:
            "Auto-populated from your latest bid snapshot. Edit percent-complete inline. Retainage, current due, balance to finish — all recomputed live. Download a branded landscape PDF that reads like it came out of the accountant's office.",
        },
        {
          n: "06",
          tag: "// FIELD",
          title: "Intelligence on the jobsite.",
          body:
            "Daily logs with NOAA weather. AI-graded jobsite photos flag missing safety guards and estimate percent-complete per phase. LiDAR scans from an iPhone import straight in. Every action written to an activity feed you and your PM can filter.",
        },
        {
          n: "07",
          tag: "// SHARE",
          title: "Teams inside. Clients outside.",
          body:
            "Roles for PM / Estimator / Viewer. White-label /share links let clients read-only browse the plan, model, and bid — with your logo and brand color. No client licenses. No pay-per-seat.",
        },
      ],
      stats: [
        { k: "Blueprints traced", v: "1,200+" },
        { k: "AI accuracy", v: "94%" },
        { k: "Time saved / project", v: "8 hrs" },
        { k: "Starts at", v: "$0/mo" },
      ],
    },
    accent: "#FFCC00",
  },
  {
    id: "app-02",
    status: "soon",
    number: "02",
    name: "In the shop",
    tag: "App · 02",
    tagline: "Taking shape. Something we needed and couldn't find.",
    hub_tagline: "Taking shape. Something we needed and couldn't find.",
  },
  {
    id: "app-03",
    status: "soon",
    number: "03",
    name: "Sketched",
    tag: "App · 03",
    tagline: "An idea worth building. Watch this space.",
    hub_tagline: "An idea worth building. Watch this space.",
  },
  {
    id: "app-04",
    status: "soon",
    number: "04",
    name: "TBD",
    tag: "App · 04",
    tagline: "The next one lands here.",
    hub_tagline: "The next one lands here.",
  },
];

export function getApp(id) {
  return APPS.find((a) => a.id === id) || null;
}
