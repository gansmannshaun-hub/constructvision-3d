import { create } from "zustand";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const TOKEN_KEY = "cm_token";
const USER_KEY = "cm_user";

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
  currentProjectId: null,
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
    set({ token: null, user: null, projects: [], currentProjectId: null });
  },

  loadProjects: async () => {
    const { data } = await apiClient.get("/projects");
    set({ projects: data });
    if (!get().currentProjectId && data.length) {
      set({ currentProjectId: data[0].id });
      await get().loadProjectData(data[0].id);
    }
    return data;
  },
  refreshBilling: async () => {
    try {
      const { data } = await apiClient.get("/billing/me");
      set({ billing: data });
      return data;
    } catch (e) {
      return null;
    }
  },
  selectProject: async (id) => {
    set({ currentProjectId: id });
    await get().loadProjectData(id);
  },
  loadProjectData: async (id) => {
    const [docs, mats, bp] = await Promise.all([
      apiClient.get(`/projects/${id}/documents`),
      apiClient.get(`/projects/${id}/materials`),
      apiClient.get(`/projects/${id}/blueprint`),
    ]);
    set({ documents: docs.data, materials: mats.data, blueprint: bp.data });
  },
  refreshDocuments: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    const { data } = await apiClient.get(`/projects/${id}/documents`);
    set({ documents: data });
  },
  refreshMaterials: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    const { data } = await apiClient.get(`/projects/${id}/materials`);
    set({ materials: data });
  },
  refreshBlueprint: async () => {
    const id = get().currentProjectId;
    if (!id) return;
    const { data } = await apiClient.get(`/projects/${id}/blueprint`);
    set({ blueprint: data });
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
    };
    const { data } = await apiClient.put(`/projects/${id}/blueprint`, body);
    set({ blueprint: data });
  },

  // ---------- Sheet operations ----------
  createSheet: async ({ name = "New Sheet", floor_level = 0 } = {}) => {
    const id = get().currentProjectId;
    if (!id) return null;
    const { data } = await apiClient.post(
      `/projects/${id}/blueprint/sheets`,
      { name, floor_level },
    );
    await get().refreshBlueprint();
    return data;
  },
  renameSheet: async (sheetId, patch) => {
    const id = get().currentProjectId;
    if (!id) return;
    await apiClient.patch(`/projects/${id}/blueprint/sheets/${sheetId}`, patch);
    await get().refreshBlueprint();
  },
  deleteSheet: async (sheetId) => {
    const id = get().currentProjectId;
    if (!id) return;
    await apiClient.delete(`/projects/${id}/blueprint/sheets/${sheetId}`);
    await get().refreshBlueprint();
  },
  activateSheet: async (sheetId) => {
    const id = get().currentProjectId;
    if (!id) return;
    const { data } = await apiClient.post(
      `/projects/${id}/blueprint/active/${sheetId}`,
    );
    set({ blueprint: data });
  },
  saveSheetGeometry: async (sheetId, walls, doors, windows, labels, fixtures) => {
    const id = get().currentProjectId;
    if (!id) return;
    await apiClient.put(
      `/projects/${id}/blueprint/sheets/${sheetId}`,
      { walls, doors, windows, labels, fixtures },
    );
    await get().refreshBlueprint();
  },
}));
