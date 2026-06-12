// components/npl-sell.js
// NPL 매도평가 UI — 입력 폼 + 결과 카드(sell vs hold) + SHAP 막대 + Decide deep-link
// 부모: GENERATE_CODE_NPL_SELL_UI-001 / INTEGRATE_RECOMMENDATION_TRACE_NPL_SELL-001
// 명세: docs/ux/npl-sell-ux.md  (패턴: components/pharmacy-develop.js)
// 색 가드(필수): 색 = "매각 결정 적합도". 파랑=매각 추천, 빨강=유지 추천.

(function() {
  'use strict';

  var state = { status: 'EMPTY', formData: {}, result: null, errorMessage: null };

  function renderScreen(container) {
    container.innerHTML = ''
      + '<div class="npl-screen npl-sell">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">매도 평가</span>'
      +   '</nav>'
      +   '<div class="npl-color-guard" role="note">⚠ 매각 적합도 — 색상은 매각 추천 강도 (파랑=매각 강추, 빨강=유지 추천)</div>'
      +   '<div class="npl-grid">'
      +     '<section class="npl-form-panel" aria-label="채권 정보 입력">'
      +       fld('포트폴리오/채권 ID', 'portfolio_id', 'text', '예: PF-A-001', false)
      +       fld('장부가 (만원)', 'book_value', 'number', '필수', true)
      +       fld('시장 호가 (만원)', 'market_quote', 'number', '필수 (수동 호가)', true)
      +       fld('보유 개월수', 'hold_months', 'number', '0', false)
      +       fld('충당금률 (%)', 'provision_rate', 'number', '0~100', false)
      +       fld('월 보유비용 (만원)', 'carrying_monthly', 'number', '0', false)
      +       '<button class="pd-cta" type="button" data-action="evaluate" disabled>평가 실행</button>'
      +       '<div class="pd-error" data-region="error" hidden></div>'
      +     '</section>'
      +     '<section class="npl-result-panel" aria-label="매각 vs 보유 비교" aria-live="polite">'
      +       '<div class="npl-empty" data-region="empty">채권을 선택하면 매각 vs 보유 비교가 시작됩니다</div>'
      +       '<div data-region="rec-card" hidden></div>'
      +     '</section>'
      +   '</div>'
      +   '<section class="npl-shap" data-region="shap" aria-label="추천 근거 SHAP" hidden></section>'
      +   '<section class="npl-cone" data-region="cone" aria-label="보유 회수 NPV 분포" hidden></section>'
      + '</div>';
    if (typeof window.bootstrapIcons === 'function') window.bootstrapIcons();
    bindEvents(container);
  }

  function fld(label, key, type, placeholder, required) {
    return '<label class="npl-field"><span class="npl-field-label">' + label + (required ? ' *' : '') + '</span>'
      + '<input class="npl-input" data-field="' + key + '" type="' + type + '" '
      + 'placeholder="' + placeholder + '"' + (required ? ' required' : '') + ' /></label>';
  }

  function bindEvents(container) {
    container.querySelectorAll('[data-field]').forEach(function(input) {
      input.addEventListener('input', function(e) {
        state.formData[e.target.dataset.field] = e.target.value;
        updateState(container);
      });
    });
    container.querySelector('[data-action="evaluate"]').addEventListener('click', function() {
      submitEvaluation(container);
    });
    container.querySelectorAll('[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var t = e.currentTarget.dataset.nav;
        if (t === 'home' && typeof window.switchMode === 'function') window.switchMode('gallery');
      });
    });
  }

  function submitEvaluation(container) {
    state.status = 'SUBMITTING';
    state.errorMessage = null;
    updateState(container);
    setTimeout(function() {
      var inp = {
        portfolio_id: state.formData.portfolio_id,
        book_value: parseFloat(state.formData.book_value) || 0,
        market_quote: parseFloat(state.formData.market_quote) || 0,
        hold_months: parseFloat(state.formData.hold_months) || 0,
        provision_rate: parseFloat(state.formData.provision_rate) || 0,
        carrying_monthly: parseFloat(state.formData.carrying_monthly) || 0,
      };
      var result = window.NplSellScorer && window.NplSellScorer.evaluate(inp);
      if (!result) {
        state.status = 'ERROR';
        state.errorMessage = '장부가 또는 시장 호가를 입력하세요.';
        updateState(container);
        return;
      }
      state.result = result;
      state.status = 'SUCCESS';
      updateState(container);
    }, 400);
  }

  function updateState(container) {
    var cta = container.querySelector('[data-action="evaluate"]');
    var errorEl = container.querySelector('[data-region="error"]');
    var emptyEl = container.querySelector('[data-region="empty"]');
    var recEl = container.querySelector('[data-region="rec-card"]');
    var shapEl = container.querySelector('[data-region="shap"]');
    var coneEl = container.querySelector('[data-region="cone"]');

    var hasRequired = Boolean(state.formData.book_value) || Boolean(state.formData.market_quote);
    cta.disabled = !hasRequired || state.status === 'SUBMITTING';
    cta.textContent = state.status === 'SUBMITTING' ? '평가 중…' : (state.result ? '재평가' : '평가 실행');

    if (state.errorMessage) { errorEl.textContent = state.errorMessage; errorEl.hidden = false; }
    else errorEl.hidden = true;

    if (state.status === 'SUCCESS' && state.result) {
      emptyEl.hidden = true; recEl.hidden = false; shapEl.hidden = false; coneEl.hidden = false;
      renderRecCard(recEl, state.result);
      renderShap(shapEl, state.result);
      renderCone(coneEl, state.result);
    } else {
      emptyEl.hidden = false; recEl.hidden = true; shapEl.hidden = true; coneEl.hidden = true;
    }
  }

  function renderRecCard(el, r) {
    var rec = r.recommendation;
    el.innerHTML = ''
      + '<div class="npl-rec-card" style="border-left:4px solid ' + rec.color + ';">'
      +   '<div class="npl-rec-compare">'
      +     '<div class="npl-rec-now"><span class="npl-rec-label">즉시 매각</span><span class="npl-rec-num">' + fmtMan(r.sell_now_npv) + '</span></div>'
      +     '<div class="npl-rec-vs">vs</div>'
      +     '<div class="npl-rec-hold"><span class="npl-rec-label">12M 보유 p50</span><span class="npl-rec-num">' + fmtMan(r.hold_cone[12].p50) + '</span></div>'
      +   '</div>'
      +   '<div class="npl-rec-badge" style="background:' + rec.color + ';color:#fff;">★ ' + esc(rec.label) + ' (gap ' + rec.gap_pct + '%)</div>'
      +   '<button class="pd-deep-link" type="button" data-action="goto-decide">Decide에서 cone 보기</button>'
      + '</div>';
    var btn = el.querySelector('[data-action="goto-decide"]');
    if (btn) btn.addEventListener('click', function() {
      if (typeof window.switchMode === 'function') window.switchMode('decide');
    });
  }

  function renderShap(el, r) {
    var maxAbs = Math.max.apply(null, r.shap_drivers.map(function(d){ return Math.abs(d.value) || 1; }));
    var barsHtml = r.shap_drivers.map(function(d) {
      var isSell = d.direction === 'sell';
      var color = isSell ? '#5BC0EB' : '#C9485B';
      var pct = Math.round(Math.abs(d.value) / maxAbs * 100);
      return '<div class="npl-shap-row">'
        +   '<span class="npl-shap-sign" style="color:' + color + ';">' + d.sign + '</span>'
        +   '<span class="npl-shap-text">' + esc(d.text) + '</span>'
        +   '<span class="npl-shap-bar" style="width:' + pct + '%;background:' + color + ';"></span>'
        + '</div>';
    }).join('');
    el.innerHTML = '<div class="npl-section-head">추천 근거 (SHAP 기여도 — 파랑=매각, 빨강=유지)</div>'
      + '<div class="npl-shap-bars">' + barsHtml + '</div>';
  }

  function renderCone(el, r) {
    var rows = [6, 12, 24].map(function(m) {
      var c = r.hold_cone[m];
      var crossNow = r.sell_now_npv;
      return '<div class="npl-cone-row">'
        +   '<span class="npl-cone-horizon">' + m + 'M</span>'
        +   '<span class="npl-cone-band">p10 ' + fmtMan(c.p10) + ' · <b>p50 ' + fmtMan(c.p50) + '</b> · p90 ' + fmtMan(c.p90) + '</span>'
        +   '<span class="npl-cone-flag">' + (c.p50 >= crossNow ? '보유 우위' : '매각 우위') + '</span>'
        + '</div>';
    }).join('');
    el.innerHTML = '<div class="npl-section-head">보유 시 회수 NPV 분포 (95% 신뢰구간)</div>'
      + '<div class="npl-cone-now">즉시매각 기준선: ' + fmtMan(r.sell_now_npv) + '</div>'
      + rows
      + '<div class="pd-source">출처: ' + esc(r.source) + ' · 신뢰도 ' + Math.round(r.confidence * 100) + '%</div>';
  }

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }

  window.renderNplSell = function(container) {
    if (!container) return;
    state = { status: 'EMPTY', formData: {}, result: null, errorMessage: null };
    renderScreen(container);
  };
})();
