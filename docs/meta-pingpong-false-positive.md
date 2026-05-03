# Meta-Review 핑퐁 오탐 분석 — ISS-017

**이슈**: ISS-017 (PATTERN_ANALYSIS)
**대상 체인**: ISS-009 (GENERATE_CODE) → 3개 파생
**작성일**: 2026-05-03

## 결론

**핑퐁이 아니다 — false positive.**

`meta-review.sh`가 "한 이슈에서 3회 파생됨"을 핑퐁으로 라벨링했지만, 이는 `on_complete.sh`의 정상 매핑(`GENERATE_CODE → LINT_CHECK + RUN_TESTS + DOMAIN_ANALYZE`) 결과다. CLAUDE.md에 명시된 의도된 파이프라인 동작.

## 증거

### ISS-009의 파생 3개 (모두 다른 type, 다른 에이전트, 1회씩만)

| 파생 ID | type | 에이전트 | 상태 |
|---|---|---|---|
| ISS-010 | LINT_CHECK | code-quality | DONE |
| ISS-011 | RUN_TESTS | test-harness | DONE |
| ISS-012 | DOMAIN_ANALYZE | domain-analyst | COMPLETED |

### 핑퐁 정의 (CLAUDE.md / harness 운영원칙)

핑퐁 = 둘 중 하나
1. **에이전트 간 직접 호출** (Hook 경유 없이) — 본 케이스 해당 없음
2. **동일 source, 동일 type 반복** (예: ISS-009 → LINT_CHECK 두 번 등록) — 본 케이스 해당 없음

본 체인의 type 분포: `LINT_CHECK×1, RUN_TESTS×1, DOMAIN_ANALYZE×1` — 모두 단일.

### CLAUDE.md의 의도된 매핑 (on_complete.sh:line 376~)

> `GENERATE_CODE/FIX_BUG/BIZ_FIX | 항상 | LINT_CHECK + RUN_TESTS + DOMAIN_ANALYZE + UI_REVIEW (UI파일 있으면) + JOURNEY_VALIDATE`

즉 GENERATE_CODE 1건 → 최대 5건 파생이 정상. 본 체인은 3건이므로 정상 범위 안.

## 근본 원인 — meta-review의 단순 카운팅 룰

`meta-review.sh`가 핑퐁을 감지할 때 사용한 룰: **"한 source에서 N회 이상 파생되면 핑퐁"**.

이는 다음을 구별하지 못한다:
- ❌ 정상 다종 파생 (lint + test + domain — 본 케이스)
- ✅ 진짜 핑퐁 (lint → fix → lint → fix → ...)

## 권고 — meta-review 룰 정밀화

`meta-review.sh`의 핑퐁 룰을 다음으로 강화 (글로벌 레포 GH_Harness 측 작업):

```python
# 잘못된 룰 (현재):
if derivative_count >= 3: flag_pingpong()

# 올바른 룰:
type_counts = Counter(d.type for d in derivatives)
duplicate_types = [t for t, n in type_counts.items() if n >= 2]
if duplicate_types:
    flag_pingpong(reason=f"동일 type 중복 파생: {duplicate_types}")
elif derivative_count > 5:
    flag_high_fanout(reason=f"의도된 매핑 초과")  # 핑퐁 아닌 별도 신호
```

이렇게 하면:
- ISS-009 (3종 단일) → 핑퐁 아님 (조용히 통과)
- 진짜 lint → fix → lint → fix → lint → ... (LINT_CHECK 3회 등록) → 핑퐁 발화

## 본 프로젝트 측 조치

- 본 이슈(ISS-017)는 분석 완료 + COMPLETED.
- `success_patterns`에 "GENERATE_CODE 정상 3종 파생" 패턴 학습 기록.
- 룰 수정은 글로벌 GH_Harness 레포 작업 영역 — 별도 이슈로 등록 권고
  (META_RULE_REFINE-001).

## Karpathy 원칙

- **#1 Think Before Coding**: 단순 카운트 → 액션 트리거 전에 분류 검증을 했어야 함.
- **#2 Simplicity**: 룰이 너무 단순하면 정상도 비정상으로 잡힘 (false positive).
- **#4 Goal-Driven**: 핑퐁의 진짜 목표 = "동일 작업 무한 반복 차단", 단순 fanout 제한 아님.
