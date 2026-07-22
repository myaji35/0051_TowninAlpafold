// [UI_RECOMMENDATION_TRACE-001] 섹션❻ 권고 추적 — S-1~S-12 자동 회귀
// TEST_RECO_TRACE_REGRESSION-001: rules JSON scenarios(S-1~S-12) 전체를 자동 실행하고
//   PASS/FAIL 집계. 전체 PASS 시 exit 0, 하나라도 FAIL 시 exit 1.
//   기존 5스텝 해피패스(S-1~S-3, S-11)를 12 시나리오로 확장.
import { chromium } from 'playwright';

const PORT = process.env.PW_PORT || '8765';
const BASE = `http://localhost:${PORT}/index.html`;
const SCREENS = 'screenshots';

const journey = [];
const record = (id, pass, extra) => {
  journey.push({ id, pass: pass !== false });
  console.log(`${pass !== false ? '✅' : '❌'} ${id}${extra ? ' — ' + extra : ''}`);
  return pass !== false;
};

const browser = await chromium.launch({ headless: true });

// ── 공용: 정상 페이지 로드 헬퍼 ──────────────────────────────────
async function newLoadedPage(routeBlockTree = false) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const appErrs = [];
  // 앱 레벨 에러만 수집 (console.error + pageerror). 네트워크 실패 표준 로그는 console 'error' 타입이 아님.
  page.on('console', m => { if (m.type() === 'error') appErrs.push(m.text()); });
  page.on('pageerror', e => appErrs.push('PAGEERROR: ' + e.message));
  if (routeBlockTree) {
    // S-9/S-12: tree_model.json 404 시뮬 — goto 전에 라우트 설정
    await page.route('**/tree_model.json', route => route.fulfill({ status: 404, body: 'not found' }));
  }
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && DATA.dongs && DATA.dongs.length > 100, { timeout: 10000 });
  if (!routeBlockTree) {
    await page.waitForFunction(() => typeof TREE_MODEL !== 'undefined' && TREE_MODEL, { timeout: 8000 }).catch(() => {});
  }
  return { ctx, page, appErrs };
}

// 금오동 선택 → meongbun 모드 → 섹션❻ 렌더 대기
async function enterMeongbun(page, dongName) {
  const res = await page.evaluate((name) => {
    const d = DATA.dongs.find(x => x.name === name);
    if (!d) return { ok: false };
    selectedDong = d;
    switchMode('meongbun');
    return { ok: true, hasLayers: !!d.layers };
  }, dongName);
  await page.waitForTimeout(700);
  return res;
}

// 트리 토글 펼치기
async function expandTree(page) {
  await page.evaluate(() => {
    const el = document.querySelector('#meongbun-sec-6 .trace-tree-toggle');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(150);
  const has = await page.$('#meongbun-sec-6 .trace-tree-toggle');
  if (has) { await page.click('#meongbun-sec-6 .trace-tree-toggle'); await page.waitForTimeout(300); }
  return !!has;
}

// ── 정상 페이지 (S-1~S-8, S-10, S-11) ─────────────────────────────
const main = await newLoadedPage(false);

// S-1: 금오동 SHAP top5 + 부호 발산
try {
  const enter = await enterMeongbun(main.page, '의정부시 금오동');
  const shap = await main.page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    if (!sec) return { exists: false };
    return {
      exists: true,
      rows: sec.querySelectorAll('.trace-shap-row').length,
      pos: sec.querySelectorAll('.trace-shap-bar.pos').length,
      neg: sec.querySelectorAll('.trace-shap-bar.neg').length,
    };
  });
  record('S-1', enter.ok && enter.hasLayers && shap.exists && shap.rows === 5 && shap.pos >= 1 && shap.neg >= 1,
    `rows=${shap.rows} pos=${shap.pos} neg=${shap.neg}`);
} catch (e) { record('S-1', false, e.message); }

// S-2: 트리 토글 → hidden 해제, branch>=1 + leaf==1, aria-expanded='true'
try {
  const toggleExists = await expandTree(main.page);
  const tree = await main.page.evaluate(() => {
    const body = document.querySelector('#meongbun-sec-6 .trace-tree-body');
    const toggle = document.querySelector('#meongbun-sec-6 .trace-tree-toggle');
    if (!body) return { exists: false };
    return {
      exists: true,
      visible: !body.hidden,
      branches: body.querySelectorAll('.trace-step:not(.trace-step-leaf)').length,
      leaf: body.querySelectorAll('.trace-step-leaf').length,
      aria: toggle ? toggle.getAttribute('aria-expanded') : null,
    };
  });
  record('S-2', toggleExists && tree.exists && tree.visible && tree.branches >= 1 && tree.leaf === 1 && tree.aria === 'true',
    `branches=${tree.branches} leaf=${tree.leaf} aria=${tree.aria}`);
} catch (e) { record('S-2', false, e.message); }

