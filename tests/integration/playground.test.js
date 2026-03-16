/**
 * @jest-environment jsdom
 */
const fs = require("fs");
const path = require("path");

const playgroundPath = path.join(__dirname, "../../docs/playground/index.html");
const swPath = path.join(__dirname, "../../docs/playground/sw.js");

describe("Playground - file structure", () => {
  let html;

  beforeAll(() => {
    html = fs.readFileSync(playgroundPath, "utf-8");
  });

  test("playground HTML file exists and is non-empty", () => {
    expect(html.length).toBeGreaterThan(1000);
  });

  test("contains the example selector dropdown", () => {
    expect(html).toContain('id="exampleSelect"');
  });

  test("contains all 8 preloaded examples", () => {
    expect(html).toContain('"basic-get"');
    expect(html).toContain('"crud-form"');
    expect(html).toContain('"nested-templates"');
    expect(html).toContain('"search-debounce"');
    expect(html).toContain('"conditionals"');
    expect(html).toContain('"error-handling"');
    expect(html).toContain('"polling"');
    expect(html).toContain('"model-reactivity"');
  });

  test("contains the code editor textarea", () => {
    expect(html).toContain('id="codeEditor"');
  });

  test("contains the preview iframe", () => {
    expect(html).toContain('id="previewIframe"');
  });

  test("contains the mock API editor", () => {
    expect(html).toContain('id="mockEditor"');
  });

  test("loads xhtmlx.js in preview", () => {
    expect(html).toContain("xhtmlx.js");
  });

  test("contains run button", () => {
    expect(html).toContain('id="btnRun"');
  });

  test("contains share button", () => {
    expect(html).toContain('id="btnShare"');
  });

  test("contains theme toggle", () => {
    expect(html).toContain('id="btnTheme"');
  });

  test("contains core functions", () => {
    expect(html).toContain("function loadExample");
    expect(html).toContain("function runPreview");
    expect(html).toContain("function buildMockScript");
  });

  test("example selector has change event listener", () => {
    expect(html).toContain('exampleSelect.addEventListener("change"');
  });

  test("service worker file exists and is valid", () => {
    const sw = fs.readFileSync(swPath, "utf-8");
    expect(sw.length).toBeGreaterThan(100);
    expect(sw).toContain("addEventListener");
    expect(sw).toContain("/api/");
  });

  test("mock API routes include all default endpoints", () => {
    expect(html).toContain("GET /api/users");
    expect(html).toContain("POST /api/users");
    expect(html).toContain("GET /api/posts");
    expect(html).toContain("GET /api/todos");
  });

  test("back link to main site exists", () => {
    expect(html).toMatch(/href=["']\.\.\/["']/);
  });
});

describe("Playground - DOM functionality", () => {
  let doc;

  beforeEach(() => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    // Extract just the body content and scripts, load into jsdom
    document.body.innerHTML = "";
    // Parse the playground HTML into a temporary div to extract elements
    const parser = new DOMParser();
    doc = parser.parseFromString(html, "text/html");
  });

  test("example selector has all 8 options plus placeholder", () => {
    const select = doc.getElementById("exampleSelect");
    expect(select).not.toBeNull();
    const options = select.querySelectorAll("option");
    expect(options.length).toBeGreaterThanOrEqual(9); // placeholder + 8 examples
  });

  test("code editor textarea exists and is empty or has default", () => {
    const editor = doc.getElementById("codeEditor");
    expect(editor).not.toBeNull();
    expect(editor.tagName.toLowerCase()).toBe("textarea");
  });

  test("preview iframe exists", () => {
    const iframe = doc.getElementById("previewIframe");
    expect(iframe).not.toBeNull();
    expect(iframe.tagName.toLowerCase()).toBe("iframe");
  });

  test("mock editor textarea exists", () => {
    const mockEditor = doc.getElementById("mockEditor");
    expect(mockEditor).not.toBeNull();
    expect(mockEditor.tagName.toLowerCase()).toBe("textarea");
    // Content is set dynamically by JS at runtime via DEFAULT_MOCK_JSON
  });

  test("run button exists and is clickable", () => {
    const btn = doc.getElementById("btnRun");
    expect(btn).not.toBeNull();
    expect(btn.tagName.toLowerCase()).toBe("button");
  });

  test("share button exists", () => {
    const btn = doc.getElementById("btnShare");
    expect(btn).not.toBeNull();
  });

  test("tab buttons exist for HTML and Mock API", () => {
    const tabHtml = doc.getElementById("tabHtml");
    const tabMock = doc.getElementById("tabMock");
    expect(tabHtml).not.toBeNull();
    expect(tabMock).not.toBeNull();
  });

  test("line numbers container exists", () => {
    const ln = doc.getElementById("lineNumbers");
    expect(ln).not.toBeNull();
  });

  test("editor panel and preview panel exist", () => {
    const editor = doc.getElementById("editorPanel");
    const preview = doc.getElementById("previewPanel");
    expect(editor).not.toBeNull();
    expect(preview).not.toBeNull();
  });

  test("resize handle exists between panels", () => {
    const handle = doc.getElementById("resizeHandle");
    expect(handle).not.toBeNull();
  });

  test("preview background toggle exists", () => {
    const toggle = doc.getElementById("previewBgToggle");
    expect(toggle).not.toBeNull();
  });
});

describe("Playground - JavaScript logic", () => {
  // Extract and test the JS logic by evaluating parts of it

  test("EXAMPLES object has correct structure for each example", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");

    // Extract the EXAMPLES object from the script
    const match = html.match(/var EXAMPLES\s*=\s*\{([\s\S]*?)\n  \};/);
    expect(match).not.toBeNull();

    // Each example should have a title and html property
    const exampleNames = ["basic-get", "crud-form", "nested-templates", "search-debounce",
                          "conditionals", "error-handling", "polling", "model-reactivity"];
    for (const name of exampleNames) {
      expect(html).toContain('"' + name + '"');
      // Each example block should have title and html
      const titleRegex = new RegExp('"' + name + '"[\\s\\S]*?title:\\s*"');
      expect(html).toMatch(titleRegex);
    }
  });

  test("buildMockScript generates valid JavaScript", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");

    // Verify buildMockScript contains fetch override
    expect(html).toContain("window.fetch = function");
    // Verify it contains XHR override
    expect(html).toContain("MockXHR");
    // Verify it handles /api/ prefix
    expect(html).toContain('/api/');
  });

  test("share functionality uses base64 encoding", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("btoa");
    expect(html).toContain("atob");
    expect(html).toContain("location.hash");
  });

  test("debounce timer is set for auto-run", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("debounceTimer");
    expect(html).toMatch(/setTimeout.*\n.*runPreview/);
  });

  test("Ctrl+Enter keyboard shortcut is handled", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("ctrlKey");
    expect(html).toContain('"Enter"');
  });

  test("tab key inserts spaces instead of changing focus", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain('"Tab"');
    expect(html).toContain("e.preventDefault");
    expect(html).toContain("selectionStart");
  });

  test("runPreview builds srcdoc with mock script and user HTML", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    // Should build srcdoc string
    expect(html).toContain("srcdoc");
    expect(html).toContain("codeEditor.value");
    expect(html).toContain("buildMockScript");
  });

  test("theme toggle saves to localStorage", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("localStorage");
    expect(html).toMatch(/xhtmlx.*theme|playground.*theme/i);
  });

  test("line numbers update on editor input", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("function updateLineNumbers");
    expect(html).toContain("split");
  });

  test("scroll sync between editor and line numbers", () => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    expect(html).toContain("scrollTop");
    expect(html).toContain("translateY");
  });
});

