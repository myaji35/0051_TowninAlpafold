// viz/plugins/sankey-map.js — 동 간 인과 흐름 곡선 (CAUSAL.dongs[].granger 기반)
// 130개 동을 (소상공/카페/유동/거래/지가) 5개 레이어 풀로 묶고, 동별 강한 인과를
// cause→effect 곡선 SVG 흐름으로 표현. 지도 위에 직접 그리는 대신 별도 SVG 패널.
(function (root) {
  'use strict';
  const LAYERS = ['biz_count','biz_cafe','visitors_total','tx_volume','land_price'];
  const KO = { biz_count:'소상공', biz_cafe:'카페', visitors_total:'유동', tx_volume:'거래', land_price:'지가' };
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const causal = data && data.causal;
    const W = 640, H = 320, padL = 70, padR = 70, padT = 16, padB = 16;
    const innerW = W - padL - padR;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    if (!causal || !causal.dongs) {
      s += `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#9CA3AF" font-size="12">causal.json 미로드</text>`;
      svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
      svg.innerHTML = s; return null;
    }
    // 페어별 카운트 (방향 보존)
    const counts = {};
    Object.values(causal.dongs).forEach(dc => (dc.granger || []).forEach(g => {
      const key = `${g.cause}|${g.effect}`;
      counts[key] = (counts[key] || 0) + 1;
    }));
    const total = Object.values(counts).reduce((s,n)=>s+n, 0) || 1;
    const N = LAYERS.length;
    const yL = i => padT + (i + 0.5) * (H - padT - padB) / N;

    // 좌측 레이어, 우측 레이어 라벨
    LAYERS.forEach((L, i) => {
      s += `<text x="${padL-6}" y="${yL(i)+3}" text-anchor="end" fill="#A4B0C0" font-size="10">${KO[L]}</text>`;
      s += `<circle cx="${padL}" cy="${yL(i)}" r="6" fill="${Tk.colors().accent}"/>`;
      s += `<text x="${W-padR+6}" y="${yL(i)+3}" fill="#A4B0C0" font-size="10">${KO[L]}</text>`;
      s += `<circle cx="${W-padR}" cy="${yL(i)}" r="6" fill="${Tk.colors().accent}"/>`;
    });
    // 곡선
    Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0, 30).forEach(([k, n]) => {
      const [a, b] = k.split('|');
      const ai = LAYERS.indexOf(a), bi = LAYERS.indexOf(b);
      if (ai < 0 || bi < 0 || ai === bi) return;
      const y1 = yL(ai), y2 = yL(bi);
      const x1 = padL, x2 = W - padR;
      const cx1 = x1 + innerW * 0.35, cx2 = x2 - innerW * 0.35;
      const w = Math.max(0.6, (n / total) * 28);
      const op = Math.min(0.85, 0.25 + (n / total) * 6);
      const col = Tk.colors().plddt_high;
      s += `<path d="M${x1},${y1}C${cx1},${y1} ${cx2},${y2} ${x2},${y2}" stroke="${col}" stroke-opacity="${op}" stroke-width="${w}" fill="none"/>`;
    });
    s += `<text x="${W/2}" y="${H-2}" text-anchor="middle" fill="#A4B0C0" font-size="9" font-family="ui-monospace">Granger 인과 흐름 (cause → effect, 두께=빈도)</text>`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { edges: Object.keys(counts).length, total };
  }
  if (root.VizEngine) root.VizEngine.register({
    id: 'sankey-map', label: 'Sankey on Map', icon: '🌊',
    supports: scope => !!(scope && scope.causal),
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
