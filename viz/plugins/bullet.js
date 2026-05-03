// viz/plugins/bullet.js — KPI 목표 vs 실적 (5개 핵심 레이어)
(function (root) {
  'use strict';
  const KPIS = [
    { id:'visitors_total', label:'유동인구',   targetMul: 1.20 },
    { id:'land_price',     label:'공시지가',   targetMul: 1.15 },
    { id:'biz_count',      label:'소상공인',   targetMul: 1.10 },
    { id:'biz_cafe',       label:'카페 수',    targetMul: 1.30 },
    { id:'tx_volume',      label:'거래량',     targetMul: 1.25 },
  ];
  function render(target, data, scales, scope) {
    const svg = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!svg) return null;
    const Tk = root.VizTokens;
    const dongs = (data && data.dongs) || [];
    if (!dongs.length) { svg.innerHTML = ''; return null; }
    // 서울 평균 (부산 비교 동 제외)
    const seoul = dongs.filter(d => !d.name.startsWith('부산'));
    const W = 640, H = 260, padL = 100, padR = 80, padT = 12, padB = 12, gap = 14;
    const innerW = W - padL - padR;
    const rowH = (H - padT - padB - gap * (KPIS.length - 1)) / KPIS.length;
    let s = `<rect width="${W}" height="${H}" fill="${Tk.colors().surface}"/>`;
    KPIS.forEach((k, i) => {
      const valStart = avg(seoul, k.id, 0);
      const valNow = avg(seoul, k.id, 59);
      const target = valStart * k.targetMul;
      const max = Math.max(valStart, valNow, target) * 1.1;
      const y0 = padT + i * (rowH + gap);
      const wStart = (valStart / max) * innerW;
      const wNow = (valNow / max) * innerW;
      const xT = padL + (target / max) * innerW;
      const ratioToTarget = valNow / (target || 1);
      const col = ratioToTarget >= 1 ? Tk.colors().plddt_high
                : ratioToTarget >= 0.85 ? Tk.colors().plddt_mid
                : ratioToTarget >= 0.7 ? Tk.colors().plddt_low
                : Tk.colors().plddt_poor;
      // 배경 (max)
      s += `<rect x="${padL}" y="${y0}" width="${innerW}" height="${rowH}" fill="${Tk.colors().surface_alt}"/>`;
      // 시작값
      s += `<rect x="${padL}" y="${y0}" width="${wStart}" height="${rowH}" fill="${Tk.colors().border}"/>`;
      // 현재값
      s += `<rect x="${padL}" y="${y0+rowH/4}" width="${wNow}" height="${rowH/2}" fill="${col}"/>`;
      // 타깃 마커
      s += `<line x1="${xT}" y1="${y0-2}" x2="${xT}" y2="${y0+rowH+2}" stroke="${Tk.colors().text_primary}" stroke-width="2"/>`;
      // 라벨
      s += `<text x="${padL-6}" y="${y0+rowH/2+3}" text-anchor="end" fill="${Tk.colors().text_secondary}" font-size="10">${k.label}</text>`;
      const pct = (ratioToTarget * 100).toFixed(0) + '%';
      s += `<text x="${padL+innerW+4}" y="${y0+rowH/2+3}" fill="${col}" font-size="10" font-family="ui-monospace">${pct}</text>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = s;
    return { kpis: KPIS.length };
  }
  function avg(arr, layer, m) {
    const vs = arr.map(d => d.layers && d.layers[layer] ? d.layers[layer][m] : null).filter(v => v != null);
    return vs.length ? vs.reduce((s,v)=>s+v,0)/vs.length : 0;
  }
  if (root.VizEngine) root.VizEngine.register({
    id: 'bullet', label: 'Bullet (KPI vs Target)', icon: '🎯',
    supports: scope => Array.isArray(scope.dongs) && scope.dongs.length > 0,
    render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
