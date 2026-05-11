"""VWorld 행정경계 GeoJSON ETL — Phase 1.6 wedge (의정부 금오동).

VWorld API: https://api.vworld.kr/req/data (LT_C_ADEMD_INFO)
VWORLD_API_KEY 환경변수 필수 (VWorld 개발자 포털 발급키).
once 주기 — 행정경계는 변경 빈도가 낮으므로 한 번만 수집.
저장: data_raw/vworld_geojson/{adm_cd}.geojson
"""

import os
import json
import sys
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.etl_base import update_manifest, update_dataset_schedule

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------

DATASET_KEY = "vworld_geojson"

WEDGE_ADM_CD = "4115011000"          # 의정부시 금오동 법정동 코드
WEDGE_ADM_NM = "경기도 의정부시 금오동"
WEDGE_PERIOD = "ONCE"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data_raw" / DATASET_KEY

VWORLD_BASE_URL = "https://api.vworld.kr/req/data"
VWORLD_DATA_TYPE = "LT_C_ADEMD_INFO"   # 법정동 경계 레이어 (placeholder — 발급 후 정확화)

# ---------------------------------------------------------------------------
# 금오동 대략 경계 (WGS84, 다각형 5점 — mock 용)
# 실 API 응답은 수백 개 좌표점을 포함한다.
# ---------------------------------------------------------------------------
_MOCK_POLYGON_COORDS = [
    [127.0411, 37.7421],
    [127.0468, 37.7421],
    [127.0468, 37.7376],
    [127.0411, 37.7376],
    [127.0411, 37.7421],   # 닫힘
]

_DRY_RUN_FEATURE = {
    "type": "Feature",
    "properties": {
        "adm_cd": WEDGE_ADM_CD,
        "adm_nm": WEDGE_ADM_NM,
        "bjd_cd": WEDGE_ADM_CD,
        "full_nm": WEDGE_ADM_NM,
        "marker": "synthetic",
    },
    "geometry": {
        "type": "Polygon",
        "coordinates": [_MOCK_POLYGON_COORDS],
    },
}


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------

def fetch_vworld(api_key: str, adm_cd: str) -> dict:
    """VWorld WFS GetFeature 호출 → GeoJSON FeatureCollection.
    발급 후 CQL_FILTER 파라미터 정확화 필요."""
    params = {
        "service": "data",
        "request": "GetFeature",
        "data": VWORLD_DATA_TYPE,
        "key": api_key,
        "format": "application/json",
        "size": "10",
        "cql_filter": f"ADM_CD='{adm_cd}'",   # 서버 필드명은 발급 후 확인
    }
    url = f"{VWORLD_BASE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    # VWorld 오류 응답: {"response": {"status": "ERROR", "error": {...}}}
    response = body.get("response", {})
    if response.get("status") == "ERROR":
        raise RuntimeError(f"VWorld API 오류: {response.get('error', {})}")

    return body   # GeoJSON FeatureCollection 또는 VWorld wrapper


# ---------------------------------------------------------------------------
# save
# ---------------------------------------------------------------------------

def save_geojson(feature: dict, adm_cd: str) -> Path:
    """Feature dict → data_raw/vworld_geojson/{adm_cd}.geojson 저장."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    geojson = {
        "type": "FeatureCollection",
        "features": [feature],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    fp = OUTPUT_DIR / f"{adm_cd}.geojson"
    fp.write_text(json.dumps(geojson, ensure_ascii=False, indent=2), encoding="utf-8")
    return fp


# ---------------------------------------------------------------------------
# 진입점
# ---------------------------------------------------------------------------

def run(dry_run: bool = False) -> dict:
    """단일 셀 ETL (의정부 금오동 × ONCE).
    dry_run=True : mock GeoJSON 1건
    dry_run=False: VWORLD_API_KEY 환경변수 필수
    """
    api_key = os.getenv("VWORLD_API_KEY", "")
    if not api_key and not dry_run:
        return {"status": "blocked", "reason": "VWORLD_API_KEY 미설정"}

    try:
        if dry_run:
            feature = _DRY_RUN_FEATURE
        else:
            body = fetch_vworld(api_key, WEDGE_ADM_CD)
            # VWorld 응답 구조에 따라 Feature 추출 (발급 후 경로 정확화)
            features = body.get("features") or body.get("response", {}).get("result", {}).get("featureCollection", {}).get("features", [])
            if not features:
                return {"status": "error", "reason": "VWorld 응답에 features 없음"}
            feature = features[0]

        out = save_geojson(feature, WEDGE_ADM_CD)
        fetched_at = datetime.now(timezone.utc).isoformat()
        marker = "synthetic" if dry_run else "real"

        result = {
            "status": "success",
            "output": str(out),
            "marker": marker,
            "geometry_type": feature.get("geometry", {}).get("type", "unknown"),
        }

        # manifest 갱신 (once = 1/1)
        warn = update_manifest(WEDGE_ADM_CD, DATASET_KEY, 1, 1, marker, fetched_at)
        if warn:
            result["manifest_warning"] = warn
        sched_warn = update_dataset_schedule(DATASET_KEY, "success", fetched_at)
        if sched_warn:
            result["schedule_warning"] = sched_warn

        return result

    except Exception as e:
        return {"status": "error", "reason": str(e)}


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    result = run(dry_run=dry)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("status") == "success" else 1)
