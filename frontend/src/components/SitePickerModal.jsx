/* Interactive Google Maps picker — pan/zoom to a build site, address autocomplete,
 * "Capture this view" sends lat/lng/zoom to the backend which fetches a
 * Static Maps satellite PNG, runs GPT-4o vision on it, and stores the result.
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

  if (!KEY) {
    return (
      <ModalShell onClose={onClose}>
        <div className="p-6 text-center">
          <div className="label-mono text-[#FF6666] mb-2">// MISSING API KEY</div>
          <p className="text-neutral-300 text-sm">
            REACT_APP_GOOGLE_MAPS_API_KEY is not set. Add it to the frontend .env file and reload.
          </p>
        </div>
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
        </div>

        <aside className="border-l border-white/10 p-5 overflow-y-auto bg-[#0a0a0a]">
          <div className="label-mono mb-2">// CAPTURE SETTINGS</div>
          <p className="text-xs text-neutral-500 leading-relaxed mb-4">
            Pan and zoom to frame the lot. The captured square will match what you see
            (~{worldSizeFt(position.lat, zoom)} ft per side at this zoom).
          </p>

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
            <div>lat <span className="text-white">{position.lat.toFixed(6)}</span></div>
            <div>lng <span className="text-white">{position.lng.toFixed(6)}</span></div>
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
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const sideM = 640 * mPerPx;
  return Math.round(sideM * 3.28084);
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
