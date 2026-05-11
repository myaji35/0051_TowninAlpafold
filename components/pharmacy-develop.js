// components/pharmacy-develop.js
// 약국 점포개발 화면 (Wave 1 + PIVOT 매물 중심, 2026-05-04)
// 부모 이슈: USER_STORY_PHARMACY_DEVELOP-001
// PIVOT: PIVOT_PHARMACY_DEVELOP_PROPERTY_CENTRIC-001
// UX 변경:
//   from: 후보 주소 + 평형/임대가/처방기대 → 단일 점수 카드
//   to:   읍면동 입력 → 그 동의 매물 카드 리스트 (적합도순)

(function() {
  'use strict';

  // ── pLDDT 등급 매핑 (brand-dna.json 인용 — 절대 변경 금지) ──
  const PLDDT_GRADES = [
    { min: 90, label: 'very_high', color: '#00529B', actionLabel: '적극 추천' },
    { min: 70, label: 'high',      color: '#5BC0EB', actionLabel: '추천' },
    { min: 50, label: 'medium',    color: '#FED766', actionLabel: '신중 검토' },
    { min: 0,  label: 'low',       color: '#C9485B', actionLabel: '비추천' },
  ];

  function scoreToGrade(score) {
    return PLDDT_GRADES.find(function(g) { return score >= g.min; }) || PLDDT_GRADES[PLDDT_GRADES.length - 1];
  }

  // ── 상태 ──
  const state = {
    formData: { dong: '' },
    result: null,        // { dong, dong_score, dong_grade, properties: [...] }
    status: 'INITIAL',   // INITIAL / TYPING / SUBMITTING / SUCCESS / DONG_NOT_FOUND / ERROR
    errorMessage: null,
  };

  // ── 화면 렌더 ──
  function renderPharmacyDevelopScreen(container) {
    container.innerHTML = ''
      + '<div class="pharmacy-develop-screen">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="pharmacy">약국</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">점포개발</span>'
      +   '</nav>'

      +   '<section class="pd-form pd-form-compact" aria-label="동 입력">'
      +     '<h2 class="pd-section-title">매물 중심 점포개발 추천</h2>'
      +     '<p class="pd-section-subtitle">읍면동까지의 주소를 입력하면 그 동의 매물을 적합도순으로 추천합니다</p>'
      +     '<div class="pd-form-row">'
      +       '<div class="pd-field pd-field-grow">'
      +         '<label class="pd-label">읍면동 주소 <span class="pd-required">*</span></label>'
      +         '<input type="text" class="pd-input" data-field="dong"'
      +              ' placeholder="예: 의정부시 금오동" autocomplete="off">'
      +         '<div class="pd-helper">데모 동: 의정부시 금오동 / 낙양동 / 민락동 / 성수1가1동 / 강남구 역삼1동</div>'
      +       '</div>'
      +       '<button class="pd-cta" type="button" data-action="evaluate" disabled>매물 추천</button>'
      +     '</div>'
      +     '<div class="pd-error" data-region="error" role="alert" aria-live="polite" hidden></div>'
      +   '</section>'

      +   '<section class="pd-result-area" aria-live="polite">'
      +     '<div class="pd-empty-state" data-region="empty">'
      +       '<p>읍면동을 입력하면<br>그 동의 매물 후보가 적합도순으로 나타납니다</p>'
      +     '</div>'
      +     '<div class="pd-dong-summary" data-region="dong-summary" hidden></div>'
      +     '<div class="pd-property-list" data-region="property-list" hidden></div>'
      +   '</section>'
      +  '</div>';

    if (typeof window.bootstrapIcons === 'function') window.bootstrapIcons();
    bindEvents(container);
    updateState(container);
  }

  function bindEvents(container) {
    container.querySelectorAll('[data-field]').forEach(function(input) {
      input.addEventListener('input', function(e) {
        var field = e.target.dataset.field;
        state.formData[field] = e.target.value;
        state.status = state.formData.dong.trim() ? 'TYPING' : 'INITIAL';
        updateState(container);
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (state.formData.dong.trim()) submitEvaluation(container);
        }
      });
    });

    container.querySelector('[data-action="evaluate"]').addEventListener('click', function() {
      if (state.status === 'SUBMITTING') return;
      submitEvaluation(container);
    });

    container.querySelectorAll('[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var target = e.currentTarget.dataset.nav;
        if (target === 'home' && typeof window.switchMode === 'function') {
          window.switchMode('gallery');
        }
      });
    });
  }

  // ── 평가 실행 — evaluateByDong (PIVOT) ──
  function submitEvaluation(container) {
    state.status = 'SUBMITTING';
    state.errorMessage = null;
    updateState(container);

    setTimeout(function() {
      var dong = state.formData.dong.trim();
      var result = null;

      if (window.PharmacyScorer && typeof window.PharmacyScorer.evaluateByDong === 'function') {
        result = window.PharmacyScorer.evaluateByDong(dong);
      }

      if (!result) {
        state.status = 'DONG_NOT_FOUND';
        var demos = (window.PharmacyScorer && window.PharmacyScorer.DEMO_DONGS || []).join(' / ');
        state.errorMessage = '동을 찾을 수 없습니다. 데모 동: ' + demos;
        updateState(container);
        return;
      }

      if (!result.properties || !result.properties.length) {
        state.status = 'ERROR';
        state.errorMessage = dong + '에 등록된 매물이 없습니다.';
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
    var summaryEl = container.querySelector('[data-region="dong-summary"]');
    var listEl = container.querySelector('[data-region="property-list"]');

    var hasDong = Boolean(state.formData.dong.trim());
    cta.disabled = !hasDong || state.status === 'SUBMITTING';
    cta.textContent = state.status === 'SUBMITTING' ? '추천 중…'
                    : (state.result ? '재추천' : '매물 추천');

    if (state.errorMessage) {
      errorEl.textContent = state.errorMessage;
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }

    if (state.status === 'SUCCESS' && state.result) {
      emptyEl.hidden = true;
      summaryEl.hidden = false;
      listEl.hidden = false;
      renderDongSummary(summaryEl, state.result);
      renderPropertyList(listEl, state.result);
    } else {
      emptyEl.hidden = false;
      summaryEl.hidden = true;
      listEl.hidden = true;
    }
  }

  function renderDongSummary(el, r) {
    el.innerHTML = ''
      + '<div class="pd-dong-card" style="border-left: 4px solid ' + r.dong_grade.color + ';">'
      +   '<div class="pd-dong-header">'
      +     '<div class="pd-dong-name">' + escapeHtml(r.dong) + '</div>'
      +     '<div class="pd-dong-meta">'
      +       '<span class="pd-dong-score" style="color: ' + r.dong_grade.color + ';">동 baseline ' + r.dong_score + '점</span>'
      +       '<span class="pd-dong-badge" style="background: ' + r.dong_grade.color + '; color: white;">' + r.dong_grade.actionLabel + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div class="pd-dong-summary-text">매물 ' + r.property_count + '건 — 적합도순 (임대료 합리성 + 면적 + 층수 동 baseline 보정)</div>'
      +   '<button class="pd-deep-link" type="button" data-action="goto-decide">Decide 모드에서 동 cone 보기</button>'
      + '</div>';
    var btn = el.querySelector('[data-action="goto-decide"]');
    if (btn) btn.addEventListener('click', function() {
      if (typeof window.switchMode === 'function') window.switchMode('decide');
    });
  }

  function renderPropertyList(el, r) {
    var cardsHtml = r.properties.map(function(p, idx) {
      var driversHtml = (p.top_drivers || []).map(function(d) {
        return '<li class="pd-driver pd-driver-' + (d.sign === '+' ? 'pos' : 'neg') + '">'
          + '<span class="pd-driver-sign">' + d.sign + '</span>'
          + '<span class="pd-driver-text">' + escapeHtml(d.text) + '</span>'
          + '</li>';
      }).join('');

      return '<article class="pd-property-card" style="border-left: 4px solid ' + p.grade.color + ';" data-property-id="' + escapeHtml(p.id) + '">'
        +   '<div class="pd-property-rank">#' + (idx + 1) + '</div>'
        +   '<div class="pd-property-main">'
        +     '<div class="pd-property-header">'
        +       '<div>'
        +         '<div class="pd-property-id">' + escapeHtml(p.id) + '</div>'
        +         '<div class="pd-property-address">' + escapeHtml(p.address) + '</div>'
        +       '</div>'
        +       '<div class="pd-property-score-block">'
        +         '<div class="pd-property-score" style="color: ' + p.grade.color + ';">' + p.score + '<span class="pd-score-unit">점</span></div>'
        +         '<div class="pd-property-grade-badge" style="background: ' + p.grade.color + '; color: white;">' + p.grade.actionLabel + '</div>'
        +       '</div>'
        +     '</div>'
        +     '<div class="pd-property-meta">'
        +       '<span class="pd-meta-chip">' + p.area_pyeong + '평</span>'
        +       '<span class="pd-meta-chip">월 임대 ' + p.rent_man + '만원</span>'
        +       '<span class="pd-meta-chip">보증금 ' + p.deposit_man + '만원</span>'
        +       '<span class="pd-meta-chip">' + p.floor + '층</span>'
        +       '<span class="pd-meta-chip pd-meta-chip-soft">' + escapeHtml(p.available_from) + ' 입주</span>'
        +       '<span class="pd-meta-chip pd-meta-chip-soft">' + escapeHtml(p.listing_source) + '</span>'
        +     '</div>'
        +     '<div class="pd-property-fit">' + escapeHtml(p.fit_reason) + '</div>'
        +     (driversHtml ? '<ul class="pd-drivers-list pd-drivers-compact">' + driversHtml + '</ul>' : '')
        +   '</div>'
        + '</article>';
    }).join('');

    el.innerHTML = cardsHtml
      + '<div class="pd-source">출처: ' + escapeHtml(r.source) + ' · 신뢰도 ' + Math.round(r.confidence * 100) + '%</div>';
  }

  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function(ch) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  // 외부 진입점
  window.renderPharmacyDevelop = function(container) {
    if (!container) {
      console.warn('[pharmacy-develop] no container');
      return;
    }
    state.formData = { dong: '' };
    state.result = null;
    state.status = 'INITIAL';
    state.errorMessage = null;
    renderPharmacyDevelopScreen(container);
  };

  window.setPharmacyDevelopResult = function(result) {
    state.result = result;
    state.status = 'SUCCESS';
    var container = document.querySelector('.pharmacy-develop-screen');
    if (container && container.parentElement) updateState(container.parentElement);
  };
})();
