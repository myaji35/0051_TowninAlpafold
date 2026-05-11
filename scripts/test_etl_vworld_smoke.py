"""smoke test: VWorld 행정경계 GeoJSON ETL wedge (의정부 금오동, once)."""

import importlib
import json
import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

OUTPUT_FILE = PROJECT_ROOT / "data_raw" / "vworld_geojson" / "4115011000.geojson"


class TestVWorldGeojsonETL(unittest.TestCase):

    def test_module_loads(self):
        mod = importlib.import_module("etl.vworld_geojson")
        self.assertTrue(hasattr(mod, "run"))
        self.assertTrue(hasattr(mod, "DATASET_KEY"))
        self.assertTrue(hasattr(mod, "WEDGE_ADM_CD"))

    def test_dry_run_success(self):
        from etl.vworld_geojson import run
        result = run(dry_run=True)
        self.assertEqual(result.get("status"), "success", f"{result}")
        self.assertTrue(Path(result["output"]).exists())
        self.assertEqual(result.get("geometry_type"), "Polygon")

    def test_no_api_key_blocked(self):
        env_backup = os.environ.pop("VWORLD_API_KEY", None)
        try:
            from etl import vworld_geojson
            result = vworld_geojson.run(dry_run=False)
            self.assertEqual(result.get("status"), "blocked", f"{result}")
        finally:
            if env_backup is not None:
                os.environ["VWORLD_API_KEY"] = env_backup

    def test_output_format(self):
        from etl.vworld_geojson import run
        run(dry_run=True)
        self.assertTrue(OUTPUT_FILE.exists())
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        self.assertEqual(data.get("type"), "FeatureCollection")
        self.assertIn("features", data)
        self.assertGreater(len(data["features"]), 0)
        feature = data["features"][0]
        self.assertEqual(feature.get("geometry", {}).get("type"), "Polygon")
        self.assertIn("coordinates", feature.get("geometry", {}))


if __name__ == "__main__":
    unittest.main(verbosity=2)
