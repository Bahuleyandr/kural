from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..models import BackgroundJob, ModelPackAction, ModelPackInfo
from .registry import local_model_inventory


class ModelPackError(RuntimeError):
    """Raised when a safe model-pack action cannot be completed."""


@dataclass(frozen=True)
class ModelPackManifest:
    id: str
    name: str
    category: str
    provider: str
    version: str
    source_url: str | None
    checksum: str | None
    license: str
    disk_size_mb: int | None
    path_setting: str | None
    languages: list[str]
    capabilities: list[str]
    install_kind: str
    requires_confirmation: bool = False
    non_commercial: bool = False
    trust_level: str = "built_in"
    recommended: bool = False
    quality_score: int = 0
    latency_tier: str = "manual"
    routing_hints: tuple[str, ...] = ()


_executor = ThreadPoolExecutor(max_workers=2)
_lock = threading.Lock()
_jobs: dict[str, BackgroundJob] = {}
_processes: dict[str, subprocess.Popen[str]] = {}
_canceled: set[str] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expand(value: str | None) -> Path | None:
    clean = (value or "").strip()
    return Path(clean).expanduser().resolve() if clean else None


def _scripts_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "scripts"


def _model_pack_root() -> Path:
    return _expand(settings.model_pack_root) or Path.home() / ".cache" / "kural"


def _safe_roots() -> list[Path]:
    roots = [
        _model_pack_root(),
        _expand(settings.model_cache_dir),
        _expand(settings.supertonic_model_dir),
        _expand(settings.faster_whisper_model_dir),
        _expand(settings.vosk_model_dir),
        _expand(settings.argos_packages_dir or settings.argos_package_dir),
        _expand(settings.indictrans2_model_dir),
        _expand(settings.nllb_model_dir),
    ]
    return [root for root in roots if root is not None]


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _assert_safe_delete_target(path: Path) -> None:
    resolved = path.resolve()
    roots = _safe_roots()
    if not roots or not any(resolved == root or _is_within(resolved, root) for root in roots):
        raise ModelPackError(f"Refusing to remove path outside Kural model roots: {resolved}")
    if resolved.anchor == str(resolved):
        raise ModelPackError(f"Refusing to remove filesystem root: {resolved}")


def _has_files(path: Path | None) -> bool:
    return bool(path and path.exists() and any(path.iterdir()))


