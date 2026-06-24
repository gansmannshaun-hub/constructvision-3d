/**
 * Public Privacy page (no auth required) — viewable at /privacy.
 */
import React from "react";
import { Link } from "react-router-dom";
import LegalRenderer from "../components/LegalRenderer";
import { PRIVACY_POLICY } from "../legal/documents";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link to="/" className="label-mono text-[#FFCC00]">← ATLAS</Link>
        <div className="text-[10px] font-mono text-neutral-500">
          v{PRIVACY_POLICY.version} · {PRIVACY_POLICY.lastUpdated}
        </div>
      </header>
      <main data-testid="privacy-public-body" className="max-w-4xl mx-auto px-6 py-8">
        <LegalRenderer markdown={PRIVACY_POLICY.body} />
      </main>
    </div>
  );
}
