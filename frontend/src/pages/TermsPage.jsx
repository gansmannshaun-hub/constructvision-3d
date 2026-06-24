/**
 * Public Terms page (no auth required) — same content, viewable at /terms.
 */
import React from "react";
import { Link } from "react-router-dom";
import LegalRenderer from "../components/LegalRenderer";
import { TERMS_OF_SERVICE } from "../legal/documents";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link to="/" className="label-mono text-[#FFCC00]">← ATLAS</Link>
        <div className="text-[10px] font-mono text-neutral-500">
          v{TERMS_OF_SERVICE.version} · {TERMS_OF_SERVICE.lastUpdated}
        </div>
      </header>
      <main data-testid="terms-public-body" className="max-w-4xl mx-auto px-6 py-8">
        <LegalRenderer markdown={TERMS_OF_SERVICE.body} />
      </main>
    </div>
  );
}
