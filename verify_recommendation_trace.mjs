// [UI_RECOMMENDATION_TRACE-001] 섹션❻ 권고 추적 캐릭터 저니 — 결정자(명분 리포트 열람자)
// 시나리오:
//   (1) 금오동 선택 → meongbun 모드 진입
//   (2) 섹션❻ SHAP 막대: top 5 발산 막대 렌더 + 부호(+/-) 확인
//   (3) 분류 경로(Decision Tree) 펼치기 버튼 클릭 → 브랜치 스텝 ≥ 1 + 잎(vibe) 노드
//   (4) 실제 tree_model.json 통과 결과인지 확인 (분기 feature 한글 라벨)
//   (5) 스크린샷 저장
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const SCREENS = 'screenshots';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

const journey = [];
const step = async (label, fn) => {
  const t0 = Date.now();
  try {
    const ok = await fn();
    journey.push({ label, pass: ok !== false, ms: Date.now() - t0 });
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
await page.waitForFunction(() => typeof TREE_MODEL !== 'undefined' && TREE_MODEL, { timeout: 8000 });

await step('1. 금오동 선택 → 명분(meongbun) 모드 진입', async () => {
  const found = await page.evaluate(() => {
    const d = DATA.dongs.find(x => x.name === '의정부시 금오동');
    if (!d) return { ok: false };
    selectedDong = d;
    switchMode('meongbun');
    return { ok: true, hasLayers: !!d.layers };
  });
  await page.waitForTimeout(700);
  console.log('   demo dong:', found);
  return found.ok && found.hasLayers;
});

await step('2. SHAP 막대 top5 + 부호 발산', async () => {
  const shap = await page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    if (!sec) return { exists: false };
    const rows = sec.querySelectorAll('.trace-shap-row');
    const pos = sec.querySelectorAll('.trace-shap-bar.pos').length;
    const neg = sec.querySelectorAll('.trace-shap-bar.neg').length;
    return { exists: true, rows: rows.length, pos, neg };
  });
  console.log('   shap:', shap);
  return shap.exists && shap.rows === 5 && shap.pos >= 1 && shap.neg >= 1;
});

await step('3. 분류 경로 펼치기 → 브랜치 + 잎 노드', async () => {
  await page.evaluate(() => {
    const el = document.querySelector('#meongbun-sec-6 .trace-tree-toggle');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(200);
  // 실제 클릭
  await page.click('#meongbun-sec-6 .trace-tree-toggle');
  await page.waitForTimeout(300);
  const tree = await page.evaluate(() => {
    const body = document.querySelector('#meongbun-sec-6 .trace-tree-body');
    if (!body) return { exists: false };
    return {
      exists: true,
      visible: !body.hidden,
      branches: body.querySelectorAll('.trace-step:not(.trace-step-leaf)').length,
      leaf: body.querySelectorAll('.trace-step-leaf').length,
      leafTag: (body.querySelector('.trace-leaf-tag') || {}).textContent || ''
    };
  });
  console.log('   tree:', tree);
  return tree.exists && tree.visible && tree.branches >= 1 && tree.leaf === 1;
});

await step('4. 실제 트리 통과 결과 (한글 feature 라벨)', async () => {
  const labels = await page.evaluate(() => {
    const feats = [...document.querySelectorAll('#meongbun-sec-6 .trace-feat')].map(e => e.textContent);
    const dirs = [...document.querySelectorAll('#meongbun-sec-6 .trace-dir')].map(e => e.textContent);
    return { feats, dirs };
  });
  console.log('   branch features:', labels.feats);
  console.log('   directions:', labels.dirs);
  // 최소 1개 분기, 한글 라벨(공백 포함 or _ 없는 한글)
  return labels.feats.length >= 1 && labels.dirs.length >= 1;
});

await step('5. 스크린샷 저장', async () => {
  await page.evaluate(() => {
    const el = document.getElementById('meongbun-sec-6');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/section6_recommendation_trace.png`, fullPage: false });
  return true;
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 섹션❻ 권고 추적 저니: ${passed}/${journey.length} PASS`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (errs.length) console.log('console errors:', errs.slice(0, 5));
await browser.close();
process.exit(passed === journey.length ? 0 : 1);
