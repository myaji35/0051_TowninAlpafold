// viz/plugins/spiral.js — Polar Time Map: 1년=360°, 5년 5바퀴 spiral
(function (root) {
  'use strict';
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    const layer = (scope && scope.height) || 'land_price';
    const dongCode = scope && scope.dongCode;
    const sel = dongs.find(d => d.code === dongCode) || dongs[0];
    if (!sel || !sel.layers || !sel.layers[layer]) { svg.innerHTML = ''; return null; }
    const arr = sel.layers[layer];
    const max = Math.max(...arr) || 1;

    const W = 360, H = 360, cx = W/2, cy = H/2;
    const r0 = 30, rMax = 150;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    // 격자 (5개 동심 가이드)
    for (let g = 1; g <= 5; g++) {
      s += `<circle cx="${cx}" cy="${cy}" r="${r0 + ((rMax - r0) * g / 5)}" fill="none" stroke="${Tk.colors().border}" stroke-width="0.5"/>`;
    }
    // 12달 방위
    for (let m = 0; m < 12; m++) {
      const ang = (m / 12) * 2 * Math.PI - Math.PI / 2;
      const xx = cx + Math.cos(ang) * (rMax + 12);
      const yy = cy + Math.sin(ang) * (rMax + 12);
      s += `<text x="${xx}" y="${yy}" text-anchor="middle" fill="${Tk.colors().text_secondary}" font-size="9">${m+1}</text>`;
    }
    // 60개월 → 5바퀴 spiral
    const pts = arr.map((v, i) => {
      const month = i % 12;
      const year = Math.floor(i / 12);
      const ang = (month / 12) * 2 * Math.PI - Math.PI / 2;
      const r = r0 + (year / 5) * (rMax - r0) + (v / max) * 14;
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, v, year };
    });
    s += `<path d="M${pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}" fill="none" stroke="${Tk.colors().accent}" stroke-width="1.5"/>`;
    pts.forEach(p => {
      const norm = p.v / max;
      const col = norm >= 0.8 ? Tk.colors().plddt_high
              : norm >= 0.5 ? Tk.colors().plddt_mid
              : Tk.colors().plddt_low;
      s += `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${col}"/>`;
    });
    s += `<text x="${cx}" y="${cy+4}" text-anchor="middle" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">${sel.name}</text>`;
    s += `<text x="${cx}" y="${H-8}" text-anchor="middle" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">${layer} · 5년 spiral</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { months: arr.length };
  }
  if (root.VizEngine) root.VizEngine.register({
    id: 'spiral', label: 'Spiral (Polar Time)', icon: '🌀',
    supports: scope => !!(scope && Array.isArray(scope.dongs)),
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
