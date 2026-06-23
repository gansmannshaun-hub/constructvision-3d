"""Site-context routes: fetches a Google Static Maps satellite image of the
build location, runs GPT-4o vision to identify features + a recommended
buildable area, and stores the image so the 3D renderer can use it as a
textured ground plane.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import re
import uuid

import httpx
from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from utils import now_iso

logger = logging.getLogger("site")

# Static Maps default capture: 640×640 @ scale=2 (returns 1280×1280 px)
STATIC_SIZE_PX = 640
STATIC_SCALE = 2
EARTH_PIXEL_BASE = 156543.03392  # at zoom 0 at the equator (meters/pixel)


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def _maps_key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "")


def _maps_server_key() -> str:
    """Optional server-side Maps key (no referer restrictions). Falls back
    to GOOGLE_MAPS_API_KEY for backwards compat."""
    return os.environ.get("GOOGLE_MAPS_SERVER_KEY") or _maps_key()


def meters_per_pixel(lat_deg: float, zoom: int) -> float:
    return EARTH_PIXEL_BASE * math.cos(math.radians(lat_deg)) / (2 ** zoom)


def world_meters_for_capture(lat_deg: float, zoom: int, size_px: int = STATIC_SIZE_PX) -> float:
    """World size in meters covered by the unscaled image dimension."""
    return size_px * meters_per_pixel(lat_deg, zoom)


SITE_PROMPT = """You are an expert site analyst studying a satellite image of a potential
construction site. The image is square and centered on (lat={lat}, lng={lng}) covering
approximately {world_m:.0f} meters per side at zoom {zoom}.

Return STRICT JSON ONLY (no prose, no markdown), with this exact schema:

{{
  "summary": "1-2 sentence site description",
  "features": [
    {{"kind": "tree" | "trees" | "water" | "road" | "driveway" | "building" | "vegetation" | "rock" | "slope" | "other",
      "label": "short label",
      "x": <0..1 normalised image x>, "y": <0..1 normalised image y>,
      "radius": <0..0.5 normalised radius approximation>}}
  ],
  "buildable_area": {{
    "polygon": [[x, y], [x, y], ...],   // 4-8 points, normalised 0..1 image coords
    "centroid": [x, y],
    "approx_sqft": <integer>,
    "rationale": "Why this patch is the best build location"
  }},
  "recommended_orientation_deg": <0..359, building's long-axis bearing clockwise from north>,
  "lot_estimate_sqft": <integer estimate of the entire visible lot or open space>
}}

Rules:
- Image origin is top-left; x increases right, y increases down.
- buildable_area must be a CLOSED polygon covering ground that is FLAT, FREE of trees / water / existing
  buildings / roads, large enough for a 30x40 ft footprint at minimum.
- If the image is mostly road / water / unbuildable, return an empty buildable_area.polygon ([]) and
  centroid = [0.5, 0.5].
