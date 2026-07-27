// Shared floor-material palette used by the 3D room builder + the
// Room editor UI panel. Visual only — pricing/takeoff is NOT affected
// (Session 4 scope, per user).
//
// Each entry:
//   id            – stable key persisted on `label.floor_material`
//   label         – dropdown display name
//   color         – hex color for the Three.js MeshStandardMaterial
//   roughness     – 0 (glossy) → 1 (matte)
//   metalness     – 0 (dielectric) → 1 (metallic)  — subtle for floors
export const FLOOR_MATERIALS = [
  { id: "hardwood",          label: "Hardwood",          color: "#8B5A2B", roughness: 0.55, metalness: 0.05 },
  { id: "tile",              label: "Tile",              color: "#E5E1D8", roughness: 0.35, metalness: 0.05 },
  { id: "carpet",            label: "Carpet",            color: "#7A6E5F", roughness: 0.95, metalness: 0.00 },
  { id: "concrete",          label: "Concrete",          color: "#9C9A94", roughness: 0.85, metalness: 0.02 },
  { id: "vinyl",             label: "Vinyl",             color: "#C9BFA9", roughness: 0.60, metalness: 0.04 },
  { id: "lvp",               label: "LVP (Luxury Vinyl Plank)", color: "#8C7355", roughness: 0.50, metalness: 0.06 },
  { id: "polished_concrete", label: "Polished Concrete", color: "#B4B2AC", roughness: 0.25, metalness: 0.15 },
  { id: "epoxy",             label: "Epoxy",             color: "#5F6E7A", roughness: 0.15, metalness: 0.25 },
  { id: "marble",            label: "Marble",            color: "#EDE8DC", roughness: 0.20, metalness: 0.10 },
];

export const DEFAULT_FLOOR_MATERIAL_ID = "concrete";

export function getFloorMaterial(id) {
  return FLOOR_MATERIALS.find((m) => m.id === id) || FLOOR_MATERIALS.find((m) => m.id === DEFAULT_FLOOR_MATERIAL_ID);
}

// Ceiling-height slider bounds (feet) — Session 4 spec: 7–14 ft, 0.5 ft steps.
export const CEILING_MIN_FT = 7;
export const CEILING_MAX_FT = 14;
export const CEILING_STEP_FT = 0.5;
export const CEILING_DEFAULT_FT = 10;

// ---------- Wall siding palette (visual only, MVP) ----------
// Used by the Materials tab palette view. Applying to walls is a
// future feature — for now this is a preview/browse-only swatch set.
export const WALL_MATERIALS = [
  { id: "drywall_paint",   label: "Drywall — Paint",        color: "#EEE7D6", roughness: 0.85, metalness: 0.02 },
  { id: "wood_siding",     label: "Wood Siding",             color: "#8C6A45", roughness: 0.75, metalness: 0.04 },
  { id: "brick_veneer",    label: "Brick Veneer",            color: "#8B4A3C", roughness: 0.90, metalness: 0.02 },
  { id: "stone_veneer",    label: "Stone Veneer",            color: "#8A857E", roughness: 0.88, metalness: 0.05 },
  { id: "stucco",          label: "Stucco",                  color: "#DDD4C2", roughness: 0.90, metalness: 0.01 },
  { id: "metal_panel",     label: "Metal Panel (Corrugated)",color: "#98A0A6", roughness: 0.30, metalness: 0.80 },
  { id: "board_batten",    label: "Board & Batten",          color: "#43524A", roughness: 0.80, metalness: 0.03 },
  { id: "shiplap",         label: "Shiplap",                 color: "#D5C79D", roughness: 0.70, metalness: 0.04 },
];

// ---------- Roof finish palette ----------
export const ROOF_MATERIALS = [
  { id: "asphalt_shingle", label: "Asphalt Shingle",        color: "#3C3B36", roughness: 0.85, metalness: 0.04 },
  { id: "standing_seam",   label: "Standing Seam Metal",    color: "#7A2E2E", roughness: 0.30, metalness: 0.70 },
  { id: "clay_tile",       label: "Clay Tile",              color: "#B65A3A", roughness: 0.80, metalness: 0.06 },
  { id: "slate",           label: "Slate",                  color: "#3A4048", roughness: 0.75, metalness: 0.10 },
  { id: "wood_shake",      label: "Wood Shake",             color: "#6E4A2E", roughness: 0.90, metalness: 0.02 },
  { id: "membrane_tpo",    label: "Membrane (TPO/EPDM)",    color: "#E8E5DE", roughness: 0.70, metalness: 0.05 },
];
