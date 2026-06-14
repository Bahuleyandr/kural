from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..models import (
    BackgroundJob,
    MarketplacePackManifest,
    MarketplaceValidationIssue,
    MarketplaceValidationResponse,
    ModelPackAction,
    ModelPackBenchmark,
    ModelPackInfo,
    ModelRouteRecommendation,
    VoiceQualityBenchmarkRequest,
    VoiceQualityBenchmarkResponse,
    VoiceQualityBenchmarkResult,
)
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
    compatibility: dict[str, str | int | bool | list[str]] | None = None
    community_pack: bool = False
    provenance_required: bool = False


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
            compatibility={
                "cpu": "x64/arm64",
                "gpu": False,
                "ram_mb": 2048,
                "languages": ["en-US", "en-GB", "ja-JP", "fr-FR", "es-ES", "hi-IN"],
                "features": ["tts", "ssml", "mp3", "wav"],
            },
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
            compatibility={
                "cpu": "x64/arm64",
                "gpu": False,
                "ram_mb": 4096,
                "languages": ["multilingual"],
                "features": ["tts", "styles", "advanced-controls"],
            },
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
            compatibility={
                "cpu": "x64",
                "gpu": "optional",
                "ram_mb": 6144,
                "languages": ["multilingual"],
                "features": ["voice-clone", "consent-ledger", "wav"],
            },
            provenance_required=True,
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
            compatibility={
                "cpu": "x64/arm64",
                "gpu": "optional",
                "ram_mb": 4096,
                "languages": ["multilingual"],
                "features": ["asr", "segments", "alignment"],
            },
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
            compatibility={
                "cpu": "x64/arm64",
                "gpu": False,
                "ram_mb": 1024,
                "languages": ["model-dependent"],
                "features": ["streaming-asr", "dictation"],
            },
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
            compatibility={
                "cpu": "x64/arm64",
                "gpu": False,
                "ram_mb": 2048,
                "languages": ["en->hi", "hi->en", "en->bn", "bn->en", "en->es", "es->en"],
                "features": ["translation", "glossary"],
            },
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
            compatibility={
                "cpu": "x64",
                "gpu": "recommended",
                "ram_mb": 8192,
                "languages": ["English<->22 Indian languages"],
                "features": ["translation", "indic-localization"],
            },
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
            compatibility={
                "cpu": "x64",
                "gpu": "recommended",
                "ram_mb": 8192,
                "languages": ["200 languages"],
                "features": ["translation", "non-commercial-license"],
            },
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
                compatibility=manifest.compatibility or {},
                community_pack=manifest.community_pack,
                provenance_required=manifest.provenance_required,
                detail=current.get("detail"),
                actions=actions,
            )
        )
    return packs


def _language_matches(pack: ModelPackInfo, language: str) -> bool:
    if not language:
        return True
    wanted = language.lower()
    for candidate in pack.languages:
        lowered = candidate.lower()
        if lowered in {"multilingual", "model-dependent", "200 languages"}:
            return True
        if wanted == lowered or wanted.split("-")[0] == lowered.split("-")[0]:
            return True
        if "->" in lowered and wanted.split("-")[0] in lowered.split("->"):
            return True
    return False


def _capability_matches(pack: ModelPackInfo, capability: str) -> bool:
    wanted = capability.lower().strip()
    if not wanted:
        return True
    if wanted in pack.capabilities:
        return True
    return any(wanted in hint.lower() for hint in pack.routing_hints)


def recommend_model_pack(language: str = "", capability: str = "tts") -> tuple[ModelPackInfo | None, str]:
    candidates = [
        pack
        for pack in list_model_packs()
        if _language_matches(pack, language) and _capability_matches(pack, capability)
    ]
    if not candidates:
        return None, "No local model pack advertises that language and capability yet."

    status_bonus = {"ready": 30, "not_configured": 5, "not_installed": 0, "disabled": -20, "error": -30}
    latency_bonus = {"realtime": 12, "interactive": 10, "batch": 4, "manual": 0}
    candidates.sort(
        key=lambda pack: (
            pack.quality_score + status_bonus.get(pack.status, 0) + latency_bonus.get(pack.latency_tier or "manual", 0),
            pack.recommended,
        ),
        reverse=True,
    )
    winner = candidates[0]
    reason = (
        f"{winner.name} has the best local score for {capability} in {language or 'any language'} "
        f"based on quality, readiness, latency tier, and routing hints."
    )
    return winner, reason


