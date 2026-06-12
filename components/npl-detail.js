// components/npl-detail.js
// NPL 단건 객관성 패널 (P3) — 모집단 백분위 + cone + 신뢰도 시각화
// 부모: GENERATE_CODE_NPL_PORTFOLIO_VIEW-001 (P3 객관성)
// 호출: window.showNplDetail(asset, allItems) — 포트폴리오 행 클릭 시
//
// 객관성 핵심: "IRR 16.7%"가 아니라 "전체 80건 중 상위 23%, 동급 12건 중 상위 15%".
//   한 점 평가가 아닌 '모집단 분포 속 위치'로 객관성을 시각화.

(function() {
  'use strict';

  var GRADE = {
    very_high: { ko: '적극 매수', color: '#00529B' },
    high:      { ko: '매수 검토', color: '#5BC0EB' },
    medium:    { ko: '관망/검토', color: '#FED766' },
    low:       { ko: '비추천',   color: '#C9485B' },
  };
  var CT_KO = { apt: '아파트', officetel: '오피스텔', commercial: '상가', land: '토지' };

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }

  // ── 모집단 백분위 (객관성 ③) — 클라이언트 계산 (정적 fallback 대응) ──
  function percentile(target, pool, metricKey) {
    var vals = pool.filter(function(x){ return x[metricKey] != null; });
    if (vals.length <= 1) return { pct: 50, total: vals.length };
    var v = target[metricKey];
    var below = vals.filter(function(x){ return x[metricKey] < v; }).length;
    return { pct: Math.round(below / (vals.length - 1) * 100), total: vals.length };
  }

  function comparable(asset, all) {
    var metric = asset.eval_type === 'buy' ? 'score_irr' : 'score_npv';
    var sameType = all.filter(function(x){ return x.eval_type === asset.eval_type; });
    var peers = sameType.filter(function(x){
      return x.collateral_type === asset.collateral_type && x.region_code === asset.region_code;
    });
    return {
      metric: metric,
      all: percentile(asset, sameType, metric),
      peer: peers.length > 1 ? percentile(asset, peers, metric) : null,
      peer_total: peers.length,
    };
  }

  // 백분위 → 평가 문구 (상위 % 기준)
  function rankText(pct) {
    var top = 100 - pct;
    if (top <= 15) return { label: '상위 ' + top + '%', tone: 'good' };
    if (top <= 40) return { label: '상위 ' + top + '%', tone: 'mid' };
    if (pct <= 25) return { label: '하위 ' + (pct + 1) + '%', tone: 'bad' };
    return { label: '중위 (상위 ' + top + '%)', tone: 'mid' };
  }

  function render(asset, all) {
    var g = GRADE[asset.grade] || { ko: asset.grade, color: '#999' };
    var cmp = comparable(asset, all);
    var metricLabel = asset.eval_type === 'buy'
      ? 'IRR ' + (asset.score_irr != null ? (asset.score_irr * 100).toFixed(1) + '%' : '-')
      : 'NPV ' + fmtMan(asset.score_npv);

    // 백분위 바 (전체 + 동급)
    function pctBar(title, p) {
      if (!p) return '';
      var rt = rankText(p.pct);
      var toneColor = rt.tone === 'good' ? '#00529B' : rt.tone === 'bad' ? '#C9485B' : '#FED766';
      return '<div class="npl-pct-block">'
        + '<div class="npl-pct-head">' + title + ' <b style="color:' + toneColor + '">' + rt.label + '</b> <span class="npl-pct-sub">(' + p.total + '건 중)</span></div>'
        + '<div class="npl-pct-track"><span class="npl-pct-fill" style="width:' + p.pct + '%"></span>'
        + '<span class="npl-pct-marker" style="left:' + p.pct + '%" title="이 물건"></span></div>'
        + '<div class="npl-pct-axis"><span>하위</span><span>상위</span></div></div>';
    }

    // cone 막대 (p10~p90)
    var c10 = asset.recovery_p10 || 0, c50 = asset.recovery_p50 || 0, c90 = asset.recovery_p90 || 0;
    var span = (c90 - c10) || 1;
    var p50pos = Math.round((c50 - c10) / span * 100);

    var html = ''
      + '<div class="npl-detail-overlay" data-action="close-detail"></div>'
      + '<aside class="npl-detail-panel" role="dialog" aria-label="물건 객관성 상세">'
      +   '<div class="npl-detail-head">'
      +     '<div><div class="npl-detail-id">' + esc(asset.id) + '</div>'
      +     '<div class="npl-detail-addr">' + esc(asset.address || '-') + '</div></div>'
      +     '<button class="npl-detail-close" data-action="close-detail" aria-label="닫기">✕</button>'
      +   '</div>'
      +   '<div class="npl-detail-grade" style="background:' + g.color + ';color:#fff">' + g.ko + ' · ' + metricLabel + '</div>'
      +   '<div class="npl-detail-meta">'
      +     '<span>' + (asset.eval_type === 'buy' ? '매수' : '매도') + '</span>'
      +     '<span>' + (CT_KO[asset.collateral_type] || asset.collateral_type || '-') + '</span>'
      +     '<span>신뢰도 ' + Math.round((asset.confidence || 0) * 100) + '%</span>'
      +   '</div>'

      +   '<div class="npl-detail-section">'
      +     '<div class="npl-section-head">① 모집단 백분위 (객관성)</div>'
      +     '<div class="npl-detail-objnote">이 물건은 한 점 평가가 아니라 전체 분포 속 위치로 본다.</div>'
      +     pctBar('전체 ' + (asset.eval_type === 'buy' ? '매수' : '매도') + ' 물건 중', cmp.all)
      +     (cmp.peer ? pctBar('동급(' + (CT_KO[asset.collateral_type]||asset.collateral_type) + ') 중', cmp.peer)
                      : '<div class="npl-pct-nopeer">동급 물건 ' + cmp.peer_total + '건 — 비교 표본 부족</div>')
      +   '</div>'

      +   '<div class="npl-detail-section">'
      +     '<div class="npl-section-head">② 회수 cone (불확실성 구간)</div>'
      +     '<div class="npl-cone-viz">'
      +       '<div class="npl-cone-bar"><span class="npl-cone-p50" style="left:' + p50pos + '%"></span></div>'
      +       '<div class="npl-cone-vals"><span>p10 ' + fmtMan(c10) + '</span><span><b>p50 ' + fmtMan(c50) + '</b></span><span>p90 ' + fmtMan(c90) + '</span></div>'
      +     '</div>'
      +   '</div>'

      +   '<div class="npl-detail-section">'
      +     '<div class="npl-section-head">③ 신뢰도 (pLDDT)</div>'
      +     '<div class="npl-conf-bar"><span class="npl-conf-fill" style="width:' + Math.round((asset.confidence||0)*100) + '%"></span></div>'
      +     '<div class="npl-detail-objnote">입력 완전성 기반 — 결측이 많을수록 신뢰도 하락.</div>'
      +   '</div>'

      +   '<button class="pd-deep-link" data-action="goto-eval">' + (asset.eval_type === 'buy' ? '매수' : '매도') + ' 평가 화면에서 재평가</button>'
      + '</aside>';

    var host = document.getElementById('npl-detail-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'npl-detail-host';
      document.body.appendChild(host);
    }
    host.innerHTML = html;
    host.querySelectorAll('[data-action="close-detail"]').forEach(function(el) {
      el.addEventListener('click', close);
    });
    var goto = host.querySelector('[data-action="goto-eval"]');
    if (goto) goto.addEventListener('click', function() {
      close();
      if (typeof window.switchMode === 'function') window.switchMode(asset.eval_type === 'buy' ? 'npl-buy' : 'npl-sell');
    });
    document.addEventListener('keydown', _esc);
  }

  function _esc(e) { if (e.key === 'Escape') close(); }
  function close() {
    var host = document.getElementById('npl-detail-host');
    if (host) host.innerHTML = '';
    document.removeEventListener('keydown', _esc);
  }

  window.showNplDetail = render;
})();
