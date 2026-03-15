/**
 * @jest-environment jsdom
 */
const xhtmlx = require("../../xhtmlx.js");

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
});

afterEach(() => {
  delete global.fetch;
  // Clear custom directives, hooks, transforms
  const { customDirectives, globalHooks, transforms } = xhtmlx._internals;
  customDirectives.length = 0;
  for (var k in globalHooks) delete globalHooks[k];
  for (var t in transforms) delete transforms[t];
});

function mockFetchJSON(data, status = 200) {
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

describe("Plugin API full flow", () => {
  test("xhtmlx.directive registers custom directive processed after API response", async () => {
    xhtmlx.directive("xh-highlight", function (el, value, ctx) {
      var resolved = ctx.resolve(value);
      if (resolved) {
        el.style.backgroundColor = "yellow";
      }
    });

    mockFetchJSON({ shouldHighlight: true, text: "Important" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div class="note" xh-highlight="shouldHighlight" xh-text="text"></div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const note = document.querySelector(".note");
    expect(note).not.toBeNull();
    expect(note.textContent).toBe("Important");
    expect(note.style.backgroundColor).toBe("yellow");
  });

  test("xhtmlx.hook('beforeRequest') can modify headers on real request", async () => {
    xhtmlx.hook("beforeRequest", function (detail) {
      detail.headers["X-Custom-Token"] = "abc123";
    });

    mockFetchJSON({ status: "ok" });

    document.body.innerHTML = `
      <div xh-get="/api/protected" xh-trigger="load">
        <template>
          <span xh-text="status"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].headers["X-Custom-Token"]).toBe("abc123");
  });

  test("xhtmlx.hook('beforeRequest') returning false cancels the request", async () => {
    xhtmlx.hook("beforeRequest", function () {
      return false;
    });

    mockFetchJSON({ data: "should not appear" });

    document.body.innerHTML = `
      <div xh-get="/api/blocked" xh-trigger="load">
        <template>
          <span class="result" xh-text="data"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.querySelector(".result")).toBeNull();
  });

  test("xhtmlx.transform with pipe syntax in xh-text", async () => {
    xhtmlx.transform("currency", function (value) {
      return "$" + Number(value).toFixed(2);
    });

    mockFetchJSON({ price: 19.9 });

    document.body.innerHTML = `
      <div xh-get="/api/product" xh-trigger="load">
        <template>
          <span class="price" xh-text="price | currency"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const priceEl = document.querySelector(".price");
    expect(priceEl).not.toBeNull();
    expect(priceEl.textContent).toBe("$19.90");
  });

  test("multiple plugins working together", async () => {
    // Register a custom directive
    xhtmlx.directive("xh-tooltip", function (el, value, ctx) {
      var resolved = ctx.resolve(value);
      if (resolved) {
        el.setAttribute("title", resolved);
      }
    });

    // Register a hook that adds a header
    xhtmlx.hook("beforeRequest", function (detail) {
      detail.headers["X-App-Version"] = "2.0";
    });

    // Register a transform
    xhtmlx.transform("uppercase", function (value) {
      return String(value).toUpperCase();
    });

    mockFetchJSON({ name: "alice", tooltip: "User profile", role: "admin" });

    document.body.innerHTML = `
      <div xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="user-card" xh-tooltip="tooltip">
            <span class="name" xh-text="name | uppercase"></span>
            <span class="role" xh-text="role"></span>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    // Verify hook modified the request
    const callArgs = global.fetch.mock.calls[0];
    expect(callArgs[1].headers["X-App-Version"]).toBe("2.0");

    // Verify directive applied
    const card = document.querySelector(".user-card");
    expect(card.getAttribute("title")).toBe("User profile");

    // Verify transform applied
    const nameEl = document.querySelector(".name");
    expect(nameEl.textContent).toBe("ALICE");

    // Regular binding still works
    const roleEl = document.querySelector(".role");
    expect(roleEl.textContent).toBe("admin");
  });
});
