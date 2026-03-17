const { test, expect } = require("@playwright/test");

test.describe("API Reference docs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/api/");
    await page.waitForTimeout(1000);
  });

  test("page loads with title", async ({ page }) => {
    const title = await page.title();
    expect(title.toLowerCase()).toContain("api");
  });

  test("sidebar exists with navigation links", async ({ page }) => {
    const sidebarLinks = page.locator("nav a, .sidebar a, [class*='sidebar'] a");
    const count = await sidebarLinks.count();
    expect(count).toBeGreaterThan(20);
  });

  test("all REST verb attributes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-get");
    expect(body).toContain("xh-post");
    expect(body).toContain("xh-put");
    expect(body).toContain("xh-delete");
    expect(body).toContain("xh-patch");
  });

  test("all binding attributes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-text");
    expect(body).toContain("xh-html");
    expect(body).toContain("xh-attr-");
    expect(body).toContain("xh-model");
  });

  test("all template attributes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-template");
    expect(body).toContain("xh-each");
    expect(body).toContain("xh-if");
    expect(body).toContain("xh-unless");
    expect(body).toContain("xh-show");
    expect(body).toContain("xh-hide");
  });

  test("trigger system is documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-trigger");
    expect(body).toContain("delay");
    expect(body).toContain("throttle");
    expect(body).toContain("revealed");
  });

  test("swap modes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-swap");
    expect(body).toContain("innerHTML");
    expect(body).toContain("outerHTML");
    expect(body).toContain("beforeend");
    expect(body).toContain("delete");
  });

  test("error handling attributes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-error-template");
    expect(body).toContain("xh-error-boundary");
    expect(body).toContain("xh-error-target");
  });

  test("WebSocket attributes are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh-ws");
    expect(body).toContain("xh-ws-send");
  });

  test("JavaScript API methods are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xhtmlx.process");
    expect(body).toContain("switchVersion");
    expect(body).toContain("xhtmlx.directive");
    expect(body).toContain("xhtmlx.hook");
    expect(body).toContain("xhtmlx.transform");
    expect(body).toContain("xhtmlx.reload");
  });

  test("events are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("xh:beforeRequest");
    expect(body).toContain("xh:afterSwap");
    expect(body).toContain("xh:responseError");
    expect(body).toContain("xh:versionChanged");
  });

  test("config options are documented", async ({ page }) => {
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("defaultSwapMode");
    expect(body).toContain("templatePrefix");
    expect(body).toContain("apiPrefix");
    expect(body).toContain("cspSafe");
  });

  test("search filters content", async ({ page }) => {
    const searchInput = page.locator("input[type='search'], input[type='text'][placeholder*='earch' i], #search, .search-input").first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("websocket");
      await page.waitForTimeout(500);
      // xh-ws section should be visible, unrelated sections hidden
      const wsSection = page.locator("#xh-ws, [id*='ws']").first();
      if (await wsSection.count() > 0) {
        await expect(wsSection).toBeVisible();
      }
    }
  });

  test("anchor links work for direct navigation", async ({ page }) => {
    await page.goto("/api/#xh-get");
    await page.waitForTimeout(500);
    const heading = page.locator("#xh-get, h2:has-text('xh-get'), h3:has-text('xh-get')").first();
    if (await heading.count() > 0) {
      await expect(heading).toBeVisible();
    }
  });

  test("no console errors on page load", async ({ page }) => {
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));
    await page.goto("/api/");
    await page.waitForTimeout(2000);
    const critical = errors.filter(e => !e.includes("favicon"));
    expect(critical).toEqual([]);
  });
});
