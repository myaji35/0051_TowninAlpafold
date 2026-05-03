// viz/plugins/map-treemap.js — Cartogram (squared-treemap) — 데이터 비율로 영역 왜곡
// 130개 동을 시나리오/레이어 마지막달 값 기준 squarified treemap으로 렌더
(function (root) {
  'use strict';
  function squarify(items, x, y, w, h) {
    if (!items.length) return [];
    if (items.length === 1) return [{...items[0], x, y, w, h}];
    const total = items.reduce((s, it) => s + it.value, 0);
    const horiz = w >= h;
    let acc = 0;
    const split = Math.ceil(items.length * 0.5);
    const left = items.slice(0, split), right = items.slice(split);
    const leftSum = left.reduce((s, it) => s + it.value, 0);
    const ratio = leftSum / total;
    let leftRect, rightRect;
    if (horiz) {
      const lw = w * ratio;
      leftRect = squarify(left, x, y, lw, h);
      rightRect = squarify(right, x + lw, y, w - lw, h);
    } else {
      const lh = h * ratio;
      leftRect = squarify(left, x, y, w, lh);
      rightRect = squarify(right, x, y + lh, w, h - lh);
    }
    return leftRect.concat(rightRect);
  }
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const m = (scope && Number.isFinite(scope.monthIndex)) ? scope.monthIndex : 59;
    const items = dongs
      .filter(d => d.layers && d.layers[layer])
      .map(d => ({ name: d.name, code: d.code, value: d.layers[layer][m] || 0, scenario: d.scenario, plddt: d.plddt && d.plddt[m] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 50);
    const W = 720, H = 360;
    const rects = squarify(items, 0, 0, W, H);
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    rects.forEach(r => {
      const col = Tk.plddtHex(r.plddt || 70);
      s += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${col}" fill-opacity="0.7" stroke="${Tk.colors().border}" stroke-width="0.5" data-code="${r.code}"><title>${r.name}: ${fmt(r.value)} (${r.scenario})</title></rect>`;
      if (r.w > 56 && r.h > 18) {
        s += `<text x="${r.x+4}" y="${r.y+12}" fill="#fff" font-size="9" font-family="ui-sans-serif">${r.name}</text>`;
      }
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { rects: rects.length };
  }
  function fmt(v){const a=Math.abs(v);return a>=1e8?(v/1e8).toFixed(1)+'억':a>=10000?(v/10000).toFixed(0)+'만':v.toFixed(0);}
  if (root.VizEngine) root.VizEngine.register({
    id: 'map-treemap', label: 'Cartogram (Squarified)', icon: '🗺',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
