"""smoke test: 국세청 사업자등록 ETL wedge (의정부 금오동 × 202412).

stdlib only — 외부 의존성 없음.
실행: python scripts/test_etl_nts_smoke.py
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


class TestNtsBizregETL(unittest.TestCase):

    def test_module_loads(self):
        """etl/nts_bizreg 모듈이 임포트 오류 없이 로드되어야 한다."""
        mod = importlib.import_module("etl.nts_bizreg")
        self.assertTrue(hasattr(mod, "run"), "run() 함수 없음")
        self.assertTrue(hasattr(mod, "DATASET_KEY"), "DATASET_KEY 상수 없음")
        self.assertTrue(hasattr(mod, "WEDGE_ADM_CD"), "WEDGE_ADM_CD 상수 없음")

    def test_dry_run_success(self):
        """dry_run=True 실행 시 status=success, 출력 파일 생성, records >= 5 이어야 한다."""
        from etl.nts_bizreg import run
        result = run(dry_run=True)
        self.assertEqual(result.get("status"), "success",
                         f"status != success: {result}")
        self.assertIn("output", result, "output 경로가 결과에 없음")
        out_path = Path(result["output"])
        self.assertTrue(out_path.exists(), f"출력 파일 미생성: {out_path}")
        self.assertGreaterEqual(result.get("records", 0), 5,
                                f"mock 레코드 수 부족: {result.get('records')}")

    def test_no_api_key_blocked(self):
        """NTS_API_KEY 미설정 + dry_run=False → status=blocked 이어야 한다."""
        env_backup = os.environ.pop("NTS_API_KEY", None)
        try:
            from etl import nts_bizreg
            result = nts_bizreg.run(dry_run=False)
            self.assertEqual(result.get("status"), "blocked",
                             f"API 키 없는데 blocked 아님: {result}")
        finally:
            if env_backup is not None:
                os.environ["NTS_API_KEY"] = env_backup

    def test_output_format(self):
        """저장된 JSON에 필수 필드 5개가 모두 존재해야 한다."""
        from etl.nts_bizreg import run, WEDGE_ADM_CD, WEDGE_PERIOD, OUTPUT_DIR
        run(dry_run=True)

        out_path = OUTPUT_DIR / f"{WEDGE_ADM_CD}_{WEDGE_PERIOD}.json"
        self.assertTrue(out_path.exists(), f"출력 파일 없음: {out_path}")
        data = json.loads(out_path.read_text(encoding="utf-8"))
        for field in ("dataset_key", "adm_cd", "period", "marker", "records"):
            self.assertIn(field, data, f"필수 필드 누락: {field}")

        self.assertEqual(data["dataset_key"], "nts_bizreg")
        self.assertEqual(data["adm_cd"], "4115011000")
        self.assertEqual(data["marker"], "synthetic")  # dry_run → synthetic


if __name__ == "__main__":
    unittest.main(verbosity=2)