- Output JSON only, no explanation."""


async def _fetch_static_maps(lat: float, lng: float, zoom: int) -> bytes:
    key = _maps_key()
    if not key:
        raise HTTPException(503, "Google Maps API key missing on server")
    url = "https://maps.googleapis.com/maps/api/staticmap"
    params = {
        "center": f"{lat},{lng}",
        "zoom": str(zoom),
        "size": f"{STATIC_SIZE_PX}x{STATIC_SIZE_PX}",
        "scale": str(STATIC_SCALE),
        "maptype": "satellite",
        "key": key,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
    if r.status_code != 200 or not r.content.startswith(b"\x89PNG"):
        body = r.text[:300] if r.text else "<binary>"
        raise HTTPException(502, f"Google Static Maps failed: HTTP {r.status_code} — {body}")
    return r.content


def _strip_code_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


async def _analyze_site(b64: str, lat: float, lng: float, zoom: int, world_m: float) -> dict:
    if not _llm_key():
        return {}
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"site-{uuid.uuid4()}",
        system_message="You are a site / civil analyst that outputs only valid JSON.",
    ).with_model("openai", "gpt-4o")
    prompt = SITE_PROMPT.format(lat=lat, lng=lng, zoom=zoom, world_m=world_m)
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    raw = await chat.send_message(msg)
    text = raw if isinstance(raw, str) else str(raw)
    cleaned = _strip_code_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            return {"summary": "AI analysis unavailable.", "features": []}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {"summary": "AI analysis unavailable.", "features": []}


class SiteCaptureIn(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lng: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=10, le=21, default=18)
    address: str | None = None


class ModelTransformIn(BaseModel):
    x: float = 0.0
    z: float = 0.0
    rotation_deg: float = 0.0
    scale: float = Field(default=1.0, ge=0.1, le=10.0)


class AutoScaleIn(BaseModel):
    blueprint_width_ft: float = Field(gt=0, le=10_000)
    blueprint_depth_ft: float = Field(gt=0, le=10_000)
    reference_label: str | None = Field(default=None, max_length=80)
    reference_feet: float | None = Field(default=None, gt=0, le=10_000)


class Vec3(BaseModel):
    x: float
    y: float = 0.0
    z: float


class MeasurementIn(BaseModel):
    start: Vec3
    end: Vec3
    distance_ft: float = Field(ge=0, le=100_000)
    label: str | None = Field(default=None, max_length=120)


class FeaturesUpdateIn(BaseModel):
    features_3d: list[dict] = Field(default_factory=list)


AUTOSCALE_PROMPT = """You are analyzing a satellite image to detect a building footprint and
estimate its real-world size, so the user can match a 3D model to it.

CONTEXT:
- The image is square and covers approximately {world_m:.1f} meters per side (≈{world_ft:.0f} feet).
- Image origin is top-left; x increases right, y increases down. Normalised coordinates are 0..1.
{ref_block}

TASK:
Find the user-intended building. If they specified a label or reference, prioritise that;
otherwise pick the most prominent / centered building footprint. If the image has multiple buildings,
pick the LARGEST visible rectangle.

