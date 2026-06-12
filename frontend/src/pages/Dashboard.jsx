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
        <div className="flex items-stretch">
          <div className="flex items-center gap-3 px-6 py-4 border-r border-white/10">
            <div className="w-8 h-8 bg-[#FFCC00] flex items-center justify-center">
              <span className="font-display text-black text-lg">A</span>
            </div>
            <div>
              <div className="font-display text-lg leading-none tracking-tighter">ATLAS</div>
              <div className="label-mono text-[9px] leading-none mt-1">CONSTRUCTION&nbsp;OS</div>
            </div>
          </div>

          <div className="flex-1 flex items-center px-6 gap-6 overflow-x-auto">
            <div>
              <div className="label-mono">// PROJECT</div>
              <select
                data-testid="project-selector"
                value={currentProjectId || ""}
                onChange={(e) => selectProject(e.target.value)}
                className="bg-transparent text-white font-mono text-sm mt-1 outline-none cursor-pointer hover:text-[#FFCC00] transition-colors"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-black">
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <NewProjectButton />
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
              <div className="font-mono text-xs mt-0.5">⚙</div>
            </Link>
            <div className="px-6 py-3 flex flex-col justify-center">
              <div className="label-mono">SIGNED IN</div>
              <div className="font-mono text-sm" data-testid="current-user">{user?.email}</div>
            </div>
            <button
              data-testid="logout-button"
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="px-6 hover:bg-[#1E1E1E] text-neutral-400 hover:text-white transition-colors text-sm uppercase tracking-wider font-mono"
            >
              Logout →
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
        ) : (
          <div className="p-12 text-center text-neutral-500 font-mono">Loading project...</div>
        )}
      </main>
    </div>
  );
}

function NewProjectButton() {
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
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        data-testid="new-project-button"
        onClick={() => setOpen(true)}
        className="ml-auto label-mono border border-white/10 px-4 py-2 hover:bg-[#FFCC00] hover:text-black hover:border-[#FFCC00] transition-all duration-150"
      >
        + NEW PROJECT
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
        Create
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
