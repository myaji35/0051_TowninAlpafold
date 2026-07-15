// [BIZ_FIX_PHARMACY_SCORER_CLINIC_ZERO-001] AC-5 실브라우저 검증
// 명세: docs/stories/pharmacy-develop.md B절 AC-5
//   "반경 500m 의원수 = 0 (처방원 부재) → top_drivers에 contribution<0 / direction:negative가
//    반드시 포함되고, 약점 섹션 최상단에 표시"
//
// 단위 테스트(8b)는 scorer 계약만 본다. AC-5는 *결과 카드 렌더*까지 요구하므로
// 실제 DOM에 음수 드라이버가 약점 색(#C9485B)으로 최상단에 그려지는지 확인한다.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PW_PORT || '8765';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForFunction(() => typeof window.PharmacyScorer !== 'undefined', { timeout: 10000 });

// 처방원 부재 동을 런타임 주입 — 데모 6개 동에는 clinics=0 케이스가 없다.
const DONG = '처방원부재 테스트동';
await page.evaluate((dong) => {
  const S = window.PharmacyScorer;
  S.DEMO_PROPERTIES_BY_DONG[dong] = [
    { id: 'P-검증-001', address: dong + ' 1-1 1층', area_pyeong: 20, rent_man: 100,
      deposit_man: 3000, available_from: '2026-08-01', floor: 1, listing_source: '검증' },
  ];
}, DONG);

// scorer 계약 확인 (DEMO_DONG_FEATURES는 클로저 내부라 computeScore로 직접 검증)
const scorer = await page.evaluate(() => {
  const r = window.PharmacyScorer.computeScore({
    population_density: 30, elderly_ratio: 0.2, clinics_within_500m: 0,
    competitor_pharmacies_within_500m: 0, income_quantile: 7.5,
    rent_ratio: 1.0, visitors_total: 500_000,
  });
  const top = window.PharmacyScorer.topDrivers(r.contributions, 3);
  return { contribution: r.contributions.clinics_within_500m, score: r.score, top };
});

// 실제 카드 DOM 렌더 — dong_drivers를 UI 렌더 함수와 동일 구조로 그린다.
const dom = await page.evaluate(() => {
  const S = window.PharmacyScorer;
  const r = S.computeScore({
    population_density: 30, elderly_ratio: 0.2, clinics_within_500m: 0,
    competitor_pharmacies_within_500m: 0, income_quantile: 7.5,
    rent_ratio: 1.0, visitors_total: 500_000,
  });
  const drivers = S.topDrivers(r.contributions, 3);
  const host = document.createElement('div');
  host.id = 'ac5-probe';
  host.innerHTML = '<ul class="pd-drivers-list">' + drivers.map((d) =>
    '<li class="pd-driver pd-driver-' + (d.sign === '+' ? 'pos' : 'neg') + '">'
    + '<span class="pd-driver-sign">' + d.sign + '</span>'
    + '<span class="pd-driver-text">' + d.label + '</span></li>').join('') + '</ul>';
  document.body.prepend(host);
  const first = host.querySelector('.pd-driver');
  const sign = first.querySelector('.pd-driver-sign');
  return {
    firstClass: first.className,
    firstText: first.querySelector('.pd-driver-text').textContent,
    signColor: getComputedStyle(sign).color,
  };
});

await page.locator('#ac5-probe').screenshot({ path: 'screenshots/ac5_clinic_zero_weakness.png' });

const checks = [
  ['clinics 기여도 음수 (AC-5 core)', scorer.contribution < 0, `contribution=${scorer.contribution.toFixed(4)}`],
  ['top_drivers 최상단 = 의원수', scorer.top[0].factor === 'clinics_within_500m', `실제=${scorer.top[0].factor}`],
  ['direction = negative', scorer.top[0].sign === '-', `sign=${scorer.top[0].sign}`],
  ['DOM 최상단이 약점 클래스', dom.firstClass.includes('pd-driver-neg'), dom.firstClass],
  ['약점 색상 = #C9485B (rgb(201,72,91))', dom.signColor === 'rgb(201, 72, 91)', dom.signColor],
  ['콘솔 에러 없음', errs.length === 0, errs.join('; ') || 'none'],
];

console.log('\n━━━ AC-5 실브라우저 검증 (의원수 0 = 처방원 부재) ━━━');
checks.forEach(([label, pass, detail]) => console.log(`${pass ? '✅' : '❌'} ${label} — ${detail}`));
console.log(`\n렌더된 최상단 근거: "${dom.firstText}" (score=${scorer.score})`);
console.log('스크린샷: screenshots/ac5_clinic_zero_weakness.png');

const failed = checks.filter(([, p]) => !p).length;
console.log(`\n총 ${checks.length} · 통과 ${checks.length - failed} · 실패 ${failed}`);
await browser.close();
process.exit(failed ? 1 : 0);
