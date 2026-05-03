// viz/plugins/pearson5x5.js — 5×5 Pearson 매트릭스 (SVG)
// 기존 renderPearsonMatrix와 동등 출력. 기존 함수가 활성이면 그쪽으로 위임.
(function (root) {
  'use strict';

  function defaultLayers() {
    return ['biz_cafe', 'visitors_20s', 'tx_volume', 'biz_closed', 'biz_new'];
  }

  function renderSVG(target, data) {
    // 기존 구현 위임 (회귀 0)
    if (typeof root.renderPearsonMatrix === 'function' && data && data.causal) {
      try {
        return root.renderPearsonMatrix(data.causal.pearson || []);
      } catch (e) { /* fall through */ }
    }

    const svg = (typeof target === 'string')
      ? root.document.getElementById(target)
      : (target && target.nodeType === 1 ? target : null);
    if (!svg) return null;

    const Tk = root.VizTokens;
    const labels = (data && data.causal && data.causal.layer_label) || {};
    const layers = (data && data.causal && data.causal.layers) || defaultLayers();
    const N = layers.length;
    const lookup = {};
    const pairs = (data && data.causal && data.causal.pearson) || [];
    pairs.forEach(p => {
      lookup[p.a + '|' + p.b] = p;
      lookup[p.b + '|' + p.a] = p;
    });

    const left = 56, top = 16, cell = 30;
    const w = left + cell * N + 8;
    const h = top + cell * N + 24;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let s = '';
    for (let i = 0; i < N; i++) {
      const lbl = labels[layers[i]] || layers[i];
      s += `<text x="${left-6}" y="${top + cell*i + cell/2 + 3}" text-anchor="end" fill="#A4B0C0" font-size="9">${lbl}</text>`;
    }
    for (let j = 0; j < N; j++) {
      const lbl = labels[layers[j]] || layers[j];
      s += `<text x="${left + cell*j + cell/2}" y="${top + cell*N + 14}" text-anchor="middle" fill="#A4B0C0" font-size="9">${lbl}</text>`;
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = left + cell * j;
        const y = top + cell * i;
        let fill, txt, abs, r;
        if (i === j) { fill = '#1A2330'; txt = '·'; abs = 1; r = 1; }
        else {
          const p = lookup[layers[i] + '|' + layers[j]];
          if (!p) { fill = '#0F1419'; txt = ''; abs = 0; r = NaN; }
          else { r = p.r; abs = Math.abs(r); fill = Tk.pearsonHexByAbs(abs); txt = abs >= 1 ? '1.00' : '.' + abs.toFixed(3).slice(2); }
        }
        s += `<rect x="${x}" y="${y}" width="${cell-2}" height="${cell-2}" rx="3" fill="${fill}" stroke="#2A3445" stroke-width="0.5"/>`;
        const textColor = (abs >= 0.9 || abs < 0.5) ? '#FFFFFF' : '#0F1419';
        if (txt) s += `<text x="${x + (cell-2)/2}" y="${y + (cell-2)/2 + 3}" text-anchor="middle" fill="${textColor}" font-size="9" pointer-events="none">${txt}</text>`;
      }
    }
    svg.innerHTML = s;
    return { svg, cells: N * N };
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'pearson5x5',
      label: 'Pearson 5×5',
      icon: '▦',
      supports: scope => !!(scope && (scope.causal || scope.dongCode)),
      render: renderSVG,
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
