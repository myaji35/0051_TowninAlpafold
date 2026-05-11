"""utils/model_review_queue.py
모델 자동 스캐폴딩 결과 = DRAFT 큐. 사람 리뷰 통과 → PUBLISHED.

상태 전이:
  DRAFT → REVIEWING → PUBLISHED (정상)
  DRAFT → REVIEWING → REJECTED (반려)
  DRAFT → REJECTED (자동 검증 실패 시)

사용:
    from utils.model_review_queue import enqueue, validate, transition
    qid = enqueue(model_meta_dict, scaffold_cost_usd=2.5)
    validate(qid)  # 자동 검증 → 통과면 REVIEWING, 실패면 REJECTED
    transition(qid, "PUBLISHED", reviewer="user@gagahoho.com")
"""
import json
import datetime
import hashlib
from pathlib import Path
from typing import Optional

QUEUE_PATH = Path("data_raw/_models/review_queue.json")
QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)

STATUS_ENUM = ["DRAFT", "REVIEWING", "PUBLISHED", "REJECTED"]
ALLOWED_TRANSITIONS = {
    "DRAFT": ["REVIEWING", "REJECTED"],
    "REVIEWING": ["PUBLISHED", "REJECTED", "DRAFT"],  # 재작업 가능
    "PUBLISHED": [],  # terminal
    "REJECTED": ["DRAFT"],  # 재시도 가능
}


def _now() -> str:
    return datetime.datetime.now().isoformat()


def _load() -> dict:
    if not QUEUE_PATH.exists():
        return {"_meta": {"version": "1.0", "schema": "model_review_queue_v0"},
                "queue": []}
    try:
        return json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"_meta": {"version": "1.0"}, "queue": []}


def _save(data: dict) -> None:
    QUEUE_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                          encoding="utf-8")


def _gen_qid(model_key: str) -> str:
    """queue id — model_key + timestamp 해시."""
    raw = f"{model_key}:{_now()}"
    return f"Q-{model_key}-{hashlib.sha256(raw.encode()).hexdigest()[:8]}"


def enqueue(model_meta: dict, scaffold_cost_usd: float = 0.0,
            scaffold_source: str = "agent-harness") -> str:
    """모델 자동 스캐폴딩 결과를 DRAFT 큐에 등록. queue_id 반환."""
    if not isinstance(model_meta, dict) or "key" not in model_meta:
        raise ValueError("model_meta must have 'key' field")
    qid = _gen_qid(model_meta["key"])
    data = _load()
    item = {
        "queue_id": qid,
        "model_key": model_meta["key"],
        "model_meta": model_meta,
        "status": "DRAFT",
        "scaffold_cost_usd": scaffold_cost_usd,
        "scaffold_source": scaffold_source,
        "validation_results": None,
        "history": [{"at": _now(), "from": None, "to": "DRAFT",
                     "by": scaffold_source, "note": "auto_scaffold"}],
        "created_at": _now(),
        "updated_at": _now(),
    }
    data["queue"].append(item)
    _save(data)
    return qid


def find(qid: str) -> Optional[dict]:
    data = _load()
    return next((q for q in data.get("queue", []) if q.get("queue_id") == qid), None)


def list_queue(status: Optional[str] = None) -> list:
    data = _load()
    items = data.get("queue", [])
    if status:
        items = [q for q in items if q.get("status") == status]
    return items


def transition(qid: str, to_status: str, by: str = "system",
               note: str = "") -> dict:
    """상태 전이. ALLOWED_TRANSITIONS 위반 시 ValueError."""
    if to_status not in STATUS_ENUM:
        raise ValueError(f"Invalid status: {to_status}")
    data = _load()
    item = next((q for q in data["queue"] if q.get("queue_id") == qid), None)
    if not item:
        raise ValueError(f"Queue item not found: {qid}")
    cur = item["status"]
    if to_status not in ALLOWED_TRANSITIONS.get(cur, []):
        raise ValueError(f"Invalid transition: {cur} → {to_status}")
    item["history"].append({"at": _now(), "from": cur, "to": to_status,
                            "by": by, "note": note})
    item["status"] = to_status
    item["updated_at"] = _now()
    _save(data)
    return item


