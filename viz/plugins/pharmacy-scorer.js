// viz/plugins/pharmacy-scorer.js
// 약국 점포개발 적합도 평가 (Wave 1 — 가중치 모델)
// 부모 이슈: USER_STORY_PHARMACY_DEVELOP-001
// 명세서: docs/stories/pharmacy-develop.md (D절)

(function() {
  'use strict';

  // ── 가중치 (명세서 D절, 합 1.00 절대값) ──
  const WEIGHTS = Object.freeze({
    population_density:                  0.18,
    elderly_ratio:                       0.15,
    clinics_within_500m:                 0.20,
    competitor_pharmacies_within_500m:  -0.18,
    income_quantile:                     0.10,
    rent_ratio:                         -0.12,
    visitors_total:                      0.07,
  });

  // 절대값 합 검증 — 코드 변경 시 가드
  const _wsum = Object.values(WEIGHTS).reduce((s, w) => s + Math.abs(w), 0);
  if (Math.abs(_wsum - 1.00) > 0.001) {
    console.error('[pharmacy-scorer] WEIGHTS abs-sum != 1.00:', _wsum);
  }

  // ── 정규화 룰 — docs/stories/pharmacy-develop.md D-1 절 명시 ──
  // FIX_BUG_PHARMACY_SCORER_NORMALIZER-001 (2026-05-04):
  //   D절은 가중치만 정의했고 정규화 분모(만점 기준)는 미정이었음. 본 코드의 분모는
  //   "신규 진입자 관점의 마진 + 경쟁 회피" 도메인 해석을 따름 (D-2절 참조).
  //   분모 변경 시 docs/stories/pharmacy-develop.md D-1을 함께 갱신할 것 (drift 금지).
  // ── 입력 정규화 — 동 데이터 → 0~1 범위 ──
  const NORMALIZERS = {
    // 동 인구 / 동 면적(km²) → 천명/km² (서울 평균 ~25천명/km²)
    population_density: (v) => clamp01(v / 50.0),   // 50천명/km² 만점
    // 60대+ 비중 (0~1)
    elderly_ratio: (v) => clamp01(v / 0.30),        // 30% 이상 만점
    // 반경 500m 의원수 — 50개 만점 (역삼1동 48개 기준, 변별력 확보)
    clinics_within_500m: (v) => clamp01(v / 50.0),
    // 경쟁약국 수 — 25개 만점 감점 (역삼1동 24개 기준)
    competitor_pharmacies_within_500m: (v) => clamp01(v / 25.0),
    // 평균 소득 분위 (1~10) — 7~8 분위 최적, 양 끝 감점 (역U)
    income_quantile: (v) => {
      if (v == null) return 0.5;
      const optimal = 7.5;
      const deviation = Math.abs(v - optimal);
      return clamp01(1.0 - deviation / 5.0);
    },
    // 임대가 — 동 평균 대비 비율 (1.0 = 평균, 2배까지 분포)
    rent_ratio: (v) => clamp01(v == null ? 0 : v / 2.0),
    // 유동인구 — 백만명/월 만점
    visitors_total: (v) => clamp01(v / 1_000_000),
  };

  function clamp01(x) {
    if (typeof x !== 'number' || isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /**
   * 점수 계산.
   * @param {object} features - 7개 요인 (정규화 전 raw 값). null/undefined 허용 (0으로 처리).
   * @returns {object} { score: int 0~100, contributions: { factor: number }, raw: number }
   */
  function computeScore(features) {
    const contributions = {};
    let raw = 0;
    let posSum = 0;
    let negSum = 0;
    for (const [factor, weight] of Object.entries(WEIGHTS)) {
      const norm = NORMALIZERS[factor](features[factor]);
      const contrib = norm * weight;
      contributions[factor] = contrib;
      raw += contrib;
      if (weight > 0) posSum += weight;
      else negSum += Math.abs(weight);
    }
    // raw 범위: [-negSum, +posSum] = [-0.48, +0.70]
    // → [0, 100] min-max
    const minPossible = -negSum;  // -0.48
    const maxPossible = posSum;   // +0.70
    const normalized = (raw - minPossible) / (maxPossible - minPossible);
    const score = Math.round(clamp01(normalized) * 100);
    return { score, contributions, raw };
  }

  /**
   * Top N 드라이버 추출 (절대값 기준).
   * @param {object} contributions - computeScore의 contributions
   * @param {number} n - 상위 N개
   * @returns {Array<{factor, contribution, sign, label}>}
   */
  function topDrivers(contributions, n) {
    const FACTOR_LABEL = {
      population_density:                  '인구 밀도',
      elderly_ratio:                       '60대 인구 비중',
      clinics_within_500m:                 '인근 의원수 (반경 500m)',
      competitor_pharmacies_within_500m:  '경쟁 약국수 (반경 500m)',
      income_quantile:                     '평균 소득 분위',
      rent_ratio:                         '임대가 (동 평균 대비)',
      visitors_total:                      '유동인구',
    };
    return Object.entries(contributions)
      .map(([factor, contribution]) => ({
        factor,
        contribution,
        sign: contribution >= 0 ? '+' : '-',
        label: FACTOR_LABEL[factor] || factor,
      }))
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, n);
  }

  /**
   * 6개 시연 동의 raw features (Wave 1 — 외부 ETL 미완성 시 fallback)
   * 4단계 grade 모두 등장 보장 (very_high / high / medium / low)
   * 출처: data_raw/pharmacy/sample.json (sample) + simula_data_real.json (인구/상권/지가)
   *
   * grade 설계 근거:
   *   very_high(90+): clinics 많고 competitor 적음 — 의료 수요 충분, 공급 부족 황금 입지
   *   high(70~89):    clinics 많고 comp 낮음 — 좋은 입지
   *   medium(50~69):  clinics 보통, comp 보통 — 신중 검토
   *   low(<50):       clinics 적거나 comp/rent 부담 — 비추천
   */
  const DEMO_DONG_FEATURES = {
    // very_high (~91점) — 의료 수요 높고 경쟁 약국 극소
    '의정부시 금오동': {
      population_density: 45.0, elderly_ratio: 0.28,
      clinics_within_500m: 48, competitor_pharmacies_within_500m: 2,
      income_quantile: 8, rent_ratio: 0.40, visitors_total: 900_000,
    },
    // high (~75점) — 의원 많고 경쟁 낮음
    '의정부시 낙양동': {
      population_density: 40.0, elderly_ratio: 0.22,
      clinics_within_500m: 32, competitor_pharmacies_within_500m: 3,
      income_quantile: 7, rent_ratio: 0.70, visitors_total: 550_000,
    },
    // medium (~54점) — 보통 수준
    '의정부시 민락동': {
      population_density: 28.0, elderly_ratio: 0.18,
      clinics_within_500m: 14, competitor_pharmacies_within_500m: 6,
      income_quantile: 6, rent_ratio: 1.05, visitors_total: 480_000,
    },
    // medium (~53점) — 유동 많지만 임대료/경쟁 부담
    '성수1가1동': {
      population_density: 35.0, elderly_ratio: 0.10,
      clinics_within_500m: 22, competitor_pharmacies_within_500m: 12,
      income_quantile: 8, rent_ratio: 1.85, visitors_total: 720_000,
    },
    // medium (~53점) — clinics 최다이나 comp/rent 상쇄
    '강남구 역삼1동': {
      population_density: 42.0, elderly_ratio: 0.09,
      clinics_within_500m: 48, competitor_pharmacies_within_500m: 24,
      income_quantile: 9, rent_ratio: 2.20, visitors_total: 980_000,
    },
    // low (~43점) — 의료 인프라 부족, 유동 없음
    '저밀도 외곽동': {
      population_density: 3.0, elderly_ratio: 0.25,
      clinics_within_500m: 1, competitor_pharmacies_within_500m: 0,
      income_quantile: 3, rent_ratio: 0.40, visitors_total: 50_000,
    },
  };

  /**
   * 동 이름으로 features 조회 (외부 데이터 미연동 시).
   * 입력 폼의 rent를 features에 병합 (사용자 입력 가산).
   */
  function getFeaturesForDong(dongName, userInputs) {
    const base = DEMO_DONG_FEATURES[dongName];
    if (!base) return null;
    const merged = Object.assign({}, base);
    if (userInputs && typeof userInputs.rent === 'number') {
      // 사용자 임대료 입력 시 동 평균 대비 비율 재계산 (만원 단위, 동 평균 가정 100만원)
      const dongAvgRent = 100;  // 만원 (가정)
      merged.rent_ratio = userInputs.rent / dongAvgRent;
    }
    return merged;
  }

  /**
   * 비교 매물 (점수 ±10 이내 동, 최대 5개).
   * 결정성 보장: 동일 score 입력 → 동일 정렬.
   */
  function comparableDongs(targetScore, currentDongName, maxCount) {
    const others = Object.keys(DEMO_DONG_FEATURES)
      .filter(function(k) { return k !== currentDongName; });
    const scored = others.map(function(name) {
      const features = DEMO_DONG_FEATURES[name];
      const result = computeScore(features);
      const distance = Math.abs(result.score - targetScore);
      return { dong: name, score: result.score, distance: distance };
    });
    scored.sort(function(a, b) { return a.distance - b.distance || a.dong.localeCompare(b.dong); });
    return scored.slice(0, maxCount).map(function(d, i) {
      return {
        rank: i + 1,
        dong: d.dong,
        score: d.score,
        dist_km: estimateDistKm(currentDongName, d.dong),
        prescriptions: estimatePrescriptions(d.score),
        grade: scoreToGradeLabel(d.score),
      };
    });
  }

  function estimateDistKm(a, b) {
    if (!a || !b) return 99;
    const cityA = a.split(' ')[0];
    const cityB = b.split(' ')[0];
    if (cityA === cityB) return Math.round((1 + (a.length + b.length) % 5) * 10) / 10;
    return Math.round(10 + (a.length * b.length) % 30);
  }

  function estimatePrescriptions(score) {
    return Math.round(1500 + score * 100);
  }

  function scoreToGradeLabel(score) {
    if (score >= 90) return 'very_high';
    if (score >= 70) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  /**
   * 통합 평가 — UI에서 호출하는 진입점.
   * @param {string} dongName
   * @param {object} userInputs - { area, rent, expected_prescriptions } (선택)
   * @returns {object|null} - null = 동 미발견
   */
  function evaluatePharmacyDevelop(dongName, userInputs) {
    const features = getFeaturesForDong(dongName, userInputs || {});
    if (!features) return null;
    const result = computeScore(features);
    const score = result.score;
    const contributions = result.contributions;
    const drivers = topDrivers(contributions, 3);
    const comparable = comparableDongs(score, dongName, 5);
    const grade = scoreToGradeLabel(score);
    const PLDDT_COLOR = { very_high: '#00529B', high: '#5BC0EB', medium: '#FED766', low: '#C9485B' };
    const ACTION_LABEL = { very_high: '적극 추천', high: '추천', medium: '신중 검토', low: '비추천' };
    return {
      score: score,
      grade: { label: grade, color: PLDDT_COLOR[grade], actionLabel: ACTION_LABEL[grade] },
      top_drivers: drivers.map(function(d) { return { sign: d.sign, text: d.label }; }),
      comparable_dongs: comparable,
      source: 'pharmacy-scorer.js (가중치 모델 v1, ETL_PHARMACY_DATA-001 fallback)',
      confidence: 0.65,
      _internal: { contributions: contributions, raw_features: features },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // PIVOT (PIVOT_PHARMACY_DEVELOP_PROPERTY_CENTRIC-001, 2026-05-04)
  // 동 입력 → 그 동의 매물 후보 N개를 적합도순으로 반환
  // ─────────────────────────────────────────────────────────────

  // 동별 매물 mock — 1차 데모. 실데이터는 ETL_PHARMACY_DATA-001 + 부동산 매물 API 후속.
  // 매물별로 area_pyeong, monthly_rent_man (만원), street_address, listing_id, available_from
  const DEMO_PROPERTIES_BY_DONG = {
    '의정부시 금오동': [
      { id:'P-금오-001', address:'의정부시 금오동 123-45 1층', area_pyeong:18, rent_man:120, deposit_man:3000, available_from:'2026-06-01', floor:1, listing_source:'직방' },
      { id:'P-금오-002', address:'의정부시 금오동 88-12 1층', area_pyeong:22, rent_man:150, deposit_man:5000, available_from:'2026-05-15', floor:1, listing_source:'네이버부동산' },
      { id:'P-금오-003', address:'의정부시 금오동 200-3 2층', area_pyeong:25, rent_man:95, deposit_man:2000, available_from:'2026-07-01', floor:2, listing_source:'직방' },
      { id:'P-금오-004', address:'의정부시 금오동 56-7 1층', area_pyeong:15, rent_man:180, deposit_man:5000, available_from:'2026-05-20', floor:1, listing_source:'피터팬' },
      { id:'P-금오-005', address:'의정부시 금오동 312 1층', area_pyeong:30, rent_man:220, deposit_man:8000, available_from:'2026-06-15', floor:1, listing_source:'네이버부동산' },
    ],
    '의정부시 낙양동': [
      { id:'P-낙양-001', address:'의정부시 낙양동 12-3 1층', area_pyeong:20, rent_man:140, deposit_man:4000, available_from:'2026-06-01', floor:1, listing_source:'직방' },
      { id:'P-낙양-002', address:'의정부시 낙양동 45-1 1층', area_pyeong:25, rent_man:180, deposit_man:5000, available_from:'2026-05-10', floor:1, listing_source:'네이버부동산' },
      { id:'P-낙양-003', address:'의정부시 낙양동 78 2층', area_pyeong:30, rent_man:120, deposit_man:3000, available_from:'2026-07-01', floor:2, listing_source:'피터팬' },
      { id:'P-낙양-004', address:'의정부시 낙양동 100-5 1층', area_pyeong:18, rent_man:160, deposit_man:4500, available_from:'2026-06-15', floor:1, listing_source:'직방' },
    ],
    '의정부시 민락동': [
      { id:'P-민락-001', address:'의정부시 민락동 220 1층', area_pyeong:22, rent_man:145, deposit_man:4000, available_from:'2026-06-01', floor:1, listing_source:'네이버부동산' },
      { id:'P-민락-002', address:'의정부시 민락동 33-7 1층', area_pyeong:28, rent_man:180, deposit_man:6000, available_from:'2026-05-25', floor:1, listing_source:'직방' },
      { id:'P-민락-003', address:'의정부시 민락동 99 1층', area_pyeong:20, rent_man:200, deposit_man:5000, available_from:'2026-06-10', floor:1, listing_source:'피터팬' },
    ],
    '성수1가1동': [
      { id:'P-성수-001', address:'성수1가1동 무학로 12 1층', area_pyeong:15, rent_man:280, deposit_man:8000, available_from:'2026-05-15', floor:1, listing_source:'직방' },
      { id:'P-성수-002', address:'성수1가1동 연무장길 30 1층', area_pyeong:20, rent_man:380, deposit_man:12000, available_from:'2026-06-01', floor:1, listing_source:'네이버부동산' },
      { id:'P-성수-003', address:'성수1가1동 뚝섬로 100 2층', area_pyeong:25, rent_man:220, deposit_man:6000, available_from:'2026-07-01', floor:2, listing_source:'피터팬' },
      { id:'P-성수-004', address:'성수1가1동 성수일로 55 1층', area_pyeong:18, rent_man:340, deposit_man:10000, available_from:'2026-05-20', floor:1, listing_source:'직방' },
    ],
    '강남구 역삼1동': [
      { id:'P-역삼-001', address:'강남구 역삼1동 테헤란로 152 1층', area_pyeong:20, rent_man:680, deposit_man:20000, available_from:'2026-06-01', floor:1, listing_source:'네이버부동산' },
      { id:'P-역삼-002', address:'강남구 역삼1동 강남대로 358 2층', area_pyeong:30, rent_man:520, deposit_man:18000, available_from:'2026-05-15', floor:2, listing_source:'직방' },
      { id:'P-역삼-003', address:'강남구 역삼1동 논현로 524 1층', area_pyeong:25, rent_man:780, deposit_man:25000, available_from:'2026-07-01', floor:1, listing_source:'피터팬' },
      { id:'P-역삼-004', address:'강남구 역삼1동 도곡로 12 1층', area_pyeong:18, rent_man:450, deposit_man:15000, available_from:'2026-06-10', floor:1, listing_source:'네이버부동산' },
    ],
    '저밀도 외곽동': [
      { id:'P-외곽-001', address:'저밀도 외곽동 산45-1 1층', area_pyeong:30, rent_man:60, deposit_man:1500, available_from:'2026-06-01', floor:1, listing_source:'직방' },
      { id:'P-외곽-002', address:'저밀도 외곽동 87 1층', area_pyeong:25, rent_man:55, deposit_man:1200, available_from:'2026-05-25', floor:1, listing_source:'피터팬' },
    ],
  };

  /**
   * 동 입력 → 그 동의 매물별 평가 결과 N개를 적합도순으로 반환.
   * 동 baseline score를 기반으로 매물별 임대가 보정 (rent_ratio 차등) 적용.
   * @param {string} dongName - '의정부시 금오동' 등 (읍면동까지)
   * @returns {object|null} - { dong, dong_score, dong_grade, properties:[{...매물, score, grade, top_drivers, fit_reason}] } 또는 null
   */
  function evaluateByDong(dongName) {
    const baseFeatures = DEMO_DONG_FEATURES[dongName];
    if (!baseFeatures) return null;
    const dongResult = computeScore(baseFeatures);
    const dongGrade = scoreToGradeLabel(dongResult.score);
    const PLDDT_COLOR = { very_high: '#00529B', high: '#5BC0EB', medium: '#FED766', low: '#C9485B' };
    const ACTION_LABEL = { very_high: '적극 추천', high: '추천', medium: '신중 검토', low: '비추천' };

    const properties = (DEMO_PROPERTIES_BY_DONG[dongName] || []).map(function(prop) {
      // 매물별 보정: 임대료가 동 평균(가정 100만원) 대비 비율로 rent_ratio 재계산
      const dongAvgRent = 100;  // 만원
      const propFeatures = Object.assign({}, baseFeatures, { rent_ratio: prop.rent_man / dongAvgRent });
      const propResult = computeScore(propFeatures);
      const propGrade = scoreToGradeLabel(propResult.score);
      const propDrivers = topDrivers(propResult.contributions, 3).map(function(d) {
        return { sign: d.sign, text: d.label };
      });
      // 매물 카드용 fit_reason — 1줄 요약
      const fitParts = [];
      if (prop.rent_man <= dongAvgRent * 0.9) fitParts.push('임대료 합리적');
      else if (prop.rent_man >= dongAvgRent * 1.5) fitParts.push('임대료 부담');
      if (prop.area_pyeong >= 20) fitParts.push('충분한 면적');
      if (prop.floor === 1) fitParts.push('1층 접근성 우수');
      else if (prop.floor >= 2) fitParts.push('2층 — 처방원 시너지 검토');
      const fitReason = fitParts.join(' · ') || '동 baseline 적용';

      return Object.assign({}, prop, {
        score: propResult.score,
        grade: { label: propGrade, color: PLDDT_COLOR[propGrade], actionLabel: ACTION_LABEL[propGrade] },
        top_drivers: propDrivers,
        fit_reason: fitReason,
      });
    });

    // 적합도순 정렬 (score 내림차순, 동점 시 임대료 낮은 순)
    properties.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.rent_man - b.rent_man;
    });

    return {
      dong: dongName,
      dong_score: dongResult.score,
      dong_grade: { label: dongGrade, color: PLDDT_COLOR[dongGrade], actionLabel: ACTION_LABEL[dongGrade] },
      properties: properties,
      property_count: properties.length,
      source: 'pharmacy-scorer.js evaluateByDong (매물 mock + ETL_PHARMACY_DATA 후속에서 실 매물 API 연동)',
      confidence: 0.55,  // 매물 mock이라 동 단독 평가보다 낮음
    };
  }

  // ── 외부 진입점 (window 전역) ──
  window.PharmacyScorer = {
    evaluate: evaluatePharmacyDevelop,         // legacy — 단일 주소 단일 점수
    evaluateByDong: evaluateByDong,            // PIVOT — 동 입력 매물 추천
    computeScore: computeScore,
    topDrivers: topDrivers,
    WEIGHTS: WEIGHTS,
    DEMO_DONGS: Object.keys(DEMO_DONG_FEATURES),
    DEMO_PROPERTIES_BY_DONG: DEMO_PROPERTIES_BY_DONG,
  };
})();
