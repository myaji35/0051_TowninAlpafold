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

  // ── 펀드(LP IR) 수수료 계산 (Python fund_fees와 동일 공식) ──
  // ⚠ 단순화: catch-up 미적용. hurdle 초과분에 carry 적용. IRR은 연복리 근사.
  function calcFundFees(committed, totalRecovered, fundYears, mgmtRate, carryRate, hurdleRate) {
    var managementFee = committed * mgmtRate * fundYears;
    var hurdleThreshold = committed * Math.pow(1 + hurdleRate, fundYears);
    var carryBase = Math.max(0, totalRecovered - hurdleThreshold - managementFee);
    var carry = carryBase * carryRate;
    var lpNet = totalRecovered - managementFee - carry;
    var lpMoic = committed > 0 ? lpNet / committed : 0;
    var lpIrrApprox = (committed > 0 && lpMoic > 0 && fundYears > 0)
      ? (Math.pow(lpMoic, 1 / fundYears) - 1) : 0;
    return {
      managementFee: Math.round(managementFee),
      hurdleThreshold: Math.round(hurdleThreshold),
      carryBase: Math.round(carryBase),
      carry: Math.round(carry),
      lpNet: Math.round(lpNet),
      gpTotal: Math.round(managementFee + carry),
      lpMoic: Math.round(lpMoic * 1000) / 1000,
      lpIrrApprox: Math.round(lpIrrApprox * 10000) / 10000,
    };
  }

  // ── 몬테카를로 (JS 간이판, n_sims 기본 5000 — 브라우저 성능 고려) ──
  // ⚠ 물건간 독립 가정. 삼각분포 근사. 브라우저 내 확인용 — 정밀값은 Python 백엔드 사용.
  function mcTriangular(rng, lo, mode, hi) {
    if (hi <= lo) return mode;
    var u = rng();
    var fc = (mode - lo) / (hi - lo);
    if (u < fc) return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
    return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  }

  function calcMonteCarlo(items, nSims, seed) {
    nSims = nSims || 5000;
    // 간이 PRNG (mulberry32)
    var s = seed || 42; s = (s >>> 0) + 1;
    function rng() {
      s += 0x6D2B79F5; var t = Math.imul(s ^ s >>> 15, 1 | s);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    var params = [];
    var p50Sum = 0;
    items.forEach(function(it) {
      var p10 = +(it.recovery_p10 || (it.recovery_p50 || 0) * 0.7);
      var p50 = +(it.recovery_p50 || 0);
      var p90 = +(it.recovery_p90 || p50 * 1.3);
      var lo = Math.max(0, p10 * 0.5);
      var hi = p90 * 1.3;
      var mode = Math.max(lo, Math.min(p50, hi));
      params.push([lo, mode, hi]);
      p50Sum += p50;
    });
    var principal = p50Sum * 0.75; // p50 합산의 75% — 매입가 근사
    var sims = [];
    for (var i = 0; i < nSims; i++) {
      var tot = 0;
      for (var j = 0; j < params.length; j++) {
        tot += mcTriangular(rng, params[j][0], params[j][1], params[j][2]);
      }
      sims.push(tot);
    }
    sims.sort(function(a, b) { return a - b; });
    function pv(p) { return Math.round(sims[Math.min(sims.length-1, Math.floor(p/100*sims.length))]); }
    var lossCount = sims.filter(function(v) { return v < principal; }).length;
    var mean = sims.reduce(function(a, b) { return a + b; }, 0) / sims.length;
    return { p5: pv(5), p25: pv(25), p50: pv(50), p75: pv(75), p95: pv(95),
             mean: Math.round(mean), lossProb: Math.round(lossCount / sims.length * 1000) / 1000 };
  }

  // ── 펀드(LP IR) 리포트 ──
  function fund(items, fundConfig) {
    var cfg = fundConfig || {};
    var committed = +(cfg.committed_capital || 0);
    var fundYears = +(cfg.fund_years || 3);
    var mgmtRate = +(cfg.mgmt_rate || 0.02);
    var carryRate = +(cfg.carry_rate || 0.20);
    var hurdleRate = +(cfg.hurdle_rate || 0.08);
    var gpName = cfg.gp_name || '운용사(GP)';
    var fundName = cfg.fund_name || 'NPL 투자 펀드';
    var fundVintage = cfg.vintage || today().split('.')[0] + '년';
    var nSims = cfg.n_sims || 5000;
    var seed = cfg.seed || 42;

    // 회수 cone (p10/p50/p90 합산)
    var cone = {p10: 0, p50: 0, p90: 0};
    items.forEach(function(it) {
      cone.p10 += +(it.recovery_p10 || 0);
      cone.p50 += +(it.recovery_p50 || 0);
      cone.p90 += +(it.recovery_p90 || 0);
    });

    // 시나리오별 수수료 (p10/p50/p90)
    var fees10 = calcFundFees(committed, cone.p10, fundYears, mgmtRate, carryRate, hurdleRate);
    var fees50 = calcFundFees(committed, cone.p50, fundYears, mgmtRate, carryRate, hurdleRate);
    var fees90 = calcFundFees(committed, cone.p90, fundYears, mgmtRate, carryRate, hurdleRate);

    // 몬테카를로 (JS 간이판)
    var mc = calcMonteCarlo(items, nSims, seed);

    // 등급/담보 분산 (포트폴리오 리포트 재활용 로직)
    var total = items.length;
    var gd = {}; var ctd = {}; var confSum = 0;
    items.forEach(function(it) {
      gd[it.grade] = (gd[it.grade] || 0) + 1;
      ctd[it.collateral_type || '기타'] = (ctd[it.collateral_type || '기타'] || 0) + 1;
      confSum += +(it.confidence || 0);
    });

    // ── 섹션1: 펀드 개요 ──
    var sec1 = '<h2>1. 펀드 개요</h2>'
      + '<div class="rpt-kv">'
      +   '<div><span>펀드명</span><b>' + esc(fundName) + '</b></div>'
      +   '<div><span>운용사(GP)</span><b>' + esc(gpName) + '</b></div>'
      +   '<div><span>약정총액</span><b>' + fmtMan(committed) + '</b></div>'
      +   '<div><span>운용 기간</span><b>' + fundYears + '년</b></div>'
      +   '<div><span>투자 물건 수</span><b>' + total + '건</b></div>'
      +   '<div><span>평균 신뢰도</span><b>' + Math.round(confSum / (total || 1) * 100) + '%</b></div>'
      +   '<div><span>빈티지</span><b>' + esc(fundVintage) + '</b></div>'
      +   '<div><span>리포트 기준일</span><b>' + today() + '</b></div>'
      + '</div>'
      + '<div class="rpt-note">⚠ 이 리포트는 투자 권유 문서가 아닙니다. 수치는 모델 추정이며 실제 결과와 다를 수 있습니다.</div>';

    // ── 섹션2: 회수 전망 (cone + 몬테카를로) ──
    var sec2 = '<h2>2. 회수 전망 (신뢰구간 기반)</h2>'
      + '<h3 style="font-size:13px;color:#374151;margin:10px 0 6px">2-1. 펀드 단위 회수 Cone</h3>'
      + '<div class="rpt-cone">'
      +   '<div><div class="v">' + fmtMan(cone.p10) + '</div><div class="l">p10 (보수 시나리오)</div></div>'
      +   '<div><div class="v" style="color:#00529B">' + fmtMan(cone.p50) + '</div><div class="l">p50 (중간 시나리오)</div></div>'
      +   '<div><div class="v">' + fmtMan(cone.p90) + '</div><div class="l">p90 (낙관 시나리오)</div></div>'
      + '</div>'
      + '<h3 style="font-size:13px;color:#374151;margin:14px 0 6px">2-2. 몬테카를로 분포 (' + nSims.toLocaleString() + '회 시뮬레이션)</h3>'
      + '<div class="rpt-cone">'
      +   '<div><div class="v" style="font-size:13px">' + fmtMan(mc.p5) + '</div><div class="l">p5</div></div>'
      +   '<div><div class="v" style="font-size:13px">' + fmtMan(mc.p25) + '</div><div class="l">p25</div></div>'
      +   '<div><div class="v" style="color:#00529B">' + fmtMan(mc.p50) + '</div><div class="l">p50 (중앙)</div></div>'
      +   '<div><div class="v" style="font-size:13px">' + fmtMan(mc.p75) + '</div><div class="l">p75</div></div>'
      +   '<div><div class="v" style="font-size:13px">' + fmtMan(mc.p95) + '</div><div class="l">p95</div></div>'
      + '</div>'
      + '<div class="rpt-pct">원금 손실 확률 (매입가 근사): <b>' + (mc.lossProb * 100).toFixed(1) + '%</b></div>'
      + '<div class="rpt-note">'
      +   '⚠ 몬테카를로 가정: 물건간 독립(상관관계 미반영) · 삼각분포 근사 · '
      +   'JS 간이판(' + nSims.toLocaleString() + '회). 정밀값은 Python 백엔드 사용 권장.'
      + '</div>';

    // ── 섹션3: 수수료 구조 (waterfall 표) ──
    function feeRow(label, f) {
      return '<tr>'
        + '<td>' + label + '</td>'
        + '<td style="text-align:right">' + fmtMan(f.managementFee) + '</td>'
        + '<td style="text-align:right">' + fmtMan(f.carry) + '</td>'
        + '<td style="text-align:right">' + fmtMan(f.gpTotal) + '</td>'
        + '<td style="text-align:right;color:#00529B;font-weight:700">' + fmtMan(f.lpNet) + '</td>'
        + '<td style="text-align:right">' + f.lpMoic + '배</td>'
        + '<td style="text-align:right">' + (f.lpIrrApprox * 100).toFixed(1) + '%</td>'
        + '</tr>';
    }
    var sec3 = '<h2>3. 수수료 구조 (Waterfall)</h2>'
      + '<div class="rpt-kv">'
      +   '<div><span>연 운용보수율</span><b>' + (mgmtRate * 100).toFixed(1) + '%</b></div>'
      +   '<div><span>성과보수율(carry)</span><b>' + (carryRate * 100).toFixed(0) + '%</b></div>'
      +   '<div><span>기준수익률(hurdle)</span><b>연 ' + (hurdleRate * 100).toFixed(0) + '% (복리)</b></div>'
      +   '<div><span>운용 기간</span><b>' + fundYears + '년</b></div>'
      + '</div>'
      + '<table><thead><tr>'
      +   '<th>시나리오</th><th style="text-align:right">운용보수</th>'
      +   '<th style="text-align:right">성과보수</th><th style="text-align:right">GP 합계</th>'
      +   '<th style="text-align:right">LP 순수익</th><th style="text-align:right">LP MoIC</th>'
      +   '<th style="text-align:right">LP IRR(근사)</th>'
      + '</tr></thead><tbody>'
      + feeRow('보수 시나리오 (p10)', fees10)
      + feeRow('중간 시나리오 (p50)', fees50)
      + feeRow('낙관 시나리오 (p90)', fees90)
      + '</tbody></table>'
      + '<div class="rpt-note">'
      +   '⚠ 단순화: catch-up 조항 미적용. hurdle 복리(' + (hurdleRate*100).toFixed(0) + '%) 초과분에 carry 적용. '
      +   'IRR은 연복리 근사(현금흐름 타이밍 미반영). 실제 LP계약 waterfall과 다를 수 있음.'
      + '</div>';

    // ── 섹션4: 등급/담보 분산 ──
    var gradeBars = ['very_high','high','medium','low'].map(function(k) {
      var n = gd[k] || 0, p = total ? Math.round(n / total * 100) : 0;
      var g = GRADE[k] || {ko: k, color: '#999'};
      return '<div class="rpt-bar-row"><span class="rpt-bar-label" style="color:' + g.color + '">' + g.ko + '</span>'
        + '<span class="rpt-bar-track"><span class="rpt-bar-fill" style="width:' + p + '%;background:' + g.color + '"></span></span>'
        + '<span class="rpt-bar-num">' + n + '건 (' + p + '%)</span></div>';
    }).join('');
    var ctBars = Object.keys(ctd).map(function(ct) {
      var n = ctd[ct], p = total ? Math.round(n / total * 100) : 0;
      return '<div class="rpt-bar-row"><span class="rpt-bar-label">' + (CT_KO[ct] || ct) + '</span>'
        + '<span class="rpt-bar-track"><span class="rpt-bar-fill" style="width:' + p + '%;background:#5BC0EB"></span></span>'
        + '<span class="rpt-bar-num">' + n + '건 (' + p + '%)</span></div>';
    }).join('');
    var sec4 = '<h2>4. 포트폴리오 구성</h2>'
      + '<h3 style="font-size:13px;color:#374151;margin:10px 0 6px">등급 분포</h3>'
      + '<div class="rpt-bars">' + gradeBars + '</div>'
      + '<h3 style="font-size:13px;color:#374151;margin:10px 0 6px">담보 유형</h3>'
      + '<div class="rpt-bars">' + ctBars + '</div>';

    // ── 섹션5: 리스크 고지 ──
    var sec5 = '<h2>5. 리스크 고지</h2>'
      + '<div style="font-size:13px;line-height:1.8;color:#374151">'
      + '<p><b>① 예측 불확실성:</b> 모든 회수 전망은 신뢰구간(p10~p90)이며 확정 수익이 아닙니다.'
      +   ' 실제 경매 결과는 모델 예측과 상이할 수 있습니다.</p>'
      + '<p><b>② 부동산 시장 위험:</b> 금리 상승·경기 침체·지역 특수요인에 의해 낙찰가율이'
      +   ' 예측 범위 밖으로 하락할 수 있습니다.</p>'
      + '<p><b>③ 권리관계 위험:</b> 임차인 최우선변제권·세금 우선변제 등으로 실 회수액이'
      +   ' 감소할 수 있습니다. 정밀 권리분석 후 투자 결정 권고.</p>'
      + '<p><b>④ 유동성 위험:</b> NPL 자산은 경매 완료 시까지 유동화가 어렵습니다.</p>'
      + '<p><b>⑤ 몬테카를로 가정:</b> 시뮬레이션은 물건간 독립을 가정합니다.'
      +   ' 동일 지역 집중 시 실제 분산이 더 좁아질 수 있습니다.</p>'
      + '<p><b>⑥ 수수료 단순화:</b> catch-up 미적용. 실제 LP계약서 waterfall 조항이 우선합니다.</p>'
      + '</div>'
      + '<div style="margin-top:12px;padding:10px 14px;background:#fff3cd;border-radius:6px;font-size:12px;color:#856404">'
      + '본 리포트는 정보 제공 목적이며 투자 권유·보증이 아닙니다. '
      + '모든 예측 수치는 모델 기반 추정값으로 실제 결과를 담보하지 않습니다. (Gagahoho Inc.)'
      + '</div>';

    var body = '<h1>NPL 펀드 LP IR 리포트</h1>'
      + '<div class="rpt-sub">' + esc(fundName) + ' · ' + esc(gpName) + ' · ' + today() + '</div>'
      + sec1 + sec2 + sec3 + sec4 + sec5;

    openReport('NPL 펀드 LP IR 리포트 — ' + fundName, body);
  }

  window.nplReport = { single: single, portfolio: portfolio, fund: fund };
})();
