import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight, Boxes, Cpu, Layers3, FileText, MapPin, Users,
  Wand2, ScanLine, Ruler, LineChart, Cloud, Lock, HardHat, Mail,
} from "lucide-react";
import { useStore } from "@/store";
import { APPS } from "@/data/apps";
import { CONTACT_EMAIL, CONTACT_MAILTO, mailtoWithSubject } from "@/data/brand";
import HeroCanvas from "@/components/landing/HeroCanvas";
import MockAtlasBlueprint from "@/components/landing/MockAtlasBlueprint";
import { AppScreenshot } from "@/components/landing/AppScreenshot";

// ---------- Design tokens (from /app/design_guidelines.json) ----------
const BG = "#0A0A0A";
const SURFACE = "#141414";
const BORDER = "#262626";
const PRIMARY = "#FFCC00";
const ACCENT = "#00E5FF";

// ---------- Motion helpers ----------
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

// =====================================================================
// NAV
// =====================================================================
function Nav({ token }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      data-testid="landing-nav"
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "backdrop-blur-xl bg-[#0A0A0A]/85 border-b border-[#262626]" : "bg-transparent"
      }`}
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 flex items-center justify-between h-16">
        <Link to="/" data-testid="landing-nav-brand" className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#FFCC00] flex items-center justify-center font-display text-black text-lg leading-none">
            G
          </div>
          <div className="leading-none">
            <div className="font-display text-white text-base tracking-tight">GONZO LABS</div>
            <div className="label-mono text-[9px] mt-0.5">// A STUDIO OF TOOLS</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-neutral-400">
          <a href="#features" data-testid="landing-nav-features" className="hover:text-white transition-colors">Features</a>
          <a href="#apps" data-testid="landing-nav-apps" className="hover:text-white transition-colors">Studio Apps</a>
          <a href="#pricing" data-testid="landing-nav-pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#contact" data-testid="landing-nav-contact" className="hover:text-white transition-colors">Contact</a>
        </nav>
        <div className="flex items-center gap-3">
          {token ? (
            <Link
              to="/app"
              data-testid="landing-nav-enter-app"
              className="flex items-center gap-2 bg-[#FFCC00] text-black font-semibold text-sm px-4 py-2 hover:bg-[#E6B800] transition-colors"
            >
              Enter Atlas <ArrowUpRight size={14} />
            </Link>
          ) : (
            <>
              <Link
                to="/signin"
                data-testid="landing-nav-signin"
                className="hidden sm:block text-sm text-neutral-300 hover:text-white transition-colors"
              >
                Sign in
              </Link>
              <Link
                to="/signin?mode=register"
                data-testid="landing-nav-try-free"
                className="bg-[#FFCC00] text-black font-semibold text-sm px-4 py-2 hover:bg-[#E6B800] transition-colors"
              >
                Try free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// =====================================================================
// HERO
// =====================================================================
function Hero({ token }) {
  const reduced = useReducedMotion();
  return (
    <section
      data-testid="landing-hero"
      className="relative min-h-screen w-full overflow-hidden pt-24 pb-16"
    >
      {/* animated blueprint canvas backdrop */}
      <div className="absolute inset-0 pointer-events-none">
        <HeroCanvas />
      </div>
      {/* grain overlay */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />
      {/* Signed-in welcome-back bar */}
      {token && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 relative z-10"
        >
          <Link
            to="/app"
            data-testid="hero-welcome-back"
            className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 border border-[#00E5FF]/40 bg-[#00E5FF]/5 text-[#00E5FF] text-xs font-mono tracking-wider uppercase hover:bg-[#00E5FF]/10 transition-colors"
          >
            <span className="w-1.5 h-1.5 bg-[#00E5FF] animate-pulse" /> Welcome back — Enter Atlas
            <ArrowUpRight size={12} />
          </Link>
        </motion.div>
      )}
      <motion.div
        variants={stagger}
        initial={reduced ? "show" : "hidden"}
        animate="show"
        className="relative z-10 w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 pt-16 md:pt-24"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-8">
          <span className="w-8 h-px bg-[#00E5FF]" />
          <span className="label-mono text-[#00E5FF]">// STUDIO 01 — GONZO LABS</span>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="font-serif-editorial text-white text-[52px] sm:text-7xl lg:text-[8.5rem] leading-[0.9] tracking-tighter max-w-6xl"
        >
          Software that <em className="text-[#FFCC00] not-italic">builds</em><br />
          before it <em className="italic text-neutral-500">ships.</em>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          className="mt-10 max-w-2xl text-lg lg:text-xl text-neutral-400 leading-relaxed"
        >
          A studio of tools built for people who make things in the physical world.
          Every app runs on the same conviction: <span className="text-white">the software should do the tedious part</span>, so you can do the ambitious part.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            to={token ? "/app" : "/signin?mode=register"}
            data-testid="hero-primary-cta"
            className="group inline-flex items-center gap-3 bg-[#FFCC00] text-black font-semibold px-6 py-3.5 hover:bg-[#E6B800] transition-all duration-300 hover:-translate-y-0.5"
          >
            {token ? "Enter Atlas" : "Try Atlas free"}
            <ArrowUpRight size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
          </Link>
          <a
            href="#features"
            data-testid="hero-secondary-cta"
            className="inline-flex items-center gap-3 border border-neutral-700 text-white px-6 py-3.5 hover:bg-neutral-900 hover:border-neutral-500 transition-all duration-300"
          >
            Tour the features
          </a>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-px bg-[#262626] border border-[#262626]">
          {[
            ["01", "Blueprints", "→ 3D in <60s"],
            ["02", "Accuracy", "94% AI"],
            ["03", "Saved", "8 hrs / project"],
            ["04", "Cost", "From $0/mo"],
          ].map(([n, k, v]) => (
            <div key={n} className="bg-[#0A0A0A] p-5 md:p-7">
              <div className="label-mono text-[#00E5FF] text-[10px]">// {n}</div>
              <div className="text-neutral-500 text-xs uppercase tracking-widest mt-2">{k}</div>
              <div className="font-serif-editorial text-white text-3xl mt-1">{v}</div>
            </div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}

// =====================================================================
// FEATURES
// =====================================================================
const FEATURES = [
  {
    id: "ai-extraction",
    span: "col-span-12 lg:col-span-8",
    icon: Cpu,
    tag: "01 // AI EXTRACTION",
    title: "Drop a plan. Get a building.",
    body: "GPT-4o Vision + OpenCV Hough tracing pull every wall, door, window, fixture and label off a PDF, photo or whiteboard sketch — in under sixty seconds.",
    hero: true,
    mock: "extract",
  },
  {
    id: "cad-editor",
    span: "col-span-12 lg:col-span-4",
    icon: Ruler,
    tag: "02 // CAD",
    title: "SketchUp fluency in the browser.",
    body: "Wall / rect / circle / door / window / label tools. Undo/redo, Simplify, Straighten, snap-to-grid, dimension chains, exact-typed lengths.",
    mock: "cad",
  },
  {
    id: "renderer",
    span: "col-span-12 lg:col-span-4",
    icon: Layers3,
    tag: "03 // 3D RENDER",
    title: "Fifteen phases. One click.",
    body: "Watch the model come together from excavation through finishing. Studio-quality PNG exports and cinematic walkthrough videos.",
    mock: "render",
  },
  {
    id: "map-placement",
    span: "col-span-12 lg:col-span-4",
    icon: MapPin,
    tag: "04 // ON THE MAP",
    title: "Real coordinates. Real terrain.",
    body: "Pick a lot on the map. AI reads soil, slope, vegetation. Place your 3D model on the actual satellite tile with an AI-matched scale.",
    mock: "map",
  },
  {
    id: "payapps",
    span: "col-span-12 lg:col-span-4",
    icon: FileText,
    tag: "05 // PAY APPS",
    title: "AIA G702 / G703 generated.",
    body: "Auto-populate from your last bid. Edit percent-complete inline. Download a branded, landscape PDF that owners actually accept.",
    mock: "payapp",
  },
  {
    id: "field",
    span: "col-span-12 lg:col-span-6",
    icon: HardHat,
    tag: "06 // FIELD",
    title: "Jobsite intelligence.",
    body: "Daily logs with NOAA weather. AI-graded jobsite photos flag missing safety gear and estimate percent-complete per phase. LiDAR scans imported straight from an iPhone.",
    mock: "field",
  },
  {
    id: "collab",
    span: "col-span-12 lg:col-span-6",
    icon: Users,
    tag: "07 // COLLABORATION",
    title: "Teams and clients, together.",
    body: "Roles for PM / estimator / viewer. White-label /share links let clients browse the plan, model, and bid in read-only. Every action logged in the activity feed.",
    mock: "collab",
  },
];

function FeatureCard({ f, i }) {
  const Icon = f.icon;
  const isHero = f.hero;
  return (
    <motion.article
      variants={fadeUp}
      data-testid={`feature-card-${f.id}`}
      className={`${f.span} group relative bg-[#141414] border border-[#262626] p-8 md:p-10 flex flex-col overflow-hidden transition-all duration-500 hover:border-[#00E5FF]/60 hover:shadow-[0_0_60px_-15px_rgba(0,229,255,0.25)]`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="label-mono text-[#00E5FF] mb-4">{f.tag}</div>
          <h3 className={`font-serif-editorial text-white leading-tight ${isHero ? "text-4xl md:text-5xl lg:text-6xl" : "text-2xl md:text-3xl"}`}>
            {f.title}
          </h3>
        </div>
        <div className="shrink-0 w-11 h-11 flex items-center justify-center border border-[#262626] group-hover:border-[#FFCC00] group-hover:text-[#FFCC00] text-neutral-500 transition-colors">
          <Icon size={18} />
        </div>
      </div>
      <p className={`text-neutral-400 mt-6 leading-relaxed ${isHero ? "text-lg max-w-2xl" : "text-sm"}`}>{f.body}</p>

      {/* Feature visual */}
      <div className={`mt-8 flex-1 min-h-[160px] border border-[#262626] relative overflow-hidden ${isHero ? "min-h-[280px]" : ""}`}>
        <FeatureVisual kind={f.mock} isHero={isHero} />
      </div>

      <div className="pointer-events-none absolute -top-px -right-px w-16 h-16 border-t border-r border-[#FFCC00] opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="pointer-events-none absolute -bottom-px -left-px w-16 h-16 border-b border-l border-[#FFCC00] opacity-0 group-hover:opacity-100 transition-opacity" />
    </motion.article>
  );
}

