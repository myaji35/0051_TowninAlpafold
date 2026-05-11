"""utils/manifest_repo.py
Manifest 저장소 추상 인터페이스 + JSON 구현 (Phase 0).

3단계 전환 전략:
  Phase 0: JSONManifestRepo (fcntl lockfile) — 현재
  Phase 1: SQLiteManifestRepo — 1,000+ dongs OR 10+ active datasets
  Phase 2: PostgresManifestRepo — Enterprise multi-tenant

호출자는 ManifestRepo 추상 인터페이스만 사용 → 구현체 교체 시 비용 0.

사용:
    from utils.manifest_repo import get_manifest_repo
    repo = get_manifest_repo()  # 환경변수로 구현체 자동 선택
    pct = repo.get_dong_completion("1168064000")
    repo.set_dataset_coverage("1168064000", "kosis_living_pop", months_covered=60)
"""
import json
import os
import contextlib
import fcntl
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional


class ManifestRepo(ABC):
    """Manifest 저장소 추상 인터페이스. 모든 구현체가 따라야 함."""

    @abstractmethod
    def load(self) -> dict:
        """전체 manifest 로드."""
        ...

    @abstractmethod
    def save(self, manifest: dict) -> None:
        """전체 manifest 저장 (잠금 포함)."""
        ...

    @abstractmethod
    @contextlib.contextmanager
    def transaction(self):
        """원자적 read-modify-write. yield된 dict를 수정하면 자동 커밋."""
        ...

    # 도메인 헬퍼 — 모든 구현체에 공통
    @abstractmethod
    def get_dong_completion(self, adm_cd: str) -> Optional[float]:
        """동 completion_pct 조회. 없으면 None."""
        ...

    @abstractmethod
    def set_dataset_coverage(self, adm_cd: str, dataset_key: str,
                             months_covered: int, months_total: int = 60,
                             marker: str = "real", last_updated: str = "") -> None:
        """동 × 데이터셋 진척 갱신 + 동/시군구/광역시 % 자동 재계산 트리거."""
        ...

    @abstractmethod
    def list_dongs_with_dataset(self, dataset_key: str) -> list:
        """특정 데이터셋이 있는 모든 동 adm_cd."""
        ...


