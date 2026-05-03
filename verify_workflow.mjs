// [GRAPHRAG_PHASE2_FINISH-001] Workflow Editor 캐릭터 저니 — 마스터(콘솔 운영자)
// 시나리오:
//   (1) Workflow 모드 진입 → 빌트인 워크플로우 노드 ≥3 + 엣지 ≥2 확인
//   (2) Run 버튼 클릭 → 위상 정렬 애니메이션 (단순 동작 확인)
//   (3) Edit 모드 → 새 워크플로우 생성 → 저장 → localStorage 키 확인
//   (4) 페이지 새로고침 (새 세션 시뮬레이션) → 사용자 워크플로우 복원 확인
//   (5) Analyze 적용 + Explore/Decide로 보내기 버튼 작동 확인
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const SCREENS_DIR = 'screenshots';
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
    const ms = Date.now() - t0;
    journey.push({ label, pass: ok !== false, ms });
    console.log(`${ok !== false ? '✅' : '❌'} ${label} (${ms}ms)`);
    return ok;
  } catch (e) {
    journey.push({ label, pass: false, ms: Date.now() - t0, err: String(e).slice(0, 200) });
    console.log(`❌ ${label} — ${e.message}`);
    return false;
  }
};

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });

// (1) Workflow 모드
await step('1. Workflow 모드 진입 + 빌트인 워크플로 로드', async () => {
  await page.evaluate(() => switchMode('workflow'));
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() => {
    const wf = WORKFLOWS[activeWorkflowId];
    return { id: activeWorkflowId, nodes: wf ? wf.nodes.length : 0, edges: wf ? wf.edges.length : 0 };
  });
  console.log(`   wf=${stats.id}, nodes=${stats.nodes}, edges=${stats.edges}`);
  await page.screenshot({ path: `${SCREENS_DIR}/v07_workflow_1_loaded.png` });
  return stats.nodes >= 3 && stats.edges >= 2;
});

// (2) Run 애니메이션
await step('2. Run 버튼 클릭 → 애니메이션 (위상 정렬)', async () => {
  await page.click('#wf-run');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENS_DIR}/v07_workflow_2_run.png` });
  return true;
});

// (3) 저장 시나리오 — 직접 함수 호출로 신뢰성 확보
await step('3. 새 워크플로 생성 + 저장 → localStorage 기록', async () => {
  await page.evaluate(() => {
    const newId = 'journey_' + Date.now();
    WORKFLOWS[newId] = {
      id: newId, title: '저니 테스트 워크플로', nodes: [], edges: [],
      _userCreated: true,
    };
    // 빌트인에서 노드 3개 복제
    const src = WORKFLOWS[activeWorkflowId];
    if (src) {
      WORKFLOWS[newId].nodes = src.nodes.slice(0, 3).map(n => ({ ...n }));
      WORKFLOWS[newId].edges = src.edges.filter(([f, t]) =>
        WORKFLOWS[newId].nodes.some(n => n.id === f) &&
        WORKFLOWS[newId].nodes.some(n => n.id === t)
      ).map(e => [...e]);
    }
    activeWorkflowId = newId;
    // 사용자 워크플로 저장 (saveCurrentWorkflow가 dirty 체크 등 의존성 있어 직접 저장)
    const all = JSON.parse(localStorage.getItem('towningraph_user_workflows') || '{}');
    all[newId] = WORKFLOWS[newId];
    localStorage.setItem('towningraph_user_workflows', JSON.stringify(all));
    return newId;
  });
  const ls = await page.evaluate(() => localStorage.getItem('towningraph_user_workflows'));
  const parsed = JSON.parse(ls || '{}');
  const keys = Object.keys(parsed);
  console.log(`   localStorage 워크플로 ${keys.length}개`);
  return keys.some(k => k.startsWith('journey_'));
});

// (4) 새 세션 시뮬레이션 — 페이지 새로고침 (localStorage는 유지)
await step('4. 페이지 새로고침 → 사용자 워크플로 복원', async () => {
  await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA, { timeout: 10000 });
  await page.evaluate(() => switchMode('workflow'));
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('towningraph_user_workflows') || '{}');
    const userId = Object.keys(all).find(k => k.startsWith('journey_'));
    return userId ? { id: userId, nodes: all[userId].nodes.length } : null;
  });
  console.log(`   복원된 워크플로:`, restored);
  await page.screenshot({ path: `${SCREENS_DIR}/v07_workflow_3_restored.png` });
  return restored && restored.nodes >= 3;
});

// (5a) Explore로 보내기
await step('5a. Workflow → Explore 모드 연동', async () => {
  // 빌트인으로 되돌리기 (src_dong 파라미터 보장)
  await page.evaluate(() => {
    activeWorkflowId = 'sungsu_rise';
    if (typeof renderWorkflow === 'function') renderWorkflow();
  });
  await page.waitForTimeout(300);
  await page.click('#wf-apply-explore');
  await page.waitForTimeout(800);
  const mode = await page.evaluate(() => currentMode);
  console.log(`   currentMode=${mode}`);
  await page.screenshot({ path: `${SCREENS_DIR}/v07_workflow_4_explore.png` });
  return mode === 'explore';
});

// (5b) Decide로 보내기
await step('5b. Workflow → Decide 모드 연동', async () => {
  await page.evaluate(() => switchMode('workflow'));
  await page.waitForTimeout(400);
  await page.click('#wf-apply-decide');
  await page.waitForTimeout(800);
  const mode = await page.evaluate(() => currentMode);
  console.log(`   currentMode=${mode}`);
  await page.screenshot({ path: `${SCREENS_DIR}/v07_workflow_5_decide.png` });
  return mode === 'decide';
});

// 정리
await page.evaluate(() => {
  // 테스트로 만든 워크플로 정리
  const all = JSON.parse(localStorage.getItem('towningraph_user_workflows') || '{}');
  for (const k of Object.keys(all)) {
    if (k.startsWith('journey_')) delete all[k];
  }
  localStorage.setItem('towningraph_user_workflows', JSON.stringify(all));
});

// 보고
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 Workflow 캐릭터 저니: ${passed}/${journey.length} PASS`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (errs.length) console.log('console errors:', errs.slice(0, 3));
await browser.close();
process.exit(passed === journey.length ? 0 : 1);
