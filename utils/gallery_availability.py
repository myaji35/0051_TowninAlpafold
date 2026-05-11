"""
gallery_availability.py
갤러리 12카드별 가용성(active / dim / demo_only)을 manifest 상태로부터 산출.

Status 정의:
  active    — required_datasets 전부 해당 동에 있고 marker=real
  dim       — required_datasets 일부 존재 (marker 무관)
  demo_only — required_datasets 전혀 없음 (현재 대부분 해당)
"""

from __future__ import annotations
import json
import pathlib
from typing import Any

# 기본 경로 (프로젝트 루트 기준)
_PROJECT_ROOT = pathlib.Path(__file__).parent.parent
_CATALOG_PATH = _PROJECT_ROOT / "data_raw" / "_master" / "gallery_cards_catalog.json"
_MANIFEST_PATH = _PROJECT_ROOT / "data_raw" / "_progress" / "manifest.json"


# ─────────────────────────────────────────────────────────
# 카탈로그 로드
# ─────────────────────────────────────────────────────────

def load_catalog(catalog_path: str | pathlib.Path | None = None) -> dict:
    """gallery_cards_catalog.json을 로드하여 반환."""
    path = pathlib.Path(catalog_path) if catalog_path else _CATALOG_PATH
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_manifest(manifest_path: str | pathlib.Path | None = None) -> dict:
    """manifest.json을 로드하여 반환."""
    path = pathlib.Path(manifest_path) if manifest_path else _MANIFEST_PATH
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ─────────────────────────────────────────────────────────
# manifest → 동별 보유 데이터셋 인덱스 구축
# ─────────────────────────────────────────────────────────

def _build_dong_index(manifest: dict) -> dict[str, dict[str, dict]]:
    """
    manifest 전체를 순회하여 dong 이름 → {dataset_key: {months_covered, marker}} 반환.
    marker 기준: manifest의 marker 필드 (real / synthetic / demo).
    """
    index: dict[str, dict[str, dict]] = {}
    for region in manifest.get("regions", []):
        for sigungu in region.get("sigungu", []):
            for dong in sigungu.get("dongs", []):
                dong_name = dong["name"]
                datasets: dict[str, dict] = {}
                for ds_key, ds_val in dong.get("datasets", {}).items():
                    datasets[ds_key] = {
                        "months_covered": ds_val.get("months_covered", 0),
                        "marker": ds_val.get("marker", "unknown"),
                    }
                index[dong_name] = datasets
    return index


# ─────────────────────────────────────────────────────────
# 핵심 함수: compute_availability
# ─────────────────────────────────────────────────────────

def compute_availability(
    manifest: dict,
    catalog: dict,
    save_to_manifest: bool = False,
    manifest_path: str | pathlib.Path | None = None,
) -> dict[str, dict[str, Any]]:
    """
    각 갤러리 카드에 대해 status + missing_datasets를 산출한다.

    반환값 형태:
    {
      "sungsu_rise": {
        "id": "sungsu_rise",
        "title": "성수동 부상 스토리",
        "status": "demo_only",          # active | dim | demo_only
        "missing_datasets": ["kosis_living_pop", "localdata_biz"],
        "present_datasets": [],
        "real_datasets": [],            # marker=real인 것만
        "dong_count": 0                 # 해당 required를 모두 가진 동 수
      },
      ...
    }

    Parameters
    ----------
    manifest       : manifest.json dict
    catalog        : gallery_cards_catalog.json dict
    save_to_manifest : True면 manifest["gallery_cards_availability"] 갱신 후 파일 저장
    manifest_path  : save_to_manifest=True일 때 저장 경로 (None → 기본 경로)
    """
    dong_index = _build_dong_index(manifest)
    results: dict[str, dict[str, Any]] = {}

    for card in catalog["cards"]:
        cid = card["id"]
        required: list[str] = card["required_datasets"]
        min_dongs: int = card.get("min_dongs", 1)
        min_months: int = card.get("min_months", 1)

        # 동별로 required 데이터셋 보유 여부 확인
        dongs_fully_covered = 0   # required 전부 있고 min_months 충족한 동 수
        dongs_fully_real = 0      # 위 조건 + 모든 required가 marker=real
        all_present: set[str] = set()
        all_real: set[str] = set()
        all_missing: set[str] = set(required)

        for dong_name, ds_map in dong_index.items():
            present_here = [ds for ds in required if ds in ds_map]
            months_ok = all(
                ds_map[ds]["months_covered"] >= min_months
                for ds in present_here
            ) if present_here else False

            all_present.update(present_here)

            real_here = [
                ds for ds in present_here
                if ds_map[ds]["marker"] == "real"
            ]
            all_real.update(real_here)

            # fully covered: 이 동이 required 전부 + months 충족
            if set(present_here) >= set(required) and months_ok:
                dongs_fully_covered += 1
                if set(real_here) >= set(required):
                    dongs_fully_real += 1

        missing = [ds for ds in required if ds not in all_present]
        all_missing = set(missing)

        # status 판정
        if dongs_fully_real >= min_dongs:
            status = "active"
        elif len(all_present) > 0:
            status = "dim"
        else:
            status = "demo_only"

        results[cid] = {
            "id": cid,
            "title": card["title"],
            "category": card["category"],
            "status": status,
            "missing_datasets": sorted(all_missing),
            "present_datasets": sorted(all_present),
            "real_datasets": sorted(all_real),
            "dong_count": dongs_fully_covered,
            "min_dongs_required": min_dongs,
        }

    if save_to_manifest:
        manifest["gallery_cards_availability"] = [
            {
                "id": v["id"],
                "status": v["status"],
                "missing_datasets": v["missing_datasets"],
            }
            for v in results.values()
        ]
        save_path = pathlib.Path(manifest_path) if manifest_path else _MANIFEST_PATH
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    return results


# ─────────────────────────────────────────────────────────
# 요약 출력 헬퍼
# ─────────────────────────────────────────────────────────

def print_summary(availability: dict[str, dict[str, Any]]) -> None:
    """가용성 결과를 터미널에 표 형태로 출력."""
    counts = {"active": 0, "dim": 0, "demo_only": 0}
    print(f"\n{'ID':<20} {'제목':<22} {'상태':<12} {'부족 데이터셋'}")
    print("-" * 80)
    for v in availability.values():
        counts[v["status"]] += 1
        missing_str = ", ".join(v["missing_datasets"]) if v["missing_datasets"] else "-"
        print(f"{v['id']:<20} {v['title']:<22} {v['status']:<12} {missing_str}")
    print("-" * 80)
    print(f"active={counts['active']}  dim={counts['dim']}  demo_only={counts['demo_only']}\n")


# ─────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    catalog = load_catalog()
    manifest = load_manifest()
    availability = compute_availability(manifest, catalog, save_to_manifest=True)
    print_summary(availability)
