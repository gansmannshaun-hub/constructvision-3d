// Per-route SEO helper for the SPA. On every route change:
//   • Writes the correct `<link rel="canonical">` for THIS page (not just
//     the hardcoded homepage that index.html would otherwise ship).
//   • Sets `<meta name="robots">` to "noindex" on auth-gated / private
//     routes so Google Search Console stops burying the report under
//     "Page with redirect" for pages we never wanted indexed anyway.
//
// This is a lightweight replacement for react-helmet — one file, zero
// deps beyond react-router. If we ever add per-page <title>/OG tags,
// upgrade to react-helmet-async at that point.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const CANONICAL_HOST = "https://app-gonzo.com";

// Routes we DO NOT want in Google's index. Google won't respect a
// robots.txt disallow retroactively — noindex is the strong signal.
// Prefixes are matched with startsWith so nested routes are covered.
const NOINDEX_PREFIXES = [
  "/app",           // authenticated dashboard + all its sub-tabs
  "/admin",         // admin panel + support inbox
  "/billing",
  "/settings",
  "/signin",        // Google can't index login without credentials anyway
  "/accept-terms",
  "/accept-invite",
  "/invite/",       // shared invite tokens
  "/share/",        // shared project tokens
];

function _setMetaRobots(value) {
  let meta = document.querySelector('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", value);
}

function _setCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

export function useAutoCanonical() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Normalize trailing slash so /apps/vision-cad and /apps/vision-cad/
    // don't produce two canonicals for the same page.
    let path = pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

    const isPrivate = NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path === p.replace(/\/$/, ""));

    if (isPrivate) {
      // Don't publish a canonical for pages we don't want indexed;
      // pair with noindex, nofollow so Google both drops it AND stops
      // crawling links from it (avoids infinite auth-loop crawl attempts).
      _setMetaRobots("noindex, nofollow");
      _setCanonical(`${CANONICAL_HOST}${path}`);   // still useful for user agents that check
    } else {
      _setMetaRobots("index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1");
      _setCanonical(`${CANONICAL_HOST}${path}`);
    }
  }, [pathname]);
}