def builtin_model_pack_manifests() -> list[ModelPackManifest]:
    root = _model_pack_root()
    return [
        ModelPackManifest(
            id="kokoro-v1-onnx",
            name="Kokoro v1.0 ONNX",
            category="tts",
            provider="kokoro",
            version="1.0-int8",
            source_url="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0",
            checksum=None,
            license="Apache-2.0",
            disk_size_mb=92,
            path_setting=settings.model_cache_dir,
            languages=["en-US", "en-GB", "ja-JP", "fr-FR", "es-ES", "hi-IN"],
            capabilities=["tts", "ssml", "wav", "mp3", "advanced-controls"],
            install_kind="download-kokoro",
            recommended=True,
            quality_score=82,
            latency_tier="interactive",
            routing_hints=("default-tts", "long-form", "offline-english"),
        ),
        ModelPackManifest(
            id="supertonic-3-onnx",
            name="Supertonic 3 ONNX",
            category="tts",
            provider="supertonic",
            version="3",
            source_url="https://huggingface.co/supertone/supertonic-3",
            checksum=None,
            license="MIT",
            disk_size_mb=None,
            path_setting=settings.supertonic_model_dir,
            languages=["multilingual"],
            capabilities=["tts", "ssml", "wav", "mp3", "advanced-controls"],
            install_kind="download-supertonic",
            requires_confirmation=True,
            recommended=True,
            quality_score=86,
            latency_tier="interactive",
            routing_hints=("multilingual-tts", "scripted-dubbing", "style-controls"),
        ),
        ModelPackManifest(
            id="chatterbox-local",
            name="Chatterbox local voice cloning",
            category="tts",
            provider="chatterbox",
            version="0.1.7",
            source_url="https://pypi.org/project/chatterbox-tts/",
            checksum=None,
            license="MIT",
            disk_size_mb=None,
            path_setting=None,
            languages=["multilingual"],
            capabilities=["voice-clone", "wav", "watermark"],
            install_kind="manual-runtime",
            requires_confirmation=True,
            trust_level="external_runtime",
            recommended=True,
            quality_score=78,
            latency_tier="batch",
            routing_hints=("voice-clone", "consent-required", "wav-only"),
        ),
        ModelPackManifest(
            id="faster-whisper",
            name="Faster-Whisper Tiny",
            category="asr",
            provider="faster-whisper",
            version="Systran/faster-whisper-tiny",
            source_url="https://huggingface.co/Systran/faster-whisper-tiny",
            checksum=None,
            license="MIT",
            disk_size_mb=150,
            path_setting=settings.faster_whisper_model_dir or str(root / "asr" / "faster-whisper-tiny"),
            languages=["multilingual"],
            capabilities=["transcribe", "segments", "cpu"],
            install_kind="provision-faster-whisper",
            requires_confirmation=True,
            recommended=True,
            quality_score=84,
            latency_tier="batch",
            routing_hints=("media-transcription", "dubbing-import", "speaker-workflow"),
        ),
        ModelPackManifest(
            id="vosk",
            name="Vosk offline ASR",
            category="asr",
            provider="vosk",
            version="model-dependent",
            source_url="https://alphacephei.com/vosk/models",
            checksum=None,
            license="Apache-2.0",
            disk_size_mb=None,
            path_setting=settings.vosk_model_dir,
            languages=["model-dependent"],
            capabilities=["transcribe", "cpu", "small-models"],
            install_kind="manual-runtime",
            trust_level="user_supplied",
            quality_score=70,
            latency_tier="realtime",
            routing_hints=("dictation", "low-resource", "streaming-asr"),
        ),
        ModelPackManifest(
            id="argos-translate",
            name="Argos Translate starter pairs",
            category="translation",
            provider="argos",
            version="starter-en-hi-bn-es",
            source_url="https://www.argosopentech.com/argospm/index/",
            checksum=None,
            license="MIT / CC0 model packages",
            disk_size_mb=250,
            path_setting=settings.argos_packages_dir or settings.argos_package_dir,
            languages=["en->hi", "hi->en", "en->bn", "bn->en", "en->es", "es->en"],
            capabilities=["translate", "offline", "package-pairs"],
            install_kind="provision-argos",
            requires_confirmation=True,
            recommended=True,
            quality_score=72,
            latency_tier="interactive",
            routing_hints=("offline-translation", "glossary-assisted", "lightweight"),
        ),
        ModelPackManifest(
            id="indictrans2",
            name="IndicTrans2",
            category="translation",
            provider="indictrans2",
            version="user-supplied",
            source_url="https://github.com/AI4Bharat/IndicTrans2",
            checksum=None,
            license="MIT",
            disk_size_mb=None,
            path_setting=settings.indictrans2_model_dir,
            languages=["English<->22 Indian languages"],
            capabilities=["translate", "offline"],
            install_kind="manual-runtime",
            requires_confirmation=True,
            trust_level="user_supplied",
            quality_score=80,
            latency_tier="batch",
            routing_hints=("indic-translation", "dubbing-localization", "large-model"),
        ),
        ModelPackManifest(
            id="nllb-200",
            name="NLLB-200",
            category="translation",
            provider="nllb",
            version="user-supplied",
            source_url="https://huggingface.co/facebook/nllb-200-distilled-600M",
            checksum=None,
            license="CC-BY-NC-4.0",
            disk_size_mb=None,
            path_setting=settings.nllb_model_dir,
            languages=["200 languages"],
            capabilities=["translate", "offline", "non-commercial-license"],
            install_kind="manual-runtime",
            requires_confirmation=True,
            non_commercial=True,
            trust_level="user_supplied",
            quality_score=76,
            latency_tier="batch",
            routing_hints=("many-languages", "research-license", "large-model"),
        ),
    ]


