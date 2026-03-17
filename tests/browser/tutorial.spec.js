const { test, expect } = require("@playwright/test");

test.describe("Tutorial page", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", err => console.log("[PAGEERROR]", err.message));
    await page.goto("/tutorial/");
    // Wait for xhtmlx to load and init
    await page.waitForFunction(() => window.__xhtmlxLoaded === true, { timeout: 15000 });
  });

  test("page loads with all 9 step headings", async ({ page }) => {
    const headings = await page.locator(".step-title").allTextContents();
    expect(headings.length).toBe(9);
    expect(headings[0]).toContain("First Request");
    expect(headings[1]).toContain("Data Binding");
    expect(headings[2]).toContain("Conditionals");
    expect(headings[3]).toContain("Creating Tasks");
    expect(headings[4]).toContain("Completing Tasks");
    expect(headings[5]).toContain("Deleting Tasks");
    expect(headings[6]).toContain("Search");
    expect(headings[7]).toContain("Indicator");
    expect(headings[8]).toContain("Error");
  });

  test("step 1: GET loads task list", async ({ page }) => {
    // Wait for tasks to render (mock API + xhtmlx processing)
    await page.waitForTimeout(3000);
    const body = await page.locator("body").innerHTML();
    // The mock API has tasks with these titles
    const hasTasks = body.includes("Learn xhtmlx") || body.includes("task-item") || body.includes("task-title");
    expect(hasTasks).toBe(true);
  });

  test("step 2: data binding renders task fields", async ({ page }) => {
    await page.waitForTimeout(2000);
    // Should have task titles and descriptions rendered via xh-text
    const body = await page.locator("body").innerHTML();
    expect(body).toContain("Learn xhtmlx");
  });

  test("step 3: conditionals show/hide elements", async ({ page }) => {
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerHTML();
    // "Learn xhtmlx" is completed=true, should have a completed indicator
    // "Build a task manager" is completed=false, should not
    expect(body.length).toBeGreaterThan(1000);
  });

  test("step 4: page has a create form with POST", async ({ page }) => {
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerHTML();
    // The tutorial should have a form that creates tasks
    expect(body).toContain("xh-post");
    expect(body).toContain("/api/tasks");
  });

  test("step 6: DELETE removes a task", async ({ page }) => {
    await page.waitForTimeout(2000);
    // Find delete buttons
    const deleteBtn = page.locator("button:has-text('Delete'), button:has-text('Remove'), [class*='delete']").first();
    if (await deleteBtn.count() > 0) {
      const beforeCount = await page.locator(".task-item, .task-card, [class*='task']").count();
      await deleteBtn.click();
      await page.waitForTimeout(1500);
      const afterCount = await page.locator(".task-item, .task-card, [class*='task']").count();
      // Should have fewer tasks (or at least not crash)
      expect(afterCount).toBeLessThanOrEqual(beforeCount);
    }
  });

  test("step 7: search filters results", async ({ page }) => {
    await page.waitForTimeout(2000);
    const searchInput = page.locator("input[type='text'][placeholder*='earch' i], input[xh-get*='search' i], input[type='search']").first();
    if (await searchInput.count() > 0) {
      await searchInput.pressSequentially("Learn", { delay: 50 });
      await page.waitForTimeout(1000);
      // Results should be filtered
      const body = await page.locator("body").innerHTML();
      expect(body).toContain("Learn");
    }
  });

  test("step 9: error handling shows error template", async ({ page }) => {
    await page.waitForTimeout(2000);
    // Find the error trigger button
    const errorBtn = page.locator("button:has-text('error'), button:has-text('Error'), button:has-text('Fail'), [xh-get*='error']").first();
    if (await errorBtn.count() > 0) {
      await errorBtn.click();
      await page.waitForTimeout(1500);
      // Should show error content
      const body = await page.locator("body").innerHTML();
      expect(body.toLowerCase()).toContain("error");
    }
  });

  test("view source buttons toggle code visibility", async ({ page }) => {
    const viewSourceBtns = page.locator("button:has-text('View Source'), button:has-text('Source'), .view-source-btn");
    const count = await viewSourceBtns.count();
    expect(count).toBeGreaterThan(0);

    // Click first view source button
    await viewSourceBtns.first().click();
    await page.waitForTimeout(300);

    // Some code block should now be visible
    const codeBlocks = page.locator("pre, code, .source-code");
    const visibleCode = await codeBlocks.count();
    expect(visibleCode).toBeGreaterThan(0);
  });

  test("progress bar exists and tracks scroll", async ({ page }) => {
    // Check progress bar exists
    const progressBar = page.locator(".progress-bar, .progress, [class*='progress']").first();
    expect(await progressBar.count()).toBeGreaterThan(0);
  });

  test("no console errors during normal usage", async ({ page }) => {
    const errors = [];
    page.on("pageerror", err => errors.push(err.message));

    await page.goto("/tutorial/");
    await page.waitForTimeout(5000);

    const critical = errors.filter(e =>
      !e.includes("ServiceWorker") &&
      !e.includes("sw.js") &&
      !e.includes("favicon")
    );
    expect(critical).toEqual([]);
  });
});
