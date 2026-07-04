import React from "react";

/**
 * Framed image wrapper for real Atlas screenshots on the marketing pages.
 * Adds a subtle border, hides the "signed in as" chrome behind the fold,
 * and provides a small "// ATLAS · LIVE UI" caption so viewers know it's
 * the actual product.
 */
export function AppScreenshot({ src, alt, caption = "// ATLAS · LIVE UI", crop = "top" }) {
  const objectPosition =
    crop === "center" ? "center center"
    : crop === "bottom" ? "center bottom"
    : "center top";
  return (
    <div
      data-testid="app-screenshot"
      className="w-full h-full relative bg-[#0F0F0F] overflow-hidden"
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition }}
      />
      {/* Subtle gradient to darken the top signed-in-as chrome so viewers focus on the canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-14"
        style={{ background: "linear-gradient(to bottom, rgba(10,10,10,0.65), rgba(10,10,10,0))" }}
      />
      <div className="pointer-events-none absolute bottom-2 left-3 label-mono text-white/70 text-[9px] bg-black/60 px-2 py-1 backdrop-blur-sm">
        {caption}
      </div>
    </div>
  );
}
