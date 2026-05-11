// utils/memoize.js
// 결정성 함수의 LRU 메모이제이션 — 동일 입력 → 캐시 hit
// 부모 이슈: ISS-095 (REFACTOR)
// 사용처: pharmacy-scorer (이미 결정성), KM curve, NPV cone, Monte Carlo

(function() {
  'use strict';

  /**
   * @param {Function} fn - 메모이즈할 함수 (결정성 보장 필수)
   * @param {object} [opts] - { maxSize: 50, keyFn: (...args) => string }
   * @returns {Function} 같은 시그니처 함수, hit/miss 카운터 포함
   */
  function memoize(fn, opts) {
    const o = opts || {};
    const maxSize = o.maxSize || 50;
    const keyFn = o.keyFn || ((...args) => JSON.stringify(args));
    const cache = new Map();
    let hits = 0;
    let misses = 0;

    function memoized(...args) {
      let key;
      try {
        key = keyFn(...args);
      } catch (e) {
        // 키 생성 실패 — 우회 (캐시 미적용)
        return fn.apply(this, args);
      }
      if (cache.has(key)) {
        hits++;
        // LRU: 최근 사용으로 이동
        const v = cache.get(key);
        cache.delete(key);
        cache.set(key, v);
        return v;
      }
      misses++;
      const result = fn.apply(this, args);
      cache.set(key, result);
      // LRU eviction
      if (cache.size > maxSize) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
      return result;
    }

    memoized.cache = cache;
    memoized.stats = () => ({ hits, misses, size: cache.size, hitRate: hits + misses > 0 ? hits / (hits + misses) : 0 });
    memoized.clear = () => { cache.clear(); hits = 0; misses = 0; };
    return memoized;
  }

  window.memoize = memoize;
})();
