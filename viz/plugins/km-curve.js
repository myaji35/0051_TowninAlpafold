// viz/plugins/km-curve.js — Kaplan-Meier 생존곡선 (섹션❹ Benchmark)
// 이슈: UI_BENCHMARK_KM_CURVE-001
// 명분 사슬 [3] 비교 단계: "대상 동 vs 평균" 생존율 대조 + log-rank 검정 + 유사동 매칭
//
// 재활용 계약(INTEGRATE_KM_CURVE_PHARMACY_CLOSE-001):
//   window.KMCurve.mount(target, { series:[{label,points:[{t,survival,ci_low,ci_high}],meta}], logrank?, peers? })
//   window.KMCurve.fromSurvivalPoints(points)  → durations/events 없이 이미 계산된 곡선을 그대로 렌더
//   window.KMCurve.kaplanMeierCurve(durations, events, horizon)  → 곡선 전체(월별 S+CI)
//   window.KMCurve.logRank(groupA, groupB)  → {chi2, df, p, note}
//   window.KMCurve.cosineSimilarity(a, b)
//
// 색 의미: survival↑ = 좋음 (plddt_high=파랑). CI 띠는 반투명 동일색.
// Provenance: 모든 렌더 결과에 method/CI 표기 (SIL CI Mandate — 단일 점추정 금지).