function FeatureVisual({ kind, isHero }) {
  if (kind === "extract") {
    return <AppScreenshot src="/screenshots/atlas-blueprint.jpg" alt="Atlas — Live Blueprint" caption="// ATLAS · BLUEPRINT TAB" />;
  }
  if (kind === "cad") {
    return <AppScreenshot src="/screenshots/atlas-cad.jpg" alt="Atlas — 2D CAD Editor" caption="// ATLAS · 2D CAD EDITOR" crop="center" />;
  }
  if (kind === "render") {
    return <AppScreenshot src="/screenshots/atlas-3d.jpg" alt="Atlas — 3D Renderer" caption="// ATLAS · 3D RENDERER" crop="center" />;
  }
  if (kind === "map") return <MockAtlasBlueprint variant="map" />;
  if (kind === "payapp") {
    return <AppScreenshot src="/screenshots/atlas-payapps.jpg" alt="Atlas — Pay Apps" caption="// ATLAS · PAY APPS · AIA G702" />;
  }
  if (kind === "field") {
    return <AppScreenshot src="/screenshots/atlas-field.jpg" alt="Atlas — Field logs" caption="// ATLAS · FIELD · DAILY LOG" />;
  }
  if (kind === "collab") return <CollabMock />;
  return null;
}

function CollabMock() {
  const activity = [
    { u: "L. Choi", a: "edited", t: "electrical rough-in", when: "2m" },
    { u: "M. Reyes", a: "commented", t: "roof pitch", when: "9m" },
    { u: "K. Iyer", a: "saved bid v3", t: "$412,880 total", when: "24m" },
    { u: "Client", a: "viewed", t: "/share/abc12", when: "1h" },
  ];
  return (
    <div className="w-full h-full bg-[#0A0A0A] p-4">
      <div className="label-mono text-[#00E5FF] text-[9px]">// ACTIVITY</div>
      <ul className="mt-2 space-y-2">
        {activity.map((x, i) => (
          <li key={`act-${i}-${x.t}`} className="flex items-baseline gap-2 text-[11px] font-mono">
            <span className="w-1.5 h-1.5 bg-[#FFCC00] rounded-full mt-1 shrink-0" />
            <span className="text-white">{x.u}</span>
            <span className="text-neutral-500">{x.a}</span>
            <span className="text-neutral-300 flex-1 truncate">{x.t}</span>
            <span className="text-neutral-600 shrink-0">{x.when}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section
      id="features"
      data-testid="landing-features"
      className="relative bg-[#0A0A0A] py-24 md:py-32 lg:py-48 border-t border-[#262626]"
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          <motion.div variants={fadeUp} className="flex items-center gap-3 mb-8">
            <span className="w-8 h-px bg-[#FFCC00]" />
            <span className="label-mono text-[#FFCC00]">// FLAGSHIP · ATLAS</span>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            className="font-serif-editorial text-white text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tighter max-w-4xl"
          >
            The <em className="italic text-[#00E5FF]">Atlas</em><br />feature set.
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 max-w-2xl text-neutral-400 text-lg">
            Construction management + 3D visualization. Everything one operator needs to bid, build, and bill — in one workspace.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-16 grid grid-cols-12 gap-6"
        >
          {FEATURES.map((f, i) => <FeatureCard key={f.id} f={f} i={i} />)}
        </motion.div>
      </div>
    </section>
  );
}

// =====================================================================
// APPS HUB — cards navigate to /apps/:id case-study page
// =====================================================================

function AppCard({ app }) {
  const isLive = app.status === "live";
  const isPreview = app.status === "preview";
  const isFeatured = isLive || isPreview;
  const accent = app.accent || "#FFCC00";
  // If the app's primary CTA is an external URL (Vision CAD, Site Vision),
  // the card itself opens that URL in a new tab — skipping our microsite
  // entirely so users land directly on the app they came to try. Atlas
  // (internal path) and preview / soon apps still go to the microsite.
  const externalHref =
    isLive && typeof app.detail?.cta_primary?.to === "string" && /^https?:\/\//i.test(app.detail.cta_primary.to)
      ? app.detail.cta_primary.to
      : null;
  const badge = isLive ? "· LIVE ·" : isPreview ? "· PREVIEW ·" : "· SOON ·";
  // Convert accent hex → rgba(…,0.4) for the hover glow shadow.
  const glowRgba = (() => {
    const h = accent.replace("#", "");
    if (h.length !== 6) return "rgba(255,204,0,0.4)";
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},0.4)`;
  })();
  const Body = (
    <>
      <div className="flex items-baseline justify-between">
        <span className="label-mono text-[#00E5FF]">// {app.number}</span>
        <span
          className={`label-mono ${isFeatured ? "" : "text-neutral-600"}`}
          style={isFeatured ? { color: accent } : undefined}
        >
          {badge}
        </span>
      </div>
      <div className="mt-8 flex items-baseline gap-3">
        <h3
          className={`font-serif-editorial leading-none ${isFeatured ? "text-white text-6xl md:text-7xl" : "text-neutral-700 text-4xl md:text-5xl"}`}
        >
          {app.name}
        </h3>
      </div>
      <div
        className={`mt-3 label-mono ${isFeatured ? "" : "text-neutral-700"}`}
        style={isFeatured ? { color: accent } : undefined}
      >
        {app.tag}
      </div>
      <p className={`mt-6 text-sm leading-relaxed ${isFeatured ? "text-neutral-400" : "text-neutral-600"}`}>
        {app.hub_tagline || app.tagline}
      </p>

      <div className="mt-auto pt-10 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-2 text-sm font-semibold group-hover:gap-3 transition-all ${isFeatured ? "" : "text-neutral-500 group-hover:text-white"}`}
          style={isFeatured ? { color: accent } : undefined}
        >
          {isLive
            ? (externalHref ? `Open ${app.name}` : `Explore ${app.name}`)
            : isPreview ? "See the preview" : "Read more"} <ArrowUpRight size={16} />
        </span>
      </div>

      {/* Corner marks */}
      <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t border-l border-neutral-600" />
      <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t border-r border-neutral-600" />
      <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b border-l border-neutral-600" />
      <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b border-r border-neutral-600" />
    </>
  );
  const base = `group relative bg-[#0A0A0A] p-8 md:p-10 flex flex-col min-h-[420px] transition-all duration-500 border border-[#262626]`;
  const featuredHover = {
    onMouseEnter: (e) => {
      e.currentTarget.style.borderColor = accent;
      e.currentTarget.style.boxShadow = `0 0 80px -20px ${glowRgba}`;
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.borderColor = "";
      e.currentTarget.style.boxShadow = "";
    },
  };
  if (isFeatured) {
    if (externalHref) {
      return (
        <motion.div variants={fadeUp} className="col-span-12 lg:col-span-6">
          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`app-card-${app.id}`}
            className={`${base} hover:-translate-y-1`}
            {...featuredHover}
          >
            {Body}
          </a>
        </motion.div>
      );
    }
    return (
      <motion.div variants={fadeUp} className="col-span-12 lg:col-span-6">
        <Link
          to={`/apps/${app.id}`}
          data-testid={`app-card-${app.id}`}
          className={`${base} hover:-translate-y-1`}
          {...featuredHover}
        >
          {Body}
        </Link>
      </motion.div>
    );
  }
  return (
    <motion.div variants={fadeUp} className="col-span-12 sm:col-span-6 lg:col-span-2">
      <Link
        to={`/apps/${app.id}`}
        data-testid={`app-card-${app.id}`}
        className={`${base} border-dashed border-neutral-800 hover:border-neutral-600 hover:-translate-y-0.5`}
      >
        {Body}
      </Link>
    </motion.div>
  );
}

