"""scripts/test_manifest_cascade.py
manifest 캐스케이드 6개 통합 테스트. stdlib only.

실행:
    python3 scripts/test_manifest_cascade.py
"""
import json
import sys
import tempfile
import shutil
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

HIERARCHY_SRC = ROOT / "data_raw/_master/admin_hierarchy.json"
MANIFEST_SRC = ROOT / "data_raw/_progress/manifest.json"

WEDGE_ADM_CD = "4115011000"
DATASET_KEY = "kosis_living_pop"

# ---------------------------------------------------------------------------
# 격리 헬퍼
# ---------------------------------------------------------------------------

def make_isolated_repo(tmp: Path):
    """tmp 디렉터리에 manifest.json 복사본 생성 → JSONManifestRepo 반환."""
    from utils.manifest_repo import JSONManifestRepo
    manifest_copy = tmp / "manifest.json"
    shutil.copy2(MANIFEST_SRC, manifest_copy)
    lock_dir = tmp / "locks"
    lock_dir.mkdir()
    return JSONManifestRepo(manifest_path=manifest_copy, lock_dir=lock_dir)


# ---------------------------------------------------------------------------
# 테스트 함수
# ---------------------------------------------------------------------------

def test_admin_hierarchy_loads():
    """1. admin_hierarchy.json 파싱 + 금오동 1건 확인."""
    data = json.loads(HIERARCHY_SRC.read_text(encoding="utf-8"))
    assert data["version"] == 1, "version 필드 없음"
    regions = data["regions"]
    assert len(regions) == 1, f"regions 1건 기대, 실제 {len(regions)}"
    sgg = regions[0]["sigungu"][0]
    assert sgg["code"] == "4115", f"의정부시 코드 불일치: {sgg['code']}"
    dong = sgg["dongs"][0]
    assert dong["adm_cd"] == WEDGE_ADM_CD, f"adm_cd 불일치: {dong['adm_cd']}"
    assert dong["target_datasets"] == 5


def test_manifest_seed_loads():
    """2. manifest.json 파싱 + 금오동 dong 1건 확인."""
    data = json.loads(MANIFEST_SRC.read_text(encoding="utf-8"))
    regions = data.get("regions", [])
    assert len(regions) == 1, f"regions 1건 기대, 실제 {len(regions)}"
    dong = regions[0]["sigungu"][0]["dongs"][0]
    assert dong["adm_cd"] == WEDGE_ADM_CD
    assert dong["completion_pct"] == 0
    assert dong["datasets"] == {}


def test_etl_dry_run_updates_manifest():
    """3. kosis_living_pop.run(dry_run=True) 후 manifest datasets_covered == 1.

    etl 모듈은 'from utils.manifest_repo import JSONManifestRepo' 로 심볼을 바인딩하므로
    etl_mod.JSONManifestRepo 심볼 자체를 패치해야 격리 경로가 적용된다.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        make_isolated_repo(tmp)  # manifest.json 복사

        import etl.kosis_living_pop as etl_mod
        from utils.manifest_repo import JSONManifestRepo as _OrigRepo

        class _IsolatedRepo(_OrigRepo):
            def __init__(self, manifest_path=None, lock_dir=None):
                super().__init__(
                    manifest_path=tmp / "manifest.json",
                    lock_dir=tmp / "locks",
                )

        # etl_mod 내부의 JSONManifestRepo 심볼 교체
        etl_mod.JSONManifestRepo = _IsolatedRepo
        try:
            result = etl_mod.run(dry_run=True)
        finally:
            etl_mod.JSONManifestRepo = _OrigRepo

        assert result["status"] == "success", f"ETL 실패: {result}"
        assert "manifest_warning" not in result, f"manifest 갱신 경고: {result.get('manifest_warning')}"

        # manifest 검증
        data = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
        dong = data["regions"][0]["sigungu"][0]["dongs"][0]
        assert DATASET_KEY in dong["datasets"], "datasets에 kosis_living_pop 없음"


def test_completion_pct_after_1of5():
    """4. 1/5 데이터셋 완료 시 completion_pct == 20.0."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        repo = make_isolated_repo(tmp)
        repo.set_dataset_coverage(
            adm_cd=WEDGE_ADM_CD,
            dataset_key=DATASET_KEY,
            months_covered=1,
            months_total=5,
            marker="real",
        )
        pct = repo.get_dong_completion(WEDGE_ADM_CD)
        assert pct == 20.0, f"20.0% 기대, 실제 {pct}"


def test_marker_synthetic_vs_real():
    """5. synthetic marker는 completion_pct에 반영되지만 real_pct 와 구별 가능."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        repo = make_isolated_repo(tmp)

        # synthetic 1건
        repo.set_dataset_coverage(
            adm_cd=WEDGE_ADM_CD,
            dataset_key=DATASET_KEY,
            months_covered=1,
            months_total=5,
            marker="synthetic",
        )
        data = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
        dong = data["regions"][0]["sigungu"][0]["dongs"][0]
        ds_entry = dong["datasets"][DATASET_KEY]
        assert ds_entry["marker"] == "synthetic", "marker synthetic 불일치"
        # completion_pct는 계산됨 (synthetic이어도 진척은 기록)
        assert dong["completion_pct"] == 20.0, f"completion_pct 20.0 기대, 실제 {dong['completion_pct']}"

        # real로 덮어쓰면 marker 변경 확인
        repo.set_dataset_coverage(
            adm_cd=WEDGE_ADM_CD,
            dataset_key=DATASET_KEY,
            months_covered=1,
            months_total=5,
            marker="real",
        )
        data2 = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
        dong2 = data2["regions"][0]["sigungu"][0]["dongs"][0]
        assert dong2["datasets"][DATASET_KEY]["marker"] == "real"


def test_idempotent_double_call():
    """6. 동일 키 두 번 set_dataset_coverage 해도 datasets 카운트 1."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        repo = make_isolated_repo(tmp)

        for _ in range(2):
            repo.set_dataset_coverage(
                adm_cd=WEDGE_ADM_CD,
                dataset_key=DATASET_KEY,
                months_covered=1,
                months_total=5,
                marker="real",
            )

        data = json.loads((tmp / "manifest.json").read_text(encoding="utf-8"))
        dong = data["regions"][0]["sigungu"][0]["dongs"][0]
        assert len(dong["datasets"]) == 1, f"datasets 항목 1 기대, 실제 {len(dong['datasets'])}"
        assert dong["completion_pct"] == 20.0


# ---------------------------------------------------------------------------
# 실행기
# ---------------------------------------------------------------------------

TESTS = [
    test_admin_hierarchy_loads,
    test_manifest_seed_loads,
    test_etl_dry_run_updates_manifest,
    test_completion_pct_after_1of5,
    test_marker_synthetic_vs_real,
    test_idempotent_double_call,
]

if __name__ == "__main__":
    passed = 0
    failed = 0
    for fn in TESTS:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception as exc:
            print(f"  FAIL  {fn.__name__}: {exc}")
            failed += 1

    total = passed + failed
    print(f"\n{passed}/{total} passed", "OK" if failed == 0 else f"({failed} FAILED)")
    sys.exit(0 if failed == 0 else 1)
