"""Construction Management & 3D Visualization API.

Endpoints:
- /api/auth/register, /api/auth/login, /api/auth/me  (JWT)
- /api/projects (CRUD)
- /api/documents (upload + list + analyze)
- /api/materials (list)
- /api/blueprint (get/save walls/doors/windows)
- /api/analyze (server-side AI pipeline triggered by upload)
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("construction-api")

# Mongo
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# Auth config
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "10080"))
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

security = HTTPBearer(auto_error=False)

app = FastAPI(title="Construction Management API")
api = APIRouter(prefix="/api")


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing token")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return user


def clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------- Auth ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class AuthOut(BaseModel):
    token: str
    user: dict


@api.post("/auth/register", response_model=AuthOut)
async def register(payload: RegisterIn):
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(400, "Email already registered")
    uid = str(uuid.uuid4())
    user_doc = {
        "id": uid,
        "email": payload.email.lower(),
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    # Create a default project for the user
    proj_id = str(uuid.uuid4())
    await db.projects.insert_one(
        {
            "id": proj_id,
            "user_id": uid,
            "name": "My First Project",
            "description": "Default project — upload a blueprint to get started",
            "created_at": now_iso(),
        }
    )
    # Empty blueprint for that project
    await db.blueprints.insert_one(
        {
            "id": str(uuid.uuid4()),
            "project_id": proj_id,
            "walls": [],
            "doors": [],
            "windows": [],
            "updated_at": now_iso(),
        }
    )
    token = create_token(uid, payload.email.lower())
    return AuthOut(token=token, user={"id": uid, "email": payload.email.lower(), "name": payload.name})


@api.post("/auth/login", response_model=AuthOut)
async def login(payload: LoginIn):
    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user["id"], user["email"])
    return AuthOut(token=token, user={"id": user["id"], "email": user["email"], "name": user["name"]})


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------- Projects ----------
@api.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    docs = await db.projects.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return docs


@api.post("/projects")
async def create_project(payload: dict, user: dict = Depends(get_current_user)):
    pid = str(uuid.uuid4())
    doc = {
        "id": pid,
        "user_id": user["id"],
        "name": payload.get("name", "Untitled Project"),
        "description": payload.get("description", ""),
        "created_at": now_iso(),
    }
    await db.projects.insert_one(doc)
    await db.blueprints.insert_one(
        {
            "id": str(uuid.uuid4()),
            "project_id": pid,
            "walls": [],
            "doors": [],
            "windows": [],
            "updated_at": now_iso(),
        }
    )
    return clean(doc)


async def _get_or_create_blueprint(project_id: str) -> dict:
    bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0})
    if bp:
        return bp
    bp = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "walls": [],
        "doors": [],
        "windows": [],
        "updated_at": now_iso(),
    }
    await db.blueprints.insert_one(bp)
    return clean(bp)


# ---------- Blueprints ----------
class BlueprintIn(BaseModel):
    walls: List[dict] = []
    doors: List[dict] = []
    windows: List[dict] = []


@api.get("/projects/{project_id}/blueprint")
async def get_blueprint(project_id: str, user: dict = Depends(get_current_user)):
    proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")
    return await _get_or_create_blueprint(project_id)


@api.put("/projects/{project_id}/blueprint")
async def save_blueprint(project_id: str, payload: BlueprintIn, user: dict = Depends(get_current_user)):
    proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")
    await db.blueprints.update_one(
        {"project_id": project_id},
        {
            "$set": {
                "walls": payload.walls,
                "doors": payload.doors,
                "windows": payload.windows,
                "updated_at": now_iso(),
            }
        },
        upsert=True,
    )
    return await _get_or_create_blueprint(project_id)


# ---------- Materials ----------
@api.get("/projects/{project_id}/materials")
async def list_materials(project_id: str, user: dict = Depends(get_current_user)):
    proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")
    docs = await db.materials.find({"project_id": project_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs


# ---------- Documents ----------
@api.get("/projects/{project_id}/documents")
async def list_documents(project_id: str, user: dict = Depends(get_current_user)):
    proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")
    docs = await db.documents.find(
        {"project_id": project_id},
        {"_id": 0, "image_base64": 0},  # Don't ship base64 in list view
    ).sort("created_at", -1).to_list(200)
    return docs


@api.get("/documents/{doc_id}/image")
async def get_document_image(doc_id: str, user: dict = Depends(get_current_user)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    proj = await db.projects.find_one({"id": doc["project_id"], "user_id": user["id"]})
    if not proj:
        raise HTTPException(403, "Forbidden")
    return {
        "id": doc["id"],
        "filename": doc.get("filename"),
        "mime_type": doc.get("mime_type"),
        "image_base64": doc.get("image_base64"),
    }


@api.post("/projects/{project_id}/documents/upload")
async def upload_document(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
    if not proj:
        raise HTTPException(404, "Project not found")

    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 8MB)")
    mime = file.content_type or "application/octet-stream"
    b64 = base64.b64encode(content).decode("utf-8")

    doc_id = str(uuid.uuid4())
    document = {
        "id": doc_id,
        "project_id": project_id,
        "filename": file.filename,
        "mime_type": mime,
        "size": len(content),
        "image_base64": b64 if mime.startswith("image/") else None,
        "status": "uploaded",  # uploaded -> analyzing -> saving -> syncing -> done | error
        "analysis": None,
        "materials_count": 0,
        "synced_3d": False,
        "doc_type": None,
        "created_at": now_iso(),
    }
    await db.documents.insert_one(document)

    # Trigger analysis pipeline in background
    if mime.startswith("image/"):
        asyncio.create_task(_run_analysis_pipeline(doc_id, project_id, b64, mime))

    out = {k: v for k, v in document.items() if k != "image_base64"}
    return clean(out)


# ---------- AI Analysis Pipeline ----------
def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        # remove ```json ... ```
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


async def _set_doc_status(doc_id: str, status_val: str, **extras: Any) -> None:
    update = {"status": status_val, "updated_at": now_iso(), **extras}
    await db.documents.update_one({"id": doc_id}, {"$set": update})


ANALYSIS_PROMPT = """You are an expert architectural and construction AI assistant.
Analyze the provided image (which may be a blueprint, floor plan, site plan, construction photo, or other document) and return a STRICT JSON response — no prose, no markdown, only valid JSON — with this exact schema:

