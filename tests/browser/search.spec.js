const { test, expect } = require("@playwright/test");

test.describe("Search with debounce", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/test/search.html");
  });

  test("no results shown initially", async ({ page }) => {
    const results = await page.locator(".search-result").count();
    expect(results).toBe(0);
  });

  test("typing triggers search after debounce", async ({ page }) => {
    await page.locator("#search-input").pressSequentially("Ali", { delay: 50 });
    // After debounce (300ms) + network
    await page.waitForSelector(".search-result", { timeout: 5000 });
    const names = await page.locator(".result-name").allTextContents();
    expect(names.length).toBeGreaterThan(0);
  });

  test("search results render with names and emails", async ({ page }) => {
    await page.locator("#search-input").pressSequentially("test", { delay: 50 });
    await page.waitForSelector(".search-result", { timeout: 5000 });
    const names = await page.locator(".result-name").allTextContents();
    const emails = await page.locator(".result-email").allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(emails.length).toBeGreaterThan(0);
  });

  test("search query is displayed", async ({ page }) => {
    await page.locator("#search-input").pressSequentially("test", { delay: 50 });
    await page.waitForSelector(".search-query", { timeout: 5000 });
    const query = await page.locator(".search-query").textContent();
    expect(query).toContain("Query:");
  });
});
