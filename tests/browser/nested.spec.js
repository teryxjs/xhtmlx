const { test, expect } = require("@playwright/test");

test.describe("Nested data loading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/test/nested.html");
    await page.waitForSelector(".user-block", { timeout: 5000 });
  });

  test("users load on page load", async ({ page }) => {
    const count = await page.locator(".user-block").count();
    expect(count).toBeGreaterThan(0);
    expect(await page.locator(".nested-user-name").first().textContent()).toBe("Alice");
  });

  test("clicking load posts fetches second level", async ({ page }) => {
    await page.click("#load-posts-btn");
    await page.waitForSelector(".post-block", { timeout: 5000 });
    const titles = await page.locator(".nested-post-title").allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles[0]).toContain("Post");
  });

  test("clicking load comments fetches third level", async ({ page }) => {
    await page.click("#load-posts-btn");
    await page.waitForSelector(".post-block", { timeout: 5000 });
    await page.click("#load-comments-btn");
    await page.waitForSelector(".comment-block", { timeout: 5000 });
    const authors = await page.locator(".comment-author").allTextContents();
    expect(authors).toContain("Dave");
  });
});
