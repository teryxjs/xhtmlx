const { test, expect } = require("@playwright/test");

test.describe("Polling", () => {
  test("polling updates content periodically", async ({ page }) => {
    await page.goto("/test/polling.html");
    await page.waitForSelector(".poll-time", { timeout: 5000 });
    const first = await page.locator(".poll-time").textContent();
    // Wait for at least one more poll cycle (2s)
    await page.waitForTimeout(2500);
    const second = await page.locator(".poll-time").textContent();
    expect(second).not.toBe(first);
  });
});

test.describe("i18n", () => {
  test("initial locale renders correct translations", async ({ page }) => {
    await page.goto("/test/polling.html");
    await page.waitForTimeout(500);
    expect(await page.locator("#i18n-greeting").textContent()).toBe("Hello");
    expect(await page.locator("#i18n-farewell").textContent()).toBe("Goodbye");
  });

  test("switching locale updates all i18n elements", async ({ page }) => {
    await page.goto("/test/polling.html");
    await page.waitForTimeout(500);
    await page.evaluate(() => { xhtmlx.i18n.locale = "es"; });
    await page.waitForTimeout(200);
    expect(await page.locator("#i18n-greeting").textContent()).toBe("Hola");
    expect(await page.locator("#i18n-farewell").textContent()).toBe("Adiós");
  });

  test("switching back to original locale works", async ({ page }) => {
    await page.goto("/test/polling.html");
    await page.waitForTimeout(500);
    await page.evaluate(() => { xhtmlx.i18n.locale = "es"; });
    await page.waitForTimeout(200);
    await page.evaluate(() => { xhtmlx.i18n.locale = "en"; });
    await page.waitForTimeout(200);
    expect(await page.locator("#i18n-greeting").textContent()).toBe("Hello");
  });
});
