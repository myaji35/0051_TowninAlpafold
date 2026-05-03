# TowninAlpafold

**Townin × AlphaFold** — 도시 상권/인구/예측 데이터를 단백질 구조 시각화 메타포(pLDDT 신뢰도 + p10~p90 cone)로 분석하는 4-모드 콘솔.

## 4 모드

| 모드 | 역할 | 진입 화면 |
|---|---|---|
| **Gallery** | 12 주제 카드 갤러리 (성수동 부상, pLDDT 하락 경고 등) | 시작 화면 |
| **Explore** | 동 단위 지도 + 호흡 차트 (cone) | `switchMode('explore')` |
| **Analyze** | GeoJsonLayer로 pLDDT 색상 매핑 + 시계열 | `switchMode('analyze')` |
| **Decide** | 미래 cone (p10~p90) + 의사결정 카드 | `switchMode('decide')` |

## 데이터 파이프라인

```
data_raw/  ─→ etl_real_data.py  ─→ simula_data_real.json
                                         │
forecast_prophet.py  ─→ forecasts.json  ─┤
                                         ├─→ index.html (app.js, 3700 lines)
causal_extract.py    ─→ causal.json     ─┤
                                         │
extract_polygons.py  ─→ (geojson)       ─┘
```

| 스크립트 | 역할 |
|---|---|
| `etl_real_data.py` | 원본 데이터 → simula 표준 스키마 |
| `simula_generate.py` | 합성 데이터 생성 (개발용 폴백) |
| `forecast_prophet.py` | Prophet 시계열 예측 → p10/p50/p90 cone |
| `causal_extract.py` | 인과 관계 그래프 추출 |
| `extract_polygons.py` | 행정동 polygon 추출 |

## 검증 (Playwright)

모든 검증 스크립트는 `localhost:8765`의 정적 서버를 가정합니다.

```bash
# 1) 의존성 설치
npm install
npx playwright install chromium

# 2) 정적 서버 (별도 터미널)
python3 -m http.server 8765

# 3) 통합 검증
npm run verify:all       # 6개 스위트 순차 실행

# 또는 개별
npm run verify:v07       # 데이터 로드 + GeoJsonLayer
npm run verify:cdd       # cone 표시 (Explore/Decide/Gallery)
npm run verify:causal    # 인과 시각화
npm run verify:p2        # Causal Graph
npm run verify:prophet   # Prophet cone
npm run verify:responsive # 1480/1920/2560 반응형
```

`verify_all.mjs`는 :8765에 서버가 없으면 내장 정적 서버를 자동 기동합니다.

## pLDDT 색상 체계 (AlphaFold 기준)

| 신뢰도 | 색상 | hex |
|---|---|---|
| ≥ 90 | 짙은 파랑 | `#00529B` |
| 70~89 | 하늘 | `#5BC0EB` |
| 50~69 | 노랑 | `#FED766` |
| < 50 | 빨강 | `#C9485B` |

이 체계는 코드(`app.js`)와 `.claude/brand-dna.json` 양쪽에 정의되어 있으며 **임의 변경 금지** (anti-pattern).

## Harness 운영

이 프로젝트는 [GH_Harness](https://github.com/) 자율 실행 시스템으로 관리됩니다.

```
.claude/issue-db/registry.json   # 이슈 레지스트리
.claude/hooks/                   # 자동화 hook (symlink → harness-core)
.claude/brand-dna.json           # 디자인 토큰 / pLDDT 팔레트
.claude/CLAUDE.md                # 프로젝트 자율 실행 규칙
```

## 디렉터리 구조

```
.
├── app.js                  # 콘솔 본체 (Gallery/Explore/Analyze/Decide)
├── index.html              # 메인 진입점
├── manual.html             # 사용자 매뉴얼
├── report_v07_alpha.html   # v0.7 알파 리포트
├── *.py                    # ETL / 예측 / 인과 / polygon
├── verify_*.mjs            # Playwright 검증 스위트 6종
├── verify_all.mjs          # 통합 진입점
├── capture_screens.mjs     # 자동 스크린샷
├── data_raw/               # 원본 데이터
├── docs/                   # 문서 (audience/brand/ui-snapshots)
├── screenshots/            # 검증 산출물
├── package.json
└── .claude/                # Harness
```

## 버전

`0.7.0` (v0.7 알파)
