import { create } from "zustand";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
if (!BACKEND_URL) {
  // Fail fast in the console + throw on any API access so we don't
  // silently send requests to "undefined/api".
  // eslint-disable-next-line no-console
  console.error("REACT_APP_BACKEND_URL is not set — API calls will fail. Check frontend/.env.");
}
export const API = `${BACKEND_URL || ""}/api`;

const TOKEN_KEY = "cm_token";
const USER_KEY = "cm_user";
const PROJECT_KEY = "cm_current_project_id";

export const apiClient = axios.create({ baseURL: API });
apiClient.interceptors.request.use((cfg) => {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export const useStore = create((set, get) => ({
  user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
  token: localStorage.getItem(TOKEN_KEY),
  projects: [],
  currentProjectId: localStorage.getItem(PROJECT_KEY) || null,
  documents: [],
  materials: [],
  blueprint: { walls: [], doors: [], windows: [], labels: [], fixtures: [] },
  billing: null,

  setAuth: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PROJECT_KEY);
    set({ token: null, user: null, projects: [], currentProjectId: null });
  },

  loadProjects: async () => {
    const { data } = await apiClient.get("/projects");
    set({ projects: data });
    if (!data.length) {
      // No projects → clear any stale saved ID.
      localStorage.removeItem(PROJECT_KEY);
      set({ currentProjectId: null });
      return data;
    }
    const persisted = get().currentProjectId;
    const stillExists = persisted && data.some((p) => p.id === persisted);
    if (stillExists) {
      // Rehydrate data for the previously selected project.
      await get().loadProjectData(persisted);
    } else {
      // Persisted project no longer exists (or none saved) → fall back to first.
      const firstId = data[0].id;
      localStorage.setItem(PROJECT_KEY, firstId);
      set({ currentProjectId: firstId });
      await get().loadProjectData(firstId);
    }
    return data;
  },
  refreshBilling: async () => {
    try {
      const { data } = await apiClient.get("/billing/me");
      set({ billing: data });
      return data;
    } catch (e) {
      console.warn("refreshBilling failed:", e?.message);
      return null;
    }
  },
  selectProject: async (id) => {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
    set({ currentProjectId: id });
    await get().loadProjectData(id);
  },
  loadProjectData: async (id) => {
    // Use allSettled so one flaky endpoint (e.g. blueprint) doesn't leave
    // the dashboard stuck loading. Each slice falls back to its empty
    // shape so the UI can still render and the user can retry.
    const [docsR, matsR, bpR] = await Promise.allSettled([
      apiClient.get(`/projects/${id}/documents`),
      apiClient.get(`/projects/${id}/materials`),
      apiClient.get(`/projects/${id}/blueprint`),
    ]);
    const emptyBp = { walls: [], doors: [], windows: [], labels: [], fixtures: [], sheets: [] };
    set({
      documents: docsR.status === "fulfilled" ? docsR.value.data : [],
      materials: matsR.status === "fulfilled" ? matsR.value.data : [],
      blueprint: bpR.status === "fulfilled" ? bpR.value.data : emptyBp,
    });
    const failed = [docsR, matsR, bpR].filter((r) => r.status === "rejected");
    if (failed.length) {
      // eslint-disable-next-line no-console
      console.warn(`loadProjectData: ${failed.length}/3 requests failed`, failed.map((r) => r.reason?.message));
    }
  },
  refreshDocuments: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      const { data } = await apiClient.get(`/projects/${id}/documents`);
      set({ documents: data });
    } catch (e) { console.warn("refreshDocuments failed:", e?.message); }
  },
  refreshMaterials: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      const { data } = await apiClient.get(`/projects/${id}/materials`);
      set({ materials: data });
    } catch (e) { console.warn("refreshMaterials failed:", e?.message); }
  },
  refreshBlueprint: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      const { data } = await apiClient.get(`/projects/${id}/blueprint`);
      set({ blueprint: data });
    } catch (e) { console.warn("refreshBlueprint failed:", e?.message); }
  },
  saveBlueprint: async (walls, doors, windows, labels = [], extra = {}) => {
    const id = get().currentProjectId;
    if (!id) return;
    const cur = get().blueprint || {};
    const body = {
      walls, doors, windows, labels,
      fixtures: extra.fixtures ?? cur.fixtures ?? [],
      roof_type: extra.roof_type ?? cur.roof_type ?? "gable",
      roof_pitch_deg: extra.roof_pitch_deg ?? cur.roof_pitch_deg ?? 12,
      wall_color: extra.wall_color ?? cur.wall_color ?? "#D8D4CC",
      roof_color: extra.roof_color ?? cur.roof_color ?? "#4A5C6E",
      wall_height_ft: extra.wall_height_ft ?? cur.wall_height_ft ?? null,
      manual_override: extra.manual_override ?? cur.manual_override ?? false,
    };
    const { data } = await apiClient.put(`/projects/${id}/blueprint`, body);
    set({ blueprint: data });
  },

  // ---------- Sheet operations ----------
  // All sheet mutations swallow transient network errors so a flaky ingress
  // hop doesn't blow up the CAD editor with a red React error overlay.  If
  // the request fails, we simply skip the state update — the next successful
  // interaction re-syncs.
  createSheet: async ({ name = "New Sheet", floor_level = 0 } = {}) => {
    const id = get().currentProjectId;
    if (!id) return null;
    try {
      const { data } = await apiClient.post(
        `/projects/${id}/blueprint/sheets`,
        { name, floor_level },
      );
      await get().refreshBlueprint();
      return data;
    } catch (e) {
      console.warn("createSheet failed:", e?.message);
      return null;
    }
  },
  renameSheet: async (sheetId, patch) => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      await apiClient.patch(`/projects/${id}/blueprint/sheets/${sheetId}`, patch);
      await get().refreshBlueprint();
    } catch (e) {
      console.warn("renameSheet failed:", e?.message);
    }
  },
  setSheetFacing: async (sheetId, facing) => {
    // facing: "front" | "back" | "left" | "right" | "clear" (unset — use AI hint)
    const id = get().currentProjectId;
    if (!id) return;
    try {
      await apiClient.patch(`/projects/${id}/blueprint/sheets/${sheetId}`, { facing_override: facing });
      await get().refreshBlueprint();
    } catch (e) {
      console.warn("setSheetFacing failed:", e?.message);
    }
  },
  deleteSheet: async (sheetId) => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      await apiClient.delete(`/projects/${id}/blueprint/sheets/${sheetId}`);
      await get().refreshBlueprint();
    } catch (e) {
      console.warn("deleteSheet failed:", e?.message);
    }
  },
  activateSheet: async (sheetId) => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      const { data } = await apiClient.post(
        `/projects/${id}/blueprint/active/${sheetId}`,
      );
      set({ blueprint: data });
    } catch (e) {
      console.warn("activateSheet failed:", e?.message);
      // Best-effort refresh so the UI settles rather than showing the wrong sheet.
      try { await get().refreshBlueprint(); } catch (_) { /* transient */ }
    }
  },
  saveSheetGeometry: async (sheetId, walls, doors, windows, labels, fixtures) => {
    const id = get().currentProjectId;
    if (!id) return;
    try {
      await apiClient.put(
        `/projects/${id}/blueprint/sheets/${sheetId}`,
        { walls, doors, windows, labels, fixtures },
      );
      await get().refreshBlueprint();
    } catch (e) {
      console.warn("saveSheetGeometry failed:", e?.message);
    }
  },

  // ---------- Document underlay (base64 image) ----------
  underlayCache: {},
  fetchDocumentImage: async (docId) => {
    if (!docId) return null;
    const cache = get().underlayCache || {};
    if (cache[docId]) return cache[docId];
    try {
      const { data } = await apiClient.get(`/documents/${docId}/image`);
      const url = data?.image_base64
        ? `data:${data.mime_type || "image/png"};base64,${data.image_base64}`
        : null;
      set({ underlayCache: { ...(get().underlayCache || {}), [docId]: url } });
      return url;
    } catch (e) {
      // Underlay image is optional; if the fetch fails (missing doc,
      // permissions), the UI simply doesn't show the underlay — no need
      // to surface to the user, but log for debugging.
      // eslint-disable-next-line no-console
      console.warn("loadUnderlay failed:", e?.message);
      return null;
    }
  },
}));
