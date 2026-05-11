// Phase 1 GO 목업 전체 캡처 v2
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3051';
const OUT = path.resolve(__dirname, '..', 'screenshots');

const clickMode = async (page, mode) => {
  await page.click(`button[data-mode="${mode}"]`);
  await page.waitForTimeout(1500);
};

const SHOTS = [
  { name: 'phase1_01_gallery', mode: null, fullPage: true },
  { name: 'phase1_02_explore', mode: 'explore', fullPage: true },
  { name: 'phase1_03_analyze', mode: 'analyze', fullPage: true },
  { name: 'phase1_04_decide', mode: 'decide', fullPage: true },
  { name: 'phase1_05_data_studio', mode: 'datastudio', fullPage: true },
  { name: 'phase1_06_data_studio_datasets_tab', mode: 'datastudio', fullPage: true,
    extra: async (page) => {
      await page.click('button[data-ds="datasets"]');
      await page.waitForTimeout(1200);
    }},
  { name: 'phase1_07_register_modal', mode: 'datastudio', fullPage: true,
    extra: async (page) => {
      await page.click('button[data-ds="datasets"]');
      await page.waitForTimeout(800);
      await page.click('.ds-register-btn');
      await page.waitForTimeout(800);
    }},
  { name: 'phase1_08_workflow', mode: 'workflow', fullPage: true },
  { name: 'phase1_09_meongbun', mode: 'meongbun', fullPage: true },
  { name: 'phase1_10_pharmacy_develop', mode: 'pharmacy-develop', fullPage: true },
  { name: 'phase1_11_pharmacy_close', mode: 'pharmacy-close', fullPage: true },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text().slice(0, 200));
  });

  const results = [];
  for (const s of SHOTS) {
    try {
      await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      if (s.mode) await clickMode(page, s.mode);
      if (s.extra) await s.extra(page);
      const out = path.join(OUT, s.name + '.png');
      await page.screenshot({ path: out, fullPage: s.fullPage });
      results.push({ name: s.name, status: 'OK' });
      console.log(`OK ${s.name}`);
    } catch (e) {
      results.push({ name: s.name, status: 'FAIL', error: String(e).slice(0, 200) });
      console.error(`FAIL ${s.name}: ${e.message.slice(0, 150)}`);
    }
  }

  await browser.close();
  console.log('\n=== Summary ===');
  const ok = results.filter(r => r.status === 'OK').length;
  console.log(`${ok}/${results.length} captured`);
})();
