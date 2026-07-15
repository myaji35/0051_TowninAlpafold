// [FIX_BUG_PHARMACY_DEVELOP_DEEPLINK-001] AC-6 실브라우저 검증
// 명세: docs/stories/pharmacy-develop.md B절 AC-6
//   "카드 우측 [Decide에서 보기] 클릭 → switchMode('decide') + URL이
//    ?mode=decide&ctx=pharmacy.develop&address=<encoded> 로 갱신.
//    Decide 도착 시 해당 동이 자동 선택되고, '← 약국 점포개발 평가로 돌아가기' 복귀 링크 노출"
//
// 기존 저니(verify_pharmacy_develop.mjs 스텝5)는 URL만 단언해 "동 자동 선택" 갭을 놓쳤다.
// 여기서는 3개 요구를 각각 독립 단언한다.
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
await page.waitForFunction(() => typeof window.selectDongByName === 'function', { timeout: 10000 });

const checks = [];
const check = (label, pass, detail) => checks.push([label, pass, detail]);

// Decide 데이터셋에 실재하는 동으로 저니 수행 (금오동 = simula_data_real.json에 존재)
const DONG = '의정부시 금오동';

await page.click('[data-mode="pharmacy-develop"], [data-submenu="pharmacy.develop"]').catch(async () => {
  await page.evaluate(() => window.switchMode('pharmacy-develop'));
});
await page.waitForTimeout(400);

const input = page.locator('.pd-input[data-field="dong"]');
await input.fill(DONG);
await page.locator('[data-action="evaluate"]').click();
await page.waitForTimeout(600);

// [Decide에서 보기] 클릭
await page.locator('[data-action="goto-decide"]').first().click();
await page.waitForTimeout(900);

const url = new URL(page.url());
check('AC-6 (1) URL mode=decide', url.searchParams.get('mode') === 'decide', page.url());
check('AC-6 (1) URL ctx=pharmacy.develop', url.searchParams.get('ctx') === 'pharmacy.develop', url.searchParams.get('ctx'));
check('AC-6 (1) URL address 인코딩', url.searchParams.get('address') === DONG, url.searchParams.get('address'));

// (2) 동 자동 선택 — 이번 수정의 핵심. 이전엔 silent fail이었다.
const selectedName = await page.evaluate(() => window.getSelectedDongName());
check('AC-6 (2) 동 자동 선택', selectedName === DONG, `selectedDong=${selectedName}`);

// Decide 컨텍스트 배너가 선택된 동을 반영하는지 (사용자에게 실제로 보이는 증거)
const ctxWhere = await page.locator('#decide-ctx-where').textContent().catch(() => null);
check('AC-6 (2) Decide 배너에 동 반영', (ctxWhere || '').includes(DONG), `배너="${ctxWhere}"`);

// (3) 복귀 링크
const backVisible = await page.locator('#pd-back-link').isVisible().catch(() => false);
check('AC-6 (3) 복귀 링크 노출', backVisible, backVisible ? '노출' : '미노출');

// 실재 동이므로 "데모 전용 동" 안내는 뜨면 안 된다
const noticeShown = await page.locator('#pd-dong-notice').count();
check('실재 동에는 미선택 안내 없음', noticeShown === 0, `notice count=${noticeShown}`);

await page.screenshot({ path: 'screenshots/ac6_deeplink_decide.png', clip: { x: 0, y: 0, width: 1480, height: 420 } });

// 복귀 링크 클릭 → 점포개발 복귀
await page.locator('#pd-back-link').click();
await page.waitForTimeout(700);
const backUrl = new URL(page.url());
check('AC-6 (3) 복귀 링크 클릭 → 점포개발', backUrl.searchParams.get('mode') === 'pharmacy-develop', page.url());

// ── 엣지: Decide 데이터셋에 없는 데모 전용 동 → 조용한 실패 대신 명시 안내 ──
await page.evaluate(() => window.switchMode('pharmacy-develop'));
await page.waitForTimeout(300);
await input.fill('저밀도 외곽동');
await page.locator('[data-action="evaluate"]').click();
await page.waitForTimeout(600);
await page.locator('[data-action="goto-decide"]').first().click();
await page.waitForTimeout(900);
const noticeText = await page.locator('#pd-dong-notice').textContent().catch(() => null);
check('엣지: 미보유 동은 안내 노출 (silent fail 아님)', !!noticeText && noticeText.includes('저밀도 외곽동'), noticeText || '안내 없음');

check('콘솔/페이지 에러 0건', errs.length === 0, errs.join('; ') || 'none');

console.log('\n━━━ AC-6 Decide deep-link 실브라우저 검증 ━━━');
checks.forEach(([l, p, d]) => console.log(`${p ? '✅' : '❌'} ${l} — ${d}`));
const failed = checks.filter(([, p]) => !p).length;
console.log(`\n총 ${checks.length} · 통과 ${checks.length - failed} · 실패 ${failed}`);
console.log('스크린샷: screenshots/ac6_deeplink_decide.png');
await browser.close();
process.exit(failed ? 1 : 0);
