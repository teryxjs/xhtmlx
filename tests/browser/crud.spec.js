const { test, expect } = require("@playwright/test");

// CRUD tests must run serially because they share server state
test.describe.configure({ mode: "serial" });

test.describe("CRUD App", () => {
  test.beforeEach(async ({ page }) => {
    // Reset server data: navigate to page first, then reset, then reload
    await page.goto("/test/crud.html");
    await page.evaluate(() => fetch("/api/__reset"));
    await page.reload();
    await page.waitForSelector(".user-row", { timeout: 5000 });
  });

  test("loads initial user list", async ({ page }) => {
    const count = await page.locator(".user-row").count();
    expect(count).toBe(3);
    expect(await page.locator(".user-name").first().textContent()).toBe("Alice");
  });

  test("create user appends to list", async ({ page }) => {
    await page.fill("#new-name", "Dave");
    await page.fill("#new-email", "dave@test.com");
    await page.click("#create-btn");
    await page.waitForSelector(".created-user", { timeout: 5000 });
    const names = await page.locator(".user-name").allTextContents();
    expect(names).toContain("Dave");
  });

  test("delete user and reload shows Bob removed", async ({ page }) => {
    // Verify Bob exists initially
    const namesBefore = await page.locator(".user-name").allTextContents();
    expect(namesBefore).toContain("Bob");

    // Delete Bob (user 2) and wait for the request
    await page.click("#delete-btn");
    await page.waitForTimeout(500);

    // Reload the list
    await page.click("#reload-btn");
    await page.waitForTimeout(1000);

    // Verify Bob is gone
    const namesAfter = await page.locator(".user-name").allTextContents();
    expect(namesAfter).not.toContain("Bob");
  });

  test("promote user updates role", async ({ page }) => {
    await page.click("#promote-btn");
    await page.waitForSelector(".promoted-user", { timeout: 5000 });
    const role = await page.locator(".promoted-role").textContent();
    expect(role).toBe("admin");
  });
});
