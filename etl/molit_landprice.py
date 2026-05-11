"""국토교통부 공시지가 ETL — Phase 1.6 wedge (의정부 금오동 × 202412).

MOLIT_API_KEY 환경변수 필수 (VWorld 인증키).
엔드포인트 placeholder — 발급 후 URL·파라미터 정확화 필요.
참고: https://www.vworld.kr/dev/v4api.do
"""

import os
import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.etl_lock import acquire_lock, LockBusyError
from utils.etl_retry import with_retry, RetryExhausted
from utils.rate_tracker import RateTracker
from utils.etl_base import transform_cell, save_cell, update_manifest, update_dataset_schedule

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

DATASET_KEY = "molit_landprice"

WEDGE_ADM_CD = "4115011000"
WEDGE_DONG = "의정부시 금오동"
WEDGE_PERIOD = "202412"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_raw" / DATASET_KEY

# VWorld 공시지가 API — placeholder (발급 후 정확화)
MOLIT_BASE_URL = "https://api.vworld.kr/req/data"


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

@with_retry(max_attempts=4, backoff_seconds=[300, 900, 3600])
def fetch_molit(api_key: str, adm_cd: str, period: str) -> list:
    """국토교통부 VWorld 공시지가 API 호출. 실패 시 예외 raise → with_retry 재시도.
    파라미터명은 실 API 발급 후 확정 (현재 VWorld GetFeature 공통 규격 기준)."""
    params = {
        "service": "data",
        "request": "GetFeature",
        "key": api_key,
        "format": "json",
        "size": "100",
        "page": "1",
        "data": "LP_PA_CBND_BUBUN",          # 공시지가 레이어 (발급 후 정확화)
        "attrFilter": f"pnu:like:{adm_cd}",  # 필지번호 접두 필터
        "crs": "EPSG:4326",
    }
    url = f"{MOLIT_BASE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    # VWorld 공통 응답 처리
    # 정상: {"response": {"status": "OK", "result": {"featureCollection": {"features": [...]}}}}
    if isinstance(body, dict):
        status = body.get("response", {}).get("status", "")
        if status == "OK":
            features = (
                body.get("response", {})
                    .get("result", {})
                    .get("featureCollection", {})
                    .get("features", [])
            )
            return [f.get("properties", {}) for f in features]
        if status:
            raise RuntimeError(f"VWorld API 오류: status={status}, body={json.dumps(body)[:200]}")

    return []


# ---------------------------------------------------------------------------
# parse
# ---------------------------------------------------------------------------

def parse_molit_response(raw: list) -> list:
    """VWorld feature properties → 표준 필드 정규화.
    실 API 발급 전이므로 필드명은 placeholder (pnu/pblntfPc/lndcgrCd 등 공시지가 표준)."""
    result = []
    for item in raw:
        result.append({
            "pnu": item.get("pnu", ""),              # 필지번호 (PNU 19자리)
            "land_price": item.get("pblntfPc", 0),   # 공시지가 (원/㎡)
            "area_m2": item.get("lndpclAr", 0),      # 토지 면적 (㎡)
            "land_use": item.get("lndcgrCd", ""),    # 용도지역 코드
            "base_year": item.get("stdrYear", ""),   # 기준연도
        })
    return result


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

_DRY_RUN_MOCK = [
    # (pnu_tail, land_price, area_m2, land_use, base_year)
    ("4115011000101990000", 1_850_000, 142.0, "2종일반주거", "2024"),
    ("4115011000102000001", 1_720_000,  98.5, "2종일반주거", "2024"),
    ("4115011000200010005", 2_100_000,  55.3, "일반상업",   "2024"),
    ("4115011000200020002", 1_980_000,  76.8, "일반상업",   "2024"),
    ("4115011000300010001",   950_000, 310.0, "자연녹지",   "2024"),
]


def run(dry_run: bool = False) -> dict:
    """단일 셀 ETL (의정부 금오동 × 202412).
    dry_run=True : mock 5건
    dry_run=False: MOLIT_API_KEY 환경변수 필수
    """
    api_key = os.getenv("MOLIT_API_KEY", "")
    if not api_key and not dry_run:
        return {"status": "blocked", "reason": "MOLIT_API_KEY 미설정"}

    try:
        with acquire_lock(DATASET_KEY) as _lock:
            rate = RateTracker(DATASET_KEY, daily_limit=1000, throttle_pct=0.80)
            if rate.should_throttle():
                return {"status": "throttled", "reason": "rate limit 80% 도달"}

            if dry_run:
                raw = [
                    {
                        "pnu": pnu,
                        "land_price": price,
                        "area_m2": area,
                        "land_use": use,
                        "base_year": year,
                    }
                    for pnu, price, area, use, year in _DRY_RUN_MOCK
                ]
            else:
                raw_features = fetch_molit(api_key, WEDGE_ADM_CD, WEDGE_PERIOD)
                raw = parse_molit_response(raw_features)
                rate.record_call()

            rec = transform_cell(
                DATASET_KEY, WEDGE_ADM_CD, WEDGE_DONG, WEDGE_PERIOD, raw, dry_run
            )
            out = save_cell(rec, OUTPUT_DIR, WEDGE_ADM_CD, WEDGE_PERIOD)
            result = {
                "status": "success",
                "output": str(out),
                "marker": rec["marker"],
                "records": len(raw),
            }
            warn = update_manifest(
                WEDGE_ADM_CD, DATASET_KEY, 1, 5, rec["marker"], rec["fetched_at"]
            )
            if warn:
                result["manifest_warning"] = warn
            sched_warn = update_dataset_schedule(DATASET_KEY, "success", rec["fetched_at"])
            if sched_warn:
                result["schedule_warning"] = sched_warn
            return result

    except LockBusyError:
        return {"status": "blocked", "reason": "이미 실행 중"}
    except RetryExhausted as e:
        return {"status": "error", "reason": str(e)}
    except Exception as e:
        return {"status": "error", "reason": str(e)}


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    result = run(dry_run=dry)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("status") == "success" else 1)
