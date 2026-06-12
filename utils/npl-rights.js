// utils/npl-rights.js
// NPL 권리관계 정밀 분석 (V4) — backend/npl_rights.py와 동일 로직 (drift 금지).
// 소액임차 최우선변제 + 조세채권 + 배당 우선순위. 참조: docs/npl-professional-valuation.md §2.4

(function() {
  'use strict';

  // 소액임차 최우선변제 (주임법 시행령 2023.02~), 권역별 {보증금 상한, 최우선 한도} 만원
  var SMALL_LEASE = {
    capital: { deposit_cap: 16500, priority_cap: 5500 },
    metro:   { deposit_cap: 14500, priority_cap: 4800 },
    local:   { deposit_cap: 8500,  priority_cap: 2800 },
  };

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isNaN(n) ? 0 : n; }
  function tierOf(rc) {
    return (window.NplAuctionRates && window.NplAuctionRates.regionTier)
      ? window.NplAuctionRates.regionTier(rc) : 'local';
  }

  function analyzeRights(inp) {
    var tier = tierOf(inp.region_code);
    var senior = num(inp.senior), tax = num(inp.tax), deposit = num(inp.deposit);
    var hasOp = inp.has_opposing_power !== false;
    var months = num(inp.recovery_months) || 12;
    var breakdown = [], flags = [];
    var small = SMALL_LEASE[tier];

    var smallLease = 0;
    if (deposit > 0 && deposit <= small.deposit_cap) {
      smallLease = Math.min(deposit, small.priority_cap);
      breakdown.push({ rank: 1, name: '소액임차 최우선변제', amount: Math.round(smallLease), note: tier + ' 한도 ' + small.priority_cap + '만' });
      flags.push('소액임차 최우선변제 적용 (근저당보다 우선)');
    }
    if (tax > 0) breakdown.push({ rank: 2, name: '조세채권(당해세)', amount: Math.round(tax), note: '법정기일 최우선' });
    if (senior > 0) breakdown.push({ rank: 3, name: '선순위 근저당', amount: Math.round(senior), note: '설정 순위' });

    var remaining = deposit - smallLease;
    if (remaining > 0) {
      if (hasOp) {
        breakdown.push({ rank: 4, name: '임차보증금 잔액(대항력)', amount: Math.round(remaining), note: '대항력 — 매수인 인수' });
        flags.push('대항력 있는 임차인 — 보증금 잔액 인수 위험');
      } else {
        breakdown.push({ rank: 4, name: '임차보증금 잔액(대항력 없음)', amount: 0, note: '대항력 없음 — 소멸' });
      }
    }
    var totalDeduction = smallLease + tax + senior + (hasOp ? remaining : 0);

    var monthsAdj = months;
    if (inp.has_seizure) { monthsAdj += 6; flags.push('가압류/가처분 등재 — 회수 지연 +6개월'); }
    if (hasOp && remaining > 0) { monthsAdj += 3; flags.push('명도 지연 가능 (대항력 임차인) +3개월'); }

    return {
      total_deduction: Math.round(totalDeduction),
      breakdown: breakdown,
      small_lease_priority: Math.round(smallLease),
      recovery_months_adj: monthsAdj,
      flags: flags,
    };
  }

  window.NplRights = { analyzeRights: analyzeRights, SMALL_LEASE: SMALL_LEASE };
})();
