# Entry point when running from the monorepo root:
#   uvicorn backend.main:app --reload
import os
import sys

# Make `app.*` importable regardless of working directory
sys.path.insert(0, os.path.dirname(__file__))

from app.main import app  # noqa: E402 F401

__all__ = ["app"]
