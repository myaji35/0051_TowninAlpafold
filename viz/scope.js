// viz/scope.js — ScopeManager: 동/레이어/시간 윈도우 통합 상태 + 이벤트 발행
// 글로벌 노출: window.VizScope
(function (root) {
  'use strict';

  class ScopeManager {
    constructor(initial) {
      this.state = Object.assign({
        dongs: [],
        dongCode: null,
        monthIndex: 0,
        totalMonths: 60,
        height: null,
        color: null,
        size: null,
        causal: null,
        filter: 'all',
      }, initial || {});
      this.listeners = new Set();
    }

    get() { return this.state; }

    set(patch) {
      let changed = false;
      for (const k in patch) {
        if (this.state[k] !== patch[k]) { this.state[k] = patch[k]; changed = true; }
      }
      if (changed) this._emit();
    }

    setSilent(patch) {
      Object.assign(this.state, patch);
    }

    subscribe(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    _emit() {
      for (const fn of this.listeners) {
        try { fn(this.state); } catch (e) {
          console.warn('[VizScope] listener error:', e);
        }
      }
    }
  }

  // 싱글톤 + 클래스 둘 다 노출
  root.VizScope = {
    ScopeManager,
    instance: new ScopeManager(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
