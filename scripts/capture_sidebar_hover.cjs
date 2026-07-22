// 사이드바 호버 펼침 캡처
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3051';
const OUT = path.resolve(__dirname, '..', 'screenshots');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', msg => msg.type() === 'error' && console.error('ERR:', msg.text().slice(0, 200)));

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // 1. 평소(접힘)
  await page.screenshot({ path: path.join(OUT, 'phase171_collapsed_default.png'), fullPage: true });
  console.log('OK phase171_collapsed_default');

  // 2. 호버 펼침
  await page.hover('#app-sidebar');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'phase171_hover_expanded.png'), fullPage: true });
  console.log('OK phase171_hover_expanded');

  // 3. 핀 고정 모드
  await page.click('.sb-toggle');
  await page.waitForTimeout(400);
  // 호버 해제 (본문으로 마우스 이동)
  await page.mouse.move(800, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'phase171_pinned.png'), fullPage: true });
  console.log('OK phase171_pinned');

  // 4. 핀 해제 + 본문 호버 (다시 접힘 확인)
  await page.click('.sb-toggle');
  await page.waitForTimeout(300);
  await page.mouse.move(800, 400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'phase171_collapsed_after_unpin.png'), fullPage: true });
  console.log('OK phase171_collapsed_after_unpin');

  await browser.close();
})();
