import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { apiClient, useStore } from "../store";

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const TIER_LABEL = { free: "FREE", pro: "PRO", studio: "STUDIO" };
const STATUS_LABEL = {
  free: "Free Tier",
  trialing: "Trial",
  active: "Active",
  expired: "Expired",
};

export default function Billing() {
  const navigate = useNavigate();
  const { token, user } = useStore();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!token) {
      navigate("/");
      return;
    }
    refresh();
    // eslint-disable-next-line
  }, [token]);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/billing/me");
      setData(data);
    } finally {
      setLoading(false);
    }
  };

  // Handle return from Stripe checkout
  useEffect(() => {
    const sid = params.get("session_id");
    const canceled = params.get("canceled");
    if (canceled) {
      setMsg({ kind: "info", text: "Checkout canceled. No charges were made." });
      params.delete("canceled");
      setParams(params, { replace: true });
      return;
    }
    if (!sid) return;
    pollStatus(sid);
    // eslint-disable-next-line
  }, []);

  const pollStatus = async (sessionId, attempt = 0) => {
    if (attempt >= 6) {
      setMsg({ kind: "info", text: "Still processing — refresh in a moment." });
      params.delete("session_id");
      setParams(params, { replace: true });
      return;
    }
    setMsg({ kind: "info", text: "Confirming payment…" });
    try {
      const { data } = await apiClient.get(`/billing/checkout/status/${sessionId}`);
      if (data.payment_status === "paid") {
        setMsg({ kind: "success", text: "Payment confirmed — entitlements applied!" });
        params.delete("session_id");
        setParams(params, { replace: true });
        await refresh();
        return;
      }
      if (data.status === "expired" || data.payment_status === "failed") {
        setMsg({ kind: "error", text: "Payment failed or expired. Please try again." });
        params.delete("session_id");
        setParams(params, { replace: true });
        return;
      }
      // Still pending — retry
      setTimeout(() => pollStatus(sessionId, attempt + 1), 2000);
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Status check failed" });
    }
  };

  const startTrial = async () => {
    setBusy("trial");
    setMsg(null);
    try {
      await apiClient.post("/billing/start-trial", {});
      setMsg({ kind: "success", text: "7-day Pro trial activated — enjoy!" });
      await refresh();
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Could not start trial" });
    } finally {
      setBusy(null);
    }
  };

  const checkout = async (item) => {
    setBusy(item);
    setMsg(null);
    try {
      const { data } = await apiClient.post("/billing/checkout", {
        item,
        origin_url: window.location.origin,
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMsg({ kind: "error", text: "No checkout URL received." });
      }
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || "Checkout failed" });
    } finally {
      setBusy(null);
    }
  };

  const plan = data?.plan || "free";
  const sub = data?.subscription || {};
  const limits = data?.limits || {};
  const usage = data?.usage || {};
  const ent = data?.entitlements || {};

  const uploadsQuota = limits.ai_uploads_per_month;
  const uploadsUsed = usage.ai_uploads || 0;
  const uploadsPct = uploadsQuota === -1 ? 0 : Math.min(100, (uploadsUsed / Math.max(uploadsQuota, 1)) * 100);

  return (
    <div className="min-h-screen bg-[#0a0a0a]" data-testid="billing-page">
      <header className="border-b border-white/10 bg-black px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/app" className="flex items-center gap-3 hover:opacity-80 transition">
            <div className="w-8 h-8 bg-[#FFCC00] flex items-center justify-center">
              <span className="font-display text-black text-lg">A</span>
            </div>
            <div>
              <div className="font-display text-lg leading-none tracking-tighter">ATLAS</div>
              <div className="label-mono text-[9px] leading-none mt-1">BILLING</div>
            </div>
          </Link>
        </div>
        <Link
          to="/app"
          data-testid="billing-back"
          className="label-mono text-neutral-400 hover:text-white transition-colors"
        >
          ← BACK TO APP
        </Link>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {msg && (
          <div
            data-testid="billing-message"
            className={`mb-8 border px-4 py-3 text-sm font-mono ${
              msg.kind === "success"
                ? "border-[#00CC66]/40 bg-[#00CC66]/10 text-[#00CC66]"
                : msg.kind === "error"
                ? "border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666]"
                : "border-[#0055FF]/40 bg-[#0055FF]/10 text-[#5588FF]"
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Current plan card */}
        {loading ? (
          <div className="text-neutral-500 font-mono">Loading…</div>
        ) : (
          <>
            <section className="border border-white/10 mb-12">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 p-6 border-b border-white/10">
                <div>
                  <div className="label-mono mb-1">// CURRENT PLAN</div>
                  <div className="flex items-baseline gap-3">
                    <h1
                      data-testid="current-plan-label"
                      className={`font-display text-4xl tracking-tighter ${
                        plan === "free"
                          ? "text-neutral-300"
                          : plan === "pro"
                          ? "text-[#FFCC00]"
                          : "text-[#5588FF]"
                      }`}
                    >
                      {TIER_LABEL[plan]}
                    </h1>
                    <span className="label-mono">{STATUS_LABEL[sub.status] || sub.status}</span>
                  </div>
                  {sub.status === "trialing" && sub.trial_ends_at && (
                    <p className="text-neutral-400 text-sm mt-2">
                      Trial ends <b className="text-white">{fmtDate(sub.trial_ends_at)}</b>. Reverts
                      to Free unless you subscribe.
                    </p>
                  )}
                  {sub.status === "active" && sub.current_period_end && (
                    <p className="text-neutral-400 text-sm mt-2">
                      Renews <b className="text-white">{fmtDate(sub.current_period_end)}</b>.
                    </p>
                  )}
                  {sub.status === "free" && !sub.trial_used && (
                    <p className="text-neutral-400 text-sm mt-2">
                      You haven't used your free 7-day Pro trial yet.
                    </p>
                  )}
                </div>
                {sub.status === "free" && !sub.trial_used && (
                  <button
                    data-testid="start-trial-button"
                    onClick={startTrial}
                    disabled={busy === "trial"}
                    className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-6 py-3 uppercase tracking-wider text-sm disabled:opacity-60 self-center"
                  >
                    {busy === "trial" ? "Activating…" : "Start 7-Day Trial →"}
                  </button>
                )}
              </div>

              {/* Usage bars */}
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                <UsageCell
                  label="AI Uploads (this month)"
                  used={uploadsUsed}
                  limit={uploadsQuota}
                  pct={uploadsPct}
                  bonus={ent.bonus_credits}
                />
                <UsageCell
                  label="PDF Takeoffs"
                  used={usage.pdf_downloads || 0}
                  limit={limits.pdf_downloads_allowed ? -1 : 0}
                  pct={limits.pdf_downloads_allowed ? 0 : 100}
                />
                <UsageCell
                  label="Rush Credits"
                  used={0}
                  limit={ent.rush_credits || 0}
                  pct={0}
                  raw={`${ent.rush_credits || 0} available`}
                />
              </div>
            </section>

            {/* Subscription plans */}
            <div className="label-mono mb-3">// SUBSCRIPTION PLANS</div>
            <h2 className="font-display text-3xl tracking-tighter mb-8">Choose your tier.</h2>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-1 mb-16">
              <PlanCard
                tier="free"
                title="Free"
                price="$0"
                priceSub="forever"
                current={plan === "free"}
                features={[
                  "1 active project",
                  "5 AI uploads / month",
                  "2D blueprint view",
                  "3D renderer",
                  "Watermarked previews",
                  "No PDF takeoff",
                ]}
                ctaLabel="Current plan"
                ctaDisabled
              />
              <PlanCard
                tier="pro"
                title="Pro"
                price="$49"
                priceSub="/month"
                accent="#FFCC00"
                highlight={!sub.trial_used && plan === "free"}
                current={plan === "pro"}
                features={[
                  "Unlimited projects",
                  "100 AI uploads / month",
                  "Unlimited PDF takeoffs",
                  "Editable material pricing",
                  "Full 3D + CAD editor",
                  "7-day free trial",
                ]}
                ctaLabel={plan === "pro" ? (sub.status === "trialing" ? "Convert to Paid" : "Renew Pro") : "Upgrade to Pro"}
                ctaTestId="checkout-pro"
                busy={busy === "pro_monthly"}
                onClick={() => checkout("pro_monthly")}
              />
              <PlanCard
                tier="studio"
                title="Studio"
                price="$149"
                priceSub="/month"
                accent="#0055FF"
                current={plan === "studio"}
                features={[
                  "Everything in Pro",
                  "Unlimited AI uploads",
                  "Priority AI queue",
                  "Premium PDF branding",
                  "Multi-user (coming soon)",
                  "Concierge onboarding",
                ]}
                ctaLabel={plan === "studio" ? "Renew Studio" : "Upgrade to Studio"}
                ctaTestId="checkout-studio"
                busy={busy === "studio_monthly"}
                onClick={() => checkout("studio_monthly")}
              />
            </section>

            {/* Add-ons */}
            <div className="label-mono mb-3">// A-LA-CARTE ADD-ONS</div>
            <h2 className="font-display text-3xl tracking-tighter mb-8">One-time top-ups.</h2>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-1">
              <AddonCard
                title="+25 Upload Credits"
                price={9}
                description="Adds 25 bonus AI uploads to your account. Never expire."
                ctaTestId="checkout-uploads-25"
                busy={busy === "addon_uploads_25"}
                onClick={() => checkout("addon_uploads_25")}
              />
              <AddonCard
                title="Premium PDF Branding"
                price={19}
                description="Adds your name + email to every takeoff PDF header. One-time."
                accent="#FFCC00"
                badge={ent.pdf_premium_branding ? "✓ UNLOCKED" : null}
                ctaTestId="checkout-pdf-branding"
                busy={busy === "addon_pdf_branding"}
                onClick={() => checkout("addon_pdf_branding")}
                disabled={!!ent.pdf_premium_branding}
              />
              <AddonCard
                title="Rush Re-analysis"
                price={4}
                description="Skip the queue on your next upload — priority AI processing."
                ctaTestId="checkout-rush"
                busy={busy === "addon_rush"}
                onClick={() => checkout("addon_rush")}
              />
            </section>

            <p className="text-xs text-neutral-500 font-mono mt-12">
              All prices in USD. Payments processed by Stripe. Cancel anytime —
              you'll keep access until the end of your current billing period.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function UsageCell({ label, used, limit, pct, bonus, raw }) {
  return (
    <div className="p-6">
      <div className="label-mono mb-2">{label}</div>
      <div className="font-mono text-2xl mb-3">
        {raw ? (
          raw
        ) : (
          <>
            {used}
            <span className="text-neutral-500 text-sm ml-1">
              / {limit === -1 ? "∞" : limit}
            </span>
            {bonus > 0 && (
              <span className="text-[#FFCC00] text-sm ml-2">+{bonus} bonus</span>
            )}
          </>
        )}
      </div>
      {limit !== -1 && !raw && (
        <div className="h-1 bg-white/10">
          <div
            className="h-full bg-[#FFCC00] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function PlanCard({
  title,
  price,
  priceSub,
  features,
  ctaLabel,
  ctaDisabled,
  ctaTestId,
  current,
  highlight,
  accent = "#FFFFFF",
  busy,
  onClick,
}) {
  return (
    <article
      className={`border ${highlight ? "border-[#FFCC00]" : "border-white/10"} bg-[#141414] p-6 flex flex-col ${current ? "ring-1 ring-inset ring-white/20" : ""}`}
      data-testid={`plan-card-${title.toLowerCase()}`}
    >
      <div className="flex items-baseline justify-between mb-4">
        <div className="font-display text-2xl tracking-tighter" style={{ color: accent }}>
          {title}
        </div>
        {current && (
          <span className="label-mono bg-white/10 text-white px-2 py-0.5">CURRENT</span>
        )}
        {highlight && !current && (
          <span className="label-mono bg-[#FFCC00] text-black px-2 py-0.5">RECOMMENDED</span>
        )}
      </div>
      <div className="flex items-baseline gap-1 mb-6">
        <span className="font-display text-5xl tracking-tighter">{price}</span>
        <span className="text-neutral-500 text-sm">{priceSub}</span>
      </div>
      <ul className="space-y-2 mb-8 text-sm flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-neutral-300">
            <span className="text-[#FFCC00] mt-0.5">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <button
        data-testid={ctaTestId || `plan-cta-${title.toLowerCase()}`}
        onClick={onClick}
        disabled={ctaDisabled || busy}
        className={`w-full px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors ${
          ctaDisabled
            ? "bg-white/5 text-neutral-500 cursor-not-allowed"
            : title === "Pro"
            ? "bg-[#FFCC00] hover:bg-[#E6B800] text-black"
            : title === "Studio"
            ? "bg-[#0055FF] hover:bg-[#0044CC] text-white"
            : "bg-white/10 hover:bg-white/15 text-white"
        }`}
      >
        {busy ? "Loading…" : ctaLabel}
      </button>
    </article>
  );
}

function AddonCard({ title, price, description, ctaTestId, accent, badge, busy, onClick, disabled }) {
  return (
    <article
      className="border border-white/10 bg-[#141414] p-6 flex flex-col"
      data-testid={`addon-card-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display text-xl tracking-tighter" style={{ color: accent || "#FFFFFF" }}>
          {title}
        </div>
        {badge && <span className="label-mono bg-[#00CC66]/20 text-[#00CC66] border border-[#00CC66]/40 px-2 py-0.5">{badge}</span>}
      </div>
      <div className="font-mono text-3xl my-3">{fmtUSD(price)}</div>
      <p className="text-sm text-neutral-400 mb-6 flex-1 leading-relaxed">{description}</p>
      <button
        data-testid={ctaTestId}
        onClick={onClick}
        disabled={disabled || busy}
        className="w-full bg-white/10 hover:bg-white/15 disabled:bg-white/5 disabled:text-neutral-500 text-white px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors"
      >
        {busy ? "Loading…" : disabled ? "Already unlocked" : "Buy now →"}
      </button>
    </article>
  );
}
