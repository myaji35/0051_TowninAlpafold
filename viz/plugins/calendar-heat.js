// viz/plugins/calendar-heat.js — 60개월 격자 히트맵 (5년 × 12월)
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
    if (!sel || !sel.layers || !sel.layers[layer]) {
      svg.innerHTML = `<text x="100" y="50" fill="#9CA3AF" font-size="11">데이터 없음</text>`; return null;
    }
    const arr = sel.layers[layer];
    const max = Math.max(...arr), min = Math.min(...arr);
    const span = max - min || 1;
    const W = 480, H = 220, padL = 64, padT = 24, padR = 12, padB = 18;
    const cols = 12, rows = 5;
    const cw = (W - padL - padR) / cols, ch = (H - padT - padB) / rows;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    s += `<text x="${padL}" y="${padT-8}" fill="#A4B0C0" font-size="9" font-family="ui-monospace">${sel.name} · ${layer}</text>`;
    // 월 라벨
    for (let m = 0; m < 12; m++) {
      s += `<text x="${padL + m*cw + cw/2}" y="${padT-4}" text-anchor="middle" fill="${Tk.colors().text_secondary}" font-size="8">${m+1}</text>`;
    }
    // 연도 라벨
    ['2020','2021','2022','2023','2024'].forEach((y, r) => {
      s += `<text x="${padL-6}" y="${padT + r*ch + ch/2 + 3}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="9" font-family="ui-monospace">${y}</text>`;
    });
    arr.forEach((v, i) => {
      const r = Math.floor(i / 12), c = i % 12;
      const norm = (v - min) / span;
      const col = norm >= 0.75 ? Tk.colors().plddt_high
              : norm >= 0.50 ? Tk.colors().plddt_mid
              : norm >= 0.25 ? Tk.colors().plddt_low
              : Tk.colors().plddt_poor;
      s += `<rect x="${padL + c*cw + 1}" y="${padT + r*ch + 1}" width="${cw-2}" height="${ch-2}" rx="2" fill="${col}" data-month="${i}"><title>${y(r)}-${pad(c+1)}: ${fmt(v)}</title></rect>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { months: arr.length, layer, dong: sel.name };
  }
  function y(r){return [2020,2021,2022,2023,2024][r]||'';}
  function pad(n){return n<10?'0'+n:''+n;}
  function fmt(v){return Math.abs(v)>=10000? (v/10000).toFixed(0)+'만' : (Math.abs(v)>=1000? (v/1000).toFixed(0)+'k' : v.toFixed(0));}
  if (root.VizEngine) root.VizEngine.register({
    id: 'calendar-heat', label: 'Calendar Heatmap', icon: '🗓',
    supports: scope => !!(scope && Array.isArray(scope.dongs)),
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
