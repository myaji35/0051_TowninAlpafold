"""backend/whatif_api.py
ISS-219 — POST /api/whatif 엔드포인트

reverse_whatif 파이프라인을 HTTP로 접근 가능하게 한다.

마운트:
    from backend.whatif_api import router as whatif_router
    app.include_router(whatif_router)

직접 실행 (독립 테스트용):
    uvicorn backend.whatif_api:app --port 8001
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

# 프로젝트 루트
ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable

# 지원 타깃 목록
VALID_TARGETS = {"tx_volume", "visitors_total", "tx_per_visitor", "tx_delta_6m"}

# 가용 동 캐시 (최초 요청 시 simula_data_real.json 에서 로드)
_dong_cache: list[str] | None = None


def _load_dong_list(data_file: Path | None = None) -> list[str]:
    """simula 데이터에서 동 이름 목록 반환."""
    global _dong_cache
    path = data_file or ROOT / "simula_data_real.json"
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text())
        return [d["name"] for d in data.get("dongs", [])]
    except Exception:
        return []


def _resolve_dong(dong_input: str, data_file: Path | None = None) -> str | None:
    """'의정부_금오동' → '의정부 금오동' 정규화 후 데이터에서 검색."""
    normalized = dong_input.replace("_", " ").strip()
    dongs = _load_dong_list(data_file)
    # 정확 일치
    if normalized in dongs:
        return normalized
    # 공백/언더바 제거 후 부분 일치
    key = normalized.replace(" ", "").lower()
    for d in dongs:
        if key in d.replace(" ", "").lower():
            return d
    return None


# ─── Pydantic 스키마 ──────────────────────────────────────────────────────────

class WhatifRequest(BaseModel):
    dong: str = Field(..., description="동 이름 (예: '의정부 금오동' 또는 '의정부_금오동')")
    target: str = Field(..., description="분석 타깃: tx_volume | visitors_total | tx_per_visitor | tx_delta_6m")
    goal_pct: float = Field(15.0, ge=1.0, le=100.0, description="목표 증가율 (1~100%)")
    data_file: Optional[str] = Field(None, description="데이터 파일 경로 (기본: simula_data_real.json)")
    skip_train: bool = Field(True, description="기존 모델 재사용 여부 (기본: True)")

    @field_validator("target")
    @classmethod
    def validate_target(cls, v):
        if v not in VALID_TARGETS:
            raise ValueError(f"target은 {sorted(VALID_TARGETS)} 중 하나여야 합니다")
        return v


class ScenarioOut(BaseModel):
    label: str
    strategy: str
    method: str
    changes: dict
    predicted_y: float
    achievement_pct: float
    note: Optional[str] = None


class WhatifResponse(BaseModel):
    dong: str
    target: str
    goal_pct: float
    pipeline_status: str
    total_elapsed_sec: float
    scenarios: dict[str, ScenarioOut]
    narration: list[str]
    current_y: Optional[float] = None
    target_y: Optional[float] = None
    verified: bool
    data_file: Optional[str] = None


# ─── 핵심 로직 ────────────────────────────────────────────────────────────────

def _run_pipeline(dong: str, target: str, goal_pct: float,
                  data_file: str | None, skip_train: bool) -> dict:
    """reverse_whatif_pipeline.py 서브프로세스 실행 → whatif_result.json 반환."""
    cmd = [
        PYTHON, str(ROOT / "reverse_whatif_pipeline.py"),
        "--dong", dong.replace(" ", "_"),
        "--target", target,
        "--goal", str(goal_pct),
    ]
    if skip_train:
        cmd.append("--skip-train")
    if data_file:
        cmd += ["--data", data_file]

    env = {**os.environ}
    if data_file:
        path = Path(data_file)
        if not path.is_absolute():
            path = ROOT / path
        env["REVERSE_WHATIF_DATA"] = str(path)

    t0 = time.time()
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=120, cwd=ROOT, env=env
    )
    elapsed = round(time.time() - t0, 1)

    if result.returncode != 0:
        raise HTTPException(
            500,
            detail={
                "message": "파이프라인 실행 실패",
                "stderr": result.stderr[-500:],
                "elapsed_sec": elapsed,
            }
        )

    # whatif_result.json 로드
    result_path = ROOT / "whatif_result.json"
    if not result_path.exists():
        raise HTTPException(500, "whatif_result.json 생성 실패")

    return json.loads(result_path.read_text())


def _run_narrate(result_data: dict) -> list[str]:
    """reverse_whatif_narrate.py로 한국어 처방문 생성 → 시나리오별 문자열 리스트."""
    # 임시 파일 없이 직접 narrate 로직 호출
    # narrate 스크립트를 subprocess로 실행하면 I/O 오버헤드 발생 → 직접 import
    try:
        sys.path.insert(0, str(ROOT))
        from reverse_whatif_narrate import narrate_scenario, TARGET_META

        target = result_data.get("target", "tx_volume")
        goal_pct = result_data.get("goal_pct", 15.0)
        current_y = result_data.get("current_y")
        target_y = result_data.get("target_y")
        scenarios = result_data.get("scenarios") or {}

        # scenarios가 list이면 dict로 변환
        if isinstance(scenarios, list):
            scenarios = {s.get("label", f"시나리오{i}"): s for i, s in enumerate(scenarios)}

        narrations = []
        for sc_name, sc in scenarios.items():
            text = narrate_scenario(sc_name, sc, target, goal_pct, current_y, target_y)
            narrations.append(text)
        return narrations
    except Exception:
        return []


# ─── 라우터 ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["whatif"])


@router.post("/whatif", response_model=WhatifResponse)
def post_whatif(req: WhatifRequest):
    """Reverse What-If 파이프라인 실행 → 시나리오 + 한국어 처방문 반환.

    - 응답 시간: 모델 캐시 있을 때 30초 이내 (DiCE/scipy 포함)
    - goal_pct: 1~100 범위 (Pydantic 검증)
    - 잘못된 dong: 404 + 가용 동 리스트
    """
    # 데이터 파일 경로 결정
    data_path: Path | None = None
    if req.data_file:
        data_path = Path(req.data_file)
        if not data_path.is_absolute():
            data_path = ROOT / data_path
        if not data_path.exists():
            raise HTTPException(404, f"데이터 파일 없음: {req.data_file}")

    # 동 이름 검증 — 없으면 파이프라인 자체 fallback 허용 (simula[0] 대체)
    resolved = _resolve_dong(req.dong, data_path)
    if resolved is None:
        # 데이터 파일에 없으면: wedge 파일 지정 시에만 404, 기본 simula는 fallback
        if data_path:
            available = _load_dong_list(data_path)[:20]
            raise HTTPException(
                404,
                detail={
                    "message": f"동 '{req.dong}'을(를) 데이터 파일에서 찾을 수 없습니다",
                    "data_file": str(data_path),
                    "available_dongs_sample": available,
                }
            )
        # simula fallback: 입력 그대로 파이프라인에 전달 (pipeline이 dongs[0]으로 대체)
        resolved = req.dong

    # 파이프라인 실행
    result = _run_pipeline(
        dong=resolved,
        target=req.target,
        goal_pct=req.goal_pct,
        data_file=str(data_path) if data_path else None,
        skip_train=req.skip_train,
    )

    # 시나리오 정규화
    raw_scenarios = result.get("scenarios") or {}
    if isinstance(raw_scenarios, list):
        raw_scenarios = {s.get("label", f"sc{i}"): s for i, s in enumerate(raw_scenarios)}

    scenarios_out = {}
    for name, sc in raw_scenarios.items():
        scenarios_out[name] = ScenarioOut(
            label=sc.get("label", name),
            strategy=sc.get("strategy", name),
            method=sc.get("method", "unknown"),
            changes=sc.get("changes") or {},
            predicted_y=float(sc.get("predicted_y") or 0),
            achievement_pct=float(sc.get("achievement_pct") or 0),
            note=sc.get("note"),
        )

    # 한국어 처방문
    narrations = _run_narrate(result)

    pipeline_status = result.get("pipeline_status", "unknown")
    verified = pipeline_status in ("ok", "partial") and len(scenarios_out) >= 3

    return WhatifResponse(
        dong=resolved,
        target=req.target,
        goal_pct=req.goal_pct,
        pipeline_status=pipeline_status,
        total_elapsed_sec=result.get("total_elapsed_sec", 0.0),
        scenarios=scenarios_out,
        narration=narrations,
        current_y=result.get("current_y"),
        target_y=result.get("target_y"),
        verified=verified,
        data_file=req.data_file,
    )


@router.get("/whatif/targets")
def list_targets():
    """지원 타깃 목록 반환."""
    return {
        "targets": [
            {"key": "tx_volume",      "label": "부동산 거래량",         "unit": "건"},
            {"key": "visitors_total", "label": "월 유동인구",            "unit": "명"},
            {"key": "tx_per_visitor", "label": "방문자당 거래율",        "unit": "건/천명"},
            {"key": "tx_delta_6m",    "label": "거래량 6개월 모멘텀",   "unit": "건 변화"},
        ]
    }


# ─── 독립 실행용 앱 (테스트) ──────────────────────────────────────────────────

app = FastAPI(title="WhatIf API (standalone)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(router)
