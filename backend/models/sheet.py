"""Blueprint sheet models — one sheet per uploaded blueprint OR per hand-drawn layer."""
from typing import List, Optional
from pydantic import BaseModel, Field


class SheetCreateIn(BaseModel):
    name: str = Field(default="New Sheet", min_length=1, max_length=80)
    floor_level: int = Field(default=0, ge=-5, le=50)


class SheetPatchIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    floor_level: Optional[int] = Field(default=None, ge=-99, le=50)
    order_index: Optional[int] = Field(default=None, ge=0, le=999)
    # 3D-assembly overrides — user can retag which side an elevation shows,
    # or override the AI-extracted structural values.
    facing_override: Optional[str] = Field(default=None)  # "front" | "back" | "left" | "right" | "clear" (unset)
    assembly_data: Optional[dict] = Field(default=None)   # merge/replace the structured data blob


class SheetGeometryIn(BaseModel):
    walls: List[dict] = []
    doors: List[dict] = []
    windows: List[dict] = []
    labels: List[dict] = []
    fixtures: List[dict] = []
