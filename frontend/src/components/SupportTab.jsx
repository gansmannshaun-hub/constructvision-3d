/**
 * Dashboard tab — full-height support chat for regular users.
 * For admins, it redirects to the admin inbox (or shows a hint).
 */
import React from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import SupportThread from "./SupportThread";

export default function SupportTab() {
  const { user } = useStore();
  const isAdmin = Boolean(user?.is_admin);

  if (isAdmin) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center">
        <div className="label-mono text-[#FFCC00] mb-3">// ADMIN VIEW</div>
        <div className="font-display text-2xl mb-4">You're logged in as admin.</div>
        <div className="text-neutral-400 font-mono text-sm mb-6 max-w-md">
          The dashboard tab is for end-users. Open the support inbox to see all
          conversations and reply.
        </div>
        <Link
          to="/admin/support"
          data-testid="support-tab-open-inbox"
          className="label-mono px-5 py-3 bg-[#FFCC00] text-black hover:bg-[#E6B800] transition-colors"
        >
          OPEN SUPPORT INBOX →
        </Link>
      </div>
    );
  }

  return (
    <div data-testid="support-tab" className="h-full max-w-3xl mx-auto flex flex-col">
      <div className="px-6 py-4 border-b border-white/10">
        <div className="label-mono text-[#FFCC00]">// CONTACT SUPPORT</div>
        <div className="font-display text-2xl tracking-tighter mt-1">Talk to the Atlas team.</div>
        <div className="text-xs font-mono text-neutral-500 mt-1">
          Ask a question, report a bug, or send a feature request. We reply by email + in-app.
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <SupportThread />
      </div>
    </div>
  );
}
