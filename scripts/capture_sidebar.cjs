// Sidebar 사이드바 캡처
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://localhost:3051';
const OUT = path.resolve(__dirname, '..', 'screenshots');

const SHOTS = [
  { name: 'phase17_sidebar_01_default', mode: null },
  { name: 'phase17_sidebar_02_pharmacy_expanded', mode: null,
    extra: async (page) => {
      // 약국이 기본 펼침 상태
      await page.waitForTimeout(500);
    }},
  { name: 'phase17_sidebar_03_pharmacy_develop', mode: 'pharmacy-develop' },
  { name: 'phase17_sidebar_04_data_studio_datasets', mode: 'datastudio',
    extra: async (page) => {
      await page.waitForTimeout(500);
      const tab = await page.$('button[data-ds="datasets"]').catch(() => null);
      if (tab) await tab.click();
      await page.waitForTimeout(800);
    }},
  { name: 'phase17_sidebar_05_collapsed', mode: null,
    extra: async (page) => {
      await page.click('.sb-toggle');
      await page.waitForTimeout(400);
    }},
  { name: 'phase17_sidebar_06_add_modal', mode: null,
    extra: async (page) => {
      await page.click('.sb-add-btn');
      await page.waitForTimeout(500);
    }},
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
      if (s.mode) {
        // 사이드바에서 모드 클릭
        await page.click(`.sb-item[data-mode="${s.mode}"]`).catch(async () => {
          // fallback: 기존 topnav (혹시 사이드바 미로드 시)
          await page.click(`button[data-mode="${s.mode}"]`);
        });
        await page.waitForTimeout(1000);
      }
      if (s.extra) await s.extra(page);
      const out = path.join(OUT, s.name + '.png');
      await page.screenshot({ path: out, fullPage: true });
      results.push({ name: s.name, status: 'OK' });
      console.log(`OK ${s.name}`);
    } catch (e) {
      results.push({ name: s.name, status: 'FAIL', error: e.message.slice(0, 200) });
      console.error(`FAIL ${s.name}: ${e.message.slice(0, 150)}`);
    }
  }
  await browser.close();
  console.log(`\n${results.filter(r => r.status === 'OK').length}/${results.length}`);
})();
