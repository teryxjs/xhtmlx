/**
 * @jest-environment jsdom
 */
const fs = require("fs");
const path = require("path");

const apiDocsPath = path.join(__dirname, "../../docs/api/index.html");

describe("API Reference docs structure", () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(apiDocsPath, "utf-8");
  });

  test("API docs HTML file exists and is substantial", () => {
    expect(html.length).toBeGreaterThan(10000);
  });

  test("has proper page title", () => {
    expect(html).toContain("<title>");
    expect(html.toLowerCase()).toContain("api");
  });

  test("documents all REST verb attributes", () => {
    const verbs = ["xh-get", "xh-post", "xh-put", "xh-delete", "xh-patch"];
    for (const verb of verbs) {
      expect(html).toContain(verb);
    }
  });

  test("documents all data binding attributes", () => {
    expect(html).toContain("xh-text");
    expect(html).toContain("xh-html");
    expect(html).toContain("xh-attr-");
    expect(html).toContain("xh-model");
    expect(html).toContain("xh-class-");
  });

  test("documents iteration and conditionals", () => {
    expect(html).toContain("xh-each");
    expect(html).toContain("xh-if");
    expect(html).toContain("xh-unless");
    expect(html).toContain("xh-show");
    expect(html).toContain("xh-hide");
  });

  test("documents trigger system with modifiers", () => {
    expect(html).toContain("xh-trigger");
    expect(html).toContain("once");
    expect(html).toContain("changed");
    expect(html).toContain("delay:");
    expect(html).toContain("throttle:");
    expect(html).toContain("from:");
    expect(html).toContain("revealed");
    expect(html).toContain("every");
  });

  test("documents all 8 swap modes", () => {
    const modes = ["innerHTML", "outerHTML", "beforeend", "afterbegin", "beforebegin", "afterend", "delete", "none"];
    for (const mode of modes) {
      expect(html).toContain(mode);
    }
  });

  test("documents targeting attributes", () => {
    expect(html).toContain("xh-target");
    expect(html).toContain("xh-swap");
  });

  test("documents error handling", () => {
    expect(html).toContain("xh-error-template");
    expect(html).toContain("xh-error-boundary");
    expect(html).toContain("xh-error-target");
  });

  test("documents WebSocket support", () => {
    expect(html).toContain("xh-ws");
    expect(html).toContain("xh-ws-send");
  });

  test("documents history management", () => {
    expect(html).toContain("xh-push-url");
    expect(html).toContain("xh-replace-url");
  });

  test("documents boost", () => {
    expect(html).toContain("xh-boost");
  });

  test("documents caching and retry", () => {
    expect(html).toContain("xh-cache");
    expect(html).toContain("xh-retry");
  });

  test("documents validation attributes", () => {
    expect(html).toContain("xh-validate");
    expect(html).toContain("xh-validate-pattern");
    expect(html).toContain("xh-validate-min");
    expect(html).toContain("xh-validate-max");
    expect(html).toContain("xh-validate-message");
  });

  test("documents i18n", () => {
    expect(html).toContain("xh-i18n");
    expect(html).toContain("xh-i18n-vars");
  });

  test("documents routing", () => {
    expect(html).toContain("xh-router");
    expect(html).toContain("xh-route");
  });

  test("documents accessibility", () => {
    expect(html).toContain("xh-focus");
    expect(html).toContain("aria-live");
    expect(html).toContain("aria-busy");
  });

  test("documents JavaScript API", () => {
    expect(html).toContain("xhtmlx.process");
    expect(html).toContain("switchVersion");
    expect(html).toContain("xhtmlx.directive");
    expect(html).toContain("xhtmlx.hook");
    expect(html).toContain("xhtmlx.transform");
    expect(html).toContain("xhtmlx.reload");
    expect(html).toContain("scanNamedTemplates");
  });

  test("documents all custom events", () => {
    const events = [
      "xh:beforeRequest", "xh:afterRequest",
      "xh:beforeSwap", "xh:afterSwap",
      "xh:responseError", "xh:retry",
      "xh:versionChanged", "xh:validationError",
      "xh:localeChanged", "xh:routeChanged"
    ];
    for (const evt of events) {
      expect(html).toContain(evt);
    }
  });

  test("documents configuration options", () => {
    expect(html).toContain("defaultSwapMode");
    expect(html).toContain("templatePrefix");
    expect(html).toContain("apiPrefix");
    expect(html).toContain("cspSafe");
    expect(html).toContain("uiVersion");
  });

  test("has search functionality", () => {
    expect(html.toLowerCase()).toContain("search");
    expect(html).toContain("input");
  });

  test("has sidebar navigation", () => {
    expect(html.toLowerCase()).toContain("sidebar");
  });

  test("has anchor IDs for direct linking", () => {
    expect(html).toMatch(/id=["']xh-get["']/);
  });

  test("uses dark theme matching main site", () => {
    expect(html).toContain("--bg-primary");
    expect(html).toContain("--accent-1");
  });

  test("has back link to main site", () => {
    expect(html).toMatch(/href=["']\.\.\//);
  });

  test("documents named templates (xh-name)", () => {
    expect(html).toContain("xh-name");
  });

  test("documents request data attributes", () => {
    expect(html).toContain("xh-vals");
    expect(html).toContain("xh-headers");
  });

  test("documents indicators and disabled class", () => {
    expect(html).toContain("xh-indicator");
    expect(html).toContain("xh-disabled-class");
  });
});
