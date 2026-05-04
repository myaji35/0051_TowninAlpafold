"""smoke test: KOSIS 생활인구 ETL wedge (의정부 금오동 × 2024-12).

stdlib only — 외부 의존성 없음.
실행: python scripts/test_etl_kosis_smoke.py
"""

import importlib
import json
import os
import sys
import unittest
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

OUTPUT_FILE = PROJECT_ROOT / "data_raw" / "kosis_living_pop" / "4115011000_202412.json"


class TestKosisLivingPopETL(unittest.TestCase):

    def test_module_loads(self):
        """etl/kosis_living_pop 모듈이 임포트 오류 없이 로드되어야 한다."""
        mod = importlib.import_module("etl.kosis_living_pop")
        self.assertTrue(hasattr(mod, "run"), "run() 함수 없음")
        self.assertTrue(hasattr(mod, "DATASET_KEY"), "DATASET_KEY 상수 없음")
        self.assertTrue(hasattr(mod, "WEDGE_ADM_CD"), "WEDGE_ADM_CD 상수 없음")

    def test_dry_run_success(self):
        """dry_run=True 실행 시 status=success 이고 출력 파일이 생성되어야 한다."""
        from etl.kosis_living_pop import run
        result = run(dry_run=True)
        self.assertEqual(result.get("status"), "success",
                         f"status != success: {result}")
        self.assertIn("output", result, "output 경로가 결과에 없음")
        out_path = Path(result["output"])
        self.assertTrue(out_path.exists(), f"출력 파일 미생성: {out_path}")

    def test_no_api_key_blocked(self):
        """KOSIS_API_KEY 미설정 + dry_run=False → status=blocked 이어야 한다."""
        env_backup = os.environ.pop("KOSIS_API_KEY", None)
        try:
            from etl import kosis_living_pop
            result = kosis_living_pop.run(dry_run=False)
            self.assertEqual(result.get("status"), "blocked",
                             f"API 키 없는데 blocked 아님: {result}")
        finally:
            if env_backup is not None:
                os.environ["KOSIS_API_KEY"] = env_backup

    def test_output_format(self):
        """저장된 JSON에 필수 필드 4개가 모두 존재해야 한다."""
        # dry_run으로 파일 먼저 생성
        from etl.kosis_living_pop import run
        run(dry_run=True)

        self.assertTrue(OUTPUT_FILE.exists(), f"출력 파일 없음: {OUTPUT_FILE}")
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        for field in ("dataset_key", "adm_cd", "period", "marker"):
            self.assertIn(field, data, f"필수 필드 누락: {field}")

        self.assertEqual(data["dataset_key"], "kosis_living_pop")
        self.assertEqual(data["adm_cd"], "4115011000")
        self.assertEqual(data["period"], "202412")
        self.assertEqual(data["marker"], "synthetic")  # dry_run → synthetic


if __name__ == "__main__":
    unittest.main(verbosity=2)
