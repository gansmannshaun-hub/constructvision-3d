/**
 * Renders a markdown-ish legal document with simple, dependency-free
 * formatting (headers, bold, lists, tables, code-fences).
 * We keep this lightweight to avoid bringing in a full markdown library
 * for a couple of legal documents.
 */
import React from "react";

const HEADER_RE = /^(#{1,6})\s+(.+)$/;
const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /(?<!\*)\*(?!\*)([^*\n]+)\*/g;
const TABLE_ROW_RE = /^\|.*\|$/;
const TABLE_SEP_RE = /^\|[-:\s|]+\|$/;
const HR_RE = /^---+$/;

function inline(text) {
  // Bold + italic. Escape HTML-sensitive chars first.
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe
    .replace(BOLD_RE, "<strong>$1</strong>")
    .replace(ITALIC_RE, "<em>$1</em>");
}

export default function LegalRenderer({ markdown, className = "" }) {
  const lines = (markdown || "").split("\n");
  const elements = [];
  let listBuffer = [];
  let tableBuffer = [];

  const flushList = () => {
    if (listBuffer.length) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-3 ml-5 list-disc space-y-1.5 text-neutral-300">
          {listBuffer.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: inline(item) }} />
          ))}
        </ul>,
      );
      listBuffer = [];
    }
  };

  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      const header = tableBuffer[0].slice(1, -1).split("|").map(c => c.trim());
      const rows = tableBuffer.slice(2).map(r => r.slice(1, -1).split("|").map(c => c.trim()));
      elements.push(
        <div key={`tbl-${elements.length}`} className="my-3 border border-white/10 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                {header.map((h, i) => (
                  <th key={i} className="text-left px-3 py-2 font-mono uppercase tracking-wide text-[#FFCC00]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-white/5 last:border-b-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-neutral-300"
                        dangerouslySetInnerHTML={{ __html: inline(cell) }} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    tableBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (TABLE_ROW_RE.test(line)) {
      flushList();
      tableBuffer.push(line);
      continue;
    } else if (tableBuffer.length) {
      flushTable();
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    const hMatch = line.match(HEADER_RE);
    if (hMatch) {
      flushList();
      const level = hMatch[1].length;
      const text = hMatch[2];
      const sizes = {
        1: "text-3xl font-display tracking-tight mt-4 mb-3",
        2: "text-xl font-display tracking-tight mt-6 mb-2 text-[#FFCC00]",
        3: "text-base font-semibold mt-4 mb-1 text-white",
      };
      const cls = sizes[level] || "text-sm font-semibold mt-3 mb-1";
      const Tag = `h${Math.min(level, 6)}`;
      elements.push(
        React.createElement(Tag, { key: `h-${i}`, className: cls,
          dangerouslySetInnerHTML: { __html: inline(text) } }),
      );
      continue;
    }

    if (HR_RE.test(line)) {
      flushList();
      elements.push(<hr key={`hr-${i}`} className="my-4 border-white/10" />);
      continue;
    }

    // Bullet list "- ..." or "* ..."
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listBuffer.push(bullet[1]);
      continue;
    }

    // Plain paragraph
    flushList();
    elements.push(
      <p key={`p-${i}`}
         className="text-sm text-neutral-300 leading-relaxed my-2"
         dangerouslySetInnerHTML={{ __html: inline(line) }} />,
    );
  }
  flushList();
  flushTable();

  return <div className={className}>{elements}</div>;
}
