import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useStore, apiClient } from "../store";
import CollabModal from "../components/CollabModal";
import DocumentsTab from "../components/DocumentsTab";
import MaterialsTab from "../components/MaterialsTab";
import BlueprintTab from "../components/BlueprintTab";
import CadEditorTab from "../components/CadEditorTab";
import RendererTab from "../components/RendererTab";
import FieldTab from "../components/FieldTab";
import ScheduleTab from "../components/ScheduleTab";
import PayAppsTab from "../components/PayAppsTab";
import ManualTab from "../components/ManualTab";
import SupportTab from "../components/SupportTab";

function AdminSupportLink() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancel = false;
    const fetch = async () => {
      try {
        const { data } = await apiClient.get("/support/admin/unread");
        if (!cancel) setUnread(Number(data?.unread || 0));
      } catch (_) { /* swallow */ }
    };
    fetch();
    const id = setInterval(fetch, 20_000);
    return () => { cancel = true; clearInterval(id); };
  }, []);
  return (
    <Link
      to="/admin/support"
      data-testid="admin-support-link"
      className="relative px-4 py-3 flex flex-col justify-center hover:bg-[#FFCC00]/10 transition-colors border-r border-white/10"
      title="Support inbox"
    >
      <div className="label-mono text-[#FFCC00]">SUPPORT</div>
      <div className="font-mono text-xs mt-0.5 text-[#FFCC00]">✉ INBOX</div>
      {unread > 0 && (
        <span
          data-testid="admin-support-badge"
          className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 bg-[#FF3333] text-white text-[10px] font-bold font-mono rounded-full flex items-center justify-center"
        >{unread > 9 ? "9+" : unread}</span>
      )}
    </Link>
  );
}

const TABS = [
  { id: "documents", label: "Documents", hint: "01" },
  { id: "materials", label: "Materials", hint: "02" },
  { id: "blueprint", label: "Blueprint", hint: "03" },
  { id: "cad", label: "2D CAD Editor", hint: "04" },
  { id: "renderer", label: "3D Renderer", hint: "05" },
  { id: "field", label: "Field", hint: "06" },
  { id: "schedule", label: "Schedule", hint: "07" },
  { id: "payapps", label: "Pay Apps", hint: "08" },
  { id: "manual", label: "Manual", hint: "09" },
  { id: "support", label: "Support", hint: "10" },
];

