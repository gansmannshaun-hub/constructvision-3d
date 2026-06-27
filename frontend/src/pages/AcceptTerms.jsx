/**
 * Post-registration / post-login Terms & Privacy gate.
 * Users CANNOT access /app, /billing, /settings, etc. until both are accepted.
 */
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, useStore } from "../store";
import LegalRenderer from "../components/LegalRenderer";
import {
  TERMS_OF_SERVICE, PRIVACY_POLICY,
  CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION,
} from "../legal/documents";

export default function AcceptTerms() {
  const navigate = useNavigate();
  const { token, user, setAuth, logout } = useStore();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [termsScrolled, setTermsScrolled] = useState(false);
  const [privacyScrolled, setPrivacyScrolled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const termsRef = useRef(null);
  const privacyRef = useRef(null);

  // Bounce back if already accepted or not signed in
  useEffect(() => {
    if (!token) { navigate("/"); return; }
    if (user && !user.needs_legal_acceptance) {
      navigate("/app", { replace: true });
    }
  }, [token, user, navigate]);

  // If a panel's content fits without scrolling, treat it as already-scrolled
  // (the onScroll handler will never fire on those screens). Also re-check on
  // window resize, since collapsing layouts can hide/show the scrollbar.
  useEffect(() => {
    const check = () => {
      const t = termsRef.current;
      const p = privacyRef.current;
      if (t && t.scrollHeight <= t.clientHeight + 8) setTermsScrolled(true);
      if (p && p.scrollHeight <= p.clientHeight + 8) setPrivacyScrolled(true);
    };
    // Run after first paint + on resize
    const id = setTimeout(check, 60);
    window.addEventListener("resize", check);
    return () => { clearTimeout(id); window.removeEventListener("resize", check); };
  }, []);

  const onTermsScroll = () => {
    const el = termsRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) {
      setTermsScrolled(true);
    }
  };

  const onPrivacyScroll = () => {
    const el = privacyRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 32) {
      setPrivacyScrolled(true);
    }
  };

  const canSubmit = agreedTerms && agreedPrivacy && termsScrolled && privacyScrolled && !submitting;

  const onAccept = async () => {
    setSubmitting(true);
    setError("");
    try {
      await apiClient.post("/legal/accept", {
        terms_version: CURRENT_TERMS_VERSION,
        privacy_version: CURRENT_PRIVACY_VERSION,
        agreed_terms: true,
        agreed_privacy: true,
      });
      // Refresh the user so the gate clears
      const { data } = await apiClient.get("/auth/me");
      setAuth(token, data);
      navigate("/app", { replace: true });
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to record acceptance");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="label-mono text-[#FFCC00]">// ATLAS · LEGAL</div>
          <h1 className="font-display text-2xl tracking-tighter mt-1">Before you continue</h1>
        </div>
        <button
          data-testid="legal-signout"
          onClick={() => { logout(); navigate("/"); }}
          className="label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5 text-xs"
        >SIGN OUT</button>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Terms */}
        <section className="border border-white/10 bg-black flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="label-mono text-[#FFCC00]">// TERMS OF SERVICE</div>
              <div className="text-[10px] font-mono text-neutral-500">v{TERMS_OF_SERVICE.version} · Updated {TERMS_OF_SERVICE.lastUpdated}</div>
            </div>
            {!termsScrolled && (
              <span data-testid="legal-terms-scroll-hint" className="label-mono text-[10px] text-neutral-500">scroll to read ↓</span>
            )}
          </div>
          <div
            data-testid="legal-terms-body"
            ref={termsRef}
            onScroll={onTermsScroll}
            className="flex-1 min-h-0 overflow-y-auto px-5 py-4 h-[420px]"
          >
            <LegalRenderer markdown={TERMS_OF_SERVICE.body} />
          </div>
          <label className={`flex items-start gap-3 px-5 py-3 border-t border-white/10 cursor-pointer select-none ${!termsScrolled ? "opacity-50" : ""}`}>
            <input
              data-testid="legal-terms-checkbox"
              type="checkbox"
              checked={agreedTerms}
              disabled={!termsScrolled}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              className="mt-0.5 accent-[#FFCC00] w-4 h-4 flex-shrink-0"
            />
            <span className="text-sm text-neutral-200">
              I have read and agree to the <strong>Terms of Service</strong> (v{TERMS_OF_SERVICE.version}).
            </span>
          </label>
        </section>

        {/* Privacy */}
        <section className="border border-white/10 bg-black flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="label-mono text-[#FFCC00]">// PRIVACY &amp; DATA USE</div>
              <div className="text-[10px] font-mono text-neutral-500">v{PRIVACY_POLICY.version} · Updated {PRIVACY_POLICY.lastUpdated}</div>
            </div>
            {!privacyScrolled && (
              <span data-testid="legal-privacy-scroll-hint" className="label-mono text-[10px] text-neutral-500">scroll to read ↓</span>
            )}
          </div>
          <div
            data-testid="legal-privacy-body"
            ref={privacyRef}
            onScroll={onPrivacyScroll}
            className="flex-1 min-h-0 overflow-y-auto px-5 py-4 h-[420px]"
          >
            <LegalRenderer markdown={PRIVACY_POLICY.body} />
          </div>
          <label className={`flex items-start gap-3 px-5 py-3 border-t border-white/10 cursor-pointer select-none ${!privacyScrolled ? "opacity-50" : ""}`}>
            <input
              data-testid="legal-privacy-checkbox"
              type="checkbox"
              checked={agreedPrivacy}
              disabled={!privacyScrolled}
              onChange={(e) => setAgreedPrivacy(e.target.checked)}
              className="mt-0.5 accent-[#FFCC00] w-4 h-4 flex-shrink-0"
            />
            <span className="text-sm text-neutral-200">
              I have read and agree to the <strong>Privacy &amp; Data Use Policy</strong> (v{PRIVACY_POLICY.version}).
            </span>
          </label>
        </section>
      </main>

      {error && (
        <div data-testid="legal-error" className="max-w-5xl w-full mx-auto px-6">
          <div className="border border-[#FF6666]/40 bg-[#FF6666]/10 text-[#FF8888] text-sm font-mono px-4 py-2 mb-4">
            {error}
          </div>
        </div>
      )}

      <footer className="border-t border-white/10 px-6 py-5 max-w-5xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="text-xs font-mono text-neutral-500">
          {(!termsScrolled || !privacyScrolled)
            ? "Please scroll to the bottom of both documents to enable the agreement checkboxes."
            : "Both documents reviewed. Tick both boxes to continue."}
        </div>
        <button
          data-testid="legal-accept"
          onClick={onAccept}
          disabled={!canSubmit}
          className="label-mono px-6 py-3 bg-[#FFCC00] hover:bg-[#E6B800] text-black disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "RECORDING ACCEPTANCE…" : "I AGREE & CONTINUE →"}
        </button>
      </footer>
    </div>
  );
}
