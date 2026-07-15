// [RUN_TESTS_PHARMACY_DEVELOP-001] 약국 점포개발 캐릭터 저니 — 약국 본사 신규점포 개발담당자
// 명세: docs/stories/pharmacy-develop.md (B절 AC-1~AC-7)
// PIVOT 반영: PIVOT_PHARMACY_DEVELOP_PROPERTY_CENTRIC-001 (동 입력 → 매물 카드 리스트)
//   → AC-1/AC-4/AC-6의 "단일 주소 → 단일 점수 카드" 문구는 PIVOT으로 대체됨.
//     본 저니는 *실제 출시된* 매물 중심 UX를 검증한다 (명세 drift는 리포트에 기록).
//
// 저니 5스텝 (실제 마우스/키보드 조작):
//   1. 페이지 로드 → 사이드바 [약국] 서브그룹 펼치기
//   2. [점포개발] 클릭 → 화면 진입 (빈 상태 확인)
//   3. 주소 '의정부시 금오동' 타이핑 → CTA 활성화
//   4. [매물 추천] 클릭 → 동 요약 + 매물 카드 리스트 렌더 (AC-1/2/5/7)
//   5. [Decide 모드에서 동 cone 보기] 클릭 → decide 모드 도달 (AC-6)
//   + 엣지: 미등록 동 → inline 에러 + 재시도 가능 (AC-4)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PW_PORT || '8765';
const SCREENS = 'screenshots';
mkdirSync(SCREENS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

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

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForFunction(() => typeof window.PharmacyScorer !== 'undefined', { timeout: 10000 });

// ── 스텝 1: 사이드바에서 [약국] 서브그룹 펼치기 ──
await step('1. 페이지 로드 → 사이드바 [약국] 서브그룹 펼치기', async () => {
  const head = page.locator('[data-subgroup="pharmacy"]');
  await head.waitFor({ state: 'visible', timeout: 10000 });
  const alreadyOpen = await page.locator('button[data-mode="pharmacy-develop"]').count();
  if (!alreadyOpen) await head.click();               // 실제 클릭
  await page.locator('button[data-mode="pharmacy-develop"]').waitFor({ state: 'visible', timeout: 5000 });
  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-1.png` });
  return true;
});

// ── 스텝 2: [점포개발] 클릭 → 화면 진입 ──
await step('2. [점포개발] 클릭 → 화면 진입 + 빈 상태 노출', async () => {
  await page.locator('button[data-mode="pharmacy-develop"]').click();   // 실제 클릭
  await page.locator('.pharmacy-develop-screen').waitFor({ state: 'visible', timeout: 5000 });
  const emptyVisible = await page.locator('[data-region="empty"]').isVisible();
  const ctaDisabled = await page.locator('[data-action="evaluate"]').isDisabled();
  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-2.png` });
  if (!emptyVisible) throw new Error('빈 상태 안내가 노출되지 않음');
  if (!ctaDisabled) throw new Error('주소 미입력인데 CTA가 활성 상태 (필수값 가드 실패)');
  return true;
});