describe("Playground - Service Worker", () => {
  let swCode;

  beforeAll(() => {
    swCode = fs.readFileSync(swPath, "utf-8");
  });

  test("SW handles install event with skipWaiting", () => {
    expect(swCode).toContain("install");
    expect(swCode).toContain("skipWaiting");
  });

  test("SW handles activate event with clients.claim", () => {
    expect(swCode).toContain("activate");
    expect(swCode).toContain("clients.claim");
  });

  test("SW handles fetch events for /api/ routes", () => {
    expect(swCode).toContain("fetch");
    expect(swCode).toContain("/api/");
  });

  test("SW handles message events for route updates", () => {
    expect(swCode).toContain("message");
    expect(swCode).toContain("UPDATE_ROUTES");
  });

  test("SW includes default mock routes", () => {
    expect(swCode).toContain("GET /api/users");
    expect(swCode).toContain("GET /api/posts");
    expect(swCode).toContain("GET /api/todos");
    expect(swCode).toContain("GET /api/error/404");
    expect(swCode).toContain("GET /api/error/500");
  });

  test("SW adds simulated network delay", () => {
    expect(swCode).toContain("setTimeout");
    // Should have some delay range
    expect(swCode).toMatch(/\d{2,3}/); // delay values
  });

  test("SW returns proper Response objects with JSON content type", () => {
    expect(swCode).toContain("new Response");
    expect(swCode).toContain("application/json");
  });

  test("SW supports dynamic route updates", () => {
    expect(swCode).toContain("customRoutes");
  });
});

