import React from "react";

/**
 * Inline SVG icon for each CAD tool. Kept as a single component so the
 * toolbar and any legend / help panel can render the same glyph.
 * `id` maps to the tool's `id` in constants.TOOLS.
 */
export const ToolIcon = ({ id, className = "" }) => {
  const s = {
    width: 22, height: 22, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round", strokeLinejoin: "round", className,
  };
  switch (id) {
    case "select":  return <svg {...s}><path d="M5 3l14 11h-7l4 7-3 1-4-7-4 4z" /></svg>;
    case "line":    return <svg {...s}><path d="M4 20L20 4" /><circle cx="4" cy="20" r="1.5" fill="currentColor" /><circle cx="20" cy="4" r="1.5" fill="currentColor" /></svg>;
    case "rect":    return <svg {...s}><rect x="4" y="4" width="16" height="16" /></svg>;
    case "circle":  return <svg {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>;
    case "door":    return <svg {...s}><path d="M6 3v18h12V3z" /><path d="M14 12h.01" /><path d="M18 21l-12-9V3" strokeOpacity="0.4" /></svg>;
    case "window":  return <svg {...s}><rect x="4" y="4" width="16" height="16" /><path d="M12 4v16M4 12h16" /></svg>;
    case "eraser":  return <svg {...s}><path d="M21 14L11 4l-7 7 10 10h7z" /><path d="M14 21l-3-3" /><path d="M3 21h18" /></svg>;
    case "tape":    return <svg {...s}><path d="M3 9h18v6H3z" /><path d="M7 9v6M11 9v6M15 9v6M19 9v3" /></svg>;
    case "move":    return <svg {...s}><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg>;
    case "offset":  return <svg {...s}><path d="M5 6l14 0M5 18l14 0" /><path d="M9 10l-3 2 3 2" /><path d="M5 12h7" /></svg>;
    case "text":    return <svg {...s}><path d="M5 5h14M12 5v14M9 19h6" /></svg>;
    case "pan":     return <svg {...s}><path d="M9 11V5a2 2 0 0 1 4 0v6M13 7v9a2 2 0 0 1-4 0V9M5 13l1 3a4 4 0 0 0 4 3h2a4 4 0 0 0 4-4v-4" /></svg>;
    case "zoom":    return <svg {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M8 11h6M11 8v6" /></svg>;
    default:        return null;
  }
};
