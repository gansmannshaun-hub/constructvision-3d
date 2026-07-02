"""Blueprint sheet models — one sheet per uploaded blueprint OR per hand-drawn layer."""
from typing import List, Optional
from pydantic import BaseModel, Field


class SheetCreateIn(BaseModel):
    name: str = Field(default="New Sheet", min_length=1, max_length=80)
    floor_level: int = Field(default=0, ge=-5, le=50)


class SheetPatchIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    floor_level: Optional[int] = Field(default=None, ge=-5, le=50)
    order_index: Optional[int] = Field(default=None, ge=0, le=999)


class SheetGeometryIn(BaseModel):
    walls: List[dict] = []
    doors: List[dict] = []
    windows: List[dict] = []
    labels: List[dict] = []
    fixtures: List[dict] = []