function AppsSection() {
  return (
    <section
      id="apps"
      data-testid="landing-apps"
      className="relative bg-[#0A0A0A] py-24 md:py-32 lg:py-40 border-t border-[#262626]"
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
        >
          <motion.div variants={fadeUp} className="flex items-center gap-3 mb-8">
            <span className="w-8 h-px bg-[#00E5FF]" />
            <span className="label-mono text-[#00E5FF]">// THE STUDIO</span>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            className="font-serif-editorial text-white text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tighter max-w-4xl"
          >
            Four apps. <em className="italic text-neutral-500">One at a time.</em>
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 max-w-2xl text-neutral-400 text-lg">
            Every Gonzo Labs app solves one hard problem for one specific operator.
            No suite tax. No feature bloat. Buy what you need, keep it forever.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-16 grid grid-cols-12 gap-4"
        >
          {APPS.map((a) => <AppCard key={a.id} app={a} />)}
        </motion.div>
      </div>
    </section>
  );
}

// =====================================================================
// PRICING TEASE
// =====================================================================
function PricingSection() {
  const tiers = [
    { name: "Free", price: "$0", per: "forever", data: ["1 project", "5 AI uploads / mo", "2D CAD + 3D render"], cta: "Start free", primary: false },
    { name: "Pro", price: "$49", per: "/mo · 7-day trial", data: ["Unlimited projects", "100 AI uploads / mo", "Watermark-free exports", "Priority AI"], cta: "Start Pro trial", primary: true },
    { name: "Studio", price: "$149", per: "/mo", data: ["Everything in Pro", "Unlimited AI uploads", "Unlimited Pay Apps", "White-label branding"], cta: "Go Studio", primary: false },
  ];
  return (
    <section
      id="pricing"
      data-testid="landing-pricing"
      className="relative bg-[#0A0A0A] py-24 md:py-32 lg:py-40 border-t border-[#262626]"
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          <motion.div variants={fadeUp} className="flex items-baseline justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="w-8 h-px bg-[#FFCC00]" />
                <span className="label-mono text-[#FFCC00]">// PRICING</span>
              </div>
              <h2 className="font-serif-editorial text-white text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tighter">
                No contracts.<br />No calls.
              </h2>
            </div>
            <p className="max-w-md text-neutral-400 text-lg">
              Every tier includes the 3D renderer, CAD editor, and blueprint AI. Upgrade for volume + branding + unlocked exports.
            </p>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-px bg-[#262626] border border-[#262626]">
            {tiers.map((t) => (
              <div
                key={t.name}
                data-testid={`pricing-tier-${t.name.toLowerCase()}`}
                className={`bg-[#0A0A0A] p-8 md:p-10 flex flex-col ${t.primary ? "ring-1 ring-[#FFCC00]" : ""}`}
              >
                <div className="label-mono text-[#00E5FF]">// {t.name.toUpperCase()}</div>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-serif-editorial text-white text-6xl">{t.price}</span>
                  <span className="text-neutral-500 text-sm">{t.per}</span>
                </div>
                <ul className="mt-8 space-y-2 text-sm text-neutral-300 flex-1">
                  {t.data.map((d) => (
                    <li key={d} className="flex items-baseline gap-3">
                      <span className="text-[#FFCC00]">·</span> {d}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/signin?mode=register"
                  data-testid={`pricing-cta-${t.name.toLowerCase()}`}
                  className={`mt-8 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-all ${
                    t.primary
                      ? "bg-[#FFCC00] text-black hover:bg-[#E6B800] hover:-translate-y-0.5"
                      : "border border-neutral-700 text-white hover:bg-neutral-900 hover:border-neutral-500"
                  }`}
                >
                  {t.cta} <ArrowUpRight size={14} />
                </Link>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// =====================================================================
// FOOTER
// =====================================================================
function MailIcon({ size = 18 }) {
  return <Mail size={size} strokeWidth={2} aria-hidden="true" />;
}

function Footer() {
  return (
    <footer
      data-testid="landing-footer"
      className="relative bg-black border-t border-[#262626] pt-24 pb-12 overflow-hidden"
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        {/* Contact strip — the primary "get in touch" surface. Big, obvious, one-click. */}
        <div
          id="contact"
          data-testid="landing-contact-section"
          className="border border-[#262626] hover:border-[#FFCC00]/50 transition-colors p-8 md:p-10 mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6"
        >
          <div>
            <div className="label-mono text-[#FFCC00] mb-3">// CONTACT</div>
            <h3 className="font-serif-editorial text-white text-4xl md:text-5xl leading-[0.95] tracking-tight">
              Get in touch.
              <br /><em className="italic text-neutral-500">We read every email.</em>
            </h3>
            <p className="mt-4 text-neutral-400 max-w-xl text-sm md:text-base">
              Feature requests, bug reports, custom-tier quotes, partnership pitches — all welcome.
              Fastest way to reach the studio:
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 md:shrink-0">
            <a
              href={CONTACT_MAILTO}
              data-testid="landing-contact-email-link"
              className="group inline-flex items-center gap-2 bg-[#FFCC00] hover:bg-[#E6B800] text-black font-mono font-bold px-6 py-4 transition-all hover:-translate-y-0.5"
            >
              <MailIcon />
              <span data-testid="landing-contact-email">{CONTACT_EMAIL}</span>
            </a>
            <a
              href={mailtoWithSubject("Atlas — Feature request")}
              data-testid="landing-contact-feature-link"
              className="text-xs font-mono text-neutral-400 hover:text-white underline underline-offset-4"
            >Suggest a feature →</a>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 md:gap-6 border-b border-[#262626] pb-16">
          <div className="md:col-span-2">
            <div className="label-mono text-[#00E5FF]">// STUDIO</div>
            <div className="font-serif-editorial text-white text-4xl mt-4">Gonzo Labs</div>
            <p className="mt-4 text-neutral-400 max-w-md">
              A studio building software for the trades, the shops, and the makers.
              Contact us — we like hearing what you&apos;re stuck on.
            </p>
            <a
              href={CONTACT_MAILTO}
              className="mt-4 inline-flex items-center gap-2 text-sm font-mono text-[#FFCC00] hover:text-white transition-colors"
            >
              <MailIcon size={14} />{CONTACT_EMAIL}
            </a>
          </div>
          <div>
            <div className="label-mono mb-4">// STUDIO</div>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li><a href="#apps" className="hover:text-white transition-colors">All apps</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Atlas features</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
              <li><a href="#contact" className="hover:text-white transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <div className="label-mono mb-4">// LEGAL</div>
            <ul className="space-y-2 text-sm text-neutral-400">
              <li><Link to="/terms" className="hover:text-white transition-colors">Terms</Link></li>
              <li><Link to="/privacy" className="hover:text-white transition-colors">Privacy</Link></li>
              <li><Link to="/signin" className="hover:text-white transition-colors">Sign in</Link></li>
            </ul>
          </div>
        </div>

        {/* Massive brandmark */}
        <div className="pt-16 pb-4 select-none">
          <div className="font-serif-editorial text-white leading-none tracking-tighter text-[16vw] md:text-[15vw]">
            GONZO
          </div>
          <div className="flex items-baseline justify-between">
            <div className="font-serif-editorial text-[#FFCC00] italic leading-none tracking-tighter text-[16vw] md:text-[15vw]">
              LABS.
            </div>
            <div className="hidden md:block label-mono text-neutral-600 pb-6">
              // MMXXVI · A STUDIO OF TOOLS
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between text-xs text-neutral-500 font-mono">
          <div>© 2026 Gonzo Labs. All rights reserved.</div>
          <div>Made in the studio.</div>
        </div>
      </div>
    </footer>
  );
}

// =====================================================================
// PAGE
// =====================================================================
export default function Landing() {
  const token = useStore((s) => s.token);
  return (
    <div
      data-testid="landing-page"
      className="min-h-screen bg-[#0A0A0A] text-white antialiased"
      style={{ fontFamily: "Inter, IBM Plex Sans, system-ui, sans-serif" }}
    >
      <Nav token={token} />
      <Hero token={token} />
      <FeaturesSection />
      <AppsSection />
      <PricingSection />
      <Footer />
    </div>
  );
}
