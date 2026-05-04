"""KOSIS 생활인구 ETL — Phase 1 wedge (의정부 금오동 × 2024-12 1셀).

기존 안전망 활용:
- utils/etl_lock.acquire_lock()  — context manager, fcntl exclusive lockfile
- utils/etl_retry.with_retry()   — exponential backoff decorator [300, 900, 3600]
- utils/rate_tracker.RateTracker — should_throttle() + record_call()

주의: KOSIS 통계표ID(userStatsId)는 API 키 발급 후 생활인구 표를 조회하여
      실제 값으로 교체 필요. 현재 placeholder "kosis/101/DT_1B04A1/2/1/..."
      미일치 시 fetch_kosis()가 빈 list 또는 에러를 반환한다.

KOSIS endpoint:
    https://kosis.kr/openapi/Param/statisticsParameterData.do
    (참고: https://kosis.kr/openapi/apiDesignGuide.do)
"""

import os
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.etl_lock import acquire_lock, LockBusyError
from utils.etl_retry import with_retry, RetryExhausted
from utils.rate_tracker import RateTracker
from utils.manifest_repo import JSONManifestRepo

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

DATASET_KEY = "kosis_living_pop"

# 의정부시 금오동 법정동 코드 (KOSIS objL1 파라미터용)
# KOSIS 행정구역 분류 기준: 경기도(41) > 의정부시(150) > 금오동(11000)
# 실제 API 조회 시 코드 불일치 가능성 있음 — 아래 URL로 확인 후 수정:
# https://kosis.kr/openapi/Param/statisticsParameterData.do
#   ?method=getList&apiKey=<key>&format=json&jsonVD=Y
#   &userStatsId=kosis/101/DT_1B04A1/2/1/...&prdSe=M&newEstPrdCnt=1
WEDGE_ADM_CD = "4115011000"  # 추정값 — API 발급 후 검증 필요

WEDGE_PERIOD = "202412"

# 생활인구 통계표ID placeholder
# 실제 표ID: KOSIS 공개통계 > 인구 > 생활인구 > "통신사 유동인구 통계" 참고
KOSIS_STATS_ID = "kosis/101/DT_1B04A1/2/1/A"  # placeholder

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_raw" / DATASET_KEY

KOSIS_BASE_URL = "https://kosis.kr/openapi/Param/statisticsParameterData.do"


# ---------------------------------------------------------------------------
# fetch (retry decorator 적용)
# ---------------------------------------------------------------------------

@with_retry(max_attempts=4, backoff_seconds=[300, 900, 3600])
def fetch_kosis(api_key: str, adm_cd: str, period: str) -> list:
    """KOSIS Open API 호출. 실패 시 예외 raise → with_retry가 재시도."""
    params = {
        "method": "getList",
        "apiKey": api_key,
        "format": "json",
        "jsonVD": "Y",
        "userStatsId": KOSIS_STATS_ID,
        "prdSe": "M",
        "newEstPrdCnt": "1",
        "objL1": adm_cd,
        "startPrdDe": period,
        "endPrdDe": period,
    }
    url = f"{KOSIS_BASE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    # KOSIS API 오류 응답 처리 ({"errMsg": "...", "result": "..."})
    if isinstance(body, dict) and "errMsg" in body:
        raise RuntimeError(f"KOSIS API 오류: {body.get('errMsg')} / {body.get('result')}")

    return body if isinstance(body, list) else [body]


# ---------------------------------------------------------------------------
# transform / save
# ---------------------------------------------------------------------------

def transform(raw: list, adm_cd: str, period: str, dry_run: bool = False) -> dict:
    """KOSIS 응답 → 표준 레코드 형태."""
    return {
        "dataset_key": DATASET_KEY,
        "adm_cd": adm_cd,
        "adm_nm": "의정부시 금오동",
        "period": period,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "records": raw,
        "marker": "synthetic" if dry_run else "real",
    }


def save(rec: dict, adm_cd: str, period: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fp = OUTPUT_DIR / f"{adm_cd}_{period}.json"
    fp.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
    return fp


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def run(dry_run: bool = False) -> dict:
    """단일 셀 ETL (의정부 금오동 × 2024-12).

    dry_run=True : API 호출 없이 mock 데이터로 파이프라인 검증
    dry_run=False: KOSIS_API_KEY 환경변수 필수
    """
    api_key = os.getenv("KOSIS_API_KEY", "")
    if not api_key and not dry_run:
        return {"status": "blocked", "reason": "KOSIS_API_KEY 미설정"}

    try:
        with acquire_lock(DATASET_KEY) as _lock:
            rate = RateTracker(DATASET_KEY, daily_limit=5000, throttle_pct=0.80)
            if rate.should_throttle():
                return {"status": "throttled", "reason": "rate limit 80% 도달"}

            if dry_run:
                raw = [{"mock": True, "value": 12345,
                        "adm_cd": WEDGE_ADM_CD, "period": WEDGE_PERIOD}]
            else:
                raw = fetch_kosis(api_key, WEDGE_ADM_CD, WEDGE_PERIOD)
                rate.record_call()

            rec = transform(raw, WEDGE_ADM_CD, WEDGE_PERIOD, dry_run=dry_run)
            out = save(rec, WEDGE_ADM_CD, WEDGE_PERIOD)
            result = {
                "status": "success",
                "output": str(out),
                "marker": rec["marker"],
            }
            # manifest 캐스케이드 — 성공 시만. 실패해도 ETL 결과에 영향 없음.
            try:
                repo = JSONManifestRepo()
                repo.set_dataset_coverage(
                    adm_cd=WEDGE_ADM_CD,
                    dataset_key=DATASET_KEY,
                    months_covered=1,
                    months_total=5,  # target_datasets 5개 = 5 months_total 로 완료율 환산
                    marker=rec["marker"],
                    last_updated=rec["fetched_at"],
                )
            except Exception as manifest_err:
                result["manifest_warning"] = str(manifest_err)
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
