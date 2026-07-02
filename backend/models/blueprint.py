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
