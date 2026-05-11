# Model Review Queue — UI 통합 가이드

## Phase 0 (현재) — 데이터 + 검증 모듈만
- `utils/model_review_queue.py` — 상태 전이 + 자동 룰 3종
- `data_raw/_models/review_queue.json` — 큐 파일 (JSON)
- `data_raw/_models/review_queue.schema.json` — JSON Schema

## 상태 전이
```
DRAFT → REVIEWING → PUBLISHED  (정상 승인)
DRAFT → REVIEWING → REJECTED   (리뷰 반려)
DRAFT → REJECTED               (자동 검증 실패)
REJECTED → DRAFT               (재시도)
```

## 자동 검증 룰 3종
| 룰 | 조건 | 실패 시 |
|---|---|---|
| `weight_sum_eq_1.00` | 가중치 절대값 합 = 1.00 (±0.001) | REJECTED 자동 전이 |
| `data_dependencies_exist` | 모든 deps가 datasets.json에 존재 | REJECTED 자동 전이 |
| `ui_component_file_exists` | `ui_component` + `scorer` 파일 존재 | REJECTED 자동 전이 |

## Python API
```python
from utils.model_review_queue import enqueue, validate, transition, list_queue

# 스캐폴딩 결과 등록
qid = enqueue(model_meta_dict, scaffold_cost_usd=2.5)

# 자동 검증 실행 (DRAFT → REVIEWING or REJECTED)
results = validate(qid)

# 사람 리뷰 후 전이
transition(qid, "PUBLISHED", by="user@gagahoho.com", note="approved")

# 큐 목록 조회 (상태 필터)
drafts = list_queue("DRAFT")
reviewing = list_queue("REVIEWING")
```

## Phase 1 (BACKEND_API_SKELETON 결정 후) — UI
1. Data Studio "데이터셋" 메뉴 옆에 "모델 리뷰 큐" 탭 신설
2. 큐 카드 그리드: DRAFT → REVIEWING → PUBLISHED / REJECTED
3. 각 카드 액션:
   - 검토 시작 (REVIEWING으로 전환)
   - 승인 (PUBLISHED) — 모델 catalog.json에 자동 등록 + UI 컴포넌트 활성화
   - 반려 (REJECTED) + 사유 입력
4. 자동 검증 룰 3종 결과를 카드에 색상 표시:
   - weight_sum: ✓ 1.00 / ✗ 0.85 (수정 필요)
   - data_dependencies: ✓ 5 OK / ✗ 누락 (kosis_x)
   - ui_component_files: ✓ / ✗ 파일 부재

## Phase 2 — 자동 발행 (선택)
- PUBLISHED 모델은 catalog.json에 자동 추가 + 헤더 카탈로그 카드로 즉시 노출
- 사용 빈도 추적 (usage_count_lifetime)
