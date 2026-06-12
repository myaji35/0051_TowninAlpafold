# NPL 일괄 임포트 CSV 템플릿

> `POST /api/v1/npl/assets/import` 에 업로드하는 CSV 형식.
> 헤더는 아래 컬럼명을 사용. 인코딩 UTF-8 (BOM 허용).
> ⚠️ 컬럼은 클라이언트 실데이터 확정 시 조정 가능 (현재는 표준안).

## 공통 컬럼

| 컬럼 | 필수 | 설명 | 예시 |
|---|---|---|---|
| `eval_type` | ✅ | `buy`(매수) 또는 `sell`(매도) | buy |
| `address` | | 담보 부동산 주소 | 의정부시 금오동 123 |
| `collateral_type` | | 담보유형 (동급 비교 키) — apt/officetel/land/commercial | apt |
| `region_code` | | 시군구 코드 (동급 비교 키) | 41150 |
| `portfolio_id` | | 포트폴리오 구분 | PF-2026-A |

## 매수(buy) 컬럼

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `claim` | ✅ | 청구액 (만원) |
| `buy_price` | ✅ | 후보 매수가 (만원) |
| `appraisal` | | 감정가 (만원) — 미입력 시 청구액×1.2 추정 |
| `senior` | | 선순위 채권 (만원) |
| `tax` | | 세금/공과금 (만원) |
| `deposit` | | 임차 보증금 (만원) |

## 매도(sell) 컬럼

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `book_value` | ✅* | 장부가 (만원) |
| `market_quote` | ✅* | 시장 호가 (만원) — 수동 호가 모드 |
| `provision_rate` | | 충당금률 (%) |
| `carrying_monthly` | | 월 보유비용 (만원) |

\* 매도는 `book_value` 또는 `market_quote` 중 최소 하나 필수.

## 결측 처리

- 필수값 없는 행 → **skip** (등록 안 됨), 응답의 `errors`에 행번호+사유 기록.
- 부분 결측(선택 컬럼) → 등록되며 `confidence`(신뢰도)에 반영 = 객관성 유지.

## 예시

```csv
eval_type,address,collateral_type,region_code,claim,buy_price,appraisal,senior
buy,서울 강남구 역삼동 1,apt,11680,90000,72000,110000,8000
buy,부산 해운대구 우동 2,apt,26350,50000,38000,62000,5000
sell,서울 송파구 잠실동 3,apt,11710,,,,
```

## 응답

```json
{ "imported": 2, "skipped": 1, "errors": [{"row": 3, "reason": "필수값 부족"}] }
```