{
  "doc_type": "floor_plan" | "blueprint" | "site_plan" | "elevation" | "photo" | "other",
  "summary": "2-3 sentence summary of what's in the image",
  "rooms": [{"name": "Living Room", "approx_area_sqft": 320}],
  "structural_notes": ["..."],
  "materials": [
    {"name": "2x4 Lumber", "category": "Framing", "quantity": 50, "unit": "pcs"},
    {"name": "Concrete", "category": "Structural", "quantity": 12, "unit": "cu yd"}
  ],
  "walls": [{"start": [x, y], "end": [x, y], "thickness": 0.2}],
  "doors": [{"position": [x, y], "width": 3, "wall_index": 0}],
  "windows": [{"position": [x, y], "width": 4, "wall_index": 0}]
}

Coordinate rules:
- All coordinates are normalized in the range 0-100 where (0,0) is top-left of the image and (100,100) is bottom-right.
- Only return walls/doors/windows if doc_type is "floor_plan", "blueprint", or "site_plan".
- For "photo" or "other", return empty arrays for walls/doors/windows.
- Materials category MUST be one of: "Structural", "Framing", "Electrical", "Plumbing", "Finishes", "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other".
- If you cannot identify materials with confidence, still return at least 3-6 plausible inferred materials based on the building type.

