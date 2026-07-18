"""Documents package — AI vision pipeline + HTTP routes.

Re-exports the public surface that other modules (server.py, ai_tools.py,
tests) previously imported from `routes.documents`.
"""
from .ai_vision import (
    ANALYSIS_PROMPT_FOOTER,
    ANALYSIS_PROMPT_HEADER,
    _analyze_image_with_ai,
    _analyze_view_structure,
    _llm_key,
)
from .pipeline import _build_pipeline
from .routes import build_documents_router
from .sanitize import (
    EXISTING_MATERIALS_TEMPLATE_NONE,
    _coord,
    _norm_key,
    _sanitize_fixture,
    _sanitize_label,
    _strip_code_fence,
)

__all__ = [
    "ANALYSIS_PROMPT_HEADER",
    "ANALYSIS_PROMPT_FOOTER",
    "EXISTING_MATERIALS_TEMPLATE_NONE",
    "_analyze_image_with_ai",
    "_analyze_view_structure",
    "_build_pipeline",
    "_coord",
    "_llm_key",
    "_norm_key",
    "_sanitize_fixture",
    "_sanitize_label",
    "_strip_code_fence",
    "build_documents_router",
]
