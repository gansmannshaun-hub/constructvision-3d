// CAD editor constants — style catalogs, tool config, and layout limits.
// Extracted from CadEditorTab.jsx for reuse and to shrink the mega-file.

export const VIEWBOX_MIN = 0;
export const VIEWBOX_MAX = 100;
export const GRID_STEP_DEFAULT = 2; // major grid step in coord units (feet)
export const GRID_STEP_OPTIONS = [0.5, 1, 2, 5, 10]; // feet per grid square
export const SNAP_THRESHOLD = 3; // distance in coord units within which we snap
export const CIRCLE_SEGMENTS = 16;

// ---------- Style catalogs ----------
export const DOOR_STYLES = [
  { value: "panel",     label: "Panel · 32\"",          default_in: 32 },
  { value: "panel_36",  label: "Panel · 36\" (Front)",  default_in: 36 },
  { value: "french",    label: "French · 60\"",         default_in: 60 },
  { value: "sliding",   label: "Sliding · 72\"",        default_in: 72 },
  { value: "barn",      label: "Barn · 36\"",           default_in: 36 },
  { value: "pocket",    label: "Pocket · 30\"",         default_in: 30 },
  { value: "bath",      label: "Bath · 28\"",           default_in: 28 },
];
export const WINDOW_STYLES = [
  { value: "dh",        label: "Double Hung · 36\"",    default_in: 36 },
  { value: "sh",        label: "Single Hung · 30\"",    default_in: 30 },
  { value: "casement",  label: "Casement · 24\"",       default_in: 24 },
  { value: "sliding",   label: "Sliding · 48\"",        default_in: 48 },
  { value: "picture",   label: "Picture · 60\"",        default_in: 60 },
  { value: "bay",       label: "Bay · 72\"",            default_in: 72 },
  { value: "awning",    label: "Awning · 30\"",         default_in: 30 },
  { value: "egress",    label: "Egress · 36\"",         default_in: 36 },
];
export const WALL_STYLES = [
  { value: "int_4",     label: "Interior · 4\"",        thickness_ft: 0.33 },
  { value: "ext_6",     label: "Exterior · 6\"",        thickness_ft: 0.5 },
  { value: "struct_8",  label: "Structural · 8\"",      thickness_ft: 0.67 },
  { value: "demising",  label: "Demising · 6\" Fire",   thickness_ft: 0.5 },
];

// Fixture symbol config — maps AI-traced `kind` to a short label + fill color.
export const FIXTURE_META = {
  toilet:        { label: "WC",     color: "#8FA8C0" },
  sink:          { label: "SINK",   color: "#8FA8C0" },
  shower:        { label: "SHWR",   color: "#8FA8C0" },
  tub:           { label: "TUB",    color: "#8FA8C0" },
  vanity:        { label: "VAN",    color: "#8FA8C0" },
  stove:         { label: "RANGE",  color: "#D0B090" },
  oven:          { label: "OVEN",   color: "#D0B090" },
  refrigerator:  { label: "FRIDGE", color: "#D0B090" },
  dishwasher:    { label: "DW",     color: "#D0B090" },
  washer:        { label: "WASH",   color: "#B0C0A0" },
  dryer:         { label: "DRYR",   color: "#B0C0A0" },
  island:        { label: "ISLAND", color: "#D0B090" },
  counter:       { label: "COUNTER", color: "#D0B090" },
  closet:        { label: "CLOSET", color: "#C8C8C8" },
  stairs:        { label: "STAIRS", color: "#B8B8B8" },
  bed:           { label: "BED",    color: "#C8B090" },
  sofa:          { label: "SOFA",   color: "#C8B090" },
  dining_table:  { label: "TABLE",  color: "#C8B090" },
  desk:          { label: "DESK",   color: "#C8B090" },
  fireplace:     { label: "FP",     color: "#A08080" },
  hvac_unit:     { label: "HVAC",   color: "#A0A8B0" },
  water_heater:  { label: "WH",     color: "#A0A8B0" },
  column:        { label: "COL",    color: "#606060" },
  other:         { label: "FIX",    color: "#B0B0B0" },
};

// Per-tool input config — drives the bottom-bar input placeholder + ↵ behavior.
export const TOOL_INPUT = {
  line:    { placeholder: "length (ft)",   unit: "ft", label: "LENGTH" },
  rect:    { placeholder: "side (ft)",     unit: "ft", label: "SIDE" },
  circle:  { placeholder: "radius (ft)",   unit: "ft", label: "RADIUS" },
  offset:  { placeholder: "distance (ft)", unit: "ft", label: "OFFSET" },
  door:    { placeholder: "width (in)",    unit: "in", label: "DOOR W" },
  window:  { placeholder: "width (in)",    unit: "in", label: "WIN W" },
};

export const TOOLS = [
  { id: "select",   key: "V", label: "Select",       hint: "Click an element to select. Backspace to delete." },
  { id: "line",     key: "L", label: "Line",         hint: "Click for start, click again to finish wall. ESC cancels." },
  { id: "rect",     key: "R", label: "Rectangle",    hint: "Click corner 1, then corner 2. Creates 4 walls." },
  { id: "circle",   key: "C", label: "Circle",       hint: "Click center, then drag to radius. Approximated to 16 segments." },
  { id: "door",     key: "D", label: "Door",         hint: "Click on a wall to drop a door." },
  { id: "window",   key: "W", label: "Window",       hint: "Click on a wall to drop a window." },
  { id: "eraser",   key: "E", label: "Eraser",       hint: "Click any element to remove it." },
  { id: "tape",     key: "T", label: "Tape Measure", hint: "Click two points to measure distance." },
  { id: "move",     key: "M", label: "Move",         hint: "Click an element, then click a destination." },
  { id: "offset",   key: "O", label: "Offset",       hint: "Click a wall, then click the side / type a distance and Enter." },
  { id: "text",     key: "X", label: "Text",         hint: "Click anywhere to place a text label." },
  { id: "pan",      key: "H", label: "Pan",          hint: "Drag to pan the view." },
  { id: "zoom",     key: "Z", label: "Zoom",         hint: "Click to zoom in. Shift+click to zoom out." },
];
