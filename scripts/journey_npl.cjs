// NPL 캐릭터 저니 테스트 — 매수 심사역 / 매도 담당자
// 실제 page.fill / page.click / screenshot 으로 검증 (CLAUDE.md 필수 규칙)
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:8051/index.html';
const OUT = '/tmp';

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const results = [];
  function step(name, pass, detail) { results.push({ name, pass, detail }); console.log((pass?'✓':'✗') + ' ' + name + (detail? ' — '+detail : '')); }

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // ───── Journey 1: NPL 매수 심사역 ─────
  console.log('\n=== Journey 1: NPL 매수 심사역 ===');
  await page.evaluate(() => window.switchMode('npl-buy'));
  await page.waitForTimeout(500);
  const buyVisible = await page.isVisible('#view-npl-buy .npl-buy');
  step('매수 화면 렌더', buyVisible);
  await page.screenshot({ path: OUT + '/npl-j1-s1-empty.png' });

  // 입력 (컨테이너 스코프 — hidden 화면의 동명 selector 회피)
  const buy = page.locator('#view-npl-buy');
  await buy.locator('[data-field="claim"]').fill('38000');
  await buy.locator('[data-field="buy_price"]').fill('30000');
  await buy.locator('[data-field="appraisal"]').fill('48000');
  await buy.locator('[data-field="senior"]').fill('3500');
  await buy.locator('[data-field="tax"]').fill('360');
  await buy.locator('[data-field="deposit"]').fill('500');
  const ctaEnabled = await buy.locator('[data-action="evaluate"]').isEnabled();
  step('필수값 입력 후 CTA 활성화', ctaEnabled);

  await buy.locator('[data-action="evaluate"]').click();
  await page.waitForTimeout(700);
  const irrText = await buy.locator('.npl-irr-value').textContent().catch(()=>null);
  step('IRR 카드 표시', !!irrText, 'IRR=' + (irrText||'?'));
  const scenCount = await buy.locator('.npl-scenario-card').count();
  step('3시나리오 카드 표시', scenCount === 3, scenCount + '개');
  await page.screenshot({ path: OUT + '/npl-j1-s2-result.png', fullPage: true });

  const deepLink = await buy.locator('[data-action="goto-decide"]').isVisible();
  step('Decide 딥링크 존재', deepLink);

  // ───── Journey 2: NPL 매도 담당자 ─────
  console.log('\n=== Journey 2: NPL 매도 담당자 ===');
  await page.evaluate(() => window.switchMode('npl-sell'));
  await page.waitForTimeout(500);
  const sellVisible = await page.isVisible('#view-npl-sell .npl-sell');
  step('매도 화면 렌더', sellVisible);
  await page.screenshot({ path: OUT + '/npl-j2-s1-empty.png' });

  const sell = page.locator('#view-npl-sell');
  await sell.locator('[data-field="book_value"]').fill('50000');
  await sell.locator('[data-field="market_quote"]').fill('32000');
  await sell.locator('[data-field="provision_rate"]').fill('40');
  await sell.locator('[data-field="carrying_monthly"]').fill('300');
  await sell.locator('[data-action="evaluate"]').click();
  await page.waitForTimeout(700);
  const recBadge = await sell.locator('.npl-rec-badge').textContent().catch(()=>null);
  step('추천 배지 표시', !!recBadge, recBadge||'?');
  const shapCount = await sell.locator('.npl-shap-row').count();
  step('SHAP 막대 표시', shapCount > 0, shapCount + '개');
  const coneRows = await sell.locator('.npl-cone-row').count();
  step('보유 cone 6/12/24M 표시', coneRows === 3, coneRows + '행');
  await page.screenshot({ path: OUT + '/npl-j2-s2-result.png', fullPage: true });

  // ───── 콘솔 에러 검증 ─────
  step('콘솔 에러 없음', errors.length === 0, errors.length ? errors.slice(0,3).join(' | ') : '0건');

  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n━━━ 결과: ' + (results.length - failed.length) + '/' + results.length + ' PASS ━━━');
  if (failed.length) { console.log('FAIL:', failed.map(f=>f.name).join(', ')); process.exit(1); }
}
run().catch(e => { console.error('저니 테스트 에러:', e); process.exit(1); });
