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
    id: "vision-cad",
    status: "live",
    number: "02",
    name: "Vision CAD",
    tag: "Studio CAD Platform",
    tagline: "SketchUp fluency in the browser. Nothing to install.",
    hub_tagline: "SketchUp fluency in the browser. Nothing to install.",
    detail: {
      role: "// STUDIO 02 · LIVE",
      headline: "The CAD tool that lives where your work already does.",
      lede:
        "Vision CAD is a browser-native 3D modeler with SketchUp muscle memory — push/pull, follow-me, offset, groups, components — but no download, no license file, no laptop dependency. Draw on your desk, review on your phone, export to your GC.",
      hero_bullets: [
        "Push/pull · follow-me · offset · array",
        "Groups + reusable components",
        "Snap-to-grid, dimension chains, exact input",
        "Live measurements in feet, inches, or metric",
        "Import DXF · DWG · STL · OBJ",
        "Export IFC · glTF · high-res PNG",
      ],
      cta_primary: { label: "Open Vision CAD", to: "https://vision-cad-platform.emergent.host/register" },
      cta_secondary: { label: "See what's live · Atlas", to: "/apps/atlas" },
      cta_footline: { top: "Open the studio.", bottom: "Draw the first thing." },
      chapters: [
        {
          n: "01",
          tag: "// DRAW",
          title: "Muscle memory, preserved.",
          body:
            "If you've ever used SketchUp, Vision CAD feels like coming home — push/pull an edge into a face, follow-me a profile around a path, offset a wall by an exact dimension. Every gesture that made SketchUp addictive, ported to the browser and sharpened for 2026 hardware.",
        },
        {
          n: "02",
          tag: "// COMPONENT",
          title: "Reuse, not redraw.",
          body:
            "Save any selection as a component. Drop it in once, edit it everywhere. Nested components inherit parent transforms; edits propagate in real time across the model. Ship a component library your whole team can pull from a shared workspace.",
        },
        {
          n: "03",
          tag: "// PRECISION",
          title: "Every dimension typed, every angle snapped.",
          body:
            "Type an exact length while you drag. Chain dimensions from an existing edge. Snap to endpoints, midpoints, intersections, and inferred axes. The precision toolkit that architects and cabinet-makers actually need — no plugin required.",
        },
        {
          n: "04",
          tag: "// EXCHANGE",
          title: "Fits into the file formats you already trade.",
          body:
            "Import DXF from your surveyor, DWG from your architect, STL from your fabricator. Export IFC for the BIM handoff or glTF for a walkthrough on any device. Vision CAD is the tool in the middle — never the tool that traps your files.",
        },
        {
          n: "05",
          tag: "// COLLAB",
          title: "Review from the truck. Approve on the phone.",
          body:
            "Share a read-only link — the recipient sees the exact model, orbits it, drops a comment, and gets on with their day. No account required. No plugin download. No file version drift.",
        },
      ],
      stats: [
        { k: "Draw actions / min", v: "40+" },
        { k: "Startup cost", v: "$0" },
        { k: "Install size", v: "0 KB" },
        { k: "Browsers", v: "Chrome, Safari, Edge" },
      ],
    },
    accent: "#00E5FF",
  },
  {
    id: "site-vision",
    status: "live",
    number: "03",
    name: "Site Vision",
    tag: "3D Rendering Studio",
    tagline: "Photoreal renders from a CAD model, one click.",
    hub_tagline: "Photoreal renders from a CAD model, one click.",
    detail: {
      role: "// STUDIO 03 · LIVE",
      headline: "The rendering engine your presentation deserved.",
      lede:
        "Site Vision turns any 3D model into a photoreal, client-ready render in the time it takes to reheat your coffee. Import from Vision CAD, Atlas, SketchUp, Rhino, or Revit. Pick a camera. Pick a light. Get the money shot.",
      hero_bullets: [
        "Path-traced GPU rendering",
        "Physically-based materials library",
        "Real sun / sky / weather · any date, any latitude",
        "4K + 8K stills · 60fps walkthroughs",
        "Depth-of-field, motion blur, volumetric fog",
        "Import from Vision CAD · Atlas · SKP · OBJ · IFC",
      ],
      cta_primary: { label: "Open Site Vision", to: "https://site-vision-platform.emergent.host/register" },
      cta_secondary: { label: "See what's live · Atlas", to: "/apps/atlas" },
      cta_footline: { top: "Bring a model.", bottom: "Leave with the money shot." },
      chapters: [
        {
          n: "01",
          tag: "// LOAD",
          title: "Bring the model. We handle the rest.",
          body:
            "Drop a Vision CAD file, an Atlas project, a SketchUp .SKP, a Rhino .3DM, or a plain OBJ. Site Vision auto-detects materials from names, assigns physically-based defaults, and gets you to a viewport preview in seconds — not the 20-minute wait a desktop renderer would ask for.",
        },
        {
          n: "02",
          tag: "// LIGHT",
          title: "Real sun. Real sky. Any address.",
          body:
            "Type a street address and a date. Site Vision positions the sun at the exact azimuth and elevation for that time and place, and lights the sky with a real atmospheric model. Golden hour on the front porch. Overcast on a north elevation. Every render is astronomically correct.",
        },
        {
          n: "03",
          tag: "// MATERIAL",
          title: "PBR library that speaks the trade's language.",
          body:
            "Not \"metal_generic_04\" — cedar shingle, T1-11 siding, standing-seam copper, board-formed concrete. Every material in the library is named the way a builder names it, mapped to real physical properties. Drag, drop, done.",
        },
        {
          n: "04",
          tag: "// RENDER",
          title: "GPU path tracing, no queue.",
          body:
            "Site Vision runs on cloud GPUs — you don't buy an RTX card, you don't reboot your laptop. A 4K still finishes in under a minute. A 60-second cinematic walkthrough is done before your client is done reading the email.",
        },
        {
          n: "05",
          tag: "// DELIVER",
          title: "Client-shareable. Watermarked or white-labeled.",
          body:
            "Deliver via a public share link, an embed for your website, or a direct download. On the Studio tier, every render carries your firm's logo and brand color — never ours. Because the render is your work; the tool is just how it got there.",
        },
      ],
      stats: [
        { k: "4K render time", v: "< 60s" },
        { k: "Materials in library", v: "300+" },
        { k: "Import formats", v: "12" },
        { k: "GPU hours / mo", v: "unlimited" },
      ],
    },
    accent: "#FF6B35",
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
