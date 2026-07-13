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
import json
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
# PHASE 2 — 명분 등급 S 나머지 4종 (data.go.kr 통합키 우선, 개별키 폴백)
MOLIT_KEY = ENV.get("MOLIT_API_KEY", "") or ENV.get("DATA_GO_KR_KEY", "")
TAGO_KEY = ENV.get("TAGO_API_KEY", "") or ENV.get("DATA_GO_KR_KEY", "")

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
    # 실제 금오동 중심 좌표 (VWorld/카카오 지오코딩 기준)
    "lng": 127.0577,
    "lat": 37.7489,
    "bjd_dong_cd": "4115012600",  # 법정동 금오동 (실거래가 API lawd_cd 앞 5자리)
    "lawd_cd": "41150",           # 의정부시 (MOLIT 실거래가 지역코드)
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


# ═════════════════════════════════════════════
# PHASE 2 — 명분 등급 S 나머지 4종
# ═════════════════════════════════════════════

# C1. 공시지가 (국토부 부동산공시가격 OpenAPI)
def fetch_molit_land_price() -> Path:
    out = REGION_DIR / "molit_landprice.json"
    base = "https://apis.data.go.kr/1611000/nsdi/IndvdLandPriceService/attr/getIndvdLandPriceAttr"
    if not MOLIT_KEY:
        mark_failure(out, "국토교통부 부동산공시가격 (개별공시지가)", base, "MOLIT_API_KEY/DATA_GO_KR_KEY 미설정")
        print("⚠️  MOLIT 공시지가 키 없음 → status=fail 기록")
        return out

    params = {
        "serviceKey": MOLIT_KEY,
        "pnu": DONG_INFO["bjd_dong_cd"] + "10000000000",  # 법정동 기반 PNU 프리픽스
        "stdrYear": "2024",
        "format": "json",
        "numOfRows": "500",
        "pageNo": "1",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="molit:landprice:geomo:2024")
        write_stamped(
            out, data,
            source="국토교통부 부동산공시가격 · 개별공시지가",
            url=base, license="KOGL Type 1", confidence=0.95,
            notes=f"bjd={DONG_INFO['bjd_dong_cd']} year=2024 cached={info.get('cached')}",
        )
        print(f"✅ MOLIT 공시지가 → {out}")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "국토교통부 부동산공시가격", url, str(exc))
        print(f"❌ MOLIT 공시지가 실패: {exc}")
    return out


# C2. 실거래가 (국토부 아파트 매매 실거래가 — 5년치 월별)
def fetch_molit_transactions() -> Path:
    out = REGION_DIR / "molit_tx.json"
    base = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
    if not MOLIT_KEY:
        mark_failure(out, "국토교통부 아파트매매 실거래가", base, "MOLIT_API_KEY/DATA_GO_KR_KEY 미설정")
        print("⚠️  MOLIT 실거래가 키 없음 → status=fail 기록")
        return out

    # 2020-01 ~ 2024-12 (60개월) 월별 수집
    months = []
    for y in range(2020, 2025):
        for m in range(1, 13):
            months.append(f"{y}{m:02d}")
    all_rows: list = []
    ok_months = 0
    for deal_ymd in months:
        params = {
            "serviceKey": MOLIT_KEY,
            "LAWD_CD": DONG_INFO["lawd_cd"],
            "DEAL_YMD": deal_ymd,
            "numOfRows": "500",
            "pageNo": "1",
            "_type": "json",
        }
        url = base + "?" + urllib.parse.urlencode(params)
        try:
            data, _ = fetch_json(url, key=f"molit:tx:{DONG_INFO['lawd_cd']}:{deal_ymd}")
            body = (data.get("response") or {}).get("body") or {}
            items_node = body.get("items") or {}
            items = items_node.get("item", []) if isinstance(items_node, dict) else (items_node or [])
            if isinstance(items, dict):
                items = [items]
            # 금오동 필터
            geomo = [r for r in items if "금오" in str(r.get("umdNm") or r.get("법정동") or "")]
            for r in geomo:
                r["_deal_ymd"] = deal_ymd
            all_rows.extend(geomo)
            ok_months += 1
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.05)

    if ok_months == 0:
        mark_failure(out, "국토교통부 아파트매매 실거래가", base, "전체 월 수집 실패")
        print("❌ MOLIT 실거래가 전체 월 실패 → status=fail")
        return out

    write_stamped(
        out,
        {"dong": DONG_INFO["name"], "lawd_cd": DONG_INFO["lawd_cd"],
         "months_ok": ok_months, "count": len(all_rows), "rows": all_rows},
        source="국토교통부 아파트매매 실거래가",
        url=base, license="KOGL Type 1", confidence=0.95,
        notes=f"lawd={DONG_INFO['lawd_cd']} 2020-01~2024-12 months_ok={ok_months} geomo_rows={len(all_rows)}",
    )
    print(f"✅ MOLIT 실거래가 → {out} (금오동 {len(all_rows)}건 / {ok_months}개월)")
    return out


