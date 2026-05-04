"""국세청 사업자등록 ETL — Phase 1.5 wedge (의정부 금오동 × 202412).

NTS_API_KEY 환경변수 필수 (공공데이터포털 일반 인증키).
엔드포인트 placeholder — 발급 후 NTS_BASE_URL·파라미터 정확화 필요.
참고: https://www.data.go.kr/data/3080527/openapi.do
사업자번호는 개인정보 → dry_run mock에서 마스킹(***-**-NNNNN).
"""

import os
import json
import sys
import urllib.request
import urllib.parse
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

DATASET_KEY = "nts_bizreg"

# 의정부시 금오동 법정동 코드 (KOSIS/LocalData와 동일 기준)
WEDGE_ADM_CD = "4115011000"
WEDGE_DONG = "의정부시 금오동"
WEDGE_REGION_CD = "4115011000"  # NTS API의 지역코드 파라미터용 (발급 후 검증)

# 분기 데이터지만 Phase 1.5 wedge는 1개월 단위로 고정
WEDGE_PERIOD = "202412"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_raw" / DATASET_KEY

# 공공데이터포털 NTS 사업자등록 API — placeholder (발급 후 정확화)
NTS_BASE_URL = "https://api.odcloud.kr/api/3080527/v1/uddi"


# ---------------------------------------------------------------------------
# fetch (retry decorator 적용)
# ---------------------------------------------------------------------------

@with_retry(max_attempts=4, backoff_seconds=[300, 900, 3600])
def fetch_nts(api_key: str, region_cd: str, period: str) -> list:
    """국세청 사업자등록 Open API 호출. 실패 시 예외 raise → with_retry가 재시도.
    파라미터명은 실 API 발급 후 확정 (현재 odcloud 공통 규격 기준)."""
    params = {
        "serviceKey": api_key,
        "returnType": "json",
        "page": "1",
        "perPage": "100",
        "cond[REGION_CD::EQ]": region_cd,   # 지역코드 필터 (발급 후 정확화)
        "cond[BASE_YM::EQ]": period,         # 기준연월 필터 (YYYYMM)
    }
    url = f"{NTS_BASE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    # odcloud 공통 오류 응답 처리
    # 정상: {"currentCount": N, "data": [...], "matchCount": N, ...}
    if isinstance(body, dict):
        if "currentCount" in body:
            return body.get("data", [])
        # 오류 응답: {"resultCode": "...", "resultMsg": "..."}
        result_code = body.get("resultCode", "")
        if result_code and result_code != "00":
            raise RuntimeError(
                f"NTS API 오류: {body.get('resultMsg', '')} (code={result_code})"
            )

    return []


# ---------------------------------------------------------------------------
# transform / save
# ---------------------------------------------------------------------------

def transform(raw: list, adm_cd: str, period: str, dry_run: bool = False) -> dict:
    return transform_cell(DATASET_KEY, adm_cd, WEDGE_DONG, period, raw, dry_run)


def save(rec: dict, adm_cd: str, period: str) -> Path:
    return save_cell(rec, OUTPUT_DIR, adm_cd, period)


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

_DRY_RUN_MOCK = [
    # (biz_no_tail, biz_nm, induty_cd, induty_nm, open_dt, addr_suffix)
    ("00001", "금오 순대국밥", "56111", "한식 일반음식점업", "20190315", "금오로 10"),
    ("00002", "금오 치킨나라", "56191", "기타 음식점업",    "20210620", "금오로 22"),
    ("00003", "골드커피",     "56220", "커피전문점",        "20220101", "금오동 135"),
    ("00004", "금오마트",     "47111", "종합소매업",        "20150810", "금오로 45"),
    ("00005", "정성약국",     "47730", "의약품 소매업",     "20080501", "금오동 88"),
]


def run(dry_run: bool = False) -> dict:
    """단일 셀 ETL (의정부 금오동 × 202412).
    dry_run=True : mock 5건 (사업자번호 마스킹)
    dry_run=False: NTS_API_KEY 환경변수 필수
    """
    api_key = os.getenv("NTS_API_KEY", "")
    if not api_key and not dry_run:
        return {"status": "blocked", "reason": "NTS_API_KEY 미설정"}

    try:
        with acquire_lock(DATASET_KEY) as _lock:
            rate = RateTracker(DATASET_KEY, daily_limit=500, throttle_pct=0.80)
            if rate.should_throttle():
                return {"status": "throttled", "reason": "rate limit 80% 도달"}

            if dry_run:
                raw = [
                    {"biz_no": f"***-**-{t}", "biz_nm": nm, "induty_cd": cd,
                     "induty_nm": inm, "open_dt": od,
                     "addr": f"경기도 의정부시 {addr}", "biz_status": "01"}
                    for t, nm, cd, inm, od, addr in _DRY_RUN_MOCK
                ]
            else:
                raw = fetch_nts(api_key, WEDGE_REGION_CD, WEDGE_PERIOD)
                rate.record_call()

            rec = transform(raw, WEDGE_ADM_CD, WEDGE_PERIOD, dry_run=dry_run)
            out = save(rec, WEDGE_ADM_CD, WEDGE_PERIOD)
            result = {
                "status": "success",
                "output": str(out),
                "marker": rec["marker"],
                "records": len(raw),
            }
            # manifest 캐스케이드 — 성공 시만. 실패해도 ETL 결과에 영향 없음.
            warn = update_manifest(WEDGE_ADM_CD, DATASET_KEY, 1, 5, rec["marker"], rec["fetched_at"])
            if warn:
                result["manifest_warning"] = warn
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
