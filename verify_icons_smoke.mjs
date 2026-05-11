// verify_icons_smoke.mjs — Feather line icon 전환 검증 (임시 스모크 테스트)
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE_URL = 'http://localhost:3051';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });

// 1. 모드 버튼 SVG 개수 >= 7
const modeSvgCount = await page.evaluate(() => {
  return document.querySelectorAll('.mode-btn svg.feather-icon').length;
});

// 2. 갤러리 카드 SVG 개수 >= 12
const gallerySvgCount = await page.evaluate(() => {
  return document.querySelectorAll('#gallery-grid .theme-card svg.feather-icon').length;
});

// 3. 모드 버튼 텍스트에 이모지 없는지
const modeBtnTexts = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.mode-btn')).map(b => b.innerText.trim()).join(' ');
});
const emojiPattern = /[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
const headerHasEmoji = emojiPattern.test(modeBtnTexts);

// 스크린샷
await page.screenshot({ path: '/tmp/header-line-icons-after.png', fullPage: false });

await browser.close();

console.log('=== Feather Icon 전환 검증 ===');
console.log(`모드 버튼 SVG: ${modeSvgCount} (기대 ≥7) → ${modeSvgCount >= 7 ? 'PASS' : 'FAIL'}`);
console.log(`갤러리 카드 SVG: ${gallerySvgCount} (기대 ≥12) → ${gallerySvgCount >= 12 ? 'PASS' : 'FAIL'}`);
console.log(`헤더 이모지 없음: ${!headerHasEmoji ? 'PASS' : 'FAIL'} (이모지 감지: ${headerHasEmoji})`);
console.log('스크린샷: /tmp/header-line-icons-after.png');

const allPass = modeSvgCount >= 7 && gallerySvgCount >= 12 && !headerHasEmoji;
console.log(`\n전체: ${allPass ? 'ALL PASS' : 'FAIL'}`);
process.exit(allPass ? 0 : 1);
