# Wedge 검증 방법론 — ISS-226

**작성일**: 2026-05-11  
**작성자**: agent-harness (ISS-226)  
**대상**: `wedge_data_geumo.json` (의정부 금오동, 60개월 5레이어 시계열)

---

## 섹션 1: 검증 방법론

### 배경

ISS-216에서 정의한 4타깃(tx_volume, visitors_total, tx_per_visitor, tx_delta_6m)에 대해,  
ISS-217에서 생성한 `wedge_data_geumo.json`(의정부 금오동 실데이터 wedge)을 적용하여  
시뮬레이션 결과(simula_data_real.json 기반 R² 0.92)의 실제 예측력을 검증한다.

### 옵션 B 채택 — 모델 고정, 입력(X)만 교체

단일 동(N=1)으로는 RF 모델을 학습할 수 없다 (Y 분산=0 → R²=NaN, feature_importance=0).  
따라서 다음 방식을 채택한다:

```
학습 데이터: simula_data_real.json (N=130 동, 서울/수도권)
예측 입력:   wedge_data_geumo.json (의정부 금오동, N=1)
최적화:      scipy Nelder-Mead (3 시나리오: 최소변경/균형/고효율)
```

### 파이프라인

```
wedge X 빌드
  └─ LAYERS × [평균/추세] + Granger lag
  └─ leakage 제외 (target별 규칙 동일)
        ↓
OOD 측정 (피처별 simula 범위 이탈 비율)
        ↓
simula 모델 예측 → baseline_y, target_y
        ↓
scipy 3종 최적화 → achievement_pct
        ↓
wedge_data_validation_geumo.json
```

### OOD(Out-of-Distribution) 측정 방식

각 피처 i에 대해 simula 학습 분포의 [min, max]를 구하고,  
wedge X 값이 이 범위 밖이면 이탈로 카운트:

```
ood_ratio = (이탈 피처 수) / (전체 피처 수)
```

- ood_ratio = 0: 완전히 분포 내 → 예측 신뢰 가능
- ood_ratio > 0.3: OOD → RF 외삽 한계, 예측 신뢰도 낮음
- ood_ratio > 0.8: 심각한 OOD → 예측값은 참고용 하한치

---

## 섹션 2: 4타깃 결과표

| 타깃 | 실제 wedge Y | 모델 예측 Y (baseline) | 목표 Y (+15%) | OOD 비율 | achievement_avg | all_verified |
|------|-------------|----------------------|--------------|---------|----------------|--------------|
| tx_volume | 8.148 (단위: 억원/60mo 평균) | 63.350 | 72.853 | 89% | **0.0%** | False |
| visitors_total | 18,509 명/월 | 20,287 | 23,330 | 100% | **0.0%** | False |
| tx_per_visitor | 0.000440 | 0.002576 | 0.002962 | 100% | **0.0%** | False |
| tx_delta_6m | 0.158 | 129.616 | 149.059 | 89% | **5.6%** | False |

**미달 사유 (4타깃 공통)**: 의정부 금오동이 simula 학습 분포(서울/수도권 대규모 동) 대비  
소규모 동으로, 핵심 피처(biz_count, biz_cafe, land_price)가 simula 최솟값 이하 → RF 외삽 실패

### 시나리오별 achievement (tx_delta_6m, 유일하게 5.6% 달성)

| 시나리오 | max_delta | 주요 변화 | predicted_y | achievement |
|---------|----------|---------|-------------|------------|
| 최소변경 | 20% | 유동_평균 +925억 | 130.7 | 5.6% |
| 균형 | 50% | 유동_평균 +925억 | 130.7 | 5.6% |
| 고효율 | 150% | 소상공-11.5억, 카페+0.95억, 유동+468.6억 | 130.7 | 5.6% |

tx_delta_6m이 소폭(5.6%) 달성한 이유: 이 타깃은 tx_volume 변화량(차이)이므로  
절대값 스케일 의존도가 낮고, 유동인구 변화에 미약하게 반응함.

---

## 섹션 3: 시뮬 vs Wedge 비교

| 타깃 | simula R² (학습) | wedge X OOD | wedge achievement | 실제 Y vs 모델예측 Y |
|------|----------------|-------------|-------------------|---------------------|
| tx_volume | 0.9265 | 89% | 0.0% | 8.15 vs 63.35 (× 7.8 과대) |
| visitors_total | 0.9306 | 100% | 0.0% | 18,509 vs 20,287 (+9.6%) |
| tx_per_visitor | 0.8588 | 100% | 0.0% | 0.000440 vs 0.002576 (× 5.9 과대) |
| tx_delta_6m | 0.9198 | 89% | 5.6% | 0.158 vs 129.6 (× 820 과대) |

### 핵심 발견

1. **모델예측 Y ≠ 실제 wedge Y**: 예측값이 실제보다 2~820배 과대 추정  
   → simula(서울 규모)와 wedge(의정부 읍면동)의 도시 규모 차이가 원인  

2. **simula R² 0.92는 닫힌 시스템 지표**: 130개 시뮬 동 내부에서는 유효하지만,  
   외부 실데이터에 적용하면 OOD 외삽으로 예측력 급락  

