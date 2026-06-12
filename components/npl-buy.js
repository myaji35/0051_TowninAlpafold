// components/npl-buy.js
// NPL 매수평가 UI — 입력 폼 + IRR 결과 카드 + 3시나리오(매수가 ±15%) + Decide deep-link
// 부모: GENERATE_CODE_NPL_BUY_UI-001 / INTEGRATE_SCENARIOS_NPL_BUY-001
// 명세: docs/ux/npl-buy-ux.md  (패턴: components/pharmacy-develop.js)
// 색 가드: IRR ↑ = 파랑(#00529B/#5BC0EB), IRR ↓ = 빨강(#C9485B)

(function() {
  'use strict';

  var state = { status: 'EMPTY', formData: {}, result: null, errorMessage: null };

  function renderScreen(container) {
    container.innerHTML = ''
      + '<div class="npl-screen npl-buy">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">매수 평가</span>'
      +   '</nav>'
      +   '<div class="npl-color-guard" role="note">ⓘ 수익성 — 높을수록 좋음 (IRR ↑ = 파랑, IRR ↓ = 빨강)</div>'
      +   '<div class="npl-grid">'
      +     '<section class="npl-form-panel" aria-label="채권 정보 입력">'
      +       fld('담보 부동산 주소', 'address', 'text', '예: 의정부시 금오동 123', false)
      +       selFld('담보 유형', 'collateral_type', [['apt','아파트'],['officetel','오피스텔'],['commercial','상가'],['land','토지']])
      +       selFld('지역 권역', 'region_code', [['11680','수도권 (서울/경기/인천)'],['26350','광역시 (부산/대구 등)'],['51110','지방']])
      +       fld('청구액 (만원)', 'claim', 'number', '필수', true)
      +       fld('후보 매수가 (만원)', 'buy_price', 'number', '필수', true)
      +       fld('감정가 (만원)', 'appraisal', 'number', '미입력 시 청구액×1.2 추정', false)
      +       '<fieldset class="npl-fieldset"><legend>권리관계 (선택)</legend>'
      +         fld('선순위 채권 (만원)', 'senior', 'number', '0', false)
      +         fld('세금/공과금 (만원)', 'tax', 'number', '0', false)
      +         fld('임차 보증금 (만원)', 'deposit', 'number', '0', false)
      +       '</fieldset>'
      +       '<div class="npl-warn" data-region="seniority-warn" hidden></div>'
      +       '<button class="pd-cta" type="button" data-action="evaluate" disabled>평가 실행</button>'
      +       '<div class="pd-error" data-region="error" hidden></div>'
      +     '</section>'
      +     '<section class="npl-result-panel" aria-label="IRR 평가 결과" aria-live="polite">'
      +       '<div class="npl-empty" data-region="empty">채권 정보를 입력하면 IRR 평가가 시작됩니다</div>'
      +       '<div data-region="irr-card" hidden></div>'
      +     '</section>'
      +   '</div>'
      +   '<section class="npl-scenarios" data-region="scenarios" aria-label="3가지 매수가 시나리오" role="group" hidden></section>'
      + '</div>';
    if (typeof window.bootstrapIcons === 'function') window.bootstrapIcons();
    bindEvents(container);
  }

  function fld(label, key, type, placeholder, required) {
    return '<label class="npl-field"><span class="npl-field-label">' + label + (required ? ' *' : '') + '</span>'
      + '<input class="npl-input" data-field="' + key + '" type="' + type + '" '
      + 'placeholder="' + placeholder + '"' + (required ? ' required' : '') + ' /></label>';
  }

  function selFld(label, key, opts) {
    var o = opts.map(function(op){ return '<option value="' + op[0] + '">' + op[1] + '</option>'; }).join('');
    return '<label class="npl-field"><span class="npl-field-label">' + label + '</span>'
      + '<select class="npl-input" data-field="' + key + '">' + o + '</select></label>';
  }

  function bindEvents(container) {
    container.querySelectorAll('[data-field]').forEach(function(input) {
      var evt = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(evt, function(e) {
        var k = e.target.dataset.field;
        state.formData[k] = e.target.value;
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
        address: state.formData.address,
        collateral_type: state.formData.collateral_type || 'apt',
        region_code: state.formData.region_code || '11680',
        claim: parseFloat(state.formData.claim),
        buy_price: parseFloat(state.formData.buy_price),
        appraisal: parseFloat(state.formData.appraisal) || 0,
        senior: parseFloat(state.formData.senior) || 0,
        tax: parseFloat(state.formData.tax) || 0,
        deposit: parseFloat(state.formData.deposit) || 0,
      };
      var result = window.NplBuyScorer && window.NplBuyScorer.evaluate(inp);
      if (!result) {
        state.status = 'ERROR';
        state.errorMessage = '청구액과 후보 매수가는 필수입니다.';
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
    var irrEl = container.querySelector('[data-region="irr-card"]');
    var scenEl = container.querySelector('[data-region="scenarios"]');
    var warnEl = container.querySelector('[data-region="seniority-warn"]');

    var hasRequired = Boolean(state.formData.claim) && Boolean(state.formData.buy_price);
    cta.disabled = !hasRequired || state.status === 'SUBMITTING';
    cta.textContent = state.status === 'SUBMITTING' ? '평가 중…' : (state.result ? '재평가' : '평가 실행');

    if (state.errorMessage) { errorEl.textContent = state.errorMessage; errorEl.hidden = false; }
    else errorEl.hidden = true;

    if (state.status === 'SUCCESS' && state.result) {
      emptyEl.hidden = true;
      irrEl.hidden = false; scenEl.hidden = false;
      renderIrrCard(irrEl, state.result);
      renderScenarios(scenEl, state.result);
      if (state.result.seniority_warning) {
        warnEl.textContent = '⚠ 선순위 채권이 청구액의 90% 이상 — 회수 가능성 낮음';
        warnEl.hidden = false;
      } else warnEl.hidden = true;
    } else {
      emptyEl.hidden = false; irrEl.hidden = true; scenEl.hidden = true;
    }
  }

  function renderIrrCard(el, r) {
    var risksHtml = (r.top_risks || []).map(function(d) {
      return '<li class="pd-driver pd-driver-neg"><span class="pd-driver-sign">' + d.sign + '</span>'
        + '<span class="pd-driver-text">' + esc(d.text) + '</span></li>';
    }).join('');
    el.innerHTML = ''
      + '<div class="npl-irr-card" style="border-left:4px solid ' + r.grade.color + ';">'
      +   '<div class="npl-irr-head">IRR 매수 검토</div>'
      +   '<div class="npl-irr-value" style="color:' + r.grade.color + ';">' + r.irr_pct + '<span class="pd-score-unit">%</span></div>'
      +   '<div class="npl-irr-badge" style="background:' + r.grade.color + ';color:#fff;">' + r.grade.actionLabel + '</div>'
      +   '<div class="npl-irr-recovery">회수 p50 ' + fmtMan(r.recovery_cone.p50) + ' (차감 ' + fmtMan(r.recovery_cone.deduction) + ')</div>'
      +   (risksHtml ? '<div class="npl-risks-head">Top Risks</div><ul class="pd-drivers-list">' + risksHtml + '</ul>' : '')
      +   '<button class="pd-deep-link" type="button" data-action="goto-decide">Decide에서 cone 보기</button>'
      + '</div>';
    var btn = el.querySelector('[data-action="goto-decide"]');
    if (btn) btn.addEventListener('click', function() {
      if (typeof window.switchMode === 'function') window.switchMode('decide');
    });
  }

  function renderScenarios(el, r) {
    var defs = [
      { key: 'conservative', title: 'A 보수 (×0.85)' },
      { key: 'base', title: 'B 기본 (입력가)' },
      { key: 'aggressive', title: 'C 공격 (×1.15)' },
    ];
    el.innerHTML = defs.map(function(d) {
      var s = r.scenarios[d.key];
      return '<article class="npl-scenario-card" style="border-left:4px solid ' + s.grade.color + ';">'
        +   '<div class="npl-scenario-title">' + d.title + '</div>'
        +   '<div class="npl-scenario-row">매수가: ' + fmtMan(s.buy_price) + '</div>'
        +   '<div class="npl-scenario-row npl-scenario-irr" style="color:' + s.grade.color + ';">IRR: ' + s.irr_pct + '%</div>'
        +   '<div class="npl-scenario-row">회수 p50: ' + fmtMan(s.recovery_p50) + '</div>'
        +   '<div class="npl-scenario-cone">cone p10–p90: ' + fmtMan(s.cone_p10) + ' ~ ' + fmtMan(s.cone_p90) + '</div>'
        +   '<div class="npl-scenario-grade" style="background:' + s.grade.color + ';color:#fff;">' + s.grade.actionLabel + '</div>'
        + '</article>';
    }).join('')
    + '<div class="pd-source">출처: ' + esc(r.source) + ' · 신뢰도 ' + Math.round(r.confidence * 100) + '%</div>';
  }

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }

  window.renderNplBuy = function(container) {
    if (!container) return;
    state = { status: 'EMPTY', formData: {}, result: null, errorMessage: null };
    renderScreen(container);
  };
})();
