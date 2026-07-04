import React from "react";

/**
 * Blueprint mock — two variants:
 *   - extract: cyanotype blueprint being sliced apart by an AI scan line
 *   - map:     satellite tile with a 3D building placed on it
 */
export default function MockAtlasBlueprint({ variant = "extract" }) {
  if (variant === "map") return <MapVariant />;
  return <ExtractVariant />;
}

function ExtractVariant() {
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: "#0B3B5C" }}>
      <svg viewBox="0 0 280 200" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="bp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.4" />
          </pattern>
          <pattern id="bp-grid-major" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.4" />
          </pattern>
        </defs>
        <rect width="280" height="200" fill="url(#bp-grid)" />
        <rect width="280" height="200" fill="url(#bp-grid-major)" />

        {/* Traced walls emerging from the scan */}
        <g stroke="#fff" strokeWidth={1} fill="rgba(255,255,255,0.85)">
          <rect x={40} y={40} width={200} height={120} fill="rgba(255,255,255,0.05)" />
          <line x1={140} y1={40} x2={140} y2={160} strokeWidth={1.2} />
          <line x1={40} y1={100} x2={140} y2={100} strokeWidth={1.2} />
          <line x1={140} y1={130} x2={240} y2={130} strokeWidth={1.2} />
        </g>

        {/* Labels */}
        <g fontFamily="IBM Plex Mono, monospace" fontSize={5} textAnchor="middle" fill="#00E5FF">
          <text x={90} y={70}>KITCHEN</text>
          <text x={90} y={130}>LIVING</text>
          <text x={190} y={85}>BED · 01</text>
          <text x={190} y={145}>BATH</text>
        </g>

        {/* Fixtures */}
        <g stroke="#FFCC00" strokeWidth={0.5} fill="rgba(255,204,0,0.15)">
          <rect x={155} y={135} width={20} height={12} />
          <rect x={200} y={135} width={12} height={12} />
          <circle cx={70} cy={62} r={6} />
        </g>

        {/* Dimensions */}
        <g stroke="#FFCC00" strokeWidth={0.3} fontFamily="IBM Plex Mono, monospace" fontSize={4} fill="#FFCC00">
          <line x1={40} y1={28} x2={240} y2={28} />
          <line x1={40} y1={25} x2={40} y2={31} />
          <line x1={240} y1={25} x2={240} y2={31} />
          <text x={140} y={24} textAnchor="middle">40&apos; - 0&quot;</text>
        </g>

        {/* AI Scan line */}
        <g>
          <line x1={0} y1={110} x2={280} y2={110} stroke="#00E5FF" strokeWidth={1.5} opacity={0.9}>
            <animate attributeName="y1" values="20;180;20" dur="6s" repeatCount="indefinite" />
            <animate attributeName="y2" values="20;180;20" dur="6s" repeatCount="indefinite" />
          </line>
          <line x1={0} y1={110} x2={280} y2={110} stroke="#00E5FF" strokeWidth={4} opacity={0.15}>
            <animate attributeName="y1" values="20;180;20" dur="6s" repeatCount="indefinite" />
            <animate attributeName="y2" values="20;180;20" dur="6s" repeatCount="indefinite" />
          </line>
        </g>

        {/* Crosshairs */}
        <g stroke="rgba(255,204,0,0.5)" strokeWidth={0.4}>
          <circle cx={40} cy={40} r={4} fill="none" />
          <circle cx={240} cy={40} r={4} fill="none" />
          <circle cx={40} cy={160} r={4} fill="none" />
          <circle cx={240} cy={160} r={4} fill="none" />
        </g>
      </svg>
      <div className="absolute top-2 left-3 label-mono text-white/70 text-[9px]">// AI SCAN · 12 WALLS · 4 LABELS · 3 FIXTURES</div>
      <div className="absolute bottom-2 right-3 label-mono text-[#FFCC00] text-[9px]">GPT-4o + OPENCV</div>
    </div>
  );
}

function MapVariant() {
  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: "#1a2618" }}>
      <svg viewBox="0 0 220 160" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="sat" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="#243522" />
            <rect x={0} y={0} width={2} height={2} fill="#2f4229" />
            <rect x={2} y={2} width={2} height={2} fill="#1c2818" />
          </pattern>
        </defs>
        <rect width="220" height="160" fill="url(#sat)" />
        {/* roads */}
        <g stroke="#4a4a3a" strokeWidth={4} fill="none">
          <line x1={0} y1={40} x2={220} y2={40} />
          <line x1={160} y1={0} x2={160} y2={160} />
        </g>
        <g stroke="#7a7a5a" strokeWidth={0.4} strokeDasharray="3 3" fill="none">
          <line x1={0} y1={40} x2={220} y2={40} />
          <line x1={160} y1={0} x2={160} y2={160} />
        </g>
        {/* lot outline */}
        <rect x={60} y={70} width={70} height={60} fill="none" stroke="#FFCC00" strokeWidth={0.6} strokeDasharray="3 2" />
        {/* placed building (top-down) */}
        <g transform="translate(78, 82)">
          <polygon points="0,0 40,0 40,32 0,32" fill="rgba(255,204,0,0.35)" stroke="#FFCC00" strokeWidth={0.6} />
          <line x1={20} y1={0} x2={20} y2={32} stroke="#FFCC00" strokeWidth={0.4} />
          <text x={10} y={20} fill="#000" fontFamily="IBM Plex Mono, monospace" fontSize={4} textAnchor="middle" fontWeight={600}>A</text>
          <text x={30} y={20} fill="#000" fontFamily="IBM Plex Mono, monospace" fontSize={4} textAnchor="middle" fontWeight={600}>B</text>
        </g>
        {/* compass */}
        <g transform="translate(190, 20)" stroke="#00E5FF" strokeWidth={0.4} fill="#00E5FF" fontFamily="IBM Plex Mono, monospace" fontSize={5}>
          <circle cx={0} cy={0} r={8} fill="none" />
          <polygon points="0,-7 -2,0 0,3 2,0" />
          <text x={0} y={-10} textAnchor="middle">N</text>
        </g>
        {/* readouts */}
        <g fontFamily="IBM Plex Mono, monospace" fontSize={4}>
          <text x={5} y={155} fill="#00E5FF">37.7749°N · 122.4194°W</text>
          <text x={215} y={155} fill="#FFCC00" textAnchor="end">SCALE · AI-MATCHED · 1:120</text>
        </g>
      </svg>
      <div className="absolute top-2 left-3 label-mono text-white/70 text-[9px]">// PLACE ON MAP</div>
    </div>
  );
}
