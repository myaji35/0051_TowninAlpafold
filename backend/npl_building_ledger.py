"""backend/npl_building_ledger.py
NPL 건축물대장 보정 (V2) — 연식·구조·위반건축물 계수 산출 + 건축HUB API 연동.
참조: docs/npl-professional-valuation.md §2.2

⚠️  T2 주의: 건축HUB 공공 API는 data.go.kr 인증키(DATA_GO_KR_KEY) 필요.
    키 없으면 factor=1.0, confidence_delta=0, status="not_linked" 반환 — 기존값 유지.
    키 주입 후 실API 호출 가능. 가짜 실데이터 반환 절대 금지.

JS 동기화: utils/npl-building.js (동일 로직 — drift 금지).
"""
from __future__ import annotations

import os
import urllib.parse
import urllib.request
import json
from datetime import date

# ── 보정 상수 (docs/npl-professional-valuation.md §2.2와 동일) ─────────────────
# 위반건축물: NPL 핵심 리스크 — 이행강제금·철거 위험
VIOLATION_FACTOR = 0.70          # ×0.7 → confidence 추가 차감
VIOLATION_CONFIDENCE_DELTA = -0.20

AGE_NEW_MAX = 5                  # 신축: 준공 후 5년 이하
AGE_OLD_MIN = 30                 # 노후: 준공 후 30년 이상
AGE_NEW_FACTOR = 1.05
AGE_OLD_FACTOR = 0.85
AGE_NORMAL_FACTOR = 1.00

STRUCT_RC_FACTOR = 1.00          # 철근콘크리트 / SRC
STRUCT_MASONRY_FACTOR = 0.90     # 조적 / 목조 / 기타

# 건축HUB API 엔드포인트 (data.go.kr)
_BUILDING_HUB_URL = (
    "http://apis.data.go.kr/1613000/BldRgstHubService"
    "/getBrBasisOulnInfo"
)


# ── 내부 헬퍼 ──────────────────────────────────────────────────────────────────

def _building_age(approved_year: int | None) -> int:
    """준공연도 → 건축 연령(년). 미상이면 -1."""
    if not approved_year:
        return -1
    current_year = date.today().year
    return max(0, current_year - int(approved_year))


def _age_factor(age: int) -> float:
    if age < 0:
        return AGE_NORMAL_FACTOR
    if age <= AGE_NEW_MAX:
        return AGE_NEW_FACTOR
    if age >= AGE_OLD_MIN:
        return AGE_OLD_FACTOR
    return AGE_NORMAL_FACTOR


def _struct_factor(struct_code: str | None) -> float:
    """구조 코드 → 계수. RC/SRC=1.0, 그 외(조적·목조)=0.9."""
    if not struct_code:
        return STRUCT_RC_FACTOR  # 미상은 보수적 중립
    s = struct_code.strip().upper()
    # 건축HUB 구조코드: '11'=철근콘크리트, '21'=SRC, '30~'=조적, '40'=목조, 기타
    if s in {"11", "21", "RC", "SRC", "철근콘크리트", "철골철근콘크리트"}:
        return STRUCT_RC_FACTOR
    return STRUCT_MASONRY_FACTOR


# ── 공개 API ───────────────────────────────────────────────────────────────────

def building_adjustment(building_info: dict | None) -> dict:
    """건축물 정보 → 낙찰가율 보정 결과.

    입력 building_info 키 (모두 선택):
        approved_year   (int)   준공연도. 예: 1992
        struct_code     (str)   구조코드. 예: "11"(RC)
        is_violation    (bool)  위반건축물 등재 여부

    반환:
        factor              float   낙찰가율 보정 계수 (곱셈)
        confidence_delta    float   confidence 가산/차감 (+0.15 or 0, -0.20)
        flags               list    경고 메시지
        status              str     "linked" | "not_linked"

    building_info가 None(키 미연동)이면 중립값 반환 (기존 동작 유지).
    """
    if building_info is None:
        return {
            "factor": 1.0,
            "confidence_delta": 0.0,
            "flags": [],
            "status": "not_linked",
            "note": "건축물대장 미연동 (DATA_GO_KR_KEY 필요 — T2)",
        }

    flags = []
    factor = 1.0

    # 1) 연식 보정
    age = _building_age(building_info.get("approved_year"))
    age_f = _age_factor(age)
    factor *= age_f
    if age >= 0:
        if age_f == AGE_NEW_FACTOR:
            flags.append(f"신축(준공 후 {age}년) — 연식보정 ×{AGE_NEW_FACTOR}")
        elif age_f == AGE_OLD_FACTOR:
            flags.append(f"노후(준공 후 {age}년) — 연식보정 ×{AGE_OLD_FACTOR}")

    # 2) 구조 보정
    struct_f = _struct_factor(building_info.get("struct_code"))
    factor *= struct_f
    if struct_f == STRUCT_MASONRY_FACTOR:
        flags.append(f"비RC 구조({building_info.get('struct_code', '미상')}) — 구조보정 ×{STRUCT_MASONRY_FACTOR}")

    # 3) 위반건축물 — NPL 핵심 리스크
    is_violation = bool(building_info.get("is_violation", False))
    if is_violation:
        factor *= VIOLATION_FACTOR
        flags.append("⚠️ 위반건축물 등재 — ×0.70 (이행강제금·철거 위험)")

    confidence_delta = 0.15 + (VIOLATION_CONFIDENCE_DELTA if is_violation else 0.0)

    return {
        "factor": round(factor, 4),
        "confidence_delta": round(confidence_delta, 4),
        "flags": flags,
        "status": "linked",
        "age_years": age if age >= 0 else None,
        "is_violation": is_violation,
    }