const TIER_COLOR = { free: "#A0A0A0", pro: "#FFCC00", studio: "#5588FF" };

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, projects, currentProjectId, documents, billing, logout, loadProjects, selectProject, refreshDocuments, refreshMaterials, refreshBlueprint, refreshBilling } =
    useStore();
  const [tab, setTab] = useState("documents");
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!useStore.getState().token) {
      navigate("/");
      return;
    }
    loadProjects();
    refreshBilling();
    // eslint-disable-next-line
  }, []);

  // Global "?" shortcut to jump to the user manual.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "?" && !/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || "")) {
        e.preventDefault();
        setTab("manual");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Poll documents while any are in-flight; trigger materials/blueprint refresh when any flips to done
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const active = (documents || []).some((d) =>
      ["uploaded", "analyzing", "saving", "syncing"].includes(d.status)
    );
    if (active) {
      pollRef.current = setInterval(async () => {
        const before = (useStore.getState().documents || []).map((d) => `${d.id}:${d.status}`).join("|");
        await refreshDocuments();
        const after = (useStore.getState().documents || []).map((d) => `${d.id}:${d.status}`).join("|");
        if (before !== after) {
          refreshMaterials();
          refreshBlueprint();
        }
        const stillActive = (useStore.getState().documents || []).some((d) =>
          ["uploaded", "analyzing", "saving", "syncing"].includes(d.status)
        );
        if (!stillActive) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 1500);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [documents, refreshDocuments, refreshMaterials, refreshBlueprint]);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  return (
    <div className="min-h-screen flex flex-col" data-testid="dashboard">
      {/* Top bar */}
      <header className="border-b border-white/10 bg-black flex-shrink-0">
        <div className="flex items-stretch flex-wrap">
          <div className="flex items-center gap-3 px-6 py-4 border-r border-white/10">
            <div className="w-8 h-8 bg-[#FFCC00] flex items-center justify-center">
              <span className="font-display text-black text-lg">A</span>
            </div>
            <div>
              <div className="font-display text-lg leading-none tracking-tighter">ATLAS</div>
              <div className="label-mono text-[9px] leading-none mt-1">CONSTRUCTION&nbsp;OS</div>
            </div>
          </div>

          <div className="flex-1 min-w-0 flex items-center px-6 gap-4">
            <div className="min-w-0">
              <div className="label-mono">// PROJECT</div>
              {projects.length > 0 ? (
                <select
                  data-testid="project-selector"
                  value={currentProjectId || ""}
                  onChange={(e) => selectProject(e.target.value)}
                  className="bg-transparent text-white font-mono text-sm mt-1 outline-none cursor-pointer hover:text-[#FFCC00] transition-colors max-w-[280px] truncate"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-black">
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="font-mono text-sm mt-1 text-neutral-500">No projects yet</div>
              )}
            </div>
            <NewProjectButton primary={projects.length === 0} />
            {currentProjectId && <ShareButton projectId={currentProjectId} />}
            {currentProjectId && <TeamButton projectId={currentProjectId} />}
          </div>

          <div className="flex items-stretch border-l border-white/10">
            <Link
              to="/billing"
              data-testid="billing-link"
              className="px-5 py-3 flex flex-col justify-center hover:bg-white/5 transition-colors border-r border-white/10"
            >
              <div className="label-mono">PLAN</div>
              <div
                data-testid="plan-badge"
                className="font-mono text-sm font-bold uppercase tracking-wider mt-0.5"
                style={{ color: TIER_COLOR[billing?.plan || "free"] }}
              >
                {(billing?.plan || "free").toUpperCase()}
                {billing?.subscription?.status === "trialing" && (
                  <span className="text-[10px] ml-1 text-neutral-400">· TRIAL</span>
                )}
              </div>
            </Link>
            {user?.is_admin && (
              <Link
                to="/admin"
                data-testid="admin-link"
                className="px-4 py-3 flex flex-col justify-center hover:bg-[#FF3333]/10 transition-colors border-r border-white/10"
                title="Admin panel"
              >
                <div className="label-mono text-[#FF6666]">ADMIN</div>
                <div className="font-mono text-xs mt-0.5 text-[#FF6666]">⚡ PANEL</div>
              </Link>
            )}
            {user?.is_admin && <AdminSupportLink />}
            <Link
              to="/settings"
              data-testid="settings-link"
              className="px-4 py-3 flex flex-col justify-center hover:bg-white/5 transition-colors border-r border-white/10"
              title="Account settings"
            >
              <div className="label-mono">SETTINGS</div>
              <div className="font-mono text-xs mt-0.5">⚙ ACCOUNT</div>
            </Link>
            <div className="px-5 py-3 flex flex-col justify-center border-r border-white/10 min-w-0">
              <div className="label-mono">SIGNED IN AS</div>
              <div className="font-mono text-xs truncate max-w-[180px]" data-testid="current-user" title={user?.email}>{user?.email}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={() => setShowLogoutModal(true)}
              className="px-5 bg-[#1A1A1A] hover:bg-[#FF3333] text-white flex flex-col items-center justify-center transition-colors text-sm uppercase tracking-wider font-mono group"
              title="Sign out"
            >
              <span className="text-lg leading-none group-hover:translate-x-0.5 transition-transform">⎋</span>
              <span className="label-mono mt-1 text-[#FF6666] group-hover:text-white">LOG&nbsp;OUT</span>
            </button>
          </div>
        </div>

        {/* Tab strip */}
        <div className="flex border-t border-white/10">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                data-testid={`tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-3 px-6 py-3 border-r border-white/10 transition-all duration-150 ${
                  active ? "bg-[#0055FF]/10 text-white border-b-2 border-b-[#0055FF]" : "text-neutral-500 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className={`label-mono ${active ? "text-[#FFCC00]" : ""}`}>{t.hint}</span>
                <span className="text-sm uppercase tracking-wider font-medium">{t.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 min-h-0 bg-[#0a0a0a]">
        {currentProject ? (
          <>
            {tab === "documents" && <DocumentsTab />}
            {tab === "materials" && <MaterialsTab />}
            {tab === "blueprint" && <BlueprintTab />}
            {tab === "cad" && <CadEditorTab />}
            {tab === "renderer" && <RendererTab />}
            {tab === "field" && <FieldTab />}
            {tab === "schedule" && <ScheduleTab />}
            {tab === "payapps" && <PayAppsTab />}
            {tab === "manual" && <ManualTab />}
            {tab === "support" && <SupportTab />}
          </>
        ) : projects.length === 0 ? (
          <EmptyProjectsState />
        ) : (
          <div className="p-12 text-center text-neutral-500 font-mono">Loading project…</div>
        )}
      </main>

      {showLogoutModal && (
        <LogoutModal
          user={user}
          onCancel={() => setShowLogoutModal(false)}
          onConfirm={() => {
            logout();
            navigate("/");
          }}
        />
      )}
    </div>
  );
}

function LogoutModal({ user, onConfirm, onCancel }) {
  // Esc to close
  useEffect(() => {
    const h = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel, onConfirm]);

  return (
    <div
      data-testid="logout-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm fade-up"
      onClick={onCancel}
    >
      <div
        className="bg-[#0a0a0a] border border-white/15 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Striped header bar */}
        <div className="h-1 bg-[length:14px_14px]" style={{
          backgroundImage: "repeating-linear-gradient(45deg, #FF3333 0 6px, transparent 6px 14px)"
        }} />
        <div className="px-7 pt-7 pb-2">
          <div className="label-mono text-[#FF6666] mb-2">// SIGN OUT</div>
          <h2 className="font-display text-3xl tracking-tighter leading-none">Ready to step away?</h2>
        </div>
        <div className="px-7 py-5 space-y-3">
          <p className="text-sm text-neutral-300 leading-relaxed">
            You'll need to sign in again to access your blueprints, materials and 3D models.
          </p>
          <div className="border border-white/10 bg-[#141414] px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 bg-[#FFCC00] flex items-center justify-center flex-shrink-0">
              <span className="font-display text-black text-base">
                {(user?.name || user?.email || "?").charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <div className="font-mono text-sm truncate" data-testid="logout-modal-user">{user?.name || user?.email}</div>
              <div className="label-mono truncate">{user?.email}</div>
            </div>
          </div>
        </div>
        <div className="px-7 py-5 border-t border-white/10 flex items-center justify-end gap-2">
          <button
            data-testid="logout-modal-cancel"
            onClick={onCancel}
            className="label-mono px-4 py-2.5 text-neutral-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            CANCEL
          </button>
          <button
            data-testid="logout-modal-confirm"
            onClick={onConfirm}
            autoFocus
            className="bg-[#FF3333] hover:bg-[#CC2222] text-white font-bold px-5 py-2.5 text-xs uppercase tracking-wider transition-colors flex items-center gap-2"
          >
            <span className="text-base leading-none">⎋</span>
            <span>Sign me out</span>
          </button>
        </div>
        <div className="px-7 pb-4">
          <div className="label-mono text-neutral-700">ESC TO CANCEL · ENTER TO CONFIRM</div>
        </div>
      </div>
    </div>
  );
}

function EmptyProjectsState() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { loadProjects, selectProject } = useStore();
  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await apiClient.post("/projects", { name });
      await loadProjects();
      await selectProject(data.id);
    } catch (e2) {
      alert(e2.response?.data?.detail || "Could not create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-8" data-testid="empty-projects-state">
      <div className="max-w-md w-full text-center fade-up">
        <div className="w-20 h-20 mx-auto mb-6 border-2 border-[#FFCC00] flex items-center justify-center">
          <span className="font-display text-5xl text-[#FFCC00] leading-none">+</span>
        </div>
        <div className="label-mono mb-2">// LET'S START</div>
        <h1 className="font-display text-4xl tracking-tighter mb-3">Create your first project.</h1>
        <p className="text-neutral-400 text-sm leading-relaxed mb-8">
          Every project is its own workspace — blueprints, materials, 3D model, and PDF takeoffs all live together.
          You can have unlimited projects on Pro and Studio plans.
        </p>
        {open ? (
          <form onSubmit={create} className="flex flex-col items-stretch gap-3">
            <input
              autoFocus
              data-testid="empty-state-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name (e.g. Mason Heights Duplex)"
              className="w-full bg-[#141414] border border-white/10 px-4 py-3 text-center font-mono"
              required
            />
            <button
              data-testid="empty-state-create"
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold py-3 uppercase tracking-wider text-sm disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create project →"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="label-mono text-neutral-500 hover:text-white pt-2"
            >
              CANCEL
            </button>
          </form>
        ) : (
          <button
            data-testid="empty-state-start"
            onClick={() => setOpen(true)}
            className="bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold px-8 py-3 uppercase tracking-wider text-sm transition-colors"
          >
            + Create new project
          </button>
        )}
      </div>
    </div>
  );
}

function NewProjectButton({ primary = false }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const { loadProjects, selectProject } = useStore();

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await apiClient.post("/projects", { name });
      await loadProjects();
      await selectProject(data.id);
      setOpen(false);
      setName("");
    } catch (e2) {
      alert(e2.response?.data?.detail || "Could not create project");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    const cls = primary
      ? "bg-[#FFCC00] hover:bg-[#E6B800] text-black font-bold border border-[#FFCC00]"
      : "border border-[#FFCC00]/60 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black";
    return (
      <button
        data-testid="new-project-button"
        onClick={() => setOpen(true)}
        className={`ml-auto label-mono px-4 py-2 transition-all duration-150 flex items-center gap-2 ${cls}`}
      >
        <span className="text-base leading-none">+</span>
        <span>NEW&nbsp;PROJECT</span>
      </button>
    );
  }
  return (
    <form onSubmit={create} className="ml-auto flex items-center gap-2">
      <input
        autoFocus
        data-testid="new-project-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="bg-[#141414] border border-white/10 px-3 py-2 text-sm w-56"
      />
      <button
        data-testid="new-project-create"
        type="submit"
        disabled={loading}
        className="bg-[#FFCC00] text-black px-4 py-2 text-sm font-bold uppercase tracking-wider"
      >
        {loading ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-neutral-500 hover:text-white px-2"
      >
        ✕
      </button>
    </form>
  );
}

function ShareButton({ projectId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState({ enabled: false, token: null });
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (!open || !projectId) return;
    (async () => {
      try {
        const { data } = await apiClient.get(`/projects/${projectId}/share`);
        setState(data);
      } catch {/* ignore */}
    })();
  }, [open, projectId]);

  const shareUrl = state.token ? `${window.location.origin}/share/${state.token}` : "";

  const enable = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.post(`/projects/${projectId}/share`);
      setState(data);
    } finally { setLoading(false); }
  };
  const rotate = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.post(`/projects/${projectId}/share/rotate`);
      setState(data);
      setCopied(false);
    } finally { setLoading(false); }
  };
  const disable = async () => {
    if (!window.confirm("Revoke this share link? Anyone who has the URL will lose access.")) return;
    setLoading(true);
    try {
      await apiClient.delete(`/projects/${projectId}/share`);
      setState({ enabled: false, token: null });
    } finally { setLoading(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {/* ignore */}
  };

  return (
    <>
      <button
        data-testid="share-button"
        onClick={() => setOpen(true)}
        className="ml-2 label-mono px-3 py-2 border border-[#0055FF]/60 text-[#5588FF] hover:bg-[#0055FF] hover:text-white transition-colors flex items-center gap-2"
        title="Share read-only link with client"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" /></svg>
        SHARE
      </button>

      {open && (
        <div
          data-testid="share-modal"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="bg-[#0f0f0f] border border-white/10 w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <div>
                <div className="label-mono text-[#5588FF]">// CLIENT SHARE</div>
                <div className="font-display text-xl mt-1">Share this project</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white text-2xl leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-neutral-400 leading-relaxed">
                Anyone with the link can view this project's 3D model, blueprint, and materials list — read-only,
                no login required. Perfect for sharing proposals with clients.
              </p>

              {!state.enabled ? (
                <button
                  data-testid="share-enable"
                  onClick={enable}
                  disabled={loading}
                  className="w-full bg-[#0055FF] hover:bg-[#0044DD] text-white font-bold py-3 uppercase tracking-wider text-sm"
                >
                  {loading ? "Generating…" : "Generate share link"}
                </button>
              ) : (
                <>
                  <div className="flex items-stretch">
                    <input
                      data-testid="share-url-input"
                      readOnly
                      value={shareUrl}
                      onClick={(e) => e.target.select()}
                      className="flex-1 bg-black border border-white/15 px-3 py-2.5 font-mono text-xs text-neutral-300 truncate"
                    />
                    <button
                      data-testid="share-copy"
                      onClick={copy}
                      className={`px-4 font-bold text-xs uppercase tracking-wider border ${copied ? "bg-[#00CC66] text-black border-[#00CC66]" : "bg-[#FFCC00] text-black border-[#FFCC00] hover:bg-[#E6B800]"}`}
                    >
                      {copied ? "✓ COPIED" : "COPY"}
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 font-mono">
                    Created {state.created_at ? new Date(state.created_at).toLocaleString() : "—"}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      data-testid="share-open"
                      href={shareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-center border border-white/15 hover:bg-white/5 px-3 py-2 text-xs font-bold uppercase tracking-wider"
                    >Open ↗</a>
                    <button
                      data-testid="share-rotate"
                      onClick={rotate}
                      disabled={loading}
                      className="border border-[#FF6600]/60 text-[#FF6600] hover:bg-[#FF6600] hover:text-black px-3 py-2 text-xs font-bold uppercase tracking-wider"
                    >Rotate link</button>
                  </div>
                  <button
                    data-testid="share-disable"
                    onClick={disable}
                    disabled={loading}
                    className="w-full border border-[#FF3333]/40 text-[#FF6666] hover:bg-[#FF3333]/10 px-3 py-2 text-xs font-bold uppercase tracking-wider"
                  >Revoke link</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


function TeamButton({ projectId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        data-testid="team-button"
        onClick={() => setOpen(true)}
        className="ml-2 label-mono px-3 py-2 border border-[#FFCC00]/60 text-[#FFCC00] hover:bg-[#FFCC00] hover:text-black transition-colors flex items-center gap-2"
        title="Team, activity, branding"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="7" r="4" /><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          <circle cx="17" cy="7" r="3" /><path d="M21 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
        TEAM
      </button>
      {open && <CollabModal projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

