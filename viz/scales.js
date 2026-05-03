// viz/scales.js — ScaleResolver: 시간/색/크기 자동 스케일
// 글로벌 노출: window.VizScales
(function (root) {
  'use strict';

  function linear(min, max) {
    const span = (max - min) || 1e-9;
    return v => (v - min) / span;
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const i = Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))));
    return sorted[i];
  }

  // dongs[].layers[layer] (월별 시계열) → {min, max, p10, p90}
  function summarizeLayer(dongs, layer, monthIndex) {
    const vals = [];
    for (const d of dongs) {
      const arr = d.layers && d.layers[layer];
      if (!arr) continue;
      if (Number.isFinite(monthIndex)) {
        const v = arr[monthIndex];
        if (Number.isFinite(v)) vals.push(v);
      } else {
        for (const v of arr) if (Number.isFinite(v)) vals.push(v);
      }
    }
    if (!vals.length) return { min: 0, max: 1, p10: 0, p90: 1, n: 0 };
    return {
      min: Math.min(...vals),
      max: Math.max(...vals),
      p10: quantile(vals, 0.1),
      p90: quantile(vals, 0.9),
      n: vals.length,
    };
  }

  // ScopeManager scope → 스케일 번들 자동 생성
  // scope: { dongs, monthIndex, height, color }
  function resolve(scope) {
    const dongs = scope.dongs || [];
    const m = Number.isFinite(scope.monthIndex) ? scope.monthIndex : null;

    const out = {
      time: { current: m, total: scope.totalMonths || 60 },
    };
    if (scope.height) {
      const s = summarizeLayer(dongs, scope.height, m);
      out.height = Object.assign({}, s, { norm: linear(0, s.max + 1e-9) });
    }
    if (scope.color) {
      const s = summarizeLayer(dongs, scope.color, m);
      out.color = Object.assign({}, s, { norm: linear(s.min, s.max) });
    }
    if (scope.size) {
      const s = summarizeLayer(dongs, scope.size, m);
      out.size = Object.assign({}, s, { norm: linear(s.min, s.max) });
    }
    return out;
  }

  root.VizScales = { resolve, summarizeLayer, linear, quantile };
})(typeof window !== 'undefined' ? window : globalThis);
