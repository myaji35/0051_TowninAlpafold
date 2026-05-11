"""update_dataset_schedule hook 단위 테스트.

ETL 직접 호출 시 datasets.json의 schedule.last_run_at + next_run_at 즉시 갱신 확인.
"""

import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

REGISTRY_PATH = PROJECT_ROOT / "data_raw/_registry/datasets.json"


class TestDatasetScheduleHook(unittest.TestCase):

    def setUp(self):
        self.backup = REGISTRY_PATH.read_bytes()

    def tearDown(self):
        REGISTRY_PATH.write_bytes(self.backup)

    def test_success_updates_last_run_at(self):
        from utils.etl_base import update_dataset_schedule
        ts = "2026-05-05T10:00:00+00:00"
        warn = update_dataset_schedule("kosis_living_pop", "success", ts)
        self.assertIsNone(warn, f"warning: {warn}")
        ds = json.loads(REGISTRY_PATH.read_text())
        for d in ds["datasets"]:
            if d["key"] == "kosis_living_pop":
                self.assertEqual(d["schedule"]["last_run_at"], ts)
                self.assertEqual(d["schedule"]["last_run_status"], "success")
                self.assertEqual(d["schedule"]["consecutive_failures"], 0)
                self.assertIn("next_run_at", d["schedule"])
                return
        self.fail("kosis_living_pop not found")

    def test_failure_increments_consecutive_failures(self):
        from utils.etl_base import update_dataset_schedule
        ts = "2026-05-05T10:00:00+00:00"
        update_dataset_schedule("kosis_living_pop", "failure", ts)
        update_dataset_schedule("kosis_living_pop", "failure", ts)
        ds = json.loads(REGISTRY_PATH.read_text())
        for d in ds["datasets"]:
            if d["key"] == "kosis_living_pop":
                self.assertEqual(d["schedule"]["consecutive_failures"], 2)
                self.assertEqual(d["schedule"]["last_run_status"], "failure")
                return

    def test_once_does_not_set_next_run_at(self):
        from utils.etl_base import update_dataset_schedule
        ts = "2026-05-05T10:00:00+00:00"
        # vworld_geojson은 frequency: once
        # 기존 next_run_at을 None으로 만들고 호출 후에도 그대로인지 확인
        ds = json.loads(REGISTRY_PATH.read_text())
        for d in ds["datasets"]:
            if d["key"] == "vworld_geojson":
                d["schedule"]["next_run_at"] = None
                d["schedule"]["frequency"] = "once"
        REGISTRY_PATH.write_text(json.dumps(ds, ensure_ascii=False, indent=2))

        update_dataset_schedule("vworld_geojson", "success", ts)
        ds = json.loads(REGISTRY_PATH.read_text())
        for d in ds["datasets"]:
            if d["key"] == "vworld_geojson":
                self.assertIsNone(d["schedule"]["next_run_at"])

    def test_unknown_key_silent_no_op(self):
        from utils.etl_base import update_dataset_schedule
        warn = update_dataset_schedule("nonexistent_key", "success", "2026-05-05T10:00:00+00:00")
        self.assertIsNone(warn)


if __name__ == "__main__":
    unittest.main(verbosity=2)
