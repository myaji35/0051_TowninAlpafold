// [FIX_TREE_FEATURE_UNMAPPED-001] 트리 feature 미매핑 시 오분류 경로 방지 검증
// 근거: ISS-253 도메인 분석 CRITICAL
//   _classifyDong의 ko2en은 5키(소상공/카페/유동/거래/지가)만 매핑한다(app.js:1554).
//   tree_model.json이 재학습되어 매핑에 없는 feature를 쓰면 layer=undefined → arr=[] → val=0이
//   되어 val<=threshold가 항상 참 → 좌측 고정 분기. 그 잘못된 경로가 UI에는
//   "실제 학습 트리 tree_model.json 통과 결과"(app.js:5246)로 표시된다.
//
// AC-1 미매핑 feature를 val=0으로 분기하지 않는다
// AC-2 미매핑 시 콘솔 경고를 남긴다
// AC-3 미매핑이면 분기 경로를 "실제 트리 결과"로 렌더하지 않는다
// AC-4 기존 5개 매핑 feature 회귀 없음
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8766';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } });
const warns = [];
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });
await page.waitForFunction(() => typeof TREE_MODEL !== 'undefined' && TREE_MODEL, { timeout: 8000 });

const DONG = '의정부시 금오동';

// AC-4 (회귀): 손대지 않은 원본 트리에서 경로가 정상 생성되는가
const baseline = await page.evaluate((dong) => {
  const steps = buildTraceBranchPath(dong);
  return {
    ok: Array.isArray(steps) && steps.length > 0,
    branches: (steps || []).filter((s) => s.kind === 'branch').length,
    leaves: (steps || []).filter((s) => s.kind === 'leaf').length,
    feats: (steps || []).filter((s) => s.kind === 'branch').map((s) => s.feature),
  };
}, DONG);

// AC-1/2/3: 트리의 첫 분기 feature를 매핑에 없는 이름으로 바꿔치기한다.
// 이때 val=0 fallback이 살아 있으면 경로가 "그럴듯하게" 계속 만들어진다(=버그).
const injected = await page.evaluate((dong) => {
  const root = TREE_MODEL.nodes ? TREE_MODEL.nodes.find((n) => n.id === 0) : null;
  const before = root ? root.feature_name : null;
  if (root) root.feature_name = '미지의피처_평균';   // ko2en에 없는 키
  let steps, threw = null;
  try { steps = buildTraceBranchPath(dong); } catch (e) { threw = e.message; }
  if (root) root.feature_name = before;              // 원복
  return {
    injected_into: before,
    threw,
    steps_is_null: steps === null,
    steps_len: Array.isArray(steps) ? steps.length : -1,
  };
}, DONG);

// AC-3: 미매핑 상태에서 실제 렌더 시 "실제 트리 결과" 고지와 함께 경로가 뜨지 않아야 한다
const rendered = await page.evaluate((dong) => {
  const root = TREE_MODEL.nodes ? TREE_MODEL.nodes.find((n) => n.id === 0) : null;
  const before = root ? root.feature_name : null;
  if (root) root.feature_name = '미지의피처_평균';
  renderRecommendationTrace(dong);
  const sec = document.getElementById('meongbun-sec-6');
  const out = {
    tree_body: !!sec.querySelector('.trace-tree-body'),
    branch_steps: sec.querySelectorAll('.trace-step:not(.trace-step-leaf)').length,
  };
  if (root) root.feature_name = before;
  renderRecommendationTrace(dong);                   // 원복 렌더
  return out;
}, DONG);

const checks = [
  ['AC-4 회귀: 원본 트리 경로 정상 생성', baseline.ok && baseline.branches >= 1 && baseline.leaves === 1,
    `branches=${baseline.branches} leaves=${baseline.leaves} feats=${JSON.stringify(baseline.feats)}`],
  ['AC-1 미매핑 feature를 val=0으로 분기하지 않음 (경로 null)', injected.steps_is_null,
    `steps_len=${injected.steps_len} threw=${injected.threw}`],
  ['AC-2 미매핑 시 콘솔 경고', warns.some((w) => w.includes('미지의피처') || w.includes('미매핑') || w.includes('unmapped')),
    warns.slice(0, 3).join(' | ') || 'none'],
  ['AC-3 미매핑이면 분기 경로 미렌더', !rendered.tree_body && rendered.branch_steps === 0,
    `tree_body=${rendered.tree_body} steps=${rendered.branch_steps}`],
];

console.log('\n━━━ 트리 feature 미매핑 오분류 방지 검증 ━━━');
checks.forEach(([label, pass, detail]) => console.log(`${pass ? '✅' : '❌'} ${label} — ${detail}`));
const failed = checks.filter(([, p]) => !p).length;
console.log(`\n총 ${checks.length} · 통과 ${checks.length - failed} · 실패 ${failed}`);
await browser.close();
process.exit(failed ? 1 : 0);
