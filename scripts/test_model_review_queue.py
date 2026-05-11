"""scripts/test_model_review_queue.py
ModelReviewQueue 단위 smoke test.
"""
import sys
import json
import tempfile
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# tempdir로 격리
_tmp = tempfile.TemporaryDirectory()
os.chdir(_tmp.name)
Path("data_raw/_models").mkdir(parents=True, exist_ok=True)

from utils.model_review_queue import (
    enqueue, find, list_queue, transition, validate,
    validate_weight_sum, validate_data_dependencies, validate_ui_component_files,
    STATUS_ENUM, ALLOWED_TRANSITIONS,
)

results = []


def t1():
    """enqueue → DRAFT 상태."""
    qid = enqueue({"key": "test.model_a", "weights": {"a": 0.6, "b": 0.4}},
                  scaffold_cost_usd=1.5)
    item = find(qid)
    return item and item["status"] == "DRAFT", f"DRAFT status, qid={qid[:20]}..."


def t2():
    """validate weight_sum — 정상 (합=1.0)."""
    ok, msg = validate_weight_sum({"weights": {"a": 0.5, "b": 0.5}})
    return ok, msg


def t3():
    """validate weight_sum — 실패 (합=0.7)."""
    ok, msg = validate_weight_sum({"weights": {"a": 0.5, "b": 0.2}})
    return not ok and "0.7" in msg, msg


def t4():
    """validate data_dependencies — datasets.json 없으면 실패."""
    ok, msg = validate_data_dependencies({"data_dependencies": ["nonexistent_ds"]})
    return not ok and "missing" in msg.lower(), msg


def t5():
    """validate ui_component_files — 파일 없으면 실패."""
    ok, msg = validate_ui_component_files({"ui_component": "components/nonexistent.js",
                                           "scorer": "viz/plugins/nonexistent.js"})
    return not ok and "not found" in msg, msg


def t6():
    """validate(qid) — 자동 전이 (실패 → REJECTED)."""
    qid = enqueue({"key": "test.model_b",
                   "weights": {"x": 0.3},  # sum != 1
                   "data_dependencies": ["unknown"],
                   "ui_component": "components/nope.js",
                   "scorer": "viz/plugins/nope.js"})
    res = validate(qid)
    item = find(qid)
    return (not res["all_pass"]) and item["status"] == "REJECTED", \
        f"all_pass={res['all_pass']}, status={item['status']}"


def t7():
    """transition — DRAFT → REVIEWING → PUBLISHED 정상."""
    qid = enqueue({"key": "test.model_c", "weights": {"a": 1.0}})
    transition(qid, "REVIEWING", by="auto")
    transition(qid, "PUBLISHED", by="user@test", note="approved")
    item = find(qid)
    return item["status"] == "PUBLISHED" and len(item["history"]) >= 3, \
        f"status={item['status']}, history len={len(item['history'])}"


def t8():
    """transition — 잘못된 전이 (PUBLISHED → DRAFT) 거부."""
    qid = enqueue({"key": "test.model_d", "weights": {"a": 1.0}})
    transition(qid, "REVIEWING")
    transition(qid, "PUBLISHED")
    try:
        transition(qid, "DRAFT")
        return False, "PUBLISHED → DRAFT가 거부되어야 함"
    except ValueError:
        return True, "잘못된 전이 정상 거부"


def t9():
    """list_queue — status 필터."""
    enqueue({"key": "test.list_a", "weights": {"a": 1.0}})
    enqueue({"key": "test.list_b", "weights": {"a": 1.0}})
    drafts = list_queue("DRAFT")
    return len(drafts) >= 2, f"DRAFT 수: {len(drafts)}"


for name, fn in [("enqueue_draft", t1), ("weight_sum_pass", t2),
                 ("weight_sum_fail", t3), ("deps_missing_ds_file", t4),
                 ("ui_component_missing", t5), ("auto_validate_reject", t6),
                 ("transition_normal_flow", t7), ("transition_invalid_blocked", t8),
                 ("list_queue_filter", t9)]:
    try:
        passed, msg = fn()
    except Exception as e:
        passed, msg = False, f"예외: {e}"
    results.append((name, passed, msg))
    print(f"{'✓' if passed else '✗'} {name}: {msg}")

failed = sum(1 for _, p, _ in results if not p)
print(f"\n{len(results)-failed}/{len(results)} PASS")
sys.exit(0 if failed == 0 else 1)
