"""data_cache — ETag/Last-Modified 기반 HTTP 캐싱.

재수집 시 변경된 자원만 다시 받는다. 비용 절감 + 재현성 확보.
캐시 위치: ``.cache/http/<key>.{body,meta}``
"""
from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping


CACHE_DIR = Path(__file__).parent.parent / ".cache" / "http"


def _key_path(key: str) -> Path:
    safe = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / safe


def fetch_or_load(
    url: str,
    key: str | None = None,
    *,
    headers: Mapping[str, str] | None = None,
    timeout: int = 30,
    force_refresh: bool = False,
) -> tuple[bytes, dict]:
    """URL을 가져오거나 캐시 본문을 반환.

    Returns:
        (body_bytes, info)  — info: ``{"cached": bool, "status": int, "etag": str|None, ...}``

    304 응답이면 캐시 본문을 그대로 돌려준다.
    네트워크 에러 시 캐시 있으면 stale 본문 + ``info["stale"]=True``,
    캐시도 없으면 예외를 다시 던진다.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    base = _key_path(key or url)
    body_file = base.with_suffix(".body")
    meta_file = base.with_suffix(".meta")

    meta: dict = {}
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            meta = {}

    req_headers = dict(headers or {})
    if not force_refresh:
        if meta.get("etag"):
            req_headers.setdefault("If-None-Match", meta["etag"])
        if meta.get("last_modified"):
            req_headers.setdefault("If-Modified-Since", meta["last_modified"])

    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
            new_meta = {
                "url": url,
                "etag": resp.headers.get("ETag"),
                "last_modified": resp.headers.get("Last-Modified"),
                "content_type": resp.headers.get("Content-Type"),
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": resp.status,
            }
            body_file.write_bytes(body)
            meta_file.write_text(json.dumps(new_meta, ensure_ascii=False, indent=2), encoding="utf-8")
            return body, {"cached": False, **new_meta}
    except urllib.error.HTTPError as exc:
        if exc.code == 304 and body_file.exists():
            return body_file.read_bytes(), {"cached": True, "status": 304, **meta}
        if body_file.exists():
            return body_file.read_bytes(), {"cached": True, "stale": True, "error": str(exc), **meta}
        raise
    except urllib.error.URLError as exc:
        if body_file.exists():
            return body_file.read_bytes(), {"cached": True, "stale": True, "error": str(exc), **meta}
        raise


def fetch_json(url: str, **kwargs) -> tuple[dict | list, dict]:
    body, info = fetch_or_load(url, **kwargs)
    return json.loads(body.decode("utf-8")), info