def _manifest_by_id(pack_id: str) -> ModelPackManifest:
    for manifest in builtin_model_pack_manifests():
        if manifest.id == pack_id:
            return manifest
    raise ModelPackError(f"Unknown model pack: {pack_id}")


def _latest_inventory_by_id() -> dict[str, dict]:
    return {model.id: model.model_dump() for model in local_model_inventory()}


def _manifest_digest(manifest: ModelPackManifest) -> str:
    payload = "|".join(
        [
            manifest.id,
            manifest.version,
            manifest.source_url or "",
            manifest.checksum or "",
            manifest.license,
            ",".join(manifest.capabilities),
        ]
    )
    return f"sha256:{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"


def list_model_packs() -> list[ModelPackInfo]:
    inventory = _latest_inventory_by_id()
    packs: list[ModelPackInfo] = []
    for manifest in builtin_model_pack_manifests():
        current = inventory.get(manifest.id, {})
        path = current.get("path") or manifest.path_setting
        status = current.get("status", "not_configured")
        actions: list[ModelPackAction] = ["install", "update"]
        if manifest.path_setting:
            actions.append("remove")
        packs.append(
            ModelPackInfo(
                id=manifest.id,
                name=manifest.name,
                category=manifest.category,  # type: ignore[arg-type]
                provider=manifest.provider,
                status=status,
                version=manifest.version,
                source_url=manifest.source_url,
                checksum=manifest.checksum,
                license=current.get("license") or manifest.license,
                disk_size_mb=manifest.disk_size_mb,
                installed_path=path,
                languages=current.get("languages") or manifest.languages,
                capabilities=current.get("capabilities") or manifest.capabilities,
                requires_confirmation=manifest.requires_confirmation,
                non_commercial=manifest.non_commercial,
                trust_level=manifest.trust_level,  # type: ignore[arg-type]
                manifest_digest=_manifest_digest(manifest),
                recommended=manifest.recommended,
                quality_score=manifest.quality_score,
                latency_tier=manifest.latency_tier,  # type: ignore[arg-type]
                routing_hints=list(manifest.routing_hints),
                detail=current.get("detail"),
                actions=actions,
            )
        )
    return packs


def list_jobs() -> list[BackgroundJob]:
    with _lock:
        return sorted(_jobs.values(), key=lambda job: job.started_at or "", reverse=True)[:20]


def get_job(job_id: str) -> BackgroundJob:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise ModelPackError(f"Unknown model-pack job: {job_id}")
        return job


def _set_job(job_id: str, **fields: object) -> None:
    with _lock:
        current = _jobs[job_id]
        _jobs[job_id] = current.model_copy(update=fields)


def _run_command(job_id: str, command: list[str], env: dict[str, str]) -> None:
    _set_job(job_id, progress=20, message="Launching safe provisioner")
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    with _lock:
        _processes[job_id] = process
    try:
        stdout, stderr = process.communicate(timeout=60 * 45)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        raise ModelPackError("Provisioner timed out after 45 minutes.") from exc
    finally:
        with _lock:
            _processes.pop(job_id, None)

    if job_id in _canceled:
        raise ModelPackError("Job was canceled.")
    if process.returncode != 0:
        tail = (stderr or stdout or "").strip().splitlines()[-1:]
        raise ModelPackError(tail[0] if tail else f"Provisioner exited {process.returncode}.")
    _set_job(job_id, progress=90, message="Provisioner finished; refreshing inventory")


def validate_checksum(path: Path, checksum: str | None) -> None:
    if not checksum:
        return
    if not checksum.startswith("sha256:"):
        raise ModelPackError(f"Unsupported checksum format: {checksum}")
    expected = checksum.split(":", 1)[1].lower()
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if actual != expected:
        raise ModelPackError(f"Checksum mismatch for {path.name}: expected {expected}, got {actual}")


