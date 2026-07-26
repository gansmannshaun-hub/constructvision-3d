/* Interactive Google Maps picker — pan/zoom to a build site, address autocomplete,
 * "Capture this view" sends lat/lng/zoom to the backend which fetches a
 * Static Maps satellite PNG, runs GPT-4o vision on it, and stores the result.
 *
 * FALLBACK: If the browser-side Maps JS API fails to load (e.g. the API key's
 * HTTP-referrer allowlist doesn't include the current preview / production
 * domain — a common Google Cloud Console misconfiguration), we detect
 * `window.gm_authFailure` and swap the Map component for a manual lat/lng
 * entry form. The backend already uses a SEPARATE server-side key with no
 * referrer restrictions, so capture still works — the user just loses the
 * visual map for that session.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  Marker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

export default function SitePickerModal({ projectId, currentSite, onClose, onCaptured }) {
  const [position, setPosition] = useState({
    lat: currentSite?.lat ?? 37.7749,
    lng: currentSite?.lng ?? -122.4194,
  });
  const [zoom, setZoom] = useState(currentSite?.zoom ?? 18);
  const [address, setAddress] = useState(currentSite?.address || "");
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(null);
  // Set to true when Google Maps JS can't authenticate on this domain.
  // gm_authFailure is Google's officially-documented global callback for
  // referrer / key / billing errors — we swap the UI to a manual coords
  // form so the feature stays usable while the user fixes the referrer
  // allowlist in Google Cloud Console.
  const [mapAuthFailed, setMapAuthFailed] = useState(false);
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => {
      console.warn("Google Maps auth failure — falling back to manual coordinate entry.");
      setMapAuthFailed(true);
    };
    return () => { window.gm_authFailure = prev; };
  }, []);

  if (!KEY) {
    return (
      <ModalShell onClose={onClose}>
        <MissingKeyOrManualFallback
          reason="missing-key"
          projectId={projectId}
          initialPosition={position}
          initialZoom={zoom}
          initialAddress={address}
          onClose={onClose}
          onCaptured={onCaptured}
        />
      </ModalShell>
    );
  }

  const capture = async () => {
    setCapturing(true);
    setError(null);
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${projectId}/site`,
        { lat: position.lat, lng: position.lng, zoom, address: address || null },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      onCaptured?.(data);
      onClose?.();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div>
          <div className="label-mono text-[#5588FF]">// SITE PICKER</div>
          <div className="font-display text-xl mt-1">Choose a build location</div>
        </div>
        <button
          data-testid="site-picker-close"
          onClick={onClose}
          className="text-neutral-500 hover:text-white text-2xl leading-none"
        >✕</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] h-[70vh] min-h-[480px]">
        <div className="relative bg-black">
          {mapAuthFailed ? (
            <MapAuthFailedFallback />
          ) : (
            <APIProvider apiKey={KEY} libraries={["places"]}>
              <Map
                data-testid="site-picker-map"
                style={{ width: "100%", height: "100%" }}
                defaultCenter={position}
                defaultZoom={zoom}
                mapTypeId="hybrid"
                gestureHandling="greedy"
                disableDefaultUI={false}
                mapTypeControl={true}
                streetViewControl={false}
                fullscreenControl={false}
                tilt={0}
                onCenterChanged={(e) => setPosition(e.detail.center)}
                onZoomChanged={(e) => setZoom(e.detail.zoom)}
              >
                <Marker position={position} />
              </Map>
              <PlacesAutocomplete
                value={address}
                onChange={setAddress}
                onPlaceSelected={(p) => {
                  setPosition({ lat: p.lat, lng: p.lng });
                  setZoom(p.zoom || 18);
                  setAddress(p.address);
                }}
              />
              {/* Crosshair overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-px h-12 bg-[#FFCC00]/60" />
                <div className="absolute w-12 h-px bg-[#FFCC00]/60" />
              </div>
            </APIProvider>
          )}
        </div>

        <aside className="border-l border-white/10 p-5 overflow-y-auto bg-[#0a0a0a]">
          <div className="label-mono mb-2">// CAPTURE SETTINGS</div>
          <p className="text-xs text-neutral-500 leading-relaxed mb-4">
            {mapAuthFailed
              ? "The visual map couldn't load on this domain, but capture still works — type or paste your build-site coordinates below and hit Capture. The backend fetches the satellite tile using a separate key."
              : `Pan and zoom to frame the lot. The captured square will match what you see (~${worldSizeFt(position.lat, zoom)} ft per side at this zoom).`}
          </p>

          {mapAuthFailed && (
            <div className="mb-4 space-y-2">
              <label className="block">
                <div className="label-mono mb-1 text-neutral-500">LAT</div>
                <input
                  data-testid="site-picker-manual-lat"
                  type="number" step="0.000001"
                  value={position.lat}
                  onChange={(e) => setPosition((p) => ({ ...p, lat: Number(e.target.value) }))}
                  className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
                />
              </label>
              <label className="block">
                <div className="label-mono mb-1 text-neutral-500">LNG</div>
                <input
                  data-testid="site-picker-manual-lng"
                  type="number" step="0.000001"
                  value={position.lng}
                  onChange={(e) => setPosition((p) => ({ ...p, lng: Number(e.target.value) }))}
                  className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
                />
              </label>
              <label className="block">
                <div className="label-mono mb-1 text-neutral-500">ADDRESS (OPTIONAL)</div>
                <input
                  data-testid="site-picker-manual-address"
                  type="text" value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 1600 Amphitheatre Pkwy"
                  className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
                />
              </label>
              <p className="text-[10px] text-neutral-500 leading-tight">
                Tip: right-click any spot on Google Maps and select the coords at the top of the popup to copy lat/lng.
              </p>
            </div>
          )}

          <label className="block mb-4">
            <div className="label-mono mb-1 flex justify-between">
              <span>Zoom level</span><span className="text-[#FFCC00]">{zoom}</span>
            </div>
            <input
              data-testid="site-picker-zoom"
              type="range" min="14" max="21" step="1" value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[#FFCC00]"
            />
            <div className="flex justify-between text-[10px] font-mono text-neutral-500 mt-1">
              <span>~5km</span><span>~75ft</span>
            </div>
          </label>

          <div className="space-y-1 mb-4 text-xs font-mono text-neutral-400">
            <div>lat <span className="text-white">{Number(position.lat).toFixed(6)}</span></div>
            <div>lng <span className="text-white">{Number(position.lng).toFixed(6)}</span></div>
            <div>side <span className="text-[#FFCC00]">{worldSizeFt(position.lat, zoom)} ft</span></div>
          </div>

          {error && (
            <div className="bg-[#FF3333]/10 border border-[#FF3333]/40 px-3 py-2 text-xs text-[#FF6666] font-mono mb-4">
              {error}
            </div>
          )}

          <button
            data-testid="site-picker-capture"
            onClick={capture}
            disabled={capturing}
            className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:bg-white/10 disabled:text-neutral-500 text-black font-bold py-3 uppercase tracking-wider text-sm"
          >
            {capturing ? "Capturing + AI analyzing…" : "▼ Capture site"}
          </button>

          {currentSite?.captured && (
            <div className="mt-4 border border-white/10 p-3">
              <div className="label-mono mb-1">// CURRENT SITE</div>
              <div className="text-xs font-mono text-neutral-400 truncate">
                {currentSite.address || `${currentSite.lat.toFixed(4)}, ${currentSite.lng.toFixed(4)}`}
              </div>
              <button
                data-testid="site-picker-clear"
                onClick={async () => {
                  if (!window.confirm("Remove the current site from this project?")) return;
                  const token = localStorage.getItem("cm_token");
                  await axios.delete(`${API}/projects/${projectId}/site`, { headers: { Authorization: `Bearer ${token}` } });
                  onCaptured?.({ captured: false });
                  onClose?.();
                }}
                className="mt-2 w-full border border-[#FF3333]/40 text-[#FF6666] hover:bg-[#FF3333]/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
              >Remove site</button>
            </div>
          )}
        </aside>
      </div>
    </ModalShell>
  );
}

function worldSizeFt(lat, zoom) {
  const mPerPx = (156543.03392 * Math.cos((Number(lat) * Math.PI) / 180)) / Math.pow(2, Number(zoom));
  const sideM = 640 * mPerPx;
  return Math.round(sideM * 3.28084);
}

/**
 * Shown in the left pane when the browser-side Google Maps JS fails
 * to authenticate on the current domain. Explains what happened and
 * how to permanently fix it — the manual coord inputs in the sidebar
 * still let the user capture a site right now.
 */
