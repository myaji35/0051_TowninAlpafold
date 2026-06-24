# NPL 평가 SaaS — 설계 문서

> 버전: v1.0 | 2026-06-24

---

## 1. 전략 가치 (CEO 통찰)

| 가치 축 | 내용 |
|---|---|
| **규제 없는 즉시 매출** | NPL 평가 자문은 금융투자업 인가 불요. API 형태로 데이터·로직 제공은 정보서비스업 범주. 인허가 대기 없이 즉시 과금 시작 가능. |
| **데이터 피드백 루프** | 외부 고객 평가 요청 물건 데이터(opt-in·익명화 전제)가 자사 평가 모델 정밀도 개선에 환류 → 사용자 증가 = 엔진 정밀도 증가 = 고객 유치력 증가 (플라이휠). |
| **앵커 투자자 후보 확보** | 대형 저축은행·AMC가 API 고객이 되면 자연스럽게 RWA 토큰화(P3/P4 단계) 앵커 투자자로 전환 가능. SaaS↔투자자 교차 전환 경로 — `npl-anchor-investor-gtm.md` 참조. |

---

## 2. 멀티테넌트 아키텍처

```
[외부 고객사]
    │
    │  POST /saas/v1/evaluate
    │  Header: X-Api-Key: sk-npl-xxxxx
    │
    ▼
[require_tenant()]
  ├─ SHA-256(X-Api-Key) 계산
  ├─ saas_tenant WHERE api_key_hash=? AND status='active'
  ├─ 없음 → 401 Unauthorized
  └─ 있음 → tenant dict 반환 (tenant_id, plan, opt_in 포함)
         │
         ▼
  [record_usage()]
    ├─ 플랜 월간 한도 체크 → 초과 시 429
    ├─ saas_usage INSERT (tenant_id, endpoint, cost, ts)
    └─ commit
         │
         ▼
  [npl_scorer.evaluate()]  ← V1+V4 엔진 그대로
    └─ 결과 반환 (grade, IRR/NPV, recovery_cone, confidence)
         │
         ▼
  [_record_contribution()]  (opt-in만)
    └─ 비식별 해시만 saas_data_contribution에 기록
```

### 테넌트 격리 방식
- **키 격리**: API 키 해시 매칭으로 테넌트 식별. 타 테넌트 키로는 본인 데이터 조회 불가.
- **데이터 격리**: `/saas/v1/usage`, `/saas/v1/billing` 엔드포인트는 `WHERE tenant_id=?` 강제 적용. 조인·서브쿼리로 타 테넌트 데이터 우회 불가능(tenant_id는 인증에서 주입, 요청 파라미터 아님).
- **관리자 분리**: 테넌트 발급은 `X-Admin-Secret` 별도 헤더. 테넌트 API 키로는 발급 불가.

---

## 3. API 키 보안

| 단계 | 처리 |
|---|---|
| 발급 | `secrets.token_urlsafe(32)` → 평문 `sk-npl-xxx` 생성 |
| 저장 | `SHA-256(평문)` 해시만 DB 저장. 평문은 저장 안 함. |
| 반환 | 발급 시 응답에 **1회만** 포함. 이후 재조회 불가. |
| 인증 | 요청의 `X-Api-Key` → SHA-256 → DB 조회. 레인보우 테이블 공격 불가(랜덤 32바이트 salt 역할). |

---

## 4. 과금 플랜

| 플랜 | 월 한도 | 월 구독료 | 건당 단가 | 대상 |
|---|---|---|---|---|
| **free** | 100건 | 무료 | 0원 | 테스트·소형 법무법인 |
| **pro** | 5,000건 | 150,000원 | 500원 | 중형 저축은행·AMC |
| **enterprise** | 무제한 | 2,000,000원 | 200원 | 대형 금융사·NPL 전문투자사 |

### 과금 계산식
```
월 청구액 = monthly_fee + (billed_units × price_per_unit)

예) pro, 200건 평가:
  = 150,000원 + (200건 × 500원)
  = 150,000 + 100,000 = 250,000원
```