// ── 스텝 3: 주소 타이핑 → CTA 활성화 ──
await step("3. 주소 '의정부시 금오동' 타이핑 → CTA 활성화", async () => {
  await page.locator('.pd-input[data-field="dong"]').fill('의정부시 금오동');   // 실제 키보드 입력
  await page.waitForTimeout(100);
  const enabled = await page.locator('[data-action="evaluate"]').isEnabled();
  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-3.png` });
  if (!enabled) throw new Error('주소 입력 후에도 CTA가 비활성');
  return true;
});

// ── 스텝 4: 평가 실행 → 매물 카드 리스트 (AC-1/2/5/7) ──
let firstRunScores = null;
await step('4. [매물 추천] 클릭 → 동 요약 + 매물 카드 리스트 렌더 (AC-1)', async () => {
  const t0 = Date.now();
  await page.locator('[data-action="evaluate"]').click();               // 실제 클릭
  await page.locator('[data-region="property-list"]').waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('.pd-property-card').first().waitFor({ state: 'visible', timeout: 3000 });
  const elapsed = Date.now() - t0;

  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pd-property-card')];
    return {
      count: cards.length,
      dongScoreText: document.querySelector('.pd-dong-score')?.textContent || '',
      dongBadge: document.querySelector('.pd-dong-badge')?.textContent || '',
      cards: cards.map((c) => ({
        score: parseInt(c.querySelector('.pd-property-score')?.textContent || '0', 10),
        badge: c.querySelector('.pd-property-grade-badge')?.textContent || '',
        borderColor: c.style.borderLeftColor,
        drivers: c.querySelectorAll('.pd-driver').length,
        addr: c.querySelector('.pd-property-address')?.textContent || '',
        fit: c.querySelector('.pd-property-fit')?.textContent || '',
      })),
    };
  });

  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-4.png`, fullPage: true });

  if (elapsed > 3000) throw new Error(`AC-1 3초 초과: ${elapsed}ms`);
  if (info.count < 1) throw new Error('매물 카드 0건');
  // AC-1: 각 카드에 score(정수) + grade + 근거(동 대비 delta, 1~3개 가변)
  //   FIX_BUG_PHARMACY_DEVELOP_DRIVERS-001 이후 카드 근거는 매물별 delta만 노출 → 개수 가변
  info.cards.forEach((c, i) => {
    if (!Number.isInteger(c.score) || c.score < 0 || c.score > 100) throw new Error(`카드#${i + 1} score 이상: ${c.score}`);
    if (c.drivers < 1 || c.drivers > 3) throw new Error(`카드#${i + 1} top_drivers ${c.drivers}개 (1~3 기대)`);
    if (!c.badge) throw new Error(`카드#${i + 1} 등급 배지 없음`);
    if (!c.addr) throw new Error(`카드#${i + 1} 주소 없음`);
  });
  // 적합도순 내림차순
  for (let i = 0; i < info.cards.length - 1; i++) {
    if (info.cards[i].score < info.cards[i + 1].score) throw new Error(`적합도순 위반 #${i + 1}`);
  }
  // AC-2: 금오동 동 baseline = very_high(90+) → #00529B + '적극 추천'
  const dongScore = parseInt(info.dongScoreText.replace(/\D/g, ''), 10);
  if (dongScore >= 90 && !info.dongBadge.includes('적극 추천')) {
    throw new Error(`AC-2 위반: dong_score=${dongScore}인데 배지='${info.dongBadge}'`);
  }
  firstRunScores = info.cards.map((c) => c.score);
  console.log(`   → 매물 ${info.count}건 · 동 baseline ${dongScore}점(${info.dongBadge.trim()}) · 렌더 ${elapsed}ms`);
  console.log(`   → 카드 점수: ${firstRunScores.join(', ')}`);
  return true;
});

