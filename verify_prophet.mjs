// [C-4] Prophet 통합 검증 — Explore 모드에서 cone 시각화 확인
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

console.log('📡 v0.7 + Prophet 로드');
await page.goto('http://localhost:8765/index.html', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs.length > 100, { timeout: 10000 });

// FORECASTS 로드 대기 (비동기)
await page.waitForTimeout(2000);

const fcstStatus = await page.evaluate(() => ({
  loaded: !!FORECASTS,
  meta: FORECASTS ? FORECASTS.meta : null,
  sampleCode: FORECASTS ? Object.keys(FORECASTS.forecasts)[0] : null,
}));

console.log('📊 Prophet 예측 상태:');
if (fcstStatus.loaded) {
  console.log(`  ✅ FORECASTS 로드 완료`);
  console.log(`  · 동 수: ${fcstStatus.meta.dong_count}`);
  console.log(`  · 레이어: ${fcstStatus.meta.layers.join(', ')}`);
  console.log(`  · horizon: ${fcstStatus.meta.horizon_months}개월`);
  console.log(`  · 모델: ${fcstStatus.meta.model}`);
  console.log(`  · 실패: ${fcstStatus.meta.failures}`);
} else {
  console.log('  ⚠️ forecasts.json 미로드 (예측 cone 안 보임)');
}

// Explore 모드 + 성수1가1동 선택
console.log('\n🧬 Explore 모드 진입 + 성수1가1동 선택');
await page.evaluate(() => {
  switchMode('explore');
  const idx = DATA.dongs.findIndex(d => d.name.includes('성수1가1'));
  if (idx >= 0) {
    selectedDong = DATA.dongs[idx];
    setTimeout(() => updateExplore(), 300);
  }
});
await page.waitForTimeout(2500);

// SVG 안에 cone path가 있는지 검증
const traceContent = await page.evaluate(() => {
  const svg = document.getElementById('explore-trace');
  if (!svg) return { ok: false, reason: 'svg 없음' };
  const pathCount = svg.querySelectorAll('path').length;
  const rectCount = svg.querySelectorAll('rect').length;  // 미래 영역 배경
  const dashedPathCount = Array.from(svg.querySelectorAll('path[stroke-dasharray]')).length;
  return {
    ok: pathCount > 5,
    pathCount,
    rectCount,
    dashedPathCount,
    text: svg.textContent.trim().substring(0, 80),
  };
});

console.log('\n📈 단백질 호흡 차트 검증:');
console.log(`  · path 수: ${traceContent.pathCount} (5종 시계열 5개 + cone 5개 + 예측선 5개 = 15개 예상)`);
console.log(`  · rect 수: ${traceContent.rectCount} (미래 영역 배경 1개)`);
console.log(`  · 점선 (예측선): ${traceContent.dashedPathCount}`);
console.log(`  · 텍스트: "${traceContent.text}"`);

// 스크린샷
await page.screenshot({ path: 'screenshots/v07_prophet_explore.png', fullPage: false });
console.log('\n📸 screenshots/v07_prophet_explore.png');

if (errors.length) {
  console.log(`\n⚠️ 콘솔 에러 ${errors.length}건:`);
  errors.slice(0, 3).forEach(e => console.log('  - ' + e.substring(0, 200)));
} else {
  console.log('\n✅ 콘솔 에러 0건');
}

await browser.close();
console.log('\n=== 종합 ===');
const ok = fcstStatus.loaded && traceContent.pathCount > 10 && errors.length === 0;
console.log(ok
  ? '✅ Prophet 통합 검증 통과 — forecasts 로드 + cone 렌더링 + 콘솔 에러 없음'
  : '⚠️ 일부 항목 확인 필요 (위 로그)');
