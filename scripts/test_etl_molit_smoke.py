"""smoke test: MOLIT 공시지가 ETL wedge (의정부 금오동 × 202412)."""

import importlib
import json
import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

OUTPUT_FILE = PROJECT_ROOT / "data_raw" / "molit_landprice" / "4115011000_202412.json"


class TestMolitLandpriceETL(unittest.TestCase):

    def test_module_loads(self):
        mod = importlib.import_module("etl.molit_landprice")
        self.assertTrue(hasattr(mod, "run"))
        self.assertTrue(hasattr(mod, "DATASET_KEY"))
        self.assertTrue(hasattr(mod, "WEDGE_ADM_CD"))

    def test_dry_run_success(self):
        from etl.molit_landprice import run
        result = run(dry_run=True)
        self.assertEqual(result.get("status"), "success", f"{result}")
        self.assertIn("output", result)
        self.assertTrue(Path(result["output"]).exists())

    def test_no_api_key_blocked(self):
        env_backup = os.environ.pop("MOLIT_API_KEY", None)
        try:
            from etl import molit_landprice
            result = molit_landprice.run(dry_run=False)
            self.assertEqual(result.get("status"), "blocked", f"{result}")
        finally:
            if env_backup is not None:
                os.environ["MOLIT_API_KEY"] = env_backup

    def test_output_format(self):
        from etl.molit_landprice import run
        run(dry_run=True)
        self.assertTrue(OUTPUT_FILE.exists())
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        for field in ("dataset_key", "adm_cd", "period", "marker", "records"):
            self.assertIn(field, data)
        self.assertEqual(data["dataset_key"], "molit_landprice")
        self.assertEqual(data["adm_cd"], "4115011000")
        self.assertEqual(data["period"], "202412")
        self.assertEqual(data["marker"], "synthetic")
        self.assertEqual(len(data["records"]), 5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