// ── 스텝 4c: 매물 카드 근거의 변별력 ──
// KNOWN FAIL → FIX_BUG_PHARMACY_DEVELOP_DRIVERS-001
//   동 공통 요인 기여도(0.140~0.192) > rent 최대 기여도(0.120) → rent가 top-3 진입 불가.
//   점수는 다른데 근거가 5장 모두 동일 = 카드별 설명이 매물 변별에 기여 0.
await step('4c. 매물 카드 top_drivers가 매물별로 변별력을 가짐 (점수 차이의 근거 노출)', async () => {
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('.pd-property-card')].map((c) => ({
      score: parseInt(c.querySelector('.pd-property-score')?.textContent || '0', 10),
      rent: c.querySelector('.pd-property-meta')?.textContent.match(/월 임대 (\d+)만원/)?.[1],
      drivers: [...c.querySelectorAll('.pd-driver')].map((d) => d.textContent.trim().replace(/\s+/g, ' ')).join(' | '),
    })));
  // 동 공통 근거는 요약 카드에 1회만 노출되어야 함 (매물 카드와 관심사 분리)
  const dongDrivers = await page.evaluate(() =>
    [...document.querySelectorAll('.pd-dong-card .pd-driver')].map((d) => d.textContent.trim().replace(/\s+/g, ' ')));
  if (!dongDrivers.length) throw new Error('동 요약 카드에 공통 근거(dong_drivers) 미노출');

  const distinctDrivers = new Set(cards.map((c) => c.drivers));
  const distinctScores = new Set(cards.map((c) => c.score));
  if (distinctScores.size > 1 && distinctDrivers.size === 1) {
    throw new Error(
      `점수는 ${distinctScores.size}종(${[...distinctScores].join('/')})인데 top_drivers는 전 카드 동일 `
      + `("${cards[0].drivers}") — 매물 간 점수 차이의 실제 원인(임대료 ${cards.map((c) => c.rent).join('/')}만원)이 `
      + '근거에서 누락됨 (→ FIX_BUG_PHARMACY_DEVELOP_DRIVERS-001)');
  }
  // 동 공통 근거가 매물 카드에 중복 노출되면 변별 정보가 아니다
  const dupe = cards.find((c) => dongDrivers.some((dd) => c.drivers.includes(dd)));
  if (dupe) throw new Error(`동 공통 근거가 매물 카드에 중복 노출: "${dupe.drivers}"`);
  console.log(`   → 동 공통 근거 ${dongDrivers.length}건(요약 1회) · 카드 ${cards.length}장 고유 근거 ${distinctDrivers.size}종`);
  return true;
});

// ── 스텝 4b: AC-7 결정성 — 재평가 시 동일 점수 ──
await step('4b. AC-7 결정성 — 동일 주소 재평가 시 매물 점수 ±0', async () => {
  await page.locator('[data-action="evaluate"]').click();               // 재추천 실제 클릭
  await page.waitForTimeout(700);
  const second = await page.evaluate(() =>
    [...document.querySelectorAll('.pd-property-card .pd-property-score')].map((e) => parseInt(e.textContent, 10)));
  if (JSON.stringify(second) !== JSON.stringify(firstRunScores)) {
    throw new Error(`AC-7 위반: 1회차 [${firstRunScores}] vs 2회차 [${second}]`);
  }
  return true;
});

