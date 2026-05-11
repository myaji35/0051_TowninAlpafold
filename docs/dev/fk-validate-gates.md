# FK Validate Gates — 4 게이트 통합 가이드

`scripts/validate_catalogs.py`를 4개 진입점에서 호출하여 깨진 외래키 참조로 인한 런타임 오류를 사전에 차단한다.

## 검증 대상 외래키 5종

| FK | 출발 | 도착 | 설명 |
|----|------|------|------|
| 1 | `_models/catalog.json[*].data_dependencies[]` | `_registry/datasets.json[*].key` | 모델이 의존하는 데이터셋 존재 |
| 2 | `_brands/catalog.json[*].primary_models[]` | `_models/catalog.json[*].key` | 브랜드가 가리키는 모델 존재 |
| 3 | `_progress/manifest.json regions[*].sigungu[*].code` | `_master/admin_hierarchy.json sigungu[*].code` | 시군구 코드 정합 (WARNING) |
| 4 | `_progress/manifest.json datasets_summary[*].key` | `_registry/datasets.json[*].key` | manifest 추적 데이터셋 존재 |
| 5 | `_models/catalog.json[*].ui_component` / `scorer` | 파일 시스템 경로 | 참조 파일 부재 |

---

## 게이트 1: form_submit

**진입점**: 등록 폼 제출 시 (백엔드 API 엔드포인트)

```python
# 예: FastAPI / Flask 컨트롤러
import subprocess, json

def validate_fk() -> dict:
    result = subprocess.run(
        ["python3", "scripts/validate_catalogs.py"],
        capture_output=True, text=True
    )
    return json.loads(result.stdout), result.returncode

@app.post("/api/catalog/submit")
def submit_catalog(payload: dict):
    validation, code = validate_fk()
    if code != 0:
        return {"error": "FK validation failed", "detail": validation["errors"]}, 422
    # ... 정상 처리
```

---

## 게이트 2: etl_run_pre

**진입점**: `etl_scheduler.py` / `etl_*.py` 시작 시

```python
# etl_scheduler.py 상단에 추가
import subprocess, sys, json

def pre_etl_validate():
    r = subprocess.run(["python3", "scripts/validate_catalogs.py"], capture_output=True, text=True)
    result = json.loads(r.stdout)
    if r.returncode != 0:
        print(f"[ETL ABORT] FK 오류 {result['summary']['errors']}건 — ETL 중단")
        for e in result["errors"]:
            print(f"  - {e['msg']}")
        sys.exit(1)

pre_etl_validate()
```

---

## 게이트 3: manifest_recalc_pre

**진입점**: `recalculate_manifest_after_etl()` 또는 manifest 재계산 함수 진입 시

```python
def recalculate_manifest_after_etl():
    # FK 검증 먼저
    r = subprocess.run(["python3", "scripts/validate_catalogs.py"], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"manifest 재계산 전 FK 검증 실패: {r.stdout}")
    # ... 재계산 로직
```

---

## 게이트 4: pdf_render_pre

**진입점**: PDF 렌더러 (`wkhtmltopdf`, Playwright print 등) 호출 전

```python
def render_pdf(template_path: str, output_path: str):
    # FK 검증 먼저
    r = subprocess.run(["python3", "scripts/validate_catalogs.py"], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"PDF 렌더 전 FK 검증 실패: {r.stdout}")
    # ... PDF 생성
```

---

## pre-commit 훅 등록 (1회)

```bash
bash scripts/install_pre_commit_hook.sh
```

카탈로그 JSON이 staged 되면 commit 전 자동 검증. 위반 시 commit 중단.

---

## Phase 계획

- **Phase 0 (현재)**: 카탈로그 파일 미존재 → validate 자동 통과 (exit 0)
- **Phase 1**: 게이트 2 (ETL) 구현 → BACKEND_API_SKELETON 이슈
- **Phase 2**: 게이트 1, 3, 4 구현 → ETL_INFRA_RELIABILITY 이슈