class JSONManifestRepo(ManifestRepo):
    """Phase 0 — manifest.json + fcntl lockfile.

    동시 쓰기 안전성: fcntl.flock(LOCK_EX). Phase 1 SQLite 전환 시 더 강한 ACID.
    """

    def __init__(self, manifest_path: Optional[Path] = None,
                 lock_dir: Optional[Path] = None):
        self.path = manifest_path or Path("data_raw/_progress/manifest.json")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock_dir = lock_dir or Path("/tmp/towninalpafold-manifest-locks")
        self.lock_dir.mkdir(parents=True, exist_ok=True)
        self.lock_path = self.lock_dir / "manifest.lock"

    @contextlib.contextmanager
    def _lock(self, mode="r"):
        """fcntl 기반 read/write lock. mode='r' shared, 'w' exclusive."""
        fp = open(self.lock_path, "w")
        try:
            if mode == "w":
                fcntl.flock(fp, fcntl.LOCK_EX)
            else:
                fcntl.flock(fp, fcntl.LOCK_SH)
            yield fp
        finally:
            try:
                fcntl.flock(fp, fcntl.LOCK_UN)
            finally:
                fp.close()

    def load(self) -> dict:
        with self._lock("r"):
            if not self.path.exists():
                return self._empty()
            try:
                return json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                return self._empty()

    def save(self, manifest: dict) -> None:
        with self._lock("w"):
            # atomic write — temp + rename
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                           encoding="utf-8")
            tmp.replace(self.path)

    @contextlib.contextmanager
    def transaction(self):
        """exclusive 락 + read-modify-write. yield된 dict 수정 후 자동 저장."""
        with self._lock("w"):
            # 이미 LOCK_EX 보유 중이므로 load()의 내부 lock 없이 직접 읽음
            if not self.path.exists():
                data = self._empty()
            else:
                try:
                    data = json.loads(self.path.read_text(encoding="utf-8"))
                except Exception:
                    data = self._empty()
            yield data
            tmp = self.path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                           encoding="utf-8")
            tmp.replace(self.path)

    def _empty(self) -> dict:
        return {
            "_meta": {"version": "2.0.0", "schema": "manifest_repo_v0"},
            "regions": [],
            "datasets_summary": [],
            "gallery_cards_availability": []
        }

    def get_dong_completion(self, adm_cd: str) -> Optional[float]:
        manifest = self.load()
        for region in manifest.get("regions", []):
            for sgg in region.get("sigungu", []):
                for dong in sgg.get("dongs", []):
                    if dong.get("adm_cd") == adm_cd:
                        return dong.get("completion_pct")
        return None

    def set_dataset_coverage(self, adm_cd: str, dataset_key: str,
                             months_covered: int, months_total: int = 60,
                             marker: str = "real", last_updated: str = "") -> None:
        with self.transaction() as data:
            dong = self._find_or_create_dong(data, adm_cd)
            dong.setdefault("datasets", {})[dataset_key] = {
                "months_covered": months_covered,
                "months_total": months_total,
                "marker": marker,
                "last_updated": last_updated,
            }
            self._recalc_dong(dong)
            self._recalc_aggregates(data)

    def list_dongs_with_dataset(self, dataset_key: str) -> list:
        manifest = self.load()
        out = []
        for region in manifest.get("regions", []):
            for sgg in region.get("sigungu", []):
                for dong in sgg.get("dongs", []):
                    if dataset_key in dong.get("datasets", {}):
                        out.append(dong.get("adm_cd"))
        return out

    def _find_or_create_dong(self, manifest: dict, adm_cd: str) -> dict:
        """manifest에서 adm_cd 찾거나 새로 만들기 (admin_hierarchy.json 참조 우선)."""
        for region in manifest.get("regions", []):
            for sgg in region.get("sigungu", []):
                for dong in sgg.get("dongs", []):
                    if dong.get("adm_cd") == adm_cd:
                        return dong
        # 신규 — _master/admin_hierarchy.json에서 컨텍스트 끌어옴 (있으면)
        # 없으면 minimal placeholder
        # 본 Phase 0에서는 단순화 — region "미정" 임시 영역에 추가
        unknown_region = next((r for r in manifest.get("regions", [])
                               if r.get("name") == "미정"), None)
        if not unknown_region:
            unknown_region = {"name": "미정", "code": "00", "sigungu": []}
            manifest.setdefault("regions", []).append(unknown_region)
        unknown_sgg = next((s for s in unknown_region["sigungu"]
                            if s.get("code") == "00000"), None)
        if not unknown_sgg:
            unknown_sgg = {"name": "미정", "code": "00000", "dongs": []}
            unknown_region["sigungu"].append(unknown_sgg)
        new_dong = {"adm_cd": adm_cd, "name": adm_cd, "completion_pct": 0,
                    "datasets": {}}
        unknown_sgg["dongs"].append(new_dong)
        return new_dong

    def _recalc_dong(self, dong: dict) -> None:
        """동 completion_pct = 데이터셋별 평균."""
        ds = dong.get("datasets", {})
        if not ds:
            dong["completion_pct"] = 0
            return
        pcts = []
        for d in ds.values():
            mt = d.get("months_total", 0)
            mc = d.get("months_covered", 0)
            if mt > 0:
                pcts.append(min(100, mc / mt * 100))
        dong["completion_pct"] = round(sum(pcts) / len(pcts), 1) if pcts else 0

    def _recalc_aggregates(self, manifest: dict) -> None:
        """시군구 % = 동 평균, 광역시 % = 시군구 평균."""
        for region in manifest.get("regions", []):
            for sgg in region.get("sigungu", []):
                dongs = sgg.get("dongs", [])
                covered = [d for d in dongs if d.get("completion_pct", 0) > 0]
                sgg["dong_total"] = len(dongs)
                sgg["dong_covered"] = len(covered)
                if dongs:
                    sgg["completion_pct"] = round(
                        sum(d.get("completion_pct", 0) for d in dongs) / len(dongs), 1)
                else:
                    sgg["completion_pct"] = 0
            sigungus = region.get("sigungu", [])
            region["sigungu_total"] = len(sigungus)
            region["sigungu_covered"] = sum(1 for s in sigungus if s.get("dong_covered", 0) > 0)
            region["dong_total"] = sum(s.get("dong_total", 0) for s in sigungus)
            region["dong_covered"] = sum(s.get("dong_covered", 0) for s in sigungus)
            if sigungus:
                region["completion_pct"] = round(
                    sum(s.get("completion_pct", 0) for s in sigungus) / len(sigungus), 1)
            else:
                region["completion_pct"] = 0


# Phase 1/2 stub — 트리거 시점에 구현
class SQLiteManifestRepo(ManifestRepo):
    """Phase 1 stub — 1,000+ dongs OR 10+ active datasets 트리거 시 구현."""
    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "SQLiteManifestRepo: Phase 1 트리거 시 구현 (별도 이슈). "
            "현재는 JSONManifestRepo 사용."
        )
    def load(self): ...
    def save(self, m): ...
    @contextlib.contextmanager
    def transaction(self):
        if False: yield {}
    def get_dong_completion(self, code): ...
    def set_dataset_coverage(self, *a, **k): ...
    def list_dongs_with_dataset(self, key): ...


class PostgresManifestRepo(ManifestRepo):
    """Phase 2 stub — Enterprise multi-tenant 트리거 시 구현."""
    def __init__(self, *args, **kwargs):
        raise NotImplementedError(
            "PostgresManifestRepo: Phase 2 (Enterprise multi-tenant) 트리거 시 구현."
        )
    def load(self): ...
    def save(self, m): ...
    @contextlib.contextmanager
    def transaction(self):
        if False: yield {}
    def get_dong_completion(self, code): ...
    def set_dataset_coverage(self, *a, **k): ...
    def list_dongs_with_dataset(self, key): ...


def get_manifest_repo() -> ManifestRepo:
    """환경변수 MANIFEST_BACKEND로 구현체 선택. 기본 JSON."""
    backend = os.environ.get("MANIFEST_BACKEND", "json").lower()
    if backend == "json":
        return JSONManifestRepo()
    if backend == "sqlite":
        return SQLiteManifestRepo()
    if backend == "postgres":
        return PostgresManifestRepo()
    raise ValueError(f"Unknown MANIFEST_BACKEND: {backend}")
