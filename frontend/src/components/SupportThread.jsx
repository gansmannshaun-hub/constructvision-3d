/**
 * Shared support-thread chat component. Used by:
 *  - SupportTab (dashboard tab)
 *  - SupportBubble (floating widget)
 *  - SupportInbox (admin-side thread view)
 *
 * Props:
 *   threadId — thread to render. If null, auto-loads the current user's thread.
 *   onUnreadChange(count) — callback fired with the unread count after sync.
 *   className — wrapper class.
 *   compact — if true, render in floating-widget compact mode.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, useStore } from "../store";

const POLL_MS = 15_000;

export default function SupportThread({ threadId: explicitThreadId,
                                        onUnreadChange, compact = false }) {
  const { user } = useStore();
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const isAdmin = Boolean(user?.is_admin);

  const loadThread = useCallback(async () => {
    try {
      let t = null;
      if (explicitThreadId) {
        t = { id: explicitThreadId };  // we only need the id to fetch messages
      } else if (!isAdmin) {
        const { data } = await apiClient.get("/support/me/thread");
        t = data;
      }
      if (!t) { setLoading(false); return; }
      const { data: msgData } = await apiClient.get(`/support/threads/${t.id}/messages`);
      setThread(msgData.thread);
      setMessages(msgData.messages || []);
      // Mark as read
      try { await apiClient.post(`/support/threads/${t.id}/read`); } catch (_) { /* ignore */ }
      if (onUnreadChange) onUnreadChange(0);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [explicitThreadId, isAdmin, onUnreadChange]);

  useEffect(() => {
    loadThread();
    const id = setInterval(loadThread, POLL_MS);
    return () => clearInterval(id);
  }, [loadThread]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = useCallback(async () => {
    if (!body.trim() || !thread) return;
    setSending(true);
    setError("");
    try {
      const { data } = await apiClient.post(
        `/support/threads/${thread.id}/messages`,
        { body: body.trim() },
      );
      setMessages((prev) => [...prev, data]);
      setBody("");
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setSending(false);
    }
  }, [body, thread]);

  const uploadAttachment = useCallback(async (file) => {
    if (!file || !thread) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("body", body || "");
      const { data } = await apiClient.post(
        `/support/threads/${thread.id}/attachments`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setMessages((prev) => [...prev, data]);
      setBody("");
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [body, thread]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 font-mono text-sm">
        Loading support thread…
      </div>
    );
  }

  return (
    <div data-testid="support-thread" className={`flex flex-col h-full bg-black ${compact ? "" : ""}`}>
      {thread && (
        <div className="px-4 py-2 border-b border-white/10 flex items-center justify-between text-xs font-mono">
          <div className="text-neutral-500">
            // {isAdmin ? `${thread.user_name} · ${thread.user_email}` : "ATLAS SUPPORT"}
          </div>
          <div className={`label-mono ${thread.status === "open" ? "text-[#88EEAA]" : "text-neutral-500"}`}>
            {thread.status?.toUpperCase()}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#0a0a0a]">
        {messages.length === 0 ? (
          <div className="text-center text-neutral-500 text-sm font-mono py-8">
            {isAdmin
              ? "No messages yet from this user."
              : "Send a message to the Atlas team — we typically reply within 24 hours."}
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} msg={m} isMine={isMine(m, user)} />)
        )}
      </div>

      {error && (
        <div data-testid="support-error" className="mx-4 mb-2 border border-[#FF6666]/40 bg-[#FF6666]/10 text-[#FF8888] text-xs font-mono px-3 py-1.5">
          {error}
        </div>
      )}

      <div className="border-t border-white/10 px-3 py-3 bg-black">
        <div className="flex items-end gap-2">
          <textarea
            data-testid="support-input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault(); send();
              }
            }}
            placeholder={isAdmin ? "Reply to user… (⌘+Enter to send)" : "Type your message… (⌘+Enter to send)"}
            rows={compact ? 2 : 3}
            className="flex-1 bg-[#111] border border-white/10 text-white text-sm font-mono px-3 py-2 focus:border-[#FFCC00] focus:outline-none resize-none"
          />
          <div className="flex flex-col gap-1">
            <button
              data-testid="support-attach"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="label-mono border border-white/15 hover:bg-white/5 px-3 py-1.5 disabled:opacity-40 text-xs"
              title="Attach a screenshot or PDF"
            >📎</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAttachment(f);
              }}
            />
            <button
              data-testid="support-send"
              onClick={send}
              disabled={sending || !body.trim()}
              className="label-mono px-3 py-1.5 bg-[#FFCC00] hover:bg-[#E6B800] text-black disabled:opacity-40 disabled:bg-neutral-700 disabled:text-neutral-500 text-xs"
            >
              {sending ? "…" : "SEND"}
            </button>
          </div>
        </div>
        {uploading && (
          <div className="text-[10px] font-mono text-neutral-500 mt-1">Uploading attachment…</div>
        )}
      </div>
    </div>
  );
}

function isMine(msg, user) {
  if (!user) return false;
  if (user.is_admin && msg.sender === "admin") return true;
  if (!user.is_admin && msg.sender === "user" && msg.sender_id === user.id) return true;
  return false;
}

function Bubble({ msg, isMine }) {
  const isAdmin = msg.sender === "admin";
  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        data-testid={`support-msg-${msg.id}`}
        className={`max-w-[78%] px-3 py-2 ${
          isMine
            ? "bg-[#FFCC00]/15 border border-[#FFCC00]/30 text-[#FFCC00]"
            : isAdmin
              ? "bg-[#5588FF]/10 border border-[#5588FF]/30 text-[#88AAFF]"
              : "bg-white/[0.04] border border-white/10 text-neutral-200"
        }`}
      >
        <div className="text-[10px] font-mono opacity-70 mb-0.5 flex items-center gap-2">
          <span>{isAdmin ? "Atlas Support" : (msg.sender_name || "User")}</span>
          <span>·</span>
          <span>{new Date(msg.created_at).toLocaleString()}</span>
        </div>
        {msg.body && (
          <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
        )}
        {Array.isArray(msg.attachments) && msg.attachments.map((a) => (
          <Attachment key={a.id} att={a} />
        ))}
      </div>
    </div>
  );
}

function Attachment({ att }) {
  const [src, setSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const isImage = (att.content_type || "").startsWith("image/");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await apiClient.get(`/support/attachments/${att.id}`);
      setSrc(`data:${data.content_type};base64,${data.data_b64}`);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [att.id]);

  useEffect(() => {
    if (isImage) load();
  }, [isImage, load]);

  if (isImage) {
    return (
      <div className="mt-1.5">
        {src
          ? <img src={src} alt={att.filename} className="max-w-full max-h-80 border border-white/10" />
          : <div className="text-[10px] font-mono opacity-70">Loading {att.filename}…</div>}
      </div>
    );
  }
  return (
    <button
      data-testid={`support-att-${att.id}`}
      onClick={async () => {
        if (src) return window.open(src, "_blank");
        await load();
      }}
      disabled={busy}
      className="mt-1.5 inline-block text-[11px] font-mono underline opacity-90 hover:opacity-100"
    >
      📎 {att.filename} ({Math.round((att.size || 0) / 1024)} KB)
    </button>
  );
}
