// [DECISION_TREE-001] 디시전 트리 캐릭터 저니 — 결정자(Decide 모드 사용자)
// 시나리오:
//   (1) Decide 모드 진입 → tree_model.json 로드 확인
//   (2) 트리 SVG에 노드 ≥ 3 + 잎 ≥ 5 + 엣지 렌더 확인
//   (3) 변수 중요도 막대 차트에 ≥ 3개 항목
//   (4) 동을 selectedDong으로 설정 → 분기 경로 하이라이트(#5BC0EB) ≥ 1개
//   (5) 스크린샷 저장
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const SCREENS = 'screenshots';
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
// tree_model.json 비동기 로드 대기
await page.waitForFunction(() => typeof TREE_MODEL !== 'undefined' && TREE_MODEL, { timeout: 8000 });

await step('1. Decide 모드 진입 + 트리 모델 로드', async () => {
  await page.evaluate(() => switchMode('decide'));
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({
    loaded: !!TREE_MODEL,
    nodes: TREE_MODEL ? TREE_MODEL.nodes.length : 0,
    leaves: TREE_MODEL ? TREE_MODEL.meta.n_leaves : 0,
    acc: TREE_MODEL ? TREE_MODEL.meta.train_accuracy : 0
  }));
  console.log(`   model: ${m.nodes} nodes, ${m.leaves} leaves, acc=${m.acc}`);
  return m.loaded && m.nodes >= 3;
});

await step('2. 트리 SVG 렌더 (노드 + 엣지)', async () => {
  const svg = await page.evaluate(() => {
    const el = document.getElementById('d-tree-canvas');
    if (!el) return { exists: false };
    return {
      exists: true,
      paths: el.querySelectorAll('path').length,
      circles: el.querySelectorAll('circle').length,
      rects: el.querySelectorAll('rect').length,
      texts: el.querySelectorAll('text').length
    };
  });
  console.log(`   svg:`, svg);
  return svg.exists && svg.paths >= 3 && svg.rects >= 5;
});

await step('3. 변수 중요도 막대 차트', async () => {
  const bars = await page.evaluate(() => {
    const el = document.getElementById('d-tree-importance');
    if (!el) return 0;
    return el.querySelectorAll('rect').length;
  });
  console.log(`   importance bars: ${bars}`);
  return bars >= 3;
});

await step('4. 동 선택 시 분기 경로 하이라이트', async () => {
  await page.evaluate(() => {
    selectedDong = DATA.dongs.find(d => d.name && d.name.includes('성수')) || DATA.dongs[0];
    renderDecide();
  });
  await page.waitForTimeout(400);
  const highlight = await page.evaluate(() => {
    const el = document.getElementById('d-tree-canvas');
    if (!el) return 0;
    let cnt = 0;
    el.querySelectorAll('path').forEach(p => {
      const stroke = p.getAttribute('stroke');
      if (stroke === '#5BC0EB') cnt++;
    });
    return cnt;
  });
  console.log(`   highlighted edges: ${highlight}`);
  return highlight >= 1;
});

await step('5. 스크린샷 저장', async () => {
  // 트리 영역 스크롤
  await page.evaluate(() => {
    const el = document.getElementById('d-tree-canvas');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/v07_decision_tree.png`, fullPage: false });
  return true;
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 디시전 트리 저니: ${passed}/${journey.length} PASS`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (errs.length) console.log('console errors:', errs.slice(0, 3));
await browser.close();
process.exit(passed === journey.length ? 0 : 1);
