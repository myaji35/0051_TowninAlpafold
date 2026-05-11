// components/pharmacy-close.js
// 약국 폐업평가 화면 (Wave 3 — Townin × AlphaFold)
// 부모 이슈: USER_STORY_PHARMACY_CLOSE-001
// UX 스펙: docs/ux/pharmacy-close-ux.md
// 명세: docs/stories/pharmacy-close.md
// ⚠ 색 충돌 가드: hazard↑=나쁨 (점포개발 score↑=좋음과 의미 반대)

(function() {
  'use strict';

  // ── Hazard Grade 매핑 (명세서 E절, 역방향) ──
  // hazard <30: 안전 → 파랑(유지) / 30-49: low / 50-69: medium(관찰) / >=70: high(철수)
  const HAZARD_GRADES = [
    { min: 70, label: 'high',     color: '#C9485B', actionLabel: '철수 검토',            actionColor: '#C9485B' },
    { min: 50, label: 'medium',   color: '#FED766', actionLabel: '관찰 — 3개월 후 재평가', actionColor: '#FED766' },
    { min: 30, label: 'low',      color: '#5BC0EB', actionLabel: '유지',                 actionColor: '#5BC0EB' },
    { min: 0,  label: 'very_low', color: '#00529B', actionLabel: '유지 — 안전',           actionColor: '#00529B' },
  ];

  function hazardToGrade(hazard) {
    return HAZARD_GRADES.find(g => hazard >= g.min) || HAZARD_GRADES[HAZARD_GRADES.length - 1];
  }

  // ── 데모 점포 데이터 (Wave 3 mock — HAZARD scorer 이슈 완성 시 교체) ──
  const DEMO_STORES = {
    'store-001': {
      address: '의정부시 금오동',
      operating_months: 62,
      hazard: 73,
      top_drivers: [
        { sign: '+', text: '월 매출 -22% YoY (감소)' },
        { sign: '+', text: '인근 의원 폐업 3건 (12M)' },
        { sign: '-', text: '운영 62개월 (안정성 가산)' }
      ],
      peer_dongs: [
        { rank: 1, dong: '의정부 호원동', survival_12m: 0.58, status: '주의' },
        { rank: 2, dong: '의정부 낙양동', survival_12m: 0.64, status: '평균' },
        { rank: 3, dong: '의정부 민락동', survival_12m: 0.71, status: '안정' }
      ],
      km_curve_summary: '유사 5개 동 12개월 생존확률 64% (95% CI: 51~77%)'
    },
    'store-002': {
      address: '성수1가1동',
      operating_months: 34,
      hazard: 28,
      top_drivers: [
        { sign: '-', text: '월 매출 +12% YoY (증가)' },
        { sign: '-', text: '20대 유동인구 +15%' },
        { sign: '+', text: '경쟁약국 신규 진입 2건' }
      ],
      peer_dongs: [
        { rank: 1, dong: '성수2가1동', survival_12m: 0.85, status: '안전' },
        { rank: 2, dong: '성수2가3동', survival_12m: 0.81, status: '안정' }
      ],
      km_curve_summary: '유사 5개 동 12개월 생존확률 81% (95% CI: 73~88%)'
    }
  };

  // 동 이름으로도 매칭 (UX: store_id 모를 때 address 입력 가능)
  function findStoreByInput(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;
    if (DEMO_STORES[trimmed]) return { store_id: trimmed, ...DEMO_STORES[trimmed] };
    for (const [sid, data] of Object.entries(DEMO_STORES)) {
      if (data.address === trimmed || trimmed.includes(data.address)) {
        return { store_id: sid, ...data };
      }
    }
    return null;
  }

  // ── 상태 ──
  const state = {
    formData: { store_input: '', operating_months: null, csv_uploaded: false },
    result: null,
    status: 'INITIAL',
    errorMessage: null
  };

  // ── 화면 렌더 ──
  function renderPharmacyCloseScreen(container) {
    container.innerHTML = `
      <div class="pharmacy-close-screen">
        <nav class="pc-breadcrumb" aria-label="breadcrumb">
          <button class="pc-breadcrumb-link" data-nav="home">홈</button>
          <span class="pc-breadcrumb-sep">›</span>
          <button class="pc-breadcrumb-link" data-nav="pharmacy">약국</button>
          <span class="pc-breadcrumb-sep">›</span>
          <span class="pc-breadcrumb-current">폐업평가</span>
        </nav>

        <!-- ⚠ 색 충돌 가드 — 항상 상단 고정 노출 -->
        <div class="pc-color-guard" role="note">
          <strong>위험도 — 높을수록 나쁨</strong>
          <span class="pc-color-guard-detail">(점포개발 적합도와 색 의미 반대)</span>
        </div>

        <div class="pc-layout">
          <!-- 좌 50% 입력 폼 -->
          <section class="pc-form" aria-label="평가 입력">
            <h2 class="pc-section-title">운영 점포 폐업 위험 평가</h2>
            <p class="pc-section-subtitle">점포를 선택하면 폐업 위험도 평가가 시작됩니다</p>

            <div class="pc-field">
              <label class="pc-label">점포 ID 또는 주소 <span class="pc-required">*</span></label>
              <input type="text" class="pc-input" data-field="store_input"
                     placeholder="예: store-001 또는 의정부시 금오동"
                     autocomplete="off">
              <div class="pc-helper">데모 점포: store-001 (의정부 금오) / store-002 (성수1가1동)</div>
            </div>

            <div class="pc-field">
              <label class="pc-label">운영 개월수 (선택)</label>
              <input type="number" class="pc-input" data-field="operating_months" placeholder="개월" min="0">
            </div>

            <div class="pc-field">
              <label class="pc-label">매출 CSV 업로드 (선택)</label>
              <input type="file" class="pc-input pc-input-file" data-field="csv" accept=".csv">
              <div class="pc-helper pc-helper-warn">미업로드 시 추정 모드 (낮은 신뢰도)</div>
            </div>

            <button class="pc-cta" type="button" data-action="evaluate" disabled>
              평가 실행
            </button>
            <div class="pc-error" data-region="error" role="alert" aria-live="polite" hidden></div>
          </section>

          <!-- 우 50% 결과 카드 (Hazard) -->
          <section class="pc-result" aria-label="평가 결과" aria-live="polite">
            <div class="pc-empty-state" data-region="empty">
              <p>점포를 선택하면<br>폐업 위험도 평가가 시작됩니다</p>
            </div>
            <div class="pc-result-card" data-region="result" hidden></div>
          </section>
        </div>

        <!-- 하단 전폭: KM 생존 곡선 마운트 슬롯 -->
        <section class="pc-km-slot" data-region="km-curve" hidden>
          <h3 class="pc-km-title">Kaplan-Meier 생존 곡선 — 유사 5개 동 12개월 추정</h3>
          <div class="pc-km-mount">
            <!-- INTEGRATE_KM_CURVE_PHARMACY_CLOSE-001에서 실제 차트 마운트 -->
            <div class="pc-km-placeholder">
              KM 곡선 마운트 슬롯 — UI_BENCHMARK_KM_CURVE-001 컴포넌트 완성 후 INTEGRATE 이슈에서 채워짐
            </div>
            <div class="pc-km-summary" data-region="km-summary"></div>
          </div>
        </section>

        <!-- 하단: 유사군 동 (peer_dongs) -->
        <section class="pc-peers" data-region="peers" hidden>
          <h3 class="pc-peers-title">유사군 동 — 생존확률 비교</h3>
          <table class="pc-peers-table">
            <thead>
              <tr><th>순위</th><th>동</th><th>12M 생존확률</th><th>상태</th></tr>
            </thead>
            <tbody data-region="peers-rows"></tbody>
          </table>
        </section>
      </div>
    `;

    bindEvents(container);
    updateState(container);
  }

  function bindEvents(container) {
    container.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', (e) => {
        const field = e.target.dataset.field;
        if (field === 'csv') {
          state.formData.csv_uploaded = e.target.files && e.target.files.length > 0;
        } else if (field === 'operating_months') {
          state.formData.operating_months = e.target.value === '' ? null : Number(e.target.value);
        } else {
          state.formData.store_input = e.target.value;
        }
        state.status = state.formData.store_input.trim() ? 'TYPING' : 'INITIAL';
        updateState(container);
      });
    });

    container.querySelector('[data-action="evaluate"]').addEventListener('click', () => {
      if (state.status === 'SUBMITTING') return;
      submitEvaluation(container);
    });

    container.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.nav;
        if (target === 'home' && typeof window.switchMode === 'function') {
          window.switchMode('gallery');
        }
      });
    });
  }

  async function submitEvaluation(container) {
    state.status = 'SUBMITTING';
    state.errorMessage = null;
    updateState(container);

    try {
      await new Promise(r => setTimeout(r, 600));
      const input = state.formData.store_input.trim();
      const found = findStoreByInput(input);

      if (!found) {
        state.status = 'ERROR';
        state.errorMessage = `점포를 찾을 수 없습니다. 데모 점포: ${Object.keys(DEMO_STORES).join(' / ')}`;
        updateState(container);
        return;
      }

      // HAZARD scorer가 있으면 호출, 없으면 mock 사용
      let result;
      if (window.PharmacyHazard && typeof window.PharmacyHazard.evaluate === 'function') {
        result = window.PharmacyHazard.evaluate({
          store_id: found.store_id,
          address: found.address,
          operating_months: state.formData.operating_months || found.operating_months,
          csv_uploaded: state.formData.csv_uploaded,
        });
      } else {
        result = {
          hazard: found.hazard,
          grade: hazardToGrade(found.hazard),
          top_drivers: found.top_drivers,
          peer_dongs: found.peer_dongs,
          km_curve_summary: found.km_curve_summary,
          source: 'mock (data_raw/pharmacy/sample.json) — HAZARD scorer 이슈 완성 시 교체',
          confidence: state.formData.csv_uploaded ? 0.85 : 0.55,
          estimate_mode: !state.formData.csv_uploaded
        };
      }

      state.result = { store: found, ...result };
      state.status = 'SUCCESS';
      updateState(container);
    } catch (e) {
      state.status = 'ERROR';
      state.errorMessage = e.message || '평가 중 오류 발생';
      updateState(container);
    }
  }

  function updateState(container) {
    const cta = container.querySelector('[data-action="evaluate"]');
    const errorEl = container.querySelector('[data-region="error"]');
    const emptyEl = container.querySelector('[data-region="empty"]');
    const resultEl = container.querySelector('[data-region="result"]');
    const kmEl = container.querySelector('[data-region="km-curve"]');
    const kmSummary = container.querySelector('[data-region="km-summary"]');
    const peersEl = container.querySelector('[data-region="peers"]');
    const peersRows = container.querySelector('[data-region="peers-rows"]');

    const hasInput = state.formData.store_input.trim().length > 0;
    cta.disabled = !hasInput || state.status === 'SUBMITTING';
    cta.textContent = state.status === 'SUBMITTING' ? '평가 중…' : (state.result ? '재평가' : '평가 실행');

    if (state.errorMessage) {
      errorEl.textContent = state.errorMessage;
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }

    if (state.status === 'SUCCESS' && state.result) {
      emptyEl.hidden = true;
      resultEl.hidden = false;
      const r = state.result;
      const driversHtml = r.top_drivers.map(d => `
        <li class="pc-driver pc-driver-${d.sign === '+' ? 'risk' : 'safe'}">
          <span class="pc-driver-sign">${d.sign}</span>
          <span class="pc-driver-text">${escHtml(d.text)}</span>
        </li>
      `).join('');

      const estimateBadge = r.estimate_mode
        ? `<div class="pc-estimate-badge">추정 모드 (CSV 미업로드)</div>` : '';

      resultEl.innerHTML = `
        <div class="pc-result-content" style="border-left: 4px solid ${r.grade.color};">
          ${estimateBadge}
          <div class="pc-result-header">
            <div class="pc-hazard" style="color: ${r.grade.color};">
              ${r.hazard}<span class="pc-hazard-unit">점</span>
              <span class="pc-hazard-suffix">위험도</span>
            </div>
            <div class="pc-action-badge" style="background: ${r.grade.actionColor}; color: white;">
              ${r.grade.actionLabel}
            </div>
          </div>
          <div class="pc-grade-label">위험도 — 높을수록 나쁨 (hazard: ${r.grade.label})</div>

          <div class="pc-store-meta">
            <strong>점포</strong> ${escHtml(r.store?.store_id || '?')} ·
            운영 ${r.store?.operating_months || '?'}개월 ·
            ${escHtml(r.store?.address || '?')}
          </div>

          <div class="pc-drivers-section">
            <div class="pc-drivers-title">위험 요인 (Top Drivers)</div>
            <ul class="pc-drivers-list">${driversHtml}</ul>
          </div>

          <button class="pc-deep-link" type="button" data-action="goto-analyze">
            Analyze에서 시계열 보기
          </button>

          <div class="pc-source">출처: ${escHtml(r.source)} · 신뢰도 ${(r.confidence * 100).toFixed(0)}%</div>
        </div>
      `;

      resultEl.querySelector('[data-action="goto-analyze"]').addEventListener('click', () => {
        if (typeof window.switchMode === 'function') window.switchMode('analyze');
      });

      kmEl.hidden = false;
      kmSummary.textContent = r.km_curve_summary || '';

      if (r.peer_dongs && r.peer_dongs.length) {
        peersEl.hidden = false;
        peersRows.innerHTML = r.peer_dongs.map(p => `
          <tr>
            <td>${p.rank}</td>
            <td>${escHtml(p.dong)}</td>
            <td><strong>${(p.survival_12m * 100).toFixed(0)}%</strong></td>
            <td><span class="pc-peer-status pc-peer-${statusClass(p.status)}">${escHtml(p.status)}</span></td>
          </tr>
        `).join('');
      } else {
        peersEl.hidden = true;
      }
    } else {
      emptyEl.hidden = false;
      resultEl.hidden = true;
      kmEl.hidden = true;
      peersEl.hidden = true;
    }
  }

  function statusClass(status) {
    if (status === '안전') return 'safe';
    if (status === '주의') return 'risk';
    return 'mid';
  }

  function escHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  // 외부 진입점
  window.renderPharmacyClose = function(container) {
    if (!container) { console.warn('[pharmacy-close] no container'); return; }
    renderPharmacyCloseScreen(container);
  };

  window.setPharmacyCloseResult = function(result) {
    state.result = result;
    state.status = 'SUCCESS';
    const container = document.querySelector('.pharmacy-close-screen')?.parentElement;
    if (container) updateState(container);
  };
})();
