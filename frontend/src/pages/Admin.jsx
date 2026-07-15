import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient, useStore } from "../store";

const SECTIONS = [
  { id: "overview", label: "Overview", hint: "01" },
  { id: "users", label: "Users", hint: "02" },
  { id: "projects", label: "Projects", hint: "03" },
  { id: "billing", label: "Billing", hint: "04" },
  { id: "waitlist", label: "Waitlist", hint: "05" },
  { id: "settings", label: "System", hint: "06" },
  { id: "ai", label: "AI Engine", hint: "07" },
  { id: "audit", label: "Audit Log", hint: "08" },
];

const fmtUSD = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);

export default function Admin() {
  const navigate = useNavigate();
  const { user, token, logout } = useStore();
  const [section, setSection] = useState("overview");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      navigate("/");
      return;
    }
    apiClient.get("/auth/me").then(({ data: me }) => {
      if (!me.is_admin) {
        alert("Admin only");
        navigate("/app");
      }
    }).catch(() => navigate("/"));
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    loadSection(section);
    // eslint-disable-next-line
  }, [section]);

  const loadSection = async (s) => {
    setLoading(true);
    try {
      if (s === "overview") {
        const { data } = await apiClient.get("/admin/overview");
        setData((d) => ({ ...d, overview: data }));
      } else if (s === "users") {
        const { data } = await apiClient.get("/admin/users");
        setData((d) => ({ ...d, users: data }));
      } else if (s === "projects") {
        const { data } = await apiClient.get("/admin/projects");
        setData((d) => ({ ...d, projects: data }));
      } else if (s === "billing") {
        const [sum, txns] = await Promise.all([
          apiClient.get("/admin/billing/summary"),
          apiClient.get("/admin/billing/transactions"),
        ]);
        setData((d) => ({ ...d, billing: sum.data, txns: txns.data }));
      } else if (s === "waitlist") {
        const { data } = await apiClient.get("/admin/waitlist");
        setData((d) => ({ ...d, waitlist: data }));
      } else if (s === "settings") {
        const { data } = await apiClient.get("/admin/settings");
        setData((d) => ({ ...d, settings: data }));
      } else if (s === "ai") {
        const { data } = await apiClient.get("/admin/ai-settings");
        setData((d) => ({ ...d, ai: data }));
      } else if (s === "audit") {
        const { data } = await apiClient.get("/admin/audit-log");
        setData((d) => ({ ...d, audit: data }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#0a0a0a]" data-testid="admin-page">
      {/* Sidebar */}
      <aside className="w-60 border-r border-white/10 bg-black flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#FF3333] flex items-center justify-center">
              <span className="font-display text-black text-lg">A</span>
            </div>
            <div>
              <div className="font-display text-lg leading-none tracking-tighter">ATLAS</div>
              <div className="label-mono text-[9px] leading-none mt-1 text-[#FF6666]">ADMIN</div>
            </div>
          </div>
        </div>
        <nav className="flex-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              data-testid={`admin-nav-${s.id}`}
              onClick={() => setSection(s.id)}
              className={`w-full text-left px-4 py-3 border-b border-white/5 flex items-center gap-3 transition-colors ${
                section === s.id ? "bg-white/5 border-l-2 border-l-[#FF3333]" : "hover:bg-white/[0.02]"
              }`}
            >
              <span className={`label-mono ${section === s.id ? "text-[#FF6666]" : "text-neutral-600"}`}>{s.hint}</span>
              <span className={`text-sm uppercase tracking-wider ${section === s.id ? "text-white" : "text-neutral-400"}`}>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10">
          <Link to="/app" data-testid="admin-back-to-app" className="label-mono text-neutral-500 hover:text-white">← BACK TO APP</Link>
          <div className="mt-2 text-xs text-neutral-500 font-mono truncate" title={user?.email}>{user?.email}</div>
          <button
            data-testid="admin-logout"
            onClick={() => { logout(); navigate("/"); }}
            className="mt-2 label-mono text-neutral-500 hover:text-[#FF6666]"
          >
            LOGOUT →
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
          <div>
            <div className="label-mono">// SECTION</div>
            <h1 className="font-display text-3xl tracking-tighter">{SECTIONS.find((s) => s.id === section)?.label}</h1>
          </div>
          {loading && <div className="label-mono text-neutral-500">LOADING…</div>}
        </header>
        <div className="p-8">
          {section === "overview" && <Overview data={data.overview} />}
          {section === "users" && <Users users={data.users || []} reload={() => loadSection("users")} />}
          {section === "projects" && <Projects projects={data.projects || []} />}
          {section === "billing" && <BillingSection billing={data.billing} txns={data.txns || []} />}
          {section === "waitlist" && <WaitlistSection waitlist={data.waitlist} />}
          {section === "settings" && <SystemSettings settings={data.settings} reload={() => loadSection("settings")} />}
          {section === "ai" && <AiSettings ai={data.ai} reload={() => loadSection("ai")} />}
          {section === "audit" && <AuditLog rows={data.audit || []} />}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="border border-white/10 p-5 bg-[#141414]">
      <div className={`label-mono ${accent ? "text-[#FFCC00]" : ""}`}>{label}</div>
      <div className={`font-mono text-3xl mt-2 ${accent ? "text-[#FFCC00]" : ""}`}>{value}</div>
    </div>
  );
}

function Overview({ data }) {
  if (!data) return null;
  return (
    <div className="space-y-8">
      <div>
        <div className="label-mono mb-3">// USERS</div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
          <Stat label="TOTAL" value={data.users.total} />
          <Stat label="ADMINS" value={data.users.admins} />
          <Stat label="FREE" value={data.users.free} />
          <Stat label="PRO" value={data.users.pro} accent />
          <Stat label="STUDIO" value={data.users.studio} />
          <Stat label="TRIALING" value={data.users.trialing} />
        </div>
      </div>
      <div>
        <div className="label-mono mb-3">// ACTIVITY</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
          <Stat label="PROJECTS" value={data.projects} />
          <Stat label="DOCUMENTS" value={data.documents} />
          <Stat label="MATERIALS" value={data.materials} />
          <Stat label="REVENUE" value={fmtUSD(data.revenue.total_paid)} accent />
        </div>
      </div>
    </div>
  );
}

function Users({ users, reload }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [includeAdmins, setIncludeAdmins] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const filtered = useMemo(() =>
    users.filter((u) => !q || u.email?.toLowerCase().includes(q.toLowerCase()) || u.name?.toLowerCase().includes(q.toLowerCase())),
  [users, q]);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const visibleIds = filtered.map((u) => u.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    const ids = [...selected];
    const adminCount = users.filter((u) => ids.includes(u.id) && u.is_admin).length;
    const warn =
      `Permanently delete ${ids.length} user account${ids.length === 1 ? "" : "s"} and ALL their projects, blueprints, uploads, and billing history?\n\n` +
      (adminCount > 0
        ? `⚠️ ${adminCount} admin account${adminCount === 1 ? " is" : "s are"} in this selection — ${includeAdmins ? "they WILL be deleted" : "they will be skipped"}.\n\n`
        : "") +
      `This cannot be undone.`;
    if (!window.confirm(warn)) return;
    setBulkBusy(true);
    try {
      const { data } = await apiClient.post("/admin/users/bulk-delete", {
        user_ids: ids,
        include_admins: includeAdmins,
      });
      const msg =
        `Deleted ${data.deleted} user${data.deleted === 1 ? "" : "s"}.` +
        (data.skipped_admin_ids?.length ? `\nSkipped ${data.skipped_admin_ids.length} admin(s).` : "") +
        (data.skipped_self ? `\nYour own account was skipped.` : "") +
        (data.not_found?.length ? `\n${data.not_found.length} not found.` : "");
      alert(msg);
      clearSelection();
      await reload();
    } catch (e) {
      alert(`Bulk delete failed: ${e?.response?.data?.detail || e?.message || "unknown error"}`);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          data-testid="admin-users-search"
          placeholder="Search by email or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full md:w-96 bg-[#141414] border border-white/10 px-4 py-2 font-mono text-sm"
        />
        {selected.size > 0 && (
          <div
            data-testid="admin-users-bulk-bar"
            className="flex flex-wrap items-center gap-3 px-3 py-2 bg-[#1a1010] border border-[#FF3333]/40 font-mono text-xs"
          >
            <span data-testid="admin-users-selected-count" className="text-[#FF6666]">
              {selected.size} selected
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300">
              <input
                data-testid="admin-users-include-admins"
                type="checkbox"
                checked={includeAdmins}
                onChange={(e) => setIncludeAdmins(e.target.checked)}
              />
              Include admins
            </label>
            <button
              data-testid="admin-users-bulk-delete"
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="label-mono px-3 py-1 bg-[#FF3333] hover:bg-[#FF5555] text-white disabled:opacity-40"
            >
              {bulkBusy ? "Deleting…" : `Delete ${selected.size}`}
            </button>
            <button
              data-testid="admin-users-clear-selection"
              onClick={clearSelection}
              className="label-mono text-neutral-400 hover:text-white"
            >
              Clear
            </button>
          </div>
        )}
      </div>
      <div className="border border-white/10 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#0F0F0F] label-mono">
            <tr>
              <th className="p-3 w-8">
                <input
                  data-testid="admin-users-select-all"
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible users"
                />
              </th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Plan</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Projects</th>
              <th className="text-right p-3">Credits</th>
              <th className="text-left p-3">Admin</th>
              <th className="text-right p-3">·</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.02]" data-testid={`admin-user-row-${u.id}`}>
                <td className="p-3">
                  <input
                    data-testid={`admin-user-select-${u.id}`}
                    type="checkbox"
                    checked={selected.has(u.id)}
                    onChange={() => toggleOne(u.id)}
                    aria-label={`Select ${u.email}`}
                  />
                </td>
                <td className="p-3 font-mono text-xs">{u.email}</td>
                <td className="p-3">{u.name}</td>
                <td className="p-3 font-mono uppercase">{u.subscription?.tier || "free"}</td>
                <td className="p-3 font-mono text-xs">{u.subscription?.status || "free"}</td>
                <td className="p-3 text-right font-mono">{u.project_count}</td>
                <td className="p-3 text-right font-mono">{u.entitlements?.bonus_credits || 0}</td>
                <td className="p-3">{u.is_admin ? <span className="label-mono text-[#FF6666]">ADMIN</span> : ""}</td>
                <td className="p-3 text-right">
                  <button
                    data-testid={`admin-edit-user-${u.id}`}
                    onClick={() => setEditing(u)}
                    className="label-mono text-[#FFCC00] hover:underline"
                  >
                    EDIT
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="9" className="p-6 text-center text-neutral-500 font-mono">No users.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} reload={reload} />}
    </div>
  );
}

function EditUserModal({ user, onClose, reload }) {
  const [form, setForm] = useState({
    plan_tier: user.subscription?.tier || "free",
    plan_status: user.subscription?.status || "free",
    bonus_credits: user.entitlements?.bonus_credits || 0,
    rush_credits: user.entitlements?.rush_credits || 0,
    pdf_premium_branding: !!user.entitlements?.pdf_premium_branding,
    is_admin: !!user.is_admin,
    name: user.name || "",
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await apiClient.patch(`/admin/users/${user.id}`, form);
      await reload();
      onClose();
    } catch (e) {
      alert(e.response?.data?.detail || "Update failed");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${user.email}? This wipes their projects, documents, and data.`)) return;
    setBusy(true);
    try {
      await apiClient.delete(`/admin/users/${user.id}`);
      await reload();
      onClose();
    } catch (e) {
      alert(e.response?.data?.detail || "Delete failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6" data-testid="edit-user-modal">
      <div className="bg-[#141414] border border-white/10 max-w-lg w-full">
        <div className="p-5 border-b border-white/10">
          <div className="label-mono">// EDIT USER</div>
          <h3 className="font-display text-xl tracking-tighter mt-1">{user.email}</h3>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Name">
            <input data-testid="edit-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-black border border-white/10 px-3 py-2" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan tier">
              <select data-testid="edit-tier" value={form.plan_tier} onChange={(e) => setForm({ ...form, plan_tier: e.target.value })} className="w-full bg-black border border-white/10 px-3 py-2">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="studio">Studio</option>
              </select>
            </Field>
            <Field label="Status">
              <select data-testid="edit-status" value={form.plan_status} onChange={(e) => setForm({ ...form, plan_status: e.target.value })} className="w-full bg-black border border-white/10 px-3 py-2">
                <option value="free">free</option>
                <option value="trialing">trialing</option>
                <option value="active">active</option>
                <option value="expired">expired</option>
                <option value="suspended">suspended</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bonus credits">
              <input data-testid="edit-bonus" type="number" min="0" value={form.bonus_credits} onChange={(e) => setForm({ ...form, bonus_credits: Number(e.target.value) })} className="w-full bg-black border border-white/10 px-3 py-2 font-mono" />
            </Field>
            <Field label="Rush credits">
              <input data-testid="edit-rush" type="number" min="0" value={form.rush_credits} onChange={(e) => setForm({ ...form, rush_credits: Number(e.target.value) })} className="w-full bg-black border border-white/10 px-3 py-2 font-mono" />
            </Field>
          </div>
          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input data-testid="edit-pdf-branding" type="checkbox" checked={form.pdf_premium_branding} onChange={(e) => setForm({ ...form, pdf_premium_branding: e.target.checked })} />
              <span className="text-sm">Premium PDF branding</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input data-testid="edit-admin" type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} />
              <span className="text-sm text-[#FF6666]">Admin</span>
            </label>
          </div>
        </div>
        <div className="p-5 border-t border-white/10 flex items-center justify-between gap-3">
          <button data-testid="edit-user-delete" onClick={remove} disabled={busy} className="label-mono text-[#FF6666] hover:underline">DELETE USER</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="label-mono text-neutral-400 px-4 py-2 hover:bg-white/5">CANCEL</button>
            <button data-testid="edit-user-save" onClick={save} disabled={busy} className="bg-[#FFCC00] text-black font-bold px-5 py-2 text-sm uppercase tracking-wider disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="label-mono mb-1">{label}</div>
      {children}
    </label>
  );
}

function Projects({ projects }) {
  return (
    <div className="border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[#0F0F0F] label-mono">
          <tr>
            <th className="text-left p-3">Project</th>
            <th className="text-left p-3">Owner</th>
            <th className="text-right p-3">Docs</th>
            <th className="text-right p-3">Materials</th>
            <th className="text-left p-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-t border-white/5">
              <td className="p-3">{p.name}</td>
              <td className="p-3 font-mono text-xs">{p.user_email}</td>
              <td className="p-3 text-right font-mono">{p.doc_count}</td>
              <td className="p-3 text-right font-mono">{p.material_count}</td>
              <td className="p-3 font-mono text-xs text-neutral-400">{new Date(p.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {projects.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-neutral-500 font-mono">No projects.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function BillingSection({ billing, txns }) {
  if (!billing) return null;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
        <Stat label="MRR (USD)" value={fmtUSD(billing.mrr_usd)} accent />
        <Stat label="PRO SUBS" value={billing.pro_subscribers} />
        <Stat label="STUDIO SUBS" value={billing.studio_subscribers} />
        <Stat label="TRIALING" value={billing.trialing} />
        <Stat label="TRIALS STARTED" value={billing.trials_started} />
        <Stat label="CONVERTED" value={billing.trial_converted} />
        <Stat label="CONVERSION %" value={`${billing.trial_conversion_pct}%`} />
        <Stat label="LIFETIME REVENUE" value={fmtUSD(billing.total_paid_usd)} accent />
      </div>
      <div>
        <div className="label-mono mb-3">// RECENT TRANSACTIONS</div>
        <div className="border border-white/10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0F0F0F] label-mono">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">User</th>
                <th className="text-left p-3">Item</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Applied</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="p-3 font-mono text-xs">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{t.user_email}</td>
                  <td className="p-3">{t.item}</td>
                  <td className="p-3 text-right font-mono">{fmtUSD(t.amount)}</td>
                  <td className="p-3 label-mono">{t.payment_status}</td>
                  <td className="p-3">{t.entitlements_applied ? "✓" : "—"}</td>
                </tr>
              ))}
              {txns.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-neutral-500 font-mono">No transactions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WaitlistSection({ waitlist }) {
  const [q, setQ] = useState("");
  const [appFilter, setAppFilter] = useState("all");
  if (!waitlist) return <div className="text-neutral-500">Loading…</div>;
  const { total = 0, by_app = {}, signups = [] } = waitlist;
  const apps = Object.keys(by_app);
  const filtered = signups.filter((s) => {
    if (appFilter !== "all" && s.app_id !== appFilter) return false;
    if (q && !s.email.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const exportCsv = () => {
    const header = "email,app_id,created_at\n";
    const rows = filtered.map((s) => `${s.email},${s.app_id},${s.created_at}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist-${appFilter === "all" ? "all" : appFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div data-testid="admin-waitlist" className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total signups" value={total} accent="#00E5FF" />
        {apps.slice(0, 3).map((appId) => (
          <Stat key={appId} label={appId} value={by_app[appId]} accent="#FFCC00" />
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          data-testid="admin-waitlist-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by email…"
          className="flex-1 min-w-[240px] bg-[#141414] border border-white/10 px-3 py-2 text-sm text-white font-mono focus:border-[#FF6666] focus:outline-none"
        />
        <select
          data-testid="admin-waitlist-app-filter"
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="bg-[#141414] border border-white/10 px-3 py-2 text-sm text-white font-mono focus:border-[#FF6666] focus:outline-none"
        >
          <option value="all">All apps ({total})</option>
          {apps.map((a) => (
            <option key={a} value={a}>{a} ({by_app[a]})</option>
          ))}
        </select>
        <button
          data-testid="admin-waitlist-export"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="label-mono px-4 py-2 bg-[#FFCC00] text-black hover:bg-[#E6B800] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          EXPORT CSV ({filtered.length})
        </button>
      </div>

      {/* Table */}
      <div className="border border-white/10 bg-[#141414] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 text-sm font-mono">
            {signups.length === 0 ? "No waitlist signups yet — share your preview microsites to start collecting." : "No signups match your filter."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-neutral-500 label-mono">
              <tr>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">App</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Joined</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={`${s.email}-${s.app_id}`}
                  data-testid={`admin-waitlist-row-${s.email}`}
                  className="border-b border-white/5 hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3 font-mono text-white">{s.email}</td>
                  <td className="px-4 py-3">
                    <span className="label-mono text-[#00E5FF]">{s.app_id}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-neutral-400 hidden md:table-cell">
                    {new Date(s.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 hidden lg:table-cell">{s.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


function SystemSettings({ settings, reload }) {
  const [catalogText, setCatalogText] = useState("");
  const [limitsText, setLimitsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (settings?.settings) {
      setCatalogText(JSON.stringify(settings.settings.catalog_overrides || {}, null, 2));
      setLimitsText(JSON.stringify(settings.settings.plan_limits_overrides || {}, null, 2));
    }
  }, [settings]);

  if (!settings) return null;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const co = JSON.parse(catalogText || "{}");
      const lo = JSON.parse(limitsText || "{}");
      await apiClient.put("/admin/settings", { catalog_overrides: co, plan_limits_overrides: lo });
      setMsg({ kind: "success", text: "Saved." });
      await reload();
    } catch (e) {
      setMsg({ kind: "error", text: e.response?.data?.detail || e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`px-4 py-2 text-sm font-mono ${msg.kind === "success" ? "border border-[#00CC66]/40 bg-[#00CC66]/10 text-[#00CC66]" : "border border-[#FF3333]/40 bg-[#FF3333]/10 text-[#FF6666]"}`}>
          {msg.text}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="label-mono mb-2">// CATALOG OVERRIDES (JSON)</div>
          <p className="text-xs text-neutral-500 mb-2">Override per-item fields like amount, label.</p>
          <textarea
            data-testid="settings-catalog-textarea"
            value={catalogText}
            onChange={(e) => setCatalogText(e.target.value)}
            rows={12}
            className="w-full bg-black border border-white/10 p-3 font-mono text-xs"
          />
          <details className="mt-2">
            <summary className="label-mono cursor-pointer text-neutral-400">Defaults reference</summary>
            <pre className="mt-2 p-3 bg-black/40 border border-white/5 text-xs overflow-x-auto">{JSON.stringify(settings.default_catalog, null, 2)}</pre>
          </details>
        </div>
        <div>
          <div className="label-mono mb-2">// PLAN LIMITS OVERRIDES (JSON)</div>
          <p className="text-xs text-neutral-500 mb-2">Override quotas per tier (e.g. ai_uploads_per_month).</p>
          <textarea
            data-testid="settings-limits-textarea"
            value={limitsText}
            onChange={(e) => setLimitsText(e.target.value)}
            rows={12}
            className="w-full bg-black border border-white/10 p-3 font-mono text-xs"
          />
          <details className="mt-2">
            <summary className="label-mono cursor-pointer text-neutral-400">Defaults reference</summary>
            <pre className="mt-2 p-3 bg-black/40 border border-white/5 text-xs overflow-x-auto">{JSON.stringify(settings.default_plan_limits, null, 2)}</pre>
          </details>
        </div>
      </div>
      <button data-testid="settings-save" onClick={save} disabled={busy} className="bg-[#FFCC00] text-black font-bold px-6 py-3 text-sm uppercase tracking-wider disabled:opacity-50">
        {busy ? "Saving…" : "Save System Settings"}
      </button>
    </div>
  );
}

function AiSettings({ ai, reload }) {
  const [model, setModel] = useState(ai?.ai_model || "gpt-4o");
  const [provider, setProvider] = useState(ai?.ai_provider || "openai");
  const [prompt, setPrompt] = useState(ai?.ai_system_prompt_override || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ai) {
      setModel(ai.ai_model || "gpt-4o");
      setProvider(ai.ai_provider || "openai");
      setPrompt(ai.ai_system_prompt_override || "");
    }
  }, [ai]);

  if (!ai) return null;

  const save = async () => {
    setBusy(true);
    try {
      const chosen = ai.available_models.find((m) => m.id === model);
      await apiClient.put("/admin/settings", {
        ai_model: model,
        ai_provider: chosen?.provider || provider,
        ai_system_prompt_override: prompt || null,
      });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
        <Stat label="DEFAULT PROMPT" value="GPT-4o" />
        <Stat label="ANALYZED DOCS" value={ai.analyzed_documents_count} accent />
      </div>
      <Field label="Model">
        <select data-testid="ai-model" value={model} onChange={(e) => setModel(e.target.value)} className="w-full bg-black border border-white/10 px-3 py-2 font-mono">
          {ai.available_models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Field>
      <Field label="System prompt override (leave blank to use default)">
        <textarea
          data-testid="ai-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          placeholder={ai.default_system_prompt}
          className="w-full bg-black border border-white/10 p-3 font-mono text-xs"
        />
      </Field>
      <button data-testid="ai-save" onClick={save} disabled={busy} className="bg-[#FFCC00] text-black font-bold px-6 py-3 text-sm uppercase tracking-wider disabled:opacity-50">
        {busy ? "Saving…" : "Save AI Settings"}
      </button>
    </div>
  );
}

function AuditLog({ rows }) {
  return (
    <div className="border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[#0F0F0F] label-mono">
          <tr>
            <th className="text-left p-3">When</th>
            <th className="text-left p-3">Actor</th>
            <th className="text-left p-3">Action</th>
            <th className="text-left p-3">Target</th>
            <th className="text-left p-3">Meta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="p-3 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
              <td className="p-3 font-mono text-xs">{r.actor_email || r.actor_id?.slice(0, 8)}</td>
              <td className="p-3 font-mono">{r.action}</td>
              <td className="p-3 font-mono text-xs text-neutral-400">{r.target?.slice(0, 16) || "—"}</td>
              <td className="p-3 font-mono text-xs text-neutral-400">{JSON.stringify(r.meta).slice(0, 80)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan="5" className="p-6 text-center text-neutral-500 font-mono">No audit events yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
