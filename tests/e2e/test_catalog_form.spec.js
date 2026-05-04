/**
 * tests/e2e/test_catalog_form.spec.js
 * 카탈로그 폼 E2E 테스트 — 스켈레톤.
 *
 * UI (데이터셋 등록 폼) 가 구현되면 test.skip() 제거 후 활성화.
 * 추적 이슈: ISS-CATALOG_UI
 *
 * 활성화 체크리스트:
 *   [ ] frontend 데이터셋 등록 폼 라우트 확정 (예: /datasets/new)
 *   [ ] Playwright 설치: npm install -D @playwright/test && npx playwright install
 *   [ ] BASE_URL 환경변수 또는 playwright.config.js 설정
 */

const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

test.describe("카탈로그 폼 E2E", () => {
  test.skip("UI pending: ISS-CATALOG_UI 해결 후 활성화");

  test("데이터셋 등록 폼이 렌더된다", async ({ page }) => {
    await page.goto(`${BASE_URL}/datasets/new`);
    await expect(page.locator("h1")).toContainText("데이터셋");
  });

  test("필수 필드 누락 시 유효성 오류를 표시한다", async ({ page }) => {
    await page.goto(`${BASE_URL}/datasets/new`);
    await page.click('button[type="submit"]');
    await expect(page.locator("[data-testid='error-name']")).toBeVisible();
  });

  test("유효한 데이터 제출 시 목록 페이지로 리다이렉트된다", async ({ page }) => {
    await page.goto(`${BASE_URL}/datasets/new`);
    await page.fill('input[name="name"]', "테스트 데이터셋");
    await page.fill('input[name="source"]', "공공데이터포털");
    await page.selectOption('select[name="category"]', "지역");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(`${BASE_URL}/datasets`);
  });

  test("카탈로그 목록에서 신규 항목이 조회된다", async ({ page }) => {
    await page.goto(`${BASE_URL}/datasets`);
    await expect(page.locator("text=테스트 데이터셋")).toBeVisible();
  });
});
