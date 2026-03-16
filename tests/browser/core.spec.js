const { test, expect } = require("@playwright/test");

test.describe("Core features", () => {
  test("xh-trigger=load fires automatically", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.waitForSelector(".focus-loaded", { timeout: 5000 });
    expect(await page.locator(".focus-loaded").textContent()).toBe("loaded");
  });

  test("xh-focus focuses element after swap", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.waitForSelector("#focus-input", { timeout: 5000 });
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    expect(focused).toBe("focus-input");
  });

  test("xh-push-url updates browser URL", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.click("#history-btn");
    await page.waitForSelector(".history-name", { timeout: 5000 });
    expect(page.url()).toContain("/user/1");
    expect(await page.locator(".history-name").textContent()).toBe("Alice");
  });

  test("form submit with xh-post sends data and renders result", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.click("#submit-btn");
    await page.waitForSelector(".form-created", { timeout: 5000 });
    const text = await page.locator(".form-created").textContent();
    expect(text).toContain("TestUser");
  });

  test("settle classes are applied after swap", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.click("#settle-btn");
    await page.waitForSelector(".settle-item", { timeout: 5000 });
    // After settling (two rAF cycles), xh-settled should be present
    await page.waitForTimeout(200);
    const hasSettled = await page.locator(".settle-item").first().evaluate(el => el.classList.contains("xh-settled"));
    expect(hasSettled).toBe(true);
  });

  test("MutationObserver processes dynamically added elements", async ({ page }) => {
    await page.goto("/test/core.html");
    await page.evaluate(() => {
      const container = document.getElementById("mutation-container");
      const div = document.createElement("div");
      div.id = "dynamic-widget";
      div.setAttribute("xh-get", "/api/poll");
      div.setAttribute("xh-trigger", "load");
      div.setAttribute("xh-target", "#dynamic-result");
      div.innerHTML = '<template><span class="dynamic-loaded" xh-text="timestamp"></span></template>';
      const result = document.createElement("div");
      result.id = "dynamic-result";
      container.appendChild(div);
      container.appendChild(result);
    });
    await page.waitForSelector(".dynamic-loaded", { timeout: 5000 });
    const text = await page.locator(".dynamic-loaded").textContent();
    expect(text.length).toBeGreaterThan(0);
  });
});
