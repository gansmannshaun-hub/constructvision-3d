/**
 * Floating support widget — bottom-right bubble that expands to a chat panel.
 * Mounted globally for logged-in users (admins don't see it; they have the inbox).
 */
import React, { useEffect, useState, useCallback } from "react";
import { apiClient, useStore } from "../store";
import SupportThread from "./SupportThread";

const POLL_MS = 30_000;

export default function SupportBubble() {
  const { token, user } = useStore();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { data } = await apiClient.get("/support/me/unread");
      setUnread(Number(data?.unread || 0));
    } catch (_) { /* ignore */ }
  }, [token]);

  useEffect(() => {
    if (!token || user?.is_admin) return;
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [token, user, refresh]);

  // Don't render for anon users or admins
  if (!token || user?.is_admin) return null;

  return (
    <>
      {open && (
        <div
          data-testid="support-bubble-panel"
          className="fixed bottom-24 right-6 z-[100] w-[380px] h-[560px] max-h-[80vh] bg-black border border-[#FFCC00]/40 shadow-2xl flex flex-col"
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#111]">
            <div>
              <div className="label-mono text-[#FFCC00]">// ATLAS SUPPORT</div>
              <div className="text-[10px] font-mono text-neutral-500">Avg reply &lt; 24 hours</div>
            </div>
            <button
              data-testid="support-bubble-close"
              onClick={() => setOpen(false)}
              className="text-neutral-400 hover:text-white text-lg leading-none w-6 h-6 flex items-center justify-center"
            >✕</button>
          </div>
          <div className="flex-1 min-h-0">
            <SupportThread compact onUnreadChange={setUnread} />
          </div>
        </div>
      )}
      <button
        data-testid="support-bubble-toggle"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-24 z-[100] w-14 h-14 rounded-full bg-[#FFCC00] hover:bg-[#E6B800] text-black shadow-2xl flex items-center justify-center transition-transform hover:scale-105"
        title={open ? "Close support" : "Contact support"}
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M6 18L18 6"/></svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor"><path d="M12 2C6.48 2 2 5.92 2 10.7c0 2.43 1.16 4.6 3.02 6.15-.13 1.07-.5 2.42-1.34 3.78a.5.5 0 00.6.75c2.4-.78 4.04-1.83 5.05-2.6A11.4 11.4 0 0012 19.4c5.52 0 10-3.92 10-8.7S17.52 2 12 2z"/></svg>
        )}
        {unread > 0 && !open && (
          <span
            data-testid="support-bubble-badge"
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-[#FF3333] text-white text-[11px] font-bold font-mono rounded-full flex items-center justify-center"
          >{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
    </>
  );
}