Estimate:
  - the building's bounding box in normalised image coords (x0,y0,x1,y1)
  - its actual real-world dimensions in FEET (width and depth in feet)
  - a confidence score 0..1 (0.7+ means you're sure, < 0.4 means very uncertain)

Output STRICT JSON:
{{
  "found": true | false,
  "bbox_norm": [x0, y0, x1, y1],
  "width_ft": <feet>,
  "depth_ft": <feet>,
  "confidence": <0..1>,
  "rationale": "1 sentence why"
}}

Rules:
- If no building is visible, return {{"found": false, "bbox_norm":[0,0,0,0], "width_ft":0, "depth_ft":0, "confidence":0, "rationale":"no building visible"}}.
- Use the field-of-view (≈{world_ft:.0f} ft per side) to estimate feet; a building spanning 10% of the image
  width is about {ten_pct_ft:.0f} ft wide.
- If the user gave a reference dimension, scale your estimate to that hint.
- Output JSON only, no markdown, no commentary."""


async def _detect_building_dimensions(b64: str, world_m: float,
                                      reference_label: str | None,
                                      reference_feet: float | None) -> dict:
    if not _llm_key():
        raise HTTPException(503, "AI not configured on server")
    world_ft = world_m * 3.28083989501
    ref_block = ""
    if reference_label or reference_feet:
        bits = []
        if reference_label:
            bits.append(f"target building/feature: '{reference_label}'")
        if reference_feet:
            bits.append(f"known reference dimension: {reference_feet:.1f} ft (e.g. front wall length)")
        ref_block = "USER HINTS:\n- " + "\n- ".join(bits)
    prompt = AUTOSCALE_PROMPT.format(
        world_m=world_m, world_ft=world_ft,
        ten_pct_ft=world_ft * 0.1,
        ref_block=ref_block,
    )
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"autoscale-{uuid.uuid4()}",
        system_message="You measure buildings from satellite imagery and output strict JSON.",
    ).with_model("openai", "gpt-4o")
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    raw = await asyncio.wait_for(chat.send_message(msg), timeout=45)
    text = raw if isinstance(raw, str) else str(raw)
    cleaned = _strip_code_fence(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            raise HTTPException(502, "AI returned no usable JSON")
        data = json.loads(m.group(0))
    return data



# ------------------ 3D Landscape generation ------------------
async def _fetch_elevations(lat: float, lng: float, world_m: float,
                            grid_n: int = 32) -> list[list[float]]:
    """Sample a (world_m × world_m) area around (lat, lng) into a grid_n×grid_n
    elevation grid (meters above sea level). Uses Google Maps Elevation API.
    Batches are fired in parallel to stay well under any edge proxy timeout."""
    key = _maps_server_key()
    if not key:
        raise HTTPException(503, "Google Maps API key missing on server")
    # Convert meters → degrees. lat is roughly constant; lng scales by cos(lat).
    half_lat_deg = (world_m / 2) / 111320.0
    half_lng_deg = (world_m / 2) / max(111320.0 * math.cos(math.radians(lat)), 1e-6)

    coords: list[tuple[float, float]] = []
    for j in range(grid_n):
        # j=0 → north edge, j=grid_n-1 → south edge (matches image y top→down)
        la = lat + half_lat_deg - (2 * half_lat_deg) * (j / (grid_n - 1))
        for i in range(grid_n):
            ln = lng - half_lng_deg + (2 * half_lng_deg) * (i / (grid_n - 1))
            coords.append((la, ln))

    batch_size = 256   # Elevation API allows 512, but URL gets long
    batches = [coords[s: s + batch_size]
               for s in range(0, len(coords), batch_size)]
    grid = [[0.0] * grid_n for _ in range(grid_n)]

    async def _fetch_one(client: httpx.AsyncClient, start_idx: int, batch):
        loc_str = "|".join(f"{la:.6f},{ln:.6f}" for la, ln in batch)
        r = await client.get(
            "https://maps.googleapis.com/maps/api/elevation/json",
            params={"locations": loc_str, "key": key},
        )
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            raise HTTPException(502, f"Elevation API: bad JSON (HTTP {r.status_code})")
        status = data.get("status")
        if status != "OK":
            err = data.get("error_message", "")
            if status == "REQUEST_DENIED":
                if "referer restrictions" in err.lower():
                    raise HTTPException(
                        502,
                        "Your Google Maps API key has HTTP referer restrictions, which "
                        "block server-side calls (Elevation API runs from the backend, "
                        "not the browser). Fix: create a SECOND Google Maps API key with "
                        "IP-address restriction (or no restriction) and put it in the "
                        "GOOGLE_MAPS_SERVER_KEY env var, OR temporarily relax the existing "
                        "key's restrictions in Cloud Console → Credentials. "
                        f"Detail: {err}",
                    )
                raise HTTPException(
                    502,
                    "Google Elevation API denied — enable the Elevation API in your "
                    "Google Cloud project (APIs & Services → Library → 'Maps Elevation API') "
                    f"and ensure the key has access. Detail: {err}",
                )
            raise HTTPException(502, f"Elevation API: {status} — {err}")
        return start_idx, data["results"]

    async with httpx.AsyncClient(timeout=25) as client:
        results = await asyncio.gather(
            *[_fetch_one(client, s, batch)
              for s, batch in zip(range(0, len(coords), batch_size), batches)]
        )

    for start_idx, batch_results in results:
        for k, res in enumerate(batch_results):
            gi = start_idx + k
            j = gi // grid_n
            i = gi % grid_n
            grid[j][i] = float(res.get("elevation", 0.0))
    return grid


BUILDING_HEIGHT_PROMPT = """You are analysing a satellite image to estimate building heights.

The image is a top-down satellite view. Below is a list of detected building features with
their normalised image coordinates (0..1) and approximate radius:

{buildings_json}

For each building, estimate how many STORIES tall it is (1-10). Use these signals:
- shadow length adjacent to the building (longer shadow = taller; cardinal direction depends on time of day)
- roof shape (residential = 1-2 stories; commercial flat = 1-3; warehouse = 1-2 stories tall)
- footprint size (very small ≈ shed/garage = 1; medium ≈ house = 1-2; large ≈ commercial = 2-5)

Output STRICT JSON ARRAY only — one entry per input building, preserving order:
[
  {{"index": <int>, "stories": <int 1..10>, "rationale": "<≤20 words>"}}
]

If you cannot tell for a particular building, use stories=1. Output JSON only, no prose, no markdown."""


async def _estimate_building_heights(b64: str, features: list[dict]) -> dict[int, int]:
    """Return {feature_index → stories} for every feature with kind == 'building'.
    Skips the AI call if there are no buildings or no LLM key configured."""
    buildings = [(idx, f) for idx, f in enumerate(features or [])
                 if (f or {}).get("kind") == "building"]
    if not buildings:
        return {}
    if not _llm_key():
        return {idx: 1 for idx, _ in buildings}

    payload = [
        {
            "index": idx,
            "x": float(f.get("x", 0.5)),
            "y": float(f.get("y", 0.5)),
            "radius": float(f.get("radius", 0.05)),
            "label": (f.get("label") or "")[:40],
        }
        for idx, f in buildings
    ]
    prompt = BUILDING_HEIGHT_PROMPT.format(buildings_json=json.dumps(payload))
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"building-h-{uuid.uuid4()}",
        system_message="You estimate building heights from satellite imagery and output strict JSON.",
    ).with_model("openai", "gpt-4o")
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    try:
        raw = await asyncio.wait_for(chat.send_message(msg), timeout=35)
    except asyncio.TimeoutError:
        logger.warning("building height AI timed out — defaulting to 1 story")
        return {idx: 1 for idx, _ in buildings}
    text = raw if isinstance(raw, str) else str(raw)
    cleaned = _strip_code_fence(text)
    try:
        arr = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", cleaned)
        if not m:
            return {idx: 1 for idx, _ in buildings}
        try:
            arr = json.loads(m.group(0))
        except Exception:  # noqa: BLE001
            return {idx: 1 for idx, _ in buildings}
    out: dict[int, int] = {}
    for entry in arr if isinstance(arr, list) else []:
        if not isinstance(entry, dict):
            continue
        idx = entry.get("index")
        stories = entry.get("stories")
        if isinstance(idx, int) and isinstance(stories, (int, float)):
            out[idx] = max(1, min(10, int(stories)))
    # Fill in any missing
    for idx, _ in buildings:
        out.setdefault(idx, 1)
    return out

def build_site_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def _assert_project(project_id: str, user: dict):
        proj = await db.projects.find_one(
            {"id": project_id, "user_id": user["id"]}, {"_id": 0},
        )
        if not proj:
            raise HTTPException(404, "Project not found")

    @router.get("/projects/{project_id}/site")
    async def get_site(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        return site or {"project_id": project_id, "captured": False}

    @router.post("/projects/{project_id}/site")
    async def capture_site(project_id: str, payload: SiteCaptureIn, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")

        img_bytes = await _fetch_static_maps(payload.lat, payload.lng, payload.zoom)
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        world_m = world_meters_for_capture(payload.lat, payload.zoom)

        # AI analysis (best-effort — never block the capture itself)
        try:
            analysis = await asyncio.wait_for(
                _analyze_site(b64, payload.lat, payload.lng, payload.zoom, world_m),
                timeout=45,
            )
        except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
            logger.warning(f"site AI analysis failed: {exc}")
            analysis = {"summary": "AI analysis unavailable.", "features": []}

        site_doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "captured": True,
            "lat": payload.lat,
            "lng": payload.lng,
            "zoom": payload.zoom,
            "address": payload.address,
            "image_base64": b64,
            "image_size_px": STATIC_SIZE_PX,
            "image_scale": STATIC_SCALE,
            "world_meters": world_m,
            "analysis": analysis,
            "created_at": now_iso(),
        }
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": site_doc},
            upsert=True,
        )
        return site_doc

    @router.delete("/projects/{project_id}/site")
    async def clear_site(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        await db.sites.delete_one({"project_id": project_id})
        return {"ok": True}

    @router.patch("/projects/{project_id}/site/transform")
    async def set_model_transform(project_id: str, payload: ModelTransformIn,
                                  user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        # Clamp rotation to [0, 360)
        rot = payload.rotation_deg % 360
        scale = max(0.1, min(10.0, payload.scale))
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": {"model_transform": {
                "x": payload.x,
                "z": payload.z,
                "rotation_deg": rot,
                "scale": scale,
            }}},
            upsert=True,
        )
        return {"ok": True, "model_transform": {
            "x": payload.x, "z": payload.z, "rotation_deg": rot, "scale": scale,
        }}

    @router.post("/projects/{project_id}/site/auto-scale")
    async def auto_scale(project_id: str, payload: AutoScaleIn,
                         user: dict = Depends(get_current_user)):
        """Use GPT-4o vision to estimate the satellite-image building's real-world dimensions,
        then compute a display-scale ratio that maps the user's blueprint AABB onto it."""
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        if not site or not site.get("image_base64") or not site.get("world_meters"):
            raise HTTPException(400, "Capture a satellite site first (Pick Site From Map)")
        try:
            detection = await _detect_building_dimensions(
                site["image_base64"],
                float(site["world_meters"]),
                payload.reference_label,
                payload.reference_feet,
            )
        except asyncio.TimeoutError:
            raise HTTPException(504, "AI took too long — try again")
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("auto_scale failed")
            raise HTTPException(502, f"AI error: {str(exc)[:200]}")

        if not detection.get("found"):
            return {
                "applied": False,
                "scale": 1.0,
                "detection": detection,
                "message": detection.get("rationale", "No building detected"),
            }

        # If the user gave a known reference, override AI's feet estimate to that exact value.
        det_w = float(detection.get("width_ft") or 0)
        det_d = float(detection.get("depth_ft") or 0)
        if payload.reference_feet and det_w > 0:
            # User says "the longest side is N ft" — rescale AI estimate to that ratio.
            det_long = max(det_w, det_d)
            if det_long > 0:
                factor = payload.reference_feet / det_long
                det_w *= factor
                det_d *= factor

        # Compute scale ratio against blueprint long side.
        ai_long = max(det_w, det_d)
        bp_long = max(payload.blueprint_width_ft, payload.blueprint_depth_ft)
        if ai_long <= 0 or bp_long <= 0:
            raise HTTPException(422, "Detection or blueprint dimensions invalid")
        ratio = ai_long / bp_long
        ratio = max(0.1, min(10.0, ratio))

        return {
            "applied": True,
            "scale": ratio,
            "detection": {
                "found": True,
                "bbox_norm": detection.get("bbox_norm", []),
                "width_ft": round(det_w, 1),
                "depth_ft": round(det_d, 1),
                "confidence": float(detection.get("confidence") or 0),
                "rationale": detection.get("rationale", ""),
            },
            "blueprint": {
                "width_ft": payload.blueprint_width_ft,
                "depth_ft": payload.blueprint_depth_ft,
            },
            "message": f"Sized to AI-detected building (~{round(det_w,0)} × {round(det_d,0)} ft).",
        }

    # ------------------ 3D landscape generation ------------------
    @router.post("/projects/{project_id}/site/build-3d")
    async def build_3d_landscape(project_id: str, user: dict = Depends(get_current_user)):
        """Generate elevation heightmap (Google Elevation API) + 3D feature objects
        (trees, buildings, water, etc.) from the existing satellite analysis."""
        await _assert_project(project_id, user)
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        if not site or not site.get("captured"):
            raise HTTPException(400, "Capture a site first (Pick Site From Map)")

        lat = float(site.get("lat") or 0)
        lng = float(site.get("lng") or 0)
        world_m = float(site.get("world_meters") or 0)
        if world_m <= 0:
            raise HTTPException(400, "Site has no world dimensions; recapture the site")

        # 1) Elevation grid via Google Elevation API + 2) AI-estimated story
        #    counts run concurrently to stay well under the edge proxy timeout.
        features = ((site.get("analysis") or {}).get("features") or [])
        elev_task = asyncio.create_task(_fetch_elevations(lat, lng, world_m, grid_n=32))
        story_task = asyncio.create_task(
            _estimate_building_heights(site.get("image_base64") or "", features),
        )
        try:
            elevation_grid = await elev_task
        except HTTPException:
            story_task.cancel()
            raise
        except Exception as exc:  # noqa: BLE001
            story_task.cancel()
            logger.exception("elevation fetch failed")
            raise HTTPException(502, f"Elevation API failed: {str(exc)[:200]}")

        try:
            story_map = await story_task
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"building height estimation failed: {exc}")
            story_map = {}

        # 3) Compose features_3d
        features_3d = []
        for idx, f in enumerate(features):
            if not isinstance(f, dict):
                continue
            kind = (f.get("kind") or "other").lower()
            entry = {
                "kind": kind,
                "label": (f.get("label") or "")[:80],
                "x": float(f.get("x", 0.5)),
                "y": float(f.get("y", 0.5)),
                "radius": float(f.get("radius", 0.02)),
            }
            if kind == "building":
                entry["stories"] = int(story_map.get(idx, 1))
            features_3d.append(entry)

        terrain_3d = {
            "elevation_grid": elevation_grid,
            "grid_n": 32,
            "features_3d": features_3d,
            "generated_at": now_iso(),
        }
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": {"terrain_3d": terrain_3d}},
        )
        return terrain_3d

    @router.delete("/projects/{project_id}/site/build-3d")
    async def clear_3d_landscape(project_id: str, user: dict = Depends(get_current_user)):
        await _assert_project(project_id, user)
        await db.sites.update_one(
            {"project_id": project_id},
            {"$unset": {"terrain_3d": ""}},
        )
        return {"ok": True}

    class FeaturesUpdateIn(BaseModel):
        features_3d: list[dict] = Field(default_factory=list)

    @router.patch("/projects/{project_id}/site/terrain/features")
    async def update_terrain_features(project_id: str,
                                      payload: FeaturesUpdateIn,
                                      user: dict = Depends(get_current_user)):
        """Replace the features_3d array on the site's terrain_3d (used to hide
        or delete AI-detected objects like trees/buildings the user doesn't want)."""
        await _assert_project(project_id, user)
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        if not site or not site.get("terrain_3d"):
            raise HTTPException(400, "Build the 3D landscape first")
        # Sanitize each feature to a known shape
        clean: list[dict] = []
        for f in payload.features_3d:
            if not isinstance(f, dict):
                continue
            entry = {
                "kind": str(f.get("kind") or "other")[:32],
                "label": str(f.get("label") or "")[:80],
                "x": float(f.get("x", 0.5)),
                "y": float(f.get("y", 0.5)),
                "radius": float(f.get("radius", 0.02)),
            }
            if "stories" in f:
                entry["stories"] = max(1, min(20, int(f.get("stories") or 1)))
            if f.get("hidden"):
                entry["hidden"] = True
            clean.append(entry)
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": {"terrain_3d.features_3d": clean}},
        )
        return {"ok": True, "features_3d": clean}

    # ------------------ Tape-measure persistence ------------------

    @router.get("/projects/{project_id}/measurements")
    async def list_measurements(project_id: str, user: dict = Depends(get_current_user)):
        await _assert_project(project_id, user)
        cur = db.measurements.find({"project_id": project_id}, {"_id": 0}).sort("created_at", 1)
        return await cur.to_list(length=500)

    @router.post("/projects/{project_id}/measurements")
    async def create_measurement(project_id: str, payload: MeasurementIn,
                                 user: dict = Depends(get_current_user)):
        await _assert_project(project_id, user)
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "start": payload.start.model_dump(),
            "end": payload.end.model_dump(),
            "distance_ft": float(payload.distance_ft),
            "label": (payload.label or None),
            "created_by": user["id"],
            "created_by_email": user.get("email"),
            "created_at": now_iso(),
        }
        await db.measurements.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.delete("/projects/{project_id}/measurements/{measurement_id}")
    async def delete_measurement(project_id: str, measurement_id: str,
                                 user: dict = Depends(get_current_user)):
        await _assert_project(project_id, user)
        res = await db.measurements.delete_one(
            {"project_id": project_id, "id": measurement_id},
        )
        if res.deleted_count == 0:
            raise HTTPException(404, "Measurement not found")
        return {"ok": True}

    return router
