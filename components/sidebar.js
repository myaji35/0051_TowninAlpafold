/* Sidebar — categories.json 기반 4그룹 좌측 네비게이션
 * Phase 1.7: topnav를 사이드바로 일원화. 기존 mode-btn 클릭 동작과 동일 호환.
 */
(function () {
  'use strict';

  const STATE = {
    catalog: null,
    activeMode: 'gallery',
    pinned: false,                          /* Phase 1.7.1: 평소 접힘, 호버 펼침. pin으로 고정 */
    expandedSubgroups: new Set(['pharmacy']),  // 약국은 기본 펼침
  };

  /* ---------- ICON helpers ---------- */
  const ICON_PATHS = {
    'compass': '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    'briefcase': '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'home': '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-5h-2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'grid': '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    'bar-chart-2': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'target': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    'git-merge': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'package': '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'coffee': '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
    'shopping-bag': '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'scissors': '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    'tag': '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    'map': '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'navigation': '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
    'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    'menu': '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  };

  function svgIcon(name, size = 14, stroke = 'currentColor') {
    const path = ICON_PATHS[name] || ICON_PATHS['compass'];
    return `<svg class="sidebar-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  /* ---------- LOAD ---------- */
  async function loadCatalog() {
    if (STATE.catalog) return STATE.catalog;
    try {
      const r = await fetch('/data_raw/_master/categories.json', { cache: 'no-store' });
      STATE.catalog = await r.json();
    } catch (e) {
      console.warn('[sidebar] categories.json fetch 실패', e);
      STATE.catalog = { groups: [] };
    }
    return STATE.catalog;
  }

  /* ---------- ROUTE: 모드 전환 (B 정리 — 사이드바가 직접 호출) ---------- */
  function activate(mode) {
    STATE.activeMode = mode;
    if (typeof window.switchMode === 'function') {
      window.switchMode(mode);
    } else {
      // 호환 모드: 혹시 topnav가 남아있으면 그것을 클릭
      const oldBtn = document.querySelector(`button[data-mode="${mode}"]`);
      if (oldBtn) oldBtn.click();
    }
    render();
  }

  /* ---------- RENDER ---------- */
  function renderItem(it, indent = 0) {
    const active = STATE.activeMode === it.mode;
    const cls = ['sb-item'];
    if (active) cls.push('is-active');
    if (indent > 0) cls.push('is-indent');
    const accent = it.accent ? ' is-accent' : '';
    return `<button class="${cls.join(' ')}${accent}" data-mode="${it.mode}" data-action="activate">
      ${svgIcon(it.icon || 'target', 14)}
      <span class="sb-label">${it.ko}</span>
    </button>`;
  }

  function renderSubgroup(sg) {
    const isOpen = STATE.expandedSubgroups.has(sg.id);
    const isPlanned = sg.status === 'planned' || (sg.items || []).length === 0;
    const chev = isOpen ? 'chevron-down' : 'chevron-right';
    const itemsHtml = isOpen
      ? (sg.items || []).map((it) => renderItem(it, 1)).join('')
      : '';
    const planned = isPlanned && isOpen && sg.planned_modules && sg.planned_modules.length
      ? `<div class="sb-planned-list">${sg.planned_modules.map((m) => `<div class="sb-planned-item">${svgIcon('lock', 11, '#6B7280')}<span>${m}</span></div>`).join('')}</div>`
      : '';
    const lockBadge = isPlanned ? svgIcon('lock', 11, '#6B7280') : '';
    return `<div class="sb-subgroup${isPlanned ? ' is-planned' : ''}">
      <button class="sb-subgroup-head" data-subgroup="${sg.id}" data-action="toggle-subgroup">
        ${svgIcon(chev, 12, '#9CA3AF')}
        ${svgIcon(sg.icon || 'package', 13)}
        <span class="sb-label">${sg.ko}</span>
        <span class="sb-count">(${(sg.items || []).length})</span>
        ${lockBadge}
      </button>
      ${itemsHtml}
      ${planned}
    </div>`;
  }

  function renderGroup(g) {
    const head = `<div class="sb-group-head">
      ${svgIcon(g.icon || 'compass', 14, '#5BC0EB')}
      <span class="sb-group-label">${g.label}</span>
    </div>`;
    let body = '';
    if (g.items) {
      body = g.items.map((it) => renderItem(it, 0)).join('');
    } else if (g.subgroups) {
      body = g.subgroups.map(renderSubgroup).join('');
    }
    const addBtn = g.addable
      ? `<button class="sb-add-btn" data-action="add-subgroup" data-group="${g.id}">${svgIcon('plus', 12)}<span>${g.add_label || '+ 추가'}</span></button>`
      : '';
    return `<section class="sb-group" data-group="${g.id}">
      ${head}
      ${body}
      ${addBtn}
    </section>`;
  }

  function render() {
    const root = document.getElementById('app-sidebar');
    if (!root) return;
    const c = STATE.catalog || { groups: [] };
    root.innerHTML = `
      <div class="sb-header">
        <button class="sb-toggle" data-action="toggle-pin" title="${STATE.pinned ? '고정 해제 (호버 모드로 복귀)' : '사이드바 고정 (펼친 상태 유지)'}">${svgIcon(STATE.pinned ? 'lock' : 'menu', 16, STATE.pinned ? '#00A1E0' : '#9CA3AF')}</button>
        <span class="sb-title">${STATE.pinned ? '카테고리 (고정)' : '카테고리'}</span>
      </div>
      <div class="sb-body">
        ${c.groups.map(renderGroup).join('')}
      </div>
      <div class="sb-footer">
        <span class="sb-version">categories v${(c._meta && c._meta.version) || 1}</span>
      </div>
    `;
    if (STATE.pinned) root.classList.add('is-pinned');
    else root.classList.remove('is-pinned');
  }

  /* ---------- EVENTS ---------- */
  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'activate') {
      activate(btn.dataset.mode);
    } else if (action === 'toggle-subgroup') {
      const sgid = btn.dataset.subgroup;
      if (STATE.expandedSubgroups.has(sgid)) STATE.expandedSubgroups.delete(sgid);
      else STATE.expandedSubgroups.add(sgid);
      render();
    } else if (action === 'toggle-pin') {
      STATE.pinned = !STATE.pinned;
      render();
      document.body.classList.toggle('sidebar-pinned', STATE.pinned);
    } else if (action === 'add-subgroup') {
      const groupId = btn.dataset.group;
      openAddModal(groupId);
    }
  }

  /* ---------- ADD MODAL ---------- */
  function openAddModal(groupId) {
    const existing = document.getElementById('sb-add-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'sb-add-modal';
    overlay.className = 'sb-modal-overlay';
    overlay.innerHTML = `
      <div class="sb-modal-card">
        <div class="sb-modal-head">
          <h3>새 카테고리 등록 — ${groupId}</h3>
          <button class="sb-modal-close" data-action="modal-close">×</button>
        </div>
        <div class="sb-modal-body">
          <p class="sb-modal-help">JSON 직접 편집 권장. 카탈로그 파일 위치:</p>
          <code class="sb-code">data_raw/_master/categories.json</code>
          <p class="sb-modal-help">아래 템플릿을 해당 그룹의 <code>subgroups</code> 배열에 추가하세요:</p>
          <pre class="sb-code-block">{
  "id": "<신규-id>",
  "ko": "<한글 이름>",
  "icon": "package",
  "status": "planned",
  "items": [],
  "planned_modules": ["기능1", "기능2"]
}</pre>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.dataset.action === 'modal-close') overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  /* ---------- INIT ---------- */
  async function init() {
    let root = document.getElementById('app-sidebar');
    if (!root) {
      root = document.createElement('aside');
      root.id = 'app-sidebar';
      document.body.insertBefore(root, document.body.firstChild);
    }
    document.body.classList.add('has-sidebar');
    await loadCatalog();
    // 현재 활성 모드 감지: 기존 topnav .active 또는 기본 gallery
    const cur = document.querySelector('.mode-btn.active');
    if (cur) STATE.activeMode = cur.dataset.mode;
    render();
    document.addEventListener('click', handleClick);
    // 외부에서 모드 변경 시 사이드바 동기화
    document.addEventListener('mode-changed', (e) => {
      STATE.activeMode = (e.detail && e.detail.mode) || STATE.activeMode;
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AppSidebar = { activate, render, STATE };
})();
