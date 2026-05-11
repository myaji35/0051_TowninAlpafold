// utils/url-context.js
// Deep-link URL parser + context applier
// 부모 이슈: ISS-094 (ARCH_DECISION — Eng 리뷰 권고)
// IA 문서: docs/domain-menu-ia.md D절

(function() {
  'use strict';

  // ── 허용 파라미터 정의 (whitelist) ──
  // 명세에 없는 키는 무시. XSS/오용 방지.
  const ALLOWED_KEYS = new Set([
    'mode',         // gallery | explore | analyze | decide | datastudio | workflow | meongbun | pharmacy-develop | pharmacy-close | npl-buy | npl-sell
    'ctx',          // pharmacy.develop | pharmacy.close | npl.buy | npl.sell | meongbun.{section}
    'address',      // 동 이름 또는 도로명 (URL-encoded)
    'store_id',     // 약국 점포 ID (pharmacy.close 전용)
    'portfolio_id', // NPL 포트폴리오 ID (npl.sell 전용)
    'scenarios',    // 시나리오 키 (npl.buy 전용, 콤마 구분 — A,B,C)
    'dong',         // 명분 사슬 — 동 자동 선택
  ]);

  // ── 모드 화이트리스트 (XSS 방지) ──
  const ALLOWED_MODES = new Set([
    'gallery','explore','analyze','decide','datastudio','workflow','meongbun',
    'pharmacy-develop','pharmacy-close','npl-buy','npl-sell',
  ]);

  // ── ctx → mode 자동 매핑 (mode 미지정 시 fallback) ──
  const CTX_TO_MODE = {
    'pharmacy.develop': 'pharmacy-develop',
    'pharmacy.close':   'pharmacy-close',
    'npl.buy':          'npl-buy',
    'npl.sell':         'npl-sell',
  };

  /**
   * 현재 URL을 파싱하여 정규화된 context 객체 반환.
   * @param {string} [url=window.location.href] - 파싱할 URL (테스트용)
   * @returns {object} { mode, ctx, address, store_id, portfolio_id, scenarios, dong, _hasContext }
   */
  function parseUrlContext(url) {
    const target = url || (typeof window !== 'undefined' ? window.location.href : '');
    let parsed;
    try {
      parsed = new URL(target, 'http://localhost');
    } catch (e) {
      console.warn('[UrlContext] invalid URL:', target);
      return { _hasContext: false };
    }
    const params = parsed.searchParams;
    const ctx = { _hasContext: false };

    for (const key of ALLOWED_KEYS) {
      const raw = params.get(key);
      if (raw === null || raw === '') continue;
      const v = sanitize(raw, key);
      if (v != null) {
        ctx[key] = v;
        ctx._hasContext = true;
      }
    }

    // mode 미지정인데 ctx만 있으면 자동 매핑
    if (!ctx.mode && ctx.ctx && CTX_TO_MODE[ctx.ctx]) {
      ctx.mode = CTX_TO_MODE[ctx.ctx];
    }

    return ctx;
  }

  function sanitize(raw, key) {
    let decoded;
    try {
      decoded = decodeURIComponent(String(raw)).trim();
    } catch (e) {
      return null;  // decodeURIComponent 실패 시 안전 fallback
    }
    if (!decoded) return null;
    if (decoded.length > 256) return null;  // 비정상 긴 값 차단
    if (key === 'mode') {
      return ALLOWED_MODES.has(decoded) ? decoded : null;
    }
    if (key === 'scenarios') {
      // 'A,B,C' 형식만 허용
      return decoded.split(',').filter(s => /^[A-Z]$/.test(s.trim())).join(',') || null;
    }
    if (key === 'ctx') {
      // 'pharmacy.develop' 같은 dot-separated만 허용
      if (/^[a-z]+\.[a-z]+$/.test(decoded)) return decoded;
      return null;
    }
    // address / store_id / portfolio_id / dong — 일반 텍스트 (HTML escape는 사용처 책임)
    if (/[<>"']/.test(decoded)) return null;  // 명백한 HTML 인젝션 차단
    return decoded;
  }

  /**
   * context를 적용 — switchMode 호출 + 배지 표시 + 폼 자동 채움.
   * @param {object} ctx - parseUrlContext 결과
   * @param {object} hooks - { switchMode } (테스트용 의존성 주입)
   */
  function applyDeepLinkContext(ctx, hooks) {
    if (!ctx || !ctx._hasContext) return;
    const sw = (hooks && hooks.switchMode) || (typeof window !== 'undefined' ? window.switchMode : null);
    if (typeof sw !== 'function') {
      console.warn('[UrlContext] switchMode not available');
      return;
    }
    if (ctx.mode) {
      sw(ctx.mode);
    }
    // 배지 표시 — DOM hook
    showContextBadge(ctx);

    // 폼 자동 채움 — pharmacy-develop 진입 시 address
    if (ctx.address && (ctx.mode === 'pharmacy-develop' || ctx.ctx === 'pharmacy.develop')) {
      // 약간 지연 — switchMode가 폼을 그리고 난 뒤
      setTimeout(() => prefillField('[data-field="address"]', ctx.address), 100);
    }
    if (ctx.store_id && (ctx.mode === 'pharmacy-close' || ctx.ctx === 'pharmacy.close')) {
      setTimeout(() => prefillField('[data-field="store_id"]', ctx.store_id), 100);
    }
    if (ctx.portfolio_id && (ctx.mode === 'npl-sell' || ctx.ctx === 'npl.sell')) {
      setTimeout(() => prefillField('[data-field="portfolio_id"]', ctx.portfolio_id), 100);
    }
    if (ctx.dong && ctx.mode === 'meongbun') {
      // 명분 사슬 모드 — 동 자동 선택 (renderMeongbunLayout 호출자 책임)
      window.dispatchEvent(new CustomEvent('meongbun:autoselect-dong', { detail: { dong: ctx.dong } }));
    }
  }

  function prefillField(selector, value) {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function showContextBadge(ctx) {
    if (typeof document === 'undefined') return;
    let badge = document.getElementById('url-context-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'url-context-badge';
      badge.className = 'url-context-badge';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      document.body.appendChild(badge);
    }
    const parts = [];
    if (ctx.ctx) parts.push(`ctx: ${ctx.ctx}`);
    if (ctx.address) parts.push(`주소: ${ctx.address}`);
    if (ctx.store_id) parts.push(`점포: ${ctx.store_id}`);
    if (ctx.portfolio_id) parts.push(`포트폴리오: ${ctx.portfolio_id}`);
    if (parts.length === 0) {
      badge.style.display = 'none';
      return;
    }
    badge.innerHTML = `
      <span class="url-context-badge-label">Deep-link</span>
      <span class="url-context-badge-text">${escapeBadge(parts.join(' · '))}</span>
      <button class="url-context-badge-close" type="button" aria-label="배지 닫기">&times;</button>
    `;
    badge.style.display = 'flex';
    badge.querySelector('.url-context-badge-close').addEventListener('click', () => {
      badge.style.display = 'none';
    });
  }

  function escapeBadge(s) {
    return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  /**
   * 현재 콘텍스트로부터 deep-link URL 생성 (역방향).
   * @param {object} ctx - { mode, ctx, address, ... }
   * @returns {string} URL with querystring
   */
  function buildDeepLinkUrl(ctx) {
    const base = (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '/');
    const params = new URLSearchParams();
    for (const key of ALLOWED_KEYS) {
      if (ctx[key] != null && ctx[key] !== '') {
        params.set(key, ctx[key]);
      }
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  // ── 외부 진입점 ──
  window.UrlContext = {
    parse: parseUrlContext,
    apply: applyDeepLinkContext,
    build: buildDeepLinkUrl,
    ALLOWED_MODES: Array.from(ALLOWED_MODES),
    ALLOWED_KEYS: Array.from(ALLOWED_KEYS),
  };
})();
