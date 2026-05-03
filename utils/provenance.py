"""Provenance Stamp — 모든 수집 데이터에 출처/시점/라이선스 메타데이터를 부착.

명분(銘分) 컨설팅 시스템의 SIL(Scientific Integrity Layer) 5장치 중 첫 번째.
어떤 셀이든 클릭하면 출처를 추적할 수 있어야 한다.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SOURCES_META_PATH = Path(__file__).parent.parent / "data_raw" / "sources_meta.json"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _content_hash(payload: Any) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(body).hexdigest()[:16]


def stamp(
    data: Any,
    source: str,
    url: str,
    license: str,
    *,
    fetched_at: str | None = None,
    confidence: float = 1.0,
    notes: str | None = None,
) -> dict:
    """데이터에 Provenance 헤더를 부착해 dict로 반환.

    Args:
        data: 원본 페이로드 (dict | list | scalar). 그대로 ``data`` 키에 보존.
        source: 출처 기관명 (예: "행정안전부 LOCALDATA").
        url: 호출 URL 또는 CKAN/포털 페이지.
        license: 라이선스 코드/이름 (예: "KOGL Type 1").
        fetched_at: ISO8601 UTC. 미지정 시 현재 시각.
        confidence: 0~1 신뢰도 점수.
        notes: 추가 설명 (선택).

    Returns:
        {"_provenance": {...}, "data": data} 형태의 dict.
    """
    header = {
        "source": source,
        "url": url,
        "license": license,
        "fetched_at": fetched_at or _utc_now_iso(),
        "confidence": confidence,
        "content_hash": _content_hash(data),
    }
    if notes:
        header["notes"] = notes
    return {"_provenance": header, "data": data}


def write_stamped(
    path: str | Path,
    data: Any,
    source: str,
    url: str,
    license: str,
    **kwargs: Any,
) -> Path:
    """stamp() 결과를 JSON 파일로 저장하고 sources_meta.json 인덱스에 기록."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    stamped = stamp(data, source=source, url=url, license=license, **kwargs)
    path.write_text(json.dumps(stamped, ensure_ascii=False, indent=2), encoding="utf-8")

    _register(path, stamped["_provenance"], status="ok")
    return path


def mark_failure(path: str | Path, source: str, url: str, error: str) -> None:
    """수집 실패 시 sources_meta.json에 status=fail 기록.

    파일 자체에도 stub Provenance 헤더를 남겨 보고서 빌드 단계가 누락 없이
    인용 가능 자원의 존재/부재를 확인할 수 있도록 한다.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = {
        "source": source,
        "url": url,
        "license": "n/a",
        "fetched_at": _utc_now_iso(),
        "confidence": 0.0,
        "content_hash": "",
        "status": "fail",
        "error": error,
    }
    stub = {"_provenance": header, "data": None}
    path.write_text(json.dumps(stub, ensure_ascii=False, indent=2), encoding="utf-8")
    _register(path, header, status="fail", error=error)


def _register(path: Path, header: dict, *, status: str, error: str | None = None) -> None:
    SOURCES_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SOURCES_META_PATH.exists():
        index = json.loads(SOURCES_META_PATH.read_text(encoding="utf-8"))
    else:
        index = {"updated_at": "", "sources": {}}

    try:
        rel_key = str(path.relative_to(SOURCES_META_PATH.parent.parent))
    except ValueError:
        rel_key = str(path)

    entry = {**header, "status": status, "path": rel_key}
    if error:
        entry["error"] = error
    index["sources"][rel_key] = entry
    index["updated_at"] = _utc_now_iso()

    SOURCES_META_PATH.write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_index() -> dict:
    if not SOURCES_META_PATH.exists():
        return {"updated_at": "", "sources": {}}
    return json.loads(SOURCES_META_PATH.read_text(encoding="utf-8"))
