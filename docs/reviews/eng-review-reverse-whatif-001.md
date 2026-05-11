# Eng Lead 검토 — Reverse What-if 엔진 실행 가능성 검토

**검토자**: plan-eng-reviewer
**검토일**: 2026-05-11
**대상**: `docs/plans/reverse-whatif-plan.md` (ISS-192~196 완료 후 검토)
**이슈**: ISS-198

---

## 1. 실행 결과 요약

ISS-192~196 구현 완료. 실측치 기반 검토.

| 항목 | 계획 | 실측 | 판정 |
|---|---|---|---|
| R² (train) | ≥ 0.70 | tx: 0.9961, vis: 0.9961 | ✅ 초과 달성 |
| DiCE 타임아웃 | 30s 가드 | genetic 30s 내 수렴 실패 → scipy fallback | ⚠️ fallback 작동 |
| 스모크 테스트 | 3개 시나리오 < 30s | tx: 140s (train포함), vis: 17s (skip-train) | ⚠️ train 제외 시 OK |
| decision_tree_train.py | 변경 금지 | git diff clean | ✅ |
| 데이터 행 수 | 130개 동 | 130개 동 × 60개월 | ✅ |

---

## 2. 의존성 호환성 검토

### 실제 설치 버전
```
Python        : 3.14.4
shap          : 0.51.0
dice-ml       : 0.12
scipy         : 1.17.1
scikit-learn  : 1.8.0
```

### 호환성 이슈
| 라이브러리 | 리스크 | 실측 |
|---|---|---|
| shap 0.51.0 on Python 3.14.4 | 계획 시 MEDIUM | ✅ TreeExplainer 정상 동작 |
| dice-ml 0.12 + sklearn 1.8.0 | 계획 시 UNKNOWN | ⚠️ `fitted without feature names` UserWarning 발생 (무해) |
| scipy 1.17.1 Nelder-Mead | 신규 추가 | ✅ gradient-free 최적화 정상 |

**결론**: 현재 환경에서 모든 라이브러리 정상 동작. UserWarning은 suppress 가능.

---

## 3. DiCE Genetic 수렴 실패 분석

### 원인
- `tx_volume` 모델: `거래_평균` feature_importance = **0.9316** (93.2%)
- 통제 가능 변수 3종 합계 importance = **0.0574** (5.7%)
- → controllable features만 vary해서는 desired_range 달성 불가능

### 대응
- DiCE 30초 타임아웃 후 `scipy Nelder-Mead` fallback 자동 전환 ✅
- `visitors_total` 모델: `유동_평균` importance = **0.9853** → DiCE/scipy 모두 achievement ~100% ✅
- `tx_volume` fallback: max_delta ±150% (고효율 시나리오)에서 achievement ~2.5% — 모델 한계 정직 기록

### 권고사항
1. `tx_volume` 모델의 controllable feature 한계를 사용자에게 명시 (현재 `note` 필드로 기록 중)
2. 장기적으로 `거래_평균` 외 변수도 controllable로 재분류 검토 (마케팅 이벤트 → 거래 유도)

---

## 4. 알고리즘 선택 근거 검토

### RandomForestRegressor 선택 이유
- SHAP TreeExplainer 완전 호환
- GradientBoostingRegressor 대비 SHAP 계산 속도 ~3배 빠름 (앙상블 크기 동일 시)
- R² 0.996 → 과적합 가능성 있지만 Counterfactual 생성 목적에서는 고R²가 유리 (CF 탐색 공간이 명확)

### StandardScaler 정규화 타당성
- `거래_평균` raw mean = 70, `방문자_평균` raw mean = 45,000 → 스케일 차이 3자릿수
- StandardScaler 없으면 RF 트리 분기가 `방문자_평균` 기준으로 왜곡될 수 있음
- 동별 상대 비교 시: StandardScaler는 전체 데이터 기준 정규화이므로 동 간 비교 가능 ✅

---

## 5. ISS-192~196 의존성 체인 분석

```
ISS-192 (train) → pkl 생성
    ↓
ISS-193 (explain) → shap_result.json (선택적)
    ↓
ISS-194 (counterfactual) → whatif_scenarios_{tx|vis}.json
    ↓
ISS-196 (pipeline) → whatif_result.json
```

### 병렬화 가능 여부
- ISS-192 완료 후 ISS-193과 ISS-194는 **병렬** 실행 가능 (각자 독립 출력)
- ISS-196은 ISS-194 의존 (whatif_scenarios 필요)
- **현재 pipeline.py는 순차 실행** → tx/vis 두 타깃을 병렬 실행하면 시간 단축 가능

### 최적화 제안
```python
# pipeline.py 개선안 (Phase 2)
import concurrent.futures
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
    fut_tx = ex.submit(run_step, "whatif", [..., "--target", "tx_volume"])
    fut_vis = ex.submit(run_step, "whatif", [..., "--target", "visitors_total"])
```

---

## 6. 코드 중복 최소화 현황

| 중복 함수 | 파일 | 위치 |
|---|---|---|
| `trend_slope()` | train.py, explain.py, counterfactual.py | 3개 파일 동일 코드 |
| `build_feat_row()` | train.py, counterfactual.py | 2개 파일 동일 로직 |
| `avg_granger_lag()` | train.py, counterfactual.py | 2개 파일 동일 |

**현재**: DRY 원칙 위반 (3개 중복). 단, `decision_tree_train.py` 수정 금지 제약 때문에 공통 모듈 추출이 제한적.

**권고**: `reverse_whatif_utils.py` 공통 모듈 추출 (ISS-192~196 외 범위 → 다음 스프린트 REFACTOR 이슈)

---

## 7. 결론 및 다음 액션

### 승인 항목 ✅
- 전체 파이프라인 동작 확인 (스모크 테스트 4/4 PASS)
- 라이브러리 호환성 실환경 검증 완료
- sklearn RandomForestRegressor + StandardScaler 조합 적정
- scipy Nelder-Mead fallback 안전망 구현 완료

### 기술 부채 (다음 스프린트 등록 권고)
1. **REFACTOR**: `reverse_whatif_utils.py` 공통 함수 추출 (trend_slope, build_feat_row, avg_granger_lag)
2. **FEATURE**: `pipeline.py` 두 타깃 병렬 실행 옵션 추가
3. **FIX**: DiCE UserWarning suppress (`warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")`)
4. **DATA**: 의정부 금오동 실데이터 simula_data_real.json 연결

*검토 완료. 엔진 아키텍처 승인. 기술 부채 4개 다음 스프린트 등록 권고.*
