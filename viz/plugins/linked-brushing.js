// viz/plugins/linked-brushing.js — cross-chart hover 연결
// 한 SVG에서 data-code rect/circle hover 시, 같은 페이지의 다른 SVG에서
// 동일 data-code 요소를 동시 강조. VizScope.dongCode로도 발화.
(function (root) {
  'use strict';
  const HIGHLIGHT_FILTER = 'drop-shadow(0 0 4px #5BC0EB)';
  let _bound = false;

  function bind() {
    if (_bound || !root.document) return false;
    _bound = true;
    root.document.body.addEventListener('mouseover', e => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const code = t.getAttribute('data-code');
      if (!code) return;
      crossHighlight(code, true);
      if (root.VizScope && root.VizScope.instance) root.VizScope.instance.set({ hoverCode: code });
    }, true);
    root.document.body.addEventListener('mouseout', e => {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const code = t.getAttribute('data-code');
      if (!code) return;
      crossHighlight(code, false);
    }, true);
    return true;
  }

  function crossHighlight(code, on) {
    const els = root.document.querySelectorAll(`[data-code="${code}"]`);
    els.forEach(el => {
      el.style.filter = on ? HIGHLIGHT_FILTER : '';
      if (on) el.setAttribute('stroke', '#5BC0EB');
    });
  }

  function init() {
    bind();
    return { bound: _bound };
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'linked-brushing',
      label: 'Linked Brushing (cross-highlight)',
      icon: '🔗',
      supports: () => true,
      render: () => init(),
    });
  }

  // 자동 활성 (DOMContentLoaded 후)
  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
  }

  root.VizLinkedBrushing = { bind, crossHighlight };
})(typeof window !== 'undefined' ? window : globalThis);
