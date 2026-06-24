# NPL 평가엔진 백테스트 방법론 및 결과

> **⚠ 현 상태 명시**: 실 경매결과 데이터 부재 → 합성 ground truth로 프레임워크 검증 단계.
> 실데이터 백테스트는 보유 7.7조 리스트 중 경매완료분 입수 후 수행 예정.

---

## 1. 왜 백테스트가 필요한가

NPL 투자 의사결정의 핵심은 "모델이 예측한 회수금이 실제 경매에서 얼마나 실현되는가"이다.  
CEO 검토에서 "가장 위험한 가정"으로 지목된 항목은 **지역×담보유형 낙찰가율(npl_auction_rates.py)**이다.

백테스트는 이 가정의 정확도를 3가지 차원으로 측정한다:

| 측정 차원 | 지표 | 의미 |
|---|---|---|
| 점추정 정확도 | MAE, RMSE, bias | p50 예측이 실제와 얼마나 가까운가 |
| 구간 보정 | coverage_rate | p10~p90 구간이 실제를 80% 커버하는가 |
| 체계적 편향 | global_correction | 모델이 낙관/비관 방향으로 일관되게 틀리는가 |

---

## 2. 현 상태 — 데이터 제약과 접근 방법

### 데이터 현황 (2026-06)
- `data_raw/_npl/portfolio_demo.json` 80건: **예측값(output)만 존재**. 실제 낙찰가/회수결과 없음.
- 보유 7.7조 NPL 리스트: 미상각/진행중. 경매완료분 식별 후 실데이터 확보 필요.

### 2단계 접근
1. **현재 (프레임워크 검증)**: 합성 ground truth로 측정 엔진 자체의 정확성 확인
2. **실데이터 도착 후 (실 백테스트)**: `backtest()` + `coverage_calibration()` + `derive_correction()` 재실행

> ⚠ 이 문서의 수치는 모두 합성 ground truth 기반. 실데이터 검증 통과로 해석 금지.

---

## 3. 백테스트 프레임워크 구성 (`backend/npl_backtest.py`)

### 핵심 함수

```python
make_ground_truth(items, scored, seed, noise_std)
  → actual_auction_rate, actual_recovery를 합성 부여
  → noise_std=0: 완벽예측 sanity check 모드
  → crash_prob=5%: 부동산 하락 극단 시나리오 포함

backtest(actuals)
  → MAE, RMSE, bias, MAE_pct
  → 담보유형별 / 지역권역별 오차 분해

coverage_calibration(actuals)
  → p10~p90 구간 커버리지 (목표 ≈ 80%)
  → p50 위/아래 분포 (이상적: 각 50%)

derive_correction(actuals)
  → 체계적 편향 감지 시 보정계수 (actual/predicted 평균 비율)
  → 담보유형별 × 지역권역별 보정 행렬

run(n, seed, noise_std)
  → 위 전체 파이프라인 실행 + 보고서 dict 반환
```

---

## 4. 합성 검증 결과 (프레임워크 정확성 확인)

### 4-1. 기본 시나리오 (n=2,000, noise_std=0.08)

| 지표 | 값 | 해석 |
|---|---|---|
| MAE | 34,135 만원 | 예측 p50 대비 평균 절대 오차 |
| RMSE | 59,477 만원 | 극단 오차(5% crash) 영향 반영 |
| bias | +7,018 만원 | 소폭 낙관편향 (noise 분포상 정상) |
| MAE_pct | 11.1% | 실제 회수금 대비 상대 오차 |
| **coverage_rate** | **84.4%** | p10~p90이 실제를 84% 커버 (목표 80% 초과 ✅) |
| above_p50 | 46.4% | 실제가 p50 위에 분포 (이상적 50%에 근접 ✅) |
| below_p10 | 7.0% | 실제가 p10 미만 (5% crash + α — 정상 범위) |
| global_correction | 0.9795 | 균형 (1.0에서 ±3% 이내 = 편향 없음 ✅) |

### 4-2. Sanity Check (noise_std=0, n=500)

노이즈를 0으로 주면 예측=실제가 되므로 아래 결과가 나와야 함:

| 지표 | 기대값 | 실제값 | 판정 |
|---|---|---|---|
| MAE | 0 만원 | **0 만원** | ✅ |
| coverage_rate | 100% | **100.0%** | ✅ |
| global_correction | 1.0 | **1.0** | ✅ |

