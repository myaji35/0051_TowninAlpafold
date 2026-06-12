// components/npl-dashboard.js
// NPL 포트폴리오 분석 대시보드 (P4) — 위험 히트맵 + 회수 cone 누적 + 신뢰도 분포
// 부모: FEATURE_NPL_PORTFOLIO-001 (P4). 참조: docs/npl-portfolio-architecture.md §4.3
// 데이터: GET /api/v1/npl/* 우선 → data_raw/_npl/portfolio_demo.json fallback
// 모든 집계는 클라이언트 (정적 호스팅 대응).

(function() {
  'use strict';

  var GRADE_COLOR = { very_high: '#00529B', high: '#5BC0EB', medium: '#FED766', low: '#C9485B' };
  var CT_KO = { apt: '아파트', officetel: '오피스텔', commercial: '상가', land: '토지' };
  var REGION_KO = {
    '11680':'서울 강남','11710':'서울 송파','11350':'서울 노원','11500':'서울 강서','11620':'서울 관악',
    '41110':'경기 수원','41130':'경기 성남','41280':'경기 고양','41460':'경기 용인','41150':'경기 의정부','41190':'경기 부천',
    '28177':'인천 미추홀','28260':'인천 서구','26350':'부산 해운대','26230':'부산진','27260':'대구 수성',
    '30200':'대전 유성','29200':'광주 광산','51110':'춘천','43110':'청주','52110':'전주','48120':'창원',
  };

  var state = { items: [] };

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }

  function loadData() {
    return fetch('/api/v1/npl/assets?page_size=500', { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('api'); return r.json(); })
      .then(function(d) { state.items = d.items || []; })
      .catch(function() {
        return fetch('data_raw/_npl/portfolio_demo.json', { cache: 'no-store' })
          .then(function(r) { return r.json(); })
          .then(function(d) { state.items = d.items || []; });
      });
  }

  function renderScreen(container) {
    container.innerHTML = ''
      + '<div class="npl-screen npl-dashboard">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">분석 대시보드</span>'
      +   '</nav>'
      +   '<div class="npl-color-guard" role="note">ⓘ 포트폴리오 전략 분석 — 위험 집중도(지역×담보) · 회수 분포 · 추가 실사 우선순위.</div>'
      +   '<div data-region="dash"></div>'
      + '</div>';
    container.querySelectorAll('[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        if (e.currentTarget.dataset.nav === 'home' && typeof window.switchMode === 'function') window.switchMode('gallery');
      });
    });
    loadData().then(function() { renderDash(container); });
  }

  function renderDash(container) {
    var el = container.querySelector('[data-region="dash"]');
    el.innerHTML = riskHeatmap() + recoveryDist() + confidenceFlags();
  }

  // ── 위험 히트맵 — 지역(행) × 담보(열), 셀 = low등급 비중(위험도) ──
  function riskHeatmap() {
    var byRegion = {};
    state.items.forEach(function(it) {
      var r = it.region_code, c = it.collateral_type;
      byRegion[r] = byRegion[r] || {};
      byRegion[r][c] = byRegion[r][c] || { total: 0, low: 0 };
      byRegion[r][c].total++;
      if (it.grade === 'low') byRegion[r][c].low++;
    });
    // 물건 많은 지역 Top 8
    var regions = Object.keys(byRegion).map(function(r) {
      var t = Object.keys(byRegion[r]).reduce(function(s, c){ return s + byRegion[r][c].total; }, 0);
      return { r: r, total: t };
    }).sort(function(a, b){ return b.total - a.total; }).slice(0, 8);
    var cols = ['apt', 'officetel', 'commercial', 'land'];

    var head = '<tr><th>지역 \\ 담보</th>' + cols.map(function(c){ return '<th>' + CT_KO[c] + '</th>'; }).join('') + '</tr>';
    var rows = regions.map(function(rg) {
      var cells = cols.map(function(c) {
        var d = byRegion[rg.r][c];
        if (!d || !d.total) return '<td class="npl-hm-cell npl-hm-empty">·</td>';
        var risk = d.low / d.total;  // 0~1
        var bg = riskColor(risk);
        return '<td class="npl-hm-cell" style="background:' + bg + '" title="' + d.total + '건, 비추천 ' + d.low + '건">'
          + d.total + '<span class="npl-hm-risk">' + Math.round(risk * 100) + '%</span></td>';
      }).join('');
      return '<tr><td class="npl-hm-region">' + esc(REGION_KO[rg.r] || rg.r) + '</td>' + cells + '</tr>';
    }).join('');

    return '<div class="npl-dash-card">'
      + '<div class="npl-section-head">위험 집중도 — 지역 × 담보유형 (셀 = 물건수, 색 = 비추천 비중)</div>'
      + '<table class="npl-heatmap"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>'
      + '<div class="npl-hm-legend"><span style="background:' + riskColor(0) + '"></span>안전'
      + '<span style="background:' + riskColor(0.5) + '"></span>주의'
      + '<span style="background:' + riskColor(1) + '"></span>위험</div>'
      + '</div>';
  }

  function riskColor(t) {
    // 0(파랑 안전) → 0.5(노랑) → 1(빨강 위험)
    if (t < 0.5) { var k = t / 0.5; return mix([0, 82, 155], [254, 215, 102], k); }
    var k2 = (t - 0.5) / 0.5; return mix([254, 215, 102], [201, 72, 91], k2);
  }
  function mix(a, b, t) {
    var r = Math.round(a[0] + (b[0]-a[0])*t), g = Math.round(a[1] + (b[1]-a[1])*t), bl = Math.round(a[2] + (b[2]-a[2])*t);
    return 'rgba(' + r + ',' + g + ',' + bl + ',0.82)';
  }

  // ── 회수 cone 누적 — 등급별 총 회수 p10/p50/p90 적층 ──
  function recoveryDist() {
    var grades = ['very_high', 'high', 'medium', 'low'];
    var agg = {};
    grades.forEach(function(g){ agg[g] = { p10: 0, p50: 0, p90: 0, n: 0 }; });
    state.items.forEach(function(it) {
      var a = agg[it.grade]; if (!a) return;
      a.p10 += it.recovery_p10 || 0; a.p50 += it.recovery_p50 || 0; a.p90 += it.recovery_p90 || 0; a.n++;
    });
    var maxP90 = Math.max.apply(null, grades.map(function(g){ return agg[g].p90; })) || 1;
    var rows = grades.map(function(g) {
      var a = agg[g];
      if (!a.n) return '';
      var w10 = a.p10 / maxP90 * 100, w50 = a.p50 / maxP90 * 100, w90 = a.p90 / maxP90 * 100;
      return '<div class="npl-rcone-row">'
        + '<span class="npl-rcone-label" style="color:' + GRADE_COLOR[g] + '">' + gradeKo(g) + ' (' + a.n + '건)</span>'
        + '<span class="npl-rcone-track">'
        +   '<span class="npl-rcone-band" style="width:' + w90 + '%;background:' + GRADE_COLOR[g] + '22"></span>'
        +   '<span class="npl-rcone-band" style="width:' + w50 + '%;background:' + GRADE_COLOR[g] + '66"></span>'
        +   '<span class="npl-rcone-p50mark" style="left:' + w50 + '%"></span>'
        + '</span>'
        + '<span class="npl-rcone-val">' + fmtMan(a.p50) + '</span>'
        + '</div>';
    }).join('');
    return '<div class="npl-dash-card">'
      + '<div class="npl-section-head">등급별 회수 cone 누적 (진한 막대 = p50, 옅은 막대 = p90 상한)</div>'
      + rows + '</div>';
  }

  // ── 신뢰도 분포 — 추가 실사 우선순위 (낮은 신뢰도 플래그) ──
  function confidenceFlags() {
    var buckets = [
      { label: '높음 (≥70%)', min: 0.7, color: '#00529B', n: 0 },
      { label: '보통 (50~70%)', min: 0.5, color: '#5BC0EB', n: 0 },
      { label: '낮음 (<50%) — 실사 권장', min: 0, color: '#C9485B', n: 0 },
    ];
    state.items.forEach(function(it) {
      var c = it.confidence || 0;
      if (c >= 0.7) buckets[0].n++; else if (c >= 0.5) buckets[1].n++; else buckets[2].n++;
    });
    var total = state.items.length || 1;
    var rows = buckets.map(function(b) {
      var pct = Math.round(b.n / total * 100);
      return '<div class="npl-conf-row">'
        + '<span class="npl-conf-label" style="color:' + b.color + '">' + b.label + '</span>'
        + '<span class="npl-conf-track"><span class="npl-conf-fill2" style="width:' + pct + '%;background:' + b.color + '"></span></span>'
        + '<span class="npl-conf-num">' + b.n + '건</span></div>';
    }).join('');
    return '<div class="npl-dash-card">'
      + '<div class="npl-section-head">신뢰도 분포 — 추가 실사 우선순위 (객관성: 평가 신뢰 수준)</div>'
      + rows + '</div>';
  }

  function gradeKo(g) { return { very_high:'적극 매수', high:'매수 검토', medium:'관망/검토', low:'비추천' }[g] || g; }

  window.renderNplDashboard = function(container) {
    if (!container) return;
    state.items = [];
    renderScreen(container);
  };
})();