def benchmark_model_packs() -> list[ModelPackBenchmark]:
    latency_ms = {"realtime": 120, "interactive": 650, "batch": 2500, "manual": 0}
    memory_default = {"tts": 2048, "asr": 4096, "translation": 4096}
    benchmarks: list[ModelPackBenchmark] = []
    for pack in list_model_packs():
        compatibility_ram = pack.compatibility.get("ram_mb") if pack.compatibility else None
        memory_mb = int(compatibility_ram) if isinstance(compatibility_ram, int) else memory_default[pack.category]
        language_quality = min(
            100,
            pack.quality_score
            + (8 if any(language.lower() in {"multilingual", "200 languages"} for language in pack.languages) else 0)
            + (5 if pack.status == "ready" else 0),
        )
        benchmarks.append(
            ModelPackBenchmark(
                id=pack.id,
                name=pack.name,
                category=pack.category,
                status=pack.status,
                quality_score=pack.quality_score,
                naturalness_score=min(100, pack.quality_score + (4 if pack.category == "tts" else 0)),
                language_quality=language_quality,
                latency_ms_estimate=latency_ms.get(pack.latency_tier or "manual", 0),
                memory_mb_estimate=memory_mb,
                best_for=pack.routing_hints[:4],
                measured=pack.status == "ready",
                detail=pack.detail,
            )
        )
    return sorted(benchmarks, key=lambda item: item.quality_score, reverse=True)


_DEFAULT_BENCHMARK_SCRIPTS = {
    "narration": [
        "Kural keeps voices local, private, and ready for long-form narration.",
        "Use clean punctuation and natural pauses for a more human read.",
    ],
    "dubbing": [
        "This translated line must fit the timing of the original speaker.",
        "Shorter phrases make subtitle retiming and lip-sync easier.",
    ],
    "clone": [
        "This sample checks whether a cloned voice sounds steady and clear.",
        "Room noise, clipping, and uneven volume reduce clone quality.",
    ],
    "agent": [
        "I can answer locally, use Kural tools, and speak back through the selected voice.",
    ],
    "audiobook": [
        "Chapter one begins with a measured pace, clear emphasis, and consistent warmth.",
    ],
}


def _script_complexity_penalty(scripts: list[str]) -> int:
    text = " ".join(scripts)
    words = [word for word in text.split() if word]
    long_words = sum(1 for word in words if len(word) > 12)
    punctuation = sum(1 for ch in text if ch in ",;:!?")
    return min(12, long_words + max(0, punctuation - 6))


def _benchmark_latency(pack: ModelPackInfo, sample_count: int) -> int:
    started = time.perf_counter()
    base = next(
        (
            item.latency_ms_estimate
            for item in benchmark_model_packs()
            if item.id == pack.id
        ),
        0,
    )
    probe_ms = int((time.perf_counter() - started) * 1000)
    status_penalty = 0 if pack.status == "ready" else 250
    return max(0, base + probe_ms + status_penalty + sample_count * 20)


