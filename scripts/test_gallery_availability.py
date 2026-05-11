"""
test_gallery_availability.py
gallery_availability.py 유닛 테스트 — stdlib only (no pytest).
"""

import json
import pathlib
import sys

# utils 모듈 경로 등록
_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(_ROOT))

from utils.gallery_availability import (
    compute_availability,
    load_catalog,
    load_manifest,
)

CATALOG_PATH = _ROOT / "data_raw" / "_master" / "gallery_cards_catalog.json"
MANIFEST_PATH = _ROOT / "data_raw" / "_progress" / "manifest.json"

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

_results: list = []


def _run(name: str, fn) -> bool:
    try:
        fn()
        _results.append((name, True, ""))
        print(f"  {PASS}  {name}")
        return True
    except AssertionError as e:
        _results.append((name, False, str(e)))
        print(f"  {FAIL}  {name}: {e}")
        return False
    except Exception as e:
        _results.append((name, False, f"EXCEPTION: {e}"))
        print(f"  {FAIL}  {name}: EXCEPTION: {e}")
        return False


def test_catalog_loads():
    catalog = load_catalog(CATALOG_PATH)
    assert isinstance(catalog, dict), "catalog는 dict여야 함"
    assert "cards" in catalog, "'cards' 키 없음"
    assert "version" in catalog, "'version' 키 없음"


def test_catalog_count_12():
    catalog = load_catalog(CATALOG_PATH)
    count = len(catalog["cards"])
    assert count == 12, f"카드 수={count}, 기대=12"


def test_compute_with_empty_manifest():
    catalog = load_catalog(CATALOG_PATH)
    empty_manifest = {"regions": [], "gallery_cards_availability": []}
    result = compute_availability(empty_manifest, catalog)

    assert len(result) == 12, f"결과 카드 수={len(result)}, 기대=12"
    for cid, val in result.items():
        assert val["status"] == "demo_only", (
            f"{cid} status={val['status']}, 빈 manifest에서는 demo_only여야 함"
        )
        assert len(val["missing_datasets"]) > 0, (
            f"{cid} missing_datasets가 비어있음"
        )


def test_compute_with_partial():
    catalog = load_catalog(CATALOG_PATH)
    partial_manifest = {
        "regions": [{
            "name": "서울특별시", "code": "11",
            "sigungu": [{
                "name": "성동구", "code": "1120",
                "dongs": [{
                    "adm_cd": "1120051000",
                    "name": "성수1가1동",
                    "datasets": {
                        "kosis_living_pop": {"months_covered": 12, "marker": "real"}
                    },
                }],
            }],
        }],
        "gallery_cards_availability": [],
    }
    result = compute_availability(partial_manifest, catalog)

    dim_cards = [cid for cid, v in result.items() if v["status"] == "dim"]
    demo_cards = [cid for cid, v in result.items() if v["status"] == "demo_only"]

    assert len(dim_cards) >= 1, f"kosis만 있을 때 dim 카드 없음. demo={demo_cards}"
    assert len(demo_cards) >= 1, "kosis만 있을 때 demo_only 카드 없음"

    # kosis_living_pop을 required로 갖는 카드만 검증
    catalog = load_catalog(CATALOG_PATH)
    cards_with_kosis = {
        c["id"] for c in catalog["cards"]
        if "kosis_living_pop" in c["required_datasets"]
    }
    for cid, v in result.items():
        if cid not in cards_with_kosis:
            continue  # kosis를 요구하지 않는 카드는 검증 불필요
        if "kosis_living_pop" not in v["missing_datasets"]:
            assert "kosis_living_pop" in v["present_datasets"], (
                f"{cid}: kosis가 missing에도 present에도 없음"
            )


def test_compute_full_active():
    catalog = load_catalog(CATALOG_PATH)
    all_ds = [
        "kosis_living_pop", "localdata_biz", "nts_bizreg",
        "molit_landprice", "vworld_geojson",
    ]

    def _make_dong(name):
        return {
            "adm_cd": "0000000000",
            "name": name,
            "datasets": {ds: {"months_covered": 24, "marker": "real"} for ds in all_ds},
        }

    full_manifest = {
        "regions": [{
            "name": "테스트시", "code": "99",
            "sigungu": [{
                "name": "테스트구", "code": "9900",
                "dongs": [_make_dong(f"테스트동{i}") for i in range(1, 6)],
            }],
        }],
        "gallery_cards_availability": [],
    }

    result = compute_availability(full_manifest, catalog)
    non_active = [(cid, v["status"]) for cid, v in result.items() if v["status"] != "active"]
    assert len(non_active) == 0, f"모든 데이터셋 있는데 active 아닌 카드: {non_active}"


def test_missing_datasets_listed():
    catalog = load_catalog(CATALOG_PATH)
    partial_manifest = {
        "regions": [{
            "name": "서울특별시", "code": "11",
            "sigungu": [{
                "name": "성동구", "code": "1120",
                "dongs": [{
                    "adm_cd": "1120051000",
                    "name": "성수1가1동",
                    "datasets": {
                        "kosis_living_pop": {"months_covered": 12, "marker": "real"},
                        "vworld_geojson":   {"months_covered": 1,  "marker": "real"},
                    },
                }],
            }],
        }],
        "gallery_cards_availability": [],
    }

    result = compute_availability(partial_manifest, catalog)

    # gangnam_compare required=[kosis, localdata, molit, vworld]
    # kosis + vworld 보유 → missing=[localdata_biz, molit_landprice]
    gangnam = result["gangnam_compare"]
    expected_missing = {"localdata_biz", "molit_landprice"}
    actual_missing = set(gangnam["missing_datasets"])
    assert actual_missing == expected_missing, (
        f"gangnam_compare missing={actual_missing}, 기대={expected_missing}"
    )

    # closure_alert required=[localdata_biz] → missing=[localdata_biz]
    closure = result["closure_alert"]
    assert "localdata_biz" in closure["missing_datasets"], (
        "closure_alert: localdata_biz가 missing에 없음"
    )

    # youth_inflow required=[kosis_living_pop] → missing=[]
    youth = result["youth_inflow"]
    assert len(youth["missing_datasets"]) == 0, (
        f"youth_inflow: kosis 있는데 missing={youth['missing_datasets']}"
    )


def main():
    print("\n=== gallery_availability 테스트 ===\n")
    _run("test_catalog_loads", test_catalog_loads)
    _run("test_catalog_count_12", test_catalog_count_12)
    _run("test_compute_with_empty_manifest", test_compute_with_empty_manifest)
    _run("test_compute_with_partial", test_compute_with_partial)
    _run("test_compute_full_active", test_compute_full_active)
    _run("test_missing_datasets_listed", test_missing_datasets_listed)

    passed = sum(1 for _, ok, _ in _results if ok)
    total = len(_results)
    print(f"\n결과: {passed}/{total} 통과\n")

    if passed < total:
        sys.exit(1)


if __name__ == "__main__":
    main()
