// v0.7 검증 — 실데이터 로드 + GeoJsonLayer 작동 확인
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

console.log('📡 v0.7 로드');
const PORT = process.env.PW_PORT || '8765';
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });

await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });

// 데이터 모드 확인
const result = await page.evaluate(() => ({
  mode: typeof DATA_MODE !== 'undefined' ? DATA_MODE : 'unknown',
  dongCount: DATA.dongs.length,
  withPolygon: DATA.dongs.filter(d => d.polygon_geo).length,
  withRealName: DATA.dongs.filter(d => d.real_adm_nm).length,
  layerCount: Object.keys(DATA.dongs[0].layers).length,
  metaText: document.getElementById('meta-info').textContent.substring(0, 80),
}));

console.log('📊 데이터 검증:');
console.log(`  · 데이터 모드: ${result.mode}`);
console.log(`  · 동 수: ${result.dongCount}`);
console.log(`  · 폴리곤 부착: ${result.withPolygon}/${result.dongCount}`);
console.log(`  · 실제 행정동명 매칭: ${result.withRealName}/${result.dongCount}`);
console.log(`  · 레이어 수: ${result.layerCount}`);
console.log(`  · 헤더 메타: "${result.metaText}"`);

// Analyze 모드로 전환 + 지도 로드 대기
console.log('\n🗺 Analyze 모드 진입');
await page.evaluate(() => switchMode('analyze'));
await page.waitForTimeout(3500);  // 타일 로드

// GeoJsonLayer 작동 확인 (간접 — buildAnalyzeLayers 직접 호출하여 검증)
const mapStatus = await page.evaluate(() => {
  try {
    const layers = buildAnalyzeLayers();
    const geoLayer = layers.find(l => l && l.id === 'analyze-real-polygons');
    return {
      ok: !!geoLayer,
      layerCount: layers.length,
      layerIds: layers.map(l => l && l.id).filter(Boolean),
      geoFeatureCount: geoLayer ? (geoLayer.props.data.features || []).length : 0,
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

console.log('🎨 deck.gl 레이어 상태:');
console.log(`  · GeoJsonLayer 작동: ${mapStatus.ok ? '✅' : '❌ ' + mapStatus.reason}`);
console.log(`  · 레이어 ID 목록: ${mapStatus.layerIds.join(', ')}`);
console.log(`  · GeoJSON Feature 수: ${mapStatus.geoFeatureCount}`);

// 스크린샷
await page.screenshot({ path: 'screenshots/v07_analyze_real_polygons.png', fullPage: false });
console.log('📸 screenshots/v07_analyze_real_polygons.png');

// Explore 모드도 검증
console.log('\n🧬 Explore 모드 진입');
await page.evaluate(() => switchMode('explore'));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'screenshots/v07_explore.png', fullPage: false });
console.log('📸 screenshots/v07_explore.png');

if (errors.length) {
  console.log(`\n⚠️ 콘솔 에러 ${errors.length}건:`);
  errors.slice(0, 5).forEach(e => console.log('  - ' + e.substring(0, 200)));
} else {
  console.log('\n✅ 콘솔 에러 0건');
}

await browser.close();
console.log('\n=== 종합 ===');
console.log(result.mode === 'real' && mapStatus.ok && errors.length === 0
  ? '✅ v0.7 검증 통과 — 실데이터 모드 + GeoJsonLayer 작동 + 콘솔 에러 없음'
  : '⚠️ 일부 실패 — 위 로그 확인');