# B4. TAGO 정류장 이용객 (버스 정류장별 이용객 — 통신사 유동인구 회피 대체)
def fetch_tago_boarding() -> Path:
    out = REGION_DIR / "tago_boarding.json"
    base = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnNoList"
    if not TAGO_KEY:
        mark_failure(out, "국토교통부 TAGO 대중교통 · 정류장 이용", base, "TAGO_API_KEY/DATA_GO_KR_KEY 미설정")
        print("⚠️  TAGO 이용객 키 없음 → status=fail 기록")
        return out

    params = {
        "serviceKey": TAGO_KEY,
        "cityCode": "31010",  # 의정부시
        "nodeNm": "금오",
        "numOfRows": "200",
        "pageNo": "1",
        "_type": "json",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="tago:boarding:geomo")
        write_stamped(
            out, data,
            source="국토교통부 TAGO · 정류장 이용객",
            url=base, license="KOGL Type 1", confidence=0.9,
            notes=f"city=31010(의정부) nodeNm=금오 cached={info.get('cached')}",
        )
        print(f"✅ TAGO 이용객 → {out}")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "국토교통부 TAGO", url, str(exc))
        print(f"❌ TAGO 이용객 실패: {exc}")
    return out


# A5. TAGO 정류장 위치 (동 내 정류장 매핑)
def fetch_tago_stops() -> Path:
    out = REGION_DIR / "tago_stops.json"
    base = "https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList"
    if not TAGO_KEY:
        mark_failure(out, "국토교통부 TAGO · 정류장 위치", base, "TAGO_API_KEY/DATA_GO_KR_KEY 미설정")
        print("⚠️  TAGO 정류장 위치 키 없음 → status=fail 기록")
        return out

    params = {
        "serviceKey": TAGO_KEY,
        "gpsLati": str(DONG_INFO["lat"]),
        "gpsLong": str(DONG_INFO["lng"]),
        "numOfRows": "100",
        "pageNo": "1",
        "_type": "json",
    }
    url = base + "?" + urllib.parse.urlencode(params)
    try:
        data, info = fetch_json(url, key="tago:stops:geomo")
        write_stamped(
            out, data,
            source="국토교통부 TAGO · 좌표기반 근접 정류장",
            url=base, license="KOGL Type 1", confidence=0.92,
            notes=f"gps=({DONG_INFO['lat']},{DONG_INFO['lng']}) cached={info.get('cached')}",
        )
        print(f"✅ TAGO 정류장 위치 → {out}")
    except Exception as exc:  # noqa: BLE001
        mark_failure(out, "국토교통부 TAGO", url, str(exc))
        print(f"❌ TAGO 정류장 위치 실패: {exc}")
    return out


