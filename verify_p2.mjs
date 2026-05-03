// (P2) Causal Graph 시각화 검증
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

// Data Studio → Causal 서브탭 진입
await page.evaluate(() => switchMode('datastudio'));
await page.waitForTimeout(500);
await page.evaluate(() => { dsActiveTab = 'causal'; switchDsPane(); });
await page.waitForTimeout(1500);

// 동별 모드 검증
console.log('========== 동별 모드 (성수1가1동 기본) ==========');
const dongMode = await page.evaluate(() => {
  const svg = document.getElementById('causal-canvas');
  return {
    nodes: svg.querySelectorAll('[data-causal-node]').length,
    paths: Array.from(svg.querySelectorAll('path[marker-end]')).length,
    rects: svg.querySelectorAll('rect').length,
    grangerListCount: document.getElementById('causal-granger-list').children.length,
    pearsonListCount: document.getElementById('causal-pearson-list').children.length,
    insight: document.getElementById('causal-insight').textContent.substring(0, 100),
  };
});
console.log(`  · 노드: ${dongMode.nodes} (5개 레이어 예상)`);
console.log(`  · 화살표 엣지: ${dongMode.paths} (Granger 인과 수)`);
console.log(`  · 라벨 박스: ${dongMode.rects}`);
console.log(`  · Granger 리스트: ${dongMode.grangerListCount}개`);
console.log(`  · Pearson 리스트: ${dongMode.pearsonListCount}개`);
console.log(`  · 인사이트: "${dongMode.insight.replace(/\s+/g, ' ').trim()}"`);

await page.screenshot({ path: 'screenshots/v07_causal_dong.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });

// 전국 모드 전환
console.log('\n========== 전국 메타 모드 ==========');
await page.evaluate(() => {
  document.querySelector('input[value="national"]').click();
});
await page.waitForTimeout(800);

const natMode = await page.evaluate(() => {
  const svg = document.getElementById('causal-canvas');
  return {
    nodes: svg.querySelectorAll('[data-causal-node]').length,
    paths: Array.from(svg.querySelectorAll('path[marker-end]')).length,
    listCount: document.getElementById('causal-granger-list').children.length,
    insight: document.getElementById('causal-insight').textContent.substring(0, 100),
  };
});
console.log(`  · 노드: ${natMode.nodes}`);
console.log(`  · 전국 Top 인과 엣지: ${natMode.paths}`);
console.log(`  · 리스트: ${natMode.listCount}개`);
console.log(`  · 인사이트: "${natMode.insight.replace(/\s+/g, ' ').trim()}"`);

await page.screenshot({ path: 'screenshots/v07_causal_national.png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });

// 흐름 재생 클릭
await page.evaluate(() => document.getElementById('causal-replay').click());
await page.waitForTimeout(2000);

if (errors.length) {
  console.log(`\n⚠️ 콘솔 에러 ${errors.length}건:`);
  errors.slice(0, 3).forEach(e => console.log('  - ' + e.substring(0, 200)));
} else {
  console.log('\n✅ 콘솔 에러 0건');
}

await browser.close();

const ok = dongMode.nodes === 5 && dongMode.paths >= 5 && natMode.paths >= 5 && errors.length === 0;
console.log('\n=== 종합 ===');
console.log(ok ? '✅ (P2) Causal Graph 시각화 검증 통과'
              : '⚠️ 일부 항목 확인 필요');
