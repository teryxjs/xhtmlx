const { test, expect } = require("@playwright/test");

test.describe("Error handling", () => {
  test("404 error renders error template", async ({ page }) => {
    await page.goto("/test/errors.html");
    await page.waitForTimeout(500);
    await page.click("#trigger-404");
    await page.waitForSelector(".error-display", { timeout: 5000 });
    expect(await page.locator(".error-status").first().textContent()).toBe("404");
    expect(await page.locator(".error-message").first().textContent()).toBe("Resource not found");
  });

  test("500 error renders error template", async ({ page }) => {
    await page.goto("/test/errors.html");
    await page.waitForTimeout(500);
    await page.click("#trigger-500");
    await page.waitForSelector("#error-result .error-display", { timeout: 5000 });
    expect(await page.locator("#error-result .error-status").textContent()).toBe("500");
  });

  test("error boundary catches child widget errors", async ({ page }) => {
    await page.goto("/test/errors.html");
    // The inner div with xh-trigger="load" fires on load and gets a 500 error.
    // The error boundary should catch it and render into #boundary-errors.
    await page.waitForSelector("#boundary-errors .error-display", { timeout: 5000 });
    const status = await page.locator("#boundary-errors .error-status").textContent();
    expect(status).toBe("500");
  });

  test("recovery: successful request after error", async ({ page }) => {
    await page.goto("/test/errors.html");
    await page.waitForTimeout(500);
    await page.click("#trigger-404");
    await page.waitForSelector(".error-display", { timeout: 5000 });
    await page.click("#trigger-success");
    await page.waitForSelector(".recovery-user", { timeout: 5000 });
    const users = await page.locator(".recovery-user").allTextContents();
    expect(users).toContain("Alice");
  });

  test("xh-error CSS class is added on error", async ({ page }) => {
    await page.goto("/test/errors.html");
    await page.waitForTimeout(500);
    await page.click("#trigger-404");
    await page.waitForTimeout(1000);
    const hasClass = await page.locator("#trigger-404").evaluate(el => el.classList.contains("xh-error"));
    expect(hasClass).toBe(true);
  });
});
