"""Construction Management & 3D Visualization API — application entrypoint.

Routes live in /app/backend/routes/.  Pydantic models in /app/backend/models/.
Shared helpers in /app/backend/utils.py.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import APIRouter, FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from starlette.middleware.cors import CORSMiddleware

import admin as admin_mod
import billing as billing_mod
from routes.auth import build_auth_router
from routes.ai_tools import build_ai_tools_router
from routes.collab import build_collab_router
from routes.documents import build_documents_router
from routes.field import build_field_router
from routes.materials import build_materials_router
from routes.notifications import (
    build_notifications_router,
    start_digest_scheduler,
    stop_digest_scheduler,
)
from routes.pay_apps import build_pay_apps_router
from routes.pricing import build_pricing_router
from routes.projects import build_projects_router
from routes.share import build_share_router
from routes.site import build_site_router
from routes.takeoff import build_takeoff_router
from utils import make_current_user_dep

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("construction-api")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

get_current_user = make_current_user_dep(db)

app = FastAPI(title="Construction Management API")

# Mount feature routers (each owns its /api prefix)
app.include_router(build_auth_router(db, get_current_user))
app.include_router(build_collab_router(db, get_current_user))
app.include_router(build_projects_router(db, get_current_user))
app.include_router(build_materials_router(db, get_current_user))
app.include_router(build_pricing_router(db, get_current_user))
app.include_router(build_documents_router(db, get_current_user))
app.include_router(build_field_router(db, get_current_user))
app.include_router(build_ai_tools_router(db, get_current_user))
app.include_router(build_takeoff_router(db, get_current_user))
app.include_router(build_notifications_router(db, get_current_user))
app.include_router(build_pay_apps_router(db, get_current_user))
app.include_router(build_share_router(db, get_current_user))
app.include_router(build_site_router(db, get_current_user))
app.include_router(billing_mod.build_router(db, get_current_user))
app.include_router(billing_mod.build_webhook_router(db))
app.include_router(admin_mod.build_admin_router(db, get_current_user))
app.include_router(admin_mod.build_user_router(db, get_current_user))

# Health check
root = APIRouter(prefix="/api")


@root.get("/")
async def root_info():
    return {"message": "Construction Management API", "version": "1.5.0"}


app.include_router(root)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _on_startup():
    try:
        await admin_mod.seed_admin(db)
    except Exception as e:
        logger.exception(f"seed_admin failed: {e}")
    start_digest_scheduler(db)


@app.on_event("shutdown")
async def _shutdown():
    stop_digest_scheduler()
    client.close()
