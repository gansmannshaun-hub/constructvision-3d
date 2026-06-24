/**
 * Admin-only Support Inbox — view all support threads, filter, reply.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, useStore } from "../store";
import SupportThread from "../components/SupportThread";

const POLL_MS = 20_000;

export default function AdminSupportInbox() {
  const navigate = useNavigate();
  const { token, user } = useStore();
  const [inbox, setInbox] = useState({ threads: [], unread_total: 0, open_count: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | unread | open | closed

  useEffect(() => {
    if (!token) { navigate("/"); return; }
    if (token && user && !user.is_admin) { navigate("/app"); return; }
  }, [token, user, navigate]);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/support/admin/inbox");
      setInbox(data);
      if (!selectedId && data.threads?.length > 0) {
        setSelectedId(data.threads[0].id);
      }
    } catch (e) {
      console.error("inbox load failed", e);
    }
  }, [selectedId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = (inbox.threads || []).filter((t) => {
    if (filter === "all") return true;
    if (filter === "unread") return (t.unread_admin || 0) > 0;
    if (filter === "open") return t.status === "open";
    if (filter === "closed") return t.status === "closed";
    return true;
  });

  const selected = (inbox.threads || []).find((t) => t.id === selectedId) || null;

  const toggleClose = useCallback(async () => {
    if (!selected) return;
    const next = selected.status === "open" ? "closed" : "open";
    try {
      await apiClient.patch(`/support/threads/${selected.id}`, { status: next });
      await refresh();
    } catch (e) {
      alert("Failed: " + (e?.response?.data?.detail || e.message));
    }
  }, [selected, refresh]);

  return (
    <div className="h-screen bg-[#0a0a0a] text-white flex flex-col">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="label-mono text-[#FFCC00]">// ADMIN · SUPPORT INBOX</div>
          <div className="font-display text-3xl tracking-tighter mt-1">
            {inbox.unread_total} unread · {inbox.open_count} open
          </div>
        </div>
        <button
          onClick={() => navigate("/app")}
          className="label-mono border border-white/15 hover:bg-white/5 px-4 py-2"
        >← BACK TO APP</button>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Thread list */}
        <aside data-testid="support-inbox-list" className="w-[360px] border-r border-white/10 flex flex-col bg-black">
          <div className="px-4 py-3 border-b border-white/10 flex gap-2">
            {["all", "unread", "open", "closed"].map((f) => (
              <button
                key={f}
                data-testid={`inbox-filter-${f}`}
                onClick={() => setFilter(f)}
                className={`label-mono px-2.5 py-1 text-[10px] border ${
                  filter === f
                    ? "border-[#FFCC00] text-[#FFCC00]"
                    : "border-white/10 text-neutral-500 hover:text-white"
                }`}
              >{f.toUpperCase()}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-neutral-500 font-mono text-xs">No threads.</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.id}
                  data-testid={`inbox-thread-${t.id}`}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    selectedId === t.id ? "bg-[#FFCC00]/10 border-l-2 border-l-[#FFCC00]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium truncate flex-1">
                      {t.user_name || t.user_email}
                    </div>
                    {(t.unread_admin || 0) > 0 && (
                      <span className="bg-[#FF3333] text-white text-[10px] font-mono px-1.5 rounded-full min-w-[18px] text-center">
                        {t.unread_admin}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-500 truncate">{t.user_email}</div>
                  <div className="text-xs text-neutral-400 truncate mt-1">{t.last_message_preview || "(no messages)"}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono">
                    <span className={t.status === "open" ? "text-[#88EEAA]" : "text-neutral-500"}>
                      {(t.status || "open").toUpperCase()}
                    </span>
                    {t.last_message_at && (
                      <span className="text-neutral-600">
                        · {new Date(t.last_message_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Selected thread */}
        <section className="flex-1 min-w-0 flex flex-col">
          {selected ? (
            <>
              <div className="border-b border-white/10 px-5 py-3 flex items-center justify-between bg-black">
                <div>
                  <div className="text-sm font-medium">{selected.user_name || selected.user_email}</div>
                  <div className="text-[10px] font-mono text-neutral-500">{selected.user_email}</div>
                </div>
                <button
                  data-testid="inbox-toggle-close"
                  onClick={toggleClose}
                  className={`label-mono px-3 py-1.5 border ${
                    selected.status === "open"
                      ? "border-[#FF6666]/40 text-[#FF6666] hover:bg-[#FF6666]/10"
                      : "border-[#88EEAA]/40 text-[#88EEAA] hover:bg-[#88EEAA]/10"
                  }`}
                >
                  {selected.status === "open" ? "CLOSE THREAD" : "REOPEN"}
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <SupportThread key={selected.id} threadId={selected.id} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-neutral-500 font-mono text-sm">
              Select a thread to view messages.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
