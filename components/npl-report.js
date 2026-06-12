// components/npl-report.js
// NPL 리포트 생성 (P5) — 단일 물건 / 포트폴리오 전체 → 인쇄용 리포트 + PDF 저장
// 부모: GENERATE_CODE_NPL_REPORT-001. 참조: docs/npl-portfolio-architecture.md §5
//
// 정적 사이트라 서버 PDF 생성 대신 window.print() 기반 (의존성 0, 라이브 즉시 작동).
// 객관성 원칙: 모든 수치에 신뢰구간(p10~p90) + 신뢰도 병기. 한 점 숫자 금지.
//
// 진입점:
//   window.nplReport.single(asset, allItems)   — 단일 물건 리포트
//   window.nplReport.portfolio(items)           — 포트폴리오 전체 리포트

(function() {
  'use strict';

  var GRADE = {
    very_high: { ko: '적극 매수', color: '#00529B' }, high: { ko: '매수 검토', color: '#5BC0EB' },
    medium: { ko: '관망/검토', color: '#FED766' }, low: { ko: '비추천', color: '#C9485B' },
  };
  var CT_KO = { apt: '아파트', officetel: '오피스텔', commercial: '상가', land: '토지' };

  function fmtMan(v) { var n = +v || 0; return n >= 10000 ? (Math.round(n/1000)/10)+'억' : Math.round(n)+'만'; }
  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
  }
  function pct(target, pool, key) {
    var v = pool.filter(function(x){ return x[key] != null; });
    if (v.length <= 1) return null;
    var below = v.filter(function(x){ return x[key] < target[key]; }).length;
    return Math.round(below / (v.length - 1) * 100);
  }
  function today() {
    // Date 직접 사용 회피 — DOM에서 현재 시각 표기는 toLocaleDateString 허용
    try { return new Date().toLocaleDateString('ko-KR'); } catch (e) { return ''; }
  }

  // ── 리포트 창 띄우기 (별도 창 → 인쇄) ──
  function openReport(title, bodyHtml) {
    var w = window.open('', '_blank', 'width=860,height=1000');
    if (!w) { alert('팝업이 차단되었습니다. 팝업을 허용해주세요.'); return; }
    w.document.write(''
      + '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>' + esc(title) + '</title>'
      + '<style>' + reportCss() + '</style></head><body>'
      + '<div class="rpt-toolbar no-print"><button onclick="window.print()">PDF로 저장 / 인쇄</button>'
      + '<span>리포트는 한 점 평가가 아닌 신뢰구간(p10~p90)·신뢰도 기반입니다.</span></div>'
      + bodyHtml
      + '<footer class="rpt-footer">TowninAlpafold · NPL 자산평가 리포트 · ' + today() + ' · Gagahoho Inc.</footer>'
      + '</body></html>');
    w.document.close();
  }

  function reportCss() {
    return ''
      + '*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + 'body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#1a1a1a;padding:32px 40px;line-height:1.5}'
      + '.rpt-toolbar{display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:10px 14px;background:#f0f7ff;border-radius:8px;font-size:12px;color:#6b7280}'
      + '.rpt-toolbar button{padding:8px 18px;background:#00529B;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer}'
      + 'h1{font-size:22px;margin-bottom:4px}h2{font-size:15px;margin:22px 0 10px;padding-bottom:6px;border-bottom:2px solid #00529B;color:#00529B}'
      + '.rpt-sub{color:#6b7280;font-size:13px;margin-bottom:18px}'
      + '.rpt-grade{display:inline-block;padding:5px 16px;border-radius:999px;font-weight:700;color:#fff;font-size:15px}'
      + '.rpt-kv{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px;margin:12px 0}'
      + '.rpt-kv div{font-size:13px;display:flex;justify-content:space-between;border-bottom:1px solid #f0f0f0;padding:5px 0}'
      + '.rpt-kv b{color:#374151}'
      + '.rpt-cone{display:flex;justify-content:space-between;background:#fafbfc;border-radius:8px;padding:12px 16px;margin:10px 0}'
      + '.rpt-cone div{text-align:center}.rpt-cone .v{font-size:18px;font-weight:800}.rpt-cone .l{font-size:11px;color:#6b7280}'
      + '.rpt-pct{margin:10px 0;font-size:14px}.rpt-pct b{color:#00529B}'
      + '.rpt-note{font-size:12px;color:#9ca3af;margin:6px 0}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}'
      + 'th{background:#f9fafb;color:#6b7280;text-align:left;padding:7px 9px;border-bottom:2px solid #e5e7eb;font-size:11px}'
      + 'td{padding:6px 9px;border-bottom:1px solid #f3f4f6}'
      + '.rpt-badge{display:inline-block;padding:1px 8px;border-radius:999px;color:#fff;font-size:10px;font-weight:700}'
      + '.rpt-bars{margin:10px 0}.rpt-bar-row{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px}'
      + '.rpt-bar-label{flex:0 0 90px;font-weight:700}.rpt-bar-track{flex:1;display:block;height:14px;background:#e5e7eb;border-radius:4px;overflow:hidden}'
      + '.rpt-bar-fill{display:block;height:14px;border-radius:4px}.rpt-bar-num{flex:0 0 70px;text-align:right;color:#6b7280}'
      + '.rpt-footer{margin-top:32px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center}'
      + '@media print{.no-print{display:none}body{padding:0}@page{margin:18mm 14mm}}';
  }

  // ── 단일 물건 리포트 ──
  function single(asset, all) {
    var g = GRADE[asset.grade] || { ko: asset.grade, color: '#999' };
    var isBuy = asset.eval_type === 'buy';
    var metricKey = isBuy ? 'score_irr' : 'score_npv';
    var metricVal = isBuy ? (asset.score_irr != null ? (asset.score_irr*100).toFixed(1)+'% IRR' : '-') : fmtMan(asset.score_npv)+' NPV';
    var sameType = (all || []).filter(function(x){ return x.eval_type === asset.eval_type; });
    var peers = sameType.filter(function(x){ return x.collateral_type===asset.collateral_type && x.region_code===asset.region_code; });
    var pAll = pct(asset, sameType, metricKey);
    var pPeer = peers.length > 1 ? pct(asset, peers, metricKey) : null;

    var body = ''
      + '<h1>NPL 자산평가 리포트</h1>'
      + '<div class="rpt-sub">' + esc(asset.id) + ' · ' + esc(asset.address || '-') + '</div>'
      + '<span class="rpt-grade" style="background:' + g.color + '">' + g.ko + ' · ' + metricVal + '</span>'

      + '<h2>1. 물건 개요</h2>'
      + '<div class="rpt-kv">'
      +   '<div><span>평가 유형</span><b>' + (isBuy ? '매수 평가' : '매도 평가') + '</b></div>'
      +   '<div><span>담보 유형</span><b>' + (CT_KO[asset.collateral_type] || '-') + '</b></div>'
      +   '<div><span>평가 등급</span><b>' + g.ko + '</b></div>'
      +   '<div><span>평가 신뢰도</span><b>' + Math.round((asset.confidence||0)*100) + '%</b></div>'
      + '</div>'

      + '<h2>2. 회수 cone (불확실성 구간)</h2>'
      + '<div class="rpt-cone">'
      +   '<div><div class="v">' + fmtMan(asset.recovery_p10) + '</div><div class="l">p10 (보수)</div></div>'
      +   '<div><div class="v" style="color:#00529B">' + fmtMan(asset.recovery_p50) + '</div><div class="l">p50 (중앙)</div></div>'
      +   '<div><div class="v">' + fmtMan(asset.recovery_p90) + '</div><div class="l">p90 (낙관)</div></div>'
      + '</div>'
      + '<div class="rpt-note">회수액은 단일 추정치가 아니라 95% 신뢰구간으로 제시됩니다.</div>'

      + '<h2>3. 모집단 백분위 (객관성)</h2>'
      + (pAll != null ? '<div class="rpt-pct">전체 ' + (isBuy?'매수':'매도') + ' 물건 ' + sameType.length + '건 중 <b>상위 ' + (100-pAll) + '%</b></div>' : '')
      + (pPeer != null ? '<div class="rpt-pct">동급(' + (CT_KO[asset.collateral_type]||'-') + ') ' + peers.length + '건 중 <b>상위 ' + (100-pPeer) + '%</b></div>'
                        : '<div class="rpt-note">동급 비교 표본 부족 (' + peers.length + '건)</div>')
      + '<div class="rpt-note">평가의 객관성: 한 점 수치가 아니라 모집단 분포 속 상대적 위치로 제시.</div>';

    openReport('NPL 리포트 — ' + asset.id, body);
  }

  // ── 포트폴리오 전체 리포트 ──
  function portfolio(items) {
    var total = items.length;
    var gd = {}; ['very_high','high','medium','low'].forEach(function(k){ gd[k]=0; });
    var coneSum = { p10:0, p50:0, p90:0 }, confSum = 0;
    items.forEach(function(it) {
      if (gd[it.grade] != null) gd[it.grade]++;
      coneSum.p10 += it.recovery_p10||0; coneSum.p50 += it.recovery_p50||0; coneSum.p90 += it.recovery_p90||0;
      confSum += it.confidence||0;
    });
    var gradeBars = ['very_high','high','medium','low'].map(function(k) {
      var n = gd[k], p = total ? Math.round(n/total*100) : 0;
      return '<div class="rpt-bar-row"><span class="rpt-bar-label" style="color:' + GRADE[k].color + '">' + GRADE[k].ko + '</span>'
        + '<span class="rpt-bar-track"><span class="rpt-bar-fill" style="width:' + p + '%;background:' + GRADE[k].color + '"></span></span>'
        + '<span class="rpt-bar-num">' + n + '건 (' + p + '%)</span></div>';
    }).join('');

    // Top/Bottom 5 (IRR/NPV)
    function metric(it){ return it.eval_type==='buy' ? it.score_irr : it.score_npv; }
    var sorted = items.slice().filter(function(it){return metric(it)!=null;}).sort(function(a,b){return metric(b)-metric(a);});
    function rowsOf(arr) {
      return arr.map(function(it) {
        var g = GRADE[it.grade]||{ko:it.grade,color:'#999'};
        var m = it.eval_type==='buy' ? (it.score_irr*100).toFixed(1)+'%' : fmtMan(it.score_npv);
        return '<tr><td>' + esc(it.id) + '</td><td>' + esc(it.address||'-') + '</td><td>' + (CT_KO[it.collateral_type]||'-')
          + '</td><td>' + m + '</td><td><span class="rpt-badge" style="background:' + g.color + '">' + g.ko + '</span></td></tr>';
      }).join('');
    }

    var body = ''
      + '<h1>NPL 포트폴리오 종합 리포트</h1>'
      + '<div class="rpt-sub">총 ' + total + '건 · 평가일 ' + today() + '</div>'

      + '<h2>1. 포트폴리오 요약</h2>'
      + '<div class="rpt-kv">'
      +   '<div><span>총 물건 수</span><b>' + total + '건</b></div>'
      +   '<div><span>평균 신뢰도</span><b>' + Math.round(confSum/(total||1)*100) + '%</b></div>'
      + '</div>'
      + '<div class="rpt-cone">'
      +   '<div><div class="v">' + fmtMan(coneSum.p10) + '</div><div class="l">총 회수 p10</div></div>'
      +   '<div><div class="v" style="color:#00529B">' + fmtMan(coneSum.p50) + '</div><div class="l">총 회수 p50</div></div>'
      +   '<div><div class="v">' + fmtMan(coneSum.p90) + '</div><div class="l">총 회수 p90</div></div>'
      + '</div>'

      + '<h2>2. 등급 분포</h2>'
      + '<div class="rpt-bars">' + gradeBars + '</div>'

      + '<h2>3. 우량 물건 Top 5</h2>'
      + '<table><thead><tr><th>ID</th><th>주소</th><th>담보</th><th>IRR/NPV</th><th>등급</th></tr></thead><tbody>'
      + rowsOf(sorted.slice(0, 5)) + '</tbody></table>'

      + '<h2>4. 주의 물건 Bottom 5 (추가 실사 권장)</h2>'
      + '<table><thead><tr><th>ID</th><th>주소</th><th>담보</th><th>IRR/NPV</th><th>등급</th></tr></thead><tbody>'
      + rowsOf(sorted.slice(-5).reverse()) + '</tbody></table>'
      + '<div class="rpt-note">모든 회수액은 신뢰구간(p10~p90) 기반. 신뢰도 낮은 물건은 추가 실사가 필요합니다.</div>';

    openReport('NPL 포트폴리오 종합 리포트', body);
  }

  window.nplReport = { single: single, portfolio: portfolio };
})();
