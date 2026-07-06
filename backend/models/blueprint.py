from typing import List, Optional

from pydantic import BaseModel


class BlueprintIn(BaseModel):
    walls: List[dict] = []
    doors: List[dict] = []
    windows: List[dict] = []
    labels: List[dict] = []
    fixtures: List[dict] = []
    roof_type: Optional[str] = "gable"
    roof_pitch_deg: Optional[float] = 12.0
    wall_color: Optional[str] = "#D8D4CC"
    roof_color: Optional[str] = "#4A5C6E"
    # Manual building-shape override — used when the project has no
    # elevation sheets (floor-plan only). Ignored by the 3D renderer when a
    # non-null assembly is available from an elevation sheet.
    wall_height_ft: Optional[float] = None   # None = use default 10 ft
    manual_override: Optional[bool] = False  # true = force these values even if elevations exist