def _install_or_update(job_id: str, manifest: ModelPackManifest) -> None:
    env = os.environ.copy()
    scripts = _scripts_dir()
    if manifest.install_kind == "download-kokoro":
        env["MODEL_CACHE_DIR"] = str(_expand(settings.model_cache_dir) or _model_pack_root() / "kokoro")
        _run_command(job_id, [sys.executable, str(scripts / "download_models.py")], env)
        return

    if manifest.install_kind == "download-supertonic":
        env["SUPERTONIC_MODEL_DIR"] = str(
            _expand(settings.supertonic_model_dir) or _model_pack_root() / "supertonic"
        )
        _run_command(
            job_id,
            [sys.executable, str(scripts / "download_models.py"), "--skip-kokoro", "--supertonic"],
            env,
        )
        return

    if manifest.install_kind == "provision-faster-whisper":
        env["KURAL_LOCAL_MODELS_ROOT"] = str(_model_pack_root())
        _run_command(job_id, [sys.executable, str(scripts / "provision_local_models.py"), "--root", str(_model_pack_root())], env)
        return

    if manifest.install_kind == "provision-argos":
        env["KURAL_LOCAL_MODELS_ROOT"] = str(_model_pack_root())
        _run_command(
            job_id,
            [
                sys.executable,
                str(scripts / "provision_local_models.py"),
                "--root",
                str(_model_pack_root()),
                "--skip-whisper",
            ],
            env,
        )
        return

    raise ModelPackError(
        f"{manifest.name} needs an external runtime or user-supplied model folder; "
        "use the install instructions shown in the app."
    )


def _remove_manifest_files(manifest: ModelPackManifest) -> None:
    path = _expand(manifest.path_setting)
    if path is None:
        raise ModelPackError(f"{manifest.name} does not have a configured local path.")
    if not path.exists():
        return
    _assert_safe_delete_target(path)
    if path.is_file():
        path.unlink()
    else:
        shutil.rmtree(path)


def _run_job(job_id: str, manifest: ModelPackManifest, action: ModelPackAction) -> None:
    if job_id in _canceled:
        _set_job(job_id, status="canceled", progress=100, completed_at=_now())
        return

    _set_job(
        job_id,
        status="running",
        progress=5,
        started_at=_now(),
        message=f"{action.title()} {manifest.name}",
    )
    try:
        if action in {"install", "update"}:
            _install_or_update(job_id, manifest)
        elif action == "remove":
            _set_job(job_id, progress=40, message=f"Removing {manifest.name}")
            _remove_manifest_files(manifest)
        else:
            raise ModelPackError(f"Unsupported action: {action}")

        if job_id in _canceled:
            _set_job(job_id, status="canceled", progress=100, completed_at=_now())
            return
        _set_job(
            job_id,
            status="succeeded",
            progress=100,
            message=f"{manifest.name} {action} complete.",
            completed_at=_now(),
            error=None,
        )
    except Exception as exc:
        status = "canceled" if job_id in _canceled else "failed"
        _set_job(
            job_id,
            status=status,
            progress=100,
            completed_at=_now(),
            error=str(exc),
            message=str(exc),
        )


def start_model_pack_job(pack_id: str, action: ModelPackAction) -> BackgroundJob:
    manifest = _manifest_by_id(pack_id)
    if action == "remove" and not manifest.path_setting:
        raise ModelPackError(f"{manifest.name} is not managed by a Kural model folder.")
    job = BackgroundJob(
        id=str(uuid.uuid4()),
        kind=f"model-pack:{action}:{pack_id}",
        status="queued",
        progress=0,
        message=f"Queued {action} for {manifest.name}.",
        started_at=_now(),
    )
    with _lock:
        _jobs[job.id] = job
    _executor.submit(_run_job, job.id, manifest, action)
    return job


def cancel_model_pack_job(job_id: str) -> BackgroundJob:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise ModelPackError(f"Unknown model-pack job: {job_id}")
        if job.status in {"succeeded", "failed", "canceled"}:
            return job
        _canceled.add(job_id)
        process = _processes.get(job_id)
        if process is not None:
            process.terminate()
        _jobs[job_id] = job.model_copy(
            update={
                "status": "canceled",
                "progress": 100,
                "completed_at": _now(),
                "message": "Job canceled.",
            }
        )
        return _jobs[job_id]
