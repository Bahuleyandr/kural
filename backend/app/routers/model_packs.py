from fastapi import APIRouter, HTTPException

from ..local_models.model_packs import (
    ModelPackError,
    benchmark_model_packs,
    cancel_model_pack_job,
    get_job,
    list_jobs,
    list_model_packs,
    recommend_model_pack,
    start_model_pack_job,
)
from ..models import (
    BackgroundJob,
    ModelPackBenchmarksResponse,
    ModelPacksResponse,
    ModelRouteRecommendation,
)

router = APIRouter(tags=["model-packs"])


def _error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _model_pack_exception(exc: ModelPackError) -> HTTPException:
    message = str(exc)
    if message.startswith("Unknown model pack:"):
        return HTTPException(
            status_code=404,
            detail=_error("model_pack_not_found", message),
        )
    return HTTPException(
        status_code=400,
        detail=_error("model_pack_action_unavailable", message),
    )


@router.get("/model-packs", response_model=ModelPacksResponse)
async def model_packs() -> ModelPacksResponse:
    packs = list_model_packs()
    return ModelPacksResponse(packs=packs, jobs=list_jobs(), total=len(packs))


@router.get("/model-packs/benchmarks", response_model=ModelPackBenchmarksResponse)
async def model_pack_benchmarks() -> ModelPackBenchmarksResponse:
    benchmarks = benchmark_model_packs()
    return ModelPackBenchmarksResponse(benchmarks=benchmarks, total=len(benchmarks))


@router.get("/model-packs/recommend", response_model=ModelRouteRecommendation)
async def model_pack_recommendation(
    language: str = "",
    capability: str = "tts",
) -> ModelRouteRecommendation:
    pack, reason = recommend_model_pack(language=language, capability=capability)
    return ModelRouteRecommendation(language=language, capability=capability, pack=pack, reason=reason)


@router.post("/model-packs/{pack_id}/install", response_model=BackgroundJob, status_code=202)
async def install_model_pack(pack_id: str) -> BackgroundJob:
    try:
        return start_model_pack_job(pack_id, "install")
    except ModelPackError as exc:
        raise _model_pack_exception(exc) from exc


@router.post("/model-packs/{pack_id}/update", response_model=BackgroundJob, status_code=202)
async def update_model_pack(pack_id: str) -> BackgroundJob:
    try:
        return start_model_pack_job(pack_id, "update")
    except ModelPackError as exc:
        raise _model_pack_exception(exc) from exc


@router.delete("/model-packs/{pack_id}", response_model=BackgroundJob, status_code=202)
async def remove_model_pack(pack_id: str) -> BackgroundJob:
    try:
        return start_model_pack_job(pack_id, "remove")
    except ModelPackError as exc:
        raise _model_pack_exception(exc) from exc


@router.get("/model-packs/jobs/{job_id}", response_model=BackgroundJob)
async def model_pack_job(job_id: str) -> BackgroundJob:
    try:
        return get_job(job_id)
    except ModelPackError as exc:
        raise HTTPException(
            status_code=404,
            detail=_error("model_pack_job_not_found", str(exc)),
        ) from exc


@router.delete("/model-packs/jobs/{job_id}", response_model=BackgroundJob)
async def cancel_job(job_id: str) -> BackgroundJob:
    try:
        return cancel_model_pack_job(job_id)
    except ModelPackError as exc:
        raise HTTPException(
            status_code=404,
            detail=_error("model_pack_job_not_found", str(exc)),
        ) from exc
