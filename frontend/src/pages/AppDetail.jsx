import React, { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowLeft, Mail, Check } from "lucide-react";
import { useStore, apiClient } from "@/store";
import { getApp, APPS } from "@/data/apps";
import { CONTACT_EMAIL, CONTACT_MAILTO, mailtoWithSubject } from "@/data/brand";
import MockAtlasBlueprint from "@/components/landing/MockAtlasBlueprint";
import { AppScreenshot } from "@/components/landing/AppScreenshot";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};

// =====================================================================
// SHARED NAV — matches Landing's aesthetic
// =====================================================================
function Nav({ token }) {
  return (
    <header data-testid="app-detail-nav" className="fixed top-0 inset-x-0 z-50 backdrop-blur-xl bg-[#0A0A0A]/85 border-b border-[#262626]">
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 flex items-center justify-between h-16">
        <Link to="/" data-testid="app-detail-brand" className="flex items-center gap-3">
          <div className="w-7 h-7 bg-[#FFCC00] flex items-center justify-center font-display text-black text-lg leading-none">G</div>
          <div className="leading-none">
            <div className="font-display text-white text-base tracking-tight">GONZO LABS</div>
            <div className="label-mono text-[9px] mt-0.5">// A STUDIO OF TOOLS</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-neutral-400">
          <Link to="/#apps" className="hover:text-white transition-colors">All apps</Link>
          <Link to="/#pricing" className="hover:text-white transition-colors">Pricing</Link>
        </nav>
        <div className="flex items-center gap-3">
          {token ? (
            <Link to="/app" data-testid="app-detail-nav-enter" className="inline-flex items-center gap-2 bg-[#FFCC00] text-black font-semibold text-sm px-4 py-2 hover:bg-[#E6B800] transition-colors">
              Enter Atlas <ArrowUpRight size={14} />
            </Link>
          ) : (
            <>
              <Link to="/signin" className="hidden sm:block text-sm text-neutral-300 hover:text-white transition-colors">Sign in</Link>
              <Link to="/signin?mode=register" className="bg-[#FFCC00] text-black font-semibold text-sm px-4 py-2 hover:bg-[#E6B800] transition-colors">Try free</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// Smart CTA — external URLs (http/https) render as `<a target="_blank">`;
// hash anchors and internal paths use `<Link>` / `<a href>`.
function CtaButton({ to, className, style, dataTestId, children }) {
  const isExternal = /^https?:\/\//i.test(to);
  const isHash = to?.startsWith("#");
  if (isExternal) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={dataTestId}
        className={className}
        style={style}
      >
        {children}
      </a>
    );
  }
  if (isHash) {
    return (
      <a href={to} data-testid={dataTestId} className={className} style={style}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} data-testid={dataTestId} className={className} style={style}>
      {children}
    </Link>
  );
}

// =====================================================================
// FEATURE DETAIL — used for both LIVE (Atlas) and PREVIEW (waitlist) apps.
// The only differences: accent color, chapter visuals, and CTA behavior.
// Preview apps swap the primary CTA for an inline waitlist email form.
// =====================================================================
function FeatureDetail({ app }) {
  const d = app.detail;
  const accent = app.accent || "#FFCC00";
  const isPreview = app.status === "preview";
  return (
    <>
      {/* HERO */}
      <section data-testid="app-detail-hero" className="relative pt-32 pb-20 md:pb-28 border-b border-[#262626]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
          <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-end">
            <div className="lg:col-span-7">
              <motion.div variants={fadeUp} className="flex items-center gap-3 mb-8">
                <Link to="/#apps" className="inline-flex items-center gap-2 label-mono text-[#00E5FF] hover:text-white transition-colors">
                  <ArrowLeft size={12} /> ALL APPS
                </Link>
                <span className="text-neutral-700">·</span>
                <span className="label-mono" style={{ color: accent }}>{d.role}</span>
              </motion.div>
              <motion.div
                variants={fadeUp}
                className="font-serif-editorial text-6xl md:text-8xl leading-none tracking-tighter"
                style={{ color: accent }}
              >
                {app.name}.
              </motion.div>
              <motion.h1 variants={fadeUp} className="mt-6 font-serif-editorial text-white text-3xl md:text-5xl lg:text-6xl leading-[1.02] tracking-tight max-w-3xl">
                {d.headline}
              </motion.h1>
              <motion.p variants={fadeUp} className="mt-8 max-w-2xl text-neutral-400 text-lg leading-relaxed">
                {d.lede}
              </motion.p>
              <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-4">
                <CtaButton
                  to={d.cta_primary.to}
                  dataTestId="app-detail-primary-cta"
                  className="group inline-flex items-center gap-3 text-black font-semibold px-6 py-3.5 hover:-translate-y-0.5 transition-all duration-300"
                  style={{ backgroundColor: accent }}
                >
                  {d.cta_primary.label}
                  <ArrowUpRight size={18} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                </CtaButton>
                <Link
                  to={d.cta_secondary.to}
                  data-testid="app-detail-secondary-cta"
                  className="inline-flex items-center gap-3 border border-neutral-700 text-white px-6 py-3.5 hover:bg-neutral-900 hover:border-neutral-500 transition-all"
                >
                  {d.cta_secondary.label}
                </Link>
              </motion.div>
            </div>
            <motion.ul variants={fadeUp} className="lg:col-span-5 grid grid-cols-1 gap-px bg-[#262626] border border-[#262626]">
              {d.hero_bullets.map((b, i) => (
                <li key={`hb-${b}`} className="bg-[#0A0A0A] p-4 flex items-start gap-3">
                  <span className="label-mono text-[#00E5FF] mt-1 shrink-0">// {String(i + 1).padStart(2, "0")}</span>
                  <span className="text-neutral-200 text-sm">{b}</span>
                </li>
              ))}
            </motion.ul>
          </motion.div>
        </div>
      </section>

      {/* STATS */}
      <section data-testid="app-detail-stats" className="border-b border-[#262626]">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[#262626] border border-[#262626]">
            {d.stats.map((s, i) => (
              <div key={`st-${s.k}`} className="bg-[#0A0A0A] p-6">
                <div className="label-mono text-[#00E5FF]">// 0{i + 1}</div>
                <div className="text-neutral-500 text-xs uppercase tracking-widest mt-2">{s.k}</div>
                <div className="font-serif-editorial text-white text-4xl mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHAPTERS — alternating narrative */}
      <section data-testid="app-detail-chapters" className="py-24 md:py-32">
        <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16 space-y-24 md:space-y-32">
          {d.chapters.map((c, i) => (
            <ChapterRow key={c.n} chapter={c} i={i} app={app} accent={accent} />
          ))}
        </div>
      </section>

      {/* PREVIEW-ONLY WAITLIST · LIVE-ONLY FINAL CTA */}
      {isPreview ? (
        <WaitlistSection app={app} accent={accent} />
      ) : (
        <section data-testid="app-detail-cta-strip" className="border-t border-[#262626] py-24 md:py-32">
          <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-8">
              <div>
                <div className="flex items-center gap-3 mb-6">
                  <span className="w-8 h-px" style={{ backgroundColor: accent }} />
                  <span className="label-mono" style={{ color: accent }}>// READY WHEN YOU ARE</span>
                </div>
                <h2 className="font-serif-editorial text-white text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tighter max-w-3xl">
                  {d.cta_footline ? (
                    <>{d.cta_footline.top}<br /><em className="italic text-neutral-500">{d.cta_footline.bottom}</em></>
                  ) : (
                    <>Start with a blueprint.<br /><em className="italic text-neutral-500">See the building in a minute.</em></>
                  )}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-4 md:shrink-0">
                <CtaButton
                  to={d.cta_primary.to}
                  dataTestId="app-detail-footer-cta"
                  className="group inline-flex items-center gap-3 text-black font-semibold px-8 py-4 hover:-translate-y-0.5 transition-all"
                  style={{ backgroundColor: accent }}
                >
                  {d.cta_primary.label}
                  <ArrowUpRight size={18} />
                </CtaButton>
                <Link to="/#pricing" className="text-sm text-neutral-400 hover:text-white transition-colors underline underline-offset-4">See pricing</Link>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

// Back-compat alias — some places may still reference LiveDetail.
const LiveDetail = FeatureDetail;

function ChapterRow({ chapter, i, app, accent = "#FFCC00" }) {
  const flipped = i % 2 === 1;
  return (
    <motion.div
      data-testid={`app-detail-chapter-${chapter.n}`}
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      className={`grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center ${flipped ? "lg:[direction:rtl]" : ""}`}
    >
      <motion.div variants={fadeUp} className="lg:col-span-6 lg:[direction:ltr]">
        <div className="flex items-center gap-4 mb-6">
          <div className="font-serif-editorial text-6xl leading-none" style={{ color: accent }}>{chapter.n}</div>
          <div>
            <div className="label-mono text-[#00E5FF]">{chapter.tag}</div>
          </div>
        </div>
        <h3 className="font-serif-editorial text-white text-4xl md:text-5xl leading-tight tracking-tight max-w-xl">
          {chapter.title}
        </h3>
        <p className="mt-6 text-neutral-400 text-lg leading-relaxed max-w-xl">{chapter.body}</p>
      </motion.div>
      <motion.div variants={fadeUp} className="lg:col-span-6 lg:[direction:ltr] aspect-[4/3] border border-[#262626] overflow-hidden bg-[#141414] relative">
        <ChapterVisual n={chapter.n} appId={app?.id} status={app?.status} accent={accent} chapter={chapter} />
        <div className="pointer-events-none absolute top-3 left-3 w-4 h-4 border-t border-l" style={{ borderColor: accent }} />
        <div className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t border-r" style={{ borderColor: accent }} />
        <div className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b border-l" style={{ borderColor: accent }} />
        <div className="pointer-events-none absolute bottom-3 right-3 w-4 h-4 border-b border-r" style={{ borderColor: accent }} />
      </motion.div>
    </motion.div>
  );
}

function ChapterVisual({ n, appId, status, accent = "#FFCC00", chapter }) {
  // Atlas has real UI screenshots; other apps get a stylised typographic
  // placeholder built from the chapter's own tag + title so each panel
  // still feels intentional (not "coming soon").
  if (appId === "atlas") {
    if (n === "01") return <AppScreenshot src="/screenshots/atlas-blueprint.jpg" alt="Atlas — Live Blueprint" caption="// ATLAS · BLUEPRINT · AI-TRACED" />;
    if (n === "02") return <AppScreenshot src="/screenshots/atlas-cad.jpg" alt="Atlas — 2D CAD Editor" caption="// ATLAS · 2D CAD EDITOR" crop="center" />;
    if (n === "03") return <AppScreenshot src="/screenshots/atlas-3d.jpg" alt="Atlas — 3D Renderer" caption="// ATLAS · 3D RENDERER" crop="center" />;
    if (n === "04") return <MockAtlasBlueprint variant="map" />;
    if (n === "05") return <AppScreenshot src="/screenshots/atlas-payapps.jpg" alt="Atlas — Pay Apps" caption="// ATLAS · PAY APPS · AIA G702" />;
    if (n === "06") return <AppScreenshot src="/screenshots/atlas-field.jpg" alt="Atlas — Field logs" caption="// ATLAS · FIELD · DAILY LOG" />;
    if (n === "07") return <CollabLarge />;
    return null;
  }
  return <PreviewPanel accent={accent} chapter={chapter} status={status} />;
}

// Editorial placeholder used for apps that don't yet have real product
// screenshots. Renders the chapter number as an oversized display glyph
// plus a grid + accent flare. Caption adapts to the app's status so live
// apps don't say "not yet shipped".
function PreviewPanel({ accent, chapter, status = "preview" }) {
  const caption = status === "live" ? "Studio · Chapter" : status === "soon" ? "Coming · Later" : "Concept · Not yet shipped";
  return (
    <div className="w-full h-full relative overflow-hidden bg-[#0A0A0A]">
      {/* dot grid */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle, ${accent}22 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />
      {/* corner brackets already drawn by parent */}
      <div className="absolute inset-0 flex flex-col justify-between p-8">
        <div className="flex justify-between items-baseline">
          <div className="label-mono" style={{ color: accent }}>{chapter?.tag || "// PREVIEW"}</div>
          <div className="label-mono text-neutral-600">EDITORIAL</div>
        </div>
        <div className="flex items-end justify-between gap-6">
          <div
            className="font-serif-editorial leading-none tracking-tighter text-[24vw] md:text-[16vw] lg:text-[12vw]"
            style={{ color: accent, opacity: 0.85 }}
          >
            {chapter?.n || "00"}
          </div>
          <div className="pb-4 text-right max-w-[55%]">
            <div className="text-white font-serif-editorial text-2xl md:text-3xl leading-tight">
              {chapter?.title || "In preview."}
            </div>
            <div className="mt-2 text-neutral-500 text-xs font-mono uppercase tracking-widest">{caption}</div>
          </div>
        </div>
      </div>
      {/* diagonal accent line */}
      <div
        className="absolute -bottom-8 -right-8 w-40 h-40 rotate-45"
        style={{ backgroundColor: accent, opacity: 0.06 }}
      />
    </div>
  );
}

function WaitlistSection({ app, accent }) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const onSubmit = async (e) => {
    e.preventDefault();
    if (!email.includes("@")) { setErr("Enter a valid email"); return; }
    setBusy(true); setErr("");
    try {
      await apiClient.post("/waitlist/join", { email, app_id: app.id });
      setSubmitted(true);
    } catch (ex) {
      setErr(ex?.response?.data?.detail || "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      id="waitlist"
      data-testid="app-detail-waitlist"
      className="relative border-t border-[#262626] py-24 md:py-32 bg-[#0A0A0A] overflow-hidden"
    >
      {/* accent flare */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(600px 300px at 50% 0%, ${accent}12, transparent 70%)` }}
      />
      <div className="relative w-full max-w-3xl mx-auto px-6 md:px-12 lg:px-16 text-center">
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className="w-8 h-px" style={{ backgroundColor: accent }} />
          <span className="label-mono" style={{ color: accent }}>// STILL IN THE STUDIO</span>
          <span className="w-8 h-px" style={{ backgroundColor: accent }} />
        </div>
        <h2 className="font-serif-editorial text-white text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tighter">
          Get first-in-line access.
        </h2>
        <p className="mt-6 text-neutral-400 text-lg max-w-xl mx-auto leading-relaxed">
          {app.name} isn&apos;t deployed yet — but it&apos;s close. Leave your email and you&apos;ll be the first to know when it ships. No newsletter. No spam. One message.
        </p>
        {submitted ? (
          <div
            data-testid="waitlist-success"
            className="mt-12 inline-flex items-center gap-3 px-6 py-4 border text-sm font-mono uppercase tracking-widest"
            style={{ borderColor: `${accent}66`, color: accent, backgroundColor: `${accent}0d` }}
          >
            <Check size={16} />
            On the list · you&apos;ll hear from us
          </div>
        ) : (
          <form
            data-testid="waitlist-form"
            onSubmit={onSubmit}
            className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto"
          >
            <div className="relative flex-1 w-full">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                data-testid="waitlist-email"
                type="email"
                required
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(""); }}
                placeholder="you@firm.com"
                className="w-full bg-[#141414] border border-[#262626] pl-9 pr-4 py-3 text-sm text-white font-mono placeholder:text-neutral-600 focus:outline-none"
                style={{ borderColor: err ? "#ef4444" : undefined }}
                onFocus={(e) => { e.target.style.borderColor = accent; }}
                onBlur={(e) => { e.target.style.borderColor = err ? "#ef4444" : ""; }}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              data-testid="waitlist-submit"
              className="w-full sm:w-auto text-black font-semibold px-6 py-3 hover:-translate-y-0.5 transition-transform disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {busy ? "Sending…" : "Notify me"}
            </button>
          </form>
        )}
        {err && !submitted && (
          <div data-testid="waitlist-error" className="mt-4 text-red-400 text-sm font-mono">{err}</div>
        )}
        <div className="mt-14 flex items-center justify-center gap-6 text-xs font-mono text-neutral-600">
          <span>// WHILE YOU WAIT</span>
          <Link to="/apps/atlas" className="hover:text-white transition-colors underline underline-offset-4">Try Atlas</Link>
          <Link to="/#apps" className="hover:text-white transition-colors underline underline-offset-4">See the studio</Link>
        </div>
      </div>
    </section>
  );
}

function CollabLarge() {
  const activity = [
    { u: "L. Choi",   a: "edited",   t: "electrical rough-in · added 8 outlets on floor 1", when: "2m" },
    { u: "M. Reyes",  a: "commented", t: "'let's flip the pitch to 5:12'", when: "9m" },
    { u: "K. Iyer",   a: "saved bid v3", t: "$412,880 total (+2.1%)", when: "24m" },
    { u: "S. Ortega", a: "uploaded",  t: "photo · foundation stripped", when: "56m" },
    { u: "Client",    a: "viewed",    t: "/share/ac97... · read-only portal", when: "1h" },
    { u: "L. Choi",   a: "invited",   t: "estimator@subsplumbing.com", when: "3h" },
  ];
  return (
    <div className="w-full h-full bg-[#0A0A0A] p-6">
      <div className="flex justify-between items-baseline">
        <div className="label-mono text-[#00E5FF]">// ACTIVITY FEED</div>
        <div className="label-mono text-[#FFCC00]">FILTER · ALL</div>
      </div>
      <ul className="mt-4 space-y-3">
        {activity.map((x, i) => (
          <li key={`act-${i}-${x.t}`} className="flex items-baseline gap-2 text-xs font-mono border-b border-[#1a1a1a] pb-2">
            <span className="w-1.5 h-1.5 bg-[#FFCC00] rounded-full mt-1 shrink-0" />
            <span className="text-white">{x.u}</span>
            <span className="text-neutral-500">{x.a}</span>
            <span className="text-neutral-300 flex-1">{x.t}</span>
            <span className="text-neutral-600 shrink-0">{x.when}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =====================================================================
// COMING SOON DETAIL — teaser page with "notify me" form
// =====================================================================
function SoonDetail({ app }) {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  return (
    <section data-testid="app-detail-soon" className="min-h-[calc(100vh-4rem)] flex items-center pt-32 pb-20">
      <div className="w-full max-w-4xl mx-auto px-6 md:px-12 text-center">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={fadeUp} className="flex items-center justify-center gap-3 mb-8">
            <Link to="/#apps" className="inline-flex items-center gap-2 label-mono text-[#00E5FF] hover:text-white transition-colors">
              <ArrowLeft size={12} /> ALL APPS
            </Link>
            <span className="text-neutral-700">·</span>
            <span className="label-mono text-[#FFCC00]">// SOON · APP {app.number}</span>
          </motion.div>
          <motion.div variants={fadeUp} className="font-serif-editorial text-neutral-700 text-[18vw] md:text-[14vw] leading-none tracking-tighter">
            {app.name}
          </motion.div>
          <motion.div variants={fadeUp} className="mt-6 label-mono text-neutral-500">{app.tag}</motion.div>
          <motion.p variants={fadeUp} className="mt-10 text-neutral-400 text-lg max-w-2xl mx-auto leading-relaxed">
            {app.tagline} We&apos;re still in the shop with this one. If it sounds like something you&apos;d use, drop your email — you&apos;ll be the first to know when it&apos;s ready.
          </motion.p>

          {submitted ? (
            <motion.div variants={fadeUp} data-testid="notify-success" className="mt-10 inline-flex items-center gap-2 px-6 py-4 border border-[#00E5FF]/40 bg-[#00E5FF]/5 text-[#00E5FF] text-sm font-mono uppercase tracking-widest">
              <span className="w-1.5 h-1.5 bg-[#00E5FF]" /> On the list · Thanks
            </motion.div>
          ) : (
            <motion.form
              variants={fadeUp}
              data-testid="notify-form"
              onSubmit={(e) => { e.preventDefault(); if (email.includes("@")) setSubmitted(true); }}
              className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto"
            >
              <div className="relative flex-1 w-full">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  data-testid="notify-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@firm.com"
                  className="w-full bg-[#141414] border border-[#262626] pl-9 pr-4 py-3 text-sm text-white font-mono placeholder:text-neutral-600 focus:border-[#FFCC00] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                data-testid="notify-submit"
                className="w-full sm:w-auto bg-[#FFCC00] text-black font-semibold px-6 py-3 hover:bg-[#E6B800] transition-colors"
              >
                Notify me
              </button>
            </motion.form>
          )}

          <motion.div variants={fadeUp} className="mt-14 flex items-center justify-center gap-6 text-xs font-mono text-neutral-600">
            <span>// WHILE YOU WAIT</span>
            <Link to="/apps/atlas" className="hover:text-white transition-colors underline underline-offset-4">Try Atlas</Link>
            <Link to="/#apps" className="hover:text-white transition-colors underline underline-offset-4">See the studio</Link>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// =====================================================================
// PAGE
// =====================================================================
export default function AppDetail() {
  const { id } = useParams();
  const token = useStore((s) => s.token);
  const app = getApp(id);
  if (!app) return <Navigate to="/#apps" replace />;
  return (
    <div
      data-testid={`app-detail-${app.id}`}
      className="min-h-screen bg-[#0A0A0A] text-white antialiased"
      style={{ fontFamily: "Inter, IBM Plex Sans, system-ui, sans-serif" }}
    >
      <Nav token={token} />
      {(app.status === "live" || app.status === "preview") ? (
        <FeatureDetail app={app} />
      ) : (
        <SoonDetail app={app} />
      )}
      <RelatedApps currentId={app.id} />
      <AppFooter app={app} />
    </div>
  );
}

function AppFooter({ app }) {
  return (
    <footer
      data-testid={`app-detail-footer-${app.id}`}
      className="border-t border-[#262626] bg-black py-16"
    >
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        <div
          id="contact"
          data-testid="app-detail-contact-section"
          className="border border-[#262626] hover:border-[#FFCC00]/50 transition-colors p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10"
        >
          <div>
            <div className="label-mono text-[#FFCC00] mb-2">// CONTACT</div>
            <h3 className="font-serif-editorial text-white text-3xl md:text-4xl leading-tight">
              Questions about {app.name}? <em className="italic text-neutral-500">Email us.</em>
            </h3>
          </div>
          <a
            href={mailtoWithSubject(`${app.name} — Question`)}
            data-testid={`app-detail-contact-email-${app.id}`}
            className="inline-flex items-center gap-2 bg-[#FFCC00] hover:bg-[#E6B800] text-black font-mono font-bold px-6 py-3 transition-all hover:-translate-y-0.5 md:shrink-0"
          >
            <Mail size={16} />
            <span>{CONTACT_EMAIL}</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center justify-between text-xs font-mono text-neutral-500 gap-4">
          <div>© 2026 Gonzo Labs. All rights reserved.</div>
          <div className="flex items-center gap-6">
            <Link to="/" className="hover:text-white">Studio</Link>
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <a href={CONTACT_MAILTO} className="hover:text-[#FFCC00]">{CONTACT_EMAIL}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function RelatedApps({ currentId }) {
  const others = APPS.filter((a) => a.id !== currentId).slice(0, 3);
  if (others.length === 0) return null;
  return (
    <section data-testid="app-detail-related" className="border-t border-[#262626] py-20 bg-black">
      <div className="w-full max-w-7xl mx-auto px-6 md:px-12 lg:px-16">
        <div className="flex items-center gap-3 mb-8">
          <span className="w-8 h-px bg-[#00E5FF]" />
          <span className="label-mono text-[#00E5FF]">// ALSO IN THE STUDIO</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {others.map((a) => (
            <Link
              key={a.id}
              to={`/apps/${a.id}`}
              data-testid={`app-detail-related-${a.id}`}
              className="group relative bg-[#0A0A0A] border border-[#262626] p-6 hover:border-[#FFCC00] transition-all hover:-translate-y-0.5"
            >
              <div className="flex items-baseline justify-between">
                <span className="label-mono text-[#00E5FF]">// {a.number}</span>
                <span className={`label-mono ${a.status === "live" ? "text-[#FFCC00]" : a.status === "preview" ? "text-[#00E5FF]" : "text-neutral-600"}`}>
                  {a.status === "live" ? "· LIVE ·" : a.status === "preview" ? "· PREVIEW ·" : "· SOON ·"}
                </span>
              </div>
              <div className={`font-serif-editorial mt-4 leading-none ${a.status === "soon" ? "text-neutral-700 text-3xl" : "text-white text-4xl"}`}>{a.name}</div>
              <div className={`mt-2 text-sm ${a.status === "soon" ? "text-neutral-600" : "text-neutral-400"}`}>{a.hub_tagline || a.tagline}</div>
              <div className="mt-6 inline-flex items-center gap-2 text-xs font-mono text-neutral-400 group-hover:text-[#FFCC00] transition-colors">
                Read <ArrowUpRight size={12} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