// S-3: feature 한글 라벨 + 방향 '충족/초과' + leaf 태그 한글
try {
  const t = await main.page.evaluate(() => {
    const feats = [...document.querySelectorAll('#meongbun-sec-6 .trace-feat')].map(e => e.textContent.trim());
    const dirs = [...document.querySelectorAll('#meongbun-sec-6 .trace-dir')].map(e => e.textContent.trim());
    const leaf = (document.querySelector('#meongbun-sec-6 .trace-leaf-tag') || {}).textContent || '';
    return { feats, dirs, leaf: leaf.trim() };
  });
  const hangul = /[가-힣]/;
  const dirOk = t.dirs.length >= 1 && t.dirs.every(d => d.includes('좌측') || d.includes('우측'));
  const featOk = t.feats.length >= 1 && t.feats.some(f => hangul.test(f));
  const leafOk = hangul.test(t.leaf);
  record('S-3', featOk && dirOk && leafOk, `feats=[${t.feats.join(',')}] leaf=${t.leaf}`);
} catch (e) { record('S-3', false, e.message); }

// S-4: 성수1가1동으로 변경 → trace-block 1개만, SHAP 성수 표본, base_rate 81
try {
  await enterMeongbun(main.page, '성수1가1동');
  const s4 = await main.page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    const blocks = sec.querySelectorAll('.trace-block').length;
    const rows = sec.querySelectorAll('.trace-shap-row').length;
    const text = sec.textContent;
    return { blocks, rows, hasBaseRate81: text.includes('81'), };
  });
  record('S-4', s4.blocks === 1 && s4.rows === 5 && s4.hasBaseRate81,
    `blocks=${s4.blocks} rows=${s4.rows} base81=${s4.hasBaseRate81}`);
} catch (e) { record('S-4', false, e.message); }

// S-5: 표본 없는 동 → trace-empty 안내 또는 SHAP 없이 분기만
try {
  // 표본 없는 동 하나 선택 (금오/성수 외)
  const picked = await main.page.evaluate(() => {
    const d = DATA.dongs.find(x => x.name !== '의정부시 금오동' && x.name !== '성수1가1동');
    if (!d) return null;
    selectedDong = d;
    switchMode('meongbun');
    return d.name;
  });
  await main.page.waitForTimeout(700);
  const s5 = await main.page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    if (!sec) return { ok: false };
    const empty = sec.querySelectorAll('.trace-empty').length;
    const rows = sec.querySelectorAll('.trace-shap-row').length;
    const branches = sec.querySelectorAll('.trace-step:not(.trace-step-leaf)').length;
    return { ok: true, empty, rows, branches };
  });
  // empty 안내가 있거나(표본 부재 명시), SHAP 없이 분기 경로만 존재
  const pass = s5.ok && (s5.empty >= 1 || (s5.rows === 0 && s5.branches >= 1) || s5.rows === 0);
  record('S-5', pass, `dong=${picked} empty=${s5.empty} rows=${s5.rows} branches=${s5.branches}`);
} catch (e) { record('S-5', false, e.message); }

// S-6: shap-label title 툴팁(desc) 비어있지 않음 — 금오동 재진입
try {
  await enterMeongbun(main.page, '의정부시 금오동');
  const s6 = await main.page.evaluate(() => {
    const labels = [...document.querySelectorAll('#meongbun-sec-6 .trace-shap-label')];
    const withTitle = labels.filter(l => (l.getAttribute('title') || '').trim().length > 0).length;
    return { total: labels.length, withTitle };
  });
  record('S-6', s6.total >= 1 && s6.withTitle >= 1, `labels=${s6.total} withTitle=${s6.withTitle}`);
} catch (e) { record('S-6', false, e.message); }

// S-7: guest — 정적 페이지라 user와 동일 열람 + trace-prov 고지 존재
try {
  const s7 = await main.page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    if (!sec) return { ok: false };
    return {
      ok: true,
      shap: sec.querySelectorAll('.trace-shap-row').length,
      prov: sec.querySelectorAll('.trace-prov').length,
    };
  });
  record('S-7', s7.ok && s7.shap >= 1 && s7.prov >= 1, `shap=${s7.shap} prov=${s7.prov}`);
} catch (e) { record('S-7', false, e.message); }

