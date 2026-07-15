// [UI_LIMITATION_FALSIFY-001] 섹션❼ 한계 + 반증 + 부록 캐릭터 저니 — 결정자(명분 리포트 열람자)
// 시나리오:
//   (1) 금오동 선택 → meongbun 모드 진입
//   (2) 섹션❼ 한계 7항목 렌더 + 태그(DATA/PROXY/MODEL/SCOPE/CAUSAL) 확인
//   (3) 한계 목록 접기 토글 실제 클릭 → hidden 전환 → 재클릭 복원
//   (4) 반증 4조건 6mo/12mo 타임라인 배치 확인
//   (5) 부록 3종 링크 href 유효성 확인
//   (6) 스크린샷 저장
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

await step('2. 한계 7항목 + 태그 렌더', async () => {
  const lim = await page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-7');
    if (!sec) return { exists: false };
    const items = sec.querySelectorAll('.limit-item');
    const tags = [...sec.querySelectorAll('.limit-tag')].map(e => e.textContent);
    const phHidden = (sec.querySelector('.meongbun-placeholder') || {}).style?.display === 'none';
    return { exists: true, items: items.length, tags: [...new Set(tags)], phHidden };
  });
  console.log('   limitations:', lim);
  return lim.exists && lim.items === 7 && lim.tags.length >= 3 && lim.phHidden;
});

await step('3. 한계 목록 접기 토글 실제 클릭 → 복원', async () => {
  await page.evaluate(() => {
    const el = document.querySelector('#meongbun-sec-7 .limit-toggle');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => !document.querySelector('#meongbun-sec-7 .limit-list').hidden);
  await page.click('#meongbun-sec-7 .limit-toggle');
  await page.waitForTimeout(250);
  const collapsed = await page.evaluate(() => ({
    hidden: document.querySelector('#meongbun-sec-7 .limit-list').hidden,
    aria: document.querySelector('#meongbun-sec-7 .limit-toggle').getAttribute('aria-expanded'),
  }));
  await page.click('#meongbun-sec-7 .limit-toggle');
  await page.waitForTimeout(250);
  const restored = await page.evaluate(() => !document.querySelector('#meongbun-sec-7 .limit-list').hidden);
  console.log('   toggle:', { before, collapsed, restored });
  return before === true && collapsed.hidden === true && collapsed.aria === 'false' && restored === true;
});

await step('4. 반증 4조건 6mo/12mo 타임라인 배치', async () => {
  const fal = await page.evaluate(() => {
    const sec = document.getElementById('meongbun-sec-7');
    const ms = sec.querySelectorAll('.falsify-milestone');
    const cards = sec.querySelectorAll('.falsify-card');
    const labels = [...sec.querySelectorAll('.falsify-node-label')].map(e => e.textContent.trim());
    const perMilestone = [...ms].map(m => m.querySelectorAll('.falsify-card').length);
    return { milestones: ms.length, cards: cards.length, labels, perMilestone };
  });
  console.log('   falsify:', fal);
  return fal.milestones === 2 && fal.cards === 4
    && fal.labels.includes('6개월 후') && fal.labels.includes('12개월 후')
    && fal.perMilestone.every(n => n === 2);
});

await step('5. 부록 3종 링크 href 유효', async () => {
  const apx = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#meongbun-sec-7 .appendix-card')];
    return cards.map(c => ({ href: c.getAttribute('href'), target: c.getAttribute('target'), title: (c.querySelector('.appendix-title') || {}).textContent }));
  });
  console.log('   appendix:', apx);
  return apx.length === 3 && apx.every(a => a.href && a.href.length > 3 && a.target === '_blank');
});

await step('6. 스크린샷 저장', async () => {
  await page.evaluate(() => {
    const el = document.getElementById('meongbun-sec-7');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENS}/section7_limitation_falsify.png`, fullPage: false });
  return true;
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const passed = journey.filter(j => j.pass).length;
console.log(`📊 섹션❼ 한계·반증·부록 저니: ${passed}/${journey.length} PASS`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (errs.length) console.log('console errors:', errs.slice(0, 5));
await browser.close();
process.exit(passed === journey.length ? 0 : 1);
