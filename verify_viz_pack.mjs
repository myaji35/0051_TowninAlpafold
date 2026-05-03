// VIZ_PACK V-1/V-2/V-3 통합 캐릭터 저니
// 시나리오: 데이터 분석가가 Data Studio → Viz Pack 탭 진입 → 9종 차트 렌더 + linked brushing
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

const journey = [];
const step = async (label, fn) => {
  const t0 = Date.now();
  try {
    const ok = await fn();
    journey.push({ label, pass: ok !== false, ms: Date.now()-t0 });
    console.log(`${ok !== false ? '✅' : '❌'} ${label}`);
    return ok;
  } catch (e) {
    journey.push({ label, pass: false, err: e.message });
    console.log(`❌ ${label} — ${e.message}`);
    return false;
  }
};

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });

await step('1. VizEngine 9종 플러그인 등록 확인', async () => {
  const list = await page.evaluate(() => window.VizEngine ? window.VizEngine.list().map(p => p.id) : []);
  console.log('   plugins:', list);
  // V-0 4개 + V-1/V-2 9개 + linked-brushing 1 = 14
  const expected = ['ridgeline','sankey-map','calendar-heat','violin','spiral','small-multiples','slope','map-treemap','bullet','linked-brushing'];
  const missing = expected.filter(id => !list.includes(id));
  if (missing.length) console.log('   missing:', missing);
  return missing.length === 0;
});

await step('2. Viz Pack 탭 활성화 + 9종 SVG 렌더', async () => {
  await page.evaluate(() => switchMode('datastudio'));
  await page.waitForTimeout(400);
  await page.click('button[data-ds="vizpack"]');
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const ids = ['viz-ridgeline','viz-sankey-map','viz-calendar-heat','viz-violin','viz-spiral','viz-small-multiples','viz-slope','viz-bullet','viz-map-treemap'];
    return ids.map(id => {
      const el = document.getElementById(id);
      const inner = el ? el.innerHTML.length : 0;
      return { id, exists: !!el, inner };
    });
  });
  console.table(result);
  const rendered = result.filter(r => r.exists && r.inner > 200).length;
  return rendered >= 9;
});

await step('3. Linked Brushing 자동 바인딩', async () => {
  const ok = await page.evaluate(() => window.VizLinkedBrushing && window.VizLinkedBrushing.bind ? true : false);
  return ok;
});

await step('4. 스크린샷 저장 — Viz Pack 전체', async () => {
  await page.screenshot({ path: 'screenshots/v07_viz_pack.png', fullPage: false });
  return true;
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 Viz Pack 저니: ${passed}/${journey.length} PASS`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (errs.length) console.log('console errors:', errs.slice(0, 5));
await browser.close();
process.exit(passed === journey.length ? 0 : 1);