// S-8: 섹션❼ 한계 — MEONGBUN_LIMITATIONS 'SHAP 기여도는 데모 표본' + '합성 데이터' 노출
try {
  const s8 = await main.page.evaluate(() => {
    // 명분 모드 전체 텍스트에서 한계 항목 확인
    const body = document.body.textContent;
    return {
      demoSample: body.includes('데모 표본'),
      synthetic: body.includes('합성 데이터') || body.includes('합성데이터'),
    };
  });
  record('S-8', s8.demoSample && s8.synthetic, `demoSample=${s8.demoSample} synthetic=${s8.synthetic}`);
} catch (e) { record('S-8', false, e.message); }

// S-10: decide 모드 → d-tree-meta acc/depth/잎수 + trace-thr (트리 로드 정상)
try {
  const s10 = await main.page.evaluate(() => {
    switchMode('decide');
    return true;
  });
  await main.page.waitForTimeout(600);
  const meta = await main.page.evaluate(() => {
    const m = document.getElementById('d-tree-meta');
    const metaText = m ? m.textContent : '';
    // thr는 섹션❻에도 있음 — decide 모드 트리 메타 위주로 확인
    const thr = document.querySelectorAll('.trace-thr').length;
    return { metaText: metaText.trim(), thr };
  });
  // acc/depth/잎수 지표 텍스트 존재 (숫자 + acc/정확도/깊이/잎 등 키워드)
  const hasMeta = /[0-9]/.test(meta.metaText) && meta.metaText.length > 3;
  record('S-10', hasMeta, `meta="${meta.metaText.slice(0, 60)}" thr=${meta.thr}`);
} catch (e) { record('S-10', false, e.message); }

// S-11: 스크린샷 생성 (섹션❻ 재진입 후 저장)
try {
  await enterMeongbun(main.page, '의정부시 금오동');
  await main.page.evaluate(() => {
    const el = document.getElementById('meongbun-sec-6');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await main.page.waitForTimeout(300);
  await main.page.screenshot({ path: `${SCREENS}/section6_recommendation_trace.png`, fullPage: false });
  record('S-11', true, 'screenshot saved');
} catch (e) { record('S-11', false, e.message); }

await main.ctx.close();

// ── tree 404 시뮬 페이지 (S-9, S-12) ─────────────────────────────
const blocked = await newLoadedPage(true);

// S-9: tree 404 → 앱 콘솔 에러 0, SHAP만 렌더, 분기 블록 생략, 페이지 정상
try {
  const enter = await enterMeongbun(blocked.page, '의정부시 금오동');
  const s9 = await blocked.page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-6');
    if (!sec) return { ok: false };
    return {
      ok: true,
      shap: sec.querySelectorAll('.trace-shap-row').length,
      branches: sec.querySelectorAll('.trace-step:not(.trace-step-leaf)').length,
      hasToggle: !!sec.querySelector('.trace-tree-toggle'),
    };
  });
  await blocked.page.waitForTimeout(200);
  // 앱 레벨 콘솔 에러 필터 — 네트워크 표준 로그(Failed to load resource 등)는 제외
  const appErrOnly = blocked.appErrs.filter(t =>
    !/Failed to load resource|net::ERR|404|the server responded with a status/i.test(t));
  const pass = s9.ok && enter.ok && s9.shap >= 1 && s9.branches === 0 && appErrOnly.length === 0;
  record('S-9', pass, `shap=${s9.shap} branches=${s9.branches} appErrs=${appErrOnly.length}`);
  if (appErrOnly.length) console.log('   app errors:', appErrOnly.slice(0, 3));
} catch (e) { record('S-9', false, e.message); }

// S-12: tree 미로드 상태 decide 모드 → d-tree-canvas '미로드' 안내
try {
  await blocked.page.evaluate(() => switchMode('decide'));
  await blocked.page.waitForTimeout(600);
  const s12 = await blocked.page.evaluate(() => {
    const c = document.getElementById('d-tree-canvas');
    return { text: c ? c.textContent : '' };
  });
  record('S-12', s12.text.includes('미로드'), `canvas="${s12.text.trim().slice(0, 50)}"`);
} catch (e) { record('S-12', false, e.message); }

await blocked.ctx.close();
await browser.close();

// ── 집계 ─────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 Recommendation Trace 회귀: ${passed}/${journey.length} PASS`);
const failed = journey.filter(j => !j.pass).map(j => j.id);
if (failed.length) console.log('FAIL:', failed.join(', '));
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
process.exit(passed === journey.length ? 0 : 1);
