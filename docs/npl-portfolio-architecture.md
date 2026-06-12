# NPL 포트폴리오 분석 아키텍처 — 5만 건 규모

> 작성: 2026-06-12 · 클라이언트 목표: **국내 약 5만 건 NPL 물건 관리**
> 목적: 물건 투입 → 포트폴리오 분석 → **자산 평가의 객관성 시각화** → 리포트
> 데이터 유입: **개별 입력 + CSV 일괄 혼용** (대표님 결정)

## 0. 핵심 결론

5만 건은 **localStorage(브라우저) 한계를 넘는다.** 다행히 이 프로젝트엔 이미
**FastAPI + SQLite(WAL) + 토큰인증 + 배치큐**가 있고, SQLite는 5만 건(수백만 행)을
가볍게 처리한다. 따라서:

- **저장/집계는 서버**(SQLite 테이블 + SQL 집계), 프론트는 페이지네이션/필터만.
- **객관성 = 모집단 백분위.** "IRR 16.7%"가 아니라 **"5만 건 중 상위 23%, 동급 8,200건 중 상위 15%"**.
  단일 평가보다 모집단 분포 위에서 훨씬 설득력 있다. 이 프로젝트의 cone/pLDDT 메타포가 5만 건 분포 위에서 빛난다.

## 1. 객관성을 만드는 4개 축 (시각화 설계의 중심)

자산 평가가 "주관적 한 점"이 아니라 "근거를 가진 분포"임을 보여주는 4가지:

| 축 | 의미 | 시각화 | 데이터 소스 |
|---|---|---|---|
| **① 불확실성 cone** | 회수액이 점이 아닌 p10~p90 구간 | recovery_cone / hold_cone (기존 scorer) | npl-buy/sell-scorer.js ✅ |
| **② 기여도 분해(SHAP)** | "왜 이 평가가 나왔나" driver별 | shap_drivers 막대 (기존) | npl-sell-scorer.js ✅ |
| **③ 모집단 백분위** | 5만 건 중 이 물건의 위치 | 분포 히스토그램 + 마커 | **신규: 서버 SQL 집계** |
| **④ 신뢰도(pLDDT)** | 입력 완전성 기반 평가 신뢰 | confidence 4단계 색 | 기존 + 입력 결측 반영 강화 |

→ ①②④는 기존 자산. **③(모집단 백분위)이 5만 건이 주는 새 무기**이자 핵심 신규 작업.

## 2. 데이터 모델 (SQLite)

```sql
-- 물건 원장 (5만 행)
CREATE TABLE npl_assets (
  id            TEXT PRIMARY KEY,        -- NPL-2026-00001
  portfolio_id  TEXT,                    -- 클라이언트 포트폴리오 구분
  eval_type     TEXT NOT NULL,           -- 'buy' | 'sell'
  -- 입력값 (수동/CSV 공통)
  address       TEXT,
  collateral_type TEXT,                  -- 'apt'|'officetel'|'land'|'commercial' (동급 비교 키)
  region_code   TEXT,                    -- 시군구 (동급 비교 키)
  claim_amount      REAL,                -- 청구액
  buy_price         REAL,                -- 매수가 (buy)
  appraisal         REAL,                -- 감정가
  senior_debt       REAL,                -- 선순위
  tax               REAL,
  deposit           REAL,
  book_value        REAL,                -- 장부가 (sell)
  market_quote      REAL,                -- 시장호가 (sell)
  provision_rate    REAL,
  carrying_monthly  REAL,
  -- 평가 결과 (서버에서 scorer 로직으로 산출 후 캐시 → 집계 빠르게)
  score_irr         REAL,                -- buy: IRR
  score_npv         REAL,                -- sell: 즉시매각 NPV
  grade             TEXT,                -- very_high|high|medium|low
  recovery_p10      REAL, recovery_p50 REAL, recovery_p90 REAL,
  confidence        REAL,
  source            TEXT,                -- 'manual' | 'csv' | 'api'
  created_at        TEXT, updated_at TEXT
);
CREATE INDEX idx_npl_grade  ON npl_assets(grade);
CREATE INDEX idx_npl_region ON npl_assets(collateral_type, region_code);  -- 동급 비교
CREATE INDEX idx_npl_irr    ON npl_assets(score_irr);                      -- 백분위
CREATE INDEX idx_npl_pf     ON npl_assets(portfolio_id);
```

핵심: **평가 결과를 컬럼에 캐시**한다. 5만 건 백분위/분포를 매번 재계산하지 않고
인덱스 집계로 ~ms. 입력 변경 시에만 재평가(증분).

## 3. API 설계 (기존 FastAPI 패턴 확장)

```
POST   /api/v1/npl/assets              물건 1건 등록 (개별 입력) → 평가 후 캐시
POST   /api/v1/npl/assets/import       CSV 일괄 (배치큐 재사용, 진행률 스트림)
GET    /api/v1/npl/assets              목록 — 페이지네이션 + 필터(grade/region/type/irr구간)
GET    /api/v1/npl/assets/{id}         단건 + 평가 상세
GET    /api/v1/npl/assets/{id}/comparable   ③ 모집단 백분위 (전체 + 동급)
GET    /api/v1/npl/portfolio/summary   포트폴리오 집계 (등급분포/총회수cone/위험노출)
GET    /api/v1/npl/portfolio/distribution?metric=irr   분포 히스토그램 (백분위 시각화용)
GET    /api/v1/npl/assets/{id}/report  단일 물건 리포트 데이터
GET    /api/v1/npl/portfolio/report    포트폴리오 전체 리포트 데이터
```

