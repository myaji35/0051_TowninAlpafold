# 데이터 무결성 진단 — ISS-018

**이슈**: ISS-018 (P2, DATA_INTEGRITY) — auto-detect.sh 자동 감지
**작성일**: 2026-05-03
**범위**: 진단/문서화/UI 가시화 (실데이터 발급은 REAL_DATA_INGEST-001로 분리, 현재 DEFER)

## 핵심 결과

| 지표 | 값 |
|---|---|
| 전체 동 | 130개 |
| `real_data_attached=True` | **0 (0%)** |
| `polygon_geo` 보유 | **0 (0%)** |
| `real_adm_nm + real_adm_cd` 보유 | **0** |
| `match_distance_km` 보유 | 0 |
| 레이어 수 (동당) | 40종 (메타에는 27이라 적혀있으나 실제 40) |
| `meta.version` | `v0.7-partial-real` |
| `meta.real_data_sources` | **None** (비어있음) |

## 가장 결정적인 발견

**`simula_data_real.json`과 `simula_data.json`은 완전히 동일한 데이터다.**

같은 동(`강남구 A1동`)의 40개 레이어 전수 비교 결과 **40/40 동일** (배열까지 정확히 일치). 즉:

- 파일명에 "real"이 붙어있고 version 라벨이 `v0.7-partial-real`이지만
- 내용은 **합성 데이터(simula)와 100% 같음**
- `etl_real_data.py` (310줄)는 작성되어 있으나 실제로 실데이터를 부착한 적이 한 번도 없음

## UI 라벨링의 거짓말

이전 코드 (`app.js:149-151`):
```js
const modeBadge = DATA_MODE === 'real'
  ? `<span style="color:#5BC0EB">REAL POLY</span> · ${realCount}/${DATA.dongs.length} 동`
  : `SIMULA only`;
```

`DATA_MODE === 'real'`은 단지 *파일명이* `simula_data_real.json`인지 여부였고, `realCount`가 0이어도 "REAL POLY · 0/130 동" 식으로 표시됨. **사용자는 화면에서 'REAL'을 보지만 실제로는 합성 데이터.**

## 정정 (이번 커밋에서 적용)

| 부착 비율 | 라벨 | 색 |
|---|---|---|
| ≥ 80% | `REAL POLY` | `#5BC0EB` (cyan) |
| > 0%, < 80% | `PARTIAL REAL` | `#FED766` (yellow) |
| **= 0%** | **`SIMULA · 0% real`** | **`#C9485B` (red, ISS-018 링크 hover)** |

또 Decide 모드 트리 패널 하단에도 "합성 데이터 위 학습 — 실데이터 도입 시 정확도 변동 예상"
카피 추가. 매트릭스에는 이미 같은 카피가 있음 (CORR_VARIANCE-001 작업).

## 시나리오 분포 (참고)

130개 동의 합성 시나리오 분포:
- premium 21 / traditional 20 / residential 20 / rising 17 / youth 15
- stable 11 / industrial 10 / developing 10 / rising_star 4 / rising_twin 2

이는 trees와 매트릭스에서 본 값들의 출처. 실데이터 도입 시 이 분포가 자연스럽게 바뀔 것이며,
디시전 트리 정확도(현재 76.2%) 또한 변동 예상.

## 권고 사항 (행동)

### 즉시 (이 커밋)
- ✅ UI 라벨 정정 (SIMULA · 0% real)
- ✅ Decide 트리 패널에 simula 한계 카피
- ✅ docs/data-integrity-diagnosis.md (본 문서)

### 단기 (DEFER 해제 시)
- REAL_DATA_INGEST-001 (현재 CLOSED) 재오픈 → SGIS API 키 발급 + ETL 작동
- `extract_polygons.py` 실행 → `polygon_geo` 부착
- `meta.version` 정직하게 `v0.7-simula-only`로 라벨링

### 중장기
- Karpathy #4 Goal-Driven 목표: `real_data_attached >= 80%` 달성 후 트리/매트릭스 재학습
- 실데이터 부착 시 매트릭스 변별력 회복 검증 (`stdev(|r|) >= 0.15`)
- 신뢰도 배지가 자동으로 PARTIAL → REAL POLY로 전이되는지 확인

## Karpathy 원칙 적용

- **#1 Think Before Coding**: 가정 명시 — "real" 라벨이 거짓이었다는 사실을 먼저 표면화.
- **#2 Simplicity First**: ETL 신규 구축은 본 이슈 범위 밖. 진단/라벨링만.
- **#3 Surgical**: app.js 5줄 수정 (modeBadge 분기) + index.html 1줄 + 신규 문서 1개.
- **#4 Goal-Driven**: "사용자가 화면에서 데이터 신뢰도를 0.5초 안에 알 수 있다"가 검증 기준.

## 자동 감지 시스템의 가치 검증

ISS-018은 사람이 발견한 게 아니라 `auto-detect.sh` (S2: 실데이터 부착 비율 < 80%)가 자동 감지했다.
대표님이 "REAL POLY"를 화면에서 보고 안심하던 상태에서, 자동 감지가 침묵을 깨뜨렸다.

이는 직전에 도입한 자동 이슈 감지 시스템의 첫 의미있는 발견이며, 이 시스템 가치의 증거다.
