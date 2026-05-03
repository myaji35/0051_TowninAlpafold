// viz/plugins/ridgeline.js — Joy Plot: 동별 시계열 리지라인 누적
(function (root) {
  'use strict';
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const top = dongs
      .filter(d => d.layers && d.layers[layer])
      .slice() // 정렬 사본
      .sort((a, b) => {
        const av = a.layers[layer]; const bv = b.layers[layer];
        return (bv[bv.length - 1] || 0) - (av[av.length - 1] || 0);
      })
      .slice(0, 30);

    const W = 720, H = 360, padL = 88, padR = 12, padT = 12, padB = 28;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const N = top.length;
    if (N === 0) { svg.innerHTML = ''; return null; }
    const rowH = innerH / N;
    const overlap = rowH * 1.6;

    const allMax = Math.max(...top.flatMap(d => d.layers[layer]));
    const months = top[0].layers[layer].length;
    const x = i => padL + (i / Math.max(1, months - 1)) * innerW;

    let s = '';
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    top.forEach((d, idx) => {
      const yBase = padT + idx * rowH + rowH / 2;
      const arr = d.layers[layer];
      const ridgeColor = Tk.plddtHex((d.plddt && d.plddt[months - 1]) || 70);
      const pts = arr.map((v, i) => {
        const norm = v / (allMax || 1);
        return `${x(i)},${yBase - norm * overlap}`;
      });
      s += `<path d="M${padL},${yBase}L${pts.join('L')}L${padL + innerW},${yBase}Z" fill="${ridgeColor}" fill-opacity="0.45" stroke="${ridgeColor}" stroke-width="1"/>`;
      // 동 라벨
      s += `<text x="${padL - 6}" y="${yBase + 3}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-sans-serif">${d.name}</text>`;
    });
    // 축 라벨
    s += `<text x="${padL}" y="${H - 8}" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">2020-01</text>`;
    s += `<text x="${padL + innerW}" y="${H - 8}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">2024-12</text>`;
    s += `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">${layer}</text>`;
    svg.innerHTML = s;
    return { rows: N, layer };
  }
  if (root.VizEngine) root.VizEngine.register({
    id: 'ridgeline', label: 'Ridgeline (Joy Plot)', icon: '🎚',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
