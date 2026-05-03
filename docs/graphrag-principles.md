# GraphRAG 구축 3원칙 (Harness 공통)

> 모든 하위 프로젝트에서 GraphRAG/Knowledge Graph를 구현할 때 **반드시 이 3원칙을 적용**한다.
> 위반 시 agent-harness는 자동으로 ARCH_DECISION 이슈를 생성하여 advisor 자문을 요청해야 한다.

---

## 1. 개체 결합 (Entity Resolution) 필수

동일 실체에 대한 중복 노드 생성을 방지하라. 표면형(Surface Form) ≠ 개체(Entity).
"삼성전자", "Samsung Electronics", "삼전"은 **하나의 노드**로 병합되어야 한다.

### 결합 3단계
1. **정규화(Normalization)**: 공백/대소문자/특수문자 표준화, 동의어 사전 적용
2. **블로킹(Blocking)**: 후보군 축소 (동일 카테고리/도메인끼리만 비교) — O(N²) 방지
3. **매칭(Matching)**: 임베딩 cosine ≥ 0.85 + 속성 일치(전화/이메일/사업자번호 등 고유 식별자) 결합 점수

### 필수 필드
- `canonical_id` (UUID v7): 대표 ID — 모든 alias가 이것으로 수렴
- `aliases[]`: 표면형 배열 — 검색 매칭용으로 보존
- `resolution_confidence` (0.0~1.0): 결합 신뢰도
- `PENDING_REVIEW` 상태: 임계값 미달 시 격리 → 사람/advisor 검토 큐로

---

## 2. 하이브리드 스키마 (Vector + Graph + Metadata)

단일 저장소에 모든 것을 욱여넣지 마라. 3개 레이어를 분리하되 **공통 ID로 연결**한다.

### 레이어 구성
| 레이어 | 용도 | 추천 스택 |
|---|---|---|
| **벡터 레이어** | 청크/노드 임베딩 → 의미 검색 | Qdrant, pgvector, Weaviate |
| **그래프 레이어** | 관계 트리플 → 다중 홉 추론 | Neo4j, KuzuDB, Memgraph |
| **메타데이터 레이어** | 원문/타임스탬프/출처 → 인용·감사 | PostgreSQL, JSONL |

### 연결 규칙
- **공통 키**: `entity_id` (UUID v7 — 시간 정렬 + 충돌 방지)
- **스키마 유연성**: 핵심 노드 타입(Person/Org/Event/Concept)은 strict, 속성은 schema-less JSON 확장
- **이중 인덱싱**: 동일 청크가 벡터 검색·그래프 traversal 양쪽에서 검색되도록 cross-reference 유지
- **로컬 LLM 활용**: 임베딩/OCR 단계는 Gemma 4 E4B 우선 (비용 0, 개인정보 안전)

---

## 3. 증분 업데이트 (Incremental Update)

**전체 재구축 금지.** 새 데이터만 델타 처리하라.

### 변경 감지
- 입력 문서마다 `content_hash` (SHA-256) 저장 → 동일 해시는 skip
- 문서 일부 변경 시 청크 단위 hash 비교로 영향 범위 최소화

### 델타 파이프라인
```
신규 문서 → 청킹 → 임베딩 → ER(기존 노드와 매칭) →
  ├─ 매칭 성공: 기존 노드에 evidence/relation 추가
  └─ 매칭 실패: 신규 노드 생성
→ 영향받은 서브그래프만 재인덱싱
```

### 버전·삭제 관리
- 모든 노드/엣지: `created_at`, `updated_at`, `source_doc_ids[]` 기록
- **Hard delete 금지** → `tombstone` 플래그로 soft delete (감사 로그 보존)
- **주기적 재결합(Re-ER)**: 증분 누적으로 분산된 동일 개체 발생 가능 → 백그라운드 잡으로 주 1회 재병합
- **충돌 해결**: 동일 관계가 출처별로 상충 시 → `confidence` 합산 + 출처 다수결, 동률은 최신 우선

---

## 위반 감지 체크리스트 (agent-harness 자가 점검)

GraphRAG 코드 PR 시 아래를 모두 확인. 하나라도 미달이면 ARCH_DECISION 이슈 자동 생성:

- [ ] Entity 노드에 `canonical_id`, `aliases[]`, `resolution_confidence` 필드 존재
- [ ] ER 단계가 정규화 → 블로킹 → 매칭 3단계로 분리되어 있음
- [ ] 벡터/그래프/메타데이터가 서로 다른 저장소(또는 명확히 분리된 테이블)
- [ ] 공통 `entity_id` (UUID v7)로 cross-reference 가능
- [ ] 입력 문서에 `content_hash` 기반 skip 로직 존재
- [ ] 노드/엣지에 `created_at`, `updated_at`, `source_doc_ids[]` 존재
- [ ] Hard delete 없음 → soft delete(`tombstone`)만 사용
- [ ] 주기적 Re-ER 잡 스케줄 (cron 또는 ScheduleWakeup) 존재
