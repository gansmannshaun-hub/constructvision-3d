import React from "react";

/**
 * SketchUp-style CAD mock — approximates the Atlas 2D editor with
 * yellow-highlighted toolbar, blueprint grid, walls, doors, labels.
 * Pure SVG, no runtime cost.
 */
export default function MockAtlasCad() {
  return (
    <div className="w-full h-full bg-[#F5F5F0] text-black relative overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-[#E8E8E0] border-b border-[#BBB]">
        {[..."SLRCDIW"].map((k, i) => (
          <div key={i} className={`w-5 h-5 flex items-center justify-center text-[8px] font-mono ${i === 1 ? "bg-[#FFCC00] text-black" : "bg-white border border-[#CCC] text-[#333]"}`}>
            {k}
          </div>
        ))}
        <div className="w-px h-4 bg-[#CCC] mx-1" />
        <div className="text-[7px] font-mono px-2 py-0.5 bg-white border border-[#CCC]">↶ UNDO</div>
        <div className="text-[7px] font-mono px-2 py-0.5 bg-white border border-[#CCC]">↷ REDO</div>
        <div className="flex-1" />
        <div className="text-[7px] font-mono text-[#FF3333]">● UNSAVED</div>
      </div>
      {/* Canvas */}
      <svg viewBox="0 0 200 120" className="w-full h-[calc(100%-28px)]" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {Array.from({ length: 21 }, (_, i) => (
          <line key={`v${i}`} x1={i * 10} y1={0} x2={i * 10} y2={120} stroke="#dedecf" strokeWidth={i % 5 === 0 ? 0.3 : 0.15} />
        ))}
        {Array.from({ length: 13 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={i * 10} x2={200} y2={i * 10} stroke="#dedecf" strokeWidth={i % 5 === 0 ? 0.3 : 0.15} />
        ))}
        {/* Walls (double-line poché) */}
        <g stroke="#111" strokeWidth={0.6} fill="#fff">
          <rect x={30} y={25} width={140} height={70} />
          <line x1={30} y1={60} x2={110} y2={60} strokeWidth={0.6} />
          <line x1={110} y1={25} x2={110} y2={95} strokeWidth={0.6} />
        </g>
        {/* Doors (arc swings) */}
        <g stroke="#333" fill="none" strokeWidth={0.4}>
          <path d="M 60 60 A 10 10 0 0 1 70 50" />
          <path d="M 130 25 A 8 8 0 0 1 138 33" />
        </g>
        {/* Labels */}
        <g fontFamily="IBM Plex Mono, monospace" fontSize={4} textAnchor="middle">
          <rect x={45} y={38} width={26} height={7} fill="rgba(255,255,255,0.85)" stroke="#333" strokeWidth={0.2} />
          <text x={58} y={43} fill="#1a1a1a" fontWeight="600">KITCHEN</text>
          <rect x={125} y={38} width={30} height={7} fill="rgba(255,255,255,0.85)" stroke="#333" strokeWidth={0.2} />
          <text x={140} y={43} fill="#1a1a1a" fontWeight="600">BEDROOM</text>
          <rect x={135} y={73} width={22} height={7} fill="#FFCC00" stroke="#000" strokeWidth={0.3} />
          <text x={146} y={78} fill="#1a1a1a" fontWeight="600">BATH</text>
        </g>
        {/* Dimension chain */}
        <g stroke="#0055FF" strokeWidth={0.2} fill="#0055FF" fontFamily="IBM Plex Mono, monospace" fontSize={3}>
          <line x1={30} y1={18} x2={170} y2={18} />
          <line x1={30} y1={16} x2={30} y2={20} />
          <line x1={170} y1={16} x2={170} y2={20} />
          <text x={100} y={16} textAnchor="middle">28&apos; - 0&quot;</text>
        </g>
      </svg>
    </div>
  );
}
