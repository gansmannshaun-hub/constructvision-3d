from typing import Optional

from pydantic import BaseModel


class MaterialPatchIn(BaseModel):
    unit_price: Optional[float] = None
    quantity: Optional[float] = None
    name: Optional[str] = None
