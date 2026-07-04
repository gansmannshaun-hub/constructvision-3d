import React, { useEffect, useRef } from "react";

/**
 * Animated hero backdrop — a slow-drifting isometric blueprint grid with
 * subtle floating architectural glyphs. Pure canvas, no external deps.
 * Respects prefers-reduced-motion. Fixed 0.06 alpha keeps it hero-only,
 * never overwhelming the text.
 */
export default function HeroCanvas() {
  const ref = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let width = 0, height = 0;
    let t0 = performance.now();
    const dpi = Math.min(window.devicePixelRatio || 1, 2);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpi;
      canvas.height = height * dpi;
      ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // static glyphs positioned via % — geometric building marks
    const glyphs = [
      { x: 0.15, y: 0.28, size: 90, kind: "circle" },
      { x: 0.72, y: 0.22, size: 110, kind: "square" },
      { x: 0.85, y: 0.62, size: 140, kind: "triangle" },
      { x: 0.20, y: 0.72, size: 80, kind: "cross" },
      { x: 0.55, y: 0.85, size: 100, kind: "square" },
    ];

    const draw = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, width, height);

      // Base grid
      const step = 48;
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      const off = prefersReducedMotion ? 0 : (t * 6) % step;
      ctx.beginPath();
      for (let x = -step + off; x < width + step; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = -step + off; y < height + step; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Major grid every 5 lines
      ctx.strokeStyle = "rgba(0,229,255,0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -step + off; x < width + step; x += step * 5) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = -step + off; y < height + step; y += step * 5) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Drifting radial vignette
      const grad = ctx.createRadialGradient(width * 0.75, height * 0.35, 20, width * 0.75, height * 0.35, Math.max(width, height));
      grad.addColorStop(0, "rgba(0,229,255,0.05)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Architectural glyphs — slow orbit
      glyphs.forEach((g, i) => {
        const osc = prefersReducedMotion ? 0 : Math.sin(t * 0.4 + i) * 6;
        const cx = g.x * width + osc;
        const cy = g.y * height + Math.cos(t * 0.3 + i) * 4;
        ctx.save();
        ctx.strokeStyle = i % 2 === 0 ? "rgba(255,204,0,0.35)" : "rgba(0,229,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (g.kind === "circle") {
          ctx.arc(cx, cy, g.size / 2, 0, Math.PI * 2);
        } else if (g.kind === "square") {
          ctx.rect(cx - g.size / 2, cy - g.size / 2, g.size, g.size);
        } else if (g.kind === "triangle") {
          ctx.moveTo(cx, cy - g.size / 2);
          ctx.lineTo(cx + g.size / 2, cy + g.size / 2);
          ctx.lineTo(cx - g.size / 2, cy + g.size / 2);
          ctx.closePath();
        } else if (g.kind === "cross") {
          ctx.moveTo(cx - g.size / 2, cy);
          ctx.lineTo(cx + g.size / 2, cy);
          ctx.moveTo(cx, cy - g.size / 2);
          ctx.lineTo(cx, cy + g.size / 2);
        }
        ctx.stroke();
        // corner marks
        const s = 6;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        [[cx - g.size / 2, cy - g.size / 2], [cx + g.size / 2, cy - g.size / 2], [cx - g.size / 2, cy + g.size / 2], [cx + g.size / 2, cy + g.size / 2]].forEach(([px, py]) => {
          ctx.beginPath();
          ctx.moveTo(px - s, py);
          ctx.lineTo(px + s, py);
          ctx.moveTo(px, py - s);
          ctx.lineTo(px, py + s);
          ctx.stroke();
        });
        ctx.restore();
      });

      if (!prefersReducedMotion) rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      data-testid="hero-canvas"
      className="absolute inset-0 w-full h-full"
      aria-hidden="true"
    />
  );
}
