"""LocalData 사업체 ETL — Phase 1.5 wedge (의정부 금오동 × 현재월).

기존 안전망 활용:
- utils/etl_lock.acquire_lock()  — context manager, fcntl exclusive lockfile
- utils/etl_retry.with_retry()   — exponential backoff decorator [300, 900, 3600]
- utils/rate_tracker.RateTracker — should_throttle() + record_call()

주의: LOCALDATA_API_KEY 및 WEDGE_OPNSVCID(업종 코드)는 키 발급 후 정확화 필요.
현재 placeholder "01_01_02_P" (음식점업 추정값).

LocalData endpoint:
    https://www.localdata.go.kr/platform/rest/TO0/openDataApi
    (참고: https://www.localdata.go.kr/devcenter/)
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
from utils.etl_base import transform_cell, save_cell, update_manifest

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

DATASET_KEY = "localdata_biz"

# 의정부시 금오동 법정동 코드 (4115011000) — KOSIS와 동일 기준
WEDGE_ADM_CD = "4115011000"

# LocalData는 행정동 명칭 문자열로 검색 (adm_cd 직접 지원 안 됨)
WEDGE_DONG_NAME = "의정부시 금오동"

# 업종코드 placeholder (음식점업) — 발급 후 실 코드로 교체
WEDGE_OPNSVCID = "01_01_02_P"

# 현재월 기준 (YYYYMM)
WEDGE_PERIOD = datetime.now(timezone.utc).strftime("%Y%m")

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_raw" / DATASET_KEY

LOCALDATA_BASE_URL = "https://www.localdata.go.kr/platform/rest/TO0/openDataApi"


# ---------------------------------------------------------------------------
# fetch (retry decorator 적용)
# ---------------------------------------------------------------------------

@with_retry(max_attempts=4, backoff_seconds=[300, 900, 3600])
def fetch_localdata(api_key: str, dong_name: str, opnsvcid: str) -> list:
    """LocalData Open API 호출. 실패 시 예외 raise → with_retry가 재시도."""
    params = {
        "authKey": api_key,
        "resultType": "json",
        "pageIndex": "1",
        "pageSize": "100",
        "opnSvcId": opnsvcid,
        "state": "01",          # 영업 중 (01: 영업, 02: 폐업)
        "rdnWhlAddr": dong_name,
    }
    url = f"{LOCALDATA_BASE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    # LocalData API 오류 응답 처리
    # 정상 응답 구조: {"result": {"header": {...}, "body": [...]}}
    if isinstance(body, dict):
        result = body.get("result", {})
        header = result.get("header", {})
        err_cd = header.get("process_cd", "")
        if err_cd and err_cd != "00":
            raise RuntimeError(
                f"LocalData API 오류: {header.get('process_msg', '')} (code={err_cd})"
            )
        items = result.get("body", [])
        return items if isinstance(items, list) else [items]

    return []


# ---------------------------------------------------------------------------
# transform / save
# ---------------------------------------------------------------------------

def transform(raw: list, adm_cd: str, period: str, dry_run: bool = False) -> dict:
    return transform_cell(DATASET_KEY, adm_cd, WEDGE_DONG_NAME, period, raw, dry_run)


def save(rec: dict, adm_cd: str, period: str) -> Path:
    return save_cell(rec, OUTPUT_DIR, adm_cd, period)


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def run(dry_run: bool = False) -> dict:
    """단일 셀 ETL (의정부 금오동 × 현재월).

    dry_run=True : API 호출 없이 mock 사업체 5건으로 파이프라인 검증
    dry_run=False: LOCALDATA_API_KEY 환경변수 필수
    """
    api_key = os.getenv("LOCALDATA_API_KEY", "")
    if not api_key and not dry_run:
        return {"status": "blocked", "reason": "LOCALDATA_API_KEY 미설정"}

    try:
        with acquire_lock(DATASET_KEY) as _lock:
            rate = RateTracker(DATASET_KEY, daily_limit=1000, throttle_pct=0.80)
            if rate.should_throttle():
                return {"status": "throttled", "reason": "rate limit 80% 도달"}

            if dry_run:
                raw = [
                    {"bplcNm": "금오 순대국밥", "uptaeNm": "음식점",
                     "rdnWhlAddr": "경기도 의정부시 금오로 10", "trdStateNm": "영업"},
                    {"bplcNm": "금오 치킨나라", "uptaeNm": "음식점",
                     "rdnWhlAddr": "경기도 의정부시 금오로 22", "trdStateNm": "영업"},
                    {"bplcNm": "골드커피", "uptaeNm": "카페",
                     "rdnWhlAddr": "경기도 의정부시 금오동 135", "trdStateNm": "영업"},
                    {"bplcNm": "금오마트", "uptaeNm": "소매",
                     "rdnWhlAddr": "경기도 의정부시 금오로 45", "trdStateNm": "영업"},
                    {"bplcNm": "정성약국", "uptaeNm": "의약품",
                     "rdnWhlAddr": "경기도 의정부시 금오동 88", "trdStateNm": "영업"},
                ]
            else:
                raw = fetch_localdata(api_key, WEDGE_DONG_NAME, WEDGE_OPNSVCID)
                rate.record_call()

            rec = transform(raw, WEDGE_ADM_CD, WEDGE_PERIOD, dry_run=dry_run)
            out = save(rec, WEDGE_ADM_CD, WEDGE_PERIOD)

            # manifest_repo 커버리지 갱신 (안전하게 — 실패해도 ETL 성공 유지)
            update_manifest(WEDGE_ADM_CD, DATASET_KEY, 1, 5, rec["marker"], rec["fetched_at"])

            return {
                "status": "success",
                "output": str(out),
                "marker": rec["marker"],
                "records": len(raw),
            }

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
