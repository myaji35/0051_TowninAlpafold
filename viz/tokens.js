// viz/tokens.js — brand-dna.json design_tokens 동기화 (런타임 fetch + 폴백)
// 글로벌 노출: window.VizTokens
(function (root) {
  'use strict';

  // brand-dna.json의 design_tokens.colors 폴백 (정적 임베드)
  // — fetch 실패 시(file://, 오프라인) 즉시 사용 가능한 진실의 사본
  const FALLBACK = {
    colors: {
      hero: '#00529B',
      surface: '#0F1419',
      surface_alt: '#1A2330',
      text_primary: '#E8EEF6',
      text_secondary: '#A4B0C0',
      accent: '#5BC0EB',
      border: '#2A3445',
      plddt_high: '#00529B',
      plddt_mid:  '#5BC0EB',
      plddt_low:  '#FED766',
      plddt_poor: '#C9485B',
    },
    plddtRange: [[0,82,155,230],[91,192,235,230],[254,215,102,230],[201,72,91,230]],
    heatRange: [[0,82,155,80],[91,192,235,140],[254,215,102,200],[254,153,102,230],[201,72,91,250]],
    hexRange:  [[0,82,155],[91,192,235],[127,216,229],[254,215,102],[254,153,102],[201,72,91]],
    pearsonByR: [
      { min: 0.9, color: '#00529B' },
      { min: 0.7, color: '#5BC0EB' },
      { min: 0.5, color: '#FED766' },
      { min: 0,   color: '#C9485B' },
    ],
  };

  let _tokens = JSON.parse(JSON.stringify(FALLBACK));
  let _loaded = false;

  function hexToRgb(hex) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return [255, 255, 255];
    return [parseInt(m.slice(0,2),16), parseInt(m.slice(2,4),16), parseInt(m.slice(4,6),16)];
  }

  function plddtColor(p) {
    if (p >= 90) return _tokens.plddtRange[0];
    if (p >= 70) return _tokens.plddtRange[1];
    if (p >= 50) return _tokens.plddtRange[2];
    return _tokens.plddtRange[3];
  }

  function plddtHex(p) {
    if (p >= 90) return _tokens.colors.plddt_high;
    if (p >= 70) return _tokens.colors.plddt_mid;
    if (p >= 50) return _tokens.colors.plddt_low;
    return _tokens.colors.plddt_poor;
  }

  function pearsonHexByAbs(absR) {
    for (const t of _tokens.pearsonByR) if (absR >= t.min) return t.color;
    return _tokens.pearsonByR[_tokens.pearsonByR.length - 1].color;
  }

  // 0~1 정규화 값 → RGBA — 기존 colorGrad와 호환 (cyan→amber→red)
  function colorGrad(v) {
    if (v < 0.33) return [0, 161, 224, 200];
    if (v < 0.66) return [254, 215, 102, 220];
    return [201, 72, 91, 240];
  }

  function tokens() { return _tokens; }
  function colors() { return _tokens.colors; }

  function load() {
    if (_loaded) return Promise.resolve(_tokens);
    return fetch('.claude/brand-dna.json')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (j && j.design_tokens && j.design_tokens.colors) {
          Object.assign(_tokens.colors, j.design_tokens.colors);
        }
        _loaded = true;
        return _tokens;
      })
      .catch(() => { _loaded = true; return _tokens; });
  }

  root.VizTokens = {
    load, tokens, colors,
    plddtColor, plddtHex, pearsonHexByAbs, colorGrad, hexToRgb,
    _FALLBACK: FALLBACK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
