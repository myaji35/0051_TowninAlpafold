// components/data-studio-datasets.js
// Data Studio "데이터셋" 탭 — 등록된 5건 카드 리스트 + 새 데이터셋 등록 폼
// plan-harness:code / DATASET_REGISTER_FORM-001

(function () {
  'use strict';

  // ── 한국어 조사 헬퍼 ─────────────────────────────────────────────────────
  function _josa(word, josaSet) {
    // josaSet: '을/를', '이/가', '은/는', '와/과' 형태
    var parts = josaSet.split('/');
    var hasFinal = (function (ch) {
      var code = ch.charCodeAt(0);
      if (code < 0xAC00 || code > 0xD7A3) return false;
      return (code - 0xAC00) % 28 !== 0;
    })(word[word.length - 1]);
    return word + (hasFinal ? parts[0] : parts[1]);
  }

  // ── 상태 배지 레이블 ──────────────────────────────────────────────────────
  var STATUS_LABEL = {
    success: '정상',
    failure: '실패',
    pending: '대기',
    blocked: '차단',
  };

  var FREQ_LABEL = {
    monthly: '매월',
    weekly: '매주',
    quarterly: '분기',
    once: '1회성',
    daily: '매일',
  };

  var DIFF_LABEL = {
    easy: '쉬움',
    medium: '보통',
    hard: '어려움',
  };

  // ── Feather 아이콘 필요 키 (icons.js에 미등록 시 자체 SVG 인라인) ─────────
  var ICON_PATHS = {
    'database':      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    'calendar':      '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'key':           '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    'alert-circle':  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    'plus':          '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'x':             '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    'check':         '<polyline points="20 6 9 17 4 12"/>',
    'map-pin':       '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    'clock':         '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'chevrons-right':'<polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/>',
  };

  function _icon(name, size) {
    size = size || 14;
    // icons.js(window.getIcon) 있으면 위임, 없으면 자체 인라인
    if (window.getIcon && ICON_PATHS[name] === undefined) {
      return window.getIcon(name, { size: size });
    }
    var path = ICON_PATHS[name] || ICON_PATHS['alert-circle'];
    return '<svg class="feather-icon" xmlns="http://www.w3.org/2000/svg"' +
      ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor" stroke-width="2"' +
      ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path + '</svg>';
  }

  // ISO 8601 날짜 문자열 → "YYYY-MM-DD HH:mm" 형태 (현지 시간)
  function _fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch (e) { return iso.slice(0, 16); }
  }

  // ── 전역 상태 ─────────────────────────────────────────────────────────────
  var _root = null;
  var _datasets = [];

  // ── 공개 API ──────────────────────────────────────────────────────────────
  var DataStudioDatasets = {

    /**
     * init(rootEl) — 컨테이너 요소에 탭 콘텐츠를 부착한다.
     * @param {HTMLElement} rootEl
     */
    init: function (rootEl) {
      _root = rootEl;
      this.renderTab();
      this.loadDatasets();
    },

    /**
     * renderTab() — 탭 헤더 + 카드 리스트 + "새 데이터셋" 버튼
     */
    renderTab: function () {
      if (!_root) return;
      _root.innerHTML =
        '<div class="ds-datasets-header">' +
          '<div>' +
            '<h3 class="ds-datasets-title">' + _icon('database', 16) + ' 등록 데이터셋</h3>' +
            '<p class="ds-datasets-subtitle">수집 파이프라인에 연결된 공공 데이터 소스 목록</p>' +
          '</div>' +
          '<button id="ds-add-dataset-btn" class="ds-add-btn">' +
            _icon('plus', 14) + ' 새 데이터셋' +
          '</button>' +
        '</div>' +
        '<div id="ds-dataset-grid" class="ds-dataset-grid">' +
          _skeletonCards(5) +
        '</div>' +
        '<div id="ds-dataset-modal" class="ds-modal" style="display:none" role="dialog" aria-modal="true" aria-label="데이터셋 등록"></div>';

      _root.querySelector('#ds-add-dataset-btn').addEventListener('click', function () {
        DataStudioDatasets.openRegisterModal();
      });
    },

    /**
     * loadDatasets() — GET /api/v1/datasets 호출, 실패 시 datasets.json fallback
     */
    loadDatasets: function () {
      var token = _getToken();
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-API-Token'] = token;

      fetch('/api/v1/datasets', { headers: headers })
        .then(function (res) {
          if (!res.ok) throw new Error('status ' + res.status);
          return res.json();
        })
        .then(function (data) {
          _datasets = Array.isArray(data) ? data : (data.datasets || []);
          DataStudioDatasets._renderGrid();
        })
        .catch(function () {
          // 백엔드 미가동 시 registry JSON 직접 fetch (fallback)
          fetch('data_raw/_registry/datasets.json')
            .then(function (r) { return r.json(); })
            .then(function (json) {
              _datasets = json.datasets || [];
              DataStudioDatasets._renderGrid();
            })
            .catch(function (err) {
              console.warn('[DataStudioDatasets] fallback fetch 실패:', err);
              var grid = document.getElementById('ds-dataset-grid');
              if (grid) grid.innerHTML = '<p class="ds-empty-msg">' + _icon('alert-circle', 16) + ' 데이터셋을 불러올 수 없습니다.</p>';
            });
        });
    },

    /**
     * _renderGrid() — _datasets 배열로 카드 그리드 렌더
     */
    _renderGrid: function () {
      var grid = document.getElementById('ds-dataset-grid');
      if (!grid) return;
      if (!_datasets.length) {
        grid.innerHTML = '<p class="ds-empty-msg">' + _icon('database', 16) + ' 등록된 데이터셋이 없습니다.</p>';
        return;
      }
      grid.innerHTML = _datasets.map(function (ds) {
        return DataStudioDatasets.renderCard(ds);
      }).join('');
    },

    /**
     * renderCard(ds) — 카드 1개 HTML 반환
     * @param {object} ds - 데이터셋 객체
     * @returns {string} HTML string
     */
    renderCard: function (ds) {
      var status = (ds.schedule && ds.schedule.last_run_status) || 'pending';
      var freq = (ds.schedule && ds.schedule.frequency) || '';
      var geoCovered = (ds.scope && ds.scope.current_dongs_covered) || 0;
      var geoTarget = (ds.scope && ds.scope.target_dongs) || 0;
      var diff = (ds.difficulty && ds.difficulty.level) || '';
      var envVar = (ds.credentials && ds.credentials.env_var) || '';
      var obtainUrl = (ds.credentials && ds.credentials.obtain_url) || '#';
      var hasKey = !!(ds.credentials && ds.credentials.registered_at);
      var lastRunAt = (ds.schedule && ds.schedule.last_run_at) || '';
      var nextRunAt = (ds.schedule && ds.schedule.next_run_at) || '';
      var consecFails = (ds.schedule && ds.schedule.consecutive_failures) || 0;

      var keyLabel = hasKey
        ? (_josa(envVar, '가/이') + ' 등록됐어요')
        : (_josa(envVar, '를/을') + ' 등록하세요');

      return '<div class="ds-card">' +
        '<div class="ds-card-top">' +
          '<div class="ds-card-meta">' +
            '<span class="ds-card-org">' + (ds.source_org || '') + '</span>' +
            '<span class="ds-status-badge ' + status + '">' + (STATUS_LABEL[status] || status) + '</span>' +
          '</div>' +
          '<h4 class="ds-card-title">' + _icon('database', 15) + (ds.ko || ds.key) + '</h4>' +
          '<code class="ds-card-key">' + (ds.key || '') + '</code>' +
        '</div>' +
        '<div class="ds-card-body">' +
          '<div class="ds-card-row">' +
            _icon('map-pin', 13) +
            '<span>' + geoCovered.toLocaleString() + ' / ' + geoTarget.toLocaleString() + ' 읍면동</span>' +
          '</div>' +
          '<div class="ds-card-row">' +
            _icon('calendar', 13) +
            '<span>' + (FREQ_LABEL[freq] || freq || '—') + '</span>' +
            (diff ? '<span class="ds-diff-badge ' + diff + '">' + (DIFF_LABEL[diff] || diff) + '</span>' : '') +
          '</div>' +
          '<div class="ds-card-row">' +
            _icon('key', 13) +
            '<span class="' + (hasKey ? 'ds-key-ok' : 'ds-key-missing') + '">' + keyLabel + '</span>' +
          '</div>' +
          (lastRunAt ? (
            '<div class="ds-card-row">' +
              _icon('clock', 13) +
              '<span>마지막 실행: ' + _fmtDate(lastRunAt) + '</span>' +
              (consecFails >= 1 ? '<span class="ds-warn-badge">' + consecFails + '회 실패</span>' : '') +
            '</div>'
          ) : '') +
          (nextRunAt ? (
            '<div class="ds-card-row">' +
              _icon('chevrons-right', 13) +
              '<span>다음 실행: ' + _fmtDate(nextRunAt) + '</span>' +
            '</div>'
          ) : '') +
        '</div>' +
        '<div class="ds-card-footer">' +
          '<a href="' + obtainUrl + '" target="_blank" rel="noopener" class="ds-obtain-link">' +
            _icon('alert-circle', 12) + ' 키 발급 안내' +
          '</a>' +
        '</div>' +
      '</div>';
    },

    /**
     * openRegisterModal() — 등록 폼 모달 열기
     */
    openRegisterModal: function () {
      var modalEl = document.getElementById('ds-dataset-modal');
      if (!modalEl) return;

      modalEl.innerHTML =
        '<div class="ds-modal-backdrop" id="ds-modal-backdrop"></div>' +
        '<div class="ds-modal-card" role="document">' +
          '<div class="ds-modal-header">' +
            '<h3 class="ds-modal-title">' + _icon('plus', 16) + ' 새 데이터셋 등록</h3>' +
            '<button class="ds-modal-close" id="ds-modal-close-btn" aria-label="닫기">' + _icon('x', 16) + '</button>' +
          '</div>' +
          '<form id="ds-register-form" class="ds-form" novalidate>' +
            _formRow('key',        'text',   '데이터셋 키', 'kosis_living_pop', '소문자 영문/숫자/밑줄 (예: kosis_living_pop)', true) +
            _formRow('ko',         'text',   '한글 이름',   '생활인구',          '', true) +
            _formRow('source_org', 'text',   '제공 기관',   'KOSIS',             '', true) +
            _formRow('env_var',    'text',   '환경변수명',  'KOSIS_API_KEY',     '발급받은 API 키를 주입할 환경변수명', false) +
            _formSelect('frequency', '수집 주기', [
              { value: 'monthly',   label: '매월' },
              { value: 'weekly',    label: '매주' },
              { value: 'quarterly', label: '분기(3개월)' },
              { value: 'daily',     label: '매일' },
              { value: 'once',      label: '1회성' },
            ]) +
            _formSelect('difficulty', '구현 난이도', [
              { value: 'easy',   label: '쉬움 (4시간 이내)' },
              { value: 'medium', label: '보통 (하루)' },
              { value: 'hard',   label: '어려움 (이틀+)' },
            ]) +
            '<div class="ds-form-row ds-token-row" id="ds-token-row" style="display:none">' +
              '<label class="ds-form-label" for="ds-input-token">' + _icon('key', 13) + ' API 토큰 (일회성 입력)</label>' +
              '<input id="ds-input-token" type="password" class="ds-form-input" placeholder="백엔드 X-API-Token">' +
              '<p class="ds-form-hint">저장되지 않습니다. localStorage에 임시 보관됩니다.</p>' +
            '</div>' +
            '<div id="ds-form-error" class="ds-form-error" style="display:none"></div>' +
            '<div class="ds-form-actions">' +
              '<button type="button" id="ds-form-cancel-btn" class="ds-btn-secondary">취소</button>' +
              '<button type="submit" id="ds-form-submit-btn" class="ds-btn-primary">' + _icon('check', 14) + ' 등록</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      modalEl.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      // 토큰 없으면 입력 필드 노출
      if (!_getToken()) {
        document.getElementById('ds-token-row').style.display = '';
      }

      // 이벤트
      document.getElementById('ds-modal-backdrop').addEventListener('click', _closeModal);
      document.getElementById('ds-modal-close-btn').addEventListener('click', _closeModal);
      document.getElementById('ds-form-cancel-btn').addEventListener('click', _closeModal);
      document.getElementById('ds-register-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var payload = _collectFormPayload();
        if (!payload) return;
        DataStudioDatasets.submitRegister(payload);
      });
    },

    /**
     * submitRegister(payload) — POST /api/v1/datasets
     * @param {object} payload
     */
    submitRegister: function (payload) {
      var btn = document.getElementById('ds-form-submit-btn');
      var errEl = document.getElementById('ds-form-error');
      if (btn) { btn.disabled = true; btn.textContent = '등록 중…'; }
      if (errEl) errEl.style.display = 'none';

      var token = _getToken();
      if (!token) {
        _showFormError('API 토큰이 없습니다. 토큰을 입력해주세요.');
        if (btn) { btn.disabled = false; btn.innerHTML = _icon('check', 14) + ' 등록'; }
        return;
      }

      fetch('/api/v1/datasets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': token,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (e) { throw new Error(e.detail || '등록 실패 (' + res.status + ')'); });
          return res.json();
        })
        .then(function (created) {
          _datasets.unshift(created);
          DataStudioDatasets._renderGrid();
          _closeModal();
        })
        .catch(function (err) {
          _showFormError(err.message || '알 수 없는 오류가 발생했습니다.');
          if (btn) { btn.disabled = false; btn.innerHTML = _icon('check', 14) + ' 등록'; }
        });
    },
  };

  // ── 내부 헬퍼 ────────────────────────────────────────────────────────────

  function _getToken() {
    // localStorage 'ds_api_token' 우선, 폼 입력값 차선
    var stored = localStorage.getItem('ds_api_token');
    if (stored) return stored;
    var inputEl = document.getElementById('ds-input-token');
    if (inputEl && inputEl.value.trim()) {
      localStorage.setItem('ds_api_token', inputEl.value.trim());
      return inputEl.value.trim();
    }
    return null;
  }

  function _closeModal() {
    var modalEl = document.getElementById('ds-dataset-modal');
    if (modalEl) { modalEl.style.display = 'none'; modalEl.innerHTML = ''; }
    document.body.style.overflow = '';
  }

  function _collectFormPayload() {
    var key = _val('ds-input-key').trim();
    var ko  = _val('ds-input-ko').trim();
    var org = _val('ds-input-source_org').trim();
    var env = _val('ds-input-env_var').trim();
    var freq = _val('ds-input-frequency');
    var diff = _val('ds-input-difficulty');

    if (!key || !/^[a-z][a-z0-9_]+$/.test(key)) {
      _showFormError(_josa('키', '는/은') + ' 소문자 영문으로 시작하고 영문/숫자/밑줄만 허용됩니다.');
      return null;
    }
    if (!ko) {
      _showFormError('한글 이름을 입력해주세요.');
      return null;
    }
    if (!org) {
      _showFormError('제공 기관을 입력해주세요.');
      return null;
    }

    // 토큰 폼에서 읽어 localStorage 저장
    var tokenEl = document.getElementById('ds-input-token');
    if (tokenEl && tokenEl.value.trim()) {
      localStorage.setItem('ds_api_token', tokenEl.value.trim());
    }

    return {
      key: key,
      ko: ko,
      source_org: org,
      credentials: env ? { env_var: env } : {},
      schedule: { frequency: freq },
      scope: {},
      difficulty: { level: diff },
    };
  }

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function _showFormError(msg) {
    var el = document.getElementById('ds-form-error');
    if (!el) return;
    el.innerHTML = _icon('alert-circle', 14) + ' ' + msg;
    el.style.display = 'flex';
  }

  function _formRow(name, type, label, placeholder, hint, required) {
    return '<div class="ds-form-row">' +
      '<label class="ds-form-label" for="ds-input-' + name + '">' + label + (required ? ' <span class="ds-required">*</span>' : '') + '</label>' +
      '<input id="ds-input-' + name + '" type="' + type + '" class="ds-form-input"' +
        ' placeholder="' + placeholder + '"' +
        (required ? ' required' : '') + '>' +
      (hint ? '<p class="ds-form-hint">' + hint + '</p>' : '') +
    '</div>';
  }

  function _formSelect(name, label, options) {
    var opts = options.map(function (o) {
      return '<option value="' + o.value + '">' + o.label + '</option>';
    }).join('');
    return '<div class="ds-form-row">' +
      '<label class="ds-form-label" for="ds-input-' + name + '">' + label + '</label>' +
      '<select id="ds-input-' + name + '" class="ds-form-input ds-form-select">' + opts + '</select>' +
    '</div>';
  }

  function _skeletonCards(n) {
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<div class="ds-card ds-card-skeleton">' +
        '<div class="ds-skel ds-skel-sm"></div>' +
        '<div class="ds-skel ds-skel-lg" style="margin-top:10px"></div>' +
        '<div class="ds-skel ds-skel-md" style="margin-top:8px"></div>' +
        '<div class="ds-skel ds-skel-md" style="margin-top:8px"></div>' +
      '</div>';
    }
    return html;
  }

  // ── 탭 통합 — app.js의 switchDsPane monkey-patch ─────────────────────────
  // app.js는 datasets 탭을 모르므로, 탭 버튼 클릭 시 직접 처리.
  // switchDsPane 완료 후 datasets 패널 표시/숨김을 맞춰준다.
  function _patchTabIntegration() {
    var dsBtn = document.querySelector('[data-ds="datasets"]');
    var dsPane = document.getElementById('ds-datasets');
    if (!dsBtn || !dsPane) return;

    // 초기화: datasets 패널이 처음엔 숨겨져 있어야 함
    dsPane.classList.add('hidden');
    dsPane.classList.remove('block');

    // datasets 탭 클릭 처리
    dsBtn.addEventListener('click', function () {
      // 다른 모든 ds-pane 숨기기, 다른 탭 버튼 비활성화
      document.querySelectorAll('.ds-pane').forEach(function (p) {
        p.classList.add('hidden');
        p.classList.remove('block');
      });
      document.querySelectorAll('[data-ds]').forEach(function (b) {
        b.classList.remove('text-white');
        b.classList.add('text-gray-300');
        b.style.background = '';
        b.style.fontWeight = '';
      });

      // datasets 탭 활성화
      dsPane.classList.remove('hidden');
      dsPane.classList.add('block');
      dsBtn.classList.remove('text-gray-300');
      dsBtn.classList.add('text-white');
      dsBtn.style.background = '#00A1E0';

      // datasets 패널에 컴포넌트 init
      DataStudioDatasets.init(dsPane);
    });

    // 다른 ds 탭 클릭 시 datasets 패널 숨기기 (app.js switchDsPane 보완)
    var origSwitch = window.switchDsPane;
    if (typeof origSwitch === 'function') {
      window.switchDsPane = function () {
        origSwitch.apply(this, arguments);
        // datasets 탭이 활성이 아니면 패널 숨김
        var active = document.querySelector('[data-ds].text-white');
        var isDatasets = active && active.dataset.ds === 'datasets';
        dsPane.classList.toggle('hidden', !isDatasets);
        dsPane.classList.toggle('block', isDatasets);
        if (!isDatasets) {
          dsBtn.classList.remove('text-white');
          dsBtn.classList.add('text-gray-300');
          dsBtn.style.background = '';
        }
      };
    }
  }

  // DOM 준비 후 탭 통합
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _patchTabIntegration);
  } else {
    _patchTabIntegration();
  }

  // ── 노출 ──────────────────────────────────────────────────────────────────
  window.DataStudioDatasets = DataStudioDatasets;

})();