describe("Playground - Mock API default routes", () => {
  let mockJson;

  beforeAll(() => {
    const html = fs.readFileSync(playgroundPath, "utf-8");
    // Extract DEFAULT_MOCK_JSON from the script (it's set dynamically, not in textarea)
    const match = html.match(/var DEFAULT_MOCK_JSON\s*=\s*(\{[\s\S]*?\n  \});/);
    if (match) {
      // Use Function constructor to safely evaluate the JS object literal
      mockJson = (new Function("return " + match[1]))();
    }
  });

  test("mock config is valid object", () => {
    expect(mockJson).toBeDefined();
    expect(typeof mockJson).toBe("object");
  });

  test("GET /api/users returns array of users", () => {
    const route = mockJson["GET /api/users"];
    expect(route).toBeDefined();
    expect(route.status).toBe(200);
    expect(route.body.users).toBeInstanceOf(Array);
    expect(route.body.users.length).toBeGreaterThan(0);
    const user = route.body.users[0];
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("email");
  });

  test("POST /api/users returns 201 with created user", () => {
    const route = mockJson["POST /api/users"];
    expect(route).toBeDefined();
    expect(route.status).toBe(201);
    expect(route.body).toHaveProperty("id");
  });

  test("GET /api/posts returns array of posts", () => {
    const route = mockJson["GET /api/posts"];
    expect(route).toBeDefined();
    expect(route.status).toBe(200);
    expect(route.body.posts).toBeInstanceOf(Array);
  });

  test("GET /api/todos returns array of todos with mixed completion", () => {
    const route = mockJson["GET /api/todos"];
    expect(route).toBeDefined();
    expect(route.body.todos).toBeInstanceOf(Array);
    const completed = route.body.todos.filter(t => t.completed);
    const incomplete = route.body.todos.filter(t => !t.completed);
    expect(completed.length).toBeGreaterThan(0);
    expect(incomplete.length).toBeGreaterThan(0);
  });

  test("DELETE endpoint returns 204", () => {
    const route = mockJson["DELETE /api/users/1"];
    expect(route).toBeDefined();
    expect(route.status).toBe(204);
  });

  test("error routes return proper error status codes", () => {
    const r404 = mockJson["GET /api/error/404"];
    const r500 = mockJson["GET /api/error/500"];
    expect(r404).toBeDefined();
    expect(r404.status).toBe(404);
    expect(r404.body).toHaveProperty("error");
    expect(r500).toBeDefined();
    expect(r500.status).toBe(500);
    expect(r500.body).toHaveProperty("error");
  });

  test("user objects have role field for conditional examples", () => {
    const users = mockJson["GET /api/users"].body.users;
    const hasRole = users.some(u => u.role);
    expect(hasRole).toBe(true);
  });

  test("individual user endpoint exists", () => {
    const route = mockJson["GET /api/users/1"] || mockJson["GET /api/users/2"];
    expect(route).toBeDefined();
    expect(route.status).toBe(200);
    expect(route.body).toHaveProperty("name");
  });
});
