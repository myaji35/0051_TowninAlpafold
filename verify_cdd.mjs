// (B+C+D) 종합 검증 — Explore 호흡 차트 / Decide 시계열 / 갤러리 카드 모두 cone 표시
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const PORT = process.env.PW_PORT || '8765';
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForFunction(() => typeof FORECASTS !== 'undefined' && FORECASTS, { timeout: 10000 });

console.log('========== (C) Explore 단백질 호흡 ==========');
await page.evaluate(() => {
  switchMode('explore');
  const idx = DATA.dongs.findIndex(d => d.name.includes('성수1가1'));
  if (idx >= 0) { selectedDong = DATA.dongs[idx]; setTimeout(() => updateExplore(), 300); }
});
await page.waitForTimeout(2500);

const explore = await page.evaluate(() => {
  const svg = document.getElementById('explore-trace');
  return {
    paths: svg.querySelectorAll('path').length,
    rects: svg.querySelectorAll('rect').length,
    dashed: svg.querySelectorAll('path[stroke-dasharray]').length,
    viewBox: svg.getAttribute('viewBox'),
  };
});
console.log(`  · viewBox: ${explore.viewBox}  (확대됨)`);
console.log(`  · path: ${explore.paths} (5 history + 5 cone + 5 forecast = 15 예상)`);
console.log(`  · rect: ${explore.rects} (미래 배경 1)`);
console.log(`  · 점선: ${explore.dashed} (예측선 5)`);

// 호흡 차트만 확대 캡처
const traceBox = await page.locator('#explore-trace').boundingBox();
if (traceBox) {
  await page.screenshot({
    path: 'screenshots/v07_breath_zoom_v2.png',
    clip: { x: traceBox.x - 30, y: traceBox.y - 50, width: traceBox.width + 60, height: traceBox.height + 70 }
  });
}

console.log('\n========== (D-1) Decide 시계열 ==========');
await page.evaluate(() => switchMode('decide'));
await page.waitForTimeout(1500);

const decide = await page.evaluate(() => {
  const svg = document.getElementById('d-chart');
  return {
    paths: svg.querySelectorAll('path').length,
    rects: svg.querySelectorAll('rect').length,
    dashed: svg.querySelectorAll('path[stroke-dasharray]').length,
    text: Array.from(svg.querySelectorAll('text')).map(t => t.textContent).filter(t => t.includes('Prophet')),
  };
});
console.log(`  · path: ${decide.paths}`);
console.log(`  · rect: ${decide.rects} (미래 배경 1 예상)`);
console.log(`  · 점선: ${decide.dashed}`);
console.log(`  · Prophet 라벨: ${decide.text.join(' / ') || '(없음)'}`);
await page.screenshot({ path: 'screenshots/v07_decide_with_cone.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });

console.log('\n========== (D-2) 갤러리 카드 mini cone ==========');
await page.evaluate(() => switchMode('gallery'));
await page.waitForTimeout(1500);

const gallery = await page.evaluate(() => {
  const cards = document.querySelectorAll('.theme-card .mini-preview');
  if (!cards.length) return { count: 0 };
  const first = cards[0];
  return {
    count: cards.length,
    paths: first.querySelectorAll('path').length,
    rects: first.querySelectorAll('rect').length,
    dashed: first.querySelectorAll('path[stroke-dasharray]').length,
  };
});
console.log(`  · 카드 수: ${gallery.count}`);
console.log(`  · 첫 카드 path: ${gallery.paths} (5 history + 1 cone + 1 forecast line = 7 예상)`);
console.log(`  · 첫 카드 rect: ${gallery.rects} (미래 배경 1)`);
console.log(`  · 첫 카드 점선: ${gallery.dashed} (예측선 1)`);

await page.screenshot({ path: 'screenshots/v07_gallery_with_cone.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });

if (errors.length) {
  console.log(`\n⚠️ 콘솔 에러 ${errors.length}건:`);
  errors.slice(0, 3).forEach(e => console.log('  - ' + e.substring(0, 200)));
} else {
  console.log('\n✅ 콘솔 에러 0건 (3개 모드 모두)');
}

await browser.close();

const ok = explore.paths >= 15 && decide.rects >= 1 && gallery.paths >= 6 && errors.length === 0;
console.log('\n=== 종합 ===');
console.log(ok ? '✅ B+C+D 통합 검증 통과' : '⚠️ 일부 항목 확인 필요');
