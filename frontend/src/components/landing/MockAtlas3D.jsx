import React from "react";

/**
 * Isometric 3D building mock — simulates the Atlas renderer output.
 * Stacked floors, roof, and a subtle 15-phase progress rail below.
 */
export default function MockAtlas3D() {
  return (
    <div className="w-full h-full bg-[#0A0A0A] relative overflow-hidden">
      <svg viewBox="0 0 200 140" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#111" />
            <stop offset="1" stopColor="#0A0A0A" />
          </linearGradient>
          <linearGradient id="wall-front" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#c9a76b" />
            <stop offset="1" stopColor="#a17d3a" />
          </linearGradient>
          <linearGradient id="wall-side" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8d6a2e" />
            <stop offset="1" stopColor="#5c4520" />
          </linearGradient>
        </defs>
        <rect width="200" height="140" fill="url(#sky)" />
        {/* Ground grid — perspective */}
        <g stroke="#1a2028" strokeWidth={0.3}>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={0} y1={100 + i * 5} x2={200} y2={100 + i * 5} />
          ))}
        </g>

        {/* Building — floor 1 */}
        <g>
          <polygon points="60,105 130,105 130,80 60,80" fill="url(#wall-front)" stroke="#3a2c14" strokeWidth={0.4} />
          <polygon points="130,105 160,90 160,65 130,80" fill="url(#wall-side)" stroke="#3a2c14" strokeWidth={0.4} />
          <polygon points="60,80 130,80 160,65 90,65" fill="#7a5f2b" stroke="#3a2c14" strokeWidth={0.3} opacity={0.4} />
          {/* windows floor 1 */}
          <rect x={70} y={87} width={10} height={10} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
          <rect x={90} y={87} width={10} height={10} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
          <rect x={110} y={87} width={10} height={10} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
          {/* door */}
          <rect x={85} y={92} width={6} height={13} fill="#2a1a08" stroke="#3a2c14" strokeWidth={0.2} />
        </g>

        {/* Floor 2 */}
        <g>
          <polygon points="60,80 130,80 130,60 60,60" fill="url(#wall-front)" opacity={0.95} stroke="#3a2c14" strokeWidth={0.4} />
          <polygon points="130,80 160,65 160,45 130,60" fill="url(#wall-side)" opacity={0.95} stroke="#3a2c14" strokeWidth={0.4} />
          <rect x={72} y={67} width={8} height={8} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
          <rect x={88} y={67} width={8} height={8} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
          <rect x={104} y={67} width={8} height={8} fill="#0f2a3a" stroke="#00e5ff" strokeWidth={0.2} />
        </g>

        {/* Roof (pitched) */}
        <g>
          <polygon points="60,60 95,40 130,60" fill="#4a3020" stroke="#221510" strokeWidth={0.3} />
          <polygon points="130,60 160,45 125,25 95,40" fill="#382418" stroke="#221510" strokeWidth={0.3} />
        </g>

        {/* Phase progress rail */}
        <g transform="translate(10, 128)">
          {Array.from({ length: 15 }, (_, i) => (
            <rect key={i} x={i * 12} y={0} width={10} height={4} fill={i < 11 ? "#FFCC00" : "#262626"} />
          ))}
        </g>
      </svg>

      {/* HUD */}
      <div className="absolute top-2 left-2 label-mono text-[9px] text-[#00E5FF]">// 3D RENDERER · PHASE 11 / 15</div>
      <div className="absolute top-2 right-2 label-mono text-[9px] text-[#FFCC00]">STUDIO · 4K</div>
      <div className="absolute bottom-2 left-2 label-mono text-[9px] text-neutral-500">// WALL SHEET</div>
    </div>
  );
}
