// components/npl-rwa-market.js
// NPL→RWA 조각투자 마켓플레이스 (NPL_RWA_FRACTIONAL_UI-001)
// 화면 4영역: ① 토큰 마켓플레이스 ② 조각 매수 플로우 ③ 투자자 보유 포트폴리오 ④ STO 위험고지
//
// 데이터: 백엔드 API (아직 미연결 — 주석 참고) 실패 시 인라인 데모 데이터로 작동.
//   - GET /api/v1/rwa/tokens?status=open          → 발행 토큰 목록
//   - GET /api/v1/rwa/tokens/:id                  → 토큰 상세
//   - POST /api/v1/rwa/tokens/:id/subscribe       → 청약
//   - GET /api/v1/rwa/holdings?investor_id=me     → 내 보유 토큰 목록
//
// 기초자산 모델: backend/npl_rwa_token.py (token_issue / token_holding / distribution_event)

(function() {
  'use strict';

  // ── 공통 상수 ────────────────────────────────────────────────────────────────
  var GRADE = {
    very_high: { ko: '적극 매수', color: '#00529B' },
    high:      { ko: '매수 검토', color: '#5BC0EB' },
    medium:    { ko: '관망/검토', color: '#FED766' },
    low:       { ko: '비추천',   color: '#C9485B' },
  };

  var STATUS_BADGE = {
    open:     { ko: '청약 가능',   bg: '#e8f5e9', color: '#1b5e20' },
    closed:   { ko: '청약 마감',   bg: '#f3f4f6', color: '#6b7280' },
    draft:    { ko: '준비중',      bg: '#fef9c3', color: '#713f12' },
    redeemed: { ko: '상환 완료',   bg: '#e8f0fe', color: '#1a237e' },
  };

  var CT_KO = { apt: '아파트', officetel: '오피스텔', commercial: '상가', land: '토지' };

  var MIN_SUB_KRW = 10000000; // 최소 청약금액 1,000만원

  // ── 전역 상태 ─────────────────────────────────────────────────────────────────
  var state = {
    tokens: [],            // 토큰 마켓 목록
    holdings: [],          // 내 보유 목록
    filter: { collateral_type: '', region: '', irr_min: '', status: '' },
    tab: 'market',         // 'market' | 'portfolio'
    // 청약 모달
    modal: {
      open: false,
      token: null,
      qty: 0,
      risk_agreed: false,
    },
  };

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────────
  function fmtMan(v) {
    var n = +v || 0;
    return n >= 10000 ? (Math.round(n / 1000) / 10) + '억' : Math.round(n) + '만';
  }
  function fmtKrw(v) {
    var n = +v || 0;
    if (n >= 100000000) return (Math.round(n / 10000000) / 10) + '억';
    if (n >= 10000) return Math.round(n / 10000) + '만';
    return n.toLocaleString();
  }
  function fmtPct(v) { return ((+v || 0) * 100).toFixed(1) + '%'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 데모 데이터 (백엔드 API 미연결 시 fallback) ───────────────────────────────
  function getDemoTokens() {
    return [
      {
        id: 'TKN-A3F8C1D2',
        token_name: 'NPL-서울강남-APT-2024-1',
        spc_id: 'SPC-001',
        security_type: 'revenue_share',
        total_tokens: 1000,
        price_per_token: 100000,          // 1토큰 = 10만원
        min_subscription: 100,            // 최소 100토큰 = 1,000만원
        subscribed_tokens: 370,
        pool_total_claim: 2500000000,     // 기초자산 채권 25억
        pool_recovery_p10: 1600000000,
        pool_recovery_p50: 2100000000,
        pool_recovery_p90: 2700000000,
        pool_confidence: 0.78,
        expected_irr: 0.182,
        maturity_date: '2027-06-30',
        status: 'open',
        collateral_type: 'apt',
        region: '서울 강남',
        asset_count: 4,
        grade: 'very_high',
      },
      {
        id: 'TKN-B7E2A4F1',
        token_name: 'NPL-경기수원-MIX-2024-2',
        spc_id: 'SPC-002',
        security_type: 'revenue_share',
        total_tokens: 2000,
        price_per_token: 50000,           // 1토큰 = 5만원
        min_subscription: 200,
        subscribed_tokens: 1640,
        pool_total_claim: 4200000000,
        pool_recovery_p10: 2800000000,
        pool_recovery_p50: 3500000000,
        pool_recovery_p90: 4300000000,
        pool_confidence: 0.65,
        expected_irr: 0.153,
        maturity_date: '2026-12-31',
        status: 'open',
        collateral_type: 'officetel',
        region: '경기 수원',
        asset_count: 8,
        grade: 'high',
      },
      {
        id: 'TKN-C1D9E5B3',
        token_name: 'NPL-인천미추홀-상가-2024-3',
        spc_id: 'SPC-003',
        security_type: 'investment_contract',
        total_tokens: 500,
        price_per_token: 200000,
        min_subscription: 50,
        subscribed_tokens: 500,
        pool_total_claim: 1800000000,
        pool_recovery_p10: 800000000,
        pool_recovery_p50: 1100000000,
        pool_recovery_p90: 1600000000,
        pool_confidence: 0.52,
        expected_irr: 0.095,
        maturity_date: '2026-06-30',
        status: 'closed',
        collateral_type: 'commercial',
        region: '인천 미추홀',
        asset_count: 3,
        grade: 'medium',
      },
      {
        id: 'TKN-D4F1C8A6',
        token_name: 'NPL-부산해운대-APT-2024-4',
        spc_id: 'SPC-004',
        security_type: 'revenue_share',
        total_tokens: 3000,
        price_per_token: 30000,
        min_subscription: 334,
        subscribed_tokens: 900,
        pool_total_claim: 3600000000,
        pool_recovery_p10: 2400000000,
        pool_recovery_p50: 3100000000,
        pool_recovery_p90: 3900000000,
        pool_confidence: 0.71,
        expected_irr: 0.167,
        maturity_date: '2027-03-31',
        status: 'open',
        collateral_type: 'apt',
        region: '부산 해운대',
        asset_count: 6,
        grade: 'high',
      },
    ];
  }

  function getDemoHoldings() {
    return [
      {
        id: 'HLD-001',
        issue_id: 'TKN-A3F8C1D2',
        token_name: 'NPL-서울강남-APT-2024-1',
        qty: 200,
        purchase_price: 100000,
        distributed_total: 620000,
        subscribed_at: '2024-11-15',
        pool_recovery_p10: 1600000000,
        pool_recovery_p50: 2100000000,
        pool_recovery_p90: 2700000000,
        pool_confidence: 0.78,
        total_tokens: 1000,
        expected_irr: 0.182,
        collateral_type: 'apt',
        region: '서울 강남',
        status: 'open',
      },
      {
        id: 'HLD-002',
        issue_id: 'TKN-B7E2A4F1',
        token_name: 'NPL-경기수원-MIX-2024-2',
        qty: 400,
        purchase_price: 50000,
        distributed_total: 3200000,
        subscribed_at: '2024-09-01',
        pool_recovery_p10: 2800000000,
        pool_recovery_p50: 3500000000,
        pool_recovery_p90: 4300000000,
        pool_confidence: 0.65,
        total_tokens: 2000,
        expected_irr: 0.153,
        collateral_type: 'officetel',
        region: '경기 수원',
        status: 'open',
      },
    ];
  }

  // ── 데이터 로드 ───────────────────────────────────────────────────────────────
  function loadMarket() {
    // 실제 API: GET /api/v1/rwa/tokens?status=open
    return fetch('/api/v1/rwa/tokens', { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('api'); return r.json(); })
      .then(function(d) { state.tokens = d.items || d || []; })
      .catch(function() {
        state.tokens = getDemoTokens();
      });
  }

  function loadHoldings() {
    // 실제 API: GET /api/v1/rwa/holdings?investor_id=me
    return fetch('/api/v1/rwa/holdings?investor_id=me', { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error('api'); return r.json(); })
      .then(function(d) { state.holdings = d.items || d || []; })
      .catch(function() {
        state.holdings = getDemoHoldings();
      });
  }

  // ── 필터 ─────────────────────────────────────────────────────────────────────
  function filteredTokens() {
    var f = state.filter;
    return state.tokens.filter(function(tk) {
      if (f.collateral_type && tk.collateral_type !== f.collateral_type) return false;
      if (f.region && tk.region !== f.region) return false;
      if (f.status && tk.status !== f.status) return false;
      if (f.irr_min) {
        var minIrr = parseFloat(f.irr_min) / 100;
        if ((tk.expected_irr || 0) < minIrr) return false;
      }
      return true;
    });
  }

  // ── 메인 화면 렌더 ────────────────────────────────────────────────────────────
  function renderScreen(container) {
    container.innerHTML =
      '<div class="npl-screen npl-rwa-market">'
      + '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +   '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +   '<span class="pd-breadcrumb-sep">›</span>'
      +   '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +   '<span class="pd-breadcrumb-sep">›</span>'
      +   '<span class="pd-breadcrumb-current">RWA 조각투자 마켓</span>'
      + '</nav>'
      + '<div class="npl-color-guard rwa-guard" role="note">'
      +   '⚠ 본 화면은 NPL 기초자산 STO(증권형 토큰) 마켓플레이스입니다. '
      +   '투자 전 위험고지 동의 필수 · 원금손실 가능 · 예금자보호 비대상.'
      + '</div>'
      + '<div class="rwa-tabs" role="tablist">'
      +   '<button class="rwa-tab' + (state.tab === 'market' ? ' rwa-tab--active' : '') + '" data-tab="market" role="tab" aria-selected="' + (state.tab === 'market') + '">토큰 마켓플레이스</button>'
      +   '<button class="rwa-tab' + (state.tab === 'portfolio' ? ' rwa-tab--active' : '') + '" data-tab="portfolio" role="tab" aria-selected="' + (state.tab === 'portfolio') + '">내 보유 포트폴리오</button>'
      + '</div>'
      + '<div data-region="main"></div>'
      + '</div>'
      + renderSubscribeModal()
      + renderRiskModal();

    bindNav(container);
    bindTabs(container);

    Promise.all([loadMarket(), loadHoldings()]).then(function() {
      renderMainRegion(container);
    });
  }

  function bindNav(container) {
    container.querySelectorAll('[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var t = e.currentTarget.dataset.nav;
        if (t === 'home' && typeof window.switchMode === 'function') window.switchMode('gallery');
        if (t === 'npl' && typeof window.switchMode === 'function') window.switchMode('npl-portfolio');
      });
    });
  }

  function bindTabs(container) {
    container.querySelectorAll('[data-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.tab = btn.dataset.tab;
        // 탭 active 토글
        container.querySelectorAll('[data-tab]').forEach(function(b) {
          b.classList.toggle('rwa-tab--active', b.dataset.tab === state.tab);
          b.setAttribute('aria-selected', b.dataset.tab === state.tab);
        });
        renderMainRegion(container);
      });
    });
  }

  function renderMainRegion(container) {
    var region = container.querySelector('[data-region="main"]');
    if (!region) return;
    if (state.tab === 'market') {
      region.innerHTML = renderMarketSection();
      bindMarketEvents(container);
    } else {
      region.innerHTML = renderPortfolioSection();
      bindPortfolioEvents(container);
    }
  }

  // ── 영역 1: 토큰 마켓플레이스 ─────────────────────────────────────────────────
  function renderMarketSection() {
    var list = filteredTokens();

    return '<div class="rwa-market-wrap">'
      + renderMarketFilters()
      + '<div class="rwa-market-count">' + list.length + '개 토큰</div>'
      + '<div class="rwa-token-grid">'
      + (list.length
          ? list.map(renderTokenCard).join('')
          : '<div class="npl-empty">조건에 맞는 토큰이 없습니다</div>')
      + '</div>'
      + '</div>';
  }

  function renderMarketFilters() {
    function sel(key, label, opts) {
      var o = '<option value="">' + label + ' 전체</option>'
        + opts.map(function(op) {
          return '<option value="' + op[0] + '"' + (state.filter[key] === op[0] ? ' selected' : '') + '>' + op[1] + '</option>';
        }).join('');
      return '<select class="npl-pf-filter rwa-filter" data-rwa-filter="' + key + '">' + o + '</select>';
    }
    return '<div class="npl-pf-filters rwa-filters">'
      + sel('collateral_type', '담보유형', [['apt','아파트'],['officetel','오피스텔'],['commercial','상가'],['land','토지']])
      + sel('region', '지역', [['서울 강남','서울 강남'],['경기 수원','경기 수원'],['인천 미추홀','인천 미추홀'],['부산 해운대','부산 해운대']])
      + '<select class="npl-pf-filter rwa-filter" data-rwa-filter="irr_min">'
      +   '<option value="">예상IRR 전체</option>'
      +   '<option value="10"' + (state.filter.irr_min === '10' ? ' selected' : '') + '>IRR 10%↑</option>'
      +   '<option value="15"' + (state.filter.irr_min === '15' ? ' selected' : '') + '>IRR 15%↑</option>'
      +   '<option value="18"' + (state.filter.irr_min === '18' ? ' selected' : '') + '>IRR 18%↑</option>'
      + '</select>'
      + sel('status', '발행상태', [['open','청약 가능'],['closed','청약 마감'],['draft','준비중'],['redeemed','상환 완료']])
      + '</div>';
  }

  function renderTokenCard(tk) {
    var sb = STATUS_BADGE[tk.status] || { ko: tk.status, bg: '#f3f4f6', color: '#6b7280' };
    var remaining = (tk.total_tokens - (tk.subscribed_tokens || 0));
    var subPct = Math.round((tk.subscribed_tokens || 0) / tk.total_tokens * 100);
    var g = GRADE[tk.grade] || { ko: '-', color: '#9ca3af' };
    var isOpen = tk.status === 'open' && remaining > 0;

    return '<div class="rwa-token-card" data-token-id="' + esc(tk.id) + '">'
      + '<div class="rwa-token-card-head">'
      +   '<span class="rwa-status-badge" style="background:' + sb.bg + ';color:' + sb.color + '">' + sb.ko + '</span>'
      +   '<span class="rwa-grade-badge" style="background:' + g.color + ';color:#fff">' + g.ko + '</span>'
      + '</div>'
      + '<div class="rwa-token-name">' + esc(tk.token_name) + '</div>'
      + '<div class="rwa-token-meta">'
      +   '<span>' + (CT_KO[tk.collateral_type] || tk.collateral_type || '-') + '</span>'
      +   '<span>' + esc(tk.region || '-') + '</span>'
      +   '<span>기초자산 ' + (tk.asset_count || '-') + '건</span>'
      +   '<span>' + (tk.security_type === 'revenue_share' ? '수익증권' : '투자계약증권') + '</span>'
      + '</div>'
      + '<div class="rwa-token-kpi-row">'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">토큰 단가</div><div class="rwa-kpi-val">' + fmtKrw(tk.price_per_token) + '원</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">예상 IRR</div><div class="rwa-kpi-val rwa-irr-val">' + fmtPct(tk.expected_irr) + '</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">잔여 수량</div><div class="rwa-kpi-val">' + remaining.toLocaleString() + '개</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">만기</div><div class="rwa-kpi-val rwa-maturity">' + esc(tk.maturity_date || '-') + '</div></div>'
      + '</div>'
      + renderMiniCone(tk)
      + '<div class="rwa-sub-bar-wrap">'
      +   '<div class="rwa-sub-bar-track"><div class="rwa-sub-bar-fill" style="width:' + subPct + '%"></div></div>'
      +   '<div class="rwa-sub-bar-label">청약 ' + subPct + '% 완료 (' + (tk.subscribed_tokens || 0).toLocaleString() + '/' + tk.total_tokens.toLocaleString() + '개)</div>'
      + '</div>'
      + (isOpen
          ? '<button class="rwa-subscribe-btn" data-action="subscribe" data-token-id="' + esc(tk.id) + '">청약하기</button>'
          : '<button class="rwa-subscribe-btn rwa-subscribe-btn--disabled" disabled>' + sb.ko + '</button>')
      + '</div>';
  }

  // 미니 회수 cone 시각화 (p10~p50~p90)
  function renderMiniCone(tk) {
    var p10 = tk.pool_recovery_p10 || 0;
    var p50 = tk.pool_recovery_p50 || 0;
    var p90 = tk.pool_recovery_p90 || 0;
    var conf = tk.pool_confidence || 0;
    if (!p50) return '';

    var span = (p90 - p10) || 1;
    var p50pos = Math.round((p50 - p10) / span * 100);
    var confColor = conf >= 0.7 ? '#00529B' : conf >= 0.5 ? '#5BC0EB' : '#C9485B';

    return '<div class="rwa-cone-wrap">'
      + '<div class="rwa-cone-label">회수 cone <span class="rwa-conf-badge" style="background:' + confColor + '22;color:' + confColor + '">신뢰도 ' + Math.round(conf * 100) + '%</span></div>'
      + '<div class="npl-cone-bar rwa-cone-bar">'
      +   '<div class="npl-cone-p50" style="left:' + p50pos + '%"></div>'
      + '</div>'
      + '<div class="npl-cone-vals rwa-cone-vals">'
      +   '<span>p10 ' + fmtMan(p10) + '</span>'
      +   '<span style="font-weight:700">p50 ' + fmtMan(p50) + '</span>'
      +   '<span>p90 ' + fmtMan(p90) + '</span>'
      + '</div>'
      + '</div>';
  }

  function bindMarketEvents(container) {
    // 필터 변경
    container.querySelectorAll('[data-rwa-filter]').forEach(function(sel) {
      sel.addEventListener('change', function(e) {
        state.filter[e.target.dataset.rwaFilter] = e.target.value;
        var region = container.querySelector('[data-region="main"]');
        if (region) {
          region.innerHTML = renderMarketSection();
          bindMarketEvents(container);
        }
      });
    });

    // 청약 버튼 → 위험고지 모달
    container.querySelectorAll('[data-action="subscribe"]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tokenId = btn.dataset.tokenId;
        var tk = state.tokens.filter(function(t) { return t.id === tokenId; })[0];
        if (!tk) return;
        state.modal.token = tk;
        state.modal.qty = tk.min_subscription;
        state.modal.risk_agreed = false;
        openRiskModal(container);
      });
    });
  }

  // ── 영역 3: 투자자 보유 포트폴리오 ───────────────────────────────────────────
  function renderPortfolioSection() {
    if (!state.holdings.length) {
      return '<div class="rwa-portfolio-wrap">'
        + '<div class="npl-empty">보유 중인 토큰이 없습니다. 마켓플레이스에서 청약하세요.</div>'
        + '<div style="text-align:center;margin-top:16px"><button class="rwa-subscribe-btn" onclick="this.closest(\'[class*=npl-rwa]\').querySelector(\'[data-tab=market]\').click()">마켓 보러가기</button></div>'
        + '</div>';
    }

    var totalPrincipal = state.holdings.reduce(function(s, h) { return s + h.qty * h.purchase_price; }, 0);
    var totalDistributed = state.holdings.reduce(function(s, h) { return s + (h.distributed_total || 0); }, 0);
    var totalP50 = state.holdings.reduce(function(s, h) {
      // 내 지분 = qty / total_tokens * pool_recovery_p50
      var share = h.total_tokens ? h.qty / h.total_tokens : 0;
      return s + (h.pool_recovery_p50 || 0) * share;
    }, 0);

    var kpi = '<div class="npl-pf-kpi-grid rwa-pf-kpi">'
      + '<div class="npl-kpi-card"><div class="npl-kpi-label">투자 원금 합계</div><div class="npl-kpi-value">' + fmtMan(totalPrincipal) + '</div></div>'
      + '<div class="npl-kpi-card"><div class="npl-kpi-label">수취 분배금 누계</div><div class="npl-kpi-value">' + fmtMan(totalDistributed) + '</div></div>'
      + '<div class="npl-kpi-card"><div class="npl-kpi-label">예상 회수 중앙값 (p50)</div><div class="npl-kpi-value">' + fmtMan(totalP50) + '</div><div class="npl-kpi-sub">신뢰구간 포함 — 아래 상세 참고</div></div>'
      + '<div class="npl-kpi-card"><div class="npl-kpi-label">보유 토큰 종류</div><div class="npl-kpi-value">' + state.holdings.length + '<span class="pd-score-unit">종</span></div></div>'
      + '</div>';

    var objNote = '<div class="rwa-obj-note">ⓘ 한 점 숫자 금지 원칙 — 아래 각 보유는 회수 cone(p10~p90)과 신뢰도(pLDDT 스타일)를 함께 표시합니다.</div>';

    var cards = state.holdings.map(renderHoldingCard).join('');

    return '<div class="rwa-portfolio-wrap">' + kpi + objNote + cards + '</div>';
  }

  function renderHoldingCard(h) {
    var principal = h.qty * h.purchase_price;
    var share = h.total_tokens ? h.qty / h.total_tokens : 0;
    var myP10 = (h.pool_recovery_p10 || 0) * share;
    var myP50 = (h.pool_recovery_p50 || 0) * share;
    var myP90 = (h.pool_recovery_p90 || 0) * share;
    var conf = h.pool_confidence || 0;
    var confColor = conf >= 0.7 ? '#00529B' : conf >= 0.5 ? '#5BC0EB' : '#C9485B';
    var confLabel = conf >= 0.7 ? '높음' : conf >= 0.5 ? '보통' : '낮음';

    // cone 바 위치 계산
    var span = (myP90 - myP10) || 1;
    var p50pos = Math.round((myP50 - myP10) / span * 100);
    // 회수 진행률 = 분배누계 / 기대회수 p50
    var recPct = myP50 > 0 ? Math.min(100, Math.round((h.distributed_total || 0) / myP50 * 100)) : 0;

    var sb = STATUS_BADGE[h.status] || { ko: h.status, bg: '#f3f4f6', color: '#6b7280' };

    return '<div class="rwa-holding-card">'
      + '<div class="rwa-holding-head">'
      +   '<div>'
      +     '<div class="rwa-token-name">' + esc(h.token_name) + '</div>'
      +     '<div class="rwa-token-meta"><span>' + (CT_KO[h.collateral_type] || '-') + '</span><span>' + esc(h.region || '-') + '</span></div>'
      +   '</div>'
      +   '<span class="rwa-status-badge" style="background:' + sb.bg + ';color:' + sb.color + '">' + sb.ko + '</span>'
      + '</div>'
      + '<div class="rwa-holding-kpi">'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">보유 수량</div><div class="rwa-kpi-val">' + h.qty.toLocaleString() + '개</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">투자 원금</div><div class="rwa-kpi-val">' + fmtMan(principal) + '</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">수취 분배금</div><div class="rwa-kpi-val">' + fmtMan(h.distributed_total || 0) + '</div></div>'
      +   '<div class="rwa-kpi-item"><div class="rwa-kpi-label">예상 IRR</div><div class="rwa-kpi-val rwa-irr-val">' + fmtPct(h.expected_irr) + '</div></div>'
      + '</div>'
      // 신뢰구간 공개 — "한 점 숫자 금지" 원칙 준수
      + '<div class="rwa-cone-section">'
      +   '<div class="rwa-cone-title">내 지분 회수 cone (p10~p50~p90) <span class="rwa-conf-badge" style="background:' + confColor + '22;color:' + confColor + '">신뢰도 ' + Math.round(conf * 100) + '% — ' + confLabel + '</span></div>'
      +   '<div class="npl-cone-bar rwa-cone-bar">'
      +     '<div class="npl-cone-p50" style="left:' + p50pos + '%"></div>'
      +   '</div>'
      +   '<div class="npl-cone-vals">'
      +     '<span>p10 ' + fmtMan(myP10) + '</span>'
      +     '<span style="font-weight:700">p50(중앙값) ' + fmtMan(myP50) + '</span>'
      +     '<span>p90 ' + fmtMan(myP90) + '</span>'
      +   '</div>'
      +   '<div class="rwa-cone-disclaimer">이 수치는 확정 금액이 아닌 통계적 분포입니다. p10 시나리오에서는 원금 손실이 발생할 수 있습니다.</div>'
      + '</div>'
      // 회수 진행률
      + '<div class="rwa-recovery-prog">'
      +   '<div class="rwa-recovery-label">회수 진행률 <span class="rwa-recovery-pct">' + recPct + '%</span><span class="rwa-recovery-sub">(분배누계 / p50 기준)</span></div>'
      +   '<div class="rwa-sub-bar-track"><div class="rwa-sub-bar-fill rwa-recovery-fill" style="width:' + recPct + '%"></div></div>'
      + '</div>'
      + '<div class="rwa-holding-foot">청약일: ' + esc(h.subscribed_at || '-') + ' · 토큰ID: <span class="rwa-mono">' + esc(h.issue_id) + '</span></div>'
      + '</div>';
  }

  function bindPortfolioEvents(container) {
    // 포트폴리오는 현재 읽기 전용 — 추후 분배내역 드릴다운 연결 예정
    // GET /api/v1/rwa/holdings/:id/distributions
  }

  // ── 영역 4: STO 투자위험 고지 모달 (청약 전 필수) ────────────────────────────
  function renderRiskModal() {
    return '<div id="rwa-risk-modal" class="rwa-modal-overlay" style="display:none" role="dialog" aria-modal="true" aria-label="STO 투자위험 고지">'
      + '<div class="rwa-modal-box rwa-risk-box">'
      +   '<div class="rwa-modal-head">'
      +     '<span class="rwa-modal-title">⚠ STO 투자위험 고지 (必독)</span>'
      +     '<button class="npl-detail-close rwa-modal-close" data-action="close-risk" aria-label="닫기">✕</button>'
      +   '</div>'
      +   '<div class="rwa-risk-body">'
      +     '<div class="rwa-risk-callout">'
      +       '<p>본 토큰은 <strong>증권형 토큰(STO)</strong>으로, 투자 전 아래 위험고지를 반드시 확인하고 동의하여야 청약이 가능합니다.</p>'
      +       '<p>본 상품은 <strong>예금자보호법에 따른 보호 대상이 아닙니다.</strong></p>'
      +     '</div>'
      +     '<ol class="rwa-risk-list">'
      +       '<li><strong>원금손실 위험</strong> — 기초자산(NPL) 회수금액이 투자 원금보다 적을 경우 손실이 발생할 수 있습니다.</li>'
      +       '<li><strong>NPL 회수 불확실성</strong> — 회수금액은 경매 낙찰가율, 법적 절차 기간, 담보물 상태 등에 따라 크게 변동될 수 있으며, 예상 IRR은 통계적 추정치입니다.</li>'
      +       '<li><strong>회수기간 변동 위험</strong> — 법적 절차 지연, 이해관계인 이의신청 등으로 만기가 연장될 수 있습니다.</li>'
      +       '<li><strong>유동성 제한</strong> — 본 토큰의 이차 유통은 현재 제한적이며, 청약 후 중도 환매가 불가능할 수 있습니다.</li>'
      +       '<li><strong>발행사 위험</strong> — SPC(특수목적법인) 운영 위험 및 관련 법령·규제 변경 위험이 존재합니다.</li>'
      +       '<li><strong>시장위험</strong> — 부동산 시장, 금리, 거시경제 변화에 따라 회수금액이 영향을 받을 수 있습니다.</li>'
      +       '<li><strong>세금</strong> — 분배 수익은 소득세 과세 대상입니다. 세부 사항은 세무사와 상담하십시오.</li>'
      +     '</ol>'
      +     '<label class="rwa-risk-agree">'
      +       '<input type="checkbox" id="rwa-risk-chk"> '
      +       '위의 투자위험 고지 내용을 모두 읽었으며, 위험을 이해하고 동의합니다.'
      +     '</label>'
      +   '</div>'
      +   '<div class="rwa-modal-foot">'
      +     '<button class="rwa-btn-cancel" data-action="close-risk">취소</button>'
      +     '<button class="rwa-btn-confirm" id="rwa-risk-confirm" disabled data-action="open-subscribe">청약 진행 →</button>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  // ── 영역 2: 조각 매수 플로우 모달 ────────────────────────────────────────────
  function renderSubscribeModal() {
    return '<div id="rwa-subscribe-modal" class="rwa-modal-overlay" style="display:none" role="dialog" aria-modal="true" aria-label="토큰 청약">'
      + '<div class="rwa-modal-box rwa-subscribe-box">'
      +   '<div class="rwa-modal-head">'
      +     '<span class="rwa-modal-title" id="rwa-sub-title">토큰 청약</span>'
      +     '<button class="npl-detail-close rwa-modal-close" data-action="close-subscribe" aria-label="닫기">✕</button>'
      +   '</div>'
      +   '<div class="rwa-sub-body">'
      +     '<div id="rwa-sub-token-info" class="rwa-sub-token-info"></div>'
      +     '<label class="npl-field">'
      +       '<span class="npl-field-label">청약 수량 (토큰 개수)</span>'
      +       '<input type="number" id="rwa-sub-qty" class="npl-input" min="1" step="1" placeholder="최소 청약 단위 이상">'
      +     '</label>'
      +     '<div id="rwa-sub-calc" class="rwa-sub-calc"></div>'
      +     '<div id="rwa-sub-validation" class="rwa-sub-validation" style="display:none"></div>'
      +   '</div>'
      +   '<div class="rwa-modal-foot">'
      +     '<button class="rwa-btn-cancel" data-action="close-subscribe">취소</button>'
      +     '<button class="rwa-btn-confirm" id="rwa-sub-confirm" data-action="do-subscribe">청약 확정</button>'
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  // ── 모달 제어 ─────────────────────────────────────────────────────────────────
  function openRiskModal(container) {
    var modal = document.getElementById('rwa-risk-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    var chk = document.getElementById('rwa-risk-chk');
    var confirm = document.getElementById('rwa-risk-confirm');
    if (chk) chk.checked = false;
    if (confirm) confirm.disabled = true;

    if (chk) chk.onchange = function() {
      state.modal.risk_agreed = chk.checked;
      if (confirm) confirm.disabled = !chk.checked;
    };

    modal.querySelectorAll('[data-action="close-risk"]').forEach(function(btn) {
      btn.onclick = function() { modal.style.display = 'none'; };
    });
    if (confirm) confirm.onclick = function() {
      if (!state.modal.risk_agreed) return;
      modal.style.display = 'none';
      openSubscribeModal(container);
    };
  }

  function openSubscribeModal(container) {
    var tk = state.modal.token;
    if (!tk) return;
    var modal = document.getElementById('rwa-subscribe-modal');
    if (!modal) return;

    var title = document.getElementById('rwa-sub-title');
    if (title) title.textContent = '청약: ' + tk.token_name;

    var info = document.getElementById('rwa-sub-token-info');
    var remaining = (tk.total_tokens - (tk.subscribed_tokens || 0));
    if (info) {
      info.innerHTML = '<div class="rwa-sub-info-grid">'
        + '<div class="rwa-kpi-item"><div class="rwa-kpi-label">토큰 단가</div><div class="rwa-kpi-val">' + fmtKrw(tk.price_per_token) + '원/개</div></div>'
        + '<div class="rwa-kpi-item"><div class="rwa-kpi-label">최소 청약</div><div class="rwa-kpi-val">' + tk.min_subscription.toLocaleString() + '개 (' + fmtMan(tk.min_subscription * tk.price_per_token) + ')</div></div>'
        + '<div class="rwa-kpi-item"><div class="rwa-kpi-label">잔여 수량</div><div class="rwa-kpi-val">' + remaining.toLocaleString() + '개</div></div>'
        + '<div class="rwa-kpi-item"><div class="rwa-kpi-label">예상 IRR</div><div class="rwa-kpi-val rwa-irr-val">' + fmtPct(tk.expected_irr) + '</div></div>'
        + '</div>'
        + renderMiniCone(tk);
    }

    var qtyInput = document.getElementById('rwa-sub-qty');
    var calc = document.getElementById('rwa-sub-calc');
    var validation = document.getElementById('rwa-sub-validation');
    var confirm = document.getElementById('rwa-sub-confirm');

    if (qtyInput) {
      qtyInput.value = tk.min_subscription;
      qtyInput.min = tk.min_subscription;
      qtyInput.max = remaining;
      updateCalc();
    }

    function updateCalc() {
      var qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
      var amount = qty * tk.price_per_token;
      var expDist = amount * tk.expected_irr;
      // 내 지분 비율로 cone 계산
      var share = tk.total_tokens ? qty / tk.total_tokens : 0;
      var myP10 = (tk.pool_recovery_p10 || 0) * share;
      var myP50 = (tk.pool_recovery_p50 || 0) * share;
      var myP90 = (tk.pool_recovery_p90 || 0) * share;

      if (calc) calc.innerHTML = '<div class="rwa-calc-box">'
        + '<div class="rwa-calc-row"><span>청약금액</span><strong>' + fmtKrw(amount) + '원</strong></div>'
        + '<div class="rwa-calc-row"><span>예상 분배수익 (p50 기준)</span><strong class="rwa-irr-val">' + fmtMan(expDist) + '</strong></div>'
        + '<div class="rwa-calc-row"><span>내 지분 회수 cone</span>'
        +   '<span>p10 ' + fmtMan(myP10) + ' · p50 ' + fmtMan(myP50) + ' · p90 ' + fmtMan(myP90) + '</span></div>'
        + '<div class="rwa-calc-disclaimer">예상 수익은 통계적 추정치이며 확정이 아닙니다.</div>'
        + '</div>';

      // 유효성 검증
      var errors = [];
      if (qty < tk.min_subscription) errors.push('최소 청약 단위(' + tk.min_subscription.toLocaleString() + '개)를 충족해야 합니다.');
      if (amount < MIN_SUB_KRW) errors.push('최소 청약금액은 ' + fmtMan(MIN_SUB_KRW) + '입니다.');
      if (qty > remaining) errors.push('잔여 수량(' + remaining.toLocaleString() + '개)을 초과할 수 없습니다.');

      if (validation) {
        if (errors.length) {
          validation.style.display = 'block';
          validation.innerHTML = errors.map(function(e) { return '<div class="npl-warn">' + esc(e) + '</div>'; }).join('');
        } else {
          validation.style.display = 'none';
          validation.innerHTML = '';
        }
      }
      if (confirm) confirm.disabled = errors.length > 0;
    }

    if (qtyInput) qtyInput.oninput = updateCalc;

    modal.style.display = 'flex';

    modal.querySelectorAll('[data-action="close-subscribe"]').forEach(function(btn) {
      btn.onclick = function() { modal.style.display = 'none'; };
    });

    if (confirm) confirm.onclick = function() {
      var qty = parseInt(qtyInput ? qtyInput.value : 0) || 0;
      doSubscribe(tk, qty, modal);
    };
  }

  function doSubscribe(tk, qty, modal) {
    var amount = qty * tk.price_per_token;
    // 실제 API: POST /api/v1/rwa/tokens/:id/subscribe { investor_id, qty }
    // 현재 데모 — 즉시 성공 처리
    modal.style.display = 'none';

    // 데모 성공 피드백
    var toast = document.createElement('div');
    toast.className = 'rwa-toast';
    toast.textContent = '청약 완료: ' + tk.token_name + ' ' + qty.toLocaleString() + '개 (' + fmtKrw(amount) + '원)';
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('rwa-toast--show');
    }, 10);
    setTimeout(function() {
      toast.classList.remove('rwa-toast--show');
      setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 3500);
  }

  // ── 공개 API ─────────────────────────────────────────────────────────────────
  window.showNplRwaMarket = function() {
    var container = document.getElementById('view-npl-rwa-market');
    if (!container) return;
    state.tab = 'market';
    state.filter = { collateral_type: '', region: '', irr_min: '', status: '' };
    renderScreen(container);
  };

  window.renderNplRwaMarket = window.showNplRwaMarket;

})();
