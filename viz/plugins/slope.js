// viz/plugins/slope.js — 두 시점(첫달 vs 마지막달) Slope Graph
(function (root) {
  'use strict';
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const fromIdx = 0;
    const toIdx = (scope && Number.isFinite(scope.monthIndex)) ? scope.monthIndex : 59;
    const top = dongs
      .filter(d => d.layers && d.layers[layer])
      .slice()
      .sort((a, b) => Math.abs(b.layers[layer][toIdx] - b.layers[layer][fromIdx]) - Math.abs(a.layers[layer][toIdx] - a.layers[layer][fromIdx]))
      .slice(0, 25);
    const allVals = top.flatMap(d => [d.layers[layer][fromIdx], d.layers[layer][toIdx]]);
    const vmin = Math.min(...allVals), vmax = Math.max(...allVals);
    const span = vmax - vmin || 1;

    const W = 720, H = 360, padL = 90, padR = 90, padT = 24, padB = 24;
    const yC = v => padT + (1 - (v - vmin) / span) * (H - padT - padB);
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    s += `<text x="${padL}" y="${padT-8}" fill="${Tk.colors().text_secondary}" font-size="10" text-anchor="middle">2020-01</text>`;
    s += `<text x="${W-padR}" y="${padT-8}" fill="${Tk.colors().text_secondary}" font-size="10" text-anchor="middle">${ymd(toIdx)}</text>`;
    s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="${Tk.colors().border}" stroke-width="0.5"/>`;
    s += `<line x1="${W-padR}" y1="${padT}" x2="${W-padR}" y2="${H-padB}" stroke="${Tk.colors().border}" stroke-width="0.5"/>`;

    top.forEach(d => {
      const v1 = d.layers[layer][fromIdx], v2 = d.layers[layer][toIdx];
      const y1 = yC(v1), y2 = yC(v2);
      const up = v2 >= v1;
      const col = up ? Tk.colors().plddt_high : Tk.colors().plddt_poor;
      s += `<line x1="${padL}" y1="${y1}" x2="${W-padR}" y2="${y2}" stroke="${col}" stroke-width="1.2" stroke-opacity="0.7"/>`;
      s += `<circle cx="${padL}" cy="${y1}" r="3" fill="${col}"/>`;
      s += `<circle cx="${W-padR}" cy="${y2}" r="3" fill="${col}"/>`;
      s += `<text x="${padL-6}" y="${y1+3}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9">${d.name}</text>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { rows: top.length };
  }
  function ymd(idx) { const y = 2020 + Math.floor(idx/12), m = (idx%12)+1; return `${y}-${m<10?'0'+m:m}`; }
  if (root.VizEngine) root.VizEngine.register({
    id: 'slope', label: 'Slope Graph', icon: '↗',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
