import React, { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useStore, apiClient } from "../store";
import DocumentsTab from "../components/DocumentsTab";
import MaterialsTab from "../components/MaterialsTab";
import BlueprintTab from "../components/BlueprintTab";
import CadEditorTab from "../components/CadEditorTab";
import RendererTab from "../components/RendererTab";

const TABS = [
  { id: "documents", label: "Documents", hint: "01" },
  { id: "materials", label: "Materials", hint: "02" },
  { id: "blueprint", label: "Blueprint", hint: "03" },
  { id: "cad", label: "2D CAD Editor", hint: "04" },
  { id: "renderer", label: "3D Renderer", hint: "05" },
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