# ─── 자동 검증 룰 3종 ───

def validate_weight_sum(model_meta: dict, tol: float = 0.001) -> tuple:
    """rule 1: 가중치 절대값 합 = 1.00."""
    weights = model_meta.get("weights") or model_meta.get("scoring_rules", {}).get("weights")
    if not weights:
        return False, "weights field missing"
    if isinstance(weights, dict):
        abs_sum = sum(abs(v) for v in weights.values() if isinstance(v, (int, float)))
    elif isinstance(weights, list):
        abs_sum = sum(abs(w.get("weight", 0)) for w in weights)
    else:
        return False, f"weights type unexpected: {type(weights).__name__}"
    if abs(abs_sum - 1.0) > tol:
        return False, f"weight abs-sum {abs_sum:.4f} != 1.00 (tol {tol})"
    return True, f"weight abs-sum {abs_sum:.4f}"


def validate_data_dependencies(model_meta: dict,
                                datasets_path: Path = Path("data_raw/_registry/datasets.json")
                                ) -> tuple:
    """rule 2: data_dependencies가 모두 datasets.json의 key에 있음."""
    deps = model_meta.get("data_dependencies", [])
    if not deps:
        return True, "no dependencies declared (skipped)"
    if not datasets_path.exists():
        return False, f"datasets.json missing — cannot verify {len(deps)} deps"
    try:
        ds = json.loads(datasets_path.read_text(encoding="utf-8"))
    except Exception as e:
        return False, f"datasets.json load error: {e}"
    keys = {d.get("key") for d in ds.get("datasets", [])}
    missing = [d for d in deps if d not in keys]
    if missing:
        return False, f"missing data_dependencies: {missing}"
    return True, f"all {len(deps)} deps present"


def validate_ui_component_files(model_meta: dict,
                                root: Path = Path(".")) -> tuple:
    """rule 3: ui_component + scorer 파일 존재."""
    missing = []
    for field in ["ui_component", "scorer"]:
        path_str = model_meta.get(field)
        if not path_str:
            missing.append(f"{field} field missing")
            continue
        full = root / path_str
        if not full.exists():
            missing.append(f"{field}: {path_str} not found")
    if missing:
        return False, "; ".join(missing)
    return True, "ui_component + scorer files exist"


def validate(qid: str) -> dict:
    """모든 자동 룰 실행. 통과 시 REVIEWING, 실패 시 REJECTED 자동 전이.
    Returns validation_results dict.
    """
    item = find(qid)
    if not item:
        raise ValueError(f"Queue item not found: {qid}")
    meta = item.get("model_meta", {})
    rules = [
        ("weight_sum_eq_1.00", validate_weight_sum, [meta]),
        ("data_dependencies_exist", validate_data_dependencies, [meta]),
        ("ui_component_file_exists", validate_ui_component_files, [meta]),
    ]
    results = []
    all_pass = True
    for name, fn, args in rules:
        try:
            ok, msg = fn(*args)
        except Exception as e:
            ok, msg = False, f"validator exception: {e}"
        results.append({"rule": name, "passed": ok, "msg": msg})
        if not ok:
            all_pass = False

    # 결과 기록 + 자동 전이
    data = _load()
    item = next(q for q in data["queue"] if q.get("queue_id") == qid)
    item["validation_results"] = {"all_pass": all_pass, "rules": results,
                                   "validated_at": _now()}
    if item["status"] == "DRAFT":
        item["history"].append({"at": _now(), "from": "DRAFT",
                                "to": "REVIEWING" if all_pass else "REJECTED",
                                "by": "auto-validate",
                                "note": "all rules passed" if all_pass else "auto-rejected by failed rules"})
        item["status"] = "REVIEWING" if all_pass else "REJECTED"
        item["updated_at"] = _now()
    _save(data)
    return item["validation_results"]