def run_voice_quality_benchmark(
    req: VoiceQualityBenchmarkRequest,
) -> VoiceQualityBenchmarkResponse:
    """Rank local model packs for the requested language/use case.

    The first public-beta runner intentionally avoids hidden downloads. It
    performs timed local metadata probes and uses installed/readiness signals
    to rank candidates. Heavy render probes can slot in here once each engine
    exposes a uniform safe sample-render API.
    """
    scripts = [
        script.strip()
        for script in (req.sample_scripts or _DEFAULT_BENCHMARK_SCRIPTS[req.use_case])
        if script.strip()
    ][:6]
    if not scripts:
        scripts = _DEFAULT_BENCHMARK_SCRIPTS["narration"]

    packs = [
        pack
        for pack in list_model_packs()
        if _language_matches(pack, req.language) and _capability_matches(pack, req.capability)
    ]
    if not packs:
        packs = [
            pack
            for pack in list_model_packs()
            if _language_matches(pack, req.language)
        ]

    complexity_penalty = _script_complexity_penalty(scripts)
    results: list[VoiceQualityBenchmarkResult] = []
    for pack in packs:
        measured = pack.status == "ready"
        latency = _benchmark_latency(pack, len(scripts))
        compatibility_ram = pack.compatibility.get("ram_mb") if pack.compatibility else None
        memory_mb = int(compatibility_ram) if isinstance(compatibility_ram, int) else 2048
        naturalness = min(
            100,
            max(
                0,
                pack.quality_score
                + (6 if measured else -4)
                + (4 if req.use_case in pack.routing_hints else 0)
                - complexity_penalty,
            ),
        )
        language_quality = min(
            100,
            max(
                0,
                pack.quality_score
                + (10 if _language_matches(pack, req.language) else -10)
                + (5 if any(item.lower() == "multilingual" for item in pack.languages) else 0),
            ),
        )
        noise_score = 94 if measured else 82
        latency_score = max(0, 100 - min(80, latency // 75))
        score = round(
            naturalness * 0.35
            + language_quality * 0.25
            + noise_score * 0.15
            + latency_score * 0.15
            + (10 if measured else 0)
        )
        results.append(
            VoiceQualityBenchmarkResult(
                id=pack.id,
                name=pack.name,
                category=pack.category,
                status=pack.status,
                score=max(0, min(100, score)),
                naturalness_score=naturalness,
                language_quality=language_quality,
                noise_score=noise_score,
                latency_ms=latency,
                memory_mb=memory_mb,
                measured=measured,
                route_rank=1,
                best_for=pack.routing_hints[:5],
                detail=(
                    "Timed local metadata probe; audio render probe pending a uniform engine adapter."
                    if not measured
                    else "Ready local runtime included in benchmark ranking."
                ),
            )
        )

    results.sort(key=lambda item: (item.score, item.measured), reverse=True)
    for index, result in enumerate(results, start=1):
        result.route_rank = index

    pack, reason = recommend_model_pack(language=req.language, capability=req.capability)
    recommendation = ModelRouteRecommendation(
        language=req.language,
        capability=req.capability,
        pack=pack,
        reason=reason,
    )
    return VoiceQualityBenchmarkResponse(
        measured_at=_now(),
        language=req.language,
        capability=req.capability,
        use_case=req.use_case,
        sample_scripts=scripts,
        results=results,
        recommendation=recommendation,
    )


def _issue(code: str, severity: str, message: str) -> MarketplaceValidationIssue:
    return MarketplaceValidationIssue(code=code, severity=severity, message=message)  # type: ignore[arg-type]


def _canonical_manifest_digest(manifest: MarketplacePackManifest) -> str:
    payload = manifest.model_dump(mode="json", exclude_none=True)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def validate_marketplace_manifest(
    manifest: MarketplacePackManifest,
) -> MarketplaceValidationResponse:
    errors: list[MarketplaceValidationIssue] = []
    warnings: list[MarketplaceValidationIssue] = []

    if manifest.pack_type == "voice":
        if not manifest.consent_proof:
            errors.append(
                _issue(
                    "consent_proof_required",
                    "error",
                    "Community voice packs must include consent proof.",
                )
            )
        if not manifest.sample_sha256 or not manifest.sample_sha256.startswith("sha256:"):
            errors.append(
                _issue(
                    "sample_hash_required",
                    "error",
                    "Community voice packs must include a sha256 sample hash.",
                )
            )
        if not manifest.allowed_uses:
            errors.append(
                _issue(
                    "allowed_uses_required",
                    "error",
                    "Community voice packs must declare allowed uses.",
                )
            )

    if not manifest.license:
        errors.append(_issue("license_required", "error", "Pack license is required."))
    elif "cc-by-nc" in manifest.license.lower() or "non-commercial" in manifest.license.lower():
        warnings.append(
            _issue(
                "non_commercial_license",
                "warning",
                "This pack has a non-commercial license gate.",
            )
        )

    if not manifest.checksum or not manifest.checksum.startswith("sha256:"):
        errors.append(
            _issue(
                "checksum_required",
                "error",
                "Pack payload checksum must use sha256:<digest>.",
            )
        )

    if not manifest.signature:
        warnings.append(
            _issue(
                "signature_missing",
                "warning",
                "Unsigned packs can be reviewed but are not installable.",
            )
        )

    ram = manifest.compatibility.get("ram_mb")
    if not isinstance(ram, int):
        warnings.append(
            _issue(
                "ram_unknown",
                "warning",
                "Compatibility should include ram_mb so Kural can preflight installs.",
            )
        )

    if manifest.provenance_required is False or manifest.watermark_required is False:
        warnings.append(
            _issue(
                "provenance_optional",
                "warning",
                "Kural recommends provenance and watermark requirements for shared packs.",
            )
        )

    digest = _canonical_manifest_digest(manifest)
    base_score = 100
    base_score -= len(errors) * 30
    base_score -= len(warnings) * 8
    if manifest.signature:
        base_score += 6
    if manifest.consent_proof:
        base_score += 4
    score = max(0, min(100, base_score))
    # "signed" = a signature string is present and there are no blocking errors.
    # Kural does NOT yet cryptographically verify the signature, so the label is
    # deliberately "signed", not "verified" — it must not over-promise trust.
    installable = not errors and bool(manifest.signature)
    trust_level = "signed" if installable else "blocked" if errors else "review_required"
    return MarketplaceValidationResponse(
        accepted=not errors,
        installable=installable,
        trust_level=trust_level,  # type: ignore[arg-type]
        score=score,
        manifest_digest=digest,
        errors=errors,
        warnings=warnings,
    )


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


def _pinned_kokoro_checksums() -> dict[str, str]:
    """Per-file SHA-256 digests for the Kokoro assets, if the operator pinned
    them via env. Empty by default — ``download_models.py`` is the primary
    integrity gate (it verifies during download); this is post-install
    defense-in-depth that also catches on-disk corruption / a stale ``.part``.
    """
    return {
        settings.kokoro_model_file: os.environ.get("KURAL_KOKORO_MODEL_SHA256", "").strip(),
        settings.kokoro_voices_file: os.environ.get("KURAL_KOKORO_VOICES_SHA256", "").strip(),
    }


def _verify_pinned_assets(root: Path, checksums: dict[str, str]) -> None:
    for name, checksum in checksums.items():
        if not checksum:
            continue
        digest = checksum if checksum.startswith("sha256:") else f"sha256:{checksum}"
        validate_checksum(root / name, digest)


def _install_or_update(job_id: str, manifest: ModelPackManifest) -> None:
    env = os.environ.copy()
    scripts = _scripts_dir()
    if manifest.install_kind == "download-kokoro":
        model_root = _expand(settings.model_cache_dir) or _model_pack_root() / "kokoro"
        env["MODEL_CACHE_DIR"] = str(model_root)
        _run_command(job_id, [sys.executable, str(scripts / "download_models.py")], env)
        _verify_pinned_assets(model_root, _pinned_kokoro_checksums())
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


def _assert_kural_owned(path: Path, manifest: ModelPackManifest) -> None:
    """Refuse to bulk-delete a directory Kural does not own.

    Some packs (notably Argos) default their path to a *shared* OS location
    such as ``~/.local/share/argos-translate/packages``, which can hold
    packages the user installed outside Kural. Only remove paths under the
    Kural model root so a pack "remove" can never wipe a third-party store.
    """
    root = _model_pack_root()
    if not (path == root or _is_within(path, root)):
        raise ModelPackError(
            f"{manifest.name} lives in a shared or external location ({path}) that "
            "Kural does not manage; remove it with the tool that installed it "
            "(for Argos, use argospm) instead of deleting the whole folder."
        )


def _remove_manifest_files(manifest: ModelPackManifest) -> None:
    path = _expand(manifest.path_setting)
    if path is None:
        raise ModelPackError(f"{manifest.name} does not have a configured local path.")
    if not path.exists():
        return
    _assert_safe_delete_target(path)
    _assert_kural_owned(path, manifest)
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