### 한도 초과 처리
- `monthly_limit > 0` 플랜: 한도 도달 시 `429 Too Many Requests` + 업그레이드 안내
- `enterprise` (`monthly_limit = 0`): 한도 없음

---

## 5. 데이터 환류 플라이휠

```
외부 고객 평가 요청
    │
    ▼
(opt-in 동의 + 약관 서명 — T2)
    │
    ▼
비식별 해시 기록
(region_code + collateral_type + eval_type → SHA-256)
원본 수치 미저장
    │
    ▼
자사 평가엔진 학습 개선 파이프라인 (향후)
  ├─ 지역×유형별 낙찰가율 행렬 정밀화 (V1 엔진)
  ├─ 소액임차 공제 분포 업데이트 (V4 엔진)
  └─ 신뢰도 보정 계수 조정
    │
    ▼
평가 정밀도 ↑ → 고객 유치력 ↑ → 사용량 ↑ → 데이터 ↑ (플라이휠)
```

### 개인정보·영업비밀 보호 장치
| 보호 대상 | 조치 |
|---|---|
| 물건 주소 | 기여 데이터에 포함 않음 (region_code 시군구 코드만) |
| 채권 금액·매입가 | 기여 데이터에 포함 않음 |
| 고객사 거래 패턴 | tenant_id는 기여 해시와 별도 관리, 집계 시 분리 |
| opt-in 강제 | `opt_in_data_contribution=False`가 기본값. 동의 없으면 기여 기록 자체 없음. |

---

## 6. 타겟 고객 및 교차 전환

| 고객 유형 | SaaS 활용 | RWA 전환 경로 |
|---|---|---|
| NPL 전문투자사 | 매수 평가 API (IRR 산출 자동화) | 자체 포트폴리오 → 토큰화 앵커 |
| 저축은행 | 매도 평가 API (NPV 즉시 계산) | 부실채권 토큰화 위탁 |
| AMC | 대량 CSV 임포트 + 포트폴리오 요약 | 공동 SPC 구성 |
| 법무법인 | 소액임차·권리분석 결과 (V4) | 투자 자문 → 소개 수수료 |

---

## 7. DB 스키마 요약

```sql
saas_tenant (
  id, name, api_key_hash,       -- 테넌트 식별·인증
  plan, status,                  -- 과금·상태
  opt_in_data_contribution,      -- 환류 동의 (0/1)
  created_at, updated_at
)

saas_usage (
  id, tenant_id, endpoint,
  billed_units, cost, ts         -- 과금 원장 (불변 추가 전용)
)

saas_data_contribution (
  id, tenant_id, asset_hash,     -- 비식별 해시만
  eval_type, contributed_at
)
```

---

## 8. T2 항목 (구현 전 외부 검토 필요)

| 항목 | 카테고리 | 필요 조치 |
|---|---|---|
| **결제 PG 연동** | EXTERNAL | 카드·계좌이체 PG사 계약 (나이스페이·토스페이먼츠 등) |
| **데이터 환류 약관** | SECURITY/LEGAL | 법무 검토 후 고객사 서면 동의 수집. 현재 코드는 opt-in 플래그만 구현. |
| **외부 SLA** | EXTERNAL | 99.9% uptime 보장 시 인프라 이중화·모니터링 확정 필요 |
| **구독 해지·환불 정책** | DIRECTION | 결제 시작 전 정책 확정 |
| **API 키 로테이션 API** | SECURITY | 키 유출 시 재발급 엔드포인트 (현재: 관리자 수동 재발급) |

---

## 9. 엔드포인트 요약

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/saas/v1/tenants` | X-Admin-Secret | 테넌트 발급 + 키 반환 |
| POST | `/saas/v1/evaluate` | X-Api-Key | 매수/매도 평가 (건당 과금) |
| GET | `/saas/v1/usage` | X-Api-Key | 본인 사용량 조회 (테넌트 격리) |
| GET | `/saas/v1/billing` | X-Api-Key | 월간 청구 요약 |
