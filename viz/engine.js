// viz/engine.js — VizEngine 코어 (단일 진입점)
// 의존: VizTokens, VizScales, VizCurator, VizScope, VizPluginRegistry, deck.gl(globals)
// 글로벌 노출: window.VizEngine
(function (root) {
  'use strict';

  const NO_DECK = () => (typeof root.deck === 'undefined');

  const VizEngine = {
    _plugins: () => root.VizPluginRegistry,
    _scope:   () => root.VizScope.instance,
    _curator: () => root.VizCurator,
    _scales:  () => root.VizScales,
    _tokens:  () => root.VizTokens,

    // Plugin Registry pass-through (확장성: 1줄 등록)
    register(plugin) { return root.VizPluginRegistry.register(plugin); },
    unregister(id)   { return root.VizPluginRegistry.unregister(id); },
    get(id)          { return root.VizPluginRegistry.get(id); },
    has(id)          { return root.VizPluginRegistry.has(id); },
    list()           { return root.VizPluginRegistry.list(); },

    // ScopeManager pass-through
    scope() { return this._scope(); },
    setScope(patch) { this._scope().set(patch); },

    // 활성 차트 추적 (자동 재렌더용)
    _active: new Map(),  // chartId → { type, target, options }

    /**
     * render(type, scope, target?, options?) → renderResult
     * - type: plugin id ('columns3d' | 'heatmap' | 'hexagon' | 'pearson5x5' | ...)
     * - scope: ScopeManager.state 또는 inline scope override
     * - target: deck.gl Overlay | DOM 노드 | id 문자열
     * - options: 플러그인별 추가 옵션
     */
    render(type, scope, target, options) {
      const plugin = this._plugins().get(type);
      if (!plugin) {
        console.warn(`[VizEngine] 알 수 없는 차트 타입: '${type}'`);
        return null;
      }

      const effectiveScope = scope || this._scope().get();

      if (typeof plugin.supports === 'function' && !plugin.supports(effectiveScope)) {
        console.warn(`[VizEngine] '${type}' 플러그인이 현재 scope를 지원하지 않음`);
        return null;
      }

      const scales = this._scales().resolve(effectiveScope);
      const data = this._curator().curate(type, effectiveScope, scales);

      // 활성 차트 등록 (event-driven 재렌더용)
      const chartId = (options && options.chartId) || `${type}@auto`;
      this._active.set(chartId, { type, target, options: options || {} });

      try {
        return plugin.render(target, data, scales, effectiveScope, options || {});
      } catch (e) {
        console.error(`[VizEngine] '${type}' render 실패:`, e);
        return null;
      }
    },

    /** 활성 차트 전체 재렌더 (ScopeManager 변경 시 자동 호출) */
    rerenderAll() {
      const out = [];
      const scope = this._scope().get();
      for (const [chartId, entry] of this._active) {
        const plugin = this._plugins().get(entry.type);
        if (!plugin) continue;
        try {
          const scales = this._scales().resolve(scope);
          const data = this._curator().curate(entry.type, scope, scales);
          out.push({ chartId, result: plugin.render(entry.target, data, scales, scope, entry.options) });
        } catch (e) {
          console.error(`[VizEngine] rerender '${chartId}' 실패:`, e);
        }
      }
      return out;
    },

    /** 활성 차트 등록 해제 */
    unmount(chartId) { return this._active.delete(chartId); },
    activeCharts()   { return Array.from(this._active.keys()); },
  };

  // 부트: Tokens 비동기 로드 + ScopeManager 변경 → 자동 재렌더
  function boot() {
    if (root.VizTokens && typeof root.VizTokens.load === 'function') {
      root.VizTokens.load();
    }
    if (root.VizScope && root.VizScope.instance && typeof root.VizScope.instance.subscribe === 'function') {
      root.VizScope.instance.subscribe(() => VizEngine.rerenderAll());
    }
  }

  root.VizEngine = VizEngine;
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
