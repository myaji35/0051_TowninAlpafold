// Decide 화면 사이드바 접힘 상태 캡처
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3051/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // 사이드바 클릭 (Decide 진입)
  await page.click('.sb-item[data-mode="decide"]');
  await page.waitForTimeout(1500);
  // 마우스를 본문 중앙으로 이동 (사이드바 호버 해제)
  await page.mouse.move(800, 400);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'screenshots', 'phase172_decide_clean.png'), fullPage: true });
  console.log('OK phase172_decide_clean');
  await browser.close();
})();