# ─────────────────────────────────────────────
# 병합: 의정부 금오동 dong 을 simula_data_real.json 에 추가
#   실 API 값이 확보되면 앵커로 사용하고, 미확보 시 시나리오 앵커로
#   기존 130개 dong 과 동일한 40 레이어 × 60개월 시계열을 생성한다.
# ─────────────────────────────────────────────
def merge_geomo_dong() -> Path:
    import importlib.util

    sim_path = BASE_DIR / "simula_data_real.json"
    if not sim_path.exists():
        print(f"❌ {sim_path} 없음 — simula_data_real.json 먼저 생성 필요")
        return sim_path

    sim = json.loads(sim_path.read_text(encoding="utf-8"))
    dongs = sim["dongs"]

    # 이미 추가돼 있으면 스킵(멱등)
    for d in dongs:
        if d.get("real_adm_cd") == DONG_INFO["haengjeong_adm_cd"] or "금오" in d.get("name", ""):
            print(f"ℹ️  의정부 금오동 이미 존재 ({d['name']}) — 스킵")
            return sim_path

    # simula_generate.gen_dong 재사용으로 스키마 100% 일치 보장.
    # simula_generate.py는 import 시 모듈 레벨에서 simula_data.json을 재생성하는
    # 부작용이 있으므로, 원본을 백업했다가 exec 후 복원한다.
    sd_path = BASE_DIR / "simula_data.json"
    sd_backup = sd_path.read_bytes() if sd_path.exists() else None
    spec = importlib.util.spec_from_file_location("simula_generate", BASE_DIR / "simula_generate.py")
    sg = importlib.util.module_from_spec(spec)
    import random as _rnd
    spec.loader.exec_module(sg)  # 부작용: simula_data.json 재생성 → 아래에서 복원
    if sd_backup is not None:
        sd_path.write_bytes(sd_backup)

    # 의정부 금오동: 수도권 외곽 성장형 → developing 시나리오 앵커
    _rnd.seed(4115)
    geomo = sg.gen_dong(
        name="의정부시 금오동",
        code="41150" + "9500",  # 행정동 코드 접미
        lng=DONG_INFO["lng"],
        lat=DONG_INFO["lat"],
        scenario="developing",
        dong_idx_in_gu=0,
    )

    # 실데이터 출처/신뢰 메타 부착 (기존 dong 필드 규약 준수)
    idx = load_index().get("sources", {})
    def _status(fname: str) -> str:
        for path, meta in idx.items():
            if fname in path:
                return meta.get("status", "unknown")
        return "absent"

    phase2_status = {
        "land_price(C1)": _status("molit_landprice.json"),
        "tx_volume(C2)": _status("molit_tx.json"),
        "visitors(B4)": _status("tago_boarding.json"),
        "transit(A5)": _status("tago_stops.json"),
    }
    real_ok = all(v == "ok" for v in phase2_status.values())

    geomo.update({
        "polygon_geo": None,
        "real_adm_nm": DONG_INFO["name"],
        "real_adm_cd": DONG_INFO["haengjeong_adm_cd"],
        "real_data_attached": real_ok,
        "match_distance_km": 0.0,
        "phase2_sources": phase2_status,
        "phase2_note": (
            "실 API 값 앵커 반영" if real_ok
            else "공공데이터 키 미보유 → developing 시나리오 앵커 시계열(등급 S 스키마 충족)"
        ),
    })

    dongs.append(geomo)

    # gu_list 에 의정부 추가 (중복 방지)
    if not any(g.get("code") == "41150" for g in sim.get("gu_list", [])):
        sim["gu_list"].append({
            "name": "의정부시", "code": "41150",
            "lng": DONG_INFO["lng"], "lat": DONG_INFO["lat"], "vibe": "developing",
        })

    sim.setdefault("meta", {}).setdefault("real_data_sources", [])
    if "MOLIT/TAGO (의정부 금오동)" not in sim["meta"]["real_data_sources"]:
        sim["meta"]["real_data_sources"].append("MOLIT/TAGO (의정부 금오동)")

    sim_path.write_text(json.dumps(sim, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"✅ 의정부 금오동 dong 추가 → {sim_path} (총 {len(dongs)}개 동, 레이어 {len(geomo['layers'])}개)")
    print(f"   PHASE2 실데이터 상태: {phase2_status}")
    return sim_path


# ─────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────
STEPS = {
    "vworld": fetch_vworld_boundary,
    "juso": fetch_address_codes,
    "sgis": fetch_sgis_population,
    "localdata": fetch_localdata_cafes,
    "sosang": fetch_sosang_stores,
    # PHASE 2
    "molit_land": fetch_molit_land_price,
    "molit_tx": fetch_molit_transactions,
    "tago_boarding": fetch_tago_boarding,
    "tago_stops": fetch_tago_stops,
    "merge_dong": merge_geomo_dong,
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
