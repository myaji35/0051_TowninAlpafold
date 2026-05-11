// utils/domain-data.js
// 도메인별 데이터 로드 — Promise 캐시 + 단일 진실 원본
// 부모 이슈: ISS-095 (REFACTOR — Eng 리뷰 권고)

(function() {
  'use strict';

  // ── 도메인 정의 ──
  const DOMAINS = {
    'pharmacy': {
      paths: [
        'data_raw/pharmacy/clinic_distribution.json',
        'data_raw/pharmacy/pharmacy_distribution.json',
        'data_raw/pharmacy/prescription_volume.json',
        'data_raw/pharmacy/store_operations.json',
      ],
      fallback: 'simula_data_real.json',
    },
    'npl': {
      paths: [],  // ETL 미완성 — paths 비움 + fallback만
      fallback: 'simula_data_real.json',
    },
    'simula': {
      paths: ['simula_data_real.json'],
      fallback: 'simula_data.json',
    },
    'forecasts': {
      paths: ['forecasts.json'],
      fallback: null,
    },
    'causal': {
      paths: ['causal.json'],
      fallback: null,
    },
    'tree_model': {
      paths: ['tree_model.json'],
      fallback: null,
    },
  };

  // ── Promise 캐시 (중복 fetch 방지) ──
  const _promiseCache = new Map();
  // ── 데이터 상태 캐시 (fallback-policy.js 협력용) ──
  const _statusCache = new Map();

  /**
   * 도메인 데이터 로드 — 동일 도메인 N회 호출도 1회 fetch.
   * @param {string} domain - DOMAINS 키
   * @returns {Promise<{data: object, status: object}>}
   *   status: { available: bool, marker: 'real'|'synth'|'estimate'|'fallback', source: string, fetched_at: string, errors: string[] }
   */
  function loadDomainData(domain) {
    if (_promiseCache.has(domain)) {
      return _promiseCache.get(domain);
    }
    const def = DOMAINS[domain];
    if (!def) {
      const err = Promise.resolve({
        data: {},
        status: { available: false, marker: 'estimate', source: 'unknown', errors: [`unknown domain: ${domain}`] }
      });
      _promiseCache.set(domain, err);
      return err;
    }
    const promise = _loadInternal(domain, def);
    _promiseCache.set(domain, promise);
    return promise;
  }

  async function _loadInternal(domain, def) {
    const result = { data: {}, status: { available: false, marker: 'estimate', source: '', fetched_at: '', errors: [] } };
    const errors = [];
    let primaryLoaded = false;

    for (const path of def.paths) {
      try {
        const res = await fetch(path);
        if (!res.ok) {
          errors.push(`${path}: HTTP ${res.status}`);
          continue;
        }
        const json = await res.json();
        const key = path.split('/').pop().replace('.json', '');
        result.data[key] = json;
        primaryLoaded = true;

        // 데이터 마커 추출 (있으면)
        if (Array.isArray(json) && json.length > 0 && json[0].marker) {
          result.status.marker = json[0].marker;
        } else if (json._meta && json._meta.marker_default) {
          result.status.marker = json._meta.marker_default;
        }
        if (json._meta && json._meta.fetched_at) {
          result.status.fetched_at = json._meta.fetched_at;
        }
      } catch (e) {
        errors.push(`${path}: ${e.message}`);
      }
    }

    if (primaryLoaded) {
      result.status.available = true;
      result.status.source = 'primary';
    } else if (def.fallback) {
      try {
        const res = await fetch(def.fallback);
        if (res.ok) {
          result.data._fallback = await res.json();
          result.status.available = true;
          result.status.marker = 'estimate';
          result.status.source = `fallback:${def.fallback}`;
        }
      } catch (e) {
        errors.push(`fallback ${def.fallback}: ${e.message}`);
      }
    }
    result.status.errors = errors;
    _statusCache.set(domain, result.status);
    return result;
  }

  /**
   * 캐시 무효화 (테스트용 또는 데이터 갱신 후).
   */
  function invalidate(domain) {
    if (domain) {
      _promiseCache.delete(domain);
      _statusCache.delete(domain);
    } else {
      _promiseCache.clear();
      _statusCache.clear();
    }
  }

  /**
   * 데이터 상태 조회 (load 후).
   */
  function getStatus(domain) {
    return _statusCache.get(domain) || null;
  }

  // ── 외부 진입점 ──
  window.DomainData = {
    load: loadDomainData,
    invalidate,
    getStatus,
    domains: Object.keys(DOMAINS),
  };
})();
