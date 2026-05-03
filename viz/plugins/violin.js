// viz/plugins/violin.js — 시나리오별 KDE 좌우 대칭 분포 (Violin)
(function (root) {
  'use strict';
  function kde(samples, points, h) {
    // Epanechnikov KDE 단순 구현
    const n = samples.length || 1;
    const out = [];
    const K = u => Math.abs(u) <= 1 ? 0.75 * (1 - u*u) : 0;
    points.forEach(x => {
      let sum = 0;
      for (const s of samples) sum += K((x - s) / h);
      out.push(sum / (n * h));
    });
    return out;
  }
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const m = Number.isFinite(scope && scope.monthIndex) ? scope.monthIndex : 59;

    // 시나리오 그룹
    const groups = {};
    dongs.forEach(d => {
      const v = d.layers && d.layers[layer] ? d.layers[layer][m] : null;
      if (v == null || !d.scenario) return;
      groups[d.scenario] = groups[d.scenario] || [];
      groups[d.scenario].push(v);
    });
    const keys = Object.keys(groups);
    if (!keys.length) { svg.innerHTML = ''; return null; }

    const W = 720, H = 320, padL = 100, padT = 20, padR = 16, padB = 30;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const allVals = keys.flatMap(k => groups[k]);
    const vmin = Math.min(...allVals), vmax = Math.max(...allVals);
    const span = vmax - vmin || 1;
    const h = span * 0.18;
    const grid = 40;
    const xPts = Array.from({length: grid}, (_, i) => vmin + (i / (grid-1)) * span);

    const rowH = innerH / keys.length;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    keys.forEach((k, i) => {
      const samples = groups[k];
      const dens = kde(samples, xPts, h);
      const dmax = Math.max(...dens) || 1;
      const yc = padT + i * rowH + rowH/2;
      const halfH = rowH * 0.42;
      const col = Tk.colors().plddt_mid;
      const upper = xPts.map((xv, j) => {
        const xpos = padL + ((xv - vmin) / span) * innerW;
        return `${xpos},${yc - (dens[j]/dmax) * halfH}`;
      });
      const lower = xPts.slice().reverse().map((xv, jj) => {
        const j = grid - 1 - jj;
        const xpos = padL + ((xv - vmin) / span) * innerW;
        return `${xpos},${yc + (dens[j]/dmax) * halfH}`;
      });
      s += `<polygon points="${upper.concat(lower).join(' ')}" fill="${col}" fill-opacity="0.5" stroke="${col}" stroke-width="1"/>`;
      // 라벨 + n
      s += `<text x="${padL-6}" y="${yc+3}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9">${k} (n=${samples.length})</text>`;
    });
    s += `<text x="${padL}" y="${H-8}" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">min ${fmt(vmin)}</text>`;
    s += `<text x="${padL+innerW}" y="${H-8}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">max ${fmt(vmax)}</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { groups: keys.length };
  }
  function fmt(v){const a=Math.abs(v);return a>=1e8?(v/1e8).toFixed(1)+'억':a>=10000?(v/10000).toFixed(0)+'만':a>=1000?(v/1000).toFixed(0)+'k':v.toFixed(0);}
  if (root.VizEngine) root.VizEngine.register({
    id: 'violin', label: 'Violin (KDE)', icon: '🎻',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
