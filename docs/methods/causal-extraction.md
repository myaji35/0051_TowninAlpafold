# 인과 추출 (Causal Driver Identification)

## 개요
관찰 데이터에서 후보 변수 간 통계적 종속성을 측정하고, 다중 비교 보정을 거쳐 Top-K 잠재 인과 변수를 보고한다.

## 절차
1. 후보 변수 페어 (X_i, Y) 모두에 대해 Pearson r 계산
2. Fisher 변환으로 z-statistic + 양측 p-value
3. Bonferroni 보정 — α / m 적용 (m = 비교 수)
4. 보정 후 p < 0.05 인 페어만 보고
5. 효과 크기(|r| ≥ 0.3) 추가 필터

## 한계
- 관찰 데이터 — 인과 방향 식별 불가 (Granger 인과성으로 보강 가능, 본 시스템 미적용)
- 잠재 교란 변수 통제 안 됨 — 결과는 "후보 인과 가설"
- 시계열 자기상관 — pre-whitening 미적용 시 p 과대평가 위험
