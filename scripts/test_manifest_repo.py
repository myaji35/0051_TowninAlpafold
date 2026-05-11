"""scripts/test_manifest_repo.py
ManifestRepo 추상 인터페이스 + JSONManifestRepo 단위 smoke test.
실행: python3 scripts/test_manifest_repo.py
종료 코드: 0 통과 / 1 실패
"""
import sys
import json
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from utils.manifest_repo import (
    JSONManifestRepo, SQLiteManifestRepo, PostgresManifestRepo,
    get_manifest_repo, ManifestRepo
)

results = []


def t1():
    """abstract interface — JSONManifestRepo 인스턴스화 OK."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = JSONManifestRepo(manifest_path=Path(tmp) / "manifest.json",
                                lock_dir=Path(tmp) / "locks")
        assert isinstance(repo, ManifestRepo)
        return True, "JSONManifestRepo is ManifestRepo subclass"


def t2():
    """load — empty manifest 자동 생성."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = JSONManifestRepo(manifest_path=Path(tmp) / "manifest.json",
                                lock_dir=Path(tmp) / "locks")
        m = repo.load()
        return "regions" in m and m.get("regions") == [], "empty manifest = regions []"


def t3():
    """set_dataset_coverage — 새 동 + dataset + 자동 % 재계산."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = JSONManifestRepo(manifest_path=Path(tmp) / "manifest.json",
                                lock_dir=Path(tmp) / "locks")
        repo.set_dataset_coverage("1168064000", "kosis_living_pop",
                                  months_covered=60, months_total=60, marker="real")
        pct = repo.get_dong_completion("1168064000")
        return pct == 100.0, f"60/60 dataset → completion 100% (실제 {pct}%)"


def t4():
    """transaction — 원자적 read-modify-write."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = JSONManifestRepo(manifest_path=Path(tmp) / "manifest.json",
                                lock_dir=Path(tmp) / "locks")
        with repo.transaction() as m:
            m["custom_field"] = "test_value"
        m2 = repo.load()
        return m2.get("custom_field") == "test_value", "transaction 변경 사항 영속"


def t5():
    """집계 — 동 2개 → 시군구 % 자동 평균."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = JSONManifestRepo(manifest_path=Path(tmp) / "manifest.json",
                                lock_dir=Path(tmp) / "locks")
        repo.set_dataset_coverage("DONG-A", "ds1", months_covered=60, months_total=60)
        repo.set_dataset_coverage("DONG-B", "ds1", months_covered=30, months_total=60)
        m = repo.load()
        # 둘 다 "미정" 시군구에 들어감
        sgg = m["regions"][0]["sigungu"][0]
        # 동 평균 = (100 + 50) / 2 = 75
        return sgg["completion_pct"] == 75.0, f"시군구 % = {sgg['completion_pct']} (기대 75)"


def t6():
    """Phase 1/2 stub — NotImplementedError."""
    try:
        SQLiteManifestRepo()
        return False, "SQLiteManifestRepo 인스턴스화가 NotImplementedError 안 일으킴"
    except NotImplementedError:
        pass
    try:
        PostgresManifestRepo()
        return False, "Postgres 인스턴스화"
    except NotImplementedError:
        pass
    return True, "Phase 1/2 stub NotImplementedError 정상"


def t7():
    """get_manifest_repo — 환경변수 라우팅."""
    import os
    os.environ["MANIFEST_BACKEND"] = "json"
    repo = get_manifest_repo()
    return isinstance(repo, JSONManifestRepo), "MANIFEST_BACKEND=json → JSONManifestRepo"


for name, fn in [("abstract", t1), ("empty_load", t2), ("set_coverage", t3),
                 ("transaction", t4), ("aggregate", t5),
                 ("phase12_stub", t6), ("env_routing", t7)]:
    try:
        passed, msg = fn()
    except Exception as e:
        passed, msg = False, f"예외: {e}"
    results.append((name, passed, msg))
    print(f"{'✓' if passed else '✗'} {name}: {msg}")

failed = sum(1 for _, p, _ in results if not p)
print(f"\n{len(results)-failed}/{len(results)} PASS")
sys.exit(0 if failed == 0 else 1)
