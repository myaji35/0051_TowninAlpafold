// 반응형 검증 — 3개 화면 폭에서 캡처
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const VIEWPORTS = [
  { name: '1480_laptop', width: 1480, height: 900 },
  { name: '1920_fhd',    width: 1920, height: 1080 },
  { name: '2560_3k',     width: 2560, height: 1440 },
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });

  // Explore 모드
  await page.evaluate(() => switchMode('explore'));
  await page.waitForTimeout(2500);
  const exploreFile = `screenshots/v07_responsive_${vp.name}_explore.png`;
  await page.screenshot({ path: exploreFile });

  // 본문 폭 측정
  const widths = await page.evaluate(() => {
    const main = document.querySelector('main');
    const map = document.getElementById('map-explore');
    return {
      main: main ? main.offsetWidth : 0,
      map: map ? map.offsetWidth : 0,
    };
  });
  console.log(`📐 ${vp.name} (${vp.width}×${vp.height}): main=${widths.main}px, map=${widths.map}px`);
  console.log(`   📸 ${exploreFile}`);

  await ctx.close();
}
await browser.close();
console.log('\n✅ 3개 화면 폭 검증 완료');
