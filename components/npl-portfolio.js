// components/npl-portfolio.js
// NPL 포트폴리오 목록 화면 (P2) — KPI + 등급분포 + IRR분포 + 필터 + 페이지네이션 테이블
// 부모: GENERATE_CODE_NPL_PORTFOLIO_VIEW-001
// 데이터: GET /api/v1/npl/* (백엔드) 실패 시 data_raw/_npl/portfolio_demo.json fallback
//   (data-studio-datasets.js와 동일 패턴 — 정적 호스팅에서도 작동)

(function() {
  'use strict';

  var GRADE = {
    very_high: { ko: '적극 매수', color: '#00529B' },
    high:      { ko: '매수 검토', color: '#5BC0EB' },
    medium:    { ko: '관망/검토', color: '#FED766' },
    low:       { ko: '비추천',   color: '#C9485B' },
  };

  var state = { items: [], summary: null, distribution: null,
                filter: { grade: '', collateral_type: '', eval_type: '' },
                page: 1, pageSize: 15, loaded: false };

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }

  // ── 데이터 로드: API 우선 → 정적 JSON fallback ──
  function loadData() {
    return fetch('/api/v1/npl/assets?page_size=200', { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('api'); return r.json(); })
      .then(function(d) {
        state.items = d.items || [];
        return Promise.all([
          fetch('/api/v1/npl/portfolio/summary').then(function(r){return r.json();}),
          fetch('/api/v1/npl/portfolio/distribution?metric=irr&bins=12').then(function(r){return r.json();}),
        ]);
      })
      .then(function(arr) { state.summary = arr[0]; state.distribution = arr[1]; })
      .catch(function() {
        // fallback — 정적 데모 JSON (라이브 정적 호스팅)
        return fetch('data_raw/_npl/portfolio_demo.json', { cache: 'no-store' })
          .then(function(r) { return r.json(); })
          .then(function(d) { state.items = d.items || []; state.summary = d.summary; state.distribution = d.distribution; });
      });
  }

  function filtered() {
    var f = state.filter;
    return state.items.filter(function(it) {
      if (f.grade && it.grade !== f.grade) return false;
      if (f.collateral_type && it.collateral_type !== f.collateral_type) return false;
      if (f.eval_type && it.eval_type !== f.eval_type) return false;
      return true;
    });
  }

  function renderScreen(container) {
    container.innerHTML = ''
      + '<div class="npl-screen npl-portfolio">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">포트폴리오</span>'
      +   '</nav>'
      +   '<div class="npl-color-guard" role="note">ⓘ 자산 평가의 객관성 — 각 물건은 회수 cone(p10~p90) + 신뢰도 기반. 등급은 IRR/추천 강도.</div>'
      +   '<div data-region="kpi" class="npl-pf-kpi"></div>'
      +   '<div class="npl-pf-filters" data-region="filters"></div>'
      +   '<div data-region="table" class="npl-pf-table-wrap"></div>'
      + '</div>';
    bindNav(container);
    loadData().then(function() {
      state.loaded = true;
      renderKpi(container);
      renderFilters(container);
      renderTable(container);
    });
  }

  function bindNav(container) {
    container.querySelectorAll('[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var t = e.currentTarget.dataset.nav;
        if (t === 'home' && typeof window.switchMode === 'function') window.switchMode('gallery');
      });
    });
  }

  function renderKpi(container) {
    var s = state.summary || { total: 0, grade_distribution: {}, total_recovery_cone: {}, avg_confidence: 0 };
    var gd = s.grade_distribution || {};
    var total = s.total || 0;
    var bars = ['very_high', 'high', 'medium', 'low'].map(function(g) {
      var n = gd[g] || 0, pct = total ? Math.round(n / total * 100) : 0;
      return '<div class="npl-gradebar-row">'
        + '<span class="npl-gradebar-label" style="color:' + GRADE[g].color + '">' + GRADE[g].ko + '</span>'
        + '<span class="npl-gradebar-track"><span class="npl-gradebar-fill" style="width:' + pct + '%;background:' + GRADE[g].color + '"></span></span>'
        + '<span class="npl-gradebar-num">' + n + '건 (' + pct + '%)</span></div>';
    }).join('');
    var cone = s.total_recovery_cone || {};

    container.querySelector('[data-region="kpi"]').innerHTML = ''
      + '<div class="npl-pf-kpi-grid">'
      +   '<div class="npl-kpi-card"><div class="npl-kpi-label">총 물건</div><div class="npl-kpi-value">' + total + '<span class="pd-score-unit">건</span></div></div>'
      +   '<div class="npl-kpi-card"><div class="npl-kpi-label">총 회수 cone (p50)</div><div class="npl-kpi-value">' + fmtMan(cone.p50) + '</div><div class="npl-kpi-sub">p10 ' + fmtMan(cone.p10) + ' ~ p90 ' + fmtMan(cone.p90) + '</div></div>'
      +   '<div class="npl-kpi-card"><div class="npl-kpi-label">평균 신뢰도</div><div class="npl-kpi-value">' + Math.round((s.avg_confidence || 0) * 100) + '<span class="pd-score-unit">%</span></div></div>'
      +   '<div class="npl-kpi-card npl-kpi-grades"><div class="npl-kpi-label">등급 분포</div>' + bars + '</div>'
      + '</div>'
      + renderDistribution();
  }

  function renderDistribution() {
    var d = state.distribution;
    if (!d || !d.bins || !d.bins.length) return '';
    var maxC = Math.max.apply(null, d.bins.map(function(b){ return b.count; })) || 1;
    var bars = d.bins.map(function(b) {
      var h = Math.round(b.count / maxC * 100);
      var mid = (b.lo + b.hi) / 2;
      var color = mid >= 0.25 ? '#00529B' : mid >= 0.15 ? '#5BC0EB' : mid >= 0.05 ? '#FED766' : '#C9485B';
      return '<div class="npl-hist-bar" title="IRR ' + (b.lo*100).toFixed(0) + '~' + (b.hi*100).toFixed(0) + '% : ' + b.count + '건" '
        + 'style="height:' + Math.max(3, h) + '%;background:' + color + '"></div>';
    }).join('');
    return '<div class="npl-hist-card">'
      + '<div class="npl-section-head">IRR 분포 — 포트폴리오 전체 (객관성: 한 물건이 분포 어디에 있는지)</div>'
      + '<div class="npl-hist">' + bars + '</div>'
      + '<div class="npl-hist-axis"><span>저수익 ' + ((d.min||0)*100).toFixed(0) + '%</span><span>고수익 ' + ((d.max||0)*100).toFixed(0) + '%</span></div>'
      + '</div>';
  }

  function renderFilters(container) {
    function sel(key, label, opts) {
      var o = '<option value="">' + label + ' 전체</option>' + opts.map(function(op) {
        return '<option value="' + op[0] + '"' + (state.filter[key] === op[0] ? ' selected' : '') + '>' + op[1] + '</option>';
      }).join('');
      return '<select class="npl-pf-filter" data-filter="' + key + '">' + o + '</select>';
    }
    container.querySelector('[data-region="filters"]').innerHTML =
        sel('grade', '등급', [['very_high','적극 매수'],['high','매수 검토'],['medium','관망/검토'],['low','비추천']])
      + sel('eval_type', '유형', [['buy','매수'],['sell','매도']])
      + sel('collateral_type', '담보', [['apt','아파트'],['officetel','오피스텔'],['commercial','상가'],['land','토지']])
      + '<span class="npl-pf-count" data-region="count"></span>';
    container.querySelectorAll('[data-filter]').forEach(function(s) {
      s.addEventListener('change', function(e) {
        state.filter[e.target.dataset.filter] = e.target.value;
        state.page = 1;
        renderTable(container);
      });
    });
  }

  function renderTable(container) {
    var rows = filtered();
    var totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    var pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    var cnt = container.querySelector('[data-region="count"]');
    if (cnt) cnt.textContent = rows.length + '건';

    var body = pageRows.map(function(it) {
      var g = GRADE[it.grade] || { ko: it.grade, color: '#999' };
      var metric = it.eval_type === 'buy'
        ? (it.score_irr != null ? (it.score_irr * 100).toFixed(1) + '%' : '-')
        : fmtMan(it.score_npv);
      return '<tr data-asset-id="' + esc(it.id) + '">'
        + '<td class="npl-td-id">' + esc(it.id) + '</td>'
        + '<td>' + esc(it.address || '-') + '</td>'
        + '<td>' + (it.eval_type === 'buy' ? '매수' : '매도') + '</td>'
        + '<td>' + esc(it.collateral_type || '-') + '</td>'
        + '<td class="npl-td-metric">' + metric + '</td>'
        + '<td><span class="npl-td-grade" style="background:' + g.color + ';color:#fff">' + g.ko + '</span></td>'
        + '<td class="npl-td-conf">' + Math.round((it.confidence || 0) * 100) + '%</td>'
        + '<td class="npl-td-cone">' + fmtMan(it.recovery_p10) + '~' + fmtMan(it.recovery_p90) + '</td>'
        + '</tr>';
    }).join('');

    var pager = '';
    if (totalPages > 1) {
      pager = '<div class="npl-pager">'
        + '<button class="npl-pager-btn" data-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>‹ 이전</button>'
        + '<span class="npl-pager-info">' + state.page + ' / ' + totalPages + '</span>'
        + '<button class="npl-pager-btn" data-page="next"' + (state.page >= totalPages ? ' disabled' : '') + '>다음 ›</button>'
        + '</div>';
    }

    container.querySelector('[data-region="table"]').innerHTML =
        '<table class="npl-pf-table"><thead><tr>'
      + '<th>ID</th><th>주소</th><th>유형</th><th>담보</th><th>IRR/NPV</th><th>등급</th><th>신뢰도</th><th>회수 cone</th>'
      + '</tr></thead><tbody>' + (body || '<tr><td colspan="8" class="npl-td-empty">조건에 맞는 물건이 없습니다</td></tr>') + '</tbody></table>'
      + pager;

    container.querySelectorAll('[data-page]').forEach(function(b) {
      b.addEventListener('click', function() {
        if (b.dataset.page === 'prev' && state.page > 1) state.page--;
        if (b.dataset.page === 'next' && state.page < totalPages) state.page++;
        renderTable(container);
      });
    });
  }

  window.renderNplPortfolio = function(container) {
    if (!container) return;
    state.page = 1; state.filter = { grade: '', collateral_type: '', eval_type: '' };
    renderScreen(container);
  };
})();
