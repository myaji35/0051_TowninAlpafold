// viz/curator.js — DataCurator: scope + chartType → 차트별 데이터 자동 추출
// 글로벌 노출: window.VizCurator
(function (root) {
  'use strict';

  function pickPoints(scope, scales) {
    const dongs = scope.dongs || [];
    const m = Number.isFinite(scope.monthIndex) ? scope.monthIndex : 0;
    const heightLayer = scope.height;
    const colorLayer = scope.color;
    const cNorm = scales && scales.color ? scales.color.norm : (v => v);
    const hMax = scales && scales.height ? (scales.height.max + 1e-9) : 1;

    return dongs.map(d => {
      const hVal = heightLayer && d.layers && d.layers[heightLayer]
        ? d.layers[heightLayer][m] : 0;
      const cVal = colorLayer && d.layers && d.layers[colorLayer]
        ? d.layers[colorLayer][m] : 0;
      return {
        code: d.code,
        name: d.name,
        scenario: d.scenario,
        coordinates: [d.lng, d.lat],
        height: hVal / hMax,
        rawHeight: hVal,
        colorVal: cNorm(cVal),
        rawColor: cVal,
        plddt: d.plddt ? d.plddt[m] : 0,
        polygon: d.polygon_geo || null,
        real_adm_nm: d.real_adm_nm || null,
      };
    });
  }

  // 차트별 분기 — 향후 13종 확장 진입점
  function curate(chartType, scope, scales) {
    switch (chartType) {
      case 'columns3d':
      case 'heatmap':
      case 'hexagon':
        return { points: pickPoints(scope, scales) };
      case 'pearson5x5':
        // 인과 데이터는 별도 소스(CAUSAL.dong_causal[code])
        return {
          dongCode: scope.dongCode || null,
          causal: scope.causal || null,
        };
      default:
        return { points: pickPoints(scope, scales) };
    }
  }

  root.VizCurator = { curate, pickPoints };
})(typeof window !== 'undefined' ? window : globalThis);
