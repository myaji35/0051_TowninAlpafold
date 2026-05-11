// utils/verify-harness.mjs
// Playwright 검증 공통 헬퍼 — bootstrap / step / assertNoConsoleErrors / screenshotJourney
// 부모 이슈: ISS-095 (REFACTOR — Eng 리뷰 권고)
//
// 사용 예:
//   import { bootstrapPage, step, assertNoConsoleErrors, screenshotJourney } from './utils/verify-harness.mjs';
//   const { page, browser, errors } = await bootstrapPage('http://localhost:3051');
//   await step(page, '폼 입력', async () => { await page.fill('[data-field="address"]', '의정부시 금오동'); });
//   await screenshotJourney(page, '/tmp/journey-pharmacy-develop', 1);
//   assertNoConsoleErrors(errors);

import { chromium } from 'playwright';

const DEFAULT_TIMEOUT = 15000;

/**
 * 페이지 부팅 + 콘솔/네트워크 에러 수집.
 * @param {string} url
 * @param {object} [opts] - { headless: true, viewport: {width, height}, timeout }
 * @returns {Promise<{browser, context, page, errors, networkErrors}>}
 */
export async function bootstrapPage(url, opts) {
  const o = opts || {};
  const browser = await chromium.launch({ headless: o.headless !== false });
  const context = await browser.newContext({
    viewport: o.viewport || { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const networkErrors = [];
  page.on('pageerror', (e) => errors.push({ type: 'pageerror', message: e.message }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push({ type: 'console-error', message: msg.text() });
  });
  page.on('requestfailed', (req) => {
    networkErrors.push({ url: req.url(), failure: req.failure()?.errorText });
  });
  await page.goto(url, { timeout: o.timeout || DEFAULT_TIMEOUT, waitUntil: 'networkidle' });
  return { browser, context, page, errors, networkErrors };
}

/**
 * 명명된 스텝 실행 — 로그 + 시간 측정 + 실패 시 스크린샷.
 * @param {object} page - playwright page
 * @param {string} label - 스텝 이름
 * @param {Function} fn - async () => ...
 * @returns {Promise<*>}
 */
export async function step(page, label, fn) {
  const start = Date.now();
  process.stdout.write(`  → ${label} ... `);
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(`OK (${elapsed}ms)`);
    return result;
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    // 실패 시 스크린샷 자동 캡처
    try {
      const safeLabel = label.replace(/[^a-zA-Z0-9가-힣]/g, '_').slice(0, 40);
      await page.screenshot({ path: `/tmp/verify-fail-${safeLabel}.png`, fullPage: true });
      console.log(`  스크린샷: /tmp/verify-fail-${safeLabel}.png`);
    } catch {}
    throw e;
  }
}

/**
 * 콘솔 에러가 없는지 단언. 있으면 throw.
 * @param {Array} errors - bootstrapPage 결과의 errors 배열
 * @param {object} [opts] - { ignore: ['regex string'] }
 */
export function assertNoConsoleErrors(errors, opts) {
  const o = opts || {};
  const ignorePatterns = (o.ignore || []).map(p => new RegExp(p));
  const filtered = errors.filter(e => !ignorePatterns.some(re => re.test(e.message)));
  if (filtered.length > 0) {
    const summary = filtered.map(e => `[${e.type}] ${e.message}`).join('\n  ');
    throw new Error(`콘솔 에러 ${filtered.length}건:\n  ${summary}`);
  }
}

/**
 * 캐릭터 저니 스텝별 스크린샷 — 자동 번호.
 * @param {object} page
 * @param {string} pathPrefix - 예: '/tmp/journey-pharmacy-develop'
 * @param {number} stepNum - 1-based
 * @param {object} [opts] - { fullPage: true }
 */
export async function screenshotJourney(page, pathPrefix, stepNum, opts) {
  const o = opts || {};
  const path = `${pathPrefix}-${stepNum}.png`;
  await page.screenshot({ path, fullPage: o.fullPage !== false });
  return path;
}

/**
 * 정적 서버 살아있는지 ping.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 검증 스위트 마무리 — 결과 출력 + browser close.
 * @param {object} ctx - { browser, page, errors, networkErrors }
 * @param {object} [summary] - 요약 데이터
 */
export async function teardown(ctx, summary) {
  if (summary) {
    console.log('\n=== 검증 요약 ===');
    console.log(JSON.stringify(summary, null, 2));
  }
  if (ctx.networkErrors && ctx.networkErrors.length > 0) {
    console.log(`\n네트워크 에러 ${ctx.networkErrors.length}건:`);
    ctx.networkErrors.forEach(e => console.log(`  - ${e.url}: ${e.failure}`));
  }
  if (ctx.browser) await ctx.browser.close();
}
