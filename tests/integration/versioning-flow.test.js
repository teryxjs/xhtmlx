/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

var originalConsoleError;

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  xhtmlx.clearResponseCache();
  xhtmlx.config.templatePrefix = "";
  xhtmlx.config.apiPrefix = "";
  xhtmlx.config.uiVersion = null;
  // Suppress expected circular template warnings during reload tests
  originalConsoleError = console.error;
  console.error = jest.fn();
});

afterEach(() => {
  delete global.fetch;
  xhtmlx.config.templatePrefix = "";
  xhtmlx.config.apiPrefix = "";
  xhtmlx.config.uiVersion = null;
  console.error = originalConsoleError;
});

function mockFetchImpl() {
  global.fetch.mockImplementation((url) => {
    // Template fetches
    if (url.endsWith(".html")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve('<span class="ver" xh-text="version"></span>')
      });
    }
    // API fetches
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify({ version: url }))
    });
  });
}

describe("Versioning integration flow", () => {
  test("switchVersion changes templatePrefix, new requests use prefixed URL", async () => {
    mockFetchImpl();

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load" xh-template="/tpl/widget.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // First load: no prefix
    expect(global.fetch).toHaveBeenCalledWith("/tpl/widget.html");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/data",
      expect.anything()
    );

    // Switch version
    global.fetch.mockClear();
    xhtmlx.switchVersion("v2");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // After switchVersion, templates should use prefixed URL
    var templateCalls = global.fetch.mock.calls.filter(c =>
      c[0].includes("/tpl/")
    );
    expect(templateCalls.length).toBeGreaterThanOrEqual(1);
    expect(templateCalls[0][0]).toBe("/ui/v2/tpl/widget.html");
  });

  test("switchVersion clears caches and triggers reload", async () => {
    mockFetchImpl();

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load" xh-template="/tpl/widget.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    var initialCallCount = global.fetch.mock.calls.length;

    // Verify caches are populated
    expect(xhtmlx._internals.templateCache.size).toBeGreaterThan(0);

    // Switch version (reload defaults to true)
    xhtmlx.switchVersion("v3");
    await flushPromises();

    // Caches should have been cleared and new requests made
    expect(xhtmlx.config.uiVersion).toBe("v3");
    expect(xhtmlx.config.templatePrefix).toBe("/ui/v3");

    // There should be new fetch calls after version switch
    expect(global.fetch.mock.calls.length).toBeGreaterThan(initialCallCount);
  });

  test("reload() re-fetches all active widgets", async () => {
    mockFetchImpl();

    document.body.innerHTML = `
      <div id="w1" xh-get="/api/a" xh-trigger="load" xh-template="/tpl/a.html">
      </div>
      <div id="w2" xh-get="/api/b" xh-trigger="load" xh-template="/tpl/b.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // Both widgets loaded
    var apiACalls = global.fetch.mock.calls.filter(c => c[0].includes("/api/a"));
    var apiBCalls = global.fetch.mock.calls.filter(c => c[0].includes("/api/b"));
    expect(apiACalls.length).toBe(1);
    expect(apiBCalls.length).toBe(1);

    // Reload all
    global.fetch.mockClear();
    mockFetchImpl();
    xhtmlx.reload();
    await flushPromises();
    await flushPromises();

    // Both should be re-fetched
    var reloadACalls = global.fetch.mock.calls.filter(c => c[0].includes("/api/a"));
    var reloadBCalls = global.fetch.mock.calls.filter(c => c[0].includes("/api/b"));
    expect(reloadACalls.length).toBeGreaterThanOrEqual(1);
    expect(reloadBCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("reload(templateUrl) only re-fetches matching widgets", async () => {
    mockFetchImpl();

    document.body.innerHTML = `
      <div id="w1" xh-get="/api/a" xh-trigger="load" xh-template="/tpl/a.html">
      </div>
      <div id="w2" xh-get="/api/b" xh-trigger="load" xh-template="/tpl/b.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    global.fetch.mockClear();
    mockFetchImpl();

    // Only reload widgets using /tpl/a.html
    xhtmlx.reload("/tpl/a.html");
    await flushPromises();
    await flushPromises();

    // Only /api/a should be re-fetched, not /api/b
    var reloadACalls = global.fetch.mock.calls.filter(c =>
      c[0].includes("/api/a")
    );
    var reloadBCalls = global.fetch.mock.calls.filter(c =>
      c[0].includes("/api/b")
    );
    expect(reloadACalls.length).toBeGreaterThanOrEqual(1);
    expect(reloadBCalls.length).toBe(0);
  });

  test("version rollback: switchVersion('v1') fetches from v1 prefix", async () => {
    mockFetchImpl();

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/info" xh-trigger="load" xh-template="/tpl/info.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // Switch to v2
    global.fetch.mockClear();
    mockFetchImpl();
    xhtmlx.switchVersion("v2");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(xhtmlx.config.templatePrefix).toBe("/ui/v2");

    // Rollback to v1
    global.fetch.mockClear();
    mockFetchImpl();
    xhtmlx.switchVersion("v1");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(xhtmlx.config.uiVersion).toBe("v1");
    expect(xhtmlx.config.templatePrefix).toBe("/ui/v1");

    // Template should be fetched from v1 prefix
    var v1TemplateCalls = global.fetch.mock.calls.filter(c =>
      c[0].includes("/ui/v1/")
    );
    expect(v1TemplateCalls.length).toBeGreaterThanOrEqual(1);
    expect(v1TemplateCalls[0][0]).toBe("/ui/v1/tpl/info.html");
  });

  test("switchVersion emits xh:versionChanged event", () => {
    var versionEvents = [];
    document.body.addEventListener("xh:versionChanged", function (e) {
      versionEvents.push(e.detail);
    });

    xhtmlx.switchVersion("v5", { reload: false });

    expect(versionEvents.length).toBe(1);
    expect(versionEvents[0].version).toBe("v5");
    expect(versionEvents[0].templatePrefix).toBe("/ui/v5");
  });
});