def fetch_building_ledger(address_or_pnu: str, api_key: str | None = None) -> dict | None:
    """건축HUB 공공 API 호출 → 건축물 기본 정보 반환.

    ⚠️  키 없으면 None 반환 + "not_linked" — 실API 호출 안 함.
    키 있을 때만 HTTP 요청. 응답 파싱 후 building_adjustment 입력 형식으로 변환.

    api_key 우선순위: 인자 > 환경변수 DATA_GO_KR_KEY
    반환: building_info dict(approved_year, struct_code, is_violation) 또는 None
    """
    key = api_key or os.environ.get("DATA_GO_KR_KEY")
    if not key:
        return None  # 키 없음 — 호출 안 함

    # 실제 API 호출 (키 있을 때만)
    params = urllib.parse.urlencode({
        "serviceKey": key,
        "platPlc": address_or_pnu,
        "numOfRows": 1,
        "pageNo": 1,
        "_type": "json",
    })
    url = f"{_BUILDING_HUB_URL}?{params}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        items = (
            data.get("response", {})
                .get("body", {})
                .get("items", {})
                .get("item", [])
        )
        if not items:
            return None
        item = items[0] if isinstance(items, list) else items

        # 준공연도: 사용승인일(useAprDay) YYYYMMDD 앞 4자리
        use_apr = str(item.get("useAprDay", "") or "")
        approved_year = int(use_apr[:4]) if len(use_apr) >= 4 and use_apr[:4].isdigit() else None

        # 구조코드: mainStructCd
        struct_code = str(item.get("mainStructCd", "") or "")

        # 위반건축물: vltnBldYn ('Y'/'N')
        is_violation = (item.get("vltnBldYn", "N") or "N").upper() == "Y"

        return {
            "approved_year": approved_year,
            "struct_code": struct_code,
            "is_violation": is_violation,
            "_raw_address": address_or_pnu,
        }
    except Exception as exc:  # noqa: BLE001
        # 네트워크/파싱 오류 — None 반환, 호출자가 폴백
        return None  # not_linked 처리


# ── compute_confidence (V2+V3 공유 공식) ───────────────────────────────────────
# 이 함수는 npl_scorer.py가 import해서 쓴다.
# JS 동기화: utils/npl-building.js의 computeConfidence (동일 공식 — drift 금지).

def compute_confidence(
    base: float = 0.60,
    has_building: bool = False,
    has_realprice3: bool = False,
    has_registry: bool = False,
    has_defect: bool = False,
) -> float:
    """데이터 충족도 기반 동적 confidence 산출 (docs §4).

    base            float   기본 신뢰도 (기본 0.60 — 하위호환)
    has_building    bool    건축물대장 연동됨 → +0.15
    has_realprice3  bool    실거래가 3건 이상 → +0.15
    has_registry    bool    등기부 확인됨 → +0.10
    has_defect      bool    위반건축물 / 권리하자 → −0.20

    반환: 0.0~1.0 클램프.
    예: base0.6 + building + realprice3 = 0.90 (신뢰도 90%)
    """
    c = base
    if has_building:
        c += 0.15
    if has_realprice3:
        c += 0.15
    if has_registry:
        c += 0.10
    if has_defect:
        c -= 0.20
    return round(max(0.0, min(1.0, c)), 4)
