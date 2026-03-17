/**
 * @jest-environment jsdom
 */
const fs = require("fs");
const path = require("path");

const tutorialPath = path.join(__dirname, "../../docs/tutorial/index.html");

describe("Tutorial page structure", () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(tutorialPath, "utf-8");
  });

  test("tutorial HTML file exists and is substantial", () => {
    expect(html.length).toBeGreaterThan(5000);
  });

  test("has all 9 step titles", () => {
    expect(html).toContain("First Request");
    expect(html).toContain("Data Binding");
    expect(html).toContain("Conditionals");
    expect(html).toContain("Creating Tasks");
    expect(html).toContain("Completing Tasks");
    expect(html).toContain("Deleting Tasks");
    expect(html).toContain("Search");
    expect(html).toContain("Indicator");
    expect(html).toContain("Error");
  });

  test("uses xhtmlx attributes in demos", () => {
    expect(html).toContain("xh-get");
    expect(html).toContain("xh-post");
    expect(html).toContain("xh-patch");
    expect(html).toContain("xh-delete");
    expect(html).toContain("xh-each");
    expect(html).toContain("xh-text");
    expect(html).toContain("xh-if");
    expect(html).toContain("xh-trigger");
    expect(html).toContain("xh-indicator");
    expect(html).toContain("xh-error-template");
  });

  test("includes mock API for tasks", () => {
    expect(html).toContain("/api/tasks");
    expect(html).toContain("Learn xhtmlx");
    expect(html).toContain("Build a task manager");
  });

  test("loads xhtmlx.js", () => {
    expect(html).toContain("xhtmlx.js");
  });

  test("has view source functionality", () => {
    expect(html.toLowerCase()).toContain("view source");
  });

  test("has progress tracking", () => {
    expect(html.toLowerCase()).toContain("progress");
  });

  test("uses dark theme matching main site", () => {
    expect(html).toContain("--bg-primary");
    expect(html).toContain("--accent-1");
  });

  test("has proper page title", () => {
    expect(html).toContain("<title>");
    expect(html.toLowerCase()).toContain("tutorial");
  });

  test("has back link to main site", () => {
    expect(html).toMatch(/href=["']\.\.\/["']/);
  });

  test("has search/debounce demo", () => {
    expect(html).toContain("delay:");
    expect(html).toContain("changed");
  });

  test("has swap modes in demos", () => {
    expect(html).toContain("beforeend");
    expect(html).toContain("delete");
  });

  test("handles script tag escaping correctly", () => {
    // Should not have unescaped <script> inside script blocks
    const scriptBlocks = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
    for (const block of scriptBlocks) {
      const inner = block.replace(/^<script>/, "").replace(/<\/script>$/, "");
      // Inner content should not contain literal <script> (should be split as '<scr'+'ipt>')
      expect(inner).not.toMatch(/<script[^>]*>/);
    }
  });
});
