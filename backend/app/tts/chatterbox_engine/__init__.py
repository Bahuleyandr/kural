"""Chatterbox TTS — voice cloning support.

Public surface that earlier callers imported as
``from ..tts.chatterbox_engine import ...`` is preserved by this re-export.
The implementation is split across:

- :mod:`.storage`   — clone metadata CRUD and on-disk layout
- :mod:`.archive`   — `.kural` voice archive import/export
- :mod:`.synthesis` — model load and inference
"""
from .archive import export_cloned_voices, import_voice_archive
from .storage import (
    delete_cloned_voice,
    get_clone_meta,
    list_cloned_voices,
    save_voice_sample,
)
from .synthesis import synthesize_cloned

__all__ = [
    "delete_cloned_voice",
    "export_cloned_voices",
    "get_clone_meta",
    "import_voice_archive",
    "list_cloned_voices",
    "save_voice_sample",
    "synthesize_cloned",
]