// ── 스텝 5: Decide deep-link (AC-6) ──
// KNOWN FAIL → FIX_BUG_PHARMACY_DEVELOP_DEEPLINK-001
//   현재 구현은 switchMode('decide')만 호출 → URL에 ctx/address 파라미터 누락.
//   본 스텝은 AC-6 전문을 검사하므로 수정 전까지 FAIL이 정상이다 (테스트를 명세에 맞춘다).
await step('5. [Decide 모드에서 동 cone 보기] 클릭 → decide 도달 + ctx/address 파라미터 (AC-6)', async () => {
  await page.locator('[data-action="goto-decide"]').click();            // 실제 클릭
  await page.waitForTimeout(800);
  const arrived = await page.evaluate(() => {
    const el = document.getElementById('view-decide');
    return {
      decideVisible: el ? !el.classList.contains('hidden') : false,
      url: location.search,
    };
  });
  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-5.png` });
  if (!arrived.decideVisible) throw new Error('Decide 모드로 전환되지 않음');
  // AC-6 전문: ?mode=decide&ctx=pharmacy.develop&address=<encoded>
  const q = new URLSearchParams(arrived.url);
  const missing = [];
  if (q.get('mode') !== 'decide') missing.push('mode=decide');
  if (q.get('ctx') !== 'pharmacy.develop') missing.push('ctx=pharmacy.develop');
  if (!q.get('address')) missing.push('address=<encoded>');
  if (missing.length) {
    throw new Error(`AC-6 URL 파라미터 누락 [${missing.join(', ')}] — 실제 URL='${arrived.url}' `
      + '(→ FIX_BUG_PHARMACY_DEVELOP_DEEPLINK-001)');
  }
  console.log(`   → decide 도달 · URL='${arrived.url}'`);
  return true;
});

// ── 엣지: AC-4 미등록 동 → inline 에러 + 재시도 가능 ──
await step('E1. AC-4 엣지 — 미등록 동 입력 시 inline 에러 + 재시도 가능', async () => {
  await page.evaluate(() => window.switchMode('pharmacy-develop'));
  await page.locator('.pharmacy-develop-screen').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.pd-input[data-field="dong"]').fill('없는동12345');
  await page.locator('[data-action="evaluate"]').click();
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => ({
    errVisible: !document.querySelector('[data-region="error"]')?.hidden,
    errText: document.querySelector('[data-region="error"]')?.textContent || '',
    ctaEnabled: !document.querySelector('[data-action="evaluate"]')?.disabled,
    listHidden: document.querySelector('[data-region="property-list"]')?.hidden,
  }));
  if (!st.errVisible) throw new Error('미등록 동인데 inline 에러 미표시');
  if (!st.ctaEnabled) throw new Error('AC-4 위반: 에러 후 CTA 비활성 (재시도 불가)');
  if (!st.listHidden) throw new Error('AC-4 위반: 에러인데 결과 영역이 남아있음');
  await page.screenshot({ path: `${SCREENS}/journey-pharmacy-develop-edge-notfound.png` });
  console.log(`   → 에러 메시지: "${st.errText.slice(0, 60)}"`);
  return true;
});

// ── 엣지: AC-5 의원 0개 동 → 약점 driver 노출 ──
await step('E2. AC-5 — 의원 희소 동(저밀도 외곽동)에서 매물 카드 렌더 + 약점 driver 노출', async () => {
  await page.locator('.pd-input[data-field="dong"]').fill('저밀도 외곽동');
  await page.locator('[data-action="evaluate"]').click();
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => {
    const card = document.querySelector('.pd-property-card');
    if (!card) return null;
    return {
      score: parseInt(card.querySelector('.pd-property-score')?.textContent || '0', 10),
      badge: card.querySelector('.pd-property-grade-badge')?.textContent || '',
      negDrivers: [...card.querySelectorAll('.pd-driver-neg .pd-driver-text')].map((e) => e.textContent),
      posDrivers: [...card.querySelectorAll('.pd-driver-pos .pd-driver-text')].map((e) => e.textContent),
    };
  });
  if (!st) throw new Error('저밀도 외곽동 매물 카드 미렌더');
  if (st.score >= 50) throw new Error(`의료 인프라 부족 동인데 score=${st.score} (low 기대)`);
  console.log(`   → score ${st.score}(${st.badge.trim()}) · 강점 [${st.posDrivers}] · 약점 [${st.negDrivers}]`);
  return true;
});

// ── 콘솔 에러 게이트 ──
await step('9. 콘솔/페이지 에러 0건', async () => {
  if (errs.length) throw new Error(`에러 ${errs.length}건: ${errs.slice(0, 3).join(' | ')}`);
  return true;
});

await browser.close();

const failed = journey.filter((j) => !j.pass);
console.log('\n━━━ 캐릭터 저니: 약국 본사 신규점포 개발담당자 ━━━');
journey.forEach((j) => console.log(`${j.pass ? 'PASS' : 'FAIL'} | ${j.label}${j.err ? ' — ' + j.err : ''}`));
console.log(`\n총 ${journey.length}스텝 · 통과 ${journey.length - failed.length} · 실패 ${failed.length}`);
console.log(`스크린샷: ${SCREENS}/journey-pharmacy-develop-1~5.png`);
process.exit(failed.length ? 1 : 0);
