// Journey test — UI_SCENARIOS_3OPTION-001 섹션❺ 3옵션 cone
// 실 브라우저 클릭 검증: meongbun 뷰 진입 → 데모 동 2종 → 시나리오 DOM/스크린샷
import { chromium } from 'playwright';

const BASE = 'http://localhost:8751/index.html';
const OUT = '/Volumes/E_SSD/02_GitHub.nosync/0051_TowninAlpafold/screenshots';

const results = [];
function step(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
}

const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// switchMode/renderScenarios 전역 함수 노출 대기
await page.waitForFunction(
  () => typeof window.switchMode === 'function' && typeof window.renderScenarios === 'function',
  { timeout: 15000 }
);

for (const dong of ['의정부시 금오동', '성수1가1동']) {
  // meongbun 뷰 진입 후 해당 데모 동으로 시나리오 렌더 (DATA 무관 — 샘플 기반)
  const entered = await page.evaluate((name) => {
    window.switchMode('meongbun');
    window.renderScenarios(name);
    return { ok: true };
  }, dong);
  step(`[${dong}] meongbun 진입 + 시나리오 렌더`, entered.ok, entered.reason || '');
  if (!entered.ok) continue;

  await page.waitForTimeout(400);

  // 섹션❺ DOM 검증
  const sec5 = await page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-5');
    if (!sec) return { present: false };
    const cards = sec.querySelectorAll('.scenario-card');
    const cones = sec.querySelectorAll('svg.scenario-cone');
    const rec = sec.querySelectorAll('.scenario-card.recommended');
    const prov = sec.querySelector('.scenario-prov');
    const ph = sec.querySelector('.meongbun-placeholder');
    const rois = Array.from(sec.querySelectorAll('.scenario-metric')).map(m => m.textContent.replace(/\s+/g,' ').trim());
    return {
      present: true,
      cardCount: cards.length,
      coneCount: cones.length,
      recCount: rec.length,
      hasProv: !!prov,
      provText: prov ? prov.textContent.replace(/\s+/g,' ').trim().slice(0,120) : '',
      placeholderHidden: ph ? (ph.style.display === 'none') : true,
      metricsSample: rois.slice(0,3),
    };
  });

  step(`[${dong}] 카드 3개 균등 배치`, sec5.cardCount === 3, `cards=${sec5.cardCount}`);
  step(`[${dong}] cone SVG 3개`, sec5.coneCount === 3, `cones=${sec5.coneCount}`);
  step(`[${dong}] 권고 옵션 1개 강조`, sec5.recCount === 1, `recommended=${sec5.recCount}`);
  step(`[${dong}] PSM balance/prov 노출`, sec5.hasProv && /balance/i.test(sec5.provText), sec5.provText);
  step(`[${dong}] placeholder 숨김`, sec5.placeholderHidden === true, '');
  step(`[${dong}] ROI/생존율/매칭N 메트릭`, sec5.metricsSample.length === 3, JSON.stringify(sec5.metricsSample));

  // 섹션 5로 스크롤 후 스크린샷
  await page.evaluate(() => document.getElementById('meongbun-sec-5').scrollIntoView());
  await page.waitForTimeout(300);
  const slug = dong === '의정부시 금오동' ? 'geumo' : 'seongsu';
  const el = await page.$('#meongbun-sec-5');
  await el.screenshot({ path: `${OUT}/scenarios_3option_${slug}.png` });
  step(`[${dong}] 스크린샷 저장`, true, `${slug}`);
}

// 미정의 동 fallback 검증
const fb = await page.evaluate(() => {
  window.switchMode('meongbun');
  window.renderScenarios('강남구 A9동');   // 샘플 미정의 동
  const sec = document.getElementById('meongbun-sec-5');
  const empty = sec.querySelector('.scenario-empty');
  const cards = sec.querySelectorAll('.scenario-card');
  return { ok: true, hasEmpty: !!empty, cards: cards.length };
});
step(`[fallback] 미정의 동 안내 표시`, fb.ok && fb.hasEmpty && fb.cards === 0, `cards=${fb.cards}`);

step('콘솔 에러 없음', consoleErrors.length === 0, consoleErrors.slice(0,3).join(' | '));

await browser.close();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} PASS ===`);
process.exit(failed.length ? 1 : 0);
