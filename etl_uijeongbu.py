#!/usr/bin/env python3
"""의정부 금오동 PHASE 1 ETL — 명분 등급 S 데이터 5종 수집.

수집 대상:
  D1 LOCALDATA       — 카페 인허가 1년치
  D2 소진공 상권정보   — 점포 분포
  B1 SGIS 인구통계    — 연령/성별
  A1 VWorld 행정경계  — 폴리곤
  A2/A3 주소DB+SGIS   — 행정동 코드 매핑

각 호출은 utils.provenance.write_stamped()로 출처를 부착하고,
utils.data_cache.fetch_or_load()로 ETag 캐싱한다.
키 미보유로 실패한 자원은 mark_failure()로 sources_meta.json에 기록한다.

사용:
    python3 etl_uijeongbu.py              # 전체
    python3 etl_uijeongbu.py --step sgis  # 단일 단계

행정동: 의정부시 금오동 (adm_cd: 4115059500)
        법정동 부분이 1동/2동으로 나뉘는 경우 행정동 통합 코드를 사용.
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))

from utils.provenance import write_stamped, mark_failure, load_index  # noqa: E402
from utils.data_cache import fetch_json  # noqa: E402


# ─────────────────────────────────────────────
# 환경 / 상수
# ─────────────────────────────────────────────
ENV: dict[str, str] = {}
env_file = BASE_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            ENV[k.strip()] = v.strip()

SGIS_KEY = ENV.get("SGIS_CONSUMER_KEY", "")
SGIS_SECRET = ENV.get("SGIS_CONSUMER_SECRET", "")
LOCALDATA_KEY = ENV.get("LOCALDATA_API_KEY", "")
SOSANG_KEY = ENV.get("SOSANG_API_KEY", "")
VWORLD_KEY = ENV.get("VWORLD_API_KEY", "")

REGION_DIR = BASE_DIR / "data_raw" / "uijeongbu_geomo"
REGION_DIR.mkdir(parents=True, exist_ok=True)

# 의정부 금오동 통합 행정동 코드
DONG_INFO = {
    "name": "의정부시 금오동",
    "sgis_adm_cd9": "411505950",
    "haengjeong_adm_cd": "4115059500",
    "sido_cd": "41",
    "sigungu_cd": "41150",
    "sigungu_name": "의정부시",
}


# ─────────────────────────────────────────────
# A1. VWorld 행정경계 폴리곤
# ─────────────────────────────────────────────
def fetch_vworld_boundary() -> Path:
    out = REGION_DIR / "vworld.json"
    base = "https://api.vworld.kr/req/data"
    if not VWORLD_KEY:
        mark_failure(out, "국토지리정보원 VWorld", base, "VWORLD_API_KEY 미설정")
        print("⚠️  VWorld 키 없음 → status=fail 기록")
        return out

    params = {
        "service": "data",
        "request": "GetFeature",
        "data": "LT_C_ADEMD_INFO",
        "key": VWORLD_KEY,
        "domain": "localhost",
        "attrFilter": "emd_kor_nm:like:금오동",
        "geomFilter": "BOX(127.0,37.7,127.2,37.8)",
        "format": "json",
        "size": 100,
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="vworld:geomo")
        write_stamped(
            out,
            data,
            source="국토지리정보원 VWorld",
            url=base,
            license="공공누리 제1유형",
            confidence=0.98,
            notes=f"caching: cached={info.get('cached')}",
        )
        print(f"✅ VWorld 폴리곤 → {out}")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "국토지리정보원 VWorld", url, str(exc))
        print(f"❌ VWorld 실패: {exc}")
    return out


# ─────────────────────────────────────────────
# A2/A3. 주소 DB + SGIS 코드 매핑
# ─────────────────────────────────────────────
def fetch_address_codes() -> Path:
    out = REGION_DIR / "juso.json"
    payload = {
        "dong": DONG_INFO,
        "code_mapping": {
            "haengjeong_dong": DONG_INFO["haengjeong_adm_cd"],
            "sgis_adm_cd": DONG_INFO["sgis_adm_cd9"],
            "bjd_dong_examples": [
                {"code": "4115012600", "name": "금오동(법정동)"},
            ],
        },
        "note": "행안부 주소DB + SGIS 통계지리 매핑. 추후 JUSO API로 자동 갱신.",
    }
    write_stamped(
        out,
        payload,
        source="행정안전부 주소기반산업지원서비스 + SGIS 통계지리",
        url="https://business.juso.go.kr/  +  https://sgis.kostat.go.kr/",
        license="KOGL Type 1",
        confidence=0.9,
        notes="정적 매핑 (PoC). JUSO_API_KEY 확보 시 자동 검증으로 전환.",
    )
    print(f"✅ 주소/코드 매핑 → {out}")
    return out


# ─────────────────────────────────────────────
# B1. SGIS 인구통계
# ─────────────────────────────────────────────
_sgis_token: str | None = None


def _sgis_auth() -> str | None:
    global _sgis_token
    if _sgis_token:
        return _sgis_token
    if not SGIS_KEY or not SGIS_SECRET:
        return None
    url = (
        "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json"
        f"?consumer_key={SGIS_KEY}&consumer_secret={SGIS_SECRET}"
    )
    try:
        data, _ = fetch_json(url, key="sgis:auth", force_refresh=True)
        if data.get("errCd") == 0:
            _sgis_token = data["result"]["accessToken"]
            return _sgis_token
    except Exception:  # noqa: BLE001
        return None
    return None


def fetch_sgis_population() -> Path:
    out = REGION_DIR / "sgis.json"
    token = _sgis_auth()
    base = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/searchpopulation.json"
    if not token:
        mark_failure(out, "통계청 SGIS Plus", base, "SGIS 키/인증 실패")
        print("⚠️  SGIS 키 없음 → status=fail 기록")
        return out

    params = {
        "accessToken": token,
        "year": "2023",
        "adm_cd": DONG_INFO["sgis_adm_cd9"],
        "low_search": "0",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="sgis:pop:geomo:2023")
        write_stamped(
            out,
            data,
            source="통계청 SGIS Plus · 인구통계",
            url=base,
            license="KOGL Type 1",
            confidence=0.95,
            notes=f"adm_cd={DONG_INFO['sgis_adm_cd9']} year=2023",
        )
        print(f"✅ SGIS 인구 → {out}")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "통계청 SGIS Plus", url, str(exc))
        print(f"❌ SGIS 실패: {exc}")
    return out


# ─────────────────────────────────────────────
# D1. LOCALDATA 카페 인허가
# ─────────────────────────────────────────────
def fetch_localdata_cafes() -> Path:
    out = REGION_DIR / "localdata.json"
    base = "http://www.localdata.go.kr/platform/rest/TO0/openDataApi"
    if not LOCALDATA_KEY:
        mark_failure(out, "행정안전부 LOCALDATA", base, "LOCALDATA_API_KEY 미설정")
        print("⚠️  LOCALDATA 키 없음 → status=fail 기록")
        return out

    params_common = {
        "authKey": LOCALDATA_KEY,
        "localCode": "4115000000",
        "opnSvcId": "07_24_04_P",
        "pageIndex": "1",
        "pageSize": "500",
        "resultType": "json",
    }
    url = base + "?" + urllib.parse.urlencode(params_common)
    try:
        data, info = fetch_json(url, key="localdata:uijeongbu:cafe")
        rows: list = []
        result_node = data.get("result") or {}
        body = result_node.get("body") or {}
        items = body.get("rows") or []
        if isinstance(items, list) and items and isinstance(items[0], dict) and "row" in items[0]:
            row_list = items[0].get("row", [])
        else:
            row_list = items if isinstance(items, list) else []
        for row in row_list:
            addr = (row.get("rdnWhlAddr") or "") + " " + (row.get("siteWhlAddr") or "")
            if "금오동" in addr:
                rows.append(row)

        write_stamped(
            out,
            {"dong": DONG_INFO["name"], "count": len(rows), "rows": rows},
            source="행정안전부 LOCALDATA · 휴게음식점",
            url=base,
            license="KOGL Type 1",
            confidence=0.95,
            notes=f"raw_total={len(row_list)} filtered_geomo={len(rows)}",
        )
        print(f"✅ LOCALDATA 카페 → {out} (금오동 {len(rows)}건 / 의정부 {len(row_list)}건)")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "행정안전부 LOCALDATA", url, str(exc))
        print(f"❌ LOCALDATA 실패: {exc}")
    return out


# ─────────────────────────────────────────────
# D2. 소진공 상권정보
# ─────────────────────────────────────────────
def fetch_sosang_stores() -> Path:
    out = REGION_DIR / "sangkwon.json"
    base = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong"
    if not SOSANG_KEY:
        mark_failure(out, "소상공인시장진흥공단 상권정보", base, "SOSANG_API_KEY 미설정")
        print("⚠️  소진공 키 없음 → status=fail 기록")
        return out

    params = {
        "ServiceKey": SOSANG_KEY,
        "divId": "adongCd",
        "key": DONG_INFO["haengjeong_adm_cd"],
        "type": "json",
        "numOfRows": "1000",
        "pageNo": "1",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="sosang:geomo:stores")
        body = data.get("body") or data.get("response", {}).get("body") or {}
        items_node = body.get("items", {})
        if isinstance(items_node, dict):
            items = items_node.get("item", [])
        else:
            items = items_node or []
        if isinstance(items, dict):
            items = [items]
        write_stamped(
            out,
            {"dong": DONG_INFO["name"], "count": len(items), "stores": items},
            source="소상공인시장진흥공단 상권정보",
            url=base,
            license="KOGL Type 1",
            confidence=0.9,
            notes=f"adong_cd={DONG_INFO['haengjeong_adm_cd']}",
        )
        print(f"✅ 소진공 상권 → {out} ({len(items)}건)")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "소상공인시장진흥공단", url, str(exc))
        print(f"❌ 소진공 실패: {exc}")
    return out


# ─────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────
STEPS = {
    "vworld": fetch_vworld_boundary,
    "juso": fetch_address_codes,
    "sgis": fetch_sgis_population,
    "localdata": fetch_localdata_cafes,
    "sosang": fetch_sosang_stores,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", choices=list(STEPS.keys()) + ["all"], default="all")
    args = parser.parse_args()

    print(f"\n📍 의정부 금오동 PHASE 1 데이터 수집 (행정동 코드: {DONG_INFO['haengjeong_adm_cd']})\n")

    targets = STEPS.values() if args.step == "all" else [STEPS[args.step]]
    for fn in targets:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"❌ {fn.__name__} 예외: {exc}")
        time.sleep(0.2)

    print("\n━━━ sources_meta.json 요약 ━━━")
    idx = load_index()
    for path, meta in idx.get("sources", {}).items():
        if "uijeongbu_geomo" in path:
            mark = "✅" if meta.get("status") == "ok" else "⚠️"
            print(f"  {mark} {path} — status={meta.get('status')} source={meta.get('source')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