(function (root) {
  'use strict';

  var Z = 1.959963984540054; // 95% 양측 정규분위수

  // ── 1. Kaplan-Meier 월별 생존곡선 + Greenwood log-log 95% CI ──
  // build_meongbun_report.py:kaplan_meier() 를 JS로 이식.
  // durations: 관측 개월, events: 1=폐업(event) 0=중도절단, horizon: 최종 월(정수)
  // 반환: { points:[{t, survival, ci_low, ci_high, at_risk, events}], S_h, n }
  function kaplanMeierCurve(durations, events, horizon) {
    var n = durations.length;
    if (n === 0) return null;
    horizon = (typeof horizon === 'number') ? horizon : Math.max.apply(null, durations);

    var order = durations
      .map(function (t, i) { return i; })
      .sort(function (a, b) { return durations[a] - durations[b]; });

    var atRisk = n;
    var surv = 1.0;
    var varSum = 0.0; // Greenwood 누적항 sum( d/(n(n-d)) )

    // 월별 스텝 함수 — 각 event 시점에 S와 CI를 기록.
    // 동일 시점의 event를 묶어 처리(정확한 KM 스텝).
    var points = [{ t: 0, survival: 1.0, ci_low: 1.0, ci_high: 1.0, at_risk: n, events: 0 }];
    var idx = 0;
    while (idx < order.length) {
      var t = durations[order[idx]];
      var dCount = 0;   // 이 시점 event 수
      var risk = atRisk; // 이 시점 진입 시 위험집합
      // 같은 t 를 모두 소비
      var j = idx;
      while (j < order.length && durations[order[j]] === t) {
        if (events[order[j]]) dCount++;
        j++;
      }
      var censored = (j - idx) - dCount;

      if (dCount > 0 && risk > 0) {
        surv *= (1 - dCount / risk);
        if (risk - dCount > 0) varSum += dCount / (risk * (risk - dCount));
      }
      atRisk = risk - (j - idx); // event + censored 모두 위험집합에서 이탈

      if (t <= horizon) {
        points.push({
          t: t,
          survival: surv,
          at_risk: atRisk,
          events: dCount,
          ci_low: null, ci_high: null, // 아래에서 채움
        });
      }
      // 마지막 스냅샷 CI 계산용 varSum 은 loop 종료 후 참조
      idx = j;
      void censored;
    }

    // 각 기록점에 Greenwood log-log CI 부착 (해당 시점까지의 varSum 필요 →
    // 정확도 위해 재주행: 각 point.t 까지의 var 를 다시 누적)
    _attachGreenwoodCI(points, durations, events);

    var last = points[points.length - 1];
    return {
      points: points,
      S_h: last ? last.survival : 1.0,
      n: n,
      horizon: horizon,
    };
  }

  // 각 스텝의 Greenwood 분산으로 log-log 변환 CI 계산.
  function _attachGreenwoodCI(points, durations, events) {
    var n = durations.length;
    var order = durations
      .map(function (t, i) { return i; })
      .sort(function (a, b) { return durations[a] - durations[b]; });

    // t → 누적 varSum, 누적 S 맵을 만든다
    var atRisk = n, surv = 1.0, varSum = 0.0;
    var byT = {}; // t → {S, var}
    var idx = 0;
    while (idx < order.length) {
      var t = durations[order[idx]];
      var dCount = 0, risk = atRisk, j = idx;
      while (j < order.length && durations[order[j]] === t) {
        if (events[order[j]]) dCount++;
        j++;
      }
      if (dCount > 0 && risk > 0) {
        surv *= (1 - dCount / risk);
        if (risk - dCount > 0) varSum += dCount / (risk * (risk - dCount));
      }
      atRisk = risk - (j - idx);
      byT[t] = { S: surv, var: varSum };
      idx = j;
    }

    points.forEach(function (p) {
      if (p.t === 0) { p.ci_low = 1.0; p.ci_high = 1.0; return; }
      var rec = byT[p.t] || { S: p.survival, var: 0 };
      var S = rec.S, v = rec.var;
      var ci = greenwoodLogLogCI(S, v);
      p.ci_low = ci.lo;
      p.ci_high = ci.hi;
    });
  }

  // Greenwood: Var(S)=S^2 * sum(...). log-log 변환으로 [0,1] 클램프.
  function greenwoodLogLogCI(S, varSum) {
    if (S <= 0 || S >= 1) return { lo: Math.max(0, S), hi: Math.min(1, S) };
    var se = varSum > 0 ? Math.sqrt(varSum) : 0.0;
    var seLL = se / (S * Math.abs(Math.log(S)));
    if (!isFinite(seLL) || seLL === 0) return { lo: S, hi: S };
    var lo = Math.pow(S, Math.exp(Z * seLL));
    var hi = Math.pow(S, Math.exp(-Z * seLL));
    return { lo: Math.max(0, lo), hi: Math.min(1, hi) };
  }

  // 단일 시점 S(horizon) + CI — 리포트 build_meongbun 과 동일 스칼라.
  function kaplanMeierAt(durations, events, horizon) {
    var curve = kaplanMeierCurve(durations, events, horizon);
    if (!curve) return null;
    var atH = 1.0, last = null;
    curve.points.forEach(function (p) { if (p.t <= horizon) last = p; });
    if (last) atH = last.survival;
    return {
      S: atH,
      lo: last ? last.ci_low : atH,
      hi: last ? last.ci_high : atH,
      n: curve.n,
    };
  }

  // ── 2. Log-rank test (군집 A vs B, df=1) ──
  // group = {durations:[], events:[]}. Mantel-Cox χ².
  function logRank(groupA, groupB) {
    var all = [];
    groupA.durations.forEach(function (t, i) { all.push({ t: t, e: groupA.events[i] ? 1 : 0, g: 0 }); });
    groupB.durations.forEach(function (t, i) { all.push({ t: t, e: groupB.events[i] ? 1 : 0, g: 1 }); });
    var nA = groupA.durations.length, nB = groupB.durations.length;
    if (nA === 0 || nB === 0) return { chi2: 0, df: 1, p: 1, note: '표본 부족' };

    // 고유 event 시점
    var times = all.filter(function (x) { return x.e === 1; }).map(function (x) { return x.t; });
    times = Array.from(new Set(times)).sort(function (a, b) { return a - b; });

    var atRiskA = nA, atRiskB = nB;
    var O1 = 0, E1 = 0, V = 0; // 그룹A 관측/기대/분산

    // 시점 순회하며 각 event time 이전까지 이탈 반영
    var sorted = all.slice().sort(function (a, b) { return a.t - b.t; });
    var ptr = 0;

    times.forEach(function (tk) {
      // tk 미만에서 이탈한 관측을 위험집합에서 제거
      while (ptr < sorted.length && sorted[ptr].t < tk) {
        if (sorted[ptr].g === 0) atRiskA--; else atRiskB--;
        ptr++;
      }
      // tk 시점의 event 수 집계
      var dA = 0, dB = 0, cA = 0, cB = 0;
      var q = ptr;
      while (q < sorted.length && sorted[q].t === tk) {
        if (sorted[q].g === 0) { if (sorted[q].e) dA++; else cA++; }
        else { if (sorted[q].e) dB++; else cB++; }
        q++;
      }
      var n = atRiskA + atRiskB;
      var d = dA + dB;
      if (n > 1 && d > 0) {
        var eA = d * atRiskA / n;
        var vA = d * (atRiskA / n) * (atRiskB / n) * (n - d) / (n - 1);
        O1 += dA;
        E1 += eA;
        V += vA;
      }
      // tk 시점 관측(event+censor) 전부 이탈
      var consumed = q - ptr;
      var qi = ptr;
      for (var k = 0; k < consumed; k++) {
        if (sorted[qi].g === 0) atRiskA--; else atRiskB--;
        qi++;
      }
      ptr = q;
      void cA; void cB;
    });

    var chi2 = V > 0 ? Math.pow(O1 - E1, 2) / V : 0;
    var p = chiSqPValueDf1(chi2);
    return {
      chi2: chi2,
      df: 1,
      p: p,
      O1: O1, E1: E1,
      note: p < 0.05 ? '두 군 생존 차이 유의(p<0.05)' : '두 군 생존 차이 통계적 비유의',
    };
  }

  // df=1 χ² 상측 p-value = erfc( sqrt(chi2/2) ). Abramowitz-Stegun erf 근사.
  function chiSqPValueDf1(x) {
    if (x <= 0) return 1.0;
    return erfc(Math.sqrt(x / 2));
  }
  function erfc(x) { return 1 - erf(x); }
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  // ── 3. 유사동 매칭 — 코사인 유사도 ──
  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    var dot = 0, na = 0, nb = 0;
    for (var i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // ── 4. SVG 렌더 — 2곡선 + CI 띠 (survival↑=파랑) ──
  var W = 720, H = 300, padL = 52, padR = 20, padT = 20, padB = 40;

  function seriesColor(idx) {
    var Tk = root.VizTokens;
    var c = Tk ? Tk.colors() : { plddt_high: '#00529B', plddt_low: '#FED766', text_secondary: '#A4B0C0', border: '#2A3445', surface: '#0F1419' };
    // 0번(대상 동)=파랑(강조), 1번(평균)=앰버
    return idx === 0 ? (c.plddt_high || '#00529B') : (c.plddt_low || '#FED766');
  }

  function renderCurvesSVG(series, opts) {
    var Tk = root.VizTokens;
    var col = Tk ? Tk.colors() : {};
    var surface = col.surface || '#0F1419';
    var border = col.border || '#2A3445';
    var muted = col.text_secondary || '#A4B0C0';

    var maxT = 0;
    series.forEach(function (s) { s.points.forEach(function (p) { if (p.t > maxT) maxT = p.t; }); });
    maxT = maxT || 12;

    var xC = function (t) { return padL + (t / maxT) * (W - padL - padR); };
    var yC = function (v) { return padT + (1 - v) * (H - padT - padB); };

    var s = '<rect width="' + W + '" height="' + H + '" fill="' + surface + '"/>';

    // Y축 그리드 0/25/50/75/100%
    [0, 0.25, 0.5, 0.75, 1].forEach(function (g) {
      var y = yC(g);
      s += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="' + border + '" stroke-width="0.5" stroke-opacity="0.6"/>';
      s += '<text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end" fill="' + muted + '" font-size="9">' + (g * 100) + '%</text>';
    });
    // X축 눈금 (개월)
    for (var m = 0; m <= maxT; m += Math.max(1, Math.round(maxT / 6))) {
      var x = xC(m);
      s += '<text x="' + x + '" y="' + (H - padB + 14) + '" text-anchor="middle" fill="' + muted + '" font-size="9">' + m + 'M</text>';
    }
    s += '<text x="' + ((padL + W - padR) / 2) + '" y="' + (H - 4) + '" text-anchor="middle" fill="' + muted + '" font-size="9">관측 개월</text>';

    // 각 시리즈: CI 밴드(폴리곤) → 스텝 라인
    series.forEach(function (ser, si) {
      var c = ser.color || seriesColor(si);
      var pts = ser.points.slice().sort(function (a, b) { return a.t - b.t; });

      // CI 밴드 (ci_high 정방향 + ci_low 역방향)
      if (pts.some(function (p) { return p.ci_low != null && p.ci_high != null; })) {
        var top = '', bot = '';
        var prevX = null;
        pts.forEach(function (p) {
          var x = xC(p.t);
          var yh = yC(p.ci_high != null ? p.ci_high : p.survival);
          if (prevX != null) top += 'L' + prevX + ' ' + yh + ' ';
          top += 'L' + x + ' ' + yh + ' ';
          prevX = x;
        });
        prevX = null;
        for (var k = pts.length - 1; k >= 0; k--) {
          var pp = pts[k];
          var x2 = xC(pp.t);
          var yl = yC(pp.ci_low != null ? pp.ci_low : pp.survival);
          if (prevX != null) bot += 'L' + prevX + ' ' + yl + ' ';
          bot += 'L' + x2 + ' ' + yl + ' ';
          prevX = x2;
        }
        var band = 'M' + xC(pts[0].t) + ' ' + yC(pts[0].ci_high != null ? pts[0].ci_high : pts[0].survival) + ' ' + top + bot + 'Z';
        s += '<path d="' + band + '" fill="' + c + '" fill-opacity="0.14" stroke="none"/>';
      }

      // 스텝 라인
      var d = 'M' + xC(pts[0].t) + ' ' + yC(pts[0].survival);
      var px = xC(pts[0].t), py = yC(pts[0].survival);
      for (var i = 1; i < pts.length; i++) {
        var nx = xC(pts[i].t), ny = yC(pts[i].survival);
        d += ' L' + nx + ' ' + py + ' L' + nx + ' ' + ny; // 계단
        px = nx; py = ny;
      }
      s += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.8"/>';

      // 범례
      var ly = padT + 4 + si * 15;
      s += '<rect x="' + (W - padR - 150) + '" y="' + (ly - 8) + '" width="10" height="10" fill="' + c + '" rx="2"/>';
      s += '<text x="' + (W - padR - 135) + '" y="' + ly + '" fill="' + muted + '" font-size="10">' + escSvg(ser.label || ('군 ' + (si + 1))) + '</text>';
    });

    void opts;
    return { svg: s, viewBox: '0 0 ' + W + ' ' + H };
  }

  function escSvg(t) {
    return String(t == null ? '' : t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }
  function escHtml(t) {
    if (typeof root.escapeHtml === 'function') return root.escapeHtml(t);
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 5. mount() — 곡선 + log-rank 표 + 유사동 표를 한 컨테이너에 렌더 ──
  // target: DOM 노드 또는 id. data.series: [{label, points:[{t,survival,ci_low,ci_high}], meta?}]
  function mount(target, data) {
    var el = (typeof target === 'string') ? root.document.getElementById(target) : target;
    if (!el) { console.warn('[km-curve] mount target 없음:', target); return null; }
    var series = (data && data.series) || [];
    if (!series.length) {
      el.innerHTML = '<div class="km-empty">생존 곡선 데이터 없음 — 유사 동 표본 부족</div>';
      return { rendered: false };
    }

    var svgOut = renderCurvesSVG(series, data.opts);
    var lr = data.logrank || null;
    var peers = data.peers || [];

    var svgBlock =
      '<svg class="km-svg" viewBox="' + svgOut.viewBox + '" preserveAspectRatio="xMidYMid meet" ' +
      'width="100%" role="img" aria-label="Kaplan-Meier 생존곡선">' + svgOut.svg + '</svg>';

    // log-rank 표
    var lrBlock = '';
    if (lr) {
      lrBlock =
        '<div class="km-logrank">' +
          '<span class="km-lr-label">Log-rank 검정</span>' +
          '<span class="km-lr-stat">χ²(' + lr.df + ') = ' + lr.chi2.toFixed(2) + '</span>' +
          '<span class="km-lr-stat">p = ' + fmtP(lr.p) + '</span>' +
          '<span class="km-lr-note">' + escHtml(lr.note) + '</span>' +
        '</div>';
    }

    // 유사동 매칭 표
    var peersBlock = '';
    if (peers.length) {
      var rows = peers.map(function (pr) {
        return '<tr>' +
          '<td>' + (pr.rank != null ? pr.rank : '') + '</td>' +
          '<td>' + escHtml(pr.dong) + '</td>' +
          '<td>' + (pr.similarity != null ? (pr.similarity * 100).toFixed(0) + '%' : '—') + '</td>' +
          '<td>' + (pr.survival_12m != null ? (pr.survival_12m * 100).toFixed(0) + '%' : '—') + '</td>' +
        '</tr>';
      }).join('');
      peersBlock =
        '<table class="km-peers-table"><thead><tr>' +
          '<th>순위</th><th>매칭 동</th><th>코사인 유사도</th><th>12M 생존확률</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }

    var provenance =
      '<div class="km-provenance">방법: 비모수 Kaplan-Meier · 95% CI Greenwood log-log · ' +
      'Log-rank(Mantel-Cox). 출처: viz/plugins/km-curve.js · docs/methods/km-survival.md</div>';

    el.innerHTML =
      '<div class="km-curve-block">' +
        svgBlock + lrBlock + peersBlock + provenance +
      '</div>';

    return { rendered: true, series: series.length, hasLogRank: !!lr, peers: peers.length };
  }

  function fmtP(p) {
    if (p < 0.001) return '<0.001';
    if (p < 0.01) return p.toFixed(3);
    return p.toFixed(2);
  }

  // 이미 계산된 survival 포인트를 하나의 series 로 감싸는 헬퍼(어댑터에서 사용)
  function fromSurvivalPoints(points, label, meta) {
    return {
      label: label || '생존곡선',
      points: (points || []).map(function (p) {
        return {
          t: p.t != null ? p.t : (p.month != null ? p.month : 0),
          survival: p.survival != null ? p.survival : p.s,
          ci_low: p.ci_low != null ? p.ci_low : (p.lo != null ? p.lo : null),
          ci_high: p.ci_high != null ? p.ci_high : (p.hi != null ? p.hi : null),
        };
      }),
      meta: meta || null,
    };
  }

  // ── 6. VizEngine 플러그인 등록 (scope.km_series 있으면 supports) ──
  function render(target, data, scales, scope) {
    var kmData = (scope && scope.km) ? scope.km : (data && data.km) ? data.km : null;
    if (!kmData) return null;
    return mount(target, kmData);
  }

  if (root.VizEngine) {
    root.VizEngine.register({
      id: 'km-curve',
      label: 'Kaplan-Meier 생존곡선',
      icon: '⤵',
      supports: function (scope) { return !!(scope && scope.km && scope.km.series); },
      render: render,
    });
  }

  // ── 외부 API ──
  root.KMCurve = {
    mount: mount,
    fromSurvivalPoints: fromSurvivalPoints,
    kaplanMeierCurve: kaplanMeierCurve,
    kaplanMeierAt: kaplanMeierAt,
    greenwoodLogLogCI: greenwoodLogLogCI,
    logRank: logRank,
    cosineSimilarity: cosineSimilarity,
    renderCurvesSVG: renderCurvesSVG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