Return ONLY the JSON object, no surrounding text.
"""


async def _analyze_image_with_ai(b64: str, mime: str) -> dict:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"analyze-{uuid.uuid4()}",
        system_message="You are a construction blueprint analysis expert. You output only valid JSON.",
    ).with_model("openai", "gpt-4o")

    image = ImageContent(image_base64=b64)
    message = UserMessage(text=ANALYSIS_PROMPT, file_contents=[image])
    response = await chat.send_message(message)
    raw = response if isinstance(response, str) else str(response)
    cleaned = _strip_code_fence(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to find JSON object in the response
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError(f"AI did not return valid JSON: {raw[:300]}")
        data = json.loads(match.group(0))
    return data


async def _run_analysis_pipeline(doc_id: str, project_id: str, b64: str, mime: str) -> None:
    try:
        # 1) analyzing
        await asyncio.sleep(0.3)
        await _set_doc_status(doc_id, "analyzing")

        if not EMERGENT_LLM_KEY:
            await _set_doc_status(doc_id, "error", error="EMERGENT_LLM_KEY missing")
            return

        analysis = await _analyze_image_with_ai(b64, mime)

        # 2) saving — persist materials
        await _set_doc_status(doc_id, "saving", doc_type=analysis.get("doc_type"))

        materials = analysis.get("materials") or []
        valid_categories = {
            "Structural", "Framing", "Electrical", "Plumbing", "Finishes",
            "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other",
        }
        inserted = 0
        for mat in materials:
            if not isinstance(mat, dict) or not mat.get("name"):
                continue
            cat = mat.get("category") or "Other"
            if cat not in valid_categories:
                cat = "Other"
            await db.materials.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "project_id": project_id,
                    "document_id": doc_id,
                    "name": str(mat.get("name"))[:120],
                    "category": cat,
                    "quantity": float(mat.get("quantity") or 0),
                    "unit": str(mat.get("unit") or "ea")[:24],
                    "ai_extracted": True,
                    "created_at": now_iso(),
                }
            )
            inserted += 1

        # 3) syncing — merge walls/doors/windows into blueprint if applicable
        synced = False
        doc_type = analysis.get("doc_type")
        if doc_type in {"floor_plan", "blueprint", "site_plan"}:
            await _set_doc_status(doc_id, "syncing", doc_type=doc_type, materials_count=inserted)
            walls_raw = analysis.get("walls") or []
            doors_raw = analysis.get("doors") or []
            windows_raw = analysis.get("windows") or []

            def _coord(p):
                if isinstance(p, list) and len(p) >= 2:
                    return [float(p[0]), float(p[1])]
                return None

            walls = []
            for w in walls_raw:
                s, e = _coord(w.get("start")), _coord(w.get("end"))
                if s and e:
                    walls.append(
                        {
                            "id": str(uuid.uuid4()),
                            "start": s,
                            "end": e,
                            "thickness": float(w.get("thickness") or 0.2),
                        }
                    )
            doors = []
            for d_item in doors_raw:
                pos = _coord(d_item.get("position"))
                if pos:
                    doors.append(
                        {
                            "id": str(uuid.uuid4()),
                            "position": pos,
                            "width": float(d_item.get("width") or 3.0),
                            "wall_index": int(d_item.get("wall_index") or 0),
                        }
                    )
            windows = []
            for w_item in windows_raw:
                pos = _coord(w_item.get("position"))
                if pos:
                    windows.append(
                        {
                            "id": str(uuid.uuid4()),
                            "position": pos,
                            "width": float(w_item.get("width") or 4.0),
                            "wall_index": int(w_item.get("wall_index") or 0),
                        }
                    )

            if walls or doors or windows:
                # Replace blueprint with the new merged set (latest analysis becomes source of truth)
                existing = await _get_or_create_blueprint(project_id)
                merged_walls = (existing.get("walls") or []) + walls if existing.get("walls") else walls
                merged_doors = (existing.get("doors") or []) + doors if existing.get("doors") else doors
                merged_windows = (existing.get("windows") or []) + windows if existing.get("windows") else windows
                await db.blueprints.update_one(
                    {"project_id": project_id},
                    {
                        "$set": {
                            "walls": merged_walls,
                            "doors": merged_doors,
                            "windows": merged_windows,
                            "updated_at": now_iso(),
                            "last_source_document_id": doc_id,
                        }
                    },
                    upsert=True,
                )
                synced = True

        # 4) done
        await _set_doc_status(
            doc_id,
            "done",
            analysis={
                "doc_type": analysis.get("doc_type"),
                "summary": analysis.get("summary"),
                "rooms": analysis.get("rooms") or [],
                "structural_notes": analysis.get("structural_notes") or [],
            },
            doc_type=doc_type,
            materials_count=inserted,
            synced_3d=synced,
        )
        logger.info(f"Pipeline done for {doc_id}: type={doc_type} materials={inserted} synced={synced}")
    except Exception as exc:
        logger.exception(f"Pipeline failed for {doc_id}")
        await _set_doc_status(doc_id, "error", error=str(exc)[:300])


# ---------- Demo: status check (kept for compatibility) ----------
@api.get("/")
async def root():
    return {"message": "Construction Management API", "version": "1.0.0"}


# Include
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
