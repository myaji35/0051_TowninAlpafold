// components/npl-reports.js
// NPL 외부 리포트 라이브러리 — shilla_medical 상권분석/감정평가 실산출물 뷰어
// reports/manifest.json 기반 카드 리스트 → 클릭 시 사이트 내 iframe 뷰어 (HTML 우선, PDF fallback)
// 진입점: window.renderNplReports(container)  (switchMode('npl-reports')에서 호출)

(function () {
  'use strict';

  var MANIFEST = null;
  var ACTIVE = null; // 현재 뷰어에 열린 report id

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadManifest() {
    if (MANIFEST) return Promise.resolve(MANIFEST);
    return fetch('/reports/manifest.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { MANIFEST = j; return j; })
      .catch(function (e) {
        console.warn('[npl-reports] manifest fetch 실패', e);
        MANIFEST = { reports: [] };
        return MANIFEST;
      });
  }

  // 뷰어에 열 대상 URL — HTML 있으면 HTML, 없으면 PDF
  function viewerSrc(rep) {
    if (rep.html) return '/reports/' + encodeURIComponent(rep.html);
    if (rep.pdf) return '/reports/' + encodeURIComponent(rep.pdf);
    return null;
  }

  function cardHtml(rep) {
    var active = ACTIVE === rep.id ? ' is-active' : '';
    var tag = rep.tag ? '<span class="rl-tag">' + esc(rep.tag) + '</span>' : '';
    var bank = rep.bank ? '<span class="rl-meta-bank">' + esc(rep.bank) + '</span>' : '';
    var fmt = [];
    if (rep.html) fmt.push('<span class="rl-fmt rl-fmt-html">HTML</span>');
    if (rep.pdf) fmt.push('<span class="rl-fmt rl-fmt-pdf">PDF</span>');
    return ''
      + '<button class="rl-card' + active + '" data-report="' + esc(rep.id) + '">'
      +   '<div class="rl-card-icon">'
      +     '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>'
      +   '</div>'
      +   '<div class="rl-card-body">'
      +     '<div class="rl-card-title-row"><span class="rl-card-title">' + esc(rep.title) + '</span>' + tag + '</div>'
      +     '<div class="rl-card-sub">' + esc(rep.subtitle || '') + '</div>'
      +     '<div class="rl-card-meta">'
      +       '<span class="rl-meta-region">' + esc(rep.region || '') + '</span>'
      +       bank
      +       '<span class="rl-meta-date">' + esc(rep.date || '') + '</span>'
      +     '</div>'
      +   '</div>'
      +   '<div class="rl-card-fmt">' + fmt.join('') + '</div>'
      + '</button>';
  }

  function renderViewer(container, rep) {
    var pane = container.querySelector('[data-region="viewer"]');
    if (!pane) return;
    if (!rep) {
      pane.innerHTML = ''
        + '<div class="rl-viewer-empty">'
        +   '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5BC0EB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
        +   '<p>왼쪽에서 리포트를 선택하면 이곳에서 바로 열립니다.</p>'
        + '</div>';
      return;
    }
    var src = viewerSrc(rep);
    if (!src) { pane.innerHTML = '<div class="rl-viewer-empty"><p>열 수 있는 파일이 없습니다.</p></div>'; return; }
    var pdfLink = rep.pdf ? '<a class="rl-viewer-btn" href="/reports/' + encodeURIComponent(rep.pdf) + '" target="_blank" rel="noopener">PDF 새 탭 ↗</a>' : '';
    var dlLink = rep.pdf ? '<a class="rl-viewer-btn" href="/reports/' + encodeURIComponent(rep.pdf) + '" download>다운로드 ↓</a>' : '';
    pane.innerHTML = ''
      + '<div class="rl-viewer-bar">'
      +   '<span class="rl-viewer-name">' + esc(rep.title) + ' — ' + esc(rep.subtitle || '') + '</span>'
      +   '<span class="rl-viewer-actions">' + pdfLink + dlLink + '</span>'
      + '</div>'
      + '<iframe class="rl-viewer-frame" src="' + src + '" title="' + esc(rep.title) + '" loading="lazy"></iframe>';
  }

  function renderScreen(container, manifest) {
    var reports = (manifest && manifest.reports) || [];
    var meta = (manifest && manifest._meta) || {};
    container.innerHTML = ''
      + '<div class="npl-screen npl-reports">'
      +   '<nav class="pd-breadcrumb" aria-label="breadcrumb">'
      +     '<button class="pd-breadcrumb-link" data-nav="home">홈</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<button class="pd-breadcrumb-link" data-nav="npl">NPL</button>'
      +     '<span class="pd-breadcrumb-sep">›</span>'
      +     '<span class="pd-breadcrumb-current">리포트</span>'
      +   '</nav>'
      +   '<header class="rl-header">'
      +     '<h2 class="rl-h2">' + esc(meta.title || 'NPL 상권분석 · 감정평가 리포트') + '</h2>'
      +     '<p class="rl-sub">' + esc(meta.note || '') + '</p>'
      +   '</header>'
      +   '<div class="rl-layout">'
      +     '<div class="rl-list" data-region="list">'
      +       (reports.length ? reports.map(cardHtml).join('') : '<div class="rl-empty">등록된 리포트가 없습니다.</div>')
      +     '</div>'
      +     '<div class="rl-viewer" data-region="viewer"></div>'
      +   '</div>'
      + '</div>';

    // 최초 진입: 첫 리포트 자동 오픈 (데스크톱 UX — 빈 뷰어보다 즉시 콘텐츠)
    if (reports.length && !ACTIVE) ACTIVE = reports[0].id;
    var cur = reports.filter(function (r) { return r.id === ACTIVE; })[0] || null;
    renderViewer(container, cur);

    container.querySelectorAll('.rl-card').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.dataset.report === ACTIVE);
    });

    container.addEventListener('click', function (e) {
      var card = e.target.closest('.rl-card');
      if (card) {
        ACTIVE = card.dataset.report;
        container.querySelectorAll('.rl-card').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.report === ACTIVE);
        });
        var rep = reports.filter(function (r) { return r.id === ACTIVE; })[0] || null;
        renderViewer(container, rep);
        return;
      }
      var nav = e.target.closest('[data-nav]');
      if (nav) {
        var t = nav.dataset.nav;
        if (t === 'home' && typeof window.switchMode === 'function') window.switchMode('gallery');
        else if (t === 'npl' && typeof window.switchMode === 'function') window.switchMode('npl-portfolio');
      }
    });
  }

  window.renderNplReports = function (container) {
    if (!container) return;
    container.innerHTML = '<div class="rl-loading">리포트 목록 불러오는 중…</div>';
    loadManifest().then(function (m) { renderScreen(container, m); });
  };
})();
