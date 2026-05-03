// [C-5] 인과 추출 + 시각화 검증
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

const PORT = process.env.PW_PORT || '8765';
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof CAUSAL !== 'undefined' && CAUSAL, { timeout: 10000 });

const causalStatus = await page.evaluate(() => ({
  loaded: !!CAUSAL,
  meta: CAUSAL ? CAUSAL.meta : null,
  topCount: CAUSAL ? CAUSAL.top_causations.length : 0,
  sampleDongs: CAUSAL ? Object.keys(CAUSAL.dongs).slice(0, 3) : [],
}));

console.log('========== CAUSAL 데이터 로드 ==========');
console.log(`  ✅ 로드: ${causalStatus.loaded}`);
console.log(`  · 동 수: ${causalStatus.meta.dong_count}`);
console.log(`  · Pearson: ${causalStatus.meta.pearson_total} 쌍`);
console.log(`  · Granger: ${causalStatus.meta.granger_total} 트리플렛`);
console.log(`  · Top 인과: ${causalStatus.topCount}개`);

// Decide 모드 + 전국 인과 카드 검증
console.log('\n========== Decide 모드 — 전국 Top 인과 카드 ==========');
await page.evaluate(() => switchMode('decide'));
await page.waitForTimeout(1500);

const decideCausal = await page.evaluate(() => {
  const el = document.getElementById('d-top-causal');
  if (!el) return { ok: false };
  const items = el.querySelectorAll('div');
  const meta = document.getElementById('d-causal-meta');
  return {
    ok: items.length >= 5,
    itemCount: items.length,
    firstItem: items[0] ? items[0].textContent.trim().replace(/\s+/g, ' ') : '',
    meta: meta ? meta.textContent : '',
  };
});
console.log(`  · 카드 항목 수: ${decideCausal.itemCount}`);
console.log(`  · 첫 항목: "${decideCausal.firstItem}"`);
console.log(`  · 메타: "${decideCausal.meta}"`);

// Explore 모드 + 자동 코멘트에 인과 검증
console.log('\n========== Explore 모드 — 자동 코멘트에 인과 ==========');
await page.evaluate(() => {
  switchMode('explore');
  const idx = DATA.dongs.findIndex(d => d.name.includes('성수1가1'));
  if (idx >= 0) { selectedDong = DATA.dongs[idx]; setTimeout(() => updateExplore(), 300); }
});
await page.waitForTimeout(2500);

const exploreComment = await page.evaluate(() => {
  const el = document.getElementById('auto-comment');
  return {
    hasCausal: el.textContent.includes('인과 사슬') || el.textContent.includes('Granger'),
    hasPearson: el.textContent.includes('상관') || el.textContent.includes('Pearson'),
    text: el.textContent.replace(/\s+/g, ' ').substring(0, 220),
  };
});
console.log(`  · 인과 사슬 표시: ${exploreComment.hasCausal ? '✅' : '❌'}`);
console.log(`  · 상관 표시: ${exploreComment.hasPearson ? '✅' : '❌'}`);
console.log(`  · 코멘트: "${exploreComment.text}"`);

// 스크린샷
await page.screenshot({ path: 'screenshots/v07_explore_with_causal.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
await page.evaluate(() => switchMode('decide'));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'screenshots/v07_decide_with_causal.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });

if (errors.length) {
  console.log(`\n⚠️ 콘솔 에러 ${errors.length}건:`);
  errors.slice(0, 3).forEach(e => console.log('  - ' + e.substring(0, 200)));
} else {
  console.log('\n✅ 콘솔 에러 0건');
}

await browser.close();

const ok = causalStatus.loaded && decideCausal.ok && exploreComment.hasCausal && errors.length === 0;
console.log('\n=== 종합 ===');
console.log(ok ? '✅ [C-5] 인과 추출 + 시각화 검증 통과'
              : '⚠️ 일부 항목 확인 필요');
