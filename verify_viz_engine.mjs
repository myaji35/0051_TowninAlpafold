// V-0 VizEngine 코어 검증 — 플러그인 등록 + 4종 차트 회귀 + ScopeManager 이벤트
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

console.log('▶ VizEngine 코어 검증 시작');
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 12000 });

// 1. 플러그인 등록 확인
const reg = await page.evaluate(() => {
  if (typeof window.VizEngine === 'undefined') return { ok: false, reason: 'VizEngine 미로딩' };
  return {
    ok: true,
    plugins: window.VizEngine.list().map(p => ({ id: p.id, label: p.label, hasRender: typeof p.render === 'function' })),
    has_columns3d: window.VizEngine.has('columns3d'),
    has_heatmap:   window.VizEngine.has('heatmap'),
    has_hexagon:   window.VizEngine.has('hexagon'),
    has_pearson:   window.VizEngine.has('pearson5x5'),
    apiSurface: {
      register: typeof window.VizEngine.register === 'function',
      render:   typeof window.VizEngine.render === 'function',
      scope:    typeof window.VizEngine.scope === 'function',
    },
  };
});

console.log('🧩 플러그인 레지스트리:');
console.log(`  · 등록 수: ${reg.plugins.length}`);
console.log(`  · 4종: columns3d=${reg.has_columns3d} heatmap=${reg.has_heatmap} hexagon=${reg.has_hexagon} pearson5x5=${reg.has_pearson}`);
console.log(`  · API: register/render/scope 모두 함수 = ${Object.values(reg.apiSurface).every(Boolean)}`);

const acceptApi = reg.ok && reg.has_columns3d && reg.has_heatmap && reg.has_hexagon && reg.has_pearson
              && Object.values(reg.apiSurface).every(Boolean);

// 2. ChartPlugin 인터페이스 검증
const iface = await page.evaluate(() => {
  const ids = ['columns3d', 'heatmap', 'hexagon', 'pearson5x5'];
  return ids.map(id => {
    const p = window.VizEngine.get(id);
    return {
      id,
      hasId: !!p.id,
      hasLabel: typeof p.label === 'string',
      hasIcon: typeof p.icon === 'string',
      hasRender: typeof p.render === 'function',
      hasSupports: typeof p.supports === 'function',
    };
  });
});
const acceptIface = iface.every(p => p.hasId && p.hasLabel && p.hasIcon && p.hasRender && p.hasSupports);
console.log(`📋 ChartPlugin 인터페이스 (id/label/icon/render/supports): ${acceptIface ? '✅' : '❌'}`);
if (!acceptIface) console.log(JSON.stringify(iface, null, 2));

// 3. Analyze 모드 진입 + 4종 회귀 (columns/heat/hex via UI 모드)
console.log('\n🗺 Analyze 모드 진입 + 3종 차트 회귀');
await page.evaluate(() => switchMode('analyze'));
await page.waitForTimeout(2500);

const modes = ['columns', 'heat', 'hex'];
const mapped = { columns: 'columns3d', heat: 'heatmap', hex: 'hexagon' };
const layerCounts = {};
for (const m of modes) {
  await page.selectOption('#m-mode', m);
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    try {
      const ls = buildAnalyzeLayers();
      return {
        ok: Array.isArray(ls) && ls.length > 0,
        count: ls.length,
        ids: ls.map(l => l && l.id).filter(Boolean),
      };
    } catch (e) { return { ok: false, err: e.message }; }
  });
  layerCounts[m] = result;
  console.log(`  · mode=${m} (${mapped[m]}) → layers=${result.count} ids=[${(result.ids||[]).join(', ')}]`);
}
const acceptCharts = Object.values(layerCounts).every(r => r.ok);

// 4. VizEngine.render 직접 호출 확인 (단일 진입점 동작)
const directRender = await page.evaluate(() => {
  try {
    const dongs = DATA.dongs.slice(0, 10);
    const scope = { dongs, monthIndex: 30, height: 'biz_cafe', color: 'visitors_20s' };
    const result = window.VizEngine.render('columns3d', scope, null, { chartId: 'test-direct' });
    return {
      ok: Array.isArray(result) && result.length > 0,
      count: result ? result.length : 0,
      activeAfter: window.VizEngine.activeCharts(),
    };
  } catch (e) { return { ok: false, err: e.message }; }
});
console.log(`🎯 VizEngine.render 직접 호출: ${directRender.ok ? '✅' : '❌ ' + directRender.err} (layers=${directRender.count}, active=${(directRender.activeAfter||[]).length})`);

// 5. ScopeManager 변경 → rerenderAll 트리거 (event-driven)
const eventDriven = await page.evaluate(async () => {
  let fireCount = 0;
  const unsub = window.VizScope.instance.subscribe(() => fireCount++);
  window.VizScope.instance.set({ monthIndex: 42 });
  window.VizScope.instance.set({ monthIndex: 43 });
  unsub();
  return { fireCount };
});
console.log(`🔔 ScopeManager 이벤트: fired ${eventDriven.fireCount}회 (기대 ≥2) ${eventDriven.fireCount >= 2 ? '✅' : '❌'}`);

// 6. tokens.js → brand-dna.json 색상 동기화 (또는 폴백)
const tokenSync = await page.evaluate(() => {
  const c = window.VizTokens.colors();
  return {
    hero: c.hero,
    accent: c.accent,
    plddtMatch: c.plddt_high === '#00529B' && c.plddt_poor === '#C9485B',
  };
});
console.log(`🎨 tokens (hero=${tokenSync.hero}, accent=${tokenSync.accent}, plddt 일치=${tokenSync.plddtMatch ? '✅' : '❌'})`);

// 7. 코어 라인 수 (외부 측정)
console.log('\n📏 코어 라인 수는 wc -l viz/*.js 로 별도 검증 (≤600 기준)');

// 8. 콘솔 에러
console.log(`\n📟 콘솔 에러: ${errors.length}건${errors.length ? '' : ' ✅'}`);
if (errors.length) errors.slice(0, 5).forEach(e => console.log('  - ' + e.substring(0, 200)));

// 스크린샷 (증거)
await page.screenshot({ path: 'screenshots/v0_viz_engine_columns.png', fullPage: false });
console.log('📸 screenshots/v0_viz_engine_columns.png');

await browser.close();

const allPass = acceptApi && acceptIface && acceptCharts && directRender.ok && eventDriven.fireCount >= 2 && tokenSync.plddtMatch && errors.length === 0;
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(allPass ? '✅ V-0 VizEngine 코어 PASS' : '⚠ 일부 항목 실패');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(allPass ? 0 : 1);
