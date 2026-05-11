// utils/fallback-policy.js
// 데이터 가용성 → 결과 wrapping 일관 정책
// 부모 이슈: ISS-095 (REFACTOR)

(function() {
  'use strict';

  const CONFIDENCE_BY_MARKER = {
    'real':     { factor: 1.0, label: '실데이터' },
    'synth':    { factor: 0.7, label: '합성 데모' },
    'estimate': { factor: 0.5, label: '추정' },
    'fallback': { factor: 0.4, label: 'fallback' },
  };

  const NOTICE_KO = {
    'real':     '실데이터 기반 평가입니다.',
    'synth':    '합성 데모 데이터입니다 — 외부 ETL 완성 시 자동 재계산됩니다.',
    'estimate': '추정 데이터 기반 — 신뢰도 낮음. 의사결정 전 실데이터 검증 권장.',
    'fallback': '주 데이터 소스 미가용 — 보조 fallback 데이터 사용 중.',
  };

  /**
   * 평가 결과를 데이터 가용성 메타와 함께 감싸기.
   * @param {object} rawResult - 원본 평가 결과 (score/grade/...)
   * @param {object} dataStatus - DomainData.getStatus() 결과 또는 동등 객체
   * @returns {object} - rawResult + { data_status, confidence_factor, notice, _wrapped: true }
   */
  function wrapWithDataAvailability(rawResult, dataStatus) {
    if (!rawResult || typeof rawResult !== 'object') return rawResult;

    const status = dataStatus || { available: false, marker: 'estimate', source: 'unknown' };
    const marker = status.marker || 'estimate';
    const conf = CONFIDENCE_BY_MARKER[marker] || CONFIDENCE_BY_MARKER.estimate;

    // 원본 confidence가 있으면 marker factor 곱하기 (보수적 절감)
    const originalConfidence = (typeof rawResult.confidence === 'number') ? rawResult.confidence : 0.7;
    const adjustedConfidence = Math.max(0, Math.min(1, originalConfidence * conf.factor));

    return {
      ...rawResult,
      confidence: adjustedConfidence,
      _original_confidence: originalConfidence,
      data_status: {
        available: !!status.available,
        marker,
        source: status.source || '',
        fetched_at: status.fetched_at || '',
        confidence_label: conf.label,
        notice: NOTICE_KO[marker] || NOTICE_KO.estimate,
      },
      _wrapped: true,
    };
  }

  /**
   * UI에서 "데이터 상태 배지" 텍스트 + 색상 결정.
   * @param {object} dataStatus
   * @returns {{label: string, color: string}}
   */
  function statusBadge(dataStatus) {
    const marker = (dataStatus && dataStatus.marker) || 'estimate';
    const COLOR = {
      'real':     '#00529B',  // plddt high
      'synth':    '#5BC0EB',  // plddt medium-high
      'estimate': '#FED766',  // plddt medium
      'fallback': '#C9485B',  // plddt low
    };
    const conf = CONFIDENCE_BY_MARKER[marker] || CONFIDENCE_BY_MARKER.estimate;
    return { label: conf.label, color: COLOR[marker] || COLOR.estimate };
  }

  window.FallbackPolicy = {
    wrap: wrapWithDataAvailability,
    statusBadge,
    CONFIDENCE_BY_MARKER,
  };
})();