**백분위 SQL (객관성 ③ 핵심):**
```sql
-- 이 물건이 전체 5만 건 중 상위 몇 %인가
SELECT
  (SELECT COUNT(*) FROM npl_assets WHERE score_irr < :irr) * 100.0 /
  (SELECT COUNT(*) FROM npl_assets) AS percentile_all,
  -- 동급(같은 담보유형+지역) 중 백분위
  (SELECT COUNT(*) FROM npl_assets
     WHERE collateral_type=:ct AND region_code=:rc AND score_irr < :irr) * 100.0 /
  NULLIF((SELECT COUNT(*) FROM npl_assets
     WHERE collateral_type=:ct AND region_code=:rc), 0) AS percentile_peer;
```

## 4. 화면 설계 (3개 신규 + 기존 평가화면 연결)

### 4.1 포트폴리오 목록 (`npl-portfolio`)
- 서버 페이지네이션 테이블 (50건/페이지). 필터칩: 등급 / 담보유형 / 지역 / IRR구간 / source
- 상단 KPI: 총 건수, 등급분포 막대(very_high~low), 총 회수 cone, 평균 신뢰도
- 행 클릭 → 단건 상세 (기존 npl-buy/sell 평가화면 재사용)
- "+ 물건 등록"(개별) / "CSV 가져오기"(일괄) 버튼

### 4.2 단건 객관성 패널 (기존 평가화면 확장)
기존 IRR/추천 카드 옆에 **④ 객관성 시각화 추가**:
- 분포 히스토그램 + 이 물건 마커: "5만 건 중 ●여기 (상위 23%)"
- 동급 비교: "수도권 아파트 담보 8,200건 중 상위 15%"
- 기존 cone/SHAP/신뢰도 유지

### 4.3 포트폴리오 분석 대시보드 (`npl-portfolio-analyze`)
- 등급 분포 (columns3d 재사용)
- 회수 cone 누적 (ridgeline/violin 재사용 — 18종 엔진 활용)
- 위험 노출 히트맵 (지역 × 담보유형, heatmap 재사용)
- 신뢰도 분포 (낮은 신뢰도 물건 = 추가실사 필요 플래그)

## 5. 리포트 (report-pdf-builder skill 연동)

| 리포트 | 내용 | 트리거 |
|---|---|---|
| **단일 물건** | 평가 요약 + cone 차트 + SHAP + ④백분위 + 신뢰도 1~2장 | 평가화면 "리포트" 버튼 |
| **포트폴리오 전체** | 5만 건 요약통계 + 등급분포 + 총회수cone + 위험노출 + Top/Bottom N | 대시보드 "PDF" 버튼 |

객관성 강조 원칙: 모든 수치에 **신뢰구간(p10~p90) + 출처 + 신뢰도**를 병기. 한 점 숫자 금지.

## 6. 데이터 유입 (개별 + CSV 혼용)

- **개별**: 평가화면에서 입력 → `POST /npl/assets` → 즉시 평가 + 목록 반영
- **CSV 일괄**: 표준 템플릿(컬럼 정의 제공) → `import` → 배치큐(기존 batch_queue.py) →
  행별 평가 → 진행률 스트림 → 완료 시 목록 갱신
- **결측 처리**: 필수값(청구액/매수가 or 장부가/호가) 없으면 그 행 skip + 리포트.
  부분 결측은 confidence 하향(④ 신뢰도에 반영) = 객관성 유지

## 7. 단계별 구현 (설계 승인 후)

| Phase | 범위 | 산출물 |
|---|---|---|
| **P1** | DB 스키마 + 등록/목록 API + CSV 임포트 | npl_assets 테이블, /npl/* API |
| **P2** | 포트폴리오 목록 화면 + KPI | components/npl-portfolio.js |
| **P3** | 객관성 ③ 백분위 (단건 패널 + 분포 시각화) | comparable API + 히스토그램 |
| **P4** | 포트폴리오 분석 대시보드 (18종 엔진 활용) | npl-portfolio-analyze.js |
| **P5** | 리포트 (단일 + 포트폴리오, PDF) | npl-report + report-pdf-builder |

## 8. 기존 자산 재활용률

- scorer 로직(IRR/NPV/cone/SHAP): **100% 재사용** (서버 포팅 또는 JS 유지)
- 시각화 엔진 18종: columns3d/violin/ridgeline/heatmap **재사용**
- 백엔드(FastAPI/SQLite/배치큐/토큰): **재사용** (테이블만 추가)
- 리포트 인프라(report-pdf-builder): **재사용**
- **신규 작성**: NPL API 라우터, 포트폴리오 화면 3개, 백분위 집계, CSV 임포터

→ 약 70% 재활용. 5만 건 규모지만 "처음부터"가 아니라 "기존 인프라에 NPL 레이어 추가".

## 9. 미결정 (구현 전 확인)

- CSV 표준 컬럼 — 클라이언트 보유 데이터 필드에 맞춰 확정 필요
- 동급 비교 기준 — 담보유형 + 지역(시군구)으로 충분한지, 더 세분화할지
- 5만 건 평가 모델 정합성 — 현재 scorer의 낙찰가율/할인율 가정이 실제 포트폴리오와 맞는지 캘리브레이션
