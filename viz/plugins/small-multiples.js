// viz/plugins/small-multiples.js — 5×5 mini chart 격자 (Trellis)
// 25개 동의 시계열 미니 라인 차트 매트릭스
(function (root) {
  'use strict';
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const COLS = 5, ROWS = 5;
    const top = dongs
      .filter(d => d.layers && d.layers[layer])
      .slice()
      .sort((a, b) => {
        const av = a.layers[layer], bv = b.layers[layer];
        return (bv[bv.length-1]||0) - (av[av.length-1]||0);
      })
      .slice(0, COLS * ROWS);

    const W = 720, H = 420, padO = 8;
    const cellW = (W - padO * (COLS + 1)) / COLS;
    const cellH = (H - padO * (ROWS + 1)) / ROWS;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    top.forEach((d, idx) => {
      const r = Math.floor(idx / COLS), c = idx % COLS;
      const x0 = padO + c * (cellW + padO), y0 = padO + r * (cellH + padO);
      const arr = d.layers[layer];
      const max = Math.max(...arr) || 1, min = Math.min(...arr) || 0;
      const span = max - min || 1;
      const last = arr[arr.length - 1];
      const lastNorm = (last - min) / span;
      const col = lastNorm >= 0.75 ? Tk.colors().plddt_high
                : lastNorm >= 0.50 ? Tk.colors().plddt_mid
                : lastNorm >= 0.25 ? Tk.colors().plddt_low
                : Tk.colors().plddt_poor;
      s += `<rect x="${x0}" y="${y0}" width="${cellW}" height="${cellH}" fill="${Tk.colors().surface_alt}" stroke="${Tk.colors().border}" stroke-width="0.5"/>`;
      s += `<text x="${x0+4}" y="${y0+11}" fill="${Tk.colors().text_secondary}" font-size="8" font-family="ui-sans-serif">${d.name}</text>`;
      const innerY = y0 + 16, innerH = cellH - 22;
      const pts = arr.map((v, i) => {
        const xp = x0 + 4 + (i / (arr.length-1)) * (cellW - 8);
        const yp = innerY + innerH - ((v - min) / span) * innerH;
        return `${xp.toFixed(1)},${yp.toFixed(1)}`;
      });
      s += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { cells: top.length, layer };
  }
  if (root.VizEngine) root.VizEngine.register({
    id: 'small-multiples', label: 'Small Multiples', icon: '▦',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length >= 25,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
