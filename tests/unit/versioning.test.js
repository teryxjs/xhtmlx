/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");
const { config, templateCache, responseCache } = xhtmlx._internals;

beforeEach(() => {
  config.templatePrefix = "";
  config.apiPrefix = "";
  config.uiVersion = null;
  templateCache.clear();
  responseCache.clear();
  document.body.innerHTML = "";
  global.fetch = jest.fn();
});

afterEach(() => {
  config.templatePrefix = "";
  config.apiPrefix = "";
  config.uiVersion = null;
  delete global.fetch;
});

describe("UI Versioning", () => {
  describe("config.templatePrefix", () => {
    it("prepends prefix to template fetch URLs", async () => {
      config.templatePrefix = "/ui/v2";
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve("<span>hello</span>")
      });

      const { fetchTemplate } = xhtmlx._internals;
      await fetchTemplate("/templates/header.html");

      expect(global.fetch).toHaveBeenCalledWith("/ui/v2/templates/header.html");
    });

    it("fetches without prefix when templatePrefix is empty", async () => {
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve("<span>hello</span>")
      });

      const { fetchTemplate } = xhtmlx._internals;
      await fetchTemplate("/templates/header.html");

      expect(global.fetch).toHaveBeenCalledWith("/templates/header.html");
    });

    it("caches by prefixed URL", async () => {
      config.templatePrefix = "/ui/v1";
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve("<span>v1</span>")
      });

      const { fetchTemplate } = xhtmlx._internals;
      await fetchTemplate("/templates/header.html");
      await fetchTemplate("/templates/header.html");

      // Only one fetch call — second was cached
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("different prefix fetches fresh template", async () => {
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve("<span>old</span>")
      });

      const { fetchTemplate } = xhtmlx._internals;

      config.templatePrefix = "/ui/v1";
      await fetchTemplate("/templates/header.html");

      config.templatePrefix = "/ui/v2";
      await fetchTemplate("/templates/header.html");

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenCalledWith("/ui/v1/templates/header.html");
      expect(global.fetch).toHaveBeenCalledWith("/ui/v2/templates/header.html");
    });
  });

  describe("config.apiPrefix", () => {
    it("prepends prefix to API request URLs", async () => {
      config.apiPrefix = "/api/v2";
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve(JSON.stringify({ name: "Alice" }))
      });

      document.body.innerHTML = `
        <div xh-get="/users" xh-trigger="load">
          <template><span xh-text="name"></span></template>
        </div>
      `;

      xhtmlx.process(document.body);
      await new Promise(r => setTimeout(r, 0));

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/v2/users",
        expect.anything()
      );
    });

    it("does not prepend prefix to absolute URLs", async () => {
      config.apiPrefix = "/api/v2";
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve(JSON.stringify({ name: "Alice" }))
      });

      document.body.innerHTML = `
        <div xh-get="https://example.com/users" xh-trigger="load">
          <template><span xh-text="name"></span></template>
        </div>
      `;

      xhtmlx.process(document.body);
      await new Promise(r => setTimeout(r, 0));

      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/users",
        expect.anything()
      );
    });
  });

  describe("switchVersion()", () => {
    it("sets uiVersion, templatePrefix, and clears caches", () => {
      templateCache.set("foo", Promise.resolve("bar"));
      responseCache.set("baz", { data: "{}", timestamp: Date.now() });

      xhtmlx.switchVersion("abc123", { reload: false });

      expect(config.uiVersion).toBe("abc123");
      expect(config.templatePrefix).toBe("/ui/abc123");
      expect(templateCache.size).toBe(0);
      expect(responseCache.size).toBe(0);
    });

    it("uses custom templatePrefix when provided", () => {
      xhtmlx.switchVersion("v3", { templatePrefix: "/cdn/builds/v3", reload: false });

      expect(config.templatePrefix).toBe("/cdn/builds/v3");
    });

    it("uses custom apiPrefix when provided", () => {
      xhtmlx.switchVersion("v3", { apiPrefix: "/api/v3", reload: false });

      expect(config.apiPrefix).toBe("/api/v3");
    });

    it("works with git SHA as version", () => {
      xhtmlx.switchVersion("a1b2c3d", { reload: false });

      expect(config.uiVersion).toBe("a1b2c3d");
      expect(config.templatePrefix).toBe("/ui/a1b2c3d");
    });

    it("works with timestamp as version", () => {
      xhtmlx.switchVersion("20260315-1430", { reload: false });

      expect(config.uiVersion).toBe("20260315-1430");
      expect(config.templatePrefix).toBe("/ui/20260315-1430");
    });

    it("works with build hash as version", () => {
      xhtmlx.switchVersion("build-8f2e4a", { reload: false });

      expect(config.templatePrefix).toBe("/ui/build-8f2e4a");
    });

    it("emits xh:versionChanged event", () => {
      const handler = jest.fn();
      document.body.addEventListener("xh:versionChanged", handler);

      xhtmlx.switchVersion("v5", { reload: false });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail.version).toBe("v5");
      expect(handler.mock.calls[0][0].detail.templatePrefix).toBe("/ui/v5");

      document.body.removeEventListener("xh:versionChanged", handler);
    });

    it("rollback: switching back to previous version works", () => {
      xhtmlx.switchVersion("v2", { reload: false });
      expect(config.templatePrefix).toBe("/ui/v2");

      xhtmlx.switchVersion("v1", { reload: false });
      expect(config.templatePrefix).toBe("/ui/v1");
      expect(config.uiVersion).toBe("v1");
    });
  });

  describe("reload()", () => {
    it("re-executes requests for active widgets", async () => {
      global.fetch.mockResolvedValue({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve(JSON.stringify({ name: "Alice" }))
      });

      document.body.innerHTML = `
        <div id="w" xh-get="/users" xh-trigger="load">
          <template><span xh-text="name"></span></template>
        </div>
      `;

      xhtmlx.process(document.body);
      await new Promise(r => setTimeout(r, 0));

      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Reload
      xhtmlx.reload();
      await new Promise(r => setTimeout(r, 0));

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("reload with templateUrl only reloads matching widgets", async () => {
      global.fetch.mockImplementation((url) => {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ data: url }))
        });
      });

      document.body.innerHTML = `
        <div id="w1" xh-get="/a" xh-trigger="load" xh-template="/tpl/a.html">
          <template><span xh-text="data"></span></template>
        </div>
        <div id="w2" xh-get="/b" xh-trigger="load" xh-template="/tpl/b.html">
          <template><span xh-text="data"></span></template>
        </div>
      `;

      xhtmlx.process(document.body);
      await new Promise(r => setTimeout(r, 0));

      global.fetch.mockClear();

      // Only reload widgets using /tpl/a.html
      xhtmlx.reload("/tpl/a.html");
      await new Promise(r => setTimeout(r, 0));

      // Only the /a endpoint should be re-fetched
      const urls = global.fetch.mock.calls.map(c => c[0]);
      expect(urls.some(u => u.includes("/a"))).toBe(true);
    });
  });

  describe("full version switch flow", () => {
    it("switchVersion changes template prefix and reload fetches from new path", async () => {
      let callCount = 0;
      global.fetch.mockImplementation((_url) => {
        callCount++;
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ v: callCount }))
        });
      });

      document.body.innerHTML = `
        <div id="w" xh-get="/data" xh-trigger="load">
          <template><span xh-text="v"></span></template>
        </div>
      `;

      xhtmlx.process(document.body);
      await new Promise(r => setTimeout(r, 0));

      // First load — no prefix
      const firstUrl = global.fetch.mock.calls[0][0];
      expect(firstUrl).toBe("/data");

      // Switch to v2
      global.fetch.mockClear();
      xhtmlx.switchVersion("v2", { apiPrefix: "/api/v2" });
      await new Promise(r => setTimeout(r, 0));

      // Reload should use new API prefix
      const reloadUrl = global.fetch.mock.calls[0][0];
      expect(reloadUrl).toBe("/api/v2/data");
    });
  });
});
