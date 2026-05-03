# Workflow → Explore/Decide 도메인 규칙

**대상 코드**: `app.js` `applyWfToMode(mode)`, `applyWfToAnalyze()`
**파생 이슈**: ISS-012 (DOMAIN_ANALYZE) — 부모 GRAPHRAG_PHASE2_FINISH-001
**작성일**: 2026-05-03

## 핵심 규칙

### R1. 워크플로우의 `src_dong` 노드 → `selectedDong` 매핑

**규칙**: Workflow 모드에서 "Explore로 보내기" 또는 "Decide로 보내기" 클릭 시,
활성 워크플로우(`WORKFLOWS[activeWorkflowId]`)에서 `lib_id === 'src_dong'` + `params.select` 가
설정된 첫 노드를 찾아 `DATA.dongs` 에서 매칭되는 동을 `selectedDong`으로 설정한다.

**매칭 우선순위**:
1. `name` 정확 일치 (예: `params.select === '성수1가1동'` → `d.name === '성수1가1동'`)
2. `name` 부분 일치(`includes`) — 빌트인 워크플로우의 별칭(예: `'성수1가1'`) 허용

**없을 때**: `selectedDong`을 변경하지 않고 모드만 전환 (사용자가 이전에 선택한 동 유지).

### R2. 모드 전환은 데이터 매핑 후 즉시

`switchMode(mode)` 호출은 `selectedDong` 갱신 **이후**에 실행. 이는 Explore의
`drawExploreTrace()` / Decide의 `renderDecide()`가 mode 전환 시 자동 호출되므로
순서가 어긋나면 이전 동의 그래프가 잠깐 보였다가 갱신되는 깜빡임을 막기 위함.

### R3. 다중 `src_dong` 처리 (현재: 첫 번째만)

빌트인 워크플로우 일부(예: `sungsu_busan_compare`)는 `src_dong`을 2~3개 갖는다.
**현재 정책**: 첫 번째 노드만 사용 (단일 동 모드).
**향후 규칙(미구현)**: 다중 동 비교가 의미를 갖는 모드(Compare, Causal national)는
모든 `src_dong`을 활성 컨텍스트로 전달.

### R4. `applyWfToAnalyze` 와의 차이

| 함수 | 매핑 | 모드 |
|---|---|---|
| `applyWfToAnalyze()` | `src_layer.params.height/color`, `viz_heat/viz_map.params.mode` → 셀렉터 갱신 | analyze (지도 컬러 매핑) |
| `applyWfToMode('explore')` | `src_dong.params.select` → `selectedDong` | explore (단백질 호흡 차트) |
| `applyWfToMode('decide')` | `src_dong.params.select` → `selectedDong` | decide (Prophet cone) |

세 함수는 **서로 독립적**이며, 같은 워크플로우라도 어떤 화면으로 보내느냐에 따라
다른 부분(레이어 vs 동)을 추출한다.

## 시나리오 커버리지

| 시나리오 | PASS/FAIL | 근거 |
|---|---|---|
| `sungsu_rise` 워크플로우 → Explore | PASS | `verify_workflow.mjs` 5a, currentMode === 'explore' |
| 같은 워크플로우 → Decide | PASS | 5b, currentMode === 'decide' |
| 사용자 생성 워크플로우(src_dong 없음) → Explore | (정의됨, 미테스트) | R1 fallback 경로 |
| `WORKFLOWS[id]` 미정의 → 클릭 | NO-OP | 가드: `if (!wf || !DATA) return` |

## 엣지 케이스 / Anti-pattern

- ❌ `src_dong.params.select`가 데이터에 없는 동명일 때 → 현재는 `selectedDong` 미변경(R1 fallback). Future: 토스트 경고 표시.
- ❌ Workflow 모드 진입 전 `WORKFLOWS` 미초기화 상태에서 클릭 → 가드로 NO-OP. 버튼 비활성화는 미구현.
- ❌ Explore/Decide의 차트가 `selectedDong` 없으면 빈 상태 — R1 fallback이 이전 동을 유지하므로 통상은 빈 상태가 안 나오지만, 첫 진입에 워크플로우 → 모드 전환 직행 시 가능.

## 검증 (이 규칙이 깨지면 잡히는 신호)

1. `verify_workflow.mjs` 6/6 PASS — 매 회귀에 자동 실행 (verify_all에 포함)
2. 콘솔 에러 없음 — `page.on('pageerror')` 에러 캡처
3. `applyWfToMode` 본체 5줄 — 새로 분기를 추가하면 본 문서를 갱신할 것

## Karpathy 원칙과의 합의

- **#2 Simplicity**: 5줄 함수, src_dong만 처리 (다중 동/상호작용은 미래 작업).
- **#3 Surgical**: 기존 `applyWfToAnalyze`는 건드리지 않고 신규 함수 추가.
- **#4 Goal-Driven**: acceptance #1 "Explore/Decide 모드와 연동" → `verify_workflow.mjs` 5a/b PASS로 검증됨.
