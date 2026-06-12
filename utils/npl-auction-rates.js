// utils/npl-auction-rates.js
// NPL 낙찰가율 행렬 (V1) — 지역×담보유형. backend/npl_auction_rates.py와 동일 값 (drift 금지).
// 참조: docs/npl-professional-valuation.md §2.1

(function() {
  'use strict';

  var METRO = { '11':1, '28':1, '41':1 };                        // 수도권
  var METROPOLITAN = { '26':1, '27':1, '29':1, '30':1, '31':1, '36':1 };  // 광역시

  var BASE_RATE = {
    capital: { apt: 0.86, officetel: 0.78, commercial: 0.68, land: 0.70 },
    metro:   { apt: 0.80, officetel: 0.72, commercial: 0.62, land: 0.64 },
    local:   { apt: 0.74, officetel: 0.65, commercial: 0.55, land: 0.58 },
  };
  var SPREAD = {
    apt:        { p10: 0.83, p90: 1.12 },
    officetel:  { p10: 0.80, p90: 1.15 },
    commercial: { p10: 0.72, p90: 1.22 },
    land:       { p10: 0.70, p90: 1.28 },
  };

  function regionTier(rc) {
    if (!rc) return 'local';
    var p = String(rc).slice(0, 2);
    if (METRO[p]) return 'capital';
    if (METROPOLITAN[p]) return 'metro';
    return 'local';
  }

  function auctionRate(regionCode, collateralType) {
    var tier = regionTier(regionCode);
    var ct = SPREAD[collateralType] ? collateralType : 'apt';
    var p50 = BASE_RATE[tier][ct] || BASE_RATE[tier].apt;
    var sp = SPREAD[ct];
    return { p10: Math.round(p50 * sp.p10 * 10000) / 10000, p50: p50, p90: Math.round(p50 * sp.p90 * 10000) / 10000 };
  }

  window.NplAuctionRates = { auctionRate: auctionRate, regionTier: regionTier, BASE_RATE: BASE_RATE };
})();
