"""5개 ETL 모두 dry_run 실행 → manifest 캐스케이드 통합 검증.

- 5/5 데이터셋이 의정부 금오동에 등록되는지
- 시군구/광역시 캐스케이드 작동하는지
- 갤러리 가용성 레이어가 manifest 변경을 반영하는지
"""

import importlib
import json
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

ETL_KEYS = [
    "kosis_living_pop",
    "localdata_biz",
    "nts_bizreg",
    "molit_landprice",
    "vworld_geojson",
]
WEDGE_ADM_CD = "4115011000"


class TestFull5ETLCascade(unittest.TestCase):

    def test_all_5_etls_run_success(self):
        """5개 ETL 모두 dry_run으로 실행 시 success."""
        for key in ETL_KEYS:
            mod = importlib.import_module(f"etl.{key}")
            result = mod.run(dry_run=True)
            self.assertEqual(result.get("status"), "success",
                             f"{key} 실패: {result}")

    def test_manifest_5_datasets_registered(self):
        """5개 ETL 실행 후 manifest에 5개 데이터셋 모두 등록."""
        from utils.manifest_repo import JSONManifestRepo
        repo = JSONManifestRepo()
        for key in ETL_KEYS:
            mod = importlib.import_module(f"etl.{key}")
            mod.run(dry_run=True)

        m = json.loads((PROJECT_ROOT / "data_raw/_progress/manifest.json").read_text())
        dong = None
        for r in m.get("regions", []):
            for sg in r.get("sigungu", []):
                for d in sg.get("dongs", []):
                    if d.get("adm_cd") == WEDGE_ADM_CD:
                        dong = d
        self.assertIsNotNone(dong, "의정부 금오동 manifest 없음")
        self.assertEqual(len(dong.get("datasets", {})), 5,
                         f"5개 데이터셋이 모두 등록되지 않음: {list(dong.get('datasets', {}).keys())}")

    def test_cascade_to_sido(self):
        """동 → 시군구 → 광역시 캐스케이드 작동."""
        m = json.loads((PROJECT_ROOT / "data_raw/_progress/manifest.json").read_text())
        for r in m.get("regions", []):
            if r["name"] == "경기도":
                self.assertGreater(r["completion_pct"], 0,
                                   f"경기도 completion 0%: {r}")
                for sg in r.get("sigungu", []):
                    if sg["name"] == "의정부시":
                        self.assertGreater(sg["completion_pct"], 0)

    def test_gallery_availability_reflects_state(self):
        """갤러리 가용성 레이어가 5개 데이터셋 등록 상태를 반영."""
        from utils.gallery_availability import compute_availability
        manifest = json.loads((PROJECT_ROOT / "data_raw/_progress/manifest.json").read_text())
        catalog = json.loads((PROJECT_ROOT / "data_raw/_master/gallery_cards_catalog.json").read_text())
        result = compute_availability(manifest, catalog)
        # active+dim+demo_only 합 = 12
        total = sum(1 for _ in result.values())
        self.assertEqual(total, 12, f"카드 12개 아님: {total}")
        # 5개 데이터셋이 모두 있으니 적어도 일부 카드는 dim 이상이어야 함
        non_demo = [c for c in result.values() if c["status"] != "demo_only"]
        self.assertGreater(len(non_demo), 0, "5개 데이터셋 등록됐는데 모두 demo_only")


if __name__ == "__main__":
    unittest.main(verbosity=2)
