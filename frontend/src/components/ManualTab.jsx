import React, { useMemo, useState } from "react";

/**
 * In-app user manual. Pure-frontend, no API calls — content is curated to match
 * the features actually shipped in this codebase. Update SECTIONS when you ship
 * a new feature so the manual stays in sync.
 */

const SECTIONS = [
  {
    id: "getting-started",
    label: "Getting started",
    hint: "01",
    body: [
      { kind: "h", text: "Welcome to Atlas Construction Cloud" },
      { kind: "p", text: "Atlas turns construction documents into 3D-buildable, biddable, and trackable projects. Upload a blueprint or describe one in words — Atlas does the rest." },
      { kind: "h2", text: "Your first 5 minutes" },
      { kind: "ol", items: [
        "Create a new project from the project dropdown (top-left of the dashboard).",
        "Go to the Documents tab and drop a blueprint PDF or image. AI extraction takes ~30-90s.",
        "Open the Materials tab to see extracted line items. Edit unit prices or quantities inline.",
        "Switch to Blueprint, CAD, or 3D Renderer to visualize what was extracted.",
        "Hit Takeoff Export (top-right of Materials) for CSV / XLSX / PDF.",
      ]},
      { kind: "h2", text: "Plans at a glance" },
      { kind: "table", rows: [
        ["Plan", "Price", "Projects", "AI uploads/mo", "Watermark-free PDFs", "Priority AI"],
        ["Free", "$0", "1", "5", "no", "no"],
        ["Pro", "$49/mo", "Unlimited", "100", "yes", "yes"],
        ["Studio", "$149/mo", "Unlimited", "Unlimited", "yes", "yes — and unlocks unlimited Pay Apps + AI Floorplans + Branding"],
      ]},
      { kind: "tip", text: "Pro includes a 7-day free trial. Cancel anytime from Billing → Manage Subscription." },
    ],
  },
  {
    id: "documents",
    label: "Documents · AI extraction",
    hint: "02",
    body: [
      { kind: "h", text: "Upload + AI extraction" },
      { kind: "p", text: "Drop a PDF (single or multi-page) or an image. GPT-4o vision identifies every material with quantity, unit, and category. Multi-page PDFs run sequentially with a progress bar." },
      { kind: "h2", text: "What gets extracted" },
      { kind: "ul", items: [
        "Materials — name, quantity, unit, category, unit price (when visible)",
        "Wall lines + door/window symbols → seeds your 2D blueprint",
        "Labels (e.g. BEDROOM 1, KITCHEN) → carried into the blueprint",
      ]},
      { kind: "h2", text: "Cross-document deduplication" },
      { kind: "p", text: "Upload a second document for the same project — Atlas merges duplicates intelligently (e.g. '2x4 STUDS' from page 3 and '2x4 framing lumber' from page 7 collapse into one line). The deduplication is shown in the upload log." },
      { kind: "h2", text: "Delete a document" },
      { kind: "p", text: "Click the trash icon on a document card. Materials that came exclusively from that doc are removed; shared materials stay." },
      { kind: "tip", text: "If extraction looks wrong, use the +Rush Re-Analysis add-on ($4) for a fresh, higher-priority AI pass." },
    ],
  },
  {
    id: "materials",
    label: "Materials",
    hint: "03",
    body: [
      { kind: "h", text: "Materials & takeoff" },
      { kind: "p", text: "Auto-populated from your documents, editable inline. Click any cell to change quantity, unit, or unit price. Totals recompute live." },
      { kind: "h2", text: "Source labels" },
      { kind: "ul", items: [
        "ai_extracted — pulled from a document by GPT-4o vision",
        "user_added — typed in by you or a teammate",
        "auto_utility — added by Atlas based on blueprint geometry (e.g. electrical rough-in by sqft)",
      ]},
      { kind: "h2", text: "Exporting takeoffs" },
      { kind: "p", text: "Top-right of the Materials tab — three formats:" },
      { kind: "ul", items: [
        "CSV — universal, opens in Excel or Google Sheets",
        "XLSX — formatted with grand totals + category subtotals",
        "PDF — branded takeoff document (premium branding unlocks the +Premium PDF Branding add-on or Pro plan)",
      ]},
    ],
  },
  {
    id: "blueprint",
    label: "Blueprint",
    hint: "04",
    body: [
      { kind: "h", text: "2D blueprint viewer" },
      { kind: "p", text: "Read-only summary of the building footprint. Walls render in feet/inches. Useful for sanity-checking what was extracted from the document. For editing, use the CAD Editor tab." },
      { kind: "h2", text: "Roof types" },
      { kind: "p", text: "Set on the Blueprint tab — pitched / flat / gable / hip / shed. The 3D Renderer uses this to generate the correct roof geometry." },
    ],
  },
  {
    id: "cad",
    label: "CAD Editor",
    hint: "05",
    body: [
      { kind: "h", text: "SketchUp-style 2D CAD" },
      { kind: "p", text: "Pixel-precise editor with dimension chains. Walls, doors, windows, labels are all drag-droppable." },
      { kind: "h2", text: "Tools" },
      { kind: "table", rows: [
        ["Tool", "Shortcut", "What it does"],
        ["Wall", "W", "Click two points to draw a wall. Auto-snaps to existing walls."],
        ["Door", "D", "Click a wall to drop a door. Default 36\"."],
        ["Window", "I", "Click a wall to drop a window. Default 48\"."],
        ["Label", "L", "Type a room name (BEDROOM, KITCHEN, etc.)"],
        ["Pan", "Space-drag", "Drag the canvas without changing zoom"],
        ["Zoom", "Scroll wheel", "Zoom to cursor"],
      ]},
      { kind: "h2", text: "AI SKETCH — text to floorplan" },
      { kind: "p", text: "Top-right floating panel. Type a brief (e.g. '1,200 sqft 3-bed ADU on a 40×80 lot') and GPT-4o sketches walls, doors, windows, labels. You then refine. Costs 1 AI Floorplan credit (or unlimited on Studio)." },
      { kind: "h2", text: "CODE — live compliance check" },
      { kind: "p", text: "Same panel, CODE tab. Toggle between IRC (residential) and IBC (commercial). Live warnings for:" },
      { kind: "ul", items: [
        "Egress door clear width < 32\" (IBC 1010.1.1)",
        "Hallway/corridor width below code minimum",
        "Bedroom missing nearby egress window",
        "Room area below 70 sqft (habitable) or 35 sqft (bath)",
        "Ceiling height below 7'6\"",
        "Incomplete exterior perimeter",
      ]},
      { kind: "tip", text: "Compliance is advisory — always verify with your local AHJ before submitting drawings." },
    ],
  },
  {
    id: "renderer",
    label: "3D Renderer",
    hint: "06",
    body: [
      { kind: "h", text: "3D Renderer — 15 construction phases" },
      { kind: "p", text: "Watch the building come together from site prep through finishing." },
      { kind: "h2", text: "Layers (toggle each on/off)" },
      { kind: "p", text: "Site Prep · Underground Utilities · Septic/Sewer · Foundation · Columns · Frame · Plumbing Rough-In · Electrical Rough-In · Wall Girts · Roof Purlins · Roof Sheet · Wall Sheet · Doors/Windows · Trim/Flashing · Finished" },
      { kind: "h2", text: "Toolbar buttons (top-right of canvas)" },
      { kind: "ul", items: [
        "STUDIO RENDER · 4K — exports a high-resolution PNG (consumes 1 Studio Render credit)",
        "WALKTHROUGH VIDEO — 16-second cinematic .webm of the build sequence (consumes 1 video credit)",
        "PLACE ON MAP — drag, rotate, and scale the model on your captured satellite image",
      ]},
      { kind: "h2", text: "Place on Map" },
      { kind: "p", text: "Visible once you have a captured site + walls. Drag to translate, slider to rotate, scroll-wheel to scale (visual only — your blueprint dimensions never change). Save persists." },
      { kind: "h2", text: "AI MATCH SATELLITE SCALE" },
      { kind: "p", text: "Inside the placement panel. GPT-4o vision detects the building in your satellite tile, reports its real-world feet, and auto-scales your 3D model. Optional 'reference dimension' input locks the scale to a known number." },
      { kind: "tip", text: "Use Place on Map + AI Match together: position with AI's scale, then nudge with the slider for final placement before saving." },
    ],
  },
  {
    id: "field",
    label: "Field execution",
    hint: "07",
    body: [
      { kind: "h", text: "Daily logs · Photos · LiDAR · Progress" },
      { kind: "p", text: "The Field tab is for the jobsite — what got done today, photos with AI progress estimates, and 3D scan uploads." },
      { kind: "h2", text: "Daily logs" },
      { kind: "p", text: "Log crew size + notes. If you've captured a site, NOAA weather auto-attaches (temperature, conditions, wind). Logs are searchable + included in the activity feed." },
      { kind: "h2", text: "Site photos with AI progress" },
      { kind: "p", text: "Drop a jobsite photo. GPT-4o vision estimates % complete for each of the 15 construction phases, plus flags any visible issues (water pooling, missing safety guard, etc.). Photos are timestamped with your account email." },
      { kind: "h2", text: "Progress summary" },
      { kind: "p", text: "Aggregates % per phase across all your site photos (max wins). Lets owners see the full project state at a glance." },
      { kind: "h2", text: "LiDAR / 3D scans" },
      { kind: "p", text: "Upload .usdz (iPhone/iPad Lidar), .obj, .gltf, or .glb files up to 50 MB. Currently store + download — wall-extraction pipeline coming." },
    ],
  },
  {
    id: "schedule",
    label: "Schedule (Gantt)",
    hint: "08",
    body: [
      { kind: "h", text: "Critical-path schedule" },
      { kind: "p", text: "Forward + backward pass scheduling across the 15 construction phases. Inputs: building sqft + crew size + start date. Output: SVG Gantt with critical-path bars in red, non-critical in yellow." },
      { kind: "h2", text: "Phase duration math" },
      { kind: "p", text: "duration = crew_days_per_ksf × (sqft/1000) × (4/crew_size), floored at 1 day. Each phase respects its dependencies (Foundation can't start until Underground + Septic finish, etc.)." },
      { kind: "h2", text: "Phase details table" },
      { kind: "p", text: "Below the Gantt — start day, end day, duration, slack (in days), and a critical-path indicator. Click 'Phase details table' to expand." },
    ],
  },
  {
    id: "payapps",
    label: "Pay Apps (AIA G702/G703)",
    hint: "09",
    body: [
      { kind: "h", text: "AIA G702 + G703 generator" },
      { kind: "p", text: "Industry-standard payment applications, auto-populated from your latest bid snapshot." },
      { kind: "h2", text: "How to use" },
      { kind: "ol", items: [
        "Save a bid with your materials + pricing.",
        "Pay Apps tab → fill contractor / owner / architect + retainage % (default 10).",
        "+ New pay app — line items autofill from the bid.",
        "Edit work_completed_this_period (and previous, stored materials) inline.",
        "Click Save — aggregate (current due, retainage, balance to finish) recomputes.",
        "Download G702 + G703 — branded landscape PDF.",
      ]},
      { kind: "h2", text: "Credits" },
      { kind: "p", text: "Free/Pro: each PDF download costs 1 Pay-App PDF credit (10-pack add-on for $39). Studio: unlimited." },
    ],
  },
  {
    id: "pricing",
    label: "Pricing & Bids",
    hint: "10",
    body: [
      { kind: "h", text: "Regional pricing + bid versioning" },
      { kind: "p", text: "RSMeans-style multipliers based on zip code, plus labor + O&P sliders." },
      { kind: "h2", text: "Pricing inputs" },
      { kind: "ul", items: [
        "Zip code → regional multiplier (e.g. NYC 10001 → 1.34×, rural KS → 0.85×)",
        "Labor unit price per material (free-form)",
        "Markup % — applied across all materials (e.g. 15%)",
        "Overhead & Profit % — applied on top",
        "Contingency % — buffer for unknowns",
      ]},
      { kind: "h2", text: "Bid snapshots" },
      { kind: "p", text: "Save a bid to capture the full materials list + pricing config at a moment in time. Compare two bids side-by-side with the Diff view to see what changed." },
    ],
  },
  {
    id: "collab",
    label: "Collaboration",
    hint: "11",
    body: [
      { kind: "h", text: "Team + activity feed + sharing" },
      { kind: "p", text: "Open the Collab modal (top-right of dashboard, person icon)." },
      { kind: "h2", text: "Roles" },
      { kind: "ul", items: [
        "Owner — created the project, has all permissions including deletion",
        "PM — full edit access, can invite teammates, no project deletion",
        "Estimator — edit materials, blueprint, pricing — cannot manage members",
        "Viewer — read-only access",
      ]},
      { kind: "h2", text: "Activity feed" },
      { kind: "p", text: "Every meaningful action is logged (material edited, document uploaded, bid saved, member invited, etc.). Filter by user or action type." },
      { kind: "h2", text: "Client portal" },
      { kind: "p", text: "Toggle Share on a project → get a public URL like /share/<token>. Client sees a read-only view of materials, blueprint, 3D model + bid totals. Customize with your logo + brand color via the Client Portal Branding add-on or Studio plan." },
    ],
  },
  {
    id: "site",
    label: "Site / Maps",
    hint: "12",
    body: [
      { kind: "h", text: "Google Maps site picker" },
      { kind: "p", text: "Capture a real-world satellite tile for your project — used as the 3D ground plane and for AI terrain analysis." },
      { kind: "h2", text: "How to capture a site" },
      { kind: "ol", items: [
        "Pricing tab → 'Pick Site From Map' (or Renderer tab if no site yet).",
        "Click a location on the interactive map.",
        "Adjust zoom (typical: 19 for residential lots, 17 for large commercial).",
        "AI runs a terrain analysis — soil type estimate, slope, vegetation density, recommended building orientation.",
      ]},
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    hint: "13",
    body: [
      { kind: "h", text: "Daily activity digest + alerts" },
      { kind: "p", text: "Settings → Notifications. Toggle each email category independently." },
      { kind: "h2", text: "Daily digest" },
      { kind: "p", text: "8:00 AM UTC email summarizing every activity on projects you own or manage from the past 24h. Your own actions are excluded (no echo)." },
      { kind: "h2", text: "Preview + Send Test" },
      { kind: "p", text: "Two buttons on the Notifications page — preview opens the HTML version in a new tab, Send Test fires the actual email to your account." },
    ],
  },
  {
    id: "billing",
    label: "Billing",
    hint: "14",
    body: [
      { kind: "h", text: "Subscriptions, add-ons, and the Customer Portal" },
      { kind: "p", text: "Visit /billing or the Billing item in the dropdown menu." },
      { kind: "h2", text: "Subscribe" },
      { kind: "p", text: "Pro $49/mo or Studio $149/mo. Pro starts with a 7-day free trial (no charge during trial, card collected upfront)." },
      { kind: "h2", text: "Manage subscription" },
      { kind: "p", text: "Once subscribed, the MANAGE SUBSCRIPTION button opens the Stripe Customer Portal where you can:" },
      { kind: "ul", items: [
        "Cancel — keeps access until the end of the current billing period",
        "Update card",
        "View + download invoices",
        "Switch between Pro and Studio",
      ]},
      { kind: "h2", text: "Add-ons" },
      { kind: "p", text: "One-time purchases, never expire. Includes Studio Render Pack, Walkthrough Videos, Pay-App PDF packs, Client Portal Branding, AI Floorplan Boost, +Upload Credits, Rush Re-Analysis." },
    ],
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    hint: "15",
    body: [
      { kind: "h", text: "Speed up your workflow" },
      { kind: "h2", text: "CAD Editor" },
      { kind: "table", rows: [
        ["Shortcut", "Action"],
        ["W", "Wall tool"],
        ["D", "Door tool"],
        ["I", "Window tool"],
        ["L", "Label tool"],
        ["Esc", "Deselect / exit current tool"],
        ["Delete / Backspace", "Remove selected item"],
        ["Cmd/Ctrl + Z", "Undo"],
        ["Cmd/Ctrl + Shift + Z", "Redo"],
        ["Cmd/Ctrl + S", "Save blueprint"],
        ["Space + drag", "Pan canvas"],
        ["Scroll", "Zoom to cursor"],
      ]},
      { kind: "h2", text: "Anywhere in app" },
      { kind: "table", rows: [
        ["Shortcut", "Action"],
        ["Cmd/Ctrl + K", "Open project switcher"],
        ["?", "Open this manual"],
      ]},
    ],
  },
  {
    id: "support",
    label: "Support",
    hint: "16",
    body: [
      { kind: "h", text: "Need help?" },
      { kind: "p", text: "Atlas is actively developed — your feedback directly shapes the roadmap." },
      { kind: "h2", text: "Common questions" },
      { kind: "ul", items: [
        "Why are PDF extraction results imperfect? GPT-4o vision is ~92% accurate on architectural plans. Always verify quantities before pricing.",
        "Can I import an existing CSV? Not yet — coming. For now, edit materials inline.",
        "How do I rotate / move the 3D model on the satellite? Renderer tab → PLACE ON MAP → drag + rotation slider + scroll-wheel for scale.",
        "Why does the AI Floorplan need credits? GPT-4o calls cost money. Studio plan = unlimited.",
        "How do I cancel? Billing → Manage Subscription → Cancel. Keeps access until period ends.",
      ]},
      { kind: "h2", text: "Status of the data you upload" },
      { kind: "p", text: "Documents, photos, and LiDAR scans are stored in your project's MongoDB record. Deleting a project deletes everything associated with it. Stripe handles all payment data — Atlas never sees full card numbers." },
    ],
  },
];

function Block({ block }) {
  switch (block.kind) {
    case "h":
      return <h2 className="font-display text-3xl tracking-tighter mt-6 mb-4">{block.text}</h2>;
    case "h2":
      return <h3 className="font-display text-lg tracking-tight mt-6 mb-2 text-[#FFCC00]">{block.text}</h3>;
    case "p":
      return <p className="text-sm text-neutral-300 leading-relaxed mb-3">{block.text}</p>;
    case "ul":
      return (
        <ul className="text-sm text-neutral-300 space-y-1.5 list-disc pl-5 mb-3 marker:text-[#FFCC00]">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol className="text-sm text-neutral-300 space-y-1.5 list-decimal pl-5 mb-3 marker:text-[#FFCC00] marker:font-bold">
          {block.items.map((it, i) => <li key={i}>{it}</li>)}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto mb-4">
          <table className="text-xs font-mono w-full border border-white/10">
            <thead className="bg-black text-neutral-500">
              <tr>{block.rows[0].map((h, i) => <th key={i} className="text-left px-3 py-2 border-b border-white/10">{h}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, i) => (
                <tr key={i} className={i % 2 ? "bg-white/[0.02]" : ""}>
                  {row.map((c, j) => <td key={j} className="px-3 py-2 border-b border-white/5 text-neutral-300">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "tip":
      return (
        <div className="border-l-4 border-[#FFCC00] bg-[#FFCC00]/5 px-4 py-3 mb-3 text-xs font-mono text-neutral-200">
          <span className="text-[#FFCC00] font-bold">TIP · </span>{block.text}
        </div>
      );
    default:
      return null;
  }
}

export default function ManualTab() {
  const [active, setActive] = useState("getting-started");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return SECTIONS;
    const q = query.toLowerCase();
    return SECTIONS.filter((s) => {
      if (s.label.toLowerCase().includes(q)) return true;
      const allText = JSON.stringify(s.body).toLowerCase();
      return allText.includes(q);
    });
  }, [query]);

  const current = SECTIONS.find((s) => s.id === active) || SECTIONS[0];

  return (
    <div className="h-full grid grid-cols-1 md:grid-cols-[260px_1fr]" data-testid="manual-tab">
      <aside className="border-r border-white/10 bg-[#0a0a0a] overflow-y-auto">
        <div className="p-4 border-b border-white/10 sticky top-0 bg-[#0a0a0a]">
          <div className="label-mono text-neutral-500 mb-2">// USER MANUAL</div>
          <input
            data-testid="manual-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-black border border-white/15 px-3 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
          />
        </div>
        <nav className="py-2">
          {filtered.map((s) => {
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                data-testid={`manual-nav-${s.id}`}
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-5 py-2.5 flex items-center gap-3 transition-colors border-l-2 ${
                  isActive
                    ? "border-[#FFCC00] bg-white/5 text-white"
                    : "border-transparent text-neutral-500 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className={`label-mono ${isActive ? "text-[#FFCC00]" : ""}`}>{s.hint}</span>
                <span className="text-xs uppercase tracking-wider font-medium">{s.label}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-5 py-4 text-xs text-neutral-500 font-mono">
              No section matches “{query}”
            </div>
          )}
        </nav>
      </aside>

      <section className="overflow-y-auto p-8 md:p-12 max-w-4xl" data-testid="manual-content">
        <div className="mb-2 label-mono text-neutral-500">// {current.hint} · {current.label.toUpperCase()}</div>
        {current.body.map((block, i) => <Block key={i} block={block} />)}
        <div className="mt-12 pt-6 border-t border-white/10 flex items-center justify-between text-xs font-mono text-neutral-500">
          <span>Atlas Construction Cloud · User manual</span>
          <span>Press <span className="bg-white/10 px-1.5 py-0.5 text-white">?</span> anywhere to jump back here</span>
        </div>
      </section>
    </div>
  );
}