function MapAuthFailedFallback() {
  const currentUrl = typeof window !== "undefined" ? window.location.origin : "this domain";
  return (
    <div
      data-testid="site-picker-map-auth-failed"
      className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1a1a1a] text-center"
    >
      <div className="w-16 h-16 rounded-full border-2 border-[#FFCC00]/60 flex items-center justify-center mb-4">
        <div className="text-[#FFCC00] text-2xl">!</div>
      </div>
      <div className="label-mono text-[#FFCC00] mb-3">// MAPS UNAVAILABLE ON THIS DOMAIN</div>
      <p className="text-sm text-neutral-300 leading-relaxed max-w-md mb-4">
        Google returned a <span className="font-mono text-[#FFCC00]">RefererNotAllowedMapError</span>. Your
        Maps API key doesn&apos;t list this domain in its HTTP-referrer allowlist yet.
      </p>
      <div className="bg-black/40 border border-white/10 px-4 py-3 text-left text-xs font-mono text-neutral-400 max-w-md w-full mb-4">
        <div className="text-[#FFCC00] mb-1">// Quick fix (Google Cloud Console)</div>
        <ol className="list-decimal pl-4 space-y-1 marker:text-[#FFCC00]">
          <li>Open <span className="text-white">console.cloud.google.com → APIs & Services → Credentials</span></li>
          <li>Edit the browser Maps API key</li>
          <li>Under <span className="text-white">Application restrictions → Websites</span>, add:</li>
        </ol>
        <div className="mt-2 pl-4 text-white break-all">{currentUrl}/*</div>
        <div className="text-neutral-500 text-[10px] mt-1 pl-4">(and repeat for your production domain, e.g. https://app-gonzo.com/*)</div>
      </div>
      <p className="text-xs text-neutral-500 leading-relaxed max-w-md">
        <span className="text-[#5588FF]">Meanwhile:</span> type the coordinates in the sidebar and hit Capture. The
        backend uses a separate server key with no referrer restrictions, so satellite capture + AI analysis still work.
      </p>
    </div>
  );
}

/**
 * Renders when REACT_APP_GOOGLE_MAPS_API_KEY isn't set at all. Same
 * manual-entry fallback as MapAuthFailedFallback so capture still works.
 */
function MissingKeyOrManualFallback({ projectId, initialPosition, initialZoom, initialAddress, onClose, onCaptured }) {
  const [position, setPosition] = useState(initialPosition);
  const [zoom, setZoom] = useState(initialZoom);
  const [address, setAddress] = useState(initialAddress);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(null);

  const capture = async () => {
    setCapturing(true); setError(null);
    try {
      const token = localStorage.getItem("cm_token");
      const { data } = await axios.post(
        `${API}/projects/${projectId}/site`,
        { lat: Number(position.lat), lng: Number(position.lng), zoom: Number(zoom), address: address || null },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      onCaptured?.(data);
      onClose?.();
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Capture failed");
    } finally { setCapturing(false); }
  };

  return (
    <div className="p-6" data-testid="site-picker-manual-only">
      <div className="label-mono text-[#FFCC00] mb-2">// SITE PICKER · MANUAL MODE</div>
      <p className="text-sm text-neutral-300 mb-4">
        Interactive map isn&apos;t available (no browser Maps key configured). You can still capture a
        site by entering coordinates below — the backend fetches the satellite tile using its own key.
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <div className="label-mono mb-1 text-neutral-500">LAT</div>
          <input
            data-testid="site-picker-manual-lat"
            type="number" step="0.000001"
            value={position.lat}
            onChange={(e) => setPosition((p) => ({ ...p, lat: Number(e.target.value) }))}
            className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
          />
        </label>
        <label className="block">
          <div className="label-mono mb-1 text-neutral-500">LNG</div>
          <input
            data-testid="site-picker-manual-lng"
            type="number" step="0.000001"
            value={position.lng}
            onChange={(e) => setPosition((p) => ({ ...p, lng: Number(e.target.value) }))}
            className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
          />
        </label>
      </div>
      <label className="block mb-3">
        <div className="label-mono mb-1 text-neutral-500">ADDRESS (OPTIONAL)</div>
        <input
          data-testid="site-picker-manual-address"
          type="text" value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="w-full bg-black border border-white/15 px-2 py-1.5 text-xs font-mono focus:border-[#FFCC00] outline-none"
        />
      </label>
      <label className="block mb-4">
        <div className="label-mono mb-1 flex justify-between">
          <span>Zoom level</span><span className="text-[#FFCC00]">{zoom}</span>
        </div>
        <input
          data-testid="site-picker-zoom"
          type="range" min="14" max="21" step="1" value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full accent-[#FFCC00]"
        />
      </label>
      {error && (
        <div className="bg-[#FF3333]/10 border border-[#FF3333]/40 px-3 py-2 text-xs text-[#FF6666] font-mono mb-3">
          {error}
        </div>
      )}
      <button
        data-testid="site-picker-capture"
        onClick={capture}
        disabled={capturing}
        className="w-full bg-[#FFCC00] hover:bg-[#E6B800] disabled:bg-white/10 disabled:text-neutral-500 text-black font-bold py-3 uppercase tracking-wider text-sm"
      >{capturing ? "Capturing + AI analyzing…" : "▼ Capture site"}</button>
    </div>
  );
}

function ModalShell({ children, onClose }) {
  return (
    <div
      data-testid="site-picker-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-[#0f0f0f] border border-white/10 w-full max-w-6xl">
        {children}
      </div>
    </div>
  );
}

/* Places autocomplete — sits over the map's top-left corner */
function PlacesAutocomplete({ value, onChange, onPlaceSelected }) {
  const places = useMapsLibrary("places");
  const map = useMap();
  const inputRef = useRef(null);
  const [autocomplete, setAutocomplete] = useState(null);

  useEffect(() => {
    if (!places || !inputRef.current || autocomplete) return;
    const ac = new places.Autocomplete(inputRef.current, {
      types: ["geocode"],
      fields: ["geometry", "formatted_address", "name"],
    });
    setAutocomplete(ac);
  }, [places, autocomplete]);

  useEffect(() => {
    if (!autocomplete || !map) return;
    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place.geometry?.location) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      map.panTo({ lat, lng });
      map.setZoom(18);
      onPlaceSelected?.({ lat, lng, zoom: 18, address: place.formatted_address || place.name || "" });
    });
    return () => listener.remove();
  }, [autocomplete, map, onPlaceSelected]);

  return (
    <div className="absolute top-3 left-3 right-3 lg:right-auto lg:w-96 z-10 pointer-events-auto">
      <input
        ref={inputRef}
        data-testid="site-picker-address"
        type="text"
        placeholder="Search an address (e.g. 1600 Amphitheatre Pkwy)"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full bg-black/90 border border-white/20 px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-[#FFCC00]"
      />
    </div>
  );
}