→ 프레임워크 자체 계산 로직 정확성 확인됨.

### 4-3. 편향 주입 테스트 (actual = predicted × 0.8)

실제값을 의도적으로 예측의 80% 수준으로 설정한 경우:

| 지표 | 기대값 | 실제값 | 판정 |
|---|---|---|---|
| global_correction | ≈ 0.8 | **0.8000** | ✅ |
| bias_direction | 낙관편향 | **낙관편향 (모델 과대평가)** | ✅ |

→ `derive_correction()`이 체계적 편향을 정확하게 잡아냄.

---

## 5. 실데이터 도착 시 실행 절차

### 필요한 데이터 컬럼

| 컬럼명 | 타입 | 설명 | 예시 |
|---|---|---|---|
| `item_id` | str | 물건 ID (portfolio_demo.json의 id와 매핑) | "NPL-MOCK-000001" |
| `actual_auction_date` | str | 실제 낙찰일 (YYYY-MM-DD) | "2026-03-15" |
| `actual_auction_price` | int | 실제 낙찰가 (만원) | 85000 |
| `actual_recovery` | int | 실제 회수금 (낙찰가 - 경매비용 - 선순위 차감, 만원) | 78500 |
| `actual_recovery_months` | int | 실제 회수 소요 개월 수 | 14 |

### 실행 방법

```python
from backend.npl_backtest import backtest, coverage_calibration, derive_correction

# 실데이터 형식 (예시)
actuals_real = [
    {
        "id": "NPL-MOCK-000001",
        "actual_recovery": 78500,           # 실제 회수금 (만원)
        "predicted_p10": 35381,             # 평가엔진 예측값 그대로
        "predicted_p50": 57834,
        "predicted_p90": 81050,
        "region_tier": "capital",
        "collateral_type": "apt",
        "gt_source": "real",                # ← 실데이터 표시 (synthetic 아님)
        "skip": False,
    },
    # ... 추가 건
]

err = backtest(actuals_real)
cal = coverage_calibration(actuals_real)
cor = derive_correction(actuals_real)
```

### 목표 기준 (실데이터 백테스트 통과 기준 제안)

| 지표 | 목표 | 근거 |
|---|---|---|
| MAE_pct | < 15% | 실 경매 변동성 감안한 허용 오차 |
| coverage_rate | 70~90% | p10~p90이 80% 커버 (±10%p 허용) |
| global_correction | 0.90~1.10 | 체계적 편향 ±10% 이내 |

---

## 6. 투자자/LP 설명용 시사점

### 구간 커버리지(calibration)가 왜 중요한가

NPL 투자에서 단일 예측값(p50)보다 **"얼마나 나쁠 수 있는가"(p10)**가 더 중요하다.

- **p10 ~ p90 구간**: 시장 상황 변화(금리, 부동산 경기)에 따른 회수금 범위
- **coverage_rate ≈ 80%**: 실제 10건 중 8건이 이 구간 안에서 실현된다는 의미
- coverage_rate가 낮으면(< 60%): 구간이 너무 좁거나 방향 편향 → 낙찰가율 가정 재검토 필요

### 현재 모델의 불확실성 구조

```
예측 회수금:  p10 ── p50 ── p90
             (하락)  (중앙) (상승)
                |         |
           하락장 시나리오  │  상승장 시나리오
               (-25%)     │     (+15%)
```

5% 확률의 극단 하락 시나리오(crash)는 RMSE가 MAE보다 크게 나오는 이유이며,  
stress test 용도로 유지한다.

---

## 7. 향후 계획

1. **경매완료분 입수** (우선순위 P0): 보유 리스트 중 낙찰 완료된 건 실제 회수금 데이터 확보
2. **실 백테스트 실행**: `python -m backend.npl_backtest --input real_actuals.csv`
3. **낙찰가율 행렬 갱신**: 실 백테스트 결과 → npl_auction_rates.py BASE_RATE 분기 업데이트
4. **연속 모니터링**: 경매 완료 건 누적 → rolling 12개월 백테스트 자동화

---

*최종 갱신: 2026-06-24 | 담당: agent-harness | 데이터 상태: 합성 ground truth (실데이터 미입수)*
