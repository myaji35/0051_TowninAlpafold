// Sources demand 보드 깨끗한 캡처
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3051/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.click('.sb-item[data-mode="datastudio"]');
  await page.waitForTimeout(1000);
  // Sources 탭 (이미 기본)
  await page.mouse.move(900, 400);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'screenshots', 'phase173_sources_demand.png'), fullPage: true });
  console.log('OK phase173_sources_demand');
  await browser.close();
})();
