// viz/plugins/pharmacy-hazard.js
// 약국 폐업평가 Hazard 계산 (Wave 3)
// 부모: USER_STORY_PHARMACY_CLOSE-001
// 명세: docs/stories/pharmacy-close.md D절
//
// ⚠ 색 의미 가드: hazard ↑ = 위험 (점포개발 score↑=좋음과 반대)

(function() {
  'use strict';

  // ── 가중치 (명세서 D절, 절대값 합 1.00) ──
  const WEIGHTS = Object.freeze({
    revenue_yoy:                      -0.25,  // 음 — 감소 ↑ → hazard ↑
    prescription_yoy:                 -0.20,  // 음 — 감소 ↑ → hazard ↑
    population_yoy:                   -0.10,  // 음 — 인구 감소 ↑ → hazard ↑
    clinics_closed_500m_12m:           0.15,  // 양 — 폐업 카운트 ↑ → hazard ↑
    competitor_pharmacies_new_12m:     0.12,  // 양 — 신규 진입 ↑ → hazard ↑
    rent_yoy:                          0.08,  // 양 — 임대료 상승 → hazard ↑
    operating_months:                 -0.10,  // 음 — 오래 운영 = 안정 → hazard ↓
  });

  // 절대값 합 검증 (코드 변경 시 가드)
  const _wsum = Object.values(WEIGHTS).reduce((s, w) => s + Math.abs(w), 0);
  if (Math.abs(_wsum - 1.00) > 0.001) {
    console.error('[pharmacy-hazard] WEIGHTS abs-sum != 1.00:', _wsum);
  }

  function clamp01(x) {
    if (typeof x !== 'number' || isNaN(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  // ── 정규화 — raw 값 → [0, 1] (모든 정규화 결과는 "위험도" — 클수록 위험) ──
  const NORMALIZERS = {
    // YoY -30% 이상 감소 → 1.0 / +20% (증가) → 0  (분모 0.50 = 30%+20%)
    revenue_yoy:                      (v) => v == null ? 0.5 : clamp01((-v + 0.20) / 0.50),
    prescription_yoy:                 (v) => v == null ? 0.5 : clamp01((-v + 0.20) / 0.50),
    // 인구 YoY -3% 이상 감소 → 1.0
    population_yoy:                   (v) => v == null ? 0 : clamp01((-v) / 0.03),
    // 의원 폐업 3건 이상 → 1.0
    clinics_closed_500m_12m:          (v) => clamp01((v || 0) / 3),
    // 경쟁 약국 신규 진입 3건 이상 → 1.0
    competitor_pharmacies_new_12m:    (v) => clamp01((v || 0) / 3),
    // 임대료 YoY +20% 이상 → 1.0
    rent_yoy:                         (v) => v == null ? 0.5 : clamp01(v / 0.20),
    // 운영 개월수 60개월(5년) 이상 → 1.0 (안정도)
    operating_months:                 (v) => clamp01((v || 0) / 60),
  };

  const FACTOR_LABEL = {
    revenue_yoy:                  '월 매출 YoY',
    prescription_yoy:             '월 처방건수 YoY',
    population_yoy:               '동 인구 YoY',
    clinics_closed_500m_12m:      '인근 의원 폐업/이전 (12M)',
    competitor_pharmacies_new_12m:'경쟁 약국 신규 진입 (12M)',
    rent_yoy:                     '동 임대가 YoY',
    operating_months:             '운영 개월수',
  };

  /**
   * Hazard 점수 계산 (0~100, 정수).
   * @param {object} features - 점포 피처 맵
   * @returns {{hazard: number, contributions: object, raw: number}}
   */
  function computeHazard(features) {
    const contributions = {};
    let raw = 0;
    let posSum = 0;
    let negSum = 0;

    for (const [factor, weight] of Object.entries(WEIGHTS)) {
      const norm = NORMALIZERS[factor](features[factor]);
      // operating_months: 안정도 — hazard 차감
      const isStability = factor === 'operating_months';
      const contrib = isStability
        ? -Math.abs(weight) * norm
        :  Math.abs(weight) * norm;
      contributions[factor] = contrib;
      raw += contrib;
      if (isStability) negSum += Math.abs(weight);
      else posSum += Math.abs(weight);
    }

    // 정규화: 범위 [-negSum, +posSum] → [0, 1] → ×100
    const normalized = (raw - (-negSum)) / (posSum + negSum);
    const hazard = Math.round(clamp01(normalized) * 100);
    return { hazard, contributions, raw };
  }

  /**
   * 기여도 절대값 기준 상위 N 드라이버 반환.
   * @param {object} contributions
   * @param {number} n
   * @returns {Array}
   */
  function topDrivers(contributions, n) {
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

  // ── 데모 점포 피처 (data_raw/pharmacy/sample.json 2건 대응) ──
  const DEMO_STORE_FEATURES = {
    'store-001': {
      revenue_yoy:                    -0.22,
      prescription_yoy:               -0.18,
      population_yoy:                 -0.015,
      clinics_closed_500m_12m:         3,
      competitor_pharmacies_new_12m:   1,
      rent_yoy:                        0.05,
      operating_months:                62,
      address: '의정부시 금오동',
    },
    'store-002': {
      revenue_yoy:                     0.12,
      prescription_yoy:                0.08,
      population_yoy:                  0.005,
      clinics_closed_500m_12m:         0,
      competitor_pharmacies_new_12m:   2,
      rent_yoy:                        0.18,
      operating_months:                34,
      address: '성수1가1동',
    },
  };

  const DEMO_PEERS = {
    'store-001': [
      { rank: 1, dong: '의정부 호원동', survival_12m: 0.58, status: '주의' },
      { rank: 2, dong: '의정부 낙양동', survival_12m: 0.64, status: '평균' },
      { rank: 3, dong: '의정부 민락동', survival_12m: 0.71, status: '안정' },
    ],
    'store-002': [
      { rank: 1, dong: '성수2가1동', survival_12m: 0.85, status: '안전' },
      { rank: 2, dong: '성수2가3동', survival_12m: 0.81, status: '안정' },
    ],
  };

  const HAZARD_GRADES = [
    { min: 70, label: 'high',     color: '#C9485B', actionLabel: '철수 검토',             actionColor: '#C9485B' },
    { min: 50, label: 'medium',   color: '#FED766', actionLabel: '관찰 — 3개월 후 재평가', actionColor: '#FED766' },
    { min: 30, label: 'low',      color: '#5BC0EB', actionLabel: '유지',                  actionColor: '#5BC0EB' },
    { min: 0,  label: 'very_low', color: '#00529B', actionLabel: '유지 — 안전',            actionColor: '#00529B' },
  ];

  function hazardToGrade(hazard) {
    return HAZARD_GRADES.find(g => hazard >= g.min) || HAZARD_GRADES[HAZARD_GRADES.length - 1];
  }

  /**
   * 통합 평가 — UI(components/pharmacy-close.js)에서 호출하는 진입점.
   * @param {object} input - {store_id?, address?, operating_months?, csv_uploaded?}
   * @returns {object|null}
   */
  function evaluatePharmacyClose(input) {
    if (!input) return null;

    const sid = input.store_id || input.id;
    let features = sid && DEMO_STORE_FEATURES[sid];

    if (!features) {
      for (const [_sid, _data] of Object.entries(DEMO_STORE_FEATURES)) {
        if (input.address && (
          _data.address === input.address ||
          input.address.includes(_data.address)
        )) {
          features = _data;
          break;
        }
      }
    }
    if (!features) return null;

    // operating_months 사용자 입력 우선 override
    if (typeof input.operating_months === 'number' && input.operating_months > 0) {
      features = { ...features, operating_months: input.operating_months };
    }

    const { hazard, contributions } = computeHazard(features);
    const drivers = topDrivers(contributions, 3);
    const grade = hazardToGrade(hazard);
    const csv_uploaded = !!input.csv_uploaded;
    const peer_dongs = DEMO_PEERS[sid] || [];
    const survival_avg = peer_dongs.length
      ? peer_dongs.reduce((s, p) => s + p.survival_12m, 0) / peer_dongs.length
      : 0;
    const survival_pct = (survival_avg * 100).toFixed(0);
    const km_curve_summary = peer_dongs.length
      ? `유사 ${peer_dongs.length}개 동 12개월 생존확률 ${survival_pct}% (${csv_uploaded ? '95% CI 음영 — UI_BENCHMARK_KM_CURVE 통합 후 표시' : '추정 모드'})`
      : '유사 동 데이터 부족 — 점포 운영 6개월 이상 필요';

    return {
      hazard,
      grade,
      top_drivers: drivers.map(d => ({ sign: d.sign, text: d.label })),
      peer_dongs,
      km_curve_summary,
      source: 'pharmacy-hazard.js (가중치 모델 v1, ETL_PHARMACY_DATA-001 fallback)',
      confidence: csv_uploaded ? 0.85 : 0.55,
      estimate_mode: !csv_uploaded,
      _internal: { contributions, raw_features: features },
    };
  }

  // ── 외부 API ──
  window.PharmacyHazard = {
    evaluate: evaluatePharmacyClose,
    computeHazard,
    topDrivers,
    hazardToGrade,
    WEIGHTS,
    DEMO_STORES: Object.keys(DEMO_STORE_FEATURES),
    HAZARD_GRADES,
  };
})();