3. **visitors_total은 비교적 근접**: 예측 20,287 vs 실제 18,509 (오차 9.6%)  
   → visitors는 도시 규모 편차가 상대적으로 작음  

4. **tx_delta_6m 단위 오류 의심**: 예측 129.6 vs 실제 0.158  
   → simula의 tx_volume 단위(수십 억원)와 wedge proxy(사업체 수 변화량)의 단위 불일치가 누적됨  

---

## 섹션 4: CEO 우려(R² 0.92) 검증 결론

**결론: `confirmed` — CEO 우려가 타당하다**

| 검증 항목 | 결과 |
|---------|------|
| simula R² 0.92의 외부 데이터 적용 가능성 | ❌ 불가 — OOD 89~100% |
| wedge 실데이터로 15% 목표 달성 가능성 | ❌ 0~5.6% — 통제 불가 수준 |
| 시뮬 예측값의 절대값 신뢰성 | ❌ 2~820배 과대 추정 |
| 방향성(상대적 순위) 신뢰성 | △ simula 분포 내에서만 유효 |
| proxy tx_volume(사업체 수) 대리 타당성 | ⚠️ 단기 proxy로만 인정 가능 |

**CEO 우려의 핵심**: R² 0.92는 simula 내부 분포(130개 가상 동, 서울/수도권 규모)에서  
in-sample 성능이다. 실제 소규모 도시 동(의정부 금오동)에 적용하면:

1. X 피처 89~100%가 학습 범위 밖 → RF는 최댓값/최솟값에서 예측을 클리핑
2. 절대값 예측이 수백% 오차 → 상대적 시나리오(몇 % 개선)도 신뢰할 수 없음
3. achievement = 0%: 통제 가능 변수(소상공/카페/유동)를 20~150% 변화시켜도 모델 무반응

따라서 **CEO의 시뮬 R² 0.92 의심은 근거가 있다**.  
현재 모델은 시뮬 내부 상대 비교에만 사용 가능하고,  
절대값 예측이나 실제 동(특히 소규모)에 직접 적용은 부적절하다.

---

## 섹션 5: 한계점

### 데이터 한계

| 한계 | 상세 |
|------|------|
| **N=1 동** | 의정부 금오동 단일 동만 wedge로 검증. 통계적 일반화 불가 |
| **proxy tx_volume** | 실제 카드매출/거래 데이터 없음. biz_count 변화량으로 대리. 단위·스케일 불일치 |
| **60개월 합성 시계열** | localdata_biz / kosis_living_pop / molit_landprice 모두 `synthetic` 표시. 실제 관측값 아님 |
| **앵커값 기반 생성** | 2024-12 앵커 + 트렌드 모의. 코로나 충격, 정책 변수 미반영 |

### 모델 한계

| 한계 | 상세 |
|------|------|
| **OOD 외삽** | simula(서울/수도권, biz_count 309~2,971) vs wedge(의정부, biz_count~268). RF는 외삽 불가 |
| **단위 불일치** | simula tx_volume 단위: 억원(수십~수백). wedge tx_volume: proxy 소수 단위. /1e6 스케일 후 우연히 근접하나 의미가 다름 |
| **가장 유사한 simula 동**: 구로구 G5동, 거리 1.72 | 최근접 simula 동도 실제로 wedge와 크게 다름 (정규화 거리 1.72) |
| **in-sample R²** | 학습 데이터와 테스트 데이터가 동일(train=test). 과적합 가능성 높음 |

---

## 섹션 6: 다음 권장 작업

### 단기 (2~4주)

1. **실제 카드매출 API 연결**  
   - 공공 데이터 포털: BC카드 소비트렌드 / 삼성카드 Open API  
   - tx_volume proxy 교체 → 실제 거래 건수 또는 금액  
   - 목표: wedge tx_volume 단위를 simula와 통일

2. **의정부시 전 동(~19개) wedge 확장**  
   - 현재 N=1 → N=19로 확장  
   - OOD 비율 재측정: 의정부 분포에서 in-distribution 가능성  
   - 소규모 데이터셋 내 교차검증 가능

3. **소규모 도시 simula 재학습**  
   - 기존 simula: 서울 25개 구 중심 (biz_count 309~2,971)  
   - 추가 대상: 의정부시, 포천시, 양주시 등 경기 북부 읍면동  
   - 목표 분포: biz_count 50~400 구간 포함

### 중기 (1~2개월)

4. **분포 보정(Domain Adaptation)**  
   - CORAL / Maximum Mean Discrepancy (MMD) 등 전이학습 기법  
   - simula → wedge 도메인 갭 정량화 후 보정

5. **in-sample vs out-of-sample R² 분리 보고**  
   - 현재 R² 0.92는 train=test (in-sample). leave-one-out 또는 k-fold로 실제 성능 측정  
   - 예상: 실제 OOF R²는 0.5~0.7 구간 (simula 내에서도)

---

*검증 스크립트*: `scripts/wedge_validate.py`  
*검증 결과*: `wedge_data_validation_geumo.json`  
*관련 이슈*: ISS-226 (VERIFY), ISS-217 (wedge 데이터 생성), ISS-216 (4타깃 추가)
